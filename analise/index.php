<?php
declare(strict_types=1);
ini_set('display_errors', '0');

require_once __DIR__ . '/../lib/bootstrap.php';
credpix_load_env();

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store');

// --------------------------------------------------------------------------
// Controle da rota /analise via env ANALISE_MIRROR_HOME:
//   - vazio / 1 / true / yes / on  -> /analise espelha a HOME (ROOT_PAGE_HTML)
//   - 0 / false / no / off         -> /analise mostra a pagina original
//                                     (analise/index.html) — comportamento antigo
//
// Cada dominio e um deploy separado, entao basta definir a env por dominio.
// --------------------------------------------------------------------------

function credpix_analise_mirror_enabled(): bool
{
    $raw = strtolower(trim((string) (getenv('ANALISE_MIRROR_HOME') ?: '')));
    if ($raw === '') {
        return true; // padrao: espelha a home
    }
    return !in_array($raw, ['0', 'false', 'no', 'off', 'nao', 'não'], true);
}

// -------- Modo desligado: serve a pagina original de /analise --------
if (!credpix_analise_mirror_enabled()) {
    $self = __DIR__ . '/index.html';
    if (!is_file($self)) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Página não encontrada';
        exit;
    }

    $html = (string) file_get_contents($self);

    // Impede que site-base.js detecte "/analise" como subpasta do funil.
    $override = '<script>window.CREDPIX_BASE_PATH="";'
        . 'if(typeof window.credpixLockBasePath==="function")window.credpixLockBasePath("");'
        . 'window.credpixGetBasePath=function(){return "";};'
        . 'window.credpixResolveBasePath=function(){return "";};</script>';

    $html = str_replace(
        '<script src="../config/site-base.php"></script>',
        '<script src="../config/site-base.php"></script>' . $override,
        $html
    );

    echo $html;
    exit;
}

// -------- Modo ligado (padrao): espelha a HOME respeitando ROOT_PAGE_HTML --------

function credpix_analise_html_selector(string $value): string
{
    $value = trim($value);
    $value = ltrim(str_replace('\\', '/', $value), '/');
    $base = basename($value);
    return $base !== '' ? $base : 'index.html';
}

function credpix_analise_html_key(string $value): string
{
    return strtolower(preg_replace('/\s+/', '', credpix_analise_html_selector($value)));
}

function credpix_analise_resolve_home(): string
{
    $root = dirname(__DIR__);
    $requested = credpix_analise_html_selector((string) (getenv('ROOT_PAGE_HTML') ?: 'index.html'));
    $candidates = [$requested];
    if (!preg_match('/\.html?$/i', $requested)) {
        $candidates[] = $requested . '.html';
    }

    foreach ($candidates as $name) {
        $path = $root . '/' . $name;
        if (is_file($path) && realpath(dirname($path)) === realpath($root)) {
            return $path;
        }
    }

    $wanted = credpix_analise_html_key($requested);
    foreach (glob($root . '/*.htm*') ?: [] as $path) {
        $name = basename($path);
        $withoutExt = preg_replace('/\.html?$/i', '', $name);
        if (credpix_analise_html_key($name) === $wanted || credpix_analise_html_key((string) $withoutExt) === $wanted) {
            return $path;
        }
    }

    return $root . '/index.html';
}

$home = credpix_analise_resolve_home();
if (!is_file($home)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Página inicial não encontrada';
    exit;
}

$html = (string) file_get_contents($home);

// <base href="/"> para que assets relativos (js/, css/, config/, images/)
// resolvam a partir da raiz do dominio, e nao de /analise/.
$html = preg_replace('/<head\b[^>]*>/i', '$0' . "\n  <base href=\"/\">", $html, 1);

// Impede que site-base.js detecte "/analise" como subpasta do funil.
$override = '<script>window.CREDPIX_BASE_PATH="";'
    . 'if(typeof window.credpixLockBasePath==="function")window.credpixLockBasePath("");'
    . 'window.credpixGetBasePath=function(){return "";};'
    . 'window.credpixResolveBasePath=function(){return "";};</script>';

$html = str_replace(
    '<script src="config/site-base.php"></script>',
    '<script src="config/site-base.php"></script>' . $override,
    $html
);

echo $html;
