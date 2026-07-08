<?php
declare(strict_types=1);

function credpix_root(): string
{
    return dirname(__DIR__);
}

function credpix_load_env(): void
{
    $path = credpix_root() . '/.env';
    if (!is_file($path)) {
        return;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        $eq = strpos($line, '=');
        if ($eq === false) {
            continue;
        }
        $key = trim(substr($line, 0, $eq));
        $val = trim(substr($line, $eq + 1));
        if (
            (strlen($val) >= 2 && $val[0] === '"' && substr($val, -1) === '"') ||
            (strlen($val) >= 2 && $val[0] === "'" && substr($val, -1) === "'")
        ) {
            $val = substr($val, 1, -1);
        }
        // .env do projeto tem prioridade (cPanel às vezes injeta vars antigas no PHP).
        if ($key !== '') {
            putenv("$key=$val");
            $_ENV[$key] = $val;
        }
    }
}

function credpix_json(int $status, array $data): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function credpix_products(): array
{
    static $products;
    if ($products === null) {
        $products = require credpix_root() . '/config/products.php';
    }
    return $products;
}

function credpix_format_brl(int $cents): string
{
    return number_format($cents / 100, 2, ',', '.');
}

function credpix_public_base_url(): string
{
    $forced = getenv('PUBLIC_BASE_URL') ?: '';
    if ($forced !== '') {
        return rtrim($forced, '/');
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
    $proto = $https ? 'https' : 'http';
    $host = $_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? 'localhost';
    $host = explode(',', $host)[0];
    return $proto . '://' . trim($host);
}

/** Subpasta do funil (/empa, /empa2) — .env BASE_PATH ou inferido do SCRIPT_NAME. */
function credpix_app_base_path(): string
{
    credpix_load_env();
    $base = trim((string) (getenv('BASE_PATH') ?: ''));
    if ($base !== '' && $base !== '/') {
        return rtrim($base, '/');
    }
    $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '');
    if (preg_match('#^(/.+?)/(?:pay/api|api)/#', $script, $m)) {
        return $m[1];
    }
    return '';
}

function credpix_pay_webhook_url(): string
{
    return credpix_public_base_url() . credpix_app_base_path() . '/pay/api/webhook.php';
}

function credpix_data_dir(): string
{
    $dir = credpix_root() . '/data/pix';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function credpix_cookie_path(): string
{
    credpix_load_env();
    $base = trim((string) (getenv('BASE_PATH') ?: ''));
    if ($base === '' || $base === '/') {
        return '/';
    }
    return rtrim($base, '/') . '/';
}

function credpix_save_tx(string $id, array $data): void
{
    $path = credpix_data_dir() . '/' . preg_replace('/[^a-zA-Z0-9._-]/', '', $id) . '.json';
    file_put_contents($path, json_encode($data, JSON_UNESCAPED_UNICODE));
}

function credpix_load_tx(string $id): ?array
{
    $path = credpix_data_dir() . '/' . preg_replace('/[^a-zA-Z0-9._-]/', '', $id) . '.json';
    if (!is_file($path)) {
        return null;
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : null;
}

credpix_load_env();
