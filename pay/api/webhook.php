<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/lib/masterfy.php';
require_once dirname(__DIR__, 2) . '/lib/security.php';
require_once dirname(__DIR__, 2) . '/lib/webhook-log.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    credpix_json(200, ['ok' => true]);
}

credpix_rate_limit_or_429('webhook', 200, 60);

$raw = credpix_masterfy_read_webhook_raw_body();
$body = json_decode($raw, true);
$verify = credpix_masterfy_verify_webhook($raw, is_array($body) ? $body : null);
$signatureValid = !empty($verify['valid']);
$verifyMethod = (string) ($verify['verify_method'] ?? 'hmac');

if (!$signatureValid) {
    credpix_webhook_log_append([
        'payment_id' => is_array($body) ? ($body['id'] ?? null) : null,
        'status' => 'invalid_signature',
        'signature_valid' => false,
        'ok' => false,
        'reason' => $verify['reason'] ?? 'signature_mismatch',
        'api_reason' => $verify['api_reason'] ?? null,
        'local_reason' => $verify['local_reason'] ?? null,
        'body_len' => $verify['body_len'] ?? strlen($raw),
        'sig_header_len' => strlen($verify['header'] ?? ''),
    ]);
    credpix_json(401, [
        'error' => 'Webhook rejeitado',
        'reason' => $verify['reason'] ?? 'signature_mismatch',
        'api_reason' => $verify['api_reason'] ?? null,
        'local_reason' => $verify['local_reason'] ?? null,
    ]);
}

if (!is_array($body)) {
    credpix_webhook_log_append([
        'payment_id' => null,
        'status' => 'invalid_json',
        'signature_valid' => false,
        'ok' => false,
        'body_len' => strlen($raw),
    ]);
    credpix_json(400, ['error' => 'JSON invalido']);
}

$paymentId = (string) ($body['id'] ?? '');
$status = credpix_map_status((string) ($body['status'] ?? 'PENDING'));

credpix_webhook_log_append([
    'payment_id' => $paymentId,
    'status' => $status,
    'signature_valid' => $verifyMethod === 'hmac',
    'verify_method' => $verifyMethod,
    'verify_reason' => $verify['reason'] ?? null,
    'ok' => true,
]);

if ($paymentId !== '') {
    $existing = credpix_load_tx($paymentId) ?? [];
    $tx = array_merge($existing, [
        'masterfy_id' => $paymentId,
        'status' => $status,
        'updated' => time(),
    ]);
    credpix_save_tx($paymentId, $tx);

    if ($status === 'paid') {
        require_once dirname(__DIR__, 2) . '/lib/utmify.php';
        require_once dirname(__DIR__, 2) . '/lib/analytics.php';
        if (empty($tx['utmify_paid_sent'])) {
            $paidAt = credpix_utmify_parse_paid_at($body['paidAt'] ?? $body['data']['paidAt'] ?? null);
            credpix_utmify_on_status_paid($paymentId, $tx, $paidAt ?: time());
            credpix_save_tx($paymentId, $tx);
        }
        credpix_analytics_log_payment_webhook($paymentId, $status, $tx, $verifyMethod === 'hmac', $body);
    }
}

credpix_json(200, ['received' => true, 'verify_method' => $verifyMethod]);
