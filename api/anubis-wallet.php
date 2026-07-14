<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/anubis.php';
credpix_load_env();

/* Auth */
$token    = $_SERVER['HTTP_X_ANALYTICS_TOKEN'] ?? '';
$expected = (string)(getenv('ANALYTICS_SECRET') ?: '');
if ($token === '' || !hash_equals($expected, $token)) {
    credpix_json(401, ['ok' => false, 'error' => 'Unauthorized']);
}

if (!credpix_anubis_configured()) {
    credpix_json(200, ['ok' => false, 'error' => 'Chaves AnubisPay não configuradas (ANUBIS_PUBLIC_KEY / ANUBIS_SECRET_KEY)']);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? 'balance';

/* ── GET balance ──────────────────────────────────────────────── */
if ($method === 'GET' && $action === 'balance') {
    try {
        $data = credpix_anubis_request('GET', '/dashboard/balance');
        credpix_json(200, ['ok' => true, 'balance' => $data]);
    } catch (Throwable $e) {
        credpix_json(200, ['ok' => false, 'error' => $e->getMessage()]);
    }
}

/* ── GET history ──────────────────────────────────────────────── */
if ($method === 'GET' && $action === 'history') {
    try {
        $page  = max(1, (int)($_GET['page'] ?? 1));
        $limit = max(1, min(50, (int)($_GET['limit'] ?? 20)));
        $data  = credpix_anubis_request('GET', '/wallet/transactions?page=' . $page . '&per_page=' . $limit . '&type=withdrawal');
        credpix_json(200, ['ok' => true, 'history' => $data]);
    } catch (Throwable $e) {
        credpix_json(200, ['ok' => false, 'error' => $e->getMessage()]);
    }
}

/* ── POST withdraw ────────────────────────────────────────────── */
if ($method === 'POST' && $action === 'withdraw') {
    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body)) {
        credpix_json(400, ['ok' => false, 'error' => 'JSON inválido']);
    }

    $amount   = (int)round((float)($body['amount_reais'] ?? 0) * 100);
    $pixKey   = trim((string)($body['pix_key'] ?? ''));
    $pixType  = trim((string)($body['pix_key_type'] ?? 'cpf'));
    $bankCode = trim((string)($body['bank_code'] ?? ''));

    if ($amount < 100) {
        credpix_json(400, ['ok' => false, 'error' => 'Valor mínimo de saque é R$ 1,00']);
    }
    if ($pixKey === '') {
        credpix_json(400, ['ok' => false, 'error' => 'Informe a chave PIX']);
    }

    try {
        $payload = [
            'amount'       => $amount,
            'pix_key'      => $pixKey,
            'pix_key_type' => $pixType,
        ];
        if ($bankCode !== '') $payload['bank_code'] = $bankCode;

        $data = credpix_anubis_request('POST', '/wallet/transaction/create/withdrawal', $payload);
        credpix_json(200, ['ok' => true, 'withdrawal' => $data]);
    } catch (Throwable $e) {
        credpix_json(200, ['ok' => false, 'error' => $e->getMessage()]);
    }
}

credpix_json(405, ['ok' => false, 'error' => 'Método/ação inválido']);
