<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/consultar-cpf.php';

credpix_load_env();

header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-store');

$token = credpix_cpf_token();
$configured = credpix_cpf_configured();
$brasilBase = credpix_cpf_brasil_api_base_url();
$brasilConfigured = credpix_cpf_brasil_configured();
$serviceConfigured = credpix_cpf_service_configured();
$clientDirect = getenv('CPF_CLIENT_DIRECT') === '1' && $serviceConfigured;

echo 'window.CREDPIX_CPF_DIRECT=' . json_encode($clientDirect) . ";\n";
echo 'window.CREDPIX_CPF_SERVER=' . json_encode($clientDirect && $serviceConfigured) . ";\n";
echo 'window.CREDPIX_CPF_BRASIL_BASE=' . json_encode($clientDirect && $brasilBase ? $brasilBase : '') . ";\n";
echo 'window.CREDPIX_CPF_TOKEN=' . json_encode($clientDirect && $configured ? $token : '') . ";\n";
