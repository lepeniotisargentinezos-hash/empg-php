<?php
declare(strict_types=1);

/**
 * Define CREDPIX_VIEW_COUNTER_CODE para páginas estáticas (upsell, obrigado).
 * Uso: <script src="../../../config/amung-counter.php?slot=upsell"></script>
 */
header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-store');

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/amung.php';

$slot = trim((string) ($_GET['slot'] ?? 'upsell'));
if (!in_array($slot, ['funil', 'funnel', 'checkout', 'upsell'], true)) {
    $slot = 'upsell';
}

$code = credpix_amung_code($slot);
echo 'window.CREDPIX_VIEW_COUNTER_CODE=' . json_encode($code, JSON_UNESCAPED_SLASHES) . ";\n";
