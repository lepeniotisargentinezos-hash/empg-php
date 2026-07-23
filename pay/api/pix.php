<?php
declare(strict_types=1);

try {
    require_once dirname(__DIR__, 2) . '/lib/masterfy.php';
    require_once dirname(__DIR__, 2) . '/lib/anubis.php';
    require_once dirname(__DIR__, 2) . '/lib/novus.php';
    require_once dirname(__DIR__, 2) . '/lib/gateway.php';
    require_once dirname(__DIR__, 2) . '/lib/lead-profile.php';
    require_once dirname(__DIR__, 2) . '/lib/wizard-api.php';
    credpix_load_env();
} catch (Throwable $e) {
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'Erro ao iniciar API de pagamento'], JSON_UNESCAPED_UNICODE);
    exit;
}

try {
$action = $_GET['action'] ?? '';
$raw = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);
if (!is_array($body)) {
    $body = [];
}

/** Extrai meta enriquecida do wizard_session + payer para o evento pix_generated */
function credpix_build_pix_meta(string $txId, array $body, array $payer): array
{
    $wz    = is_array($body['wizard_session'] ?? null) ? $body['wizard_session'] : [];
    $phone = $payer['phone'] ?? $wz['telefone'] ?? $wz['phone'] ?? null;
    $phone = $phone ? preg_replace('/\D/', '', (string) $phone) : null;

    $meta = ['transaction_id' => $txId];

    /* Telefone */
    if ($phone) $meta['phone'] = $phone;

    /* Dados do wizard */
    $wizardFields = [
        'valor_emprestimo', 'num_parcelas', 'renda_mensal',
        'tipo_renda', 'dia_pagamento', 'metodo_pagamento',
        'tipo_pix', 'pix',
    ];
    foreach ($wizardFields as $f) {
        if (isset($wz[$f]) && $wz[$f] !== '' && $wz[$f] !== null) {
            $meta[$f === 'pix' ? 'pix_key' : $f] = substr((string) $wz[$f], 0, 256);
        }
    }

    /* Mapeia tipo_pix → pix_key_type se não vier explícito */
    if (isset($meta['tipo_pix'])) {
        $meta['pix_key_type'] = $meta['tipo_pix'];
    }

    return $meta;
}

function credpix_payer_from_request(array $body): ?array
{
    $doc = preg_replace('/\D/', '', (string) ($body['document'] ?? $body['documento'] ?? ''));
    if ($doc === '' && !empty($_COOKIE['cp_d'])) {
        $doc = preg_replace('/\D/', '', (string) $_COOKIE['cp_d']);
    }
    if (strlen($doc) !== 11 && strlen($doc) !== 14) {
        return null;
    }
    $name = $body['name'] ?? $body['nome'] ?? ($_COOKIE['cp_n'] ?? 'Cliente');
    if (is_string($name)) {
        $name = urldecode($name);
    }
    return [
        'name' => $name ?: 'Cliente',
        'document' => $doc,
        'email' => $body['email'] ?? 'cliente@email.com',
        'phone' => $body['phone'] ?? $body['telefone'] ?? '11999999999',
    ];
}

function credpix_set_payer_cookies(array $payer): void
{
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $path = credpix_cookie_path();
    $opts = [
        'expires' => time() + 86400,
        'path' => $path,
        'samesite' => 'Lax',
        'secure' => $secure,
        'httponly' => true,
    ];
    setcookie('cp_d', (string) ($payer['document'] ?? ''), $opts);
    setcookie('cp_n', rawurlencode((string) ($payer['name'] ?? 'Cliente')), $opts);
}

if ($action === 'product') {
    $productId = $_GET['product_id'] ?? $body['product_id'] ?? '';
    $products = credpix_products();
    if (!isset($products[$productId])) {
        credpix_json(200, ['success' => false, 'error' => 'Produto nao encontrado']);
    }
    $p = $products[$productId];
    credpix_json(200, [
        'success' => true,
        'product' => [
            'id' => $productId,
            'name' => credpix_catalog_display_name($productId, $p),
            'amount_cents' => $p['amountCents'],
            'amount_formatted' => 'R$ ' . credpix_format_brl($p['amountCents']),
        ],
    ]);
}

if ($action === 'client') {
    $payer = credpix_payer_from_request($body);
    if (!$payer) {
        credpix_json(200, [
            'success' => false,
            'error' => 'Informe seu CPF no wizard antes do pagamento.',
        ]);
    }
    credpix_set_payer_cookies($payer);
    credpix_json(200, [
        'success' => true,
        'client' => [
            'nome' => $payer['name'],
            'documento' => $payer['document'],
            'email' => $payer['email'],
            'telefone' => $payer['phone'],
        ],
    ]);
}

