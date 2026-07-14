<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/masterfy.php';
require_once __DIR__ . '/anubis.php';
require_once __DIR__ . '/gateway.php';

function credpix_webhook_log_path(): string
{
    $dir = credpix_root() . '/data/analytics';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir . '/webhook-log.jsonl';
}

function credpix_webhook_log_append(array $row): void
{
    $payload = array_merge(['ts' => (int) round(microtime(true) * 1000)], $row);
    file_put_contents(
        credpix_webhook_log_path(),
        json_encode($payload, JSON_UNESCAPED_UNICODE) . "\n",
        FILE_APPEND | LOCK_EX
    );
}

function credpix_webhook_log_read(int $limit = 500): array
{
    $path = credpix_webhook_log_path();
    if (!is_file($path)) {
        return [];
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    $rows = [];
    foreach (array_slice($lines, -$limit) as $line) {
        $row = json_decode($line, true);
        if (is_array($row)) {
            $rows[] = $row;
        }
    }
    return $rows;
}

function credpix_webhook_health(): array
{
    $activeGateway = credpix_active_gateway();
    $allRows = credpix_webhook_log_read(1000);

    // Filtra entradas pelo gateway ativo; entradas sem campo 'gateway' assumem 'masterfy'
    $rows = array_filter($allRows, static function (array $row) use ($activeGateway): bool {
        return ($row['gateway'] ?? 'masterfy') === $activeGateway;
    });

    $now    = (int) round(microtime(true) * 1000);
    $dayAgo = $now - 86400000;
    $count24h  = 0;
    $invalid24h = 0;
    $paid24h    = 0;
    $lastAt     = null;
    $lastPaidAt = null;
    $lastStatus = null;

    foreach ($rows as $row) {
        $ts = (int) ($row['ts'] ?? 0);
        if ($lastAt === null || $ts > $lastAt) {
            $lastAt     = $ts;
            $lastStatus = $row['status'] ?? null;
        }
        if ($ts < $dayAgo) {
            continue;
        }
        $count24h++;
        if (empty($row['signature_valid'])) {
            $invalid24h++;
        }
        if (($row['status'] ?? '') === 'paid') {
            $paid24h++;
            if ($lastPaidAt === null || $ts > $lastPaidAt) {
                $lastPaidAt = $ts;
            }
        }
    }

    if ($activeGateway === 'anubis') {
        $configured      = credpix_anubis_configured();
        $healthy         = $configured && ($count24h === 0 || $invalid24h === 0);
        $secretFingerprt = null;
        $webhookUrl      = credpix_anubis_webhook_url();
    } else {
        $configured      = (getenv('WEBHOOK_SECRET') ?: '') !== '';
        $healthy         = $configured && ($count24h === 0 || $invalid24h === 0);
        $secretFingerprt = credpix_masterfy_webhook_secret_fingerprint();
        $webhookUrl      = credpix_pay_webhook_url();
    }

    return [
        'secret_configured'      => $configured,
        'secret_fingerprint'     => $secretFingerprt,
        'webhook_url'            => $webhookUrl,
        'healthy'                => $healthy,
        'webhooks_24h'           => $count24h,
        'invalid_signature_24h'  => $invalid24h,
        'paid_webhooks_24h'      => $paid24h,
        'last_webhook_at'        => $lastAt,
        'last_paid_at'           => $lastPaidAt,
        'last_status'            => $lastStatus,
        'gateway'                => $activeGateway,
    ];
}
