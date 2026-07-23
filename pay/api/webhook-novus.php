<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/lib/bootstrap.php';
require_once dirname(__DIR__, 2) . '/lib/masterfy.php';
require_once dirname(__DIR__, 2) . '/lib/anubis.php';
require_once dirname(__DIR__, 2) . '/lib/novus.php';
require_once dirname(__DIR__, 2) . '/lib/security.php';
require_once dirname(__DIR__, 2) . '/lib/webhook-log.php';

credpix_load_env();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    credpix_json(200, ['ok' => true, 'gateway' => 'novus']);
}

credpix_rate_limit_or_429('webhook_novus', 200, 60);

$raw  = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);

if (!is_array($body)) {
    credpix_webhook_log_append([
        'payment_id'      => null,
        'status'          => 'invalid_json',
        'signature_valid' => false,
        'ok'              => false,
        'gateway'         => 'novus',
        'body_len'        => strlen($raw),
    ]);
    credpix_json(400, ['error' => 'JSON inválido']);
}

$verify = credpix_novus_verify_webhook_hmac($raw);
$signatureValid = !empty($verify['valid']);
$verifyMethod = (string) ($verify['verify_method'] ?? 'hmac');

/* Envelope global: { event, timestamp, data: {...} } | Per-transaction postback: campos no root */
$eventBody = is_array($body['data'] ?? null) ? $body['data'] : $body;

$paymentId = (string) (
    $eventBody['invoice_id']
    ?? $eventBody['id']
    ?? $eventBody['transaction_id']
    ?? $body['invoice_id']
    ?? $body['id']
    ?? ''
);
$rawStatus = (string) ($eventBody['status'] ?? $body['status'] ?? 'pending');
$status    = credpix_novus_map_status($rawStatus);

$amountCents = null;
foreach (['total_cents', 'total_price_cents', 'amount', 'total'] as $k) {
    if (isset($eventBody[$k]) && is_numeric($eventBody[$k])) {
        $amountCents = (int) $eventBody[$k];
        break;
    }
    if (isset($body[$k]) && is_numeric($body[$k])) {
        $amountCents = (int) $body[$k];
        break;
    }
}

$paidAt = credpix_novus_parse_paid_at($eventBody['paid_at'] ?? $body['paid_at'] ?? null);

if (!$signatureValid && credpix_is_production() && ($verify['reason'] ?? '') !== 'secret_not_configured_dev') {
    credpix_webhook_log_append([
        'payment_id'      => $paymentId ?: null,
        'status'          => 'invalid_signature',
        'signature_valid' => false,
        'ok'              => false,
        'gateway'         => 'novus',
        'reason'          => $verify['reason'] ?? 'signature_mismatch',
        'body_len'        => $verify['body_len'] ?? strlen($raw),
        'sig_header_len'  => strlen($verify['header'] ?? ''),
    ]);
    credpix_json(401, ['error' => 'Webhook rejeitado', 'reason' => $verify['reason'] ?? 'signature_mismatch']);
}

if ($paymentId === '') {
    credpix_webhook_log_append([
        'payment_id'      => null,
        'status'          => 'invalid_payload',
        'signature_valid' => $signatureValid,
        'verify_method'   => $verifyMethod,
        'ok'              => false,
        'gateway'         => 'novus',
        'reason'          => 'missing_payment_id',
    ]);
    credpix_json(400, ['error' => 'Id de transação ausente']);
}

$existing = credpix_load_tx($paymentId);

if (!$existing) {
    credpix_webhook_log_append([
        'payment_id'      => $paymentId,
        'status'          => 'ignored_unknown_transaction',
        'signature_valid' => $signatureValid,
        'verify_method'   => 'local_tx',
        'ok'              => true,
        'gateway'         => 'novus',
    ]);
    credpix_json(200, ['received' => true, 'gateway' => 'novus', 'ignored' => true]);
}

$remoteMeta = credpix_novus_extract_site_metadata($body);
if ($remoteMeta !== [] && !credpix_origin_matches_site_context($existing, $remoteMeta)) {
    credpix_webhook_log_append([
        'payment_id'      => $paymentId,
        'status'          => 'ignored_site_mismatch',
        'signature_valid' => $signatureValid,
        'verify_method'   => 'site_metadata',
        'ok'              => true,
        'gateway'         => 'novus',
    ]);
    credpix_json(200, ['received' => true, 'gateway' => 'novus', 'ignored' => true]);
}

credpix_webhook_log_append([
    'payment_id'      => $paymentId,
    'status'          => $status,
    'signature_valid' => $signatureValid,
    'verify_method'   => $verifyMethod,
    'verify_reason'   => $verify['reason'] ?? null,
    'ok'              => true,
    'gateway'         => 'novus',
]);

$tx = array_merge($existing, [
    'novus_id' => $paymentId,
    'gateway'  => 'novus',
    'status'   => $status,
    'updated'  => time(),
]);
if ($amountCents !== null && $amountCents > 0 && empty($tx['amount_cents'])) {
    $tx['amount_cents'] = $amountCents;
}
credpix_save_tx($paymentId, $tx);

if ($status === 'paid') {
    require_once dirname(__DIR__, 2) . '/lib/utmify.php';
    require_once dirname(__DIR__, 2) . '/lib/analytics.php';
    if (empty($tx['utmify_paid_sent'])) {
        credpix_utmify_on_status_paid($paymentId, $tx, $paidAt ?: time());
        credpix_save_tx($paymentId, $tx);
    }
    credpix_analytics_log_payment_webhook($paymentId, $status, $tx, $signatureValid, $body);
}

credpix_json(200, ['received' => true, 'gateway' => 'novus', 'verify_method' => $verifyMethod]);
