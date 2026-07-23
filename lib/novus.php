<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/security.php';

function credpix_novus_api_key(): string
{
    return trim((string) (getenv('NOVUS_API_KEY') ?: ''));
}

function credpix_novus_configured(): bool
{
    $k = credpix_novus_api_key();
    return $k !== '' && $k !== 'SUA_CHAVE_DE_API' && $k !== 'SUA_NOVUS_API_KEY';
}

function credpix_novus_base_url(): string
{
    return 'https://api.novuspagamentos.com/api/v2';
}

function credpix_novus_uuid_v4(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return sprintf('%s-%s-%s-%s-%s',
        substr($hex, 0, 8),
        substr($hex, 8, 4),
        substr($hex, 12, 4),
        substr($hex, 16, 4),
        substr($hex, 20, 12)
    );
}

function credpix_novus_request(string $method, string $path, ?array $body = null, ?string $idempotencyKey = null): array
{
    $key = credpix_novus_api_key();
    if ($key === '') {
        throw new RuntimeException('NOVUS_API_KEY não configurada no .env');
    }

    $url = credpix_novus_base_url() . $path;
    $ch = curl_init($url);
    $headers = [
        'Authorization: Bearer ' . $key,
        'Content-Type: application/json',
        'Accept: application/json',
    ];
    if ($idempotencyKey !== null && $idempotencyKey !== '') {
        $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
    }
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException('Erro Novus: ' . $err);
    }
    curl_close($ch);
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        throw new RuntimeException('Resposta inválida da Novus');
    }
    if ($status >= 400) {
        $msg = $json['message'] ?? $json['error']['message'] ?? $json['error'] ?? 'Erro Novus';
        if (is_array($msg)) {
            $msg = json_encode($msg, JSON_UNESCAPED_UNICODE);
        }
        throw new RuntimeException((string) $msg . ' (HTTP ' . $status . ')');
    }
    return $json;
}

/**
 * Novus statuses (invoice/transaction):
 *  - active, pending, waiting_payment, processing → pending
 *  - paid → paid
 *  - refused, failed, canceled, cancelled, chargedback, expired, blocked, refunded, processing_error → failed
 */
function credpix_novus_map_status(string $status): string
{
    $s = strtolower(trim($status));
    if ($s === 'paid') {
        return 'paid';
    }
    if (in_array($s, [
        'refused', 'failed', 'canceled', 'cancelled', 'chargedback', 'chargeback',
        'expired', 'blocked', 'refunded', 'processing_error',
    ], true)) {
        return 'failed';
    }
    return 'pending';
}

function credpix_novus_extract_pix_code(array $response): string
{
    $data = is_array($response['data'] ?? null) ? $response['data'] : $response;
    $candidates = [
        $data['pix']['qrcode']        ?? '',
        $data['pix']['qr_code']       ?? '',
        $data['pix']['copyPasteCode'] ?? '',
        $data['pix']['copy_paste']    ?? '',
        $data['qr_code_pix']          ?? '',
        $data['qrcode']               ?? '',
        $response['qr_code_pix']      ?? '',
    ];
    foreach ($candidates as $v) {
        if (is_string($v) && $v !== '') {
            return $v;
        }
    }
    return '';
}

function credpix_novus_extract_payment_id(array $response): string
{
    $data = is_array($response['data'] ?? null) ? $response['data'] : $response;
    return (string) ($data['invoice_id'] ?? $data['id'] ?? $response['id'] ?? '');
}

function credpix_novus_webhook_url(): string
{
    return credpix_public_base_url() . credpix_app_base_path() . '/pay/api/webhook-novus.php';
}

