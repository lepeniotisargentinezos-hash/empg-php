<?php
declare(strict_types=1);

/** Ambiente de produção (não localhost e não PAYMENT_MOCK). */
function credpix_is_production(): bool
{
    if (getenv('CREDPIX_ENV') === 'development') {
        return false;
    }
    if (getenv('CREDPIX_ENV') === 'production') {
        return true;
    }
    if (getenv('PAYMENT_MOCK') === '1') {
        return false;
    }
    $url = trim((string) (getenv('PUBLIC_BASE_URL') ?: ''));
    if ($url !== '' && preg_match('#localhost|127\.0\.0\.1#i', $url)) {
        return false;
    }
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    if ($host === '' || preg_match('#^(localhost|127\.0\.0\.1)(:\d+)?$#i', $host)) {
        return false;
    }
    return true;
}

/** Eventos que o navegador pode enviar sem chave de ingest (demais exigem chave ou servidor). */
function credpix_analytics_public_event_types(): array
{
    return [
        'page_view',
        'lead_profile',
        'upsell_click',
        'upsell_routed',
        'wizard_step',
        'funnel_step',
    ];
}

function credpix_analytics_event_allowed_public(array $ev): bool
{
    $type = substr((string) ($ev['type'] ?? ''), 0, 64);
    if (in_array($type, credpix_analytics_public_event_types(), true)) {
        return true;
    }
    if ($type === 'payment_paid') {
        $txId = function_exists('credpix_analytics_event_tx_id')
            ? (credpix_analytics_event_tx_id($ev) ?? '')
            : trim((string) ($ev['transaction_id'] ?? ($ev['meta']['transaction_id'] ?? '')));
        return $txId !== '' && credpix_load_tx($txId) !== null;
    }
    return false;
}

/** Rate limit simples por IP + bucket (arquivo em data/rate-limit). */
function credpix_rate_limit(string $bucket, int $maxPerWindow, int $windowSec = 60): bool
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
        $ip = (string) $_SERVER['HTTP_CF_CONNECTING_IP'];
    }
    $key = preg_replace('/[^a-zA-Z0-9._-]/', '_', $bucket) . '_' . preg_replace('/[^a-fA-F0-9.:]/', '_', $ip);
    $dir = credpix_root() . '/data/rate-limit';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $path = $dir . '/' . $key . '.json';
    $now = time();
    $data = ['count' => 0, 'reset' => $now + $windowSec];
    if (is_file($path)) {
        $raw = json_decode((string) file_get_contents($path), true);
        if (is_array($raw)) {
            $data = $raw;
        }
    }
    if (($data['reset'] ?? 0) < $now) {
        $data = ['count' => 0, 'reset' => $now + $windowSec];
    }
    $data['count'] = (int) ($data['count'] ?? 0) + 1;
    file_put_contents($path, json_encode($data), LOCK_EX);
    return $data['count'] <= $maxPerWindow;
}

function credpix_rate_limit_or_429(string $bucket, int $maxPerWindow, int $windowSec = 60): void
{
    if (credpix_rate_limit($bucket, $maxPerWindow, $windowSec)) {
        return;
    }
    credpix_json(429, ['success' => false, 'error' => 'Muitas requisições. Tente novamente em instantes.']);
}

function credpix_cors_send(): void
{
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin === '') {
        return;
    }

    $originNorm = rtrim($origin, '/');
    $allowed = trim((string) (getenv('PUBLIC_BASE_URL') ?: ''));
    if ($allowed !== '' && $originNorm === rtrim($allowed, '/')) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Credentials: true');
        return;
    }

    $host = (string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? '');
    $host = explode(',', $host)[0];
    $host = strtolower(trim($host));
    if (strpos($host, ':') !== false) {
        $host = explode(':', $host)[0];
    }
    if ($host !== '') {
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
        $proto = $https ? 'https' : 'http';
        if ($originNorm === $proto . '://' . $host || $originNorm === 'https://' . $host || $originNorm === 'http://' . $host) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
            header('Access-Control-Allow-Credentials: true');
            return;
        }
    }

    if (!credpix_is_production()) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
}
