<?php
declare(strict_types=1);

/**
 * Remove heartbeats e wizard_step dos logs de analytics.
 * Uso no servidor: php scripts/purge-analytics-noise.php
 */
require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/analytics.php';

credpix_load_env();

$result = credpix_analytics_purge_noise_events();
echo 'Arquivos: ' . $result['files'] . PHP_EOL;
echo 'Linhas removidas: ' . $result['removed'] . PHP_EOL;
echo 'Linhas mantidas: ' . $result['kept'] . PHP_EOL;