function credpix_novus_create_pix_payment(string $productId, array $payer, ?string $deviceHash = null, array $context = []): array
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

    $wizardSession = is_array($context['wizard_session'] ?? null) ? $context['wizard_session'] : [];
    $utms          = is_array($context['utms'] ?? null) ? $context['utms'] : [];
    $siteCtx       = is_array($context['site'] ?? null) ? array_merge(credpix_site_context(), $context['site']) : credpix_site_context();
    $siteRefRaw    = (string) (($siteCtx['site_host'] ?? '') ?: ($siteCtx['site_id'] ?? 'site'));
    $siteRef       = substr(preg_replace('/[^a-zA-Z0-9._-]/', '_', $siteRefRaw) ?: 'site', 0, 48);
    $externalRef   = $siteRef . '_' . $productId . '_' . ($deviceHash ?: 'web') . '_' . time();

    $publicName = credpix_product_is_upsell($productId)
        ? (string) ($product['label'] ?? $product['name'] ?? 'Produto')
        : 'Principal';

    $phoneRaw = $payer['phone']
        ?? $wizardSession['telefone']
        ?? $wizardSession['phone']
        ?? '11999999999';
    $phone = preg_replace('/\D/', '', (string) $phoneRaw);
    if (str_starts_with($phone, '55') && strlen($phone) > 11) {
        $phone = substr($phone, 2);
    }
    if (strlen($phone) < 10) {
        $phone = '11999999999';
    }

    /* Metadata TUDO em português — mesma convenção dos outros gateways */
    $metadata = [
        'prestador'          => 'CredPix',
        'codigo_externo'     => $externalRef,
        'etapa'              => (string) ($product['step'] ?? (credpix_product_is_upsell($productId) ? 'upsell' : 'principal')),
        'nome_produto'       => (string) ($product['name'] ?? $publicName),
        'referencia_produto' => (string) ($product['ref']  ?? $productId),
        'nome_cliente'       => (string) ($payer['name'] ?? 'Cliente'),
        'site_id'            => (string) ($siteCtx['site_id'] ?? ''),
        'site_host'          => (string) ($siteCtx['site_host'] ?? ''),
        'site_origin'        => (string) ($siteCtx['site_origin'] ?? ''),
        'site'               => (string) ($siteCtx['site_id'] ?? ''),
        'dominio'            => (string) ($siteCtx['site_host'] ?? ''),
        'dominio_origem'     => (string) ($siteCtx['site_origin'] ?? ''),
    ];

    $valorEmp = null;
    if (isset($wizardSession['valor_emprestimo']) && $wizardSession['valor_emprestimo'] !== '') {
        $vRaw = preg_replace('/[^\d,.]/', '', (string) $wizardSession['valor_emprestimo']);
        $vRaw = str_contains($vRaw, ',') ? str_replace(',', '.', str_replace('.', '', $vRaw)) : $vRaw;
        $valorEmp = is_numeric($vRaw) ? (float) $vRaw : null;
    }
    $numParc = null;
    if (isset($wizardSession['num_parcelas']) && $wizardSession['num_parcelas'] !== '') {
        $numParc = (int) preg_replace('/\D/', '', (string) $wizardSession['num_parcelas']);
        if ($numParc <= 0) $numParc = null;
    }
    if ($valorEmp !== null) $metadata['valor_emprestimo'] = 'R$ ' . number_format($valorEmp, 2, ',', '.');
    if ($numParc !== null)  $metadata['num_parcelas']     = (string) $numParc;
    if ($valorEmp !== null && $numParc !== null) {
        $metadata['valor_parcela'] = 'R$ ' . number_format($valorEmp / $numParc, 2, ',', '.');
        $metadata['valor_total']   = 'R$ ' . number_format($valorEmp, 2, ',', '.');
    }
    if (isset($wizardSession['dia_pagamento']) && $wizardSession['dia_pagamento'] !== '') {
        try {
            $dia = (int) preg_replace('/\D/', '', (string) $wizardSession['dia_pagamento']);
            if ($dia >= 1 && $dia <= 31) {
                $metadata['dia_vencimento'] = (string) $dia;
                $nm = new DateTime('now');
                $nm->setDate((int) $nm->format('Y'), (int) $nm->format('n'), 1);
                $nm->modify('+1 month')->setDate((int) $nm->format('Y'), (int) $nm->format('n'), $dia);
                $metadata['primeira_parcela'] = $nm->format('m/Y');
                $metadata['primeira_parcela_data'] = $nm->format('d/m/Y');
            }
        } catch (Throwable $e) {}
    }
    if (isset($wizardSession['pix']) && $wizardSession['pix'] !== '') {
        $metadata['chave_pix'] = substr((string) $wizardSession['pix'], 0, 255);
    }
    if (isset($wizardSession['tipo_pix']) && $wizardSession['tipo_pix'] !== '') {
        $metadata['tipo_pix'] = (string) $wizardSession['tipo_pix'];
    }
    if (isset($wizardSession['metodo_pagamento']) && $wizardSession['metodo_pagamento'] !== '') {
        $metadata['metodo_pagamento'] = (string) $wizardSession['metodo_pagamento'];
    }
    if (isset($wizardSession['renda_mensal']) && $wizardSession['renda_mensal'] !== '') {
        $rRaw = preg_replace('/[^\d,.]/', '', (string) $wizardSession['renda_mensal']);
        $rRaw = str_contains($rRaw, ',') ? str_replace(',', '.', str_replace('.', '', $rRaw)) : $rRaw;
        if (is_numeric($rRaw)) $metadata['renda_mensal'] = 'R$ ' . number_format((float) $rRaw, 2, ',', '.');
    }
    if (isset($wizardSession['tipo_renda']) && $wizardSession['tipo_renda'] !== '') {
        $metadata['tipo_renda'] = (string) $wizardSession['tipo_renda'];
    }
    if (isset($wizardSession['telefone']) && $wizardSession['telefone'] !== '') {
        $metadata['telefone'] = preg_replace('/\D/', '', (string) $wizardSession['telefone']);
    }
    if (isset($utms['src']) && $utms['src'] !== '')                       $metadata['origem']   = substr((string) $utms['src'], 0, 255);
    if (isset($utms['utm_source']) && $utms['utm_source'] !== '')         $metadata['fonte']    = substr((string) $utms['utm_source'], 0, 255);
    if (isset($utms['utm_medium']) && $utms['utm_medium'] !== '')         $metadata['meio']     = substr((string) $utms['utm_medium'], 0, 255);
    if (isset($utms['utm_campaign']) && $utms['utm_campaign'] !== '')     $metadata['campanha'] = substr((string) $utms['utm_campaign'], 0, 255);
    if (isset($utms['utm_content']) && $utms['utm_content'] !== '')       $metadata['conteudo'] = substr((string) $utms['utm_content'], 0, 255);
    if (isset($utms['utm_term']) && $utms['utm_term'] !== '')             $metadata['termo']    = substr((string) $utms['utm_term'], 0, 255);

    $payload = [
        'method'            => 'pix',
        'total_price_cents' => (int) $product['amountCents'],
        'currency'          => 'BRL',
        'country'           => 'BR',
        'external_id'       => $externalRef,
        'payer' => [
            'name'     => $payer['name'] ?? 'Cliente',
            'cpf_cnpj' => $taxId,
            'email'    => $payer['email'] ?? 'cliente@email.com',
        ],
        'items' => [[
            'name'       => $publicName,
            'unit_price' => (int) $product['amountCents'],
            'quantity'   => 1,
        ]],
        'metadata' => $metadata,
    ];

    $webhookUrl = credpix_novus_webhook_url();
    if ($webhookUrl !== '' && str_starts_with($webhookUrl, 'https://')) {
        $payload['postback_url'] = $webhookUrl;
    }

    $response  = credpix_novus_request('POST', '/invoices', $payload, credpix_novus_uuid_v4());
    $data      = is_array($response['data'] ?? null) ? $response['data'] : $response;
    $pixCode   = credpix_novus_extract_pix_code($response);
    $paymentId = credpix_novus_extract_payment_id($response);

    if ($pixCode === '') {
        throw new RuntimeException('Novus: PIX sem código copypaste na resposta');
    }
    if ($paymentId === '') {
        throw new RuntimeException('Novus: invoice_id não retornado');
    }

    return [
        'payment_id'   => $paymentId,
        'external_ref' => $externalRef,
        'status'       => credpix_novus_map_status((string) ($data['status'] ?? 'pending')),
        'amount_cents' => (int) $product['amountCents'],
        'public_name'  => $publicName,
        'qr_code'      => $pixCode,
        'gateway'      => 'novus',
        'raw'          => $response,
    ];
}

