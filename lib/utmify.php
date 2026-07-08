<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/masterfy.php';

function credpix_utmify_enabled(): bool
{
    $token = getenv('UTMIFY_API_TOKEN') ?: '';
    if ($token === '') {
        return false;
    }
    return (getenv('UTMIFY_ENABLED') ?: '1') !== '0';
}

function credpix_utmify_platform(): string
{
    $name = trim((string) (getenv('UTMIFY_PLATFORM') ?: 'CredPix'));
    return $name !== '' ? $name : 'CredPix';
}

function credpix_utmify_client_ip(): ?string
{
    $headers = [
        'HTTP_CF_CONNECTING_IP',
        'HTTP_X_FORWARDED_FOR',
        'REMOTE_ADDR',
    ];
    foreach ($headers as $key) {
        if (empty($_SERVER[$key])) {
            continue;
        }
        $raw = (string) $_SERVER[$key];
        $ip = trim(explode(',', $raw)[0]);
        if (filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }
    }
    return null;
}

function credpix_utmify_nullable(?string $value): ?string
{
    if ($value === null) {
        return null;
    }
    $value = trim($value);
    return $value === '' ? null : $value;
}

function credpix_utmify_ts_utc(?int $unixSeconds = null): string
{
    return gmdate('Y-m-d H:i:s', $unixSeconds ?? time());
}

function credpix_utmify_parse_paid_at(mixed $paidAt): ?int
{
    if ($paidAt === null || $paidAt === '') {
        return null;
    }
    if (is_numeric($paidAt)) {
        $n = (int) $paidAt;
        return $n > 9999999999 ? (int) floor($n / 1000) : $n;
    }
    $ts = strtotime((string) $paidAt);
    return $ts !== false ? $ts : null;
}

function credpix_utmify_tracking_params(array $utms): array
{
    return [
        'src' => credpix_utmify_nullable($utms['src'] ?? null),
        'sck' => credpix_utmify_nullable($utms['sck'] ?? null),
        'utm_source' => credpix_utmify_nullable($utms['utm_source'] ?? null),
        'utm_campaign' => credpix_utmify_nullable($utms['utm_campaign'] ?? null),
        'utm_medium' => credpix_utmify_nullable($utms['utm_medium'] ?? null),
        'utm_content' => credpix_utmify_nullable($utms['utm_content'] ?? null),
        'utm_term' => credpix_utmify_nullable($utms['utm_term'] ?? null),
    ];
}

function credpix_utmify_commission(int $totalCents): array
{
    $fixed = max(0, (int) (getenv('UTMIFY_GATEWAY_FEE_CENTS') ?: 0));
    $pct = max(0, (float) (getenv('UTMIFY_GATEWAY_FEE_PERCENT') ?: 0));
    $variable = $pct > 0 ? (int) round($totalCents * ($pct / 100)) : 0;
    $gatewayFee = min($totalCents, $fixed + $variable);
    $userCommission = max(0, $totalCents - $gatewayFee);
    if ($userCommission === 0 && $totalCents > 0) {
        $userCommission = $totalCents;
        $gatewayFee = 0;
    }
    return [
        'totalPriceInCents' => $totalCents,
        'gatewayFeeInCents' => $gatewayFee,
        'userCommissionInCents' => $userCommission,
    ];
}

