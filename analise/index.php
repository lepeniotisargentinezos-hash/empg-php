<?php
declare(strict_types=1);
ini_set('display_errors', '0');
header('Content-Type: text/html; charset=UTF-8');

$html = file_get_contents(__DIR__ . '/index.html');

// Injeta override de BASE_PATH logo após site-base.php para que
// site-base.js não detecte "/analise" como subpasta do funil
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
