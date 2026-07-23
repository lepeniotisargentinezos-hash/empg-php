# CredPix · Funil de Empréstimo v2

Plataforma multi-domínio para captação de leads e cobrança via PIX, com painel administrativo centralizado (Hub Central) para monitorar múltiplos sites simultaneamente.

## Estrutura

```
empg/
├── index.html              # Landing principal
├── analise/                # Landing alternativa (/analise)
├── type/wizard/            # Formulário multi-etapa (React bundle)
├── pay/                    # Checkout PIX + upsells
│   ├── checkout.php
│   ├── api/
│   │   ├── pix.php         # Gera PIX + polling status
│   │   └── webhook-anubis.php
│   └── js/google-pixels.js
├── up/upsell/              # 20 upsells sequenciais (up1..up20)
├── api/                    # Endpoints públicos
│   ├── analytics.php       # Ingestão + leitura de eventos
│   ├── recent-events.php   # Feed do hub sem cache
│   ├── anubis-health.php   # Health check AnubisPay
│   ├── anubis-wallet.php   # Saldo + saques
│   ├── site-config.php     # Editor de .env remoto
│   └── google-pixels.php   # CRUD pixels
├── admin/                  # Painel analytics local
├── config/                 # Produtos, pixels, base-path
├── lib/                    # PHP core (analytics, anubis, gateway…)
├── js/                     # Tracking, boot, UTMs
└── hub-server/             # Node.js Hub Central (dashboard multi-site)
```

## Gateway de pagamento

- **AnubisPay** (padrão) — via `PAYMENT_GATEWAY=anubis`
- **MasterFy** — via `PAYMENT_GATEWAY=masterfy`
- **Novus Pagamentos** — via `PAYMENT_GATEWAY=novus`

Trocar no `.env` sem redeploy (aceita hot-reload). Endpoints de webhook:

- Anubis → `/pay/api/webhook-anubis.php`
- MasterFy → `/pay/api/webhook.php`
- Novus → `/pay/api/webhook-novus.php`

## Rota /analise

Por padrão, `/analise` espelha a home (a página resolvida por `ROOT_PAGE_HTML`),
resolvendo os assets a partir da raiz do domínio. Para desligar o espelhamento
em um domínio específico e voltar a servir a landing original (`analise/index.html`):

- `ANALISE_MIRROR_HOME=1` (ou vazio) → `/analise` = home (padrão)
- `ANALISE_MIRROR_HOME=0` → `/analise` = landing original de análise

Configuração por domínio (cada deploy tem sua própria env), sem redeploy.

## Fluxo do funil

```
Landing (/analise) → Wizard (29 passos) → Checkout PIX principal
    → Up1 → Up2 → Up3 → ... → Up20 → /up/obrigado.html
```

Cada `upX` é uma oferta upsell independente. O redirecionamento para o próximo passo é feito no browser (JS) após confirmar o pagamento via polling em `/api/pix.php?action=status`.

## Analytics

- Eventos armazenados em `data/analytics/events-YYYY-MM-DD.jsonl`
- Cache de estatísticas: `ANALYTICS_STATS_CACHE_SEC=10` (segundos)
- Ingestão via `POST /api/analytics.php` (token: `ANALYTICS_INGEST_KEY`)
- Presença ao vivo via `presence.json` (60s de janela)

## UTMify Pixel Google

Para carregar o script `https://cdn.utmify.com.br/scripts/pixel/pixel-google.js` pelo `.env`, defina:

```env
UTMIFY_GOOGLE_PIXEL_ID=6a5d01fff7246c8917517143
```

O script é carregado automaticamente nas páginas que incluem `config/site-base.php`/`config/site-base.js`, exceto no `/admin`.

## Google Ads Pixel

Para trocar o pixel Google Ads pelo `.env`, defina o ID e o rótulo:

```env
GOOGLE_PIXEL_ID=AW-18028205675
GOOGLE_PIXEL_LABEL=Bm9ECLyb-lscEOuswpRD
GOOGLE_PIXEL_DESCRIPTION=minha-conta
```

Quando `GOOGLE_PIXEL_ID` e `GOOGLE_PIXEL_LABEL` estão configurados, eles têm prioridade sobre `data/config/google-pixels.json`. A descrição é opcional.

## Hub Central

Node.js standalone em `hub-server/`. Roda em porta 3001 por padrão, faz proxy autenticado para os `/api/*.php` dos sites cadastrados.

