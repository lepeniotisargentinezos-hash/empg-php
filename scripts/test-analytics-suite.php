<?php
declare(strict_types=1);

/**
 * Suite de testes do analytics (rodar local ou no servidor).
 * Uso: php scripts/test-analytics-suite.php
 */
require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/analytics.php';
require_once dirname(__DIR__) . '/lib/analytics-scan.php';
require_once dirname(__DIR__) . '/lib/analytics-insights.php';

credpix_load_env();

$failures = 0;
$passed = 0;

function assert_true(bool $cond, string $label): void
{
    global $failures, $passed;
    if ($cond) {
        $passed++;
        echo "  OK  {$label}\n";
        return;
    }
    $failures++;
    echo " FAIL {$label}\n";
}

function assert_eq($expected, $actual, string $label): void
{
    assert_true($expected === $actual, $label . ' (expected ' . json_encode($expected) . ', got ' . json_encode($actual) . ')');
}

echo "CredPix Analytics — test suite\n";
echo str_repeat('-', 40) . "\n";

echo "1) Validação de datas\n";
assert_true(!credpix_analytics_is_valid_date_key('58382-04-01'), 'rejeita ano inválido');
assert_true(credpix_analytics_is_valid_date_key('2026-05-31'), 'aceita data válida');
assert_true(!credpix_analytics_is_valid_date_key('2026-02-30'), 'rejeita 30/fev');

echo "2) Labels e landing\n";
assert_eq('Landing', credpix_analytics_page_label('/empa/'), '/empa/ → Landing');
assert_eq('Landing', credpix_analytics_page_label('/empa/index.html'), 'index → Landing');
assert_eq('Wizard', credpix_analytics_page_label('/empa/type/wizard.html'), 'wizard');
assert_true(credpix_analytics_is_landing_page('/empa/'), 'is_landing /empa/');
assert_eq('landing', credpix_analytics_funnel_step('/empa/'), 'funnel landing');

echo "3) Ruído e timestamps\n";
assert_true(credpix_analytics_is_noise_event_type('funnel_step'), 'funnel_step é ruído');
assert_true(credpix_analytics_is_noise_event_type('heartbeat'), 'heartbeat é ruído');
assert_true(!credpix_analytics_is_noise_event_type('page_view'), 'page_view não é ruído');
assert_true(!credpix_analytics_is_noise_event_type('payment_paid'), 'payment_paid não é ruído');

$nowMs = (int) (microtime(true) * 1000);
$future = credpix_analytics_normalize_ts($nowMs + 600000);
assert_true($future <= $nowMs + 120000, 'timestamp futuro é limitado');
$secTs = credpix_analytics_normalize_ts((int) ($nowMs / 1000));
assert_true($secTs > 999999999999, 'segundos convertidos para ms');

echo "4) Sanitize page_view\n";
$ev = credpix_analytics_sanitize([
    'type' => 'page_view',
    'page' => '/empa/',
    'session_id' => 'test_sess',
    'ts' => $nowMs,
]);
assert_eq('Landing', $ev['page_label'], 'sanitize page_label');
assert_eq('landing', $ev['funnel_step'], 'sanitize funnel_step embutido');
assert_eq('page_view', $ev['type'], 'tipo page_view');

echo "5) Storage status\n";
$storage = credpix_analytics_storage_status();
assert_true(isset($storage['today_bytes']), 'storage today_bytes');
assert_true(isset($storage['level']), 'storage level');
assert_true(in_array($storage['level'], ['ok', 'warn', 'critical'], true), 'level válido');

echo "6) Stats (days=1) — memória e JSON\n";
$memBefore = memory_get_peak_usage(true);
try {
    $stats = credpix_analytics_stats_for_dashboard(1);
    assert_true(is_array($stats), 'stats retorna array');
    assert_true(isset($stats['system']), 'stats.system');
    assert_true(isset($stats['system']['storage']), 'stats.system.storage');
    assert_true(isset($stats['revenue']), 'stats.revenue');
    assert_true(isset($stats['funnel']), 'stats.funnel');
    $json = json_encode($stats);
    assert_true($json !== false && strlen($json) > 50, 'stats serializa JSON');
} catch (Throwable $e) {
    assert_true(false, 'stats days=1: ' . $e->getMessage());
}
$memPeakMb = round(memory_get_peak_usage(true) / 1048576, 1);
echo "     Pico memória: {$memPeakMb} MB (antes stats: " . round($memBefore / 1048576, 1) . " MB)\n";
assert_true($memPeakMb < 512, 'memória abaixo de 512 MB');

echo "7) Insights via stats.system\n";
$sys = ($stats ?? [])['system'] ?? [];
assert_true(isset($sys['storage']), 'stats.system.storage');
assert_true(isset($sys['tracking']['page_view_only']), 'stats.system.tracking otimizado');

echo "8) Arquivos inválidos filtrados na listagem\n";
$files = credpix_analytics_list_event_files(30);
foreach ($files as $f) {
    if (preg_match('/events-(\d{4}-\d{2}-\d{2})\.jsonl$/', basename($f), $m)) {
        assert_true(credpix_analytics_is_valid_date_key($m[1]), 'list_event_files só datas válidas: ' . $m[1]);
    }
}

echo "9) Journey key unificado\n";
assert_eq('browser_abc', credpix_analytics_journey_key([
    'browser_session_id' => 'browser_abc',
    'session_id' => 'pix_tx123',
]), 'browser_session_id vence sobre pix_*');
assert_eq('sess_xyz', credpix_analytics_journey_key([
    'session_id' => 'sess_xyz',
]), 'session_id normal');
assert_eq('d_dev1', credpix_analytics_journey_key([
    'session_id' => 'pix_tx',
    'device_hash' => 'dev1',
]), 'fallback device_hash');

