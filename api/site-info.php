<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/admin-auth.php';
require_once dirname(__DIR__) . '/lib/domains.php';

credpix_load_env();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$host = credpix_request_host();

if ($method === 'GET') {
    $authHeader = $_SERVER['HTTP_X_ANALYTICS_TOKEN'] ?? '';
    $full = credpix_admin_verify($authHeader, null);

    if ($full) {
        $cfg = credpix_domains_read();
        credpix_json(200, [
            'success' => true,
            'host' => $host,
            'default' => $cfg['default'],
            'domains' => $cfg['domains'],
            'savedAt' => $cfg['savedAt'],
        ]);
    }

    credpix_json(200, [
        'success' => true,
        'host' => $host,
        'siteInfo' => credpix_site_info_for_host($host),
    ]);
}

if ($method === 'POST') {
    $authHeader = $_SERVER['HTTP_X_ANALYTICS_TOKEN'] ?? '';
    if (!credpix_admin_verify($authHeader, null)) {
        credpix_json(401, ['success' => false, 'error' => 'Não autorizado']);
    }

    $raw = file_get_contents('php://input') ?: '';
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        credpix_json(400, ['success' => false, 'error' => 'JSON inválido']);
    }

    try {
        $saved = credpix_domains_write([
            'default' => $body['default'] ?? [],
            'domains' => $body['domains'] ?? [],
        ]);
        credpix_json(200, [
            'success' => true,
            'config' => $saved,
            'message' => 'Salvo em data/config/domains.json',
        ]);
    } catch (Throwable $e) {
        credpix_json(500, ['success' => false, 'error' => $e->getMessage() ?: 'Erro ao salvar']);
    }
}

credpix_json(405, ['success' => false, 'error' => 'Método não permitido']);