function credpix_utmify_build_payload(string $orderId, string $status, array $tx): array
{
    $products = credpix_products();
    $productId = (string) ($tx['product_id'] ?? '');
    $product = $products[$productId] ?? null;
    $amountCents = (int) ($tx['amount_cents'] ?? ($product['amountCents'] ?? 0));
    $productName = is_array($product)
        ? credpix_catalog_display_name($productId, $product)
        : ($productId ?: 'Produto');

    $createdUnix = (int) ($tx['created'] ?? time());
    if ($createdUnix > 9999999999) {
        $createdUnix = (int) floor($createdUnix / 1000);
    }

    $approvedUnix = null;
    if ($status === 'paid') {
        $approvedUnix = credpix_utmify_parse_paid_at($tx['paid_at'] ?? null) ?? time();
    }

    $payer = is_array($tx['payer'] ?? null) ? $tx['payer'] : [];
    $utms = is_array($tx['utms'] ?? null) ? $tx['utms'] : [];

    $payload = [
        'orderId' => $orderId,
        'platform' => credpix_utmify_platform(),
        'paymentMethod' => 'pix',
        'status' => $status,
        'createdAt' => credpix_utmify_ts_utc($createdUnix),
        'approvedDate' => $approvedUnix !== null ? credpix_utmify_ts_utc($approvedUnix) : null,
        'refundedAt' => null,
        'customer' => [
            'name' => (string) ($payer['name'] ?? 'Cliente'),
            'email' => (string) ($payer['email'] ?? 'cliente@email.com'),
            'phone' => preg_replace('/\D/', '', (string) ($payer['phone'] ?? '')) ?: null,
            'document' => preg_replace('/\D/', '', (string) ($payer['document'] ?? '')) ?: null,
            'country' => 'BR',
            'ip' => credpix_utmify_nullable($tx['client_ip'] ?? null),
        ],
        'products' => [[
            'id' => $productId ?: $orderId,
            'name' => $productName,
            'planId' => null,
            'planName' => null,
            'quantity' => 1,
            'priceInCents' => $amountCents,
        ]],
        'trackingParameters' => credpix_utmify_tracking_params($utms),
        'commission' => credpix_utmify_commission($amountCents),
    ];

    if (!empty($tx['mock']) || getenv('UTMIFY_IS_TEST') === '1') {
        $payload['isTest'] = true;
    }

    return $payload;
}

function credpix_utmify_log(array $entry): void
{
    $dir = credpix_root() . '/data/utmify';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $entry['logged_at'] = gmdate('c');
    file_put_contents(
        $dir . '/log-' . gmdate('Y-m-d') . '.jsonl',
        json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n",
        FILE_APPEND | LOCK_EX
    );
}

function credpix_utmify_send(array $payload): array
{
    if (!credpix_utmify_enabled()) {
        return ['ok' => false, 'skipped' => true, 'reason' => 'disabled'];
    }

    $token = getenv('UTMIFY_API_TOKEN') ?: '';
    $ch = curl_init('https://api.utmify.com.br/api-credentials/orders');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'x-api-token: ' . $token,
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ]);
    $raw = curl_exec($ch);
    $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    $json = is_string($raw) ? json_decode($raw, true) : null;
    $result = [
        'ok' => $http >= 200 && $http < 300,
        'http' => $http,
        'orderId' => $payload['orderId'] ?? null,
        'status' => $payload['status'] ?? null,
        'response' => is_array($json) ? $json : $raw,
        'error' => $err !== '' ? $err : null,
    ];
    credpix_utmify_log(['direction' => 'out', 'payload' => $payload, 'result' => $result]);
    return $result;
}

function credpix_utmify_notify_pix_generated(string $orderId, array &$tx): array
{
    if (!credpix_utmify_enabled()) {
        return ['ok' => false, 'skipped' => true];
    }
    if (!empty($tx['utmify_waiting_sent'])) {
        return ['ok' => true, 'skipped' => true, 'reason' => 'already_sent'];
    }
    $payload = credpix_utmify_build_payload($orderId, 'waiting_payment', $tx);
    $result = credpix_utmify_send($payload);
    if (!empty($result['ok'])) {
        $tx['utmify_waiting_sent'] = true;
        $tx['utmify_waiting_at'] = time();
    }
    return $result;
}

