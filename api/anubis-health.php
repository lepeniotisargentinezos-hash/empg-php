<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/anubis.php';
credpix_load_env();

/* Auth */
$token    = $_SERVER['HTTP_X_ANALYTICS_TOKEN'] ?? '';
$expected = (string) (getenv('ANALYTICS_SECRET') ?: '');
if ($token === '' || !hash_equals($expected, $token)) {
    credpix_json(401, ['ok' => false, 'error' => 'Unauthorized']);
}

$t0 = microtime(true);

/* 1. Chaves configuradas? */
if (!credpix_anubis_configured()) {
    credpix_json(200, [
        'ok'          => false,
        'gateway'     => 'anubis',
        'configured'  => false,
        'api_status'  => null,
        'latency_ms'  => null,
        'error'       => 'ANUBIS_PUBLIC_KEY ou ANUBIS_SECRET_KEY não configurados',
    ]);
}

/* 2. Ping da API — busca uma transação inexistente: 404 = auth OK, 401 = chaves erradas */
$url  = 'https://api.anubispay.com/v1/payment-transaction/info/__health_check__';
$auth = base64_encode(credpix_anubis_public_key() . ':' . credpix_anubis_secret_key());
$ch   = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_CUSTOMREQUEST  => 'GET',
    CURLOPT_HTTPHEADER     => [
        'Authorization: Basic ' . $auth,
        'Accept: application/json',
    ],
]);
$raw       = curl_exec($ch);
$httpCode  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr   = curl_error($ch);
curl_close($ch);

$latency = (int) round((microtime(true) - $t0) * 1000);

if ($curlErr !== '') {
    credpix_json(200, [
        'ok'         => false,
        'gateway'    => 'anubis',
        'configured' => true,
        'api_status' => 0,
        'latency_ms' => $latency,
        'error'      => 'cURL: ' . $curlErr,
    ]);
}

/* 404 = chaves válidas, transação não encontrada (esperado) */
/* 401/403 = chaves inválidas */
/* 200 = encontrou algo (não esperado mas OK) */
$authOk = in_array($httpCode, [200, 404], true);

credpix_json(200, [
    'ok'          => $authOk,
    'gateway'     => 'anubis',
    'configured'  => true,
    'api_status'  => $httpCode,
    'api_reachable' => true,
    'auth_ok'     => $authOk,
    'latency_ms'  => $latency,
    'error'       => $authOk ? null : 'Auth falhou (HTTP ' . $httpCode . ')',
]);
