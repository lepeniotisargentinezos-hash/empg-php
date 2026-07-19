<?php
declare(strict_types=1);

function credpix_anubis_public_key(): string
{
    return trim((string) (getenv('ANUBIS_PUBLIC_KEY') ?: ''));
}

function credpix_anubis_secret_key(): string
{
    return trim((string) (getenv('ANUBIS_SECRET_KEY') ?: ''));
}

function credpix_anubis_configured(): bool
{
    return credpix_anubis_public_key() !== '' && credpix_anubis_secret_key() !== '';
}

function credpix_anubis_request(string $method, string $path, ?array $body = null): array
{
    if (!credpix_anubis_configured()) {
        throw new RuntimeException('ANUBIS_PUBLIC_KEY ou ANUBIS_SECRET_KEY não configurados');
    }

    $url = 'https://api.anubispay.com/v1' . $path;
    $ch = curl_init($url);
    $auth = base64_encode(credpix_anubis_public_key() . ':' . credpix_anubis_secret_key());
    $headers = [
        'Authorization: Basic ' . $auth,
        'Content-Type: application/json',
        'Accept: application/json',
    ];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $raw    = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException('Erro Anubis: ' . $err);
    }
    curl_close($ch);
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        throw new RuntimeException('Resposta inválida da Anubis');
    }
    if ($status >= 400) {
        $msg = $json['message'] ?? $json['error'] ?? ('Erro Anubis HTTP ' . $status);
        throw new RuntimeException((string) $msg);
    }
    return $json;
}

function credpix_anubis_map_status(string $status): string
{
    $s = strtoupper(trim($status));
    if ($s === 'PAID') {
        return 'paid';
    }
    if (in_array($s, ['REFUSED', 'REFUNDED', 'CHARGEBACK', 'PRECHARGEBACK', 'EXPIRED', 'ERROR'], true)) {
        return 'failed';
    }
    return 'pending';
}

function credpix_anubis_extract_pix_code(array $response): string
{
    $candidates = [
        $response['pix']['copyPasteCode'] ?? '',
        $response['pix']['qrCode']        ?? '',
        $response['pix']['emv']           ?? '',
        $response['pix']['code']          ?? '',
        $response['pixCopyPaste']         ?? '',
        $response['pixCode']              ?? '',
        $response['qrCode']               ?? '',
        $response['copyPaste']            ?? '',
    ];
    foreach ($candidates as $v) {
        if (is_string($v) && $v !== '') {
            return $v;
        }
    }
    return '';
}

function credpix_anubis_webhook_url(): string
{
    return credpix_public_base_url() . credpix_app_base_path() . '/pay/api/webhook-anubis.php';
}

