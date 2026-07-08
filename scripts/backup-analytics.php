<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/admin-auth.php';
require_once dirname(__DIR__) . '/lib/analytics.php';

credpix_load_env();

$secret = credpix_admin_secret();
$provided = $argv[1] ?? getenv('BACKUP_CRON_TOKEN') ?: '';
if ($secret !== '' && !hash_equals($secret, $provided)) {
    fwrite(STDERR, "Token invalido. Use: php scripts/backup-analytics.php SEU_ANALYTICS_SECRET\n");
    exit(1);
}

$result = credpix_analytics_run_backup();
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
