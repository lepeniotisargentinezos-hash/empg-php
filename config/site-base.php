<?php
declare(strict_types=1);

/**
 * Injeta BASE_PATH do .env antes do site-base.js (use em /empa2 com BASE_PATH=/empa2).
 */
header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-store');

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/amung.php';
require_once dirname(__DIR__) . '/lib/domains.php';
credpix_load_env();

$base = trim((string) (getenv('BASE_PATH') ?: ''));
$origin = trim((string) (getenv('PUBLIC_BASE_URL') ?: ''));

if ($base !== '') {
    echo 'window.CREDPIX_BASE_PATH=' . json_encode($base, JSON_UNESCAPED_SLASHES) . ";\n";
}
if ($origin !== '') {
    echo 'window.CREDPIX_PUBLIC_ORIGIN=' . json_encode(rtrim($origin, '/'), JSON_UNESCAPED_SLASHES) . ";\n";
}

$host = credpix_request_host();
if ($host !== '') {
    echo 'window.CREDPIX_HOST=' . json_encode($host, JSON_UNESCAPED_SLASHES) . ";\n";
}

$amungFunil = trim((string) (getenv('AMUNG_FUNIL') ?: 'emnads233310'));
$amungCheckout = trim((string) (getenv('AMUNG_CHECKOUT') ?: 'emnads233311'));
$amungUpsell = trim((string) (getenv('AMUNG_UPSELL') ?: 'emnads233312'));
echo 'window.CREDPIX_AMUNG_FUNIL=' . json_encode($amungFunil, JSON_UNESCAPED_SLASHES) . ";\n";
echo 'window.CREDPIX_AMUNG_CHECKOUT=' . json_encode($amungCheckout, JSON_UNESCAPED_SLASHES) . ";\n";
echo 'window.CREDPIX_AMUNG_UPSELL=' . json_encode($amungUpsell, JSON_UNESCAPED_SLASHES) . ";\n";

$counterSlot = trim((string) ($_GET['counter_slot'] ?? ''));
if (in_array($counterSlot, ['funil', 'funnel', 'checkout', 'upsell'], true)) {
    $counterCode = credpix_amung_code($counterSlot);
    echo 'window.CREDPIX_VIEW_COUNTER_CODE=' . json_encode($counterCode, JSON_UNESCAPED_SLASHES) . ";\n";
}

$js = __DIR__ . '/site-base.js';
if (is_readable($js)) {
    readfile($js);
} else {
    echo "console.error('CredPix: site-base.js não encontrado');\n";
}