function credpix_novus_get_payment(string $paymentId): array
{
    $response = credpix_novus_request('GET', '/invoices/' . rawurlencode($paymentId));
    $data = is_array($response['data'] ?? null) ? $response['data'] : null;
    if ($data !== null) {
        $data['_raw'] = $response;
        return $data;
    }
    return $response;
}

function credpix_novus_extract_site_metadata(array $body): array
{
    $candidates = [
        $body['metadata'] ?? null,
        $body['data']['metadata'] ?? null,
        $body['invoice']['metadata'] ?? null,
    ];
    foreach ($candidates as $metadata) {
        if (!is_array($metadata)) {
            continue;
        }
        if (isset($metadata['site_id']) || isset($metadata['site_host']) || isset($metadata['site']) || isset($metadata['dominio'])) {
            $metadata['site_id']     = $metadata['site_id']     ?? ($metadata['site'] ?? null);
            $metadata['site_host']   = $metadata['site_host']   ?? ($metadata['dominio'] ?? null);
            $metadata['site_origin'] = $metadata['site_origin'] ?? ($metadata['dominio_origem'] ?? null);
            return $metadata;
        }
    }
    return [];
}

/**
 * Novus webhook: X-Webhook-Signature (HMAC-SHA256). Secret padrão = API key da empresa
 * (per-transaction) ou NOVUS_WEBHOOK_SECRET (global whsec_...).
 */
