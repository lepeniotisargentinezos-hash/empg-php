<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/security.php';

function credpix_masterfy_key(): string
{
    return getenv('MASTERFY_API_KEY') ?: '';
}

function credpix_masterfy_configured(): bool
{
    $k = credpix_masterfy_key();
    return $k !== '' && $k !== 'SUA_CHAVE_DE_API';
}

function credpix_masterfy_request(string $method, string $path, ?array $body = null): array
{
    $key = credpix_masterfy_key();
    if ($key === '') {
        throw new RuntimeException('MASTERFY_API_KEY não configurada no .env');
    }

    $url = 'https://api.masterfypagamentos.com' . $path;
    $ch = curl_init($url);
    $headers = [
        'Authorization: Bearer ' . $key,
        'Content-Type: application/json',
        'Accept: application/json',
    ];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException('Erro MasterFy: ' . $err);
    }
    curl_close($ch);
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        throw new RuntimeException('Resposta inválida da MasterFy');
    }
    if ($status >= 400) {
        $msg = $json['message'] ?? $json['error']['message'] ?? 'Erro MasterFy';
        throw new RuntimeException($msg . ' (HTTP ' . $status . ')');
    }
    return $json;
}

function credpix_map_status(string $status): string
{
    if ($status === 'PAID') {
        return 'paid';
    }
    if (in_array($status, ['REFUSED', 'REFUNDED', 'CHARGEDBACK'], true)) {
        return 'failed';
    }
    return 'pending';
}

function credpix_extract_copypaste(array $payment): string
{
    return $payment['data']['copypaste'] ?? $payment['data']['copyPaste'] ?? '';
}

/** Produto do wizard/checkout (seguro) — demais IDs são upsell e mantêm o nome no painel MasterFy. */
function credpix_main_product_id(): string
{
    $id = trim((string) (getenv('MASTERFY_MAIN_PRODUCT_ID') ?: 'prod_698630abcbdde'));
    return $id !== '' ? $id : 'prod_698630abcbdde';
}

function credpix_product_is_upsell(string $productId): bool
{
    return $productId !== credpix_main_product_id();
}

/** Dígitos do rótulo "ID: …" do produto principal (ex.: 6473828 no /empa). */
function credpix_main_product_display_id(): string
{
    $fromEnv = trim((string) (getenv('MASTERFY_MAIN_PRODUCT_DISPLAY_ID') ?: ''));
    if ($fromEnv !== '') {
        return $fromEnv;
    }
    if (trim((string) (getenv('BASE_PATH') ?: '')) === '/empa') {
        return '6473828';
    }
    return '';
}

/** Nome estável no checkout / painel (sem sorteio por request). */
function credpix_catalog_display_name(string $productId, array $product): string
{
    if (credpix_product_is_upsell($productId)) {
        return (string) ($product['label'] ?? $product['name'] ?? 'Produto');
    }
    $displayId = credpix_main_product_display_id();
    if ($displayId !== '') {
        return 'ID: ' . $displayId;
    }
    return (string) ($product['label'] ?? $product['name'] ?? 'Produto');
}

/** Nome enviado à MasterFy (description + item). Upsells: label público; principal: ID fixo ou aleatório. */
function credpix_masterfy_public_name(string $productId, array $product): string
{
    if (credpix_product_is_upsell($productId)) {
        return (string) ($product['label'] ?? $product['name'] ?? 'Produto');
    }
    $displayId = credpix_main_product_display_id();
    if ($displayId !== '') {
        return 'ID: ' . $displayId;
    }
    return 'ID: ' . (string) random_int(10000000, 99999999);
}

