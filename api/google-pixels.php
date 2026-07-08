<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/admin-auth.php';
require_once dirname(__DIR__) . '/lib/google-pixels.php';

credpix_load_env();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $config = credpix_google_pixels_read();
    credpix_json(200, [
        'success' => true,
        'googleAds' => $config['googleAds'],
        'ga4' => $config['ga4'],
        'savedAt' => $config['savedAt'],
        'fromDefaults' => $config['fromDefaults'],
        'sendTo' => credpix_google_pixels_send_to_list($config),
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
        $saved = credpix_google_pixels_write([
            'googleAds' => $body['googleAds'] ?? [],
            'ga4' => $body['ga4'] ?? [],
        ]);
        credpix_json(200, [
            'success' => true,
            'config' => $saved,
            'message' => 'Salvo em config/google-pixels.json',
        ]);
    } catch (Throwable $e) {
        credpix_json(500, ['success' => false, 'error' => $e->getMessage() ?: 'Erro ao salvar']);
    }
}

credpix_json(405, ['success' => false, 'error' => 'Método não permitido']);