**Executar local:**
```bash
cd hub-server
node server.js  # http://localhost:3001/hub
```

**.env do Hub:**
```
HUB_SECRET=<senha-de-acesso>
PORT=3001
ANUBIS_PUBLIC_KEY=<key>
ANUBIS_SECRET_KEY=<key>
```

## Deploy

Deploy automático via GitHub webhook no EasyPanel:

```bash
git add -A
git commit -m "descrição"
git push origin main
```

O EasyPanel detecta o push e rebuilda em ~30s.

**Volumes persistentes** (obrigatório configurar no EasyPanel):
- `/var/www/html/data` → volume `empg-data-<siteId>`

Sem volume, dados de runtime (transações, analytics, presence) são perdidos a cada deploy.

## Variáveis de ambiente

```
# Pagamento
PAYMENT_GATEWAY=anubis          # anubis | masterfy | novus
ANUBIS_PUBLIC_KEY=<...>
ANUBIS_SECRET_KEY=<...>
MASTERFY_API_KEY=<...>          # opcional
NOVUS_API_KEY=<...>             # opcional — chave privada do painel Novus
NOVUS_WEBHOOK_SECRET=<...>      # opcional — whsec_... para webhook global (se não usar, valida com NOVUS_API_KEY)
WEBHOOK_SECRET=<...>

# Analytics
ANALYTICS_SECRET=<token-admin>
ANALYTICS_INGEST_KEY=<token-ingest>
ANALYTICS_STATS_CACHE_SEC=10
ANALYTICS_LIVE=1

# Consulta CPF
CPF_BRASIL_API_KEY=<...>
CPF_API_TOKEN=<...>
CPF_CLIENT_DIRECT=1

# UTMify (tracking de vendas)
UTMIFY_API_TOKEN=<...>
UTMIFY_PLATFORM=master

# Contadores Amung (opcional)
AMUNG_FUNIL=
AMUNG_CHECKOUT=
AMUNG_UPSELL=

# Base
BASE_PATH=
PUBLIC_BASE_URL=
```

## Metadata enviado ao gateway

Dados do wizard são incluídos no `metadata` da AnubisPay (nomes em português):

- `prestador`, `codigo_externo`, `etapa`
- `nome_produto`, `referencia_produto`
- `valor_emprestimo`, `num_parcelas`, `valor_parcela`, `valor_total`
- `dia_vencimento`, `primeira_parcela`
- `chave_pix`, `tipo_pix`, `metodo_pagamento`
- `renda_mensal`, `tipo_renda`, `telefone`
- `origem`, `fonte`, `meio`, `campanha`, `conteudo`, `termo`

## Comandos úteis

```bash
# Testar geração de PIX
curl -X POST "https://SITE/pay/api/pix.php?action=generate" \
  -H "Content-Type: application/json" \
  -d '{"product_id":"prod_698630abcbdde","name":"Teste","document":"12345678909","email":"t@t.com","phone":"11999999999"}'

# Consultar status
curl -X POST "https://SITE/pay/api/pix.php?action=status" \
  -H "Content-Type: application/json" \
  -d '{"transaction_id":"<txid>"}'

# Simular webhook AnubisPay (marcar como pago)
curl -X POST "https://SITE/pay/api/webhook-anubis.php" \
  -H "Content-Type: application/json" \
  -d '{"Id":"<txid>","Status":"PAID","Amount":39.86,"PaidAt":"2026-07-14T12:00:00Z"}'

# Simular webhook Novus (assinatura HMAC-SHA256 do body com NOVUS_API_KEY ou NOVUS_WEBHOOK_SECRET)
curl -X POST "https://SITE/pay/api/webhook-novus.php" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: <hmac-sha256-hex>" \
  -d '{"invoice_id":"<invoice_id>","status":"paid","total_cents":3986,"event":"invoice.paid","paid_at":"2026-07-14T12:00:00Z"}'

# Health check completo
curl "https://SITE/api/health.php"
curl -H "X-Analytics-Token: <token>" "https://SITE/api/anubis-health.php"
```

## Stack

- **PHP 8.2** + Apache (mod_rewrite, mod_headers, mod_setenvif)
- **Node.js 18+** (hub-server)
- **AnubisPay API v1** / **MasterFy API v1** / **Novus Pagamentos API v2**
- Docker (image `php:8.2-apache`)
