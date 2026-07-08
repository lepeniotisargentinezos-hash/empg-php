<?php
declare(strict_types=1);

/**
 * Serve credpix-view-counter.js sem cache agressivo (CDN/subdomínio).
 */
header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$js = __DIR__ . '/credpix-view-counter.js';
if (!is_readable($js)) {
    http_response_code(404);
    echo "console.error('CredPix: credpix-view-counter.js não encontrado');\n";
    exit;
}
readfile($js);