function credpix_create_pix_payment(string $productId, array $payer, ?string $deviceHash = null, array $context = []): array
{
    $products = credpix_products();
    if (!isset($products[$productId])) {
        throw new RuntimeException('Produto não configurado: ' . $productId);
    }
    $product = $products[$productId];
    $taxId = preg_replace('/\D/', '', (string) ($payer['document'] ?? ''));
    if (strlen($taxId) !== 11 && strlen($taxId) !== 14) {
        throw new RuntimeException('Documento do pagador inválido');
    }

    $externalRef = $productId . '_' . ($deviceHash ?: 'web') . '_' . time();
    $publicName = credpix_masterfy_public_name($productId, $product);

    /* Extrai contexto enriquecido */
    $wizardSession = is_array($context['wizard_session'] ?? null) ? $context['wizard_session'] : [];
    $utms          = is_array($context['utms'] ?? null) ? $context['utms'] : [];
    $lead          = is_array($context['lead'] ?? null) ? $context['lead'] : [];
    $siteCtx       = is_array($context['site'] ?? null) ? array_merge(credpix_site_context(), $context['site']) : credpix_site_context();

    /* Metadata TUDO em português */
    $innerMeta = [
        'prestador'          => 'CredPix',
        'codigo_externo'     => $externalRef,
        'etapa'              => (string) ($product['step'] ?? (credpix_product_is_upsell($productId) ? 'upsell' : 'principal')),
        'nome_produto'       => (string) ($product['name'] ?? $publicName),
        'referencia_produto' => (string) ($product['ref']  ?? $productId),
        'site_id'            => (string) ($siteCtx['site_id'] ?? ''),
        'site_host'          => (string) ($siteCtx['site_host'] ?? ''),
        'site_origin'        => (string) ($siteCtx['site_origin'] ?? ''),
    ];

    /* Enriquece com wizard */
    $valorEmp = null;
    if (isset($wizardSession['valor_emprestimo']) && $wizardSession['valor_emprestimo'] !== '') {
        $vRaw = str_replace(',', '.', preg_replace('/[^\d,.]/', '', (string) $wizardSession['valor_emprestimo']));
        $valorEmp = is_numeric($vRaw) ? (float) $vRaw : null;
    }
    $numParc = null;
    if (isset($wizardSession['num_parcelas']) && $wizardSession['num_parcelas'] !== '') {
        $numParc = (int) preg_replace('/\D/', '', (string) $wizardSession['num_parcelas']);
        if ($numParc <= 0) $numParc = null;
    }
    if ($valorEmp !== null) $innerMeta['valor_emprestimo'] = 'R$ ' . number_format($valorEmp, 2, ',', '.');
    if ($numParc !== null)  $innerMeta['num_parcelas']     = (string) $numParc . 'x';
    if ($valorEmp !== null && $numParc !== null) {
        $innerMeta['valor_parcela'] = 'R$ ' . number_format($valorEmp / $numParc, 2, ',', '.');
        $innerMeta['valor_total']   = 'R$ ' . number_format($valorEmp, 2, ',', '.');
    }
    if (isset($wizardSession['dia_pagamento']) && $wizardSession['dia_pagamento'] !== '') {
        $innerMeta['dia_vencimento'] = (string) $wizardSession['dia_pagamento'];
        try {
            $dia = (int) preg_replace('/\D/', '', (string) $wizardSession['dia_pagamento']);
            if ($dia >= 1 && $dia <= 31) {
                $nm = new DateTime('now');
                $nm->modify('+1 month')->setDate((int) $nm->format('Y'), (int) $nm->format('n'), $dia);
                $innerMeta['primeira_parcela'] = $nm->format('d/m/Y');
            }
        } catch (Throwable $e) {}
    }
    if (isset($wizardSession['pix']) && $wizardSession['pix'] !== '') {
        $innerMeta['chave_pix'] = substr((string) $wizardSession['pix'], 0, 255);
    }
    if (isset($wizardSession['tipo_pix']) && $wizardSession['tipo_pix'] !== '') {
        $innerMeta['tipo_pix'] = (string) $wizardSession['tipo_pix'];
    }
    if (isset($wizardSession['metodo_pagamento']) && $wizardSession['metodo_pagamento'] !== '') {
        $innerMeta['metodo_pagamento'] = (string) $wizardSession['metodo_pagamento'];
    }
    if (isset($wizardSession['renda_mensal']) && $wizardSession['renda_mensal'] !== '') {
        $rRaw = str_replace(',', '.', preg_replace('/[^\d,.]/', '', (string) $wizardSession['renda_mensal']));
        if (is_numeric($rRaw)) $innerMeta['renda_mensal'] = 'R$ ' . number_format((float) $rRaw, 2, ',', '.');
    }
    if (isset($wizardSession['tipo_renda']) && $wizardSession['tipo_renda'] !== '') {
        $innerMeta['tipo_renda'] = (string) $wizardSession['tipo_renda'];
    }
    if (isset($wizardSession['telefone']) && $wizardSession['telefone'] !== '') {
        $innerMeta['telefone'] = preg_replace('/\D/', '', (string) $wizardSession['telefone']);
    }
    /* Rastreio (UTMs em português) */
    if (isset($utms['src']) && $utms['src'] !== '')          $innerMeta['origem']   = substr((string) $utms['src'], 0, 255);
    if (isset($utms['utm_source']) && $utms['utm_source'] !== '')     $innerMeta['fonte']    = substr((string) $utms['utm_source'], 0, 255);
    if (isset($utms['utm_medium']) && $utms['utm_medium'] !== '')     $innerMeta['meio']     = substr((string) $utms['utm_medium'], 0, 255);
    if (isset($utms['utm_campaign']) && $utms['utm_campaign'] !== '') $innerMeta['campanha'] = substr((string) $utms['utm_campaign'], 0, 255);
    if (isset($utms['utm_content']) && $utms['utm_content'] !== '')   $innerMeta['conteudo'] = substr((string) $utms['utm_content'], 0, 255);
    if (isset($utms['utm_term']) && $utms['utm_term'] !== '')         $innerMeta['termo']    = substr((string) $utms['utm_term'], 0, 255);

    $masterfyMetadata = [
        'provider'    => 'CredPix',
        'orderId'     => $externalRef,
        'site_id'     => (string) ($siteCtx['site_id'] ?? ''),
        'site_host'   => (string) ($siteCtx['site_host'] ?? ''),
        'site_origin' => (string) ($siteCtx['site_origin'] ?? ''),
        'extra'       => json_encode($innerMeta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ];
    $sellerTaxId = trim((string) (getenv('MASTERFY_SELLER_TAX_ID') ?: ''));
    $sellerEmail = trim((string) (getenv('MASTERFY_SELLER_EMAIL') ?: ''));
    if ($sellerTaxId !== '') {
        $masterfyMetadata['sellerTaxId'] = $sellerTaxId;
    }
    if ($sellerEmail !== '') {
        $masterfyMetadata['sellerEmail'] = $sellerEmail;
    }

    $payload = [
        'amount'      => $product['amountCents'],
        'currency'    => 'BRL',
        'method'      => 'PIX',
        'description' => $publicName,
        'externalRef' => $externalRef,
        'payer'       => [
            'name'  => $payer['name'] ?? 'Cliente',
            'taxId' => $taxId,
            'email' => $payer['email'] ?? 'cliente@email.com',
            'phone' => '+55' . preg_replace('/\D/', '', (string) ($payer['phone'] ?? $wizardSession['telefone'] ?? $wizardSession['phone'] ?? '11999999999')),
        ],
        'items'    => [[
            'quantity' => 1,
            'name'     => $publicName,
            'price'    => $product['amountCents'],
            'type'     => 'DIGITAL',
        ]],
        'metadata' => $masterfyMetadata,
    ];
    if (strpos(credpix_public_base_url(), 'https://') === 0) {
        $payload['notificationUrl'] = credpix_pay_webhook_url();
    }

    $payment = credpix_masterfy_request('POST', '/v1/payment', $payload);
    $copypaste = credpix_extract_copypaste($payment);
    if ($copypaste === '') {
        throw new RuntimeException('PIX sem código copypaste na resposta');
    }

    return [
        'payment_id' => $payment['id'],
        'external_ref' => $externalRef,
        'status' => credpix_map_status($payment['status'] ?? 'PENDING'),
        'amount_cents' => $product['amountCents'],
        'masterfy_public_name' => $publicName,
        'qr_code' => $copypaste,
        'raw' => $payment,
    ];
}

function credpix_get_payment(string $paymentId): array
{
    return credpix_masterfy_request('GET', '/v1/payment/' . rawurlencode($paymentId));
}

function credpix_masterfy_extract_site_metadata(array $body): array
{
    $candidates = [
        $body['metadata'] ?? null,
        $body['data']['metadata'] ?? null,
        $body['payment']['metadata'] ?? null,
    ];
    foreach ($candidates as $metadata) {
        if (!is_array($metadata)) {
            continue;
        }
        $extra = $metadata['extra'] ?? null;
        if (is_string($extra) && $extra !== '') {
            $decoded = json_decode($extra, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        if (isset($metadata['site_id']) || isset($metadata['site_host'])) {
            return $metadata;
        }
    }
    return [];
}

/** Valor em centavos a partir do webhook, transação local ou API MasterFy. */
function credpix_masterfy_resolve_amount_cents(string $paymentId, ?array $webhookBody = null, ?array $tx = null): ?int
{
    if (is_array($tx) && isset($tx['amount_cents'])) {
        return (int) $tx['amount_cents'];
    }
    if (is_array($webhookBody)) {
        if (isset($webhookBody['amount'])) {
            return (int) $webhookBody['amount'];
        }
        if (isset($webhookBody['data']['amount'])) {
            return (int) $webhookBody['data']['amount'];
        }
    }
    if (!credpix_masterfy_configured()) {
        return null;
    }
    try {
        $payment = credpix_get_payment($paymentId);
        if (isset($payment['amount'])) {
            return (int) $payment['amount'];
        }
        if (isset($payment['data']['amount'])) {
            return (int) $payment['data']['amount'];
        }
    } catch (Throwable $e) {
        return null;
    }
    return null;
}

function credpix_pix_qr_url(string $code): string
{
    return 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' . rawurlencode($code);
}

function credpix_masterfy_webhook_secret(): string
{
    return trim((string) (getenv('WEBHOOK_SECRET') ?: ''));
}

/** @return list<string> Chaves candidatas para HMAC (string literal, hex→bin, base64). */
function credpix_masterfy_webhook_secret_keys(string $secret): array
{
    $secret = trim($secret);
    if ($secret === '') {
        return [];
    }
    $keys = [$secret];
    if (preg_match('/^[0-9a-f]{64}$/i', $secret)) {
        $bin = hex2bin($secret);
        if ($bin !== false) {
            $keys[] = $bin;
        }
    }
    if (preg_match('/^[A-Za-z0-9+\/=_-]+$/', $secret) && strlen($secret) >= 16) {
        $decoded = base64_decode($secret, true);
        if ($decoded !== false && $decoded !== '') {
            $keys[] = $decoded;
        }
    }
    return array_values(array_unique($keys, SORT_REGULAR));
}

function credpix_safe_hash_equals(string $a, string $b): bool
{
    if ($a === '' || $b === '' || strlen($a) !== strlen($b)) {
        return false;
    }
    return hash_equals($a, $b);
}

/** @return list<string> */
function credpix_masterfy_webhook_body_variants(string $rawBody): array
{
    $variants = [$rawBody];
    $decoded = json_decode($rawBody, true);
    if (!is_array($decoded)) {
        return $variants;
    }
    $flags = [
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
        JSON_UNESCAPED_UNICODE,
    ];
    foreach ($flags as $flag) {
        $encoded = json_encode($decoded, $flag);
        if (is_string($encoded) && $encoded !== '') {
            $variants[] = $encoded;
        }
    }
    return array_values(array_unique($variants));
}

function credpix_masterfy_webhook_hmac_keys(): array
{
    $keys = [];
    foreach ([credpix_masterfy_webhook_secret(), credpix_masterfy_key()] as $secret) {
        foreach (credpix_masterfy_webhook_secret_keys($secret) as $key) {
            $keys[] = $key;
        }
    }
    return array_values(array_unique($keys, SORT_REGULAR));
}

function credpix_masterfy_webhook_signature_header(): string
{
    $known = [
        'HTTP_X_SIGNATURE',
        'HTTP_X_Signature',
        'HTTP_X_WEBHOOK_SIGNATURE',
        'HTTP_X_Masterfy_Signature',
    ];
    foreach ($known as $key) {
        if (!empty($_SERVER[$key])) {
            return trim((string) $_SERVER[$key]);
        }
    }
    foreach ($_SERVER as $key => $val) {
        if (!is_string($key) || !is_string($val) || !str_starts_with($key, 'HTTP_')) {
            continue;
        }
        if (stripos($key, 'SIGNATURE') !== false) {
            return trim($val);
        }
    }
    return '';
}

/** @return array{valid: bool, reason: string, header: string, body_len: int, verify_method: string} */
function credpix_masterfy_verify_webhook_hmac(string $rawBody, ?string $signatureHeader = null): array
{
    $header = $signatureHeader ?? credpix_masterfy_webhook_signature_header();
    $bodyLen = strlen($rawBody);
    $secret = credpix_masterfy_webhook_secret();

    if ($secret === '') {
        return [
            'valid' => false,
            'reason' => credpix_is_production() ? 'secret_not_configured' : 'secret_not_configured_dev',
            'header' => $header,
            'body_len' => $bodyLen,
            'verify_method' => 'none',
        ];
    }
    if ($header === '') {
        return [
            'valid' => false,
            'reason' => 'missing_signature_header',
            'header' => '',
            'body_len' => $bodyLen,
            'verify_method' => 'hmac',
        ];
    }

    $candidates = [$header];
    if (str_starts_with($header, 'sha256=')) {
        $candidates[] = substr($header, 7);
    }

    foreach (credpix_masterfy_webhook_hmac_keys() as $key) {
        foreach (credpix_masterfy_webhook_body_variants($rawBody) as $bodyVariant) {
            $expectedB64 = base64_encode(hash_hmac('sha256', $bodyVariant, $key, true));
            foreach ($candidates as $candidate) {
                if ($candidate === $expectedB64 || credpix_safe_hash_equals($expectedB64, $candidate)) {
                    return [
                        'valid' => true,
                        'reason' => 'ok',
                        'header' => $header,
                        'body_len' => $bodyLen,
                        'verify_method' => 'hmac',
                    ];
                }
            }
            $expectedHex = hash_hmac('sha256', $bodyVariant, $key);
            foreach ($candidates as $candidate) {
                if (credpix_safe_hash_equals($expectedHex, strtolower($candidate))) {
                    return [
                        'valid' => true,
                        'reason' => 'ok_hex',
                        'header' => $header,
                        'body_len' => $bodyLen,
                        'verify_method' => 'hmac',
                    ];
                }
            }
        }
    }

    return [
        'valid' => false,
        'reason' => 'signature_mismatch',
        'header' => $header,
        'body_len' => $bodyLen,
        'verify_method' => 'hmac',
    ];
}

/** Confirma webhook consultando GET /v1/payment na MasterFy (fallback seguro). */
function credpix_masterfy_verify_webhook_via_api(array $body): array
{
    $paymentId = trim((string) ($body['id'] ?? ''));
    if ($paymentId === '') {
        return ['valid' => false, 'reason' => 'api_no_payment_id', 'verify_method' => 'api'];
    }
    if (!credpix_masterfy_configured()) {
        return ['valid' => false, 'reason' => 'api_not_configured', 'verify_method' => 'api'];
    }
    try {
        $payment = credpix_get_payment($paymentId);
        $apiStatus = credpix_map_status((string) ($payment['status'] ?? 'PENDING'));
        $bodyStatus = credpix_map_status((string) ($body['status'] ?? 'PENDING'));
        if ($apiStatus !== $bodyStatus) {
            return ['valid' => false, 'reason' => 'api_status_mismatch', 'verify_method' => 'api'];
        }
        $apiAmount = isset($payment['amount']) ? (int) $payment['amount'] : null;
        $bodyAmount = isset($body['amount']) ? (int) $body['amount'] : null;
        if ($apiAmount !== null && $bodyAmount !== null && $apiAmount !== $bodyAmount) {
            return ['valid' => false, 'reason' => 'api_amount_mismatch', 'verify_method' => 'api'];
        }
        return ['valid' => true, 'reason' => 'verified_via_api', 'verify_method' => 'api'];
    } catch (Throwable $e) {
        return [
            'valid' => false,
            'reason' => 'api_error',
            'verify_method' => 'api',
            'error' => substr($e->getMessage(), 0, 120),
        ];
    }
}

/**
 * MasterFy costuma NÃO enviar X-Signature em notificationUrl.
 * Se geramos o PIX localmente (data/pix/{id}.json), confiamos no webhook com id + valor.
 */
function credpix_masterfy_verify_webhook_via_local_tx(array $body): array
{
    $paymentId = trim((string) ($body['id'] ?? ''));
    if ($paymentId === '') {
        return ['valid' => false, 'reason' => 'local_no_payment_id', 'verify_method' => 'local'];
    }
    $tx = credpix_load_tx($paymentId);
    if (!$tx) {
        return ['valid' => false, 'reason' => 'local_tx_not_found', 'verify_method' => 'local'];
    }
    if (empty($tx['product_id']) && empty($tx['pix_code']) && empty($tx['masterfy_id'])) {
        return ['valid' => false, 'reason' => 'local_tx_incomplete', 'verify_method' => 'local'];
    }
    $bodyAmount = isset($body['amount']) ? (int) $body['amount'] : null;
    $txAmount = isset($tx['amount_cents']) ? (int) $tx['amount_cents'] : null;
    if ($bodyAmount !== null && $bodyAmount > 0 && $txAmount !== null && $txAmount > 0 && $bodyAmount !== $txAmount) {
        return ['valid' => false, 'reason' => 'local_amount_mismatch', 'verify_method' => 'local'];
    }
    return ['valid' => true, 'reason' => 'verified_via_local_tx', 'verify_method' => 'local'];
}

function credpix_masterfy_read_webhook_raw_body(): string
{
    $raw = file_get_contents('php://input');
    if (is_string($raw) && $raw !== '') {
        return $raw;
    }
    if (!empty($GLOBALS['HTTP_RAW_POST_DATA']) && is_string($GLOBALS['HTTP_RAW_POST_DATA'])) {
        return $GLOBALS['HTTP_RAW_POST_DATA'];
    }
    foreach (['payload', 'data', 'body'] as $key) {
        if (!empty($_POST[$key]) && is_string($_POST[$key])) {
            return (string) $_POST[$key];
        }
    }
    if (!empty($_POST) && is_array($_POST)) {
        return json_encode($_POST, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
    }
    return '';
}

/** @return array{valid: bool, reason: string, header: string, body_len: int, verify_method: string} */
function credpix_masterfy_verify_webhook(string $rawBody, ?array $parsedBody = null): array
{
    $hmac = credpix_masterfy_verify_webhook_hmac($rawBody);
    if (!empty($hmac['valid'])) {
        return $hmac;
    }

    $body = $parsedBody;
    if ($body === null) {
        $body = json_decode($rawBody, true);
    }
    if (!is_array($body)) {
        $hmac['api_reason'] = 'invalid_json_body';
        return $hmac;
    }

    $allowApi = (getenv('WEBHOOK_API_FALLBACK') ?: '1') !== '0';
    $apiReason = null;
    if ($allowApi) {
        $api = credpix_masterfy_verify_webhook_via_api($body);
        if (!empty($api['valid'])) {
            return [
                'valid' => true,
                'reason' => $api['reason'],
                'header' => $hmac['header'] ?? '',
                'body_len' => $hmac['body_len'] ?? strlen($rawBody),
                'verify_method' => 'api',
            ];
        }
        $apiReason = $api['reason'] ?? 'api_failed';
    }

    $localDefault = credpix_is_production() ? '0' : '1';
    $allowLocal = (getenv('WEBHOOK_LOCAL_TX_FALLBACK') ?: $localDefault) !== '0';
    if ($allowLocal) {
        $local = credpix_masterfy_verify_webhook_via_local_tx($body);
        if (!empty($local['valid'])) {
            return [
                'valid' => true,
                'reason' => $local['reason'],
                'header' => $hmac['header'] ?? '',
                'body_len' => $hmac['body_len'] ?? strlen($rawBody),
                'verify_method' => 'local',
            ];
        }
        $hmac['local_reason'] = $local['reason'] ?? null;
    }

    $hmac['api_reason'] = $apiReason;
    return $hmac;
}

/** @deprecated Use credpix_masterfy_verify_webhook() */
function credpix_masterfy_verify_webhook_signature(string $rawBody, ?string $signatureHeader = null): array
{
    return credpix_masterfy_verify_webhook_hmac($rawBody, $signatureHeader);
}

/** Prefixo para conferir se o servidor carregou o secret do .env (sem expor o valor). */
function credpix_masterfy_webhook_secret_fingerprint(): ?string
{
    $secret = credpix_masterfy_webhook_secret();
    if ($secret === '') {
        return null;
    }
    return substr(hash('sha256', $secret), 0, 12);
}