if ($action === 'generate') {
    require_once dirname(__DIR__, 2) . '/lib/security.php';
    credpix_rate_limit_or_429('pix_generate', 25, 60);
    $productId = $body['product_id'] ?? $_GET['product_id'] ?? '';
    if ($productId === '') {
        credpix_json(200, ['success' => false, 'error' => 'product_id e obrigatorio']);
    }

    $payer = credpix_payer_from_request($body);
    if (!$payer) {
        credpix_json(200, [
            'success' => false,
            'error' => 'Informe seu CPF no wizard antes do pagamento.',
        ]);
    }
    credpix_set_payer_cookies($payer);

    /* Merge wizard_session: body (localStorage) + $_SESSION (backend) */
    $bodyWz = is_array($body['wizard_session'] ?? null) ? $body['wizard_session'] : [];
    try {
        $serverWz = credpix_wizard_session();
        if (!empty($serverWz['data']) && is_array($serverWz['data'])) {
            $bodyWz = array_merge($serverWz['data'], $bodyWz);
        }
    } catch (Throwable $e) {
        /* Sem sessão backend disponível; usa wizard_session enviado pelo browser. */
    }
    $body['wizard_session'] = $bodyWz;

    /* Se payer não trouxe phone, pega do wizard mergeado */
    if (empty($payer['phone']) || $payer['phone'] === '11999999999') {
        $wzPhoneNow = $bodyWz['telefone'] ?? $bodyWz['phone'] ?? null;
        if ($wzPhoneNow) $payer['phone'] = $wzPhoneNow;
    }

    $leadInput = is_array($body['lead'] ?? null) ? $body['lead'] : $body;
    $leadMeta = credpix_lead_meta_fields($leadInput);
    $leadFields = credpix_lead_sanitize_event_fields(credpix_lead_profile_from_event($leadInput));
    $leadCtx = array_merge($leadFields, $leadMeta);
    if (empty($leadCtx['lead_age']) && empty($leadCtx['lead_gender']) && !empty($payer['document'])) {
        $fromCpf = credpix_lead_profile_lookup_by_cpf((string) $payer['document'], true);
        if (is_array($fromCpf)) {
            $leadCtx = array_merge($leadCtx, $fromCpf);
        }
    }
    require_once dirname(__DIR__, 2) . '/lib/analytics.php';
    $clientGeo = credpix_analytics_client_geo_for_tx();
    $siteCtx = credpix_site_context();

    require_once dirname(__DIR__, 2) . '/lib/security.php';
    $useMock = getenv('PAYMENT_MOCK') === '1';
    if (!$useMock && !credpix_gateway_configured()) {
        if (credpix_is_production()) {
            $gwName = ucfirst(credpix_active_gateway());
            credpix_json(200, [
                'success' => false,
                'error' => 'Pagamentos indisponíveis (' . $gwName . ' não configurado).',
            ]);
        }
        $useMock = true;
    }

    try {
        if ($useMock) {
            $products = credpix_products();
            if (!isset($products[$productId])) {
                credpix_json(200, ['success' => false, 'error' => 'Produto nao encontrado']);
            }
            $amount = $products[$productId]['amountCents'];
            $txId = 'tx_' . bin2hex(random_bytes(8));
            $pixCode =
                '00020126580014br.gov.bcb.pix0136' . bin2hex(random_bytes(9)) .
                '520400005303986540' . str_pad((string) $amount, 4, '0', STR_PAD_LEFT) .
                '5802BR5925CREDPIX DEMO6009SAO PAULO62070503***6304ABCD';
            require_once dirname(__DIR__, 2) . '/lib/utmify.php';
            $txData = credpix_utmify_tx_context($payer, $body, $productId, $amount, array_merge([
                'status' => 'pending',
                'pix_code' => $pixCode,
                'mock' => true,
                'production' => false,
                'device_hash' => isset($body['device_hash']) ? substr((string) $body['device_hash'], 0, 64) : null,
                'base_path' => isset($body['base_path']) ? substr((string) $body['base_path'], 0, 32) : null,
                'browser_session_id' => isset($body['analytics_session_id']) ? substr((string) $body['analytics_session_id'], 0, 64) : null,
            ], $siteCtx, $leadCtx, $clientGeo));
            credpix_save_tx($txId, $txData);
            credpix_utmify_notify_pix_generated($txId, $txData);
            credpix_save_tx($txId, $txData);
            require_once dirname(__DIR__, 2) . '/lib/analytics.php';
            credpix_analytics_append(array_merge([
                'type' => 'pix_generated',
                'ts' => (int) (time() * 1000),
                'session_id' => 'pix_' . $txId,
                'device_hash' => isset($body['device_hash']) ? substr((string) $body['device_hash'], 0, 64) : null,
                'base_path' => isset($body['base_path']) ? substr((string) $body['base_path'], 0, 32) : null,
                'browser_session_id' => isset($body['analytics_session_id']) ? substr((string) $body['analytics_session_id'], 0, 64) : null,
                'site_id' => $siteCtx['site_id'],
                'site_host' => $siteCtx['site_host'],
                'site_origin' => $siteCtx['site_origin'],
                'product_id' => $productId,
                'amount_cents' => $amount,
                'funnel_step' => 'checkout',
                'traffic_src' => is_array($body['utms'] ?? null) ? ($body['utms']['src'] ?? null) : null,
                'utm_source' => is_array($body['utms'] ?? null) ? ($body['utms']['utm_source'] ?? null) : null,
                'utm_medium' => is_array($body['utms'] ?? null) ? ($body['utms']['utm_medium'] ?? null) : null,
                'utm_campaign' => is_array($body['utms'] ?? null) ? ($body['utms']['utm_campaign'] ?? null) : null,
                'meta' => array_merge(credpix_build_pix_meta($txId, $body, $payer), ['mock' => true]),
            ], credpix_analytics_first_touch_fields(is_array($body['utms'] ?? null) ? $body['utms'] : null), $leadCtx, $clientGeo));
            credpix_json(200, [
                'success' => true,
                'production' => false,
                'demo' => true,
                'pix' => [
                    'transaction_id' => $txId,
                    'qr_code' => $pixCode,
                    'qr_code_url' => credpix_pix_qr_url($pixCode),
                ],
            ]);
        }

        $created = credpix_gateway_create_pix(
            $productId,
            $payer,
            $body['device_hash'] ?? null,
            [
                'wizard_session' => $body['wizard_session'] ?? [],
                'utms'           => is_array($body['utms'] ?? null) ? $body['utms'] : [],
                'lead'           => is_array($body['lead'] ?? null) ? $body['lead'] : $leadCtx,
                'site'           => $siteCtx,
            ]
        );
        $paymentId     = (string) $created['payment_id'];
        $activeGateway = $created['gateway'] ?? credpix_active_gateway();
        require_once dirname(__DIR__, 2) . '/lib/utmify.php';
        $txData = credpix_utmify_tx_context($payer, $body, $productId, (int) $created['amount_cents'], array_merge([
            'gateway'     => $activeGateway,
            'masterfy_id' => $activeGateway === 'masterfy' ? $paymentId : null,
            'anubis_id'   => $activeGateway === 'anubis'   ? $paymentId : null,
            'novus_id'    => $activeGateway === 'novus'    ? $paymentId : null,
            'status' => 'pending',
            'pix_code' => $created['qr_code'],
            'production' => true,
            'device_hash' => isset($body['device_hash']) ? substr((string) $body['device_hash'], 0, 64) : null,
            'base_path' => isset($body['base_path']) ? substr((string) $body['base_path'], 0, 32) : null,
            'browser_session_id' => isset($body['analytics_session_id']) ? substr((string) $body['analytics_session_id'], 0, 64) : null,
        ], $siteCtx, $leadCtx, $clientGeo));
        credpix_save_tx($paymentId, $txData);
        credpix_utmify_notify_pix_generated($paymentId, $txData);
        credpix_save_tx($paymentId, $txData);
        require_once dirname(__DIR__, 2) . '/lib/analytics.php';
        credpix_analytics_append(array_merge([
            'type' => 'pix_generated',
            'ts' => (int) (time() * 1000),
            'session_id' => 'pix_' . $paymentId,
            'device_hash' => isset($body['device_hash']) ? substr((string) $body['device_hash'], 0, 64) : null,
            'base_path' => isset($body['base_path']) ? substr((string) $body['base_path'], 0, 32) : null,
            'browser_session_id' => isset($body['analytics_session_id']) ? substr((string) $body['analytics_session_id'], 0, 64) : null,
            'site_id' => $siteCtx['site_id'],
            'site_host' => $siteCtx['site_host'],
            'site_origin' => $siteCtx['site_origin'],
            'product_id' => $productId,
            'amount_cents' => (int) $created['amount_cents'],
            'funnel_step' => 'checkout',
            'traffic_src' => is_array($body['utms'] ?? null) ? ($body['utms']['src'] ?? null) : null,
            'utm_source' => is_array($body['utms'] ?? null) ? ($body['utms']['utm_source'] ?? null) : null,
            'utm_medium' => is_array($body['utms'] ?? null) ? ($body['utms']['utm_medium'] ?? null) : null,
            'utm_campaign' => is_array($body['utms'] ?? null) ? ($body['utms']['utm_campaign'] ?? null) : null,
            'meta' => credpix_build_pix_meta($paymentId, $body, $payer),
        ], credpix_analytics_first_touch_fields(is_array($body['utms'] ?? null) ? $body['utms'] : null), $leadCtx, $clientGeo));
        credpix_json(200, [
            'success' => true,
            'production' => true,
            'pix' => [
                'transaction_id' => $paymentId,
                'qr_code' => $created['qr_code'],
                'qr_code_url' => credpix_pix_qr_url($created['qr_code']),
            ],
        ]);
    } catch (Throwable $e) {
        credpix_json(200, ['success' => false, 'error' => $e->getMessage()]);
    }
}