function credpix_novus_webhook_signature_header(): string
{
    $known = [
        'HTTP_X_WEBHOOK_SIGNATURE',
        'HTTP_X_SIGNATURE',
        'HTTP_X_NOVUS_SIGNATURE',
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

function credpix_novus_webhook_secrets(): array
{
    $secrets = [];
    $whsec = trim((string) (getenv('NOVUS_WEBHOOK_SECRET') ?: ''));
    if ($whsec !== '') {
        $secrets[] = $whsec;
    }
    $api = credpix_novus_api_key();
    if ($api !== '') {
        $secrets[] = $api;
    }
    return $secrets;
}

/** @return array{valid: bool, reason: string, header: string, body_len: int, verify_method: string} */
function credpix_novus_verify_webhook_hmac(string $rawBody, ?string $signatureHeader = null): array
{
    $header = $signatureHeader ?? credpix_novus_webhook_signature_header();
    $bodyLen = strlen($rawBody);
    $secrets = credpix_novus_webhook_secrets();

    if (empty($secrets)) {
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

    foreach ($secrets as $secret) {
        $expectedHex = hash_hmac('sha256', $rawBody, $secret);
        $expectedB64 = base64_encode(hash_hmac('sha256', $rawBody, $secret, true));
        foreach ($candidates as $candidate) {
            if (hash_equals($expectedHex, strtolower($candidate))) {
                return ['valid' => true, 'reason' => 'ok_hex', 'header' => $header, 'body_len' => $bodyLen, 'verify_method' => 'hmac'];
            }
            if (hash_equals($expectedB64, $candidate)) {
                return ['valid' => true, 'reason' => 'ok_b64', 'header' => $header, 'body_len' => $bodyLen, 'verify_method' => 'hmac'];
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

function credpix_novus_parse_paid_at($value): ?int
{
    if ($value === null || $value === '') {
        return null;
    }
    if (is_numeric($value)) {
        $n = (int) $value;
        return $n > 9999999999 ? intdiv($n, 1000) : $n;
    }
    $ts = strtotime((string) $value);
    return $ts !== false ? $ts : null;
}