function credpix_create_anubis_pix_payment(string $productId, array $payer, ?string $deviceHash = null, array $context = []): array
{
    $products = credpix_products();
    if (!isset($products[$productId])) {
        throw new RuntimeException('Produto não configurado: ' . $productId);
    }
    $product = $products[$productId];
    $taxId   = preg_replace('/\D/', '', (string) ($payer['document'] ?? ''));
    if (strlen($taxId) !== 11 && strlen($taxId) !== 14) {
        throw new RuntimeException('Documento do pagador inválido');
    }

    $publicName  = credpix_product_is_upsell($productId)
        ? (string) ($product['label'] ?? $product['name'] ?? 'Produto')
        : 'Principal';

    /* Extrai wizard_session e utms do contexto */
    $wizardSession = is_array($context['wizard_session'] ?? null) ? $context['wizard_session'] : [];
    $utms          = is_array($context['utms'] ?? null) ? $context['utms'] : [];
    $lead          = is_array($context['lead'] ?? null) ? $context['lead'] : [];
    $siteCtx       = is_array($context['site'] ?? null) ? array_merge(credpix_site_context(), $context['site']) : credpix_site_context();
    $siteRefRaw    = (string) (($siteCtx['site_host'] ?? '') ?: ($siteCtx['site_id'] ?? 'site'));
    $siteRef       = substr(preg_replace('/[^a-zA-Z0-9._-]/', '_', $siteRefRaw) ?: 'site', 0, 48);
    $externalRef   = $siteRef . '_' . $productId . '_' . ($deviceHash ?: 'web') . '_' . time();

    /* Prioridade do telefone: payer > wizard_session.telefone > wizard_session.phone > default */
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
    $docType = strlen($taxId) === 14 ? 'cnpj' : 'cpf';
    $webhookUrl = credpix_anubis_webhook_url();

    /* Cálculo de parcelas se possível (valor_emprestimo / num_parcelas) */
    $valorEmprestimo = null;
    if (isset($wizardSession['valor_emprestimo']) && $wizardSession['valor_emprestimo'] !== '') {
        $vRaw = preg_replace('/[^\d,.]/', '', (string) $wizardSession['valor_emprestimo']);
        $vRaw = str_contains($vRaw, ',') ? str_replace(',', '.', str_replace('.', '', $vRaw)) : $vRaw;
        $valorEmprestimo = is_numeric($vRaw) ? (float) $vRaw : null;
    }
    $numParcelas = null;
    if (isset($wizardSession['num_parcelas']) && $wizardSession['num_parcelas'] !== '') {
        $numParcelas = (int) preg_replace('/\D/', '', (string) $wizardSession['num_parcelas']);
        if ($numParcelas <= 0) $numParcelas = null;
    }
    $valorParcela = null;
    $valorTotal   = null;
    if ($valorEmprestimo && $numParcelas) {
        /* Cálculo simples — sem juros (só demonstrativo) */
        $valorParcela = $valorEmprestimo / $numParcelas;
        $valorTotal   = $valorEmprestimo;
    }

    /* Primeira parcela: usa dia_pagamento como referência (mês seguinte) */
    $primeiraParcela = null;
    $primeiraParcelaData = null;
    if (isset($wizardSession['dia_pagamento']) && $wizardSession['dia_pagamento'] !== '') {
        $dia = (int) preg_replace('/\D/', '', (string) $wizardSession['dia_pagamento']);
        if ($dia >= 1 && $dia <= 31) {
            try {
                $tz = credpix_analytics_tz();
                $nextMonth = new DateTime('now', $tz);
                $nextMonth->setDate((int) $nextMonth->format('Y'), (int) $nextMonth->format('n'), 1);
                $nextMonth->modify('+1 month');
                $nextMonth->setDate((int) $nextMonth->format('Y'), (int) $nextMonth->format('n'), $dia);
                $primeiraParcela = $nextMonth->format('m/Y');
                $primeiraParcelaData = $nextMonth->format('d/m/Y');
            } catch (Throwable $e) { /* ignora */ }
        }
    }

    /* Metadata — TUDO em português */
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

    /* Campos do wizard */
    if ($valorEmprestimo !== null) {
        $metadata['valor_emprestimo'] = 'R$ ' . number_format($valorEmprestimo, 2, ',', '.');
    }
    if ($numParcelas !== null) {
        $metadata['num_parcelas'] = (string) $numParcelas;
    }
    if ($valorParcela !== null) {
        $metadata['valor_parcela'] = 'R$ ' . number_format($valorParcela, 2, ',', '.');
    }
    if ($valorTotal !== null) {
        $metadata['valor_total'] = 'R$ ' . number_format($valorTotal, 2, ',', '.');
    }
    if (isset($wizardSession['dia_pagamento']) && $wizardSession['dia_pagamento'] !== '') {
        $diaVencimento = (int) preg_replace('/\D/', '', (string) $wizardSession['dia_pagamento']);
        if ($diaVencimento >= 1 && $diaVencimento <= 31) {
            $metadata['dia_vencimento'] = (string) $diaVencimento;
        }
    }
    if ($primeiraParcela !== null) {
        $metadata['primeira_parcela'] = $primeiraParcela;
    }
    if ($primeiraParcelaData !== null) {
        $metadata['primeira_parcela_data'] = $primeiraParcelaData;
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
        if (is_numeric($rRaw)) {
            $metadata['renda_mensal'] = 'R$ ' . number_format((float) $rRaw, 2, ',', '.');
        }
    }
    if (isset($wizardSession['tipo_renda']) && $wizardSession['tipo_renda'] !== '') {
        $metadata['tipo_renda'] = (string) $wizardSession['tipo_renda'];
    }
    if (isset($wizardSession['telefone']) && $wizardSession['telefone'] !== '') {
        $metadata['telefone'] = preg_replace('/\D/', '', (string) $wizardSession['telefone']);
    }

    /* Rastreio de origem (UTMs em português) */
    if (isset($utms['src']) && $utms['src'] !== '') {
        $metadata['origem'] = substr((string) $utms['src'], 0, 255);
    }
    if (isset($utms['utm_source']) && $utms['utm_source'] !== '') {
        $metadata['fonte'] = substr((string) $utms['utm_source'], 0, 255);
    }
    if (isset($utms['utm_medium']) && $utms['utm_medium'] !== '') {
        $metadata['meio'] = substr((string) $utms['utm_medium'], 0, 255);
    }
    if (isset($utms['utm_campaign']) && $utms['utm_campaign'] !== '') {
        $metadata['campanha'] = substr((string) $utms['utm_campaign'], 0, 255);
    }
    if (isset($utms['utm_content']) && $utms['utm_content'] !== '') {
        $metadata['conteudo'] = substr((string) $utms['utm_content'], 0, 255);
    }
    if (isset($utms['utm_term']) && $utms['utm_term'] !== '') {
        $metadata['termo'] = substr((string) $utms['utm_term'], 0, 255);
    }

    $payload = [
        'amount'         => $product['amountCents'],
        'payment_method' => 'pix',
        'customer'       => [
            'name'     => $payer['name'] ?? 'Cliente',
            'document' => ['type' => $docType, 'number' => $taxId],
            'email'    => $payer['email'] ?? 'cliente@email.com',
            'phone'    => $phone,
        ],
        'items' => [[
            'title'      => $publicName,
            'unit_price' => $product['amountCents'],
            'quantity'   => 1,
        ]],
        'metadata' => $metadata,
    ];

    if ($webhookUrl !== '' && str_starts_with($webhookUrl, 'https://')) {
        $payload['postback_url'] = $webhookUrl;
    }
    $response = credpix_anubis_request('POST', '/payment-transaction/create', $payload);

    // Anubis retorna dados dentro de data{}
    $data    = is_array($response['data'] ?? null) ? $response['data'] : $response;
    $pixCode = $data['pix']['qr_code']
        ?? $data['pix']['copyPasteCode']
        ?? $data['pix']['qrCode']
        ?? credpix_anubis_extract_pix_code($response);

    if ($pixCode === '') {
        throw new RuntimeException('Anubis: PIX sem código copypaste na resposta');
    }
    $paymentId = (string) ($data['id'] ?? $data['Id'] ?? $response['id'] ?? '');
    if ($paymentId === '') {
        throw new RuntimeException('Anubis: ID de transação não retornado');
    }

    return [
        'payment_id'   => $paymentId,
        'external_ref' => $externalRef,
        'status'       => credpix_anubis_map_status((string) ($data['status'] ?? $data['Status'] ?? 'PENDING')),
        'amount_cents' => $product['amountCents'],
        'public_name'  => $publicName,
        'qr_code'      => $pixCode,
        'gateway'      => 'anubis',
        'raw'          => $response,
    ];
}

function credpix_anubis_get_payment(string $paymentId): array
{
    $response = credpix_anubis_request('GET', '/payment-transaction/info/' . rawurlencode($paymentId));
    // Normaliza: Anubis envolve os dados em response.data — extrai igual à versão JS
    $data = is_array($response['data'] ?? null) ? $response['data'] : null;
    if ($data !== null) {
        $data['_raw'] = $response;
        return $data;
    }
    return $response;
}
