<?php
declare(strict_types=1);

require_once __DIR__ . '/consultar-cpf.php';

function credpix_wizard_cookie_path(): string
{
    return credpix_cookie_path();
}

function credpix_wizard_base_path(): string
{
    credpix_load_env();
    $base = trim((string) (getenv('BASE_PATH') ?: ''));
    if ($base === '' || $base === '/') {
        return '';
    }
    return rtrim($base, '/');
}

function credpix_wizard_with_base(string $path): string
{
    $base = credpix_wizard_base_path();
    if ($path === '' || $path[0] !== '/') {
        $path = '/' . ltrim($path, '/');
    }
    return ($base ?: '') . $path;
}

function credpix_wizard_session_start(): void
{
    if (session_status() !== PHP_SESSION_NONE) {
        return;
    }

    $params = session_get_cookie_params();
    session_set_cookie_params([
        'lifetime' => $params['lifetime'] ?: 0,
        'path' => credpix_wizard_cookie_path(),
        'domain' => $params['domain'] ?: '',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https'),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();

    if (!isset($_SESSION['credpix_wizard']) || !is_array($_SESSION['credpix_wizard'])) {
        $_SESSION['credpix_wizard'] = [
            'csrf' => bin2hex(random_bytes(16)),
            'data' => [],
            'payer' => null,
        ];
    }
}

/** @return array{csrf: string, data: array<string, mixed>, payer: ?array<string, mixed>} */
function credpix_wizard_session(): array
{
    credpix_wizard_session_start();
    return $_SESSION['credpix_wizard'];
}

function credpix_wizard_set_lead_cookies(string $nome, string $cpfDigits): void
{
    $path = credpix_wizard_cookie_path();
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');

    setcookie('cp_d', $cpfDigits, [
        'expires' => time() + 86400,
        'path' => $path,
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    setcookie('cp_n', $nome, [
        'expires' => time() + 86400,
        'path' => $path,
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function credpix_wizard_read_json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function credpix_wizard_csrf_valid(array $body): bool
{
    $session = credpix_wizard_session();
    $token = (string) ($body['csrf_token'] ?? '');
    return $token !== '' && hash_equals((string) $session['csrf'], $token);
}

function credpix_wizard_handle(string $subPath): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    require_once __DIR__ . '/security.php';
    credpix_cors_send();
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $subPath = trim($subPath, '/');

    if ($method === 'POST' && $subPath === 'session/init') {
        $session = credpix_wizard_session();
        credpix_json(200, [
            'success' => true,
            'csrf_token' => $session['csrf'],
            'primeiraparcela' => 'Novembro de 2026',
        ]);
    }

    $body = credpix_wizard_read_json_body();

    if ($method === 'POST' && $subPath === 'cpf') {
        credpix_rate_limit_or_429('wizard_cpf', 40, 60);
        if (!credpix_wizard_csrf_valid($body)) {
            credpix_json(200, ['success' => false, 'error' => 'Token inválido']);
        }
        $cpfRaw = (string) ($body['cpf'] ?? '');
        $cpfResult = credpix_consultar_cpf($cpfRaw);
        $result = credpix_cpf_to_wizard_response($cpfResult);
        if (!empty($result['success']) && !empty($result['data'])) {
            $digits = preg_replace('/\D/', '', $cpfRaw) ?: '';
            credpix_wizard_session_start();
            $_SESSION['credpix_wizard']['data']['nome'] = $result['data']['nome'];
            $_SESSION['credpix_wizard']['data']['cpf'] = $digits;
            $_SESSION['credpix_wizard']['payer'] = [
                'name' => $result['data']['nome'],
                'document' => $digits,
            ];
            credpix_wizard_set_lead_cookies((string) $result['data']['nome'], $digits);
            if (!empty($cpfResult['ok']) && !empty($cpfResult['data'])) {
                require_once __DIR__ . '/analytics.php';
                $utms = is_array($body['utms'] ?? null) ? $body['utms'] : [];
                $profile = credpix_lead_profile_from_nascimento(
                    (string) ($cpfResult['data']['nascimento'] ?? ''),
                    (string) ($cpfResult['data']['sexo'] ?? '')
                );
                credpix_analytics_append(array_merge([
                    'type' => 'lead_profile',
                    'ts' => (int) (time() * 1000),
                    'session_id' => substr((string) ($body['session_id'] ?? 'anon'), 0, 64),
                    'device_hash' => isset($body['device_hash']) ? substr((string) $body['device_hash'], 0, 64) : null,
                    'funnel_step' => 'wizard',
                    'traffic_src' => isset($utms['src']) ? (string) $utms['src'] : null,
                    'utm_source' => isset($utms['utm_source']) ? (string) $utms['utm_source'] : null,
                    'utm_medium' => isset($utms['utm_medium']) ? (string) $utms['utm_medium'] : null,
                    'utm_campaign' => isset($utms['utm_campaign']) ? (string) $utms['utm_campaign'] : null,
                ], credpix_lead_sanitize_event_fields($profile)));
            }
        }
        credpix_json(200, $result);
    }

    if ($method === 'POST' && $subPath === 'session/set') {
        if (!credpix_wizard_csrf_valid($body)) {
            credpix_json(200, ['success' => false, 'error' => 'Token inválido']);
        }
        if (!empty($body['name'])) {
            credpix_wizard_session_start();
            $_SESSION['credpix_wizard']['data'][(string) $body['name']] = $body['value'] ?? null;
        }
        credpix_json(200, ['success' => true]);
    }

    if ($method === 'POST' && $subPath === 'session/checkout') {
        if (!credpix_wizard_csrf_valid($body)) {
            credpix_json(200, ['success' => false, 'error' => 'Token inválido']);
        }
        credpix_json(200, [
            'success' => true,
            'checkout_url' => credpix_wizard_with_base('/pay/checkout.php?produto=prod_698630abcbdde&modelo=2'),
        ]);
    }

    credpix_json(404, ['success' => false, 'error' => 'Not found']);
}
