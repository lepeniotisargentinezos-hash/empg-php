<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/bootstrap.php';
credpix_load_env();

function credpix_root_html_selector(string $value): string
{
    $value = trim($value);
    $value = ltrim(str_replace('\\', '/', $value), '/');
    $base = basename($value);
    return $base !== '' ? $base : 'index.html';
}

function credpix_root_html_key(string $value): string
{
    return strtolower(preg_replace('/\s+/', '', credpix_root_html_selector($value)));
}

function credpix_resolve_root_html(): string
{
    $root = __DIR__;
    $requested = credpix_root_html_selector((string) (getenv('ROOT_PAGE_HTML') ?: 'index.html'));
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

    $wanted = credpix_root_html_key($requested);
    foreach (glob($root . '/*.htm*') ?: [] as $path) {
        $name = basename($path);
        $withoutExt = preg_replace('/\.html?$/i', '', $name);
        if (credpix_root_html_key($name) === $wanted || credpix_root_html_key((string) $withoutExt) === $wanted) {
            return $path;
        }
    }

    return $root . '/index.html';
}

$file = credpix_resolve_root_html();
if (!is_file($file)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Página inicial não encontrada';
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
readfile($file);
