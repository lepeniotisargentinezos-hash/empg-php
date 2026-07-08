<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/admin-auth.php';
require_once dirname(__DIR__) . '/lib/security.php';
require_once dirname(__DIR__) . '/lib/analytics.php';

credpix_load_env();

register_shutdown_function(static function (): void {
    $err = error_get_last();
    if (!$err || !in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        return;
    }
    if (headers_sent()) {
        return;
    }
    $msg = $err['message'] ?? 'erro fatal';
    if (stripos($msg, 'memory') !== false) {
        $msg = 'Memória PHP esgotada ao processar analytics. Suba lib/analytics-scan.php ou use purge_noise.';
    }
    credpix_json(500, [
        'success' => false,
        'error' => $msg,
        'fatal' => true,
        'file' => isset($err['file']) ? basename((string) $err['file']) : null,
        'line' => $err['line'] ?? null,
    ]);
});

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
credpix_cors_send();
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Analytics-Token, X-Analytics-Ingest');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$authHeader = $_SERVER['HTTP_X_ANALYTICS_TOKEN'] ?? '';
$ingestHeader = $_SERVER['HTTP_X_ANALYTICS_INGEST'] ?? '';

if ($method === 'POST') {
    if (credpix_analytics_verify_auth($authHeader, null)) {
        $raw = file_get_contents('php://input') ?: '';
        $body = json_decode($raw, true);
        if (is_array($body)) {
            if (($body['action'] ?? '') === 'ad_spend') {
                credpix_json(200, [
                    'success' => true,
                    'ad_spend' => credpix_insights_save_ad_spend(is_array($body['by_src'] ?? null) ? $body['by_src'] : []),
                ]);
            }
            if (($body['action'] ?? '') === 'daily_goal') {
                $reais = (float) ($body['target_reais'] ?? 0);
                $cents = (int) round(max(0, $reais) * 100);
                credpix_json(200, [
                    'success' => true,
                    'daily_goal' => credpix_insights_save_daily_goal($cents),
                ]);
            }
            if (($body['action'] ?? '') === 'alerts_config') {
                credpix_json(200, [
                    'success' => true,
                    'config' => credpix_insights_save_alerts_config(is_array($body['config'] ?? null) ? $body['config'] : []),
                ]);
            }
            if (($body['action'] ?? '') === 'utmify_retry') {
                $txId = trim((string) ($body['transaction_id'] ?? ''));
                $result = credpix_utmify_retry_order($txId);
                credpix_json(200, array_merge(['success' => !empty($result['ok'])], $result));
            }
        }
        credpix_json(400, ['success' => false, 'error' => 'Ação POST inválida']);
    }

    $raw = file_get_contents('php://input') ?: '';
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        credpix_json(400, ['success' => false, 'error' => 'JSON inválido']);
    }

    $events = isset($body['events']) && is_array($body['events']) ? $body['events'] : [$body];
    $fullIngest = credpix_analytics_ingest_verify($ingestHeader);
    if (!$fullIngest) {
        credpix_rate_limit_or_429('analytics_ingest_public', 180, 60);
        foreach ($events as $ev) {
            if (!is_array($ev) || !credpix_analytics_event_allowed_public($ev)) {
                credpix_json(401, ['success' => false, 'error' => 'Ingest não autorizado para este evento']);
            }
        }
    }

    $saved = [];
    try {
        foreach ($events as $ev) {
            if (is_array($ev)) {
                $saved[] = credpix_analytics_append($ev);
            }
        }
    } catch (Throwable $e) {
        credpix_json(500, ['success' => false, 'error' => $e->getMessage()]);
    }

    credpix_json(200, ['success' => true, 'count' => count($saved)]);
}

