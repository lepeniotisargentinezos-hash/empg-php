# Deploy com FileZilla (sem perder dados)

Se você sobe a pasta `empa` **inteira** pelo FileZilla, arquivos locais podem **sobrescrever** analytics, PIX, `.env` e pixels do servidor.

Use a pasta **`empa-deploy/`** — só código, sem dados de produção.

## Fluxo recomendado (FileZilla)

### 1. Gerar a pasta de deploy (no PC)

PowerShell, dentro da pasta `empa`:

```powershell
.\scripts\build-deploy-package.ps1
```

Isso cria:

- **`empa-deploy/`** → use esta pasta no FileZilla
- **`empa-deploy.zip`** → opcional (extrair no cPanel se preferir)

### 2. Conectar no FileZilla

| Lado | Caminho |
|------|---------|
| **Local (esquerda)** | `...\empa\empa-deploy` |
| **Remoto (direita)** | `public_html/empa` (ou onde o site está) |

### 3. Enviar arquivos

1. No lado **local**, entre em `empa-deploy`.
2. Selecione **tudo** (`Ctrl+A`).
3. Arraste para a pasta **`empa`** no servidor (lado direito).
4. Se perguntar sobre substituir arquivos: **Sim** / **Overwrite** (só arquivos de código).

### 4. O que NÃO fazer

- **Não** suba a pasta `empa` raiz inteira (a que contém `data/`).
- **Não** apague a pasta `empa` no servidor antes do upload.
- **Não** apague `data/` ou `.env` no servidor.

## O que permanece no servidor

Estes caminhos **não existem** em `empa-deploy/`, então o FileZilla **não os altera**:

| Caminho | Conteúdo |
|---------|----------|
| `data/analytics/` | Eventos, presença, backups |
| `data/pix/` | Transações PIX |
| `data/utmify/` | Logs Utmify |
| `.env` | Chaves, tokens, BASE_PATH |
| `config/google-pixels.json` | Pixels salvos no admin |
| `config/cpf-token.js` | Token CPF (se existir no servidor) |

## Painel Analytics (insights)

Se aparecer mensagem de “insights indisponível” ou painéis vazios, confirme estes arquivos **no servidor**:

| Arquivo | Função |
|---------|--------|
| `admin/analytics.html` | Dashboard |
| `admin/analytics-panel.js` | Pedidos avançados, mapa, webhooks |
| `admin/world-map-paths.js` | Mapa ao vivo |
| `lib/analytics-insights.php` | Dados de funil, estado, demografia, etc. |
| `lib/analytics.php` | API de estatísticas |

Teste no navegador (logado no painel): abra `…/admin/analytics-panel.js` — deve baixar/mostrar JavaScript, não 404.

Teste API: `…/api/analytics.php?days=1` com header `X-Analytics-Token` — deve retornar JSON com `"success":true` e `"stats"`.

## Configurações úteis no FileZilla

**Transfer → Transfer Type:** Automatic

**Transfer → Existing files:** em conflito, use *Overwrite if source file is newer* (padrão costuma servir).

Se um dia subir a pasta `empa` completa por engano, ative filtro antes do upload:

1. **View → Filename filters → Edit filter rules**
2. Crie filtro **CredPix — nao enviar**
3. Marque **Filter out items matching ALL of the following**
4. Adicione exclusoes (tipo *Directory* / *File name*):

| Tipo | Condição | Valor |
|------|----------|-------|
| Directory | is equal to | `data` |
| Directory | is equal to | `node_modules` |
| File name | is equal to | `.env` |
| File name | is equal to | `google-pixels.json` |
| File name | is equal to | `cpf-token.js` |

5. Ative o filtro em **View → Filename filters** antes de arrastar arquivos.

## Primeira instalacao (servidor vazio)

1. Suba `empa-deploy/` como acima.
2. Crie `.env` **no servidor** (FileZilla → botão direito → Create file) com as chaves de producao.
3. As pastas `data/analytics` e `data/pix` o PHP cria sozinhas na primeira execucao.

## Personalizar o que nao vai no deploy

Edite `deploy-exclude.txt` e rode o script de novo.
