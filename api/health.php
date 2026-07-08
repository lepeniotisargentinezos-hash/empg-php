<?php

declare(strict_types=1);



require_once dirname(__DIR__) . '/lib/bootstrap.php';



credpix_load_env();



credpix_json(200, ['ok' => true]);