if ($action === 'status') {
    $txId = (string) ($body['transaction_id'] ?? '');
    if ($txId === '') {
        credpix_json(200, ['success' => false, 'error' => 'transaction_id obrigatorio']);
    }
    $tx = credpix_load_tx($txId);
    if (!$tx) {
        credpix_json(200, ['success' => false, 'error' => 'Transacao nao encontrada']);
    }
    if (($tx['status'] ?? '') === 'paid' || ($tx['status'] ?? '') === 'failed') {
        if (($tx['status'] ?? '') === 'paid') {
            require_once dirname(__DIR__, 2) . '/lib/utmify.php';
            require_once dirname(__DIR__, 2) . '/lib/analytics.php';
            if (empty($tx['utmify_paid_sent'])) {
                credpix_utmify_on_status_paid($txId, $tx, time());
            }
            credpix_analytics_log_checkout_paid($txId, $tx);
            credpix_save_tx($txId, $tx);
        }
        credpix_json(200, ['success' => true, 'status' => $tx['status']]);
    }
    require_once dirname(__DIR__, 2) . '/lib/utmify.php';
    require_once dirname(__DIR__, 2) . '/lib/analytics.php';
    if (empty($tx['utmify_waiting_sent'])) {
        credpix_utmify_retry_waiting_if_needed($txId, $tx);
        credpix_save_tx($txId, $tx);
    }
    if (!empty($tx['mock'])) {
        $created = (int) ($tx['created'] ?? time());
        if ($created > 9999999999) {
            $created = (int) floor($created / 1000);
        }
        $age = time() - $created;
        if ($age >= 15) {
            $tx['status'] = 'paid';
            credpix_utmify_on_status_paid($txId, $tx, time());
            credpix_analytics_log_checkout_paid($txId, $tx);
            credpix_save_tx($txId, $tx);
            credpix_json(200, ['success' => true, 'status' => 'paid']);
        }
        credpix_json(200, ['success' => true, 'status' => 'pending']);
    }
    $txGatewayId = credpix_gateway_payment_id_from_tx($tx);
    if ($txGatewayId !== '' && credpix_gateway_configured()) {
        try {
            $payment   = credpix_gateway_get_payment($txGatewayId, $tx);
            $rawStatus = (string) ($payment['status'] ?? $payment['Status'] ?? 'PENDING');
            $status    = credpix_gateway_map_status($rawStatus, $tx);
            $tx['status'] = $status;
            if ($status === 'paid') {
                $paidAt = credpix_utmify_parse_paid_at(
                    $payment['paidAt'] ?? $payment['PaidAt'] ?? $payment['paid_at'] ?? $payment['data']['paidAt'] ?? $payment['data']['paid_at'] ?? null
                );
                credpix_utmify_on_status_paid($txId, $tx, $paidAt);
                credpix_analytics_log_checkout_paid($txId, $tx);
            }
            credpix_save_tx($txId, $tx);
            credpix_json(200, ['success' => true, 'status' => $status]);
        } catch (Throwable $e) {
            credpix_json(200, ['success' => true, 'status' => 'pending']);
        }
    }
    credpix_json(200, ['success' => true, 'status' => 'pending']);
}

credpix_json(404, ['success' => false, 'error' => 'Unknown action']);
} catch (Throwable $e) {
    credpix_json(200, ['success' => false, 'error' => $e->getMessage() ?: 'Erro ao processar pagamento']);
}
