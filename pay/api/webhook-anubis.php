<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/lib/bootstrap.php';
require_once dirname(__DIR__, 2) . '/lib/masterfy.php';
require_once dirname(__DIR__, 2) . '/lib/anubis.php';
require_once dirname(__DIR__, 2) . '/lib/security.php';
require_once dirname(__DIR__, 2) . '/lib/webhook-log.php';

credpix_load_env();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    credpix_json(200, ['ok' => true, 'gateway' => 'anubis']);
}

credpix_rate_limit_or_429('webhook_anubis', 200, 60);

$raw  = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);

if (!is_array($body)) {
    credpix_json(400, ['error' => 'JSON inválido']);
}

// Anubis usa PascalCase nos campos do webhook
$paymentId = (string) ($body['Id']     ?? $body['id']     ?? '');
$rawStatus = (string) ($body['Status'] ?? $body['status'] ?? 'PENDING');
$status    = credpix_anubis_map_status($rawStatus);

// Anubis envia Amount em reais — converter para centavos
$amountReais = (float) ($body['Amount'] ?? $body['amount'] ?? 0);
$amountCents = (int) round($amountReais * 100);

$paidAt = null;
$paidAtRaw = $body['PaidAt'] ?? $body['paidAt'] ?? null;
if ($paidAtRaw) {
    $paidAt = strtotime((string) $paidAtRaw) ?: time();
}

if ($paymentId === '') {
    credpix_webhook_log_append([
        'payment_id'      => null,
        'status'          => 'invalid_payload',
        'signature_valid' => false,
        'ok'              => false,
        'gateway'         => 'anubis',
    ]);
    credpix_json(400, ['error' => 'Id de transação ausente']);
}

$existing = credpix_load_tx($paymentId);

credpix_webhook_log_append([
    'payment_id'      => $paymentId,
    'status'          => $status,
    'signature_valid' => true,
    'verify_method'   => 'local_tx',
    'ok'              => true,
    'gateway'         => 'anubis',
]);

if ($paymentId !== '') {
    $tx = array_merge($existing ?? [], [
        'anubis_id' => $paymentId,
        'gateway'   => 'anubis',
        'status'    => $status,
        'updated'   => time(),
    ]);
    if ($amountCents > 0 && empty($tx['amount_cents'])) {
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
        credpix_analytics_log_payment_webhook($paymentId, $status, $tx, false, $body);
    }
}

credpix_json(200, ['received' => true, 'gateway' => 'anubis']);
