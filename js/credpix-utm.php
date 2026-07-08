<?php
declare(strict_types=1);

/**
 * Serve credpix-utm.js sem cache agressivo (CDN).
 */
header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$js = __DIR__ . '/credpix-utm.js';
if (!is_readable($js)) {
    http_response_code(404);
    echo "console.error('CredPix: credpix-utm.js não encontrado');\n";
    exit;
}
readfile($js);
