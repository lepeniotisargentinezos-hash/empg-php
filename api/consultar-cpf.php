<?php
declare(strict_types=1);

/**
 * Consulta CPF no servidor (Brasil → Elaiflow).
 * Evita CORS e mantém chaves no .env — o wizard chama via credpix-boot.js.
 */
require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/security.php';
require_once dirname(__DIR__) . '/lib/consultar-cpf.php';

credpix_load_env();
credpix_cors_send();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    credpix_json(405, ['success' => false, 'error' => 'Método não permitido']);
}

if (!credpix_cpf_service_configured()) {
    credpix_json(503, [
        'success' => false,
        'error' => 'API de CPF não configurada (CPF_BRASIL_API_KEY ou CPF_API_TOKEN no .env).',
    ]);
}

credpix_rate_limit_or_429('cpf_lookup', 50, 60);

$cpf = (string) ($_GET['cpf'] ?? '');
$result = credpix_lookup_cpf_for_wizard($cpf);

credpix_json(200, $result);
