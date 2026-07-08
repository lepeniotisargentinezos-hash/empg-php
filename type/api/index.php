<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/lib/bootstrap.php';
require_once dirname(__DIR__, 2) . '/lib/wizard-api.php';

credpix_load_env();

$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($uri, PHP_URL_PATH) ?: '/';
$path = rawurldecode($path);

$marker = '/type/api';
$pos = strpos($path, $marker);
$subPath = $pos === false ? '' : ltrim(substr($path, $pos + strlen($marker)), '/');

credpix_wizard_handle($subPath);
