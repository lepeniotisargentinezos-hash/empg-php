<?php
declare(strict_types=1);
ini_set('display_errors', '0');



require_once dirname(__DIR__) . '/lib/bootstrap.php';



credpix_load_env();



credpix_json(200, ['ok' => true]);