function credpix_utmify_notify_pix_paid(string $orderId, array &$tx): array
{
    if (!credpix_utmify_enabled()) {
        return ['ok' => false, 'skipped' => true];
    }
    if (!empty($tx['utmify_paid_sent'])) {
        return ['ok' => true, 'skipped' => true, 'reason' => 'already_sent'];
    }

    $payload = credpix_utmify_build_payload($orderId, 'paid', $tx);
    $result = credpix_utmify_send($payload);
    if (!empty($result['ok'])) {
        $tx['utmify_paid_sent'] = true;
        $tx['utmify_paid_at'] = time();
    }
    return $result;
}

function credpix_utmify_retry_waiting_if_needed(string $orderId, array &$tx): void
{
    if (!credpix_utmify_enabled()) {
        return;
    }
    if (!empty($tx['utmify_waiting_sent'])) {
        return;
    }
    if (($tx['status'] ?? '') !== 'pending') {
        return;
    }
    credpix_utmify_notify_pix_generated($orderId, $tx);
}

function credpix_utmify_on_status_paid(string $orderId, array &$tx, ?int $paidAtUnix = null): void
{
    if (($tx['status'] ?? '') !== 'paid') {
        return;
    }
    if ($paidAtUnix !== null) {
        $tx['paid_at'] = $paidAtUnix;
    }
    if (empty($tx['utmify_waiting_sent'])) {
        credpix_utmify_notify_pix_generated($orderId, $tx);
    }
    credpix_utmify_notify_pix_paid($orderId, $tx);
}

function credpix_utmify_tx_context(array $payer, array $body, string $productId, int $amountCents, array $extra = []): array
{
    return array_merge([
        'product_id' => $productId,
        'amount_cents' => $amountCents,
        'payer' => $payer,
        'utms' => is_array($body['utms'] ?? null) ? $body['utms'] : [],
        'client_ip' => credpix_utmify_client_ip(),
        'created' => time(),
    ], $extra);
}

function credpix_utmify_order_status(?string $orderId): array
{
    if ($orderId === null || $orderId === '') {
        return ['waiting_sent' => false, 'paid_sent' => false, 'tx_found' => false];
    }
    $tx = credpix_load_tx($orderId);
    if (!$tx) {
        return ['waiting_sent' => false, 'paid_sent' => false, 'tx_found' => false];
    }
    return [
        'waiting_sent' => !empty($tx['utmify_waiting_sent']),
        'paid_sent' => !empty($tx['utmify_paid_sent']),
        'tx_found' => true,
    ];
}

function credpix_utmify_read_recent_logs(int $limit = 30): array
{
    $dir = credpix_root() . '/data/utmify';
    if (!is_dir($dir)) {
        return [];
    }
    $files = glob($dir . '/log-*.jsonl') ?: [];
    rsort($files);
    $rows = [];
    foreach ($files as $file) {
        $lines = @file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        for ($i = count($lines) - 1; $i >= 0 && count($rows) < $limit; $i--) {
            $row = json_decode($lines[$i], true);
            if (is_array($row)) {
                $rows[] = $row;
            }
        }
        if (count($rows) >= $limit) {
            break;
        }
    }
    return $rows;
}

function credpix_utmify_retry_order(string $orderId): array
{
    if (!credpix_utmify_enabled()) {
        return ['ok' => false, 'error' => 'Utmify desabilitado'];
    }
    $orderId = trim($orderId);
    if ($orderId === '') {
        return ['ok' => false, 'error' => 'transaction_id obrigatório'];
    }
    $tx = credpix_load_tx($orderId);
    if (!$tx) {
        return ['ok' => false, 'error' => 'Transação não encontrada'];
    }
    if (($tx['status'] ?? '') === 'paid') {
        credpix_utmify_on_status_paid($orderId, $tx, credpix_utmify_parse_paid_at($tx['paid_at'] ?? null) ?? time());
    } else {
        credpix_utmify_retry_waiting_if_needed($orderId, $tx);
    }
    credpix_save_tx($orderId, $tx);
    return [
        'ok' => true,
        'status' => credpix_utmify_order_status($orderId),
    ];
}
