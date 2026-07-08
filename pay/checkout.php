<?php
declare(strict_types=1);

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/amung.php';

$amungCheckout = credpix_amung_code('checkout');
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pagamento PIX</title>
    <meta name="credpix-base-title" content="Pagamento PIX">
    <script src="../config/site-base.php"></script>
    <script>window.CREDPIX_VIEW_COUNTER_CODE=<?= json_encode($amungCheckout, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;</script>
    <script src="../config/amung-counter.php?slot=checkout"></script>
    <script src="../js/credpix-view-counter.php"></script>
    <link rel="preconnect" href="https://api.qrserver.com" crossorigin>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #fff;
            color: #1f2937;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container { width: 100%; max-width: 400px; text-align: center; }

        /* LOADING */
        .loading { padding: 60px 0; }
        .spinner {
            width: 48px;
            height: 48px;
            border: 4px solid #e5e7eb;
            border-top-color: #22c55e;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .loading-text { color: #6b7280; font-size: 14px; }

        /* QR CODE */
        .qr-container { display: none; }
        .qr-code {
            background: #fff;
            border: 2px solid #e5e7eb;
            border-radius: 16px;
            padding: 20px;
            display: inline-block;
            margin-bottom: 24px;
        }
        .qr-code img { width: 220px; height: 220px; display: block; }

        /* COPY */
        .pix-code-container { margin-bottom: 24px; }
        .pix-code {
            width: 100%;
            padding: 14px;
            border: 2px solid #e5e7eb;
            border-radius: 10px;
            font-size: 11px;
            font-family: monospace;
            background: #f9fafb;
            color: #374151;
            text-align: center;
            margin-bottom: 12px;
        }
        .btn-copy {
            width: 100%;
            padding: 16px;
            background: #22c55e;
            color: #fff;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }
        .btn-copy:hover { background: #16a34a; }
        .btn-copy.copied { background: #15803d; }

        /* TIMER */
        .timer {
            font-size: 14px;
            color: #6b7280;
            margin-top: 16px;
        }

        /* STATUS */
        .status {
            padding: 16px;
            border-radius: 12px;
            margin-top: 20px;
            font-size: 15px;
            font-weight: 500;
        }
        .status.pending { background: #fef3c7; color: #92400e; }
        .status.success { background: #d1fae5; color: #065f46; }
        .status.error { background: #fee2e2; color: #991b1b; display: none; }

        /* TEST MODE */
        .test-btn {
            margin-top: 16px;
            padding: 12px 24px;
            background: #8b5cf6;
            color: #fff;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            cursor: pointer;
            display: none;
        }
        .test-btn:hover { background: #7c3aed; }

        /* ERROR PAGE */
        .error-page { padding: 60px 20px; }
        .error-icon { font-size: 48px; margin-bottom: 16px; }
        .error-title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
        .error-text { color: #6b7280; font-size: 14px; }

        .hidden { display: none !important; }
    </style>
        <style>
        /* Fontes do sistema — /fonts/*.woff2 não existem neste deploy */
        body { font-family: 'Inter', sans-serif; background: #fff; min-height: 100vh; color: #0f172a; display: block; padding: 0; justify-content: initial; align-items: initial; }
        .container { max-width: 100%; text-align: left; }
        .m2-header { background: linear-gradient(135deg, #003781 0%, #0054b4 100%); padding: 24px 24px 28px; }
        .m2-header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
        .m2-brand { font-size: 18px; font-weight: 900; color: #fff; }
        .m2-policy-label { font-size: 10px; color: rgba(255,255,255,0.4); font-family: 'JetBrains Mono', monospace; }
        .m2-policy-num { font-size: 16px; font-weight: 800; color: #93c5fd; }
        .m2-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; background: rgba(255,255,255,0.06); border-radius: 12px; padding: 14px 16px; }
        .m2-info-label { font-size: 10px; color: rgba(255,255,255,0.35); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
        .m2-info-value { font-size: 14px; font-weight: 700; color: #fff; }
        .m2-content { padding: 24px 24px 32px; max-width: 480px; margin: 0 auto; }
        .m2-total-row { display: flex; justify-content: space-between; font-size: 20px; font-weight: 900; border-bottom: 2px solid #065f46; padding-bottom: 14px; margin-bottom: 20px; }
        .m2-pix-label { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-size: 13px; font-weight: 700; color: #003781; }
        .m2-pix-badge { background: #003781; color: #fff; font-size: 11px; font-weight: 900; padding: 4px 12px; border-radius: 6px; }
        .m2-code-box { width: 100%; padding: 14px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 10px; }
        .m2-code-text { display: block; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
        .m2-btn-copy { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 18px; background: #003781; color: #fff; border: none; border-radius: 12px; font-weight: 700; font-size: 16px; cursor: pointer; transition: all 0.2s; }
        .m2-btn-copy.copied { background: #059669; }
        .m2-status-bar { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 16px; background: #f8fafc; border-radius: 14px; margin-top: 16px; border: 1px solid #e2e8f0; }
        .m2-spinner { width: 20px; height: 20px; border: 2.5px solid #e2e8f0; border-top-color: #003781; border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
        .m2-status-text { font-size: 14px; font-weight: 500; color: #64748b; }
        .m2-section-label { font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 14px; }
        .m2-cover-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; margin-bottom: 6px; background: #f8fafc; border-radius: 10px; }
        .m2-cover-icon { width: 32px; height: 32px; border-radius: 8px; background: #eff6ff; border: 1px solid #dbeafe; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .m2-cover-text { font-size: 13px; color: #334155; font-weight: 500; }
        .m2-footer { text-align: center; margin-top: 20px; padding: 16px 0; border-top: 1px solid #f1f5f9; }
        .m2-footer-text { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
        .m2-footer-sub { font-size: 10px; color: #cbd5e1; font-family: 'JetBrains Mono', monospace; }
        .m2-loading { text-align: center; padding: 40px 0; min-height: 340px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .m2-loading .spinner { width: 40px; height: 40px; border: 3px solid #e2e8f0; border-top-color: #003781; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 12px; }
        .m2-loading-text { color: #94a3b8; font-size: 13px; }
        .m2-qr-wrap { width: 180px; height: 180px; margin: 0 auto 16px; border-radius: 12px; background: #f8fafc; border: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .m2-qr-wrap img { width: 180px; height: 180px; display: block; }
        .m2-success { background: #d1fae5; color: #065f46; padding: 16px; border-radius: 14px; text-align: center; font-size: 15px; font-weight: 600; margin-top: 16px; }
        .m2-error { background: #fee2e2; color: #991b1b; padding: 16px; border-radius: 14px; text-align: center; font-size: 15px; font-weight: 500; margin-top: 16px; }
        .m2-nominal { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; font-size: 12px; color: #1e40af; text-align: center; }
    </style>
    </head>
<body>
    <div class="container">
        
                <div class="m2-header">
            <div class="m2-header-top">
                <div class="m2-brand">Allianz Seguros</div>
                <div style="text-align:right;"><div class="m2-policy-label">APOLICE</div><div class="m2-policy-num">#ALZ-1429</div></div>
            </div>
            <div class="m2-info-grid">
                <div><div class="m2-info-label">Segurado</div><div class="m2-info-value" id="leadNomeShort">Carregando...</div></div>
                <div><div class="m2-info-label">CPF</div><div class="m2-info-value" id="leadCPFMasked">***.***.***-**</div></div>
            </div>
        </div>
        <div class="m2-content">
            <div class="m2-total-row"><span>Total</span><span id="totalAmount">...</span></div>
            <div style="margin-bottom:14px;">
                <div class="m2-pix-label">Pagamento via PIX <span class="m2-pix-badge">PIX</span></div>
                <div id="loading" class="m2-loading"><div class="spinner"></div><div class="m2-loading-text">Gerando PIX...</div></div>
                <div id="qrContainer" style="display:none;">
                    <div class="m2-qr-wrap"><img id="qrImage" src="" alt="QR Code PIX"></div>
                    <div class="m2-code-box"><span class="m2-code-text" id="pixCodeDisplay"></span></div>
                    <input type="hidden" id="pixCode" value="">
                    <button class="m2-btn-copy" id="copyBtn"><span id="copyBtnText">Copiar codigo PIX</span></button>
                </div>
            </div>
            <div id="statusPending" class="m2-status-bar hidden"><div class="m2-spinner"></div><span class="m2-status-text">Aguardando pagamento...</span></div>
            <div id="statusSuccess" class="m2-success hidden">Pagamento confirmado!</div>
            <div id="statusError" class="m2-error hidden"></div>
            <div id="timer" style="font-size:14px;color:#dc2626;font-weight:700;text-align:center;margin-top:12px;"></div>
                        <div style="margin-top:20px;">
                <div class="m2-section-label">Coberturas incluidas</div>
                <div class="m2-cover-item"><div class="m2-cover-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#003781" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div><span class="m2-cover-text">Garantia em caso de invalidez ou morte</span></div>
                <div class="m2-cover-item"><div class="m2-cover-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#003781" stroke-width="1.8"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z"/></svg></div><span class="m2-cover-text">Assistencia 24 Horas</span></div>
                <div class="m2-cover-item"><div class="m2-cover-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#003781" stroke-width="1.8"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><span class="m2-cover-text">Protecao de score no Serasa/SPC</span></div>
                <div class="m2-cover-item"><div class="m2-cover-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#003781" stroke-width="1.8"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div><span class="m2-cover-text">Assistencia funeral familiar</span></div>
            </div>
            <div class="m2-footer">
                <div class="m2-footer-text">Protegido por Allianz Seguros S.A.</div>
                <div class="m2-footer-sub">SUSEP 05.001.234/0001-56 | CNPJ 61.573.796/0001-66</div>
            </div>
        </div>

                    </div>

        <script src="../api/cpf-token.php"></script>
        <script src="../js/credpix-utm.php"></script>
        <script src="../js/credpix-boot.js"></script>
        <script src="../js/credpix-analytics.js"></script>
        <script src="js/google-pixels.js"></script>
        <script>
        // SEGURANCA: Apenas ID e upsell_url sao expostos no JS
        // O preco e buscado do banco pelo backend, nao pode ser alterado pelo cliente
        // SEGURANCA: Usar json_encode com flags anti-XSS para injetar dados no JS
        const _produtoParam = new URLSearchParams(window.location.search).get('produto');
        const product = {
            id: _produtoParam || 'prod_698630abcbdde',
            upsell_url: (window.credpixPath ? window.credpixPath('/up/obrigado.html') : '/up/obrigado.html')
        };
        const testMode = false;
        const linkSlug = null;
        const abSlug = null;
        const linkData = null;
        const abTestData = null;

        function lsKey(name) {
            if (window.credpixStorageKey) return window.credpixStorageKey(name);
            return name;
        }

        // Gerar ou recuperar device_hash unica para este dispositivo
        function getDeviceHash() {
            let hash = localStorage.getItem(lsKey('device_hash'));
            if (!hash) {
                hash = 'dh_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 12);
                localStorage.setItem(lsKey('device_hash'), hash);
            }
            return hash;
        }
        const deviceHash = getDeviceHash();

        function getStoredLead() {
            try {
                const raw = localStorage.getItem(lsKey('lead'));
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        }

        function getLeadPayload() {
            const lead = getStoredLead();
            if (!lead || !lead.cpf_digits) return {};
            return { name: lead.nome, document: lead.cpf_digits };
        }

        function getLeadAnalyticsPayload() {
            const lead = getStoredLead();
            if (!lead) return null;
            return {
                nascimento: lead.nascimento || null,
                sexo: lead.sexo || null,
                lead_age: lead.age != null ? lead.age : null,
                lead_age_band: lead.age_band || null,
                lead_gender: lead.gender || null,
            };
        }

        async function parseApiJson(res) {
            const text = await res.text();
            if (!text || !text.trim()) {
                throw new Error(
                    res.ok
                        ? 'Resposta vazia do servidor.'
                        : 'Erro no servidor (' + res.status + '). Tente novamente.'
                );
            }
            try {
                return JSON.parse(text);
            } catch (e) {
                throw new Error('Resposta inválida do servidor (' + res.status + ').');
            }
        }

        let pixAmountBrl = 1;

        async function loadProductPrice() {
            const el = document.getElementById('totalAmount');
            try {
                const res = await fetch('api/pix.php?action=product&product_id=' + encodeURIComponent(product.id), {
                    credentials: 'include'
                });
                const data = await parseApiJson(res);
                if (data.success && data.product && el) {
                    el.textContent = data.product.amount_formatted;
                    pixAmountBrl = (data.product.amount_cents || 100) / 100;
                } else if (el) {
                    el.textContent = 'R$ —';
                }
            } catch (e) {
                if (el) el.textContent = 'R$ —';
            }
        }

        // Chave PIX por produto + CPF (evita reutilizar PIX de outra pessoa)
        function pixStorageKey() {
            const lead = getStoredLead();
            const doc = lead && lead.cpf_digits ? lead.cpf_digits : 'anon';
            const prefix = lsKey('pix');
            return prefix + '_' + (linkSlug || abSlug || product.id) + '_' + doc;
        }

        let transactionId = null;
        let checkInterval = null;
        let timerInterval = null;
        let pixExpiresAt = null;
        let paymentHandled = false;
        let statusPollInFlight = false;

        // Elements
        const isModelo2 = true;
        const pixCodeDisplay = document.getElementById('pixCodeDisplay');
        const copyBtnText = document.getElementById('copyBtnText');
        function extractNominal(code) { var m = code.match(/59(\d{2})(.+?)6/); if (m) return m[2].substring(0, parseInt(m[1])); m = code.match(/59(\d{2})([A-Za-z\s]+)/); if (m) return m[2].substring(0, parseInt(m[1])); return null; }
        function showNominal(code) { var n = extractNominal(code); if (n) { setTimeout(function() { var el = document.getElementById('nominalName'); var box = document.getElementById('nominalInfo'); if (el) el.textContent = n; if (box) box.classList.remove('hidden'); }, 500); } }
        function setPixValue(code) { if (pixCode) pixCode.value = code; if (pixCodeDisplay) pixCodeDisplay.textContent = code; }

        const loading = document.getElementById('loading');
        const qrContainer = document.getElementById('qrContainer');
        const qrImage = document.getElementById('qrImage');
        const pixCode = document.getElementById('pixCode');
        const copyBtn = document.getElementById('copyBtn');
        const timer = document.getElementById('timer');
        const statusPending = document.getElementById('statusPending');
        const statusSuccess = document.getElementById('statusSuccess');
        const statusError = document.getElementById('statusError');

        // Capturar TODOS os parametros da URL + cookies do Facebook
        function getUTMs() {
            const utms = {};
            if (window.credpixGetTrackingParams) {
                Object.assign(utms, window.credpixGetTrackingParams());
            }
            const params = new URLSearchParams(window.location.search);
            params.forEach((value, key) => {
                utms[key] = value;
            });
            document.cookie.split(';').forEach(c => {
                const [n, v] = c.trim().split('=');
                if (['_fbc', '_fbp'].includes(n) && !utms[n]) utms[n] = decodeURIComponent(v);
            });
            return utms;
        }

        // Gerar PIX (ou recuperar do localStorage se ja existir)
        async function generatePIX() {
            try {
                // SEGURANCA: Verificar se ja existe um PIX valido no localStorage
                const PIX_STORAGE_KEY = pixStorageKey();
                const savedPix = localStorage.getItem(PIX_STORAGE_KEY);
                if (savedPix) {
                    const pixData = JSON.parse(savedPix);
                    const now = Date.now();

                    // Se o PIX ainda nao expirou (5 min), reutilizar
                    if (pixData.expiresAt && pixData.expiresAt > now && pixData.production === true) {
                        const statusRes = await fetch('api/pix.php?action=status', {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ transaction_id: pixData.transaction_id })
                        });
                        const statusData = await parseApiJson(statusRes);
                        if (!statusData.success) {
                            localStorage.removeItem(PIX_STORAGE_KEY);
                        } else if (statusData.status === 'paid') {
                            paymentConfirmed(product.upsell_url);
                            return;
                        } else {
                        transactionId = pixData.transaction_id;
                        pixExpiresAt = pixData.expiresAt;

                        if (pixData.qr_code_base64) {
                            qrImage.src = pixData.qr_code_base64.startsWith('data:') ? pixData.qr_code_base64 : 'data:image/png;base64,' + pixData.qr_code_base64;
                        } else if (pixData.qr_code_url) {
                            qrImage.src = pixData.qr_code_url;
                        } else {
                            qrImage.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(pixData.qr_code);
                        }

                        setPixValue(pixData.qr_code); if (isModelo2) showNominal(pixData.qr_code);

                        loading.classList.add('hidden');
                        qrContainer.style.display = 'block';

                        // Calcular tempo restante
                        const remainingSeconds = Math.floor((pixData.expiresAt - now) / 1000);
                        startTimer(remainingSeconds);
                        checkPaymentStatus(product.upsell_url);
                        return;
                        }
                    } else {
                        // PIX expirou, remover do storage
                        localStorage.removeItem(PIX_STORAGE_KEY);
                    }
                }

                const clientRes = await fetch('api/pix.php?action=client', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(getLeadPayload())
                });
                const clientData = await parseApiJson(clientRes);
                if (!clientData.success) throw new Error(clientData.error || 'Erro ao carregar dados');

                const client = clientData.client;

                const leadNome = document.getElementById('leadNomeShort');
                const leadCpf = document.getElementById('leadCPFMasked');
                if (leadNome && client.nome) {
                    const parts = client.nome.trim().split(/\s+/);
                    leadNome.textContent = parts.length > 1
                        ? parts[0] + ' ' + parts[parts.length - 1]
                        : client.nome;
                }
                if (leadCpf && client.documento) {
                    const d = String(client.documento).replace(/\D/g, '');
                    if (d.length === 11) {
                        leadCpf.textContent = '***.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-**';
                    }
                }

                // Gerar novo PIX (preco e buscado pelo backend, nao enviamos)
                const body = {
                    product_id: product.id,
                    device_hash: deviceHash,
                    analytics_session_id: window.CredPixAnalytics ? window.CredPixAnalytics.getSessionId() : null,
                    base_path: typeof window.credpixGetBasePath === 'function'
                        ? window.credpixGetBasePath()
                        : (window.CREDPIX_BASE_PATH || ''),
                    name: client.nome,
                    document: client.documento,
                    email: client.email,
                    phone: client.telefone,
                    utms: getUTMs(),
                    lead: getLeadAnalyticsPayload(),
                };

                // Adicionar slug se disponivel (v4)
                if (linkSlug) body.link_slug = linkSlug;
                if (abSlug) body.ab_slug = abSlug;

                // A/B Preview Token (v4.1)
                const abTokenParam = new URLSearchParams(window.location.search).get('ab_token');
                if (abTokenParam) body.ab_token = abTokenParam;

                // Se link tem custom_utms, mergear com UTMs da URL
                if (linkData && linkData.custom_utms) {
                    body.utms = { ...body.utms, ...linkData.custom_utms };
                }

                const res = await fetch('api/pix.php?action=generate', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                const result = await parseApiJson(res);
                if (!result.success) throw new Error(result.error || 'Erro ao gerar PIX');

                statusPending.classList.remove('hidden');

                // Exibir
                transactionId = result.pix.transaction_id;
                pixExpiresAt = Date.now() + (5 * 60 * 1000); // 5 minutos

                if (result.pix.qr_code_base64) {
                    qrImage.src = result.pix.qr_code_base64.startsWith('data:') ? result.pix.qr_code_base64 : 'data:image/png;base64,' + result.pix.qr_code_base64;
                } else if (result.pix.qr_code_url) {
                    qrImage.src = result.pix.qr_code_url;
                } else {
                    qrImage.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(result.pix.qr_code);
                }

                setPixValue(result.pix.qr_code);
                if (isModelo2) showNominal(result.pix.qr_code);

                // PIX gerado apenas no servidor (pay/api/pix.php) — evita log duplicado

                // SEGURANCA: Salvar PIX no localStorage para evitar spam de F5 e abas novas
                localStorage.setItem(PIX_STORAGE_KEY, JSON.stringify({
                    transaction_id: result.pix.transaction_id,
                    qr_code: result.pix.qr_code,
                    qr_code_base64: result.pix.qr_code_base64 || '',
                    qr_code_url: result.pix.qr_code_url || '',
                    expiresAt: pixExpiresAt,
                    production: result.production === true
                }));

                loading.classList.add('hidden');
                qrContainer.style.display = 'block';

                startTimer(5 * 60);
                checkPaymentStatus(product.upsell_url);

            } catch (error) {
                // [B8] Error state amigavel em pt-BR + botao de retry. Nao expor mensagem tecnica.
                console.error('PIX generation error:', error);
                loading.classList.add('hidden');
                // Limpar conteudo anterior via DOM seguro (nao innerHTML)
                while (statusError.firstChild) statusError.removeChild(statusError.firstChild);
                const msg = document.createElement('div');
                const errMsg = (error && error.message) ? String(error.message) : '';
                msg.textContent = errMsg && errMsg.length < 120
                    ? errMsg
                    : 'Falha ao gerar PIX. Verifique sua conexao e tente novamente.';
                msg.style.marginBottom = '10px';
                const retryBtn = document.createElement('button');
                retryBtn.type = 'button';
                retryBtn.textContent = 'Tentar novamente';
                retryBtn.style.cssText = 'background:#18181b;color:#fff;border:none;border-radius:6px;padding:9px 20px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;';
                retryBtn.addEventListener('click', () => {
                    retryBtn.disabled = true;
                    retryBtn.style.opacity = '0.6';
                    statusError.style.display = 'none';
                    while (statusError.firstChild) statusError.removeChild(statusError.firstChild);
                    loading.classList.remove('hidden');
                    generatePIX().finally(() => {
                        retryBtn.disabled = false;
                        retryBtn.style.opacity = '1';
                    });
                });
                statusError.appendChild(msg);
                statusError.appendChild(retryBtn);
                statusError.style.display = 'block';
            }
        }

        // Timer
        function startTimer(seconds) {
            let remaining = seconds;
            const update = () => {
                const m = Math.floor(remaining / 60);
                const s = remaining % 60;
                timer.textContent = `Expira em ${m}:${s.toString().padStart(2, '0')}`;
                if (remaining <= 0) {
                    clearInterval(timerInterval);
                    timerInterval = null;
                    // Não parar checkInterval: muitos PIX são pagos depois do timer visual (5 min).
                    timer.textContent = 'Aguardando confirmação…';
                    const pendingText = statusPending.querySelector('.m2-status-text');
                    if (pendingText) {
                        pendingText.textContent = 'Ainda verificando pagamento. Pode pagar no app do banco.';
                    }
                }
                remaining--;
            };
            update();
            timerInterval = setInterval(update, 1000);
        }

        // Verificar pagamento (continua após o timer visual — PIX costuma ser pago depois)
        function checkPaymentStatus(upsellUrl) {
            if (checkInterval) {
                clearInterval(checkInterval);
            }
            checkInterval = setInterval(async () => {
                if (statusPollInFlight || paymentHandled) return;
                statusPollInFlight = true;
                try {
                    const res = await fetch('api/pix.php?action=status', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ transaction_id: transactionId })
                    });
                    const result = await parseApiJson(res);

                    if (result.success && result.status === 'paid') {
                        clearInterval(checkInterval);
                        checkInterval = null;
                        paymentConfirmed(upsellUrl);
                    }
                } catch (e) {}
                finally {
                    statusPollInFlight = false;
                }
            }, 3000);

            document.addEventListener('visibilitychange', function onVis() {
                if (document.visibilityState !== 'visible' || paymentHandled || !transactionId) return;
                fetch('api/pix.php?action=status', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ transaction_id: transactionId })
                })
                    .then(parseApiJson)
                    .then(function (result) {
                        if (result.success && result.status === 'paid') {
                            document.removeEventListener('visibilitychange', onVis);
                            paymentConfirmed(upsellUrl);
                        }
                    })
                    .catch(function () {});
            });
        }

        // Pagamento confirmado
        function paymentConfirmed(upsellUrl) {
            if (paymentHandled) return;
            paymentHandled = true;

            clearInterval(checkInterval);
            checkInterval = null;
            clearInterval(timerInterval);
            timerInterval = null;

            localStorage.removeItem(pixStorageKey());

            statusPending.classList.add('hidden');
            statusSuccess.classList.remove('hidden');
            timer.classList.add('hidden');

            if (window.CredPixGooglePixels && window.CredPixGooglePixels.isCheckoutPage()) {
                window.CredPixGooglePixels.firePaymentPixels({
                    transactionId: transactionId || '',
                    value: pixAmountBrl,
                    currency: 'BRL'
                });
            }

            if (window.CredPixAnalytics) {
                window.CredPixAnalytics.track('payment_paid', {
                    product_id: product.id,
                    amount_cents: Math.round((pixAmountBrl || 0) * 100),
                    funnel_step: 'payment_paid',
                    meta: { transaction_id: transactionId || '' },
                });
            }

            // Se nao tiver upsell, nao redireciona
            if (!upsellUrl || upsellUrl.trim() === '') {
                return;
            }

            setTimeout(() => {
                const utms = getUTMs();
                let url = upsellUrl;
                if (window.credpixPath) url = window.credpixPath(url);
                if (window.credpixAppendUtms) url = window.credpixAppendUtms(url);
                else if (Object.keys(utms).length) {
                    url += (url.includes('?') ? '&' : '?') + new URLSearchParams(utms).toString();
                }
                if (window.top !== window) {
                    window.top.location.href = url;
                } else {
                    window.location.href = url;
                }
            }, 2000);
        }

        // [B7] Copiar com fallback: navigator.clipboard falha em iframe cross-origin e iOS Safari
        // antigo. Cai no execCommand('copy') via textarea, e em ultimo caso seleciona input pra
        // cliente copiar manualmente (long-press em mobile).
        copyBtn.addEventListener('click', async () => {
            const code = pixCode.value;
            const label = copyBtnText || copyBtn;
            const originalText = 'Copiar codigo PIX';
            const setCopied = () => {
                copyBtn.classList.add('copied');
                label.textContent = 'Copiado!';
                setTimeout(() => {
                    label.textContent = originalText;
                    copyBtn.classList.remove('copied');
                }, 2000);
            };
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(code);
                    setCopied();
                    return;
                }
                throw new Error('no-clipboard-api');
            } catch (_) {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = code;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.focus();
                    ta.select();
                    ta.setSelectionRange(0, code.length);
                    const ok = document.execCommand('copy');
                    document.body.removeChild(ta);
                    if (ok) { setCopied(); return; }
                    throw new Error('exec-failed');
                } catch (err) {
                    // Ultimo recurso: seleciona o campo pra cliente copiar manual (long-press).
                    // [F3] Restaurar readonly apos timeout pra evitar que cliente edite o PIX acidentalmente.
                    pixCode.removeAttribute('readonly');
                    pixCode.focus();
                    pixCode.select();
                    label.textContent = 'Toque e segure p/ copiar';
                    setTimeout(() => {
                        label.textContent = originalText;
                        pixCode.setAttribute('readonly', 'readonly');
                    }, 3000);
                }
            }
        });

        // Modo teste

        loadProductPrice();
        if (window.CredPixGooglePixels && window.CredPixGooglePixels.isCheckoutPage()) {
            window.CredPixGooglePixels.getConfig().then(function (cfg) {
                window.CredPixGooglePixels.initGtag(cfg);
            });
        }
        generatePIX();
    </script>
    </body>
</html>