echo "10) Dedupe pix_generated no append\n";
$dedupeTx = 'test_dedupe_' . bin2hex(random_bytes(4));
$pixEv = [
    'type' => 'pix_generated',
    'ts' => $nowMs,
    'session_id' => 'pix_' . $dedupeTx,
    'meta' => ['transaction_id' => $dedupeTx],
    'amount_cents' => 100,
];
$r1 = credpix_analytics_append($pixEv);
$r2 = credpix_analytics_append($pixEv);
assert_true(empty($r1['skipped']), 'primeiro pix_generated grava');
assert_true(!empty($r2['skipped']) && ($r2['reason'] ?? '') === 'duplicate_pix', 'segundo pix_generated deduplicado');

echo "11) Sparklines\n";
$spark = credpix_analytics_sparklines(7);
assert_true(isset($spark['revenue']) && is_array($spark['revenue']), 'sparklines.revenue');
assert_true(isset($spark['payments']) && is_array($spark['payments']), 'sparklines.payments');
assert_true(count($spark['revenue']) === 7, 'sparklines 7 dias');
assert_true(isset(($stats ?? [])['sparklines']), 'stats inclui sparklines');

echo "12) Calendário Hoje (timezone)\n";
$tz = credpix_analytics_tz();
$todayKey = (new DateTimeImmutable('now', $tz))->format('Y-m-d');
assert_eq($todayKey, credpix_analytics_today_key(), 'today_key usa CREDPIX_TZ');
assert_true(credpix_analytics_event_in_period(['ts' => (int) (microtime(true) * 1000)], 1), 'evento agora entra em Hoje');
$yesterdayMs = (new DateTimeImmutable('yesterday', $tz))->setTime(23, 0)->getTimestamp() * 1000;
assert_true(!credpix_analytics_event_in_period(['ts' => $yesterdayMs], 1), '23h de ontem não entra em Hoje');

echo "13) period_compare calendário\n";
$tz = credpix_analytics_tz();
$todayNoonMs = (new DateTimeImmutable('today', $tz))->setTime(12, 0)->getTimestamp() * 1000;
$yesterdayNoonMs = (new DateTimeImmutable('yesterday', $tz))->setTime(12, 0)->getTimestamp() * 1000;
$curPay = [
    'ts' => $todayNoonMs,
    'type' => 'payment_paid',
    'amount_cents' => 1000,
    'session_id' => 'sess_cur',
    'meta' => ['transaction_id' => 'tx_cur_' . bin2hex(random_bytes(3))],
];
$prevPay = [
    'ts' => $yesterdayNoonMs,
    'type' => 'payment_paid',
    'amount_cents' => 500,
    'session_id' => 'sess_prev',
    'meta' => ['transaction_id' => 'tx_prev_' . bin2hex(random_bytes(3))],
];
$pc = credpix_analytics_period_compare(1, [$curPay], [$prevPay]);
assert_eq(1000, $pc['revenue']['current_cents'], 'period_compare current revenue');
assert_eq(500, $pc['revenue']['previous_cents'], 'period_compare previous revenue (ontem)');
assert_eq('vs ontem', $pc['label'], 'period_compare label Hoje');

[$pStart, $pEnd] = credpix_analytics_previous_period_range(1);
$yKey = (new DateTimeImmutable('yesterday', $tz))->format('Y-m-d');
assert_eq($yKey, $pStart, 'previous range start = ontem');
assert_eq($yKey, $pEnd, 'previous range end = ontem');

echo "14) Métricas unificadas via events\n";
$pv = [
    'type' => 'page_view',
    'ts' => $todayNoonMs,
    'page' => '/a/index.html',
    'page_label' => 'Landing',
    'referrer' => '/type/wizard.html',
    'traffic_src' => 'meta',
    'session_id' => 'sess_unified',
];
$trans = credpix_analytics_transitions_from_events([$pv]);
assert_true(isset($trans['Wizard → Landing']), 'transitions from events');
$sources = credpix_analytics_sources_from_events([$pv]);
assert_eq(1, $sources['meta'] ?? 0, 'sources from events');
$fbb = credpix_analytics_funnel_by_base([$pv]);
assert_true(count($fbb) >= 1, 'funnel_by_base from events');

echo "15) Stats usa agregados do scan (page views)\n";
$fakeScan = [
    'page_view_count_filtered' => 42,
    'unique_sessions_filtered' => 10,
    'page_views' => ['Landing' => 42],
    'page_uniques' => ['Landing' => ['j1' => true]],
    'transitions' => ['Landing → Wizard' => 5],
    'sources' => ['meta' => 20],
    'funnel' => ['landing' => ['j1' => true], 'wizard' => [], 'checkout' => [], 'upsell' => []],
    'hourly_activity' => array_fill(0, 24, ['page_views' => 0, 'payments' => 0, 'revenue_cents' => 0]),
    'campaigns_base' => [],
    'upsell_report' => [],
    'wizard_steps' => [],
    'funnel_by_base' => [],
    'utm_breakdown' => [],
    'conversion_times' => [],
];
$ps = credpix_analytics_page_stats_from_scan($fakeScan);
assert_eq(42, $ps[0]['views'] ?? 0, 'page_stats from scan');
assert_true(count(credpix_analytics_ranked_map_stats($fakeScan['transitions'], 'flow', 'count')) >= 1, 'transitions from scan map');

echo str_repeat('-', 40) . "\n";
if ($failures > 0) {
    echo "FALHOU: {$failures} teste(s), {$passed} OK\n";
    exit(1);
}
echo "SUCESSO: {$passed} testes passaram\n";
exit(0);
