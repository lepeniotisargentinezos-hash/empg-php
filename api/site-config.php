<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/bootstrap.php';
credpix_load_env();

/* ── Auth ───────────────────────────────────────────────────────── */
$token    = $_SERVER['HTTP_X_ANALYTICS_TOKEN'] ?? '';
$expected = (string)(getenv('ANALYTICS_SECRET') ?: '');
if ($token === '' || !hash_equals($expected, $token)) {
    credpix_json(401, ['error' => 'Unauthorized']);
}

/* ── Env file detection ─────────────────────────────────────────── */
$root    = credpix_root();
$envFile = is_file($root . '/.env.local') ? $root . '/.env.local' : $root . '/.env';

/* ── Whitelist de variáveis editáveis ───────────────────────────── */
$GROUPS = [
    [
        'id'    => 'pagamento',
        'label' => 'Pagamento',
        'icon'  => '💳',
        'vars'  => [
            ['key' => 'PAYMENT_GATEWAY',  'label' => 'Gateway ativo',       'type' => 'select', 'options' => ['anubis', 'masterfy']],
            ['key' => 'MASTERFY_API_KEY', 'label' => 'MasterFy API Key',    'type' => 'password'],
            ['key' => 'ANUBIS_PUBLIC_KEY','label' => 'AnubisPay Public Key','type' => 'text'],
            ['key' => 'ANUBIS_SECRET_KEY','label' => 'AnubisPay Secret Key','type' => 'password'],
            ['key' => 'WEBHOOK_SECRET',   'label' => 'Webhook Secret',      'type' => 'password'],
        ],
    ],
    [
        'id'    => 'analytics',
        'label' => 'Analytics',
        'icon'  => '📊',
        'vars'  => [
            ['key' => 'ANALYTICS_SECRET',     'label' => 'Token admin (leitura)',  'type' => 'password'],
            ['key' => 'ANALYTICS_INGEST_KEY', 'label' => 'Token ingest (escrita)', 'type' => 'password'],
        ],
    ],
    [
        'id'    => 'utmify',
        'label' => 'UTMify',
        'icon'  => '📣',
        'vars'  => [
            ['key' => 'UTMIFY_API_TOKEN',        'label' => 'API Token',       'type' => 'password'],
            ['key' => 'UTMIFY_PLATFORM',         'label' => 'Plataforma',      'type' => 'text'],
            ['key' => 'UTMIFY_GOOGLE_PIXEL_ID',  'label' => 'Google Pixel ID', 'type' => 'text'],
        ],
    ],
    [
        'id'    => 'google',
        'label' => 'Google Ads',
        'icon'  => '🎯',
        'vars'  => [
            ['key' => 'GOOGLE_PIXEL_ID',          'label' => 'Pixel ID',        'type' => 'text'],
            ['key' => 'GOOGLE_PIXEL_LABEL',       'label' => 'Rótulo',          'type' => 'text'],
            ['key' => 'GOOGLE_PIXEL_DESCRIPTION', 'label' => 'Descrição',       'type' => 'text'],
        ],
    ],
    [
        'id'    => 'cpf',
        'label' => 'Consulta CPF',
        'icon'  => '🪪',
        'vars'  => [
            ['key' => 'CPF_BRASIL_API_KEY',  'label' => 'Brasil API Key',       'type' => 'password'],
            ['key' => 'CPF_API_TOKEN',        'label' => 'Elaiflow Token',        'type' => 'password'],
            ['key' => 'CPF_CLIENT_DIRECT',    'label' => 'Consulta no browser',  'type' => 'select', 'options' => ['0', '1']],
            ['key' => 'REMOTE_CPF',           'label' => 'CPF remoto (legado)',  'type' => 'select', 'options' => ['0', '1']],
        ],
    ],
    [
        'id'    => 'amung',
        'label' => 'Amung (contadores)',
        'icon'  => '📡',
        'vars'  => [
            ['key' => 'AMUNG_FUNIL',    'label' => 'Funil ID',    'type' => 'text'],
            ['key' => 'AMUNG_CHECKOUT', 'label' => 'Checkout ID', 'type' => 'text'],
            ['key' => 'AMUNG_UPSELL',   'label' => 'Upsell ID',   'type' => 'text'],
        ],
    ],
    [
        'id'    => 'site',
        'label' => 'Site',
        'icon'  => '🌐',
        'vars'  => [
            ['key' => 'ROOT_PAGE_HTML', 'label' => 'Página inicial HTML', 'type' => 'text'],
        ],
    ],
];

$ALL_ALLOWED = [];
foreach ($GROUPS as $g) {
    foreach ($g['vars'] as $v) {
        $ALL_ALLOWED[] = $v['key'];
    }
}

/* ── Helpers ────────────────────────────────────────────────────── */
function readEnvLines(string $file): array
{
    return is_file($file) ? file($file, FILE_IGNORE_NEW_LINES) : [];
}

function getEnvFileValue(array $lines, string $key): string
{
    foreach ($lines as $line) {
        $t = trim($line);
        if ($t === '' || $t[0] === '#') {
            continue;
        }
        $eq = strpos($t, '=');
        if ($eq === false) {
            continue;
        }
        $k = trim(substr($t, 0, $eq));
        if ($k !== $key) {
            continue;
        }
        $v = trim(substr($t, $eq + 1));
        if (strlen($v) >= 2 &&
            (($v[0] === '"' && $v[-1] === '"') || ($v[0] === "'" && $v[-1] === "'"))) {
            $v = substr($v, 1, -1);
        }
        return $v;
    }
    return (string)(getenv($key) ?: '');
}

/* ── GET ────────────────────────────────────────────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $lines  = readEnvLines($envFile);
    $values = [];
    foreach ($ALL_ALLOWED as $key) {
        $values[$key] = getEnvFileValue($lines, $key);
    }
    credpix_json(200, [
        'success'  => true,
        'config'   => $values,
        'groups'   => $GROUPS,
        'env_file' => basename($envFile),
    ]);
}

/* ── POST ───────────────────────────────────────────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body    = (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
    $updates = (array)($body['updates'] ?? []);

    foreach (array_keys($updates) as $key) {
        if (!in_array($key, $ALL_ALLOWED, true)) {
            credpix_json(400, ['error' => 'Chave não permitida: ' . $key]);
        }
    }

    $lines   = readEnvLines($envFile);
    $applied = [];

    foreach ($updates as $key => $val) {
        $val   = (string)$val;
        $found = false;
        foreach ($lines as &$line) {
            $t = trim($line);
            if ($t === '' || $t[0] === '#') {
                continue;
            }
            $eq = strpos($t, '=');
            if ($eq === false) {
                continue;
            }
            $k = trim(substr($t, 0, $eq));
            if ($k === $key) {
                $line  = $key . '=' . $val;
                $found = true;
                break;
            }
        }
        unset($line);
        if (!$found) {
            $lines[] = $key . '=' . $val;
        }
        $applied[] = $key;
    }

    file_put_contents($envFile, implode("\n", $lines) . "\n");
    credpix_json(200, ['success' => true, 'updated' => $applied]);
}

credpix_json(405, ['error' => 'Method not allowed']);