if ($method === 'GET') {
    if (!credpix_analytics_verify_auth($authHeader, null)) {
        credpix_json(401, ['success' => false, 'error' => 'Token inválido']);
    }

    $days = max(1, min(90, (int) ($_GET['days'] ?? 1)));
    $src = isset($_GET['src']) ? trim((string) $_GET['src']) : null;
    if ($src === '') {
        $src = null;
    }
    $product = isset($_GET['product']) ? trim((string) $_GET['product']) : null;
    if ($product === '') {
        $product = null;
    }
    $utmCampaign = isset($_GET['utm_campaign']) ? trim((string) $_GET['utm_campaign']) : null;
    if ($utmCampaign === '') {
        $utmCampaign = null;
    }
    $utmMedium = isset($_GET['utm_medium']) ? trim((string) $_GET['utm_medium']) : null;
    if ($utmMedium === '') {
        $utmMedium = null;
    }
    $utmContent = isset($_GET['utm_content']) ? trim((string) $_GET['utm_content']) : null;
    if ($utmContent === '') {
        $utmContent = null;
    }

    if (isset($_GET['action']) && $_GET['action'] === 'backup') {
        credpix_json(200, ['success' => true, 'backup' => credpix_analytics_run_backup()]);
    }

    if (isset($_GET['action']) && $_GET['action'] === 'session') {
        $sessionId = trim((string) ($_GET['session_id'] ?? ''));
        credpix_json(200, [
            'success' => true,
            'journey' => credpix_analytics_session_journey($sessionId, $days),
        ]);
    }

    if (isset($_GET['action']) && $_GET['action'] === 'utmify_logs') {
        $limit = max(5, min(100, (int) ($_GET['limit'] ?? 30)));
        credpix_json(200, [
            'success' => true,
            'logs' => credpix_utmify_read_recent_logs($limit),
        ]);
    }

    if (isset($_GET['export']) && $_GET['export'] === 'orders') {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="credpix-pedidos-' . $days . 'd.csv"');
        echo credpix_analytics_export_orders_csv($days, $src, $product, $utmCampaign, $utmMedium, $utmContent);
        exit;
    }

    if (isset($_GET['export']) && $_GET['export'] === 'csv') {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="credpix-analytics-' . $days . 'd.csv"');
        echo credpix_analytics_export_csv($days, $src, $product, $utmCampaign, $utmMedium, $utmContent);
        exit;
    }

    if (isset($_GET['action']) && $_GET['action'] === 'purge_noise') {
        credpix_json(200, [
            'success' => true,
            'result' => credpix_analytics_purge_noise_events(),
        ]);
    }

    if (isset($_GET['action']) && $_GET['action'] === 'reconcile_payments') {
        $days = max(1, min(30, (int) ($_GET['days'] ?? 7)));
        $limit = max(1, min(100, (int) ($_GET['limit'] ?? 40)));
        credpix_json(200, [
            'success' => true,
            'result' => credpix_analytics_reconcile_missing_payments($days, $limit),
        ]);
    }

    if (isset($_GET['action']) && $_GET['action'] === 'backfill_enrichment') {
        $days = max(1, min(90, (int) ($_GET['days'] ?? 30)));
        $profileLimit = max(0, min(100, (int) ($_GET['profile_limit'] ?? 40)));
        $geoLimit = max(0, min(200, (int) ($_GET['geo_limit'] ?? 80)));
        credpix_json(200, [
            'success' => true,
            'result' => credpix_analytics_backfill_enrichment($days, $profileLimit, $geoLimit),
        ]);
    }

    if (isset($_GET['action']) && $_GET['action'] === 'archive') {
        credpix_json(200, [
            'success' => true,
            'result' => credpix_analytics_maybe_archive_old_events(),
        ]);
    }

    if (isset($_GET['action']) && $_GET['action'] === 'ping') {
        credpix_json(200, [
            'success' => true,
            'auth' => 'ok',
            'server_time' => time(),
            'analytics_dir_writable' => is_writable(credpix_analytics_dir()),
        ]);
    }

    if (isset($_GET['action']) && $_GET['action'] === 'diagnostics') {
        $probeDays = isset($_GET['probe_stats']) ? (int) $_GET['probe_stats'] : null;
        if ($probeDays !== null && $probeDays <= 0) {
            $probeDays = null;
        }
        credpix_json(200, [
            'success' => true,
            'diagnostics' => credpix_analytics_diagnostics($probeDays),
        ]);
    }

    try {
        $stats = credpix_analytics_stats_for_dashboard($days, $src, $product, $utmCampaign, $utmMedium, $utmContent);
        credpix_json(200, ['success' => true, 'stats' => $stats]);
    } catch (Throwable $e) {
        credpix_json(500, ['success' => false, 'error' => 'Erro ao gerar estatísticas: ' . $e->getMessage()]);
    }
}

credpix_json(405, ['success' => false, 'error' => 'Método não permitido']);
