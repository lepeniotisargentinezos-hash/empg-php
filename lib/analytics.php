<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/admin-auth.php';
require_once __DIR__ . '/webhook-log.php';
require_once __DIR__ . '/utmify.php';
require_once __DIR__ . '/cloudflare-geo.php';
require_once __DIR__ . '/lead-profile.php';
require_once __DIR__ . '/analytics-insights.php';
require_once __DIR__ . '/analytics-scan.php';

function credpix_analytics_dir(): string
{
    $dir = credpix_root() . '/data/analytics';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function credpix_analytics_secret(): string
{
    return getenv('ANALYTICS_SECRET') ?: '';
}

function credpix_analytics_verify_auth(?string $header, ?string $query): bool
{
    return credpix_admin_verify($header, $query);
}

function credpix_analytics_ingest_verify(?string $header): bool
{
    return credpix_ingest_verify($header);
}

function credpix_analytics_ts_to_seconds(?int $ts): ?int
{
    if ($ts === null) {
        return null;
    }
    return $ts > 9999999999 ? (int) floor($ts / 1000) : $ts;
}

function credpix_analytics_date_key_from_ts(?int $ts): string
{
    $sec = credpix_analytics_ts_to_seconds($ts) ?? time();
    return (new DateTimeImmutable('@' . $sec))->setTimezone(credpix_analytics_tz())->format('Y-m-d');
}

function credpix_analytics_period_start_key(int $days): string
{
    $days = max(1, $days);
    $now = new DateTimeImmutable('now', credpix_analytics_tz());
    return $now->modify('-' . ($days - 1) . ' days')->format('Y-m-d');
}

function credpix_analytics_event_in_period(array $ev, int $days): bool
{
    $dayKey = credpix_analytics_date_key_from_ts(isset($ev['ts']) ? (int) $ev['ts'] : null);
    $startKey = credpix_analytics_period_start_key($days);
    $endKey = credpix_analytics_period_end_key();
    return $dayKey >= $startKey && $dayKey <= $endKey;
}

function credpix_analytics_period_end_key(): string
{
    return (new DateTimeImmutable('now', credpix_analytics_tz()))->format('Y-m-d');
}

/** @return array{0: string, 1: string} intervalo [início, fim] do período anterior (calendário) */
function credpix_analytics_previous_period_range(int $days): array
{
    $days = max(1, $days);
    $tz = credpix_analytics_tz();
    $currentStart = new DateTimeImmutable(credpix_analytics_period_start_key($days), $tz);
    $prevEnd = $currentStart->modify('-1 day');
    $prevStart = $prevEnd->modify('-' . ($days - 1) . ' days');
    return [$prevStart->format('Y-m-d'), $prevEnd->format('Y-m-d')];
}

function credpix_analytics_event_in_date_range(array $ev, string $startKey, string $endKey): bool
{
    $dayKey = credpix_analytics_date_key_from_ts(isset($ev['ts']) ? (int) $ev['ts'] : null);
    return $dayKey >= $startKey && $dayKey <= $endKey;
}

function credpix_analytics_now_stamp(string $format = 'Hi'): string
{
    return (new DateTimeImmutable('now', credpix_analytics_tz()))->format($format);
}

/** Mapa product_id → número do upsell (1–20), derivado de config/products.php */
function credpix_analytics_upsell_product_map(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $products = credpix_products();
    $map = [];
    foreach ($products as $id => $p) {
        $name = trim((string) ($p['name'] ?? ''));
        if (preg_match('/^Upsell\s+(\d+)/i', $name, $m)) {
            $map[$id] = max(1, min(20, (int) $m[1]));
        } elseif (stripos($name, 'Taxa IOF') !== false || stripos($name, 'IOF') === 0) {
            $map[$id] = 1;
        }
    }
    if ($map === []) {
        $map = [
            'prod_698630b497231' => 1, 'prod_698630bd7f9da' => 2, 'prod_698630c55ec79' => 3,
            'prod_698630ccf2e75' => 4, 'prod_698630d77a0fa' => 5, 'prod_698630dfecd3d' => 6,
            'prod_698630e72dede' => 7, 'prod_698630eebfb78' => 8, 'prod_698630f633cec' => 9,
            'prod_698630ff20897' => 10, 'prod_69863107b709d' => 11, 'prod_698631105cc74' => 12,
            'prod_6986311823cf5' => 13, 'prod_698631218da01' => 14, 'prod_69863128c6fb7' => 15,
            'prod_6986313159696' => 16, 'prod_6986313997fb8' => 17, 'prod_69863146b1a52' => 18,
            'prod_6986313fbc20c' => 19, 'prod_6986314e1cdab' => 20,
        ];
    }
    $cache = $map;
    return $cache;
}

function credpix_analytics_list_event_files_for_range(string $startKey, string $endKey): array
{
    $dir = credpix_analytics_dir();
    $files = array_merge(
        glob($dir . '/events-*.jsonl') ?: [],
        glob($dir . '/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].jsonl') ?: []
    );
    $files = array_values(array_unique($files));
    sort($files);
    return array_values(array_filter($files, static function ($file) use ($startKey, $endKey) {
        if (preg_match('/events-(\d{4}-\d{2}-\d{2})\.jsonl$/', $file, $m)) {
            return credpix_analytics_is_valid_date_key($m[1]) && $m[1] >= $startKey && $m[1] <= $endKey;
        }
        if (preg_match('/(\d{4}-\d{2}-\d{2})\.jsonl$/', $file, $m)) {
            return credpix_analytics_is_valid_date_key($m[1]) && $m[1] >= $startKey && $m[1] <= $endKey;
        }
        return false;
    }));
}

function credpix_analytics_read_events_for_date_range(string $startKey, string $endKey): array
{
    $events = [];
    foreach (credpix_analytics_list_event_files_for_range($startKey, $endKey) as $file) {
        $handle = @fopen($file, 'rb');
        if (!$handle) {
            continue;
        }
        while (($line = fgets($handle)) !== false) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $row = json_decode($line, true);
            if (!is_array($row) || credpix_analytics_is_noise_event_type($row['type'] ?? null)) {
                continue;
            }
            $events[] = $row;
        }
        fclose($handle);
    }
    return $events;
}

function credpix_analytics_apply_event_filters(
    array $events,
    ?string $srcFilter,
    ?string $utmCampaign,
    ?string $utmMedium,
    ?string $utmContent,
    ?string $productFilter
): array {
    $events = credpix_analytics_dedupe_payments($events);
    if ($srcFilter !== null && $srcFilter !== '') {
        $events = credpix_analytics_filter_src($events, $srcFilter);
    }
    $events = credpix_analytics_filter_utm($events, $utmCampaign, $utmMedium, $utmContent);
    if ($productFilter !== null && $productFilter !== '') {
        $events = array_values(array_filter($events, static function ($ev) use ($productFilter) {
            $type = $ev['type'] ?? '';
            if ($type === 'payment_paid' || $type === 'pix_generated') {
                return ($ev['product_name'] ?? $ev['product_id'] ?? '') === $productFilter;
            }
            return true;
        }));
    }
    return array_values($events);
}

/** @return array<string, int> */
function credpix_analytics_transitions_from_events(array $events): array
{
    $transitions = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'page_view' || empty($ev['referrer'])) {
            continue;
        }
        $label = $ev['page_label'] ?? credpix_analytics_page_label((string) ($ev['page'] ?? '/'));
        if ($label === 'Início') {
            $label = 'Landing';
        }
        $from = credpix_analytics_page_label((string) $ev['referrer']);
        $key = $from . ' → ' . $label;
        $transitions[$key] = ($transitions[$key] ?? 0) + 1;
    }
    return $transitions;
}

/** @return array<string, int> */
function credpix_analytics_sources_from_events(array $events): array
{
    $sources = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'page_view') {
            continue;
        }
        $src = credpix_analytics_event_src($ev) ?: '(direto)';
        $sources[$src] = ($sources[$src] ?? 0) + 1;
    }
    return $sources;
}

/** @return array{payments: int, revenue_cents: int, landing: int, conversion_rate: float} */
function credpix_analytics_period_compare_summarize(array $events): array
{
    $landing = [];
    $payments = 0;
    $revenue = 0;
    foreach ($events as $ev) {
        $jk = credpix_analytics_journey_key($ev);
        if (($ev['funnel_step'] ?? '') === 'landing'
            || ($ev['page_label'] ?? '') === 'Landing'
            || ($ev['page_label'] ?? '') === 'Início') {
            $landing[$jk] = true;
        }
        if (($ev['type'] ?? '') === 'payment_paid') {
            $payments++;
            $revenue += (int) ($ev['amount_cents'] ?? 0);
        }
    }
    $landingCount = count($landing);
    return [
        'payments' => $payments,
        'revenue_cents' => $revenue,
        'landing' => $landingCount,
        'conversion_rate' => $landingCount > 0 ? round(($payments / $landingCount) * 1000) / 10 : 0.0,
    ];
}

function credpix_analytics_period_compare(int $days, array $currentEvents, array $previousEvents): array
{
    $cur = credpix_analytics_period_compare_summarize($currentEvents);
    $prev = credpix_analytics_period_compare_summarize($previousEvents);
    return [
        'label' => $days === 1 ? 'vs ontem' : 'vs período anterior',
        'payments' => [
            'current' => $cur['payments'],
            'previous' => $prev['payments'],
            'change_pct' => credpix_insights_pct_change((float) $cur['payments'], (float) $prev['payments']),
        ],
        'revenue' => [
            'current_cents' => $cur['revenue_cents'],
            'previous_cents' => $prev['revenue_cents'],
            'current_formatted' => 'R$ ' . credpix_format_brl($cur['revenue_cents']),
            'previous_formatted' => 'R$ ' . credpix_format_brl($prev['revenue_cents']),
            'change_pct' => credpix_insights_pct_change((float) $cur['revenue_cents'], (float) $prev['revenue_cents']),
        ],
        'conversion' => [
            'current' => $cur['conversion_rate'],
            'previous' => $prev['conversion_rate'],
            'change_pts' => round(($cur['conversion_rate'] - $prev['conversion_rate']) * 10) / 10,
        ],
        'landing' => [
            'current' => $cur['landing'],
            'previous' => $prev['landing'],
            'change_pct' => credpix_insights_pct_change((float) $cur['landing'], (float) $prev['landing']),
        ],
    ];
}

function credpix_analytics_today_key(?int $ts = null): string
{
    return credpix_analytics_date_key_from_ts($ts);
}

function credpix_analytics_events_file(string $dateKey): string
{
    return credpix_analytics_dir() . '/events-' . $dateKey . '.jsonl';
}

function credpix_analytics_normalize_page(string $raw): string
{
    $page = explode('?', $raw)[0];
    $page = explode('#', $page)[0];
    return $page !== '' ? $page : '/';
}

function credpix_analytics_is_valid_date_key(string $dateKey): bool
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $dateKey, $m)) {
        return false;
    }
    $year = (int) $m[1];
    if ($year < 2020 || $year > 2099) {
        return false;
    }
    return checkdate((int) $m[2], (int) $m[3], $year);
}

function credpix_analytics_normalize_ts(?int $ts): int
{
    $nowMs = (int) (microtime(true) * 1000);
    if ($ts === null || $ts <= 0) {
        return $nowMs;
    }
    if ($ts < 9999999999) {
        $ts *= 1000;
    }
    if ($ts > $nowMs + 120000) {
        return $nowMs;
    }
    if ($ts < ($nowMs - (400 * 86400000))) {
        return $nowMs;
    }
    return $ts;
}

function credpix_analytics_is_landing_page(string $page): bool
{
    $p = credpix_analytics_normalize_page($page);
    if (preg_match('/\/index\.html$/i', $p) || preg_match('/\/a\/index\.html$/i', $p)) {
        return true;
    }
    if (preg_match('#/a/?$#', $p)) {
        return true;
    }
    if (preg_match('#^/?$#', $p)) {
        return true;
    }
    $trim = preg_replace('#^/[^/]+#', '', $p);
    $trim = ltrim((string) $trim, '/');
    return $trim === '' || $trim === 'index.html';
}

function credpix_analytics_page_label(string $page): string
{
    $p = credpix_analytics_normalize_page($page);
    if (credpix_analytics_is_landing_page($p)) {
        return 'Landing';
    }
    if (strpos($p, '/type/wizard') !== false) {
        return 'Wizard';
    }
    if (strpos($p, '/pay/checkout') !== false) {
        return 'Checkout PIX';
    }
    if (strpos($p, '/up/obrigado') !== false) {
        return 'Router Upsell';
    }
    if (strpos($p, '/up/upsell/backredirect') !== false) {
        return 'Back Redirect';
    }
    if (preg_match('/\/up(\d+)\.html/i', $p, $m)) {
        return 'Upsell ' . $m[1];
    }
    if (strpos($p, '/admin/') !== false) {
        return 'Admin';
    }
    $trim = preg_replace('#^/[^/]+#', '', $p);
    $trim = ltrim((string) $trim, '/');
    return $trim !== '' ? $trim : 'Landing';
}

function credpix_analytics_funnel_step(string $page): ?string
{
    $label = credpix_analytics_page_label($page);
    if ($label === 'Landing' || $label === 'Início') {
        return 'landing';
    }
    if ($label === 'Wizard') {
        return 'wizard';
    }
    if ($label === 'Checkout PIX') {
        return 'checkout';
    }
    if (strpos($label, 'Upsell') === 0) {
        return 'upsell';
    }
    if ($label === 'Router Upsell') {
        return 'upsell_router';
    }
    return null;
}

/** Chave canônica da jornada (funil, conversão, campanhas). */
function credpix_analytics_journey_key(array $ev): string
{
    $browser = trim((string) ($ev['browser_session_id'] ?? ''));
    if ($browser !== '' && !preg_match('/^(pix_|webhook_)/', $browser)) {
        return $browser;
    }
    $sid = trim((string) ($ev['session_id'] ?? ''));
    if ($sid !== '' && !preg_match('/^(pix_|webhook_)/', $sid)) {
        return $sid;
    }
    $device = trim((string) ($ev['device_hash'] ?? ''));
    if ($device !== '') {
        return 'd_' . $device;
    }
    return $sid !== '' ? $sid : 'anon';
}

/** @return array<string, string> */
function credpix_analytics_first_touch_fields(?array $utms): array
{
    if (!is_array($utms)) {
        return [];
    }
    $out = [];
    foreach (['first_touch_src', 'first_touch_utm_campaign', 'first_touch_utm_medium', 'first_touch_utm_content'] as $key) {
        if (!empty($utms[$key])) {
            $out[$key] = substr((string) $utms[$key], 0, 128);
        }
    }
    return $out;
}

function credpix_analytics_event_tx_exists_for_date(string $txId, string $type, string $dateKey): bool
{
    if ($txId === '') {
        return false;
    }
    $file = credpix_analytics_events_file($dateKey);
    if (!is_file($file)) {
        return false;
    }
    $handle = @fopen($file, 'rb');
    if (!$handle) {
        return false;
    }
    while (($line = fgets($handle)) !== false) {
        $row = json_decode(trim($line), true);
        if (!is_array($row) || ($row['type'] ?? '') !== $type) {
            continue;
        }
        if (credpix_analytics_event_tx_id($row) === $txId) {
            fclose($handle);
            return true;
        }
    }
    fclose($handle);
    return false;
}

function credpix_analytics_event_tx_exists_today(string $txId, string $type): bool
{
    return credpix_analytics_event_tx_exists_for_date($txId, $type, credpix_analytics_today_key());
}

/** @param array<string, mixed> $meta */
function credpix_analytics_sanitize_meta(array $meta): array
{
    $allowed = [
        'transaction_id', 'payment_id', 'source', 'upsell_key', 'upsell', 'field', 'step',
        /* Dados do cliente/wizard */
        'value', 'phone', 'pix_key', 'pix_key_type',
        'valor_emprestimo', 'num_parcelas', 'renda_mensal', 'tipo_renda',
        'dia_pagamento', 'metodo_pagamento', 'tipo_pix',
    ];
    $out = [];
    $n = 0;
    foreach ($meta as $key => $val) {
        if ($n >= 24) {
            break;
        }
        $k = substr(preg_replace('/[^a-z0-9_]/i', '', (string) $key), 0, 48);
        if ($k === '' || (!in_array($k, $allowed, true) && !str_starts_with($k, 'utm_'))) {
            continue;
        }
        if (is_scalar($val) || $val === null) {
            $out[$k] = substr((string) $val, 0, 256);
            $n++;
        }
    }
    return $out;
}

function credpix_analytics_wizard_step_from_page(string $page): ?string
{
    if (preg_match('/[?&]step=([^&#]+)/', $page, $m)) {
        return strtolower(urldecode($m[1]));
    }
    if (preg_match('!/type/wizard/([^/?#]+)!i', $page, $m)) {
        return strtolower($m[1]);
    }
    return null;
}

/** @return list<array{page: string, views: int, unique: int}> */
function credpix_analytics_page_stats_from_scan(array $scan): array
{
    $pageViews = $scan['page_views'] ?? [];
    $pageUniques = $scan['page_uniques'] ?? [];
    arsort($pageViews);
    $out = [];
    foreach ($pageViews as $label => $views) {
        $out[] = [
            'page' => $label,
            'views' => (int) $views,
            'unique' => isset($pageUniques[$label]) ? count($pageUniques[$label]) : 0,
        ];
    }
    return $out;
}

/** @return list<array<string, mixed>> */
function credpix_analytics_ranked_map_stats(array $map, string $labelKey, string $valueKey, int $limit = 20): array
{
    arsort($map);
    $out = [];
    foreach (array_slice($map, 0, $limit, true) as $label => $count) {
        $out[] = [$labelKey => $label, $valueKey => (int) $count];
    }
    return $out;
}

/** @param array<string, array<string, true>> $scanFunnel */
function credpix_analytics_funnel_merged(array $scanFunnel, array $events): array
{
    $fromEvents = credpix_analytics_funnel_sets_from_events($events);
    return [
        'landing' => $scanFunnel['landing'] ?? [],
        'wizard' => $scanFunnel['wizard'] ?? [],
        'checkout' => $scanFunnel['checkout'] ?? [],
        'pix_generated' => $fromEvents['pix_generated'],
        'payment_paid' => $fromEvents['payment_paid'],
        'upsell' => $scanFunnel['upsell'] ?? [],
    ];
}

function credpix_analytics_campaigns_merged(array $scanCampaigns, array $events): array
{
    $payBySrc = [];
    foreach (credpix_analytics_dedupe_payments(array_values(array_filter($events, static fn ($e) => ($e['type'] ?? '') === 'payment_paid'))) as $ev) {
        $src = credpix_analytics_event_src($ev) ?: '(direto)';
        if (!isset($payBySrc[$src])) {
            $payBySrc[$src] = ['payments' => [], 'revenue_cents' => 0];
        }
        $payBySrc[$src]['payments'][credpix_analytics_journey_key($ev)] = true;
        $payBySrc[$src]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
    }
    $bySrc = [];
    foreach ($scanCampaigns as $row) {
        $bySrc[$row['src']] = $row;
    }
    foreach ($payBySrc as $src => $pay) {
        if (!isset($bySrc[$src])) {
            $bySrc[$src] = [
                'src' => $src,
                'sessions' => 0,
                'landing' => 0,
                'payments' => 0,
                'revenue_cents' => 0,
            ];
        }
        $bySrc[$src]['payments'] = count($pay['payments']);
        $bySrc[$src]['revenue_cents'] = $pay['revenue_cents'];
        $bySrc[$src]['revenue_formatted'] = 'R$ ' . credpix_format_brl($pay['revenue_cents']);
        $landing = (int) ($bySrc[$src]['landing'] ?? 0);
        $bySrc[$src]['conversion_rate'] = $landing > 0 ? round((count($pay['payments']) / $landing) * 1000) / 10 : 0;
    }
    $out = array_values($bySrc);
    usort($out, static fn ($a, $b) => ($b['revenue_cents'] ?? 0) <=> ($a['revenue_cents'] ?? 0));
    foreach ($out as &$row) {
        if (!isset($row['revenue_formatted'])) {
            $row['revenue_formatted'] = 'R$ ' . credpix_format_brl((int) ($row['revenue_cents'] ?? 0));
        }
    }
    unset($row);
    return $out;
}

function credpix_analytics_upsell_report_merged(array $scanReport, array $eventsReport): array
{
    $byN = [];
    foreach ($scanReport as $row) {
        $byN[(int) ($row['upsell'] ?? 0)] = $row;
    }
    foreach ($eventsReport as $row) {
        $n = (int) ($row['upsell'] ?? 0);
        if ($n < 1 || $n > 20) {
            continue;
        }
        if (!isset($byN[$n])) {
            $byN[$n] = ['upsell' => $n, 'views' => 0, 'clicks' => 0, 'payments' => 0, 'revenue_cents' => 0];
        }
        $byN[$n]['payments'] = (int) ($row['payments'] ?? 0);
        $byN[$n]['revenue_cents'] = (int) ($row['revenue_cents'] ?? 0);
    }
    $out = [];
    for ($i = 1; $i <= 20; $i++) {
        $r = $byN[$i] ?? ['upsell' => $i, 'views' => 0, 'clicks' => 0, 'payments' => 0, 'revenue_cents' => 0];
        $views = (int) ($r['views'] ?? 0);
        $clicks = (int) ($r['clicks'] ?? 0);
        $payments = (int) ($r['payments'] ?? 0);
        $out[] = array_merge($r, [
            'upsell' => $i,
            'take_rate' => $views > 0 ? round(($payments / $views) * 1000) / 10 : 0,
            'revenue_formatted' => 'R$ ' . credpix_format_brl((int) ($r['revenue_cents'] ?? 0)),
        ]);
    }
    return $out;
}

function credpix_analytics_hourly_merged(array $scanHourly, array $events): array
{
    $hours = [];
    for ($h = 0; $h < 24; $h++) {
        $scanRow = $scanHourly[$h] ?? [];
        $hours[$h] = [
            'hour'         => $h,
            'label'        => str_pad((string) $h, 2, '0', STR_PAD_LEFT) . 'h',
            'page_views'   => (int) ($scanRow['page_views'] ?? 0),
            'pix_generated' => 0,
            'payments'     => 0,
            'revenue_cents' => 0,
        ];
    }
    $tz = credpix_analytics_tz();
    $seenPix = [];
    foreach ($events as $ev) {
        $type = $ev['type'] ?? '';
        if ($type === 'pix_generated') {
            $txId = credpix_analytics_event_tx_id($ev);
            if ($txId !== '' && isset($seenPix[$txId])) {
                continue;
            }
            if ($txId !== '') {
                $seenPix[$txId] = true;
            }
            $ts = credpix_analytics_ts_to_seconds(isset($ev['ts']) ? (int) $ev['ts'] : null) ?? time();
            $hi = (int) (new DateTime('@' . $ts))->setTimezone($tz)->format('G');
            $hours[$hi]['pix_generated']++;
        }
    }
    foreach (credpix_analytics_dedupe_payments(array_values(array_filter($events, static fn ($e) => ($e['type'] ?? '') === 'payment_paid'))) as $ev) {
        $ts = credpix_analytics_ts_to_seconds(isset($ev['ts']) ? (int) $ev['ts'] : null) ?? time();
        $hi = (int) (new DateTime('@' . $ts))->setTimezone($tz)->format('G');
        $hours[$hi]['payments']++;
        $hours[$hi]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
    }
    foreach ($hours as &$row) {
        $row['revenue_formatted'] = 'R$ ' . credpix_format_brl($row['revenue_cents']);
    }
    unset($row);
    return array_values($hours);
}

/** @param array<string, array<string, true>> $wizardStepJourneys */
function credpix_analytics_wizard_steps_from_scan(array $wizardStepJourneys): array
{
    if (!$wizardStepJourneys) {
        return [];
    }
    $canonical = credpix_analytics_wizard_step_canonical_order();
    $names = array_keys($wizardStepJourneys);
    usort($names, static function (string $a, string $b) use ($canonical): int {
        $ia = array_search(strtolower($a), $canonical, true);
        $ib = array_search(strtolower($b), $canonical, true);
        if ($ia !== false && $ib !== false) {
            return $ia <=> $ib;
        }
        if ($ia !== false) {
            return -1;
        }
        if ($ib !== false) {
            return 1;
        }
        return strcmp($a, $b);
    });
    $out = [];
    foreach ($names as $name) {
        $count = count($wizardStepJourneys[$name]);
        $out[] = [
            'step' => $name,
            'step_label' => credpix_analytics_wizard_step_label($name),
            'sessions' => $count,
            'is_wizard_substep' => true,
        ];
    }
    return $out;
}

function credpix_analytics_sanitize(array $input): array
{
    $products = credpix_products();
    $ts = credpix_analytics_normalize_ts(isset($input['ts']) ? (int) $input['ts'] : null);
    $type = substr((string) ($input['type'] ?? 'page_view'), 0, 64);
    $page = credpix_analytics_normalize_page((string) ($input['page'] ?? $input['path'] ?? '/'));
    $productId = isset($input['product_id']) ? substr((string) $input['product_id'], 0, 64) : null;
    $amountCents = isset($input['amount_cents']) ? (int) $input['amount_cents'] : null;
    if ($productId && isset($products[$productId]) && $amountCents === null) {
        $amountCents = (int) $products[$productId]['amountCents'];
    }

    $sessionId = substr((string) ($input['session_id'] ?? 'anon'), 0, 64);
    $browserSid = isset($input['browser_session_id'])
        ? substr((string) $input['browser_session_id'], 0, 64)
        : null;
    if (($browserSid === null || $browserSid === '') && !preg_match('/^(pix_|webhook_)/', $sessionId)) {
        $browserSid = $sessionId;
    }

    $event = [
        'ts' => $ts,
        'server_ts' => (int) (microtime(true) * 1000),
        'type' => $type,
        'session_id' => $sessionId,
        'browser_session_id' => $browserSid,
        'device_hash' => isset($input['device_hash']) ? substr((string) $input['device_hash'], 0, 64) : null,
        'page' => $page,
        'page_label' => $input['page_label'] ?? credpix_analytics_page_label($page),
        'funnel_step' => $input['funnel_step'] ?? credpix_analytics_funnel_step($page),
        'base_path' => isset($input['base_path']) ? substr((string) $input['base_path'], 0, 32) : null,
        'referrer' => isset($input['referrer']) ? substr((string) $input['referrer'], 0, 512) : null,
        'utm_source' => isset($input['utm_source']) ? substr((string) $input['utm_source'], 0, 128) : null,
        'utm_medium' => isset($input['utm_medium']) ? substr((string) $input['utm_medium'], 0, 128) : null,
        'utm_campaign' => isset($input['utm_campaign']) ? substr((string) $input['utm_campaign'], 0, 128) : null,
        'utm_content' => isset($input['utm_content']) ? substr((string) $input['utm_content'], 0, 128) : null,
        'traffic_src' => isset($input['traffic_src']) ? substr((string) $input['traffic_src'], 0, 128) : null,
        'first_touch_src' => isset($input['first_touch_src']) ? substr((string) $input['first_touch_src'], 0, 128) : null,
        'first_touch_utm_campaign' => isset($input['first_touch_utm_campaign']) ? substr((string) $input['first_touch_utm_campaign'], 0, 128) : null,
        'first_touch_utm_medium' => isset($input['first_touch_utm_medium']) ? substr((string) $input['first_touch_utm_medium'], 0, 128) : null,
        'first_touch_utm_content' => isset($input['first_touch_utm_content']) ? substr((string) $input['first_touch_utm_content'], 0, 128) : null,
        'country' => isset($input['country']) ? strtoupper(substr((string) $input['country'], 0, 2)) : null,
        'city' => isset($input['city']) ? substr((string) $input['city'], 0, 128) : null,
        'region' => isset($input['region']) ? substr((string) $input['region'], 0, 128) : null,
        'continent' => isset($input['continent']) ? strtoupper(substr((string) $input['continent'], 0, 2)) : null,
        'product_id' => $productId,
        'product_name' => ($productId && isset($products[$productId])) ? $products[$productId]['name'] : null,
        'amount_cents' => $amountCents,
        'meta' => credpix_analytics_sanitize_meta((isset($input['meta']) && is_array($input['meta'])) ? $input['meta'] : []),
    ];

    return array_merge($event, credpix_lead_sanitize_event_fields(credpix_lead_profile_from_event($input)));
}

function credpix_analytics_live_enabled(): bool
{
    return getenv('ANALYTICS_LIVE') === '1';
}

/** Eventos que não gravamos nem lemos (ruído / volume alto). */
function credpix_analytics_noise_event_types(): array
{
    return ['heartbeat', 'funnel_step'];
}

function credpix_analytics_is_noise_event_type(?string $type): bool
{
    return in_array((string) $type, credpix_analytics_noise_event_types(), true);
}

/** @return array<string, mixed> */
function credpix_analytics_live_stub(): array
{
    return [
        'total' => 0,
        'by_page' => [],
        'by_src' => [],
        'by_country' => [],
        'geo' => [],
        'geo_meta' => ['mapped' => 0, 'unknown' => 0],
        'sessions' => [],
        'history_24h' => [],
        'timezone' => credpix_analytics_tz()->getName(),
        'disabled' => true,
    ];
}

function credpix_analytics_append(array $rawEvent): array
{
    $rawType = substr((string) ($rawEvent['type'] ?? 'page_view'), 0, 64);
    if (credpix_analytics_is_noise_event_type($rawType)) {
        return ['type' => $rawType, 'skipped' => true];
    }

    if ($rawType === 'pix_generated') {
        $txId = credpix_analytics_event_tx_id($rawEvent);
        $dateKey = credpix_analytics_today_key(isset($rawEvent['ts']) ? (int) $rawEvent['ts'] : null);
        if ($txId && credpix_analytics_event_tx_exists_for_date($txId, 'pix_generated', $dateKey)) {
            return ['type' => $rawType, 'skipped' => true, 'reason' => 'duplicate_pix'];
        }
    }

    if ($rawType === 'payment_paid') {
        $txId = credpix_analytics_event_tx_id($rawEvent);
        $dateKey = credpix_analytics_today_key(isset($rawEvent['ts']) ? (int) $rawEvent['ts'] : null);
        if ($txId && credpix_analytics_event_tx_exists_for_date($txId, 'payment_paid', $dateKey)) {
            return ['type' => $rawType, 'skipped' => true, 'reason' => 'duplicate_payment'];
        }
    }

    $event = credpix_insights_attach_geo(credpix_analytics_sanitize($rawEvent));
    $file = credpix_analytics_events_file(credpix_analytics_today_key($event['ts']));
    $written = file_put_contents($file, json_encode($event, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
    if ($written === false) {
        throw new RuntimeException('Nao foi possivel gravar evento de analytics em ' . $file);
    }

    if (credpix_analytics_live_enabled() && $event['type'] === 'page_view') {
        credpix_analytics_update_presence(
            $event['session_id'],
            $event['page'],
            $event['page_label'],
            $event['base_path'],
            $event['traffic_src'] ?? null,
            credpix_analytics_client_geo()
        );
    }

    return $event;
}

function credpix_analytics_presence_path(): string
{
    return credpix_analytics_dir() . '/presence.json';
}

function credpix_analytics_presence_history_path(): string
{
    return credpix_analytics_dir() . '/presence-history.json';
}

function credpix_analytics_tz(): DateTimeZone
{
    static $tz = null;
    if ($tz instanceof DateTimeZone) {
        return $tz;
    }
    $name = getenv('CREDPIX_TZ') ?: 'America/Sao_Paulo';
    try {
        $tz = new DateTimeZone($name);
    } catch (Throwable $e) {
        $tz = new DateTimeZone('America/Sao_Paulo');
    }
    return $tz;
}

/** @return array<string, array{0: float, 1: float}> */
function credpix_analytics_country_coords(): array
{
    return [
        'AD' => [42.5063, 1.5218], 'AE' => [23.4241, 53.8478], 'AO' => [-11.2027, 17.8739], 'AR' => [-38.4161, -63.6167],
        'AT' => [47.5162, 14.5501], 'AU' => [-25.2744, 133.7751], 'BE' => [50.5039, 4.4699], 'BO' => [-16.2902, -63.5887],
        'BR' => [-14.235, -51.9253], 'CA' => [56.1304, -106.3468], 'CH' => [46.8182, 8.2275], 'CL' => [-35.6751, -71.543],
        'CN' => [35.8617, 104.1954], 'CO' => [-4.5709, -74.2973], 'CR' => [9.7489, -83.7534], 'CZ' => [49.8175, 15.473],
        'DE' => [51.1657, 10.4515], 'DK' => [56.2639, 9.5018], 'DO' => [18.7357, -70.1627], 'EC' => [-1.8312, -78.1834],
        'ES' => [40.4637, -3.7492], 'FI' => [61.9241, 25.7482], 'FR' => [46.2276, 2.2137], 'GB' => [55.3781, -3.436],
        'GH' => [7.9465, -1.0232], 'GR' => [39.0742, 21.8243], 'GT' => [15.7835, -90.2308], 'HK' => [22.3193, 114.1694],
        'HN' => [15.2, -86.2419], 'ID' => [-0.7893, 113.9213], 'IE' => [53.4129, -8.2439], 'IL' => [31.0461, 34.8516],
        'IN' => [20.5937, 78.9629], 'IT' => [41.8719, 12.5674], 'JP' => [36.2048, 138.2529], 'KR' => [35.9078, 127.7669],
        'MX' => [23.6345, -102.5528], 'MY' => [4.2105, 101.9758], 'MZ' => [-18.6657, 35.5296], 'NG' => [9.082, 8.6753],
        'NL' => [52.1326, 5.2913], 'NO' => [60.472, 8.4689], 'NZ' => [-40.9006, 174.886], 'PA' => [8.538, -80.7821],
        'PE' => [-9.19, -75.0152], 'PH' => [12.8797, 121.774], 'PL' => [51.9194, 19.1451], 'PT' => [39.3999, -8.2245],
        'PY' => [-23.4425, -58.4438], 'RO' => [45.9432, 24.9668], 'RU' => [61.524, 105.3188], 'SA' => [23.8859, 45.0792],
        'SE' => [60.1282, 18.6435], 'SG' => [1.3521, 103.8198], 'TR' => [38.9637, 35.2433], 'TW' => [23.6978, 120.9605],
        'UA' => [48.3794, 31.1656], 'US' => [37.0902, -95.7129], 'UY' => [-32.5228, -55.7658], 'VE' => [6.4238, -66.5897],
        'VN' => [14.0583, 108.2772], 'ZA' => [-30.5595, 22.9375], 'XX' => [0.0, 0.0],
    ];
}

function credpix_analytics_hour_key_local(?DateTimeInterface $date = null): string
{
    $dt = $date ? DateTimeImmutable::createFromInterface($date) : new DateTimeImmutable('now', credpix_analytics_tz());
    $dt = $dt->setTimezone(credpix_analytics_tz());
    return $dt->format('Y-m-d\TH');
}

function credpix_analytics_read_presence_history(): array
{
    $path = credpix_analytics_presence_history_path();
    if (!is_file($path)) {
        return ['hours' => []];
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : ['hours' => []];
}

function credpix_analytics_write_presence_history(array $data): void
{
    $written = file_put_contents(
        credpix_analytics_presence_history_path(),
        json_encode($data, JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
    if ($written === false) {
        throw new RuntimeException('Nao foi possivel gravar historico de presenca');
    }
}

function credpix_analytics_prune_presence_history(array &$hist): void
{
    if (!isset($hist['hours']) || !is_array($hist['hours'])) {
        $hist['hours'] = [];
        return;
    }
    $cutoff = (new DateTimeImmutable('now', credpix_analytics_tz()))->modify('-48 hours');
    foreach (array_keys($hist['hours']) as $key) {
        $dt = DateTimeImmutable::createFromFormat('Y-m-d\TH', $key, credpix_analytics_tz());
        if (!$dt || $dt < $cutoff) {
            unset($hist['hours'][$key]);
        }
    }
}

function credpix_analytics_record_presence_sample(int $totalOnline): void
{
    $count = max(0, $totalOnline);
    $hist = credpix_analytics_read_presence_history();
    if (!isset($hist['hours']) || !is_array($hist['hours'])) {
        $hist['hours'] = [];
    }
    $hourKey = credpix_analytics_hour_key_local();
    $bucket = $hist['hours'][$hourKey] ?? ['sum' => 0, 'count' => 0, 'max' => 0, 'min' => $count];
    $bucket['sum'] += $count;
    $bucket['count'] += 1;
    $bucket['max'] = max((int) $bucket['max'], $count);
    $bucket['min'] = min(isset($bucket['min']) ? (int) $bucket['min'] : $count, $count);
    $hist['hours'][$hourKey] = $bucket;
    credpix_analytics_prune_presence_history($hist);
    credpix_analytics_write_presence_history($hist);
}

function credpix_analytics_presence_history_24h(): array
{
    $hist = credpix_analytics_read_presence_history();
    $hours = is_array($hist['hours'] ?? null) ? $hist['hours'] : [];
    $now = new DateTimeImmutable('now', credpix_analytics_tz());
    $result = [];
    for ($i = 23; $i >= 0; $i--) {
        $dt = $now->modify('-' . $i . ' hours');
        $key = credpix_analytics_hour_key_local($dt);
        $bucket = $hours[$key] ?? null;
        $avg = 0.0;
        $max = 0;
        $min = 0;
        $samples = 0;
        if (is_array($bucket) && !empty($bucket['count'])) {
            $avg = round(((float) $bucket['sum']) / ((int) $bucket['count']), 1);
            $max = (int) ($bucket['max'] ?? 0);
            $min = (int) ($bucket['min'] ?? 0);
            $samples = (int) $bucket['count'];
        }
        $result[] = [
            'hour' => $key,
            'label' => $dt->format('H:i'),
            'avg' => $avg,
            'max' => $max,
            'min' => $min,
            'samples' => $samples,
        ];
    }
    return $result;
}

function credpix_analytics_live_geo_points(array $byCountry): array
{
    $coords = credpix_analytics_country_coords();
    $points = [];
    foreach ($byCountry as $country => $count) {
        $country = strtoupper((string) $country);
        $count = (int) $count;
        if ($count <= 0 || $country === 'XX') {
            continue;
        }
        $c = $coords[$country] ?? $coords['XX'];
        $points[] = [
            'country' => $country,
            'count' => $count,
            'lat' => $c[0],
            'lon' => $c[1],
        ];
    }
    usort($points, static fn ($a, $b) => ($b['count'] <=> $a['count']));
    return $points;
}

function credpix_analytics_enrich_live_presence(array $active): array
{
    $byPage = [];
    $bySrc = [];
    $byCountry = [];
    $byContinent = [];

    foreach ($active as $row) {
        if (!is_array($row)) {
            continue;
        }
        $pageKey = $row['page_label'] ?? $row['page'] ?? 'Desconhecido';
        $byPage[$pageKey] = ($byPage[$pageKey] ?? 0) + 1;

        $src = !empty($row['traffic_src']) ? (string) $row['traffic_src'] : '(sem src)';
        $bySrc[$src] = ($bySrc[$src] ?? 0) + 1;

        $country = !empty($row['country']) ? strtoupper((string) $row['country']) : 'XX';
        $byCountry[$country] = ($byCountry[$country] ?? 0) + 1;

        $continent = !empty($row['continent']) ? strtoupper((string) $row['continent']) : null;
        if ($continent) {
            $byContinent[$continent] = ($byContinent[$continent] ?? 0) + 1;
        }
    }

    $geo = credpix_analytics_live_geo_points($byCountry);
    $unknown = (int) ($byCountry['XX'] ?? 0);

    return [
        'total' => count($active),
        'by_page' => $byPage,
        'by_src' => $bySrc,
        'by_country' => $byCountry,
        'by_continent' => $byContinent,
        'geo' => $geo,
        'geo_meta' => [
            'provider' => 'cloudflare',
            'header' => 'CF-IPCountry',
            'mapped' => count($geo),
            'unknown' => $unknown,
        ],
        'history_24h' => credpix_analytics_presence_history_24h(),
        'sessions' => $active,
        'updated_at' => (int) (time() * 1000),
        'timezone' => credpix_analytics_tz()->getName(),
    ];
}

function credpix_analytics_read_presence(): array
{
    $path = credpix_analytics_presence_path();
    if (!is_file($path)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : [];
}

function credpix_analytics_update_presence(
    string $sessionId,
    string $page,
    ?string $pageLabel,
    ?string $basePath,
    ?string $trafficSrc = null,
    array|string|null $geo = null
): array {
    $now = time() * 1000;
    $all = credpix_analytics_read_presence();
    $prev = is_array($all[$sessionId] ?? null) ? $all[$sessionId] : [];

    if (is_string($geo)) {
        $geo = ['country' => $geo];
    }
    if (!is_array($geo)) {
        $geo = [];
    }

    $incomingCountry = strtoupper(substr((string) ($geo['country'] ?? 'XX'), 0, 2));
    if ($incomingCountry === '' || $incomingCountry === 'T1') {
        $incomingCountry = 'XX';
    }
    $resolvedCountry = $incomingCountry !== 'XX' ? $incomingCountry : ($prev['country'] ?? 'XX');

    $incomingContinent = !empty($geo['continent']) ? strtoupper(substr((string) $geo['continent'], 0, 2)) : null;
    $resolvedContinent = $incomingContinent ?: ($prev['continent'] ?? null);

    $all[$sessionId] = [
        'page' => credpix_analytics_normalize_page($page),
        'page_label' => $pageLabel ?: credpix_analytics_page_label($page),
        'base_path' => $basePath,
        'traffic_src' => $trafficSrc ?: ($prev['traffic_src'] ?? null),
        'country' => $resolvedCountry,
        'continent' => $resolvedContinent,
        'city' => !empty($geo['city']) ? (string) $geo['city'] : ($prev['city'] ?? null),
        'region' => !empty($geo['region']) ? (string) $geo['region'] : ($prev['region'] ?? null),
        'geo_source' => !empty($geo['source']) ? (string) $geo['source'] : ($prev['geo_source'] ?? null),
        'last_seen' => $now,
    ];

    $cutoff = $now - 60000;
    $activeCount = 0;
    foreach ($all as $sid => $row) {
        if (!is_array($row) || empty($row['last_seen']) || (int) $row['last_seen'] < $cutoff) {
            unset($all[$sid]);
            continue;
        }
        $activeCount++;
    }

    file_put_contents(
        credpix_analytics_presence_path(),
        json_encode($all, JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
    credpix_analytics_record_presence_sample($activeCount);
    return $all;
}

function credpix_analytics_live_presence(): array
{
    $now = time() * 1000;
    $cutoff = $now - 60000;
    $all = credpix_analytics_read_presence();
    $active = [];

    foreach ($all as $sid => $row) {
        if (!is_array($row) || empty($row['last_seen']) || (int) $row['last_seen'] < $cutoff) {
            continue;
        }
        $active[$sid] = $row;
    }

    return credpix_analytics_enrich_live_presence($active);
}

function credpix_analytics_list_event_files(int $days): array
{
    $dir = credpix_analytics_dir();
    $files = array_merge(
        glob($dir . '/events-*.jsonl') ?: [],
        glob($dir . '/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].jsonl') ?: []
    );
    $files = array_values(array_unique($files));
    sort($files);
    if ($days <= 0) {
        return $files;
    }
    $startKey = credpix_analytics_period_start_key($days);
    return array_values(array_filter($files, static function ($file) use ($startKey) {
        if (preg_match('/events-(\d{4}-\d{2}-\d{2})\.jsonl$/', $file, $m)) {
            return credpix_analytics_is_valid_date_key($m[1]) && $m[1] >= $startKey;
        }
        if (preg_match('/(\d{4}-\d{2}-\d{2})\.jsonl$/', $file, $m)) {
            return credpix_analytics_is_valid_date_key($m[1]) && $m[1] >= $startKey;
        }
        return false;
    }));
}

function credpix_analytics_read_events(int $days): array
{
    $events = [];
    foreach (credpix_analytics_list_event_files($days) as $file) {
        $handle = @fopen($file, 'rb');
        if (!$handle) {
            continue;
        }
        while (($line = fgets($handle)) !== false) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $row = json_decode($line, true);
            if (!is_array($row)) {
                continue;
            }
            if (credpix_analytics_is_noise_event_type($row['type'] ?? null)) {
                continue;
            }
            $events[] = $row;
        }
        fclose($handle);
    }
    return $events;
}

function credpix_analytics_unique_sessions(array $events, ?callable $filter = null): int
{
    $set = [];
    foreach ($events as $ev) {
        if ($filter && !$filter($ev)) {
            continue;
        }
        if (!empty($ev['session_id'])) {
            $set[$ev['session_id']] = true;
        }
    }
    return count($set);
}

function credpix_analytics_sum_revenue(array $events): array
{
    $total = 0;
    $byProduct = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            continue;
        }
        $cents = (int) ($ev['amount_cents'] ?? 0);
        $total += $cents;
        $key = $ev['product_name'] ?? $ev['product_id'] ?? 'Outro';
        $byProduct[$key] = ($byProduct[$key] ?? 0) + $cents;
    }
    return ['total' => $total, 'byProduct' => $byProduct];
}

function credpix_analytics_read_events_for_date_key(string $dateKey): array
{
    $file = credpix_analytics_events_file($dateKey);
    if (!is_file($file)) {
        return [];
    }
    $events = [];
    $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    foreach ($lines as $line) {
        $row = json_decode($line, true);
        if (!is_array($row)) {
            continue;
        }
        if (credpix_analytics_is_noise_event_type($row['type'] ?? null)) {
            continue;
        }
        $events[] = $row;
    }
    return $events;
}

function credpix_analytics_revenue_timeline(array $events, int $days): array
{
    $byHour = [];
    for ($h = 0; $h < 24; $h++) {
        $byHour[str_pad((string) $h, 2, '0', STR_PAD_LEFT) . 'h'] = 0;
    }
    $byDay = [];
    $tz = credpix_analytics_tz();
    $startKey = credpix_analytics_period_start_key($days);
    $endKey = (new DateTimeImmutable('now', $tz))->format('Y-m-d');
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            continue;
        }
        $cents = (int) ($ev['amount_cents'] ?? 0);
        $ts = credpix_analytics_ts_to_seconds(isset($ev['ts']) ? (int) $ev['ts'] : null) ?? time();
        $dt = (new DateTime('@' . $ts))->setTimezone($tz);
        $dayKey = $dt->format('Y-m-d');
        if ($dayKey < $startKey || $dayKey > $endKey) {
            continue;
        }
        $hourKey = $dt->format('H') . 'h';
        $byHour[$hourKey] = ($byHour[$hourKey] ?? 0) + $cents;
        $byDay[$dayKey] = ($byDay[$dayKey] ?? 0) + $cents;
    }
    ksort($byHour);
    ksort($byDay);
    $hourRows = [];
    foreach ($byHour as $label => $cents) {
        $hourRows[] = [
            'label' => $label,
            'amount_cents' => $cents,
            'amount_formatted' => 'R$ ' . credpix_format_brl($cents),
        ];
    }
    $dayRows = [];
    foreach ($byDay as $label => $cents) {
        $dayRows[] = [
            'label' => (new DateTime($label))->format('d/m'),
            'amount_cents' => $cents,
            'amount_formatted' => 'R$ ' . credpix_format_brl($cents),
        ];
    }
    return ['by_hour' => $hourRows, 'by_day' => $dayRows];
}

function credpix_analytics_funnel_by_base(array $events): array
{
    $bases = [];
    $ensure = static function (?string $base) use (&$bases) {
        $key = $base !== null && $base !== '' ? $base : '/ (sem base)';
        if (!isset($bases[$key])) {
            $bases[$key] = [
                'base_path' => $key,
                'page_views' => 0,
                'landing' => [],
                'payment_paid' => [],
                'revenue_cents' => 0,
            ];
        }
        return $key;
    };

    foreach ($events as $ev) {
        if (($ev['type'] ?? '') === 'page_view') {
            $key = $ensure($ev['base_path'] ?? null);
            $bases[$key]['page_views']++;
            if (($ev['page_label'] ?? '') === 'Landing' || ($ev['funnel_step'] ?? '') === 'landing') {
                $bases[$key]['landing'][credpix_analytics_journey_key($ev)] = true;
            }
        }
        if (($ev['funnel_step'] ?? '') === 'landing') {
            $key = $ensure($ev['base_path'] ?? null);
            $bases[$key]['landing'][credpix_analytics_journey_key($ev)] = true;
        }
        if (($ev['type'] ?? '') === 'payment_paid') {
            $base = $ev['base_path'] ?? null;
            $key = $ensure($base);
            $bases[$key]['payment_paid'][credpix_analytics_journey_key($ev)] = true;
            $bases[$key]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
        }
    }

    $out = [];
    foreach ($bases as $row) {
        $landing = count($row['landing']);
        $paid = count($row['payment_paid']);
        if ($landing === 0 && $paid === 0 && $row['page_views'] === 0) {
            continue;
        }
        $rateLabel = credpix_analytics_format_conversion_rate($paid, $landing);
        $out[] = [
            'base_path' => $row['base_path'],
            'page_views' => $row['page_views'],
            'landing' => $landing,
            'payments' => $paid,
            'revenue_cents' => $row['revenue_cents'],
            'revenue_formatted' => 'R$ ' . credpix_format_brl($row['revenue_cents']),
            'conversion_rate' => $landing > 0 ? round(($paid / $landing) * 1000) / 10 : 0,
            'conversion_label' => $rateLabel,
        ];
    }
    usort($out, static fn ($a, $b) => $b['revenue_cents'] <=> $a['revenue_cents']);
    return $out;
}

function credpix_analytics_build_orders(array $events, array $profileMaps = []): array
{
    $paid = array_filter($events, static fn ($e) => ($e['type'] ?? '') === 'payment_paid');
    $deduped = credpix_analytics_dedupe_payments(array_values($paid));
    usort($deduped, static fn ($a, $b) => ((int) ($b['ts'] ?? 0)) <=> ((int) ($a['ts'] ?? 0)));
    $out = [];
    foreach ($deduped as $idx => $ev) {
        $cents = (int) ($ev['amount_cents'] ?? 0);
        $profile = credpix_insights_resolve_lead_profile($ev, $profileMaps);
        $txId = $ev['meta']['transaction_id'] ?? $ev['meta']['payment_id'] ?? null;
        $out[] = array_merge([
            'order_num' => $idx + 1,
            'ts' => $ev['ts'] ?? 0,
            'product_name' => $ev['product_name'] ?? $ev['product_id'] ?? 'Produto',
            'product_id' => $ev['product_id'] ?? null,
            'amount_cents' => $cents,
            'amount_formatted' => 'R$ ' . credpix_format_brl($cents),
            'traffic_src' => credpix_analytics_event_src($ev) ?: '(direto)',
            'utm_campaign' => $ev['utm_campaign'] ?? null,
            'utm_source' => $ev['utm_source'] ?? null,
            'utm_medium' => $ev['utm_medium'] ?? null,
            'utm_content' => $ev['utm_content'] ?? null,
            'session_id' => $ev['session_id'] ?? null,
            'country' => $ev['country'] ?? null,
            'transaction_id' => $txId,
            'utmify' => credpix_utmify_order_status($txId),
        ], $profile);
    }
    return $out;
}

function credpix_analytics_event_tx_id(array $ev): ?string
{
    $meta = is_array($ev['meta'] ?? null) ? $ev['meta'] : [];
    foreach (['transaction_id', 'payment_id', 'masterfy_id', 'anubis_id'] as $key) {
        if (!empty($meta[$key])) {
            return strtolower(trim((string) $meta[$key]));
        }
    }
    $sid = (string) ($ev['session_id'] ?? '');
    foreach (['pix_', 'webhook_'] as $prefix) {
        if (str_starts_with($sid, $prefix)) {
            $rest = trim(substr($sid, strlen($prefix)));
            if ($rest !== '') {
                return strtolower($rest);
            }
        }
    }
    return null;
}

function credpix_analytics_pending_from_tx_store(
    int $days,
    array $paidTxIds,
    ?string $srcFilter = null,
    ?string $productFilter = null
): array {
    $products = credpix_products();
    $dir = credpix_data_dir();
    if (!is_dir($dir)) {
        return [];
    }
    $cutoffSec = (new DateTimeImmutable(credpix_analytics_period_start_key($days), credpix_analytics_tz()))->getTimestamp();
    $rows = [];
    foreach (glob($dir . '/*.json') ?: [] as $path) {
        $fname = basename($path, '.json');
        if (str_starts_with($fname, 'mf_')) {
            continue;
        }
        $normId = strtolower($fname);
        if (isset($paidTxIds[$normId])) {
            continue;
        }
        $tx = json_decode((string) file_get_contents($path), true);
        if (!is_array($tx)) {
            continue;
        }
        if ((string) ($tx['status'] ?? 'pending') !== 'pending') {
            continue;
        }
        $created = (int) ($tx['created'] ?? 0);
        if ($created > 9999999999) {
            $created = (int) floor($created / 1000);
        }
        if ($created > 0 && $created < $cutoffSec) {
            continue;
        }
        $productId = (string) ($tx['product_id'] ?? '');
        $productName = ($productId !== '' && isset($products[$productId]))
            ? $products[$productId]['name']
            : ($productId !== '' ? $productId : 'PIX');
        if ($productFilter !== null && $productFilter !== ''
            && $productName !== $productFilter && $productId !== $productFilter) {
            continue;
        }
        $utms = is_array($tx['utms'] ?? null) ? $tx['utms'] : [];
        $src = (string) ($utms['src'] ?? '');
        if ($srcFilter !== null && $srcFilter !== '' && strtolower($src) !== strtolower(trim($srcFilter))) {
            continue;
        }
        $amount = (int) ($tx['amount_cents'] ?? 0);
        $ts = $created > 0 ? ($created * 1000) : ((int) filemtime($path) * 1000);
        $rows[] = [
            'ts' => $ts,
            'product_name' => $productName,
            'product_id' => $productId !== '' ? $productId : null,
            'amount_cents' => $amount,
            'amount_formatted' => 'R$ ' . credpix_format_brl($amount),
            'transaction_id' => $fname,
            'traffic_src' => $src !== '' ? $src : '(direto)',
            'session_id' => 'pix_' . $fname,
            'utmify' => credpix_utmify_order_status($fname),
        ];
    }
    return $rows;
}

function credpix_analytics_build_pix_pending(
    array $events,
    array $allEvents = [],
    int $days = 7,
    ?string $srcFilter = null,
    ?string $productFilter = null,
    array $profileMaps = []
): array {
    $paidSource = $allEvents ?: $events;
    $paidTxIds = [];
    foreach ($paidSource as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            continue;
        }
        $id = credpix_analytics_event_tx_id($ev);
        if ($id) {
            $paidTxIds[$id] = true;
        }
    }

    $pendingById = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'pix_generated') {
            continue;
        }
        $id = credpix_analytics_event_tx_id($ev);
        if (!$id || isset($paidTxIds[$id])) {
            continue;
        }
        $cents = (int) ($ev['amount_cents'] ?? 0);
        $row = array_merge([
            'ts' => (int) ($ev['ts'] ?? 0),
            'product_name' => $ev['product_name'] ?? $ev['product_id'] ?? 'PIX',
            'product_id' => $ev['product_id'] ?? null,
            'amount_cents' => $cents,
            'amount_formatted' => 'R$ ' . credpix_format_brl($cents),
            'transaction_id' => $id,
            'traffic_src' => credpix_analytics_event_src($ev) ?: '(direto)',
            'session_id' => $ev['session_id'] ?? ('pix_' . $id),
            'utmify' => credpix_utmify_order_status($id),
        ], credpix_insights_resolve_lead_profile($ev, $profileMaps));
        $existing = $pendingById[$id] ?? null;
        if (!$existing || ($row['ts'] ?? 0) >= ($existing['ts'] ?? 0)) {
            $pendingById[$id] = $row;
        }
    }

    foreach (credpix_analytics_pending_from_tx_store($days, $paidTxIds, $srcFilter, $productFilter) as $row) {
        $id = strtolower((string) ($row['transaction_id'] ?? ''));
        if ($id === '' || isset($paidTxIds[$id])) {
            continue;
        }
        $existing = $pendingById[$id] ?? null;
        if (!$existing || ($row['ts'] ?? 0) >= ($existing['ts'] ?? 0)) {
            $pendingById[$id] = $row;
        }
    }

    $pending = array_values($pendingById);
    usort($pending, static fn ($a, $b) => ((int) ($b['ts'] ?? 0)) <=> ((int) ($a['ts'] ?? 0)));
    $pending = array_slice($pending, 0, 40);
    return credpix_insights_enrich_pix_pending($pending, (int) credpix_insights_read_alerts_config()['stale_pix_minutes']);
}

function credpix_analytics_list_products(array $events): array
{
    $map = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            continue;
        }
        $name = $ev['product_name'] ?? $ev['product_id'] ?? 'Outro';
        $map[$name] = ($map[$name] ?? 0) + 1;
    }
    arsort($map);
    $out = [];
    foreach ($map as $product => $count) {
        $out[] = ['product' => $product, 'count' => $count];
    }
    return $out;
}

function credpix_analytics_filter_orders_by_product(array $orders, ?string $productFilter): array
{
    if ($productFilter === null || $productFilter === '') {
        return $orders;
    }
    return array_values(array_filter($orders, static fn ($o) =>
        ($o['product_name'] ?? '') === $productFilter || ($o['product_id'] ?? '') === $productFilter));
}

function credpix_analytics_compute_alerts(array $events, int $days): array
{
    $alerts = [];
    $pixCount = credpix_analytics_count_pix_generated($events);
    $orders = credpix_analytics_build_orders($events);
    $paidCount = count($orders);
    $revenue = credpix_analytics_sum_revenue($events)['total'];

    if ($pixCount >= 3 && ($paidCount / $pixCount) < 0.2) {
        $alerts[] = [
            'level' => 'warning',
            'message' => 'Menos de 20% dos PIX gerados viraram pedido pago (' . $paidCount . ' de ' . $pixCount . ').',
        ];
    }

    $pending = credpix_analytics_build_pix_pending($events);
    if (count($pending) >= 3) {
        $alerts[] = [
            'level' => 'info',
            'message' => count($pending) . ' PIX ainda sem confirmação de pagamento no período.',
        ];
    }

    if ($days === 1) {
        $tz = credpix_analytics_tz();
        $yesterday = (new DateTimeImmutable('yesterday', $tz))->format('Y-m-d');
        $yOrders = credpix_analytics_build_orders(credpix_analytics_read_events_for_date_key($yesterday));
        $yRev = array_sum(array_column($yOrders, 'amount_cents'));
        if ($yRev > 5000 && $revenue < $yRev * 0.5) {
            $alerts[] = ['level' => 'warning', 'message' => 'Receita de pedidos hoje abaixo de 50% de ontem.'];
        }
    }

    if (!$alerts) {
        $alerts[] = [
            'level' => 'ok',
            'message' => $paidCount
                ? $paidCount . ' pedido(s) · R$ ' . credpix_format_brl($revenue)
                : 'Nenhum pedido pago no período.',
        ];
    }
    return $alerts;
}

function credpix_analytics_export_orders_csv(
    int $days,
    ?string $srcFilter = null,
    ?string $productFilter = null,
    ?string $utmCampaign = null,
    ?string $utmMedium = null,
    ?string $utmContent = null
): string {
    $stats = credpix_analytics_stats($days, $srcFilter, $productFilter, $utmCampaign, $utmMedium, $utmContent);
    $tz = credpix_analytics_tz();
    $cols = ['datetime', 'product', 'amount', 'src', 'campaign', 'transaction_id'];
    $esc = static function ($val): string {
        $s = $val === null ? '' : (string) $val;
        if (str_contains($s, '"') || str_contains($s, ',') || str_contains($s, "\n")) {
            return '"' . str_replace('"', '""', $s) . '"';
        }
        return $s;
    };
    $lines = [implode(',', $cols)];
    foreach ($stats['orders'] ?? [] as $o) {
        $lines[] = implode(',', [
            $esc((new DateTime('@' . (int) floor(((int) ($o['ts'] ?? 0)) / 1000)))->setTimezone($tz)->format('d/m/Y H:i:s')),
            $esc($o['product_name'] ?? ''),
            $esc($o['amount_formatted'] ?? ''),
            $esc($o['traffic_src'] ?? ''),
            $esc($o['utm_campaign'] ?? ''),
            $esc($o['transaction_id'] ?? ''),
        ]);
    }
    return implode("\n", $lines);
}

function credpix_analytics_export_csv(
    int $days,
    ?string $srcFilter = null,
    ?string $productFilter = null,
    ?string $utmCampaign = null,
    ?string $utmMedium = null,
    ?string $utmContent = null
): string {
    $startKey = credpix_analytics_period_start_key($days);
    $endKey = credpix_analytics_period_end_key();
    $cols = [
        'ts', 'type', 'session_id', 'page', 'page_label', 'base_path',
        'traffic_src', 'utm_source', 'utm_medium', 'utm_campaign', 'product_name', 'amount_cents',
    ];
    $esc = static function ($val): string {
        $s = $val === null ? '' : (string) $val;
        if (str_contains($s, '"') || str_contains($s, ',') || str_contains($s, "\n")) {
            return '"' . str_replace('"', '""', $s) . '"';
        }
        return $s;
    };
    $lines = [implode(',', $cols)];
    foreach (credpix_analytics_list_event_files_for_range($startKey, $endKey) as $file) {
        $handle = @fopen($file, 'rb');
        if (!$handle) {
            continue;
        }
        while (($line = fgets($handle)) !== false) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $ev = json_decode($line, true);
            if (!is_array($ev) || credpix_analytics_is_noise_event_type($ev['type'] ?? null)) {
                continue;
            }
            if (!credpix_analytics_event_in_period($ev, $days)) {
                continue;
            }
            $filtered = credpix_analytics_apply_event_filters(
                [$ev],
                $srcFilter,
                $utmCampaign,
                $utmMedium,
                $utmContent,
                $productFilter
            );
            if ($filtered === []) {
                continue;
            }
            $ev = $filtered[0];
            $row = [];
            foreach ($cols as $c) {
                if ($c === 'ts') {
                    $row[] = $esc(gmdate('c', (int) floor(((int) ($ev['ts'] ?? 0)) / 1000)));
                } else {
                    $row[] = $esc($ev[$c] ?? '');
                }
            }
            $lines[] = implode(',', $row);
        }
        fclose($handle);
    }
    return implode("\n", $lines);
}

function credpix_analytics_event_src(array $ev): string
{
    return (string) ($ev['traffic_src'] ?? $ev['first_touch_src'] ?? $ev['meta']['src'] ?? $ev['utm_source'] ?? '');
}

function credpix_analytics_filter_src(array $events, ?string $src): array
{
    if ($src === null || $src === '') {
        return $events;
    }
    $needle = strtolower(trim($src));
    return array_values(array_filter($events, static function ($ev) use ($needle) {
        return strtolower(credpix_analytics_event_src($ev)) === $needle;
    }));
}

function credpix_analytics_event_utm(array $ev, string $field): string
{
    return (string) ($ev[$field] ?? $ev['meta'][$field] ?? '');
}

function credpix_analytics_filter_utm(array $events, ?string $campaign, ?string $medium, ?string $content): array
{
    $filters = [
        'utm_campaign' => $campaign,
        'utm_medium' => $medium,
        'utm_content' => $content,
    ];
    foreach ($filters as $field => $value) {
        if ($value === null || $value === '') {
            continue;
        }
        $needle = strtolower(trim($value));
        $events = array_values(array_filter($events, static function ($ev) use ($field, $needle) {
            return strtolower(credpix_analytics_event_utm($ev, $field)) === $needle;
        }));
    }
    return $events;
}

function credpix_analytics_available_utm_values(array $events, string $field): array
{
    $map = [];
    foreach ($events as $ev) {
        $val = credpix_analytics_event_utm($ev, $field);
        if ($val === '') {
            continue;
        }
        $map[$val] = ($map[$val] ?? 0) + 1;
    }
    arsort($map);
    $out = [];
    foreach ($map as $val => $count) {
        $out[] = ['value' => $val, 'count' => $count];
    }
    return $out;
}

function credpix_analytics_google_pixels_summary(): array
{
    if (!function_exists('credpix_google_pixels_read')) {
        require_once __DIR__ . '/google-pixels.php';
    }
    $cfg = credpix_google_pixels_read();
    $active = [];
    foreach ($cfg['googleAds'] ?? [] as $px) {
        $id = trim((string) ($px['id'] ?? ''));
        $label = trim((string) ($px['label'] ?? ''));
        if ($id === '' || $label === '') {
            continue;
        }
        $active[] = [
            'name' => trim((string) ($px['description'] ?? $px['name'] ?? $id)),
            'send_to' => $id . '/' . $label,
        ];
    }
    return ['active' => $active, 'count' => count($active)];
}

function credpix_analytics_upsell_summary(array $orders, array $upsellReport): array
{
    $upsellRev = array_sum(array_column($upsellReport, 'revenue_cents'));
    $upsellPay = array_sum(array_column($upsellReport, 'payments'));
    $totalRev = array_sum(array_map(static fn ($o) => (int) ($o['amount_cents'] ?? 0), $orders));
    $frontRev = max(0, $totalRev - $upsellRev);
    return [
        'front_revenue_cents' => $frontRev,
        'upsell_revenue_cents' => $upsellRev,
        'front_revenue_formatted' => 'R$ ' . credpix_format_brl($frontRev),
        'upsell_revenue_formatted' => 'R$ ' . credpix_format_brl($upsellRev),
        'total_revenue_cents' => $totalRev,
        'upsell_payments' => $upsellPay,
        'front_payments' => max(0, count($orders) - $upsellPay),
        'upsell_share_pct' => $totalRev > 0 ? round(($upsellRev / $totalRev) * 1000) / 10 : 0,
    ];
}

function credpix_analytics_available_srcs(array $events): array
{
    $map = [];
    foreach ($events as $ev) {
        $src = credpix_analytics_event_src($ev);
        if ($src === '') {
            continue;
        }
        $map[$src] = ($map[$src] ?? 0) + 1;
    }
    arsort($map);
    $out = [];
    foreach ($map as $src => $count) {
        $out[] = ['src' => $src, 'count' => $count];
    }
    return $out;
}

function credpix_analytics_dedupe_payments(array $events): array
{
    $seen = [];
    $out = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            $out[] = $ev;
            continue;
        }
        $id = credpix_analytics_event_tx_id($ev);
        if ($id === null || $id === '') {
            $sid = (string) ($ev['session_id'] ?? '');
            if (preg_match('/^(?:pix_|webhook_)(.+)$/', $sid, $m)) {
                $id = $m[1];
            } else {
                $id = $sid . '_' . ($ev['product_id'] ?? '') . '_' . (int) floor(((int) ($ev['ts'] ?? 0)) / 60000);
            }
        }
        if (isset($seen[$id])) {
            continue;
        }
        $seen[$id] = true;
        $out[] = $ev;
    }
    return $out;
}

/** @return list<array<string, mixed>> */
function credpix_analytics_campaigns_from_events(array $events): array
{
    $map = [];
    foreach ($events as $ev) {
        $src = credpix_analytics_event_src($ev) ?: '(direto)';
        if (!isset($map[$src])) {
            $map[$src] = ['sessions' => [], 'landing' => [], 'payments' => [], 'revenue_cents' => 0];
        }
        $jk = credpix_analytics_journey_key($ev);
        $map[$src]['sessions'][$jk] = true;
        $pageLabel = (string) ($ev['page_label'] ?? '');
        $step = $ev['funnel_step'] ?? null;
        if ($step === 'landing' || $pageLabel === 'Landing' || $pageLabel === 'Início') {
            $map[$src]['landing'][$jk] = true;
        }
        if (($ev['type'] ?? '') === 'payment_paid') {
            $map[$src]['payments'][$jk] = true;
            $map[$src]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
        }
    }
    $out = [];
    foreach ($map as $src => $row) {
        $landing = count($row['landing']);
        $paid = count($row['payments']);
        $out[] = [
            'src' => $src,
            'sessions' => count($row['sessions']),
            'landing' => $landing,
            'payments' => $paid,
            'revenue_cents' => $row['revenue_cents'],
            'revenue_formatted' => 'R$ ' . credpix_format_brl($row['revenue_cents']),
            'conversion_rate' => $landing > 0 ? round(($paid / $landing) * 1000) / 10 : 0,
        ];
    }
    usort($out, static fn ($a, $b) => $b['revenue_cents'] <=> $a['revenue_cents']);
    return $out;
}

/** @return array<string, array<string, true>> */
function credpix_analytics_funnel_sets_from_events(array $events): array
{
    $funnel = [
        'landing' => [],
        'wizard' => [],
        'checkout' => [],
        'pix_generated' => [],
        'payment_paid' => [],
        'upsell' => [],
    ];
    $pixByTx = [];
    foreach ($events as $ev) {
        $jk = credpix_analytics_journey_key($ev);
        $type = (string) ($ev['type'] ?? '');
        $step = $ev['funnel_step'] ?? null;
        $label = (string) ($ev['page_label'] ?? '');
        if ($step && isset($funnel[$step])) {
            $funnel[$step][$jk] = true;
        }
        if ($step === 'landing' || $label === 'Landing' || $label === 'Início') {
            $funnel['landing'][$jk] = true;
        }
        if ($type === 'pix_generated') {
            $txId = credpix_analytics_event_tx_id($ev);
            if ($txId && !isset($pixByTx[$txId])) {
                $pixByTx[$txId] = true;
                $funnel['pix_generated'][$jk] = true;
            }
        }
        if ($type === 'payment_paid') {
            $funnel['payment_paid'][$jk] = true;
        }
        if (preg_match('/^Upsell (\d+)$/', $label)) {
            $funnel['upsell'][$jk] = true;
        }
    }
    return $funnel;
}

function credpix_analytics_count_pix_generated(array $events): int
{
    $tx = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'pix_generated') {
            continue;
        }
        $txId = credpix_analytics_event_tx_id($ev);
        if ($txId) {
            $tx[$txId] = true;
        }
    }
    return count($tx);
}

function credpix_analytics_page_view_count(array $events): int
{
    $n = 0;
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') === 'page_view') {
            $n++;
        }
    }
    return $n;
}

function credpix_analytics_unique_journey_count(array $events): int
{
    $set = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') === 'page_view') {
            $set[credpix_analytics_journey_key($ev)] = true;
        }
    }
    return count($set);
}

function credpix_analytics_backup_dir(): string
{
    $dir = credpix_analytics_dir() . '/backups';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function credpix_analytics_run_backup(): array
{
    $stamp = credpix_analytics_today_key() . '_' . credpix_analytics_now_stamp('Hi');
    $dest = credpix_analytics_backup_dir() . '/' . $stamp;
    mkdir($dest, 0755, true);
    $copied = [];
    foreach (glob(credpix_analytics_dir() . '/*') ?: [] as $path) {
        if (is_dir($path) || !preg_match('/\.(jsonl|json)$/', $path)) {
            continue;
        }
        $base = basename($path);
        copy($path, $dest . '/' . $base);
        $copied[] = $base;
    }
    $manifest = [
        'created_at' => gmdate('c'),
        'folder' => $stamp,
        'files' => $copied,
    ];
    file_put_contents(
        credpix_analytics_backup_dir() . '/manifest.json',
        json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n"
    );
    return $manifest;
}

function credpix_analytics_backup_status(): array
{
    $path = credpix_analytics_backup_dir() . '/manifest.json';
    if (!is_file($path)) {
        return ['last_backup_at' => null, 'files' => 0, 'folder' => null];
    }
    $m = json_decode((string) file_get_contents($path), true);
    if (!is_array($m)) {
        return ['last_backup_at' => null, 'files' => 0, 'folder' => null];
    }
    return [
        'last_backup_at' => $m['created_at'] ?? null,
        'files' => count($m['files'] ?? []),
        'folder' => $m['folder'] ?? null,
    ];
}

function credpix_analytics_maybe_auto_backup(): array
{
    $status = credpix_analytics_backup_status();
    $today = credpix_analytics_today_key();
    if (!empty($status['last_backup_at']) && str_starts_with((string) $status['last_backup_at'], $today)) {
        return $status;
    }
    return credpix_analytics_run_backup();
}

/** Move logs antigos para backups/archive/ (não apaga pagamentos). */
function credpix_analytics_maybe_archive_old_events(): array
{
    $keepDays = (int) (getenv('ANALYTICS_ARCHIVE_DAYS') ?: 14);
    if ($keepDays <= 0) {
        return ['archived' => 0, 'skipped' => true];
    }

    $marker = credpix_analytics_dir() . '/.last_archive_run';
    $today = credpix_analytics_today_key();
    if (is_file($marker) && trim((string) file_get_contents($marker)) === $today) {
        return ['archived' => 0, 'skipped' => true, 'reason' => 'already_ran_today'];
    }

    $cutoff = (new DateTimeImmutable('now', credpix_analytics_tz()))->modify('-' . $keepDays . ' days');
    $cutoffKey = $cutoff->format('Y-m-d');
    $archiveDir = credpix_analytics_backup_dir() . '/archive';
    if (!is_dir($archiveDir)) {
        mkdir($archiveDir, 0755, true);
    }
    $invalidDir = credpix_analytics_backup_dir() . '/invalid';
    if (!is_dir($invalidDir)) {
        mkdir($invalidDir, 0755, true);
    }

    $archived = 0;
    $invalid = 0;
    $dir = credpix_analytics_dir();
    foreach (glob($dir . '/*.jsonl') ?: [] as $path) {
        $base = basename($path);
        $dateKey = null;
        if (preg_match('/events-(\d{4}-\d{2}-\d{2})\.jsonl$/', $base, $m)) {
            $dateKey = $m[1];
        } elseif (preg_match('/^(\d{4}-\d{2}-\d{2})\.jsonl$/', $base, $m)) {
            $dateKey = $m[1];
        }

        if ($dateKey === null || !credpix_analytics_is_valid_date_key($dateKey)) {
            $dest = $invalidDir . '/' . $base;
            if (@rename($path, $dest)) {
                $invalid++;
            }
            continue;
        }

        if ($dateKey >= $cutoffKey) {
            continue;
        }

        $dest = $archiveDir . '/' . $base;
        if (is_file($dest)) {
            $dest = $archiveDir . '/' . pathinfo($base, PATHINFO_FILENAME) . '_' . credpix_analytics_now_stamp('His') . '.jsonl';
        }
        if (@rename($path, $dest)) {
            $archived++;
        }
    }

    if ($archived > 0 || $invalid > 0) {
        credpix_analytics_clear_stats_cache();
    }
    @file_put_contents($marker, $today);

    return [
        'archived' => $archived,
        'invalid_quarantined' => $invalid,
        'keep_days' => $keepDays,
        'cutoff' => $cutoffKey,
    ];
}

function credpix_analytics_storage_status(): array
{
    $dir = credpix_analytics_dir();
    $todayKey = credpix_analytics_today_key();
    $todayFile = credpix_analytics_events_file($todayKey);
    $todayBytes = is_file($todayFile) ? (int) filesize($todayFile) : 0;
    $totalBytes = 0;
    $eventFiles = 0;
    $todayLines = 0;

    foreach (glob($dir . '/*.jsonl') ?: [] as $path) {
        $base = basename($path);
        if (!preg_match('/\.jsonl$/', $base)) {
            continue;
        }
        $eventFiles++;
        $totalBytes += (int) filesize($path);
        if ($path === $todayFile) {
            $handle = @fopen($path, 'rb');
            if ($handle) {
                while (fgets($handle) !== false) {
                    $todayLines++;
                }
                fclose($handle);
            }
        }
    }

    $warnMb = (int) (getenv('ANALYTICS_WARN_MB') ?: 35);
    $level = 'ok';
    if ($todayBytes > $warnMb * 1048576) {
        $level = 'warn';
    }
    if ($todayBytes > ($warnMb * 2) * 1048576) {
        $level = 'critical';
    }

    return [
        'today_date' => $todayKey,
        'today_bytes' => $todayBytes,
        'today_bytes_human' => credpix_analytics_format_bytes($todayBytes),
        'today_lines' => $todayLines,
        'total_bytes' => $totalBytes,
        'total_bytes_human' => credpix_analytics_format_bytes($totalBytes),
        'event_files' => $eventFiles,
        'warn_threshold_mb' => $warnMb,
        'level' => $level,
    ];
}

function credpix_analytics_upsell_report(array $events): array
{
    $products = [
        'up1' => 'prod_698630b497231', 'up2' => 'prod_698630bd7f9da', 'up3' => 'prod_698630c55ec79',
        'up4' => 'prod_698630ccf2e75', 'up5' => 'prod_698630d77a0fa', 'up6' => 'prod_698630dfecd3d',
        'up7' => 'prod_698630e72dede', 'up8' => 'prod_698630eebfb78', 'up9' => 'prod_698630f633cec',
        'up10' => 'prod_698630ff20897', 'up11' => 'prod_69863107b709d', 'up12' => 'prod_698631105cc74',
        'up13' => 'prod_6986311823cf5', 'up14' => 'prod_698631218da01', 'up15' => 'prod_69863128c6fb7',
        'up16' => 'prod_6986313159696', 'up17' => 'prod_6986313997fb8', 'up18' => 'prod_69863146b1a52',
        'up19' => 'prod_6986313fbc20c', 'up20' => 'prod_6986314e1cdab',
    ];
    $productToUp = [];
    foreach ($products as $key => $pid) {
        $productToUp[$pid] = (int) str_replace('up', '', $key);
    }
    $rows = [];
    for ($i = 1; $i <= 20; $i++) {
        $rows[$i] = ['upsell' => $i, 'views' => 0, 'clicks' => 0, 'payments' => 0, 'revenue_cents' => 0];
    }
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') === 'page_view' && preg_match('/^Upsell (\d+)$/', (string) ($ev['page_label'] ?? ''), $m)) {
            $rows[(int) $m[1]]['views']++;
        }
        if (($ev['type'] ?? '') === 'upsell_click') {
            $key = (string) ($ev['meta']['upsell_key'] ?? $ev['meta']['upsell'] ?? '');
            $n = (int) preg_replace('/\D/', '', $key);
            if ($n >= 1 && $n <= 20) {
                $rows[$n]['clicks']++;
            }
        }
        if (($ev['type'] ?? '') === 'payment_paid' && !empty($ev['product_id'])) {
            $n = $productToUp[$ev['product_id']] ?? 0;
            if ($n >= 1 && $n <= 20) {
                $rows[$n]['payments']++;
                $rows[$n]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
            }
        }
    }
    $out = [];
    foreach ($rows as $r) {
        $out[] = [
            'upsell' => $r['upsell'],
            'views' => $r['views'],
            'clicks' => $r['clicks'],
            'payments' => $r['payments'],
            'revenue_cents' => $r['revenue_cents'],
            'take_rate' => $r['views'] > 0 ? round(($r['payments'] / $r['views']) * 1000) / 10 : 0,
            'revenue_formatted' => 'R$ ' . credpix_format_brl($r['revenue_cents']),
        ];
    }
    return $out;
}

function credpix_analytics_wizard_step_labels(): array
{
    return [
        'valor_emprestimo' => 'Valor do empréstimo',
        'valor' => 'Valor',
        'finalidade' => 'Finalidade',
        'ocupacao' => 'Ocupação',
        'profissao' => 'Profissão',
        'renda' => 'Renda',
        'cpf' => 'CPF',
        'documento' => 'CPF',
        'nome' => 'Nome',
        'name' => 'Nome',
        'nascimento' => 'Nascimento',
        'telefone' => 'Telefone',
        'email' => 'E-mail',
        'cep' => 'CEP',
        'endereco' => 'Endereço',
        'banco' => 'Banco',
        'agencia' => 'Agência',
        'conta' => 'Conta',
    ];
}

function credpix_analytics_wizard_step_canonical_order(): array
{
    return [
        'valor_emprestimo', 'valor', 'finalidade', 'ocupacao', 'profissao', 'renda',
        'cpf', 'documento', 'nome', 'name', 'nascimento', 'telefone', 'email',
        'cep', 'endereco', 'banco', 'agencia', 'conta',
    ];
}

function credpix_analytics_wizard_step_label(string $step): string
{
    $key = strtolower(trim($step));
    $labels = credpix_analytics_wizard_step_labels();
    if (isset($labels[$key])) {
        return $labels[$key];
    }
    $pretty = str_replace('_', ' ', $key);
    return $pretty !== '' ? ucfirst($pretty) : 'Etapa';
}

function credpix_analytics_wizard_steps(array $events): array
{
    $steps = [];
    $firstTs = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'wizard_step') {
            continue;
        }
        $name = (string) ($ev['meta']['field'] ?? $ev['meta']['step'] ?? 'desconhecido');
        $steps[$name][$ev['session_id'] ?? ''] = true;
        $ts = (int) ($ev['ts'] ?? 0);
        if (!isset($firstTs[$name]) || ($ts > 0 && $ts < $firstTs[$name])) {
            $firstTs[$name] = $ts;
        }
    }

    $canonical = credpix_analytics_wizard_step_canonical_order();
    $names = array_keys($steps);
    usort($names, static function (string $a, string $b) use ($canonical, $firstTs): int {
        $ia = array_search(strtolower($a), $canonical, true);
        $ib = array_search(strtolower($b), $canonical, true);
        if ($ia !== false && $ib !== false) {
            return $ia <=> $ib;
        }
        if ($ia !== false) {
            return -1;
        }
        if ($ib !== false) {
            return 1;
        }
        return ($firstTs[$a] ?? PHP_INT_MAX) <=> ($firstTs[$b] ?? PHP_INT_MAX);
    });

    $max = 1;
    foreach ($names as $name) {
        $max = max($max, count($steps[$name]));
    }

    $out = [];
    foreach ($names as $idx => $name) {
        $sessions = count($steps[$name]);
        $prev = $idx > 0 ? count($steps[$names[$idx - 1]]) : $sessions;
        $out[] = [
            'step' => $name,
            'step_label' => credpix_analytics_wizard_step_label($name),
            'sessions' => $sessions,
            'pct_of_top' => (int) round(($sessions / $max) * 100),
            'dropoff_from_prev' => $idx === 0 ? 0 : ($prev > 0 ? round((($prev - $sessions) / $prev) * 1000) / 10 : 0),
        ];
    }
    return $out;
}

function credpix_analytics_campaigns(array $events): array
{
    $map = [];
    foreach ($events as $ev) {
        $src = credpix_analytics_event_src($ev) ?: '(direto)';
        if (!isset($map[$src])) {
            $map[$src] = ['sessions' => [], 'landing' => [], 'payments' => [], 'revenue_cents' => 0];
        }
        $jk = credpix_analytics_journey_key($ev);
        $map[$src]['sessions'][$jk] = true;
        if (($ev['funnel_step'] ?? '') === 'landing' || ($ev['page_label'] ?? '') === 'Landing') {
            $map[$src]['landing'][$jk] = true;
        }
        if (($ev['type'] ?? '') === 'payment_paid') {
            $map[$src]['payments'][$jk] = true;
            $map[$src]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
        }
    }
    $out = [];
    foreach ($map as $src => $row) {
        $landing = count($row['landing']);
        $paid = count($row['payments']);
        $out[] = [
            'src' => $src,
            'sessions' => count($row['sessions']),
            'landing' => $landing,
            'payments' => $paid,
            'revenue_cents' => $row['revenue_cents'],
            'revenue_formatted' => 'R$ ' . credpix_format_brl($row['revenue_cents']),
            'conversion_rate' => $landing > 0 ? round(($paid / $landing) * 1000) / 10 : 0,
        ];
    }
    usort($out, static fn ($a, $b) => $b['revenue_cents'] <=> $a['revenue_cents']);
    return $out;
}

function credpix_analytics_security_status(): array
{
    require_once __DIR__ . '/anubis.php';
    require_once __DIR__ . '/gateway.php';
    $mf = getenv('MASTERFY_API_KEY') ?: '';
    return [
        'analytics_secret'   => credpix_admin_secret() !== '',
        'webhook_secret'     => (getenv('WEBHOOK_SECRET') ?: '') !== '',
        'open_admin'         => credpix_allow_open_admin(),
        'payment_mock'       => getenv('PAYMENT_MOCK') === '1',
        'cpf_client_direct'  => getenv('CPF_CLIENT_DIRECT') === '1',
        'masterfy_configured' => $mf !== '' && $mf !== 'SUA_CHAVE_DE_API',
        'anubis_configured'  => credpix_anubis_configured(),
        'active_gateway'     => credpix_active_gateway(),
        'gateway_configured' => credpix_gateway_configured(),
    ];
}

function credpix_analytics_sparklines(int $maxDays = 7): array
{
    $maxDays = max(1, min(14, $maxDays));
    $tz = credpix_analytics_tz();
    $revenue = [];
    $payments = [];
    for ($i = $maxDays - 1; $i >= 0; $i--) {
        $d = new DateTime('-' . $i . ' days', $tz);
        $key = $d->format('Y-m-d');
        $file = credpix_analytics_events_file($key);
        $revCents = 0;
        $payCount = 0;
        if (is_file($file)) {
            $dayPayments = [];
            $handle = @fopen($file, 'rb');
            if ($handle) {
                while (($line = fgets($handle)) !== false) {
                    $row = json_decode(trim($line), true);
                    if (!is_array($row) || credpix_analytics_is_noise_event_type($row['type'] ?? null)) {
                        continue;
                    }
                    if (($row['type'] ?? '') !== 'payment_paid') {
                        continue;
                    }
                    $txId = credpix_analytics_event_tx_id($row);
                    if ($txId === '') {
                        $sid = (string) ($row['session_id'] ?? '');
                        if (preg_match('/^(?:pix_|webhook_)(.+)$/', $sid, $m)) {
                            $txId = $m[1];
                        } else {
                            $txId = $sid . '_' . ($row['product_id'] ?? '') . '_' . (int) floor(((int) ($row['ts'] ?? 0)) / 60000);
                        }
                    }
                    if (isset($dayPayments[$txId])) {
                        continue;
                    }
                    $dayPayments[$txId] = true;
                    $payCount++;
                    $revCents += (int) ($row['amount_cents'] ?? 0);
                }
                fclose($handle);
            }
        }
        $label = $d->format('d/m');
        $revenue[] = ['label' => $label, 'value' => $revCents];
        $payments[] = ['label' => $label, 'value' => $payCount];
    }
    return ['revenue' => $revenue, 'payments' => $payments];
}

/** Evita que um insight novo derrube o JSON inteiro do painel. */
function credpix_analytics_safe_insight(callable $fn, array $fallback): array
{
    try {
        $result = $fn();
        return is_array($result) ? $result : $fallback;
    } catch (Throwable $e) {
        $fallback['error'] = $e->getMessage();
        return $fallback;
    }
}

function credpix_analytics_stats(
    int $days,
    ?string $srcFilter = null,
    ?string $productFilter = null,
    ?string $utmCampaign = null,
    ?string $utmMedium = null,
    ?string $utmContent = null
): array {
    @ini_set('memory_limit', '512M');
    @set_time_limit(120);

    $scan = credpix_analytics_scan_events($days, $srcFilter, $utmCampaign, $utmMedium, $utmContent, $productFilter);
    $allEvents = $scan['compact'];
    $availableSrcs = $scan['available_srcs'];
    $scanMaps = [
        'pix_by_tx' => $scan['pix_by_tx'],
        'landing_base_maps' => $scan['landing_base_maps'],
        'session_geo_map' => $scan['session_geo_map'],
        'device_geo_map' => $scan['device_geo_map'],
    ];

    $events = credpix_analytics_apply_event_filters($allEvents, $srcFilter, $utmCampaign, $utmMedium, $utmContent, $productFilter);
    $events = array_values(array_filter($events, static fn ($ev) => credpix_analytics_event_in_period($ev, $days)));
    $profileMaps = credpix_insights_lead_profile_maps($allEvents);
    $events = credpix_insights_enrich_payment_events($events, $allEvents, $scanMaps, $profileMaps);

    [$prevStartKey, $prevEndKey] = credpix_analytics_previous_period_range($days);
    $previousRaw = credpix_analytics_read_events_for_date_range($prevStartKey, $prevEndKey);
    $previousEvents = credpix_analytics_apply_event_filters($previousRaw, $srcFilter, $utmCampaign, $utmMedium, $utmContent, $productFilter);
    $previousProfileMaps = credpix_insights_lead_profile_maps($previousRaw);
    $previousEvents = credpix_insights_enrich_payment_events($previousEvents, $previousRaw, $scanMaps, $previousProfileMaps);
    $periodCompare = credpix_analytics_period_compare($days, $events, $previousEvents);

    $scanFunnel = $scan['funnel'] ?? [];
    $funnel = credpix_analytics_funnel_merged($scanFunnel, $events);
    $pageViewCount = (int) ($scan['page_view_count_filtered'] ?? 0);
    $uniqueJourneyCount = (int) ($scan['unique_sessions_filtered'] ?? 0);
    $pageStats = credpix_analytics_page_stats_from_scan($scan);
    $transitionStats = credpix_analytics_ranked_map_stats($scan['transitions'] ?? [], 'flow', 'count', 20);
    $sourceStats = credpix_analytics_ranked_map_stats($scan['sources'] ?? [], 'source', 'visits', 50);

    $revenue = credpix_analytics_sum_revenue($events);
    $ordersAll = credpix_analytics_build_orders($events, $profileMaps);
    $ordersFiltered = credpix_analytics_filter_orders_by_product($ordersAll, $productFilter);
    $pixPending = credpix_analytics_build_pix_pending($events, $allEvents, $days, $srcFilter, $productFilter, $profileMaps);
    $landingCount = count($funnel['landing']);
    $paidCount = count($ordersAll);
    $pixGenCount = credpix_analytics_count_pix_generated($events);

    arsort($revenue['byProduct']);
    $revenueByProduct = [];
    foreach ($revenue['byProduct'] as $product => $cents) {
        $revenueByProduct[] = [
            'product' => $product,
            'amount_cents' => $cents,
            'amount_formatted' => 'R$ ' . credpix_format_brl($cents),
        ];
    }

    $recent = $scan['recent'];

    $funnelCounts = [
        'landing' => count($funnel['landing']),
        'wizard' => count($funnel['wizard']),
        'checkout' => count($funnel['checkout']),
        'pix_generated' => $pixGenCount,
        'payment_paid' => count($funnel['payment_paid']),
    ];
    $geoMap = $scan['session_geo_map'];
    $live = credpix_analytics_live_enabled()
        ? credpix_analytics_live_presence()
        : credpix_analytics_live_stub();
    $adSpend = credpix_insights_read_ad_spend();
    $dailyGoal = credpix_insights_read_daily_goal();
    $campaignsBase = credpix_analytics_campaigns_merged($scan['campaigns_base'] ?? [], $events);
    $upsellReport = credpix_analytics_upsell_report_merged(
        $scan['upsell_report'] ?? [],
        credpix_analytics_upsell_report($events)
    );
    $wizardSteps = credpix_analytics_wizard_steps_from_scan($scan['wizard_steps'] ?? []);
    $goalTarget = (int) ($dailyGoal['target_cents'] ?? 0);
    $goalCurrent = $days === 1 ? (int) $revenue['total'] : null;
    $goalProgress = ($days === 1 && $goalTarget > 0 && $goalCurrent !== null)
        ? min(100, round(($goalCurrent / $goalTarget) * 1000) / 10)
        : null;
    $ordersFailedUtmify = 0;
    $utmifyFailures = [];
    if (credpix_utmify_enabled()) {
        foreach ($ordersAll as $o) {
            $u = $o['utmify'] ?? [];
            if (empty($u['paid_sent']) || empty($u['waiting_sent'])) {
                $ordersFailedUtmify++;
                if (count($utmifyFailures) < 25) {
                    $utmifyFailures[] = [
                        'transaction_id' => $o['transaction_id'] ?? null,
                        'product_name' => $o['product_name'] ?? null,
                        'amount_formatted' => $o['amount_formatted'] ?? null,
                        'waiting_sent' => !empty($u['waiting_sent']),
                        'paid_sent' => !empty($u['paid_sent']),
                        'tx_found' => !empty($u['tx_found']),
                    ];
                }
            }
        }
    }
    $baseAlerts = credpix_analytics_compute_alerts($events, $days);

    return [
        'period_days' => $days,
        'filter_src' => $srcFilter,
        'filter_product' => $productFilter,
        'filter_utm_campaign' => $utmCampaign,
        'filter_utm_medium' => $utmMedium,
        'filter_utm_content' => $utmContent,
        'available_srcs' => $availableSrcs,
        'available_products' => credpix_analytics_list_products($events),
        'available_utms' => $scan['available_utms'],
        'totals' => [
            'events' => count($events) + $pageViewCount,
            'page_views' => $pageViewCount,
            'unique_sessions' => $uniqueJourneyCount,
            'landing_sessions' => $funnelCounts['landing'],
            'wizard_sessions' => $funnelCounts['wizard'],
            'pix_generated' => $pixGenCount,
            'pix_pending' => count($pixPending),
            'pix_pending_value_cents' => array_sum(array_map(static fn ($p) => (int) ($p['amount_cents'] ?? 0), $pixPending)),
            'pix_pending_value_formatted' => 'R$ ' . credpix_format_brl(array_sum(array_map(static fn ($p) => (int) ($p['amount_cents'] ?? 0), $pixPending))),
            'payments' => $paidCount,
            'revenue_cents' => $revenue['total'],
            'revenue_formatted' => 'R$ ' . credpix_format_brl($revenue['total']),
            'avg_ticket_cents' => $paidCount > 0 ? (int) round($revenue['total'] / $paidCount) : 0,
            'avg_ticket_formatted' => $paidCount > 0 ? 'R$ ' . credpix_format_brl((int) round($revenue['total'] / $paidCount)) : 'R$ 0,00',
            'pix_to_paid_rate' => $pixGenCount > 0 ? round(($paidCount / $pixGenCount) * 1000) / 10 : 0,
            'conversion_rate' => $landingCount > 0 ? round(($paidCount / $landingCount) * 1000) / 10 : 0,
        ],
        'orders' => $ordersFiltered,
        'pix_pending' => $pixPending,
        'funnel' => array_merge($funnelCounts, [
            'upsell' => count($funnel['upsell']),
            'dropoff' => credpix_insights_funnel_dropoff($funnelCounts, $wizardSteps),
        ]),
        'conversion_times' => $scan['conversion_times'] ?? credpix_insights_conversion_times($events),
        'period_compare' => $periodCompare,
        'revenue_by_state' => credpix_insights_revenue_by_state($events, $geoMap),
        'top_cities' => credpix_insights_top_cities($events, $live, $geoMap),
        'utm_breakdown' => $scan['utm_breakdown'] ?? credpix_insights_utm_breakdown($events),
        'demographics' => credpix_insights_demographics($events, $ordersAll),
        'transition_sankey' => credpix_insights_transition_sankey($transitionStats),
        'hourly_activity' => credpix_analytics_hourly_merged($scan['hourly_activity'] ?? [], $events),
        'pix_hourly_conversion' => credpix_analytics_safe_insight(static function () use ($events): array {
            return credpix_insights_pix_hourly_conversion($events);
        }, ['hours' => [], 'totals' => ['pix_generated' => 0, 'pix_paid' => 0, 'pix_pending' => 0, 'conversion_rate' => 0.0]]),
        'main_price_comparison' => credpix_analytics_safe_insight(static function () use ($events): array {
            return credpix_insights_main_price_comparison($events);
        }, ['tiers' => [], 'winner_label' => null, 'insight' => 'Indisponível temporariamente.', 'has_data' => false]),
        'ad_spend' => $adSpend,
        'pages' => $pageStats,
        'transitions' => $transitionStats,
        'sources' => $sourceStats,
        'revenue_by_product' => $revenueByProduct,
        'revenue_timeline' => credpix_analytics_revenue_timeline($events, $days),
        'funnel_by_base' => $scan['funnel_by_base'] ?? credpix_analytics_funnel_by_base($events),
        'alerts' => credpix_insights_enhanced_alerts($events, $days, $baseAlerts, $pixPending, $ordersFailedUtmify),
        'wizard_steps' => $wizardSteps,
        'upsell_report' => $upsellReport,
        'upsell_summary' => credpix_analytics_upsell_summary($ordersAll, $upsellReport),
        'campaigns' => credpix_insights_campaigns_roas($campaignsBase, $adSpend),
        'roas_timeline' => credpix_insights_roas_timeline($events, $days, $adSpend),
        'daily_goal' => [
            'target_cents' => $goalTarget,
            'target_formatted' => 'R$ ' . credpix_format_brl($goalTarget),
            'current_cents' => $goalCurrent,
            'current_formatted' => $goalCurrent !== null ? ('R$ ' . credpix_format_brl($goalCurrent)) : null,
            'progress_pct' => $goalProgress,
            'daily_only' => $days === 1,
            'updated_at' => $dailyGoal['updated_at'] ?? null,
        ],
        'google_pixels' => credpix_analytics_google_pixels_summary(),
        'backup' => credpix_analytics_backup_status(),
        'recent' => $recent,
        'sparklines' => credpix_analytics_sparklines(min(7, max(1, $days))),
        'live' => $live,
        'system' => credpix_insights_system_status($allEvents, $live, credpix_analytics_backup_status()),
        'storage' => credpix_analytics_storage_status(),
        'webhooks_recent' => credpix_webhook_log_read(20),
        'utmify' => ['enabled' => credpix_utmify_enabled()],
        'utmify_failures' => $utmifyFailures,
        'alerts_config' => credpix_insights_read_alerts_config(),
    ];
}

function credpix_analytics_stats_cache_key(
    int $days,
    ?string $srcFilter,
    ?string $productFilter,
    ?string $utmCampaign,
    ?string $utmMedium,
    ?string $utmContent
): string {
    return hash('sha256', json_encode([
        $days,
        $srcFilter ?? '',
        $productFilter ?? '',
        $utmCampaign ?? '',
        $utmMedium ?? '',
        $utmContent ?? '',
    ]));
}

function credpix_analytics_clear_stats_cache(): void
{
    foreach (glob(credpix_analytics_dir() . '/.cache-stats-*.json') ?: [] as $file) {
        @unlink($file);
    }
}

function credpix_analytics_stats_for_dashboard(
    int $days,
    ?string $srcFilter = null,
    ?string $productFilter = null,
    ?string $utmCampaign = null,
    ?string $utmMedium = null,
    ?string $utmContent = null
): array {
    credpix_analytics_maybe_archive_old_events();
    $ttl = (int) (getenv('ANALYTICS_STATS_CACHE_SEC') ?: 300);
    if ($ttl <= 0) {
        return credpix_analytics_stats($days, $srcFilter, $productFilter, $utmCampaign, $utmMedium, $utmContent);
    }

    $cacheFile = credpix_analytics_dir() . '/.cache-stats-' . credpix_analytics_stats_cache_key(
        $days,
        $srcFilter,
        $productFilter,
        $utmCampaign,
        $utmMedium,
        $utmContent
    ) . '.json';

    if (is_file($cacheFile) && (time() - (int) filemtime($cacheFile)) < $ttl) {
        $cached = json_decode((string) file_get_contents($cacheFile), true);
        if (is_array($cached)) {
            $cached['live'] = credpix_analytics_live_enabled()
                ? credpix_analytics_live_presence()
                : credpix_analytics_live_stub();
            $cached['_cache'] = [
                'hit' => true,
                'age_sec' => time() - (int) filemtime($cacheFile),
                'ttl_sec' => $ttl,
            ];
            return $cached;
        }
    }

    $stats = credpix_analytics_stats($days, $srcFilter, $productFilter, $utmCampaign, $utmMedium, $utmContent);
    $stats['_cache'] = ['hit' => false, 'age_sec' => 0, 'ttl_sec' => $ttl];
    $encoded = json_encode($stats, JSON_UNESCAPED_UNICODE);
    if ($encoded !== false) {
        @file_put_contents($cacheFile, $encoded, LOCK_EX);
    }
    return $stats;
}

/** Diagnóstico leve: conta linhas/tipos sem carregar eventos na memória. */
function credpix_analytics_diagnostics(?int $statsProbeDays = null): array
{
    $dir = credpix_analytics_dir();
    $paths = array_values(array_unique(array_merge(
        glob($dir . '/events-*.jsonl') ?: [],
        glob($dir . '/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].jsonl') ?: []
    )));
    sort($paths);

    $totals = [
        'files' => 0,
        'bytes' => 0,
        'lines' => 0,
        'noise_lines' => 0,
        'useful_lines' => 0,
        'invalid_lines' => 0,
        'by_type' => [],
    ];
    $files = [];

    foreach ($paths as $path) {
        if (!is_file($path)) {
            continue;
        }
        $bytes = (int) filesize($path);
        $fileStat = [
            'name' => basename($path),
            'bytes' => $bytes,
            'bytes_human' => credpix_analytics_format_bytes($bytes),
            'lines' => 0,
            'noise_lines' => 0,
            'useful_lines' => 0,
            'invalid_lines' => 0,
            'types' => [],
            'mtime' => date('c', (int) filemtime($path)),
        ];
        $handle = @fopen($path, 'rb');
        if (!$handle) {
            $fileStat['error'] = 'nao_foi_possivel_ler';
            $files[] = $fileStat;
            continue;
        }
        while (($line = fgets($handle)) !== false) {
            $fileStat['lines']++;
            $row = json_decode(trim($line), true);
            if (!is_array($row)) {
                $fileStat['invalid_lines']++;
                continue;
            }
            $type = substr((string) ($row['type'] ?? 'unknown'), 0, 64);
            $fileStat['types'][$type] = ($fileStat['types'][$type] ?? 0) + 1;
            $totals['by_type'][$type] = ($totals['by_type'][$type] ?? 0) + 1;
            if (credpix_analytics_is_noise_event_type($type)) {
                $fileStat['noise_lines']++;
            } else {
                $fileStat['useful_lines']++;
            }
        }
        fclose($handle);
        arsort($fileStat['types']);
        $files[] = $fileStat;
        $totals['files']++;
        $totals['bytes'] += $bytes;
        $totals['lines'] += $fileStat['lines'];
        $totals['noise_lines'] += $fileStat['noise_lines'];
        $totals['useful_lines'] += $fileStat['useful_lines'];
        $totals['invalid_lines'] += $fileStat['invalid_lines'];
    }

    arsort($totals['by_type']);

    $cacheFiles = glob($dir . '/.cache-stats-*.json') ?: [];
    $cacheBytes = 0;
    foreach ($cacheFiles as $cacheFile) {
        $cacheBytes += (int) (@filesize($cacheFile) ?: 0);
    }

    $todayKey = credpix_analytics_today_key();
    $todayFile = credpix_analytics_events_file($todayKey);
    $todayStat = null;
    foreach ($files as $fileStat) {
        if (($fileStat['name'] ?? '') === basename($todayFile)) {
            $todayStat = $fileStat;
            break;
        }
    }

    $statsProbe = null;
    if ($statsProbeDays !== null && $statsProbeDays > 0) {
        $probeDays = max(1, min(7, $statsProbeDays));
        $started = microtime(true);
        $probeError = null;
        try {
            @set_time_limit(45);
            credpix_analytics_stats_for_dashboard($probeDays);
            $statsProbe = [
                'days' => $probeDays,
                'ok' => true,
                'elapsed_ms' => (int) round((microtime(true) - $started) * 1000),
            ];
        } catch (Throwable $e) {
            $statsProbe = [
                'days' => $probeDays,
                'ok' => false,
                'elapsed_ms' => (int) round((microtime(true) - $started) * 1000),
                'error' => $e->getMessage(),
            ];
        }
    }

    $diskFree = @disk_free_space($dir);
    $diskTotal = @disk_total_space($dir);
    $paymentGap = credpix_analytics_diagnostics_payment_gap(1);

    return [
        'ok' => true,
        'generated_at' => date('c'),
        'php' => [
            'version' => PHP_VERSION,
            'memory_limit' => ini_get('memory_limit') ?: null,
            'max_execution_time' => ini_get('max_execution_time') ?: null,
            'memory_usage_bytes' => memory_get_usage(true),
            'memory_peak_bytes' => memory_get_peak_usage(true),
        ],
        'config' => [
            'stats_cache_sec' => (int) (getenv('ANALYTICS_STATS_CACHE_SEC') ?: 300),
            'live_enabled' => credpix_analytics_live_enabled(),
            'analytics_secret_set' => credpix_admin_secret() !== '',
        ],
        'storage' => [
            'dir' => $dir,
            'disk_free_bytes' => $diskFree !== false ? (int) $diskFree : null,
            'disk_total_bytes' => $diskTotal !== false ? (int) $diskTotal : null,
            'disk_free_human' => $diskFree !== false ? credpix_analytics_format_bytes((int) $diskFree) : null,
        ],
        'event_files' => $files,
        'today' => [
            'date' => $todayKey,
            'file' => basename($todayFile),
            'exists' => is_file($todayFile),
            'stats' => $todayStat,
        ],
        'totals' => array_merge($totals, [
            'bytes_human' => credpix_analytics_format_bytes($totals['bytes']),
        ]),
        'cache' => [
            'files' => count($cacheFiles),
            'bytes' => $cacheBytes,
            'bytes_human' => credpix_analytics_format_bytes($cacheBytes),
        ],
        'stats_probe' => $statsProbe,
        'payment_gap' => $paymentGap,
        'recommendations' => credpix_analytics_diagnostics_recommendations($totals, $todayStat, $statsProbe, $paymentGap),
    ];
}

function credpix_analytics_diagnostics_payment_gap(int $days = 1): array
{
    $days = max(1, min(7, $days));
    $startKey = credpix_analytics_period_start_key($days);
    $endKey = (new DateTimeImmutable('now', credpix_analytics_tz()))->format('Y-m-d');
    $pix = 0;
    $paidEvents = [];
    $paidTxIds = [];
    foreach (credpix_analytics_read_events_for_date_range($startKey, $endKey) as $ev) {
        $type = $ev['type'] ?? '';
        if ($type === 'pix_generated') {
            $pix++;
        }
        if ($type === 'payment_paid') {
            $paidEvents[] = $ev;
            $id = credpix_analytics_event_tx_id($ev);
            if ($id) {
                $paidTxIds[$id] = true;
            }
        }
    }
    $paid = count(credpix_analytics_dedupe_payments($paidEvents));

    $pendingTxFiles = 0;
    $dir = credpix_data_dir();
    $cutoffSec = (new DateTimeImmutable($startKey, credpix_analytics_tz()))->getTimestamp();
    if (is_dir($dir)) {
        foreach (glob($dir . '/*.json') ?: [] as $path) {
            $fname = basename($path, '.json');
            if ($fname === '' || str_starts_with($fname, 'mf_') || isset($paidTxIds[strtolower($fname)])) {
                continue;
            }
            $tx = json_decode((string) file_get_contents($path), true);
            if (!is_array($tx) || (string) ($tx['status'] ?? 'pending') !== 'pending') {
                continue;
            }
            $created = (int) ($tx['created'] ?? 0);
            if ($created > 9999999999) {
                $created = (int) floor($created / 1000);
            }
            if ($created > 0 && $created < $cutoffSec) {
                continue;
            }
            $pendingTxFiles++;
        }
    }

    return [
        'days' => $days,
        'pix_generated_events' => $pix,
        'payment_paid_events' => $paid,
        'gap' => max(0, $pix - $paid),
        'pending_tx_files' => $pendingTxFiles,
    ];
}

function credpix_analytics_format_bytes(int $bytes): string
{
    if ($bytes < 1024) {
        return $bytes . ' B';
    }
    if ($bytes < 1048576) {
        return round($bytes / 1024, 1) . ' KB';
    }
    if ($bytes < 1073741824) {
        return round($bytes / 1048576, 1) . ' MB';
    }
    return round($bytes / 1073741824, 2) . ' GB';
}

/** @param array<string, mixed> $totals */
/** @param array<string, mixed>|null $todayStat */
/** @param array<string, mixed>|null $statsProbe */
function credpix_analytics_diagnostics_recommendations(array $totals, ?array $todayStat, ?array $statsProbe, ?array $paymentGap = null): array
{
    $tips = [];

    if (is_array($paymentGap)) {
        $gap = (int) ($paymentGap['gap'] ?? 0);
        $pending = (int) ($paymentGap['pending_tx_files'] ?? 0);
        if ($gap >= 5 || ($gap > 0 && $pending >= 3)) {
            $tips[] = [
                'level' => 'critical',
                'message' => 'Há ' . $gap . ' PIX gerados sem payment_paid nos últimos '
                    . (int) ($paymentGap['days'] ?? 1) . ' dia(s) e ' . $pending
                    . ' transações locais ainda pendentes. Provável causa: checkout parava de consultar a MasterFy após 5 min. Use "Recuperar vendas (MasterFy)" abaixo.',
            ];
        } elseif ($gap > 0) {
            $tips[] = [
                'level' => 'warn',
                'message' => 'Gap PIX vs pago: ' . $gap . ' evento(s) nos últimos '
                    . (int) ($paymentGap['days'] ?? 1) . ' dia(s). Rode recuperação se o dashboard estiver abaixo da MasterFy.',
            ];
        }
    }

    if (($totals['noise_lines'] ?? 0) > 0) {
        $tips[] = [
            'level' => 'warn',
            'message' => 'Há ' . number_format((int) $totals['noise_lines'], 0, ',', '.')
                . ' linhas de ruído (heartbeat/wizard_step/funnel_step). Rode purge_noise — não apaga vendas.',
        ];
    }

    $usefulToday = (int) ($todayStat['useful_lines'] ?? 0);
    if ($usefulToday > 80000) {
        $tips[] = [
            'level' => 'critical',
            'message' => 'Só hoje há ' . number_format($usefulToday, 0, ',', '.')
                . ' eventos úteis. O PHP pode estourar timeout ao montar o dashboard. Use período "Hoje" e aumente cache.',
        ];
    } elseif ($usefulToday > 30000) {
        $tips[] = [
            'level' => 'warn',
            'message' => 'Volume alto hoje (' . number_format($usefulToday, 0, ',', '.')
                . ' eventos). Se o painel travar, aguarde 90s (cache) e recarregue.',
        ];
    }

    if (($totals['bytes'] ?? 0) > 50 * 1048576) {
        $tips[] = [
            'level' => 'warn',
            'message' => 'Logs de analytics ocupam ' . credpix_analytics_format_bytes((int) $totals['bytes'])
                . '. Considere backup e arquivar dias antigos (sem apagar pagamentos).',
        ];
    }

    if ($statsProbe !== null && empty($statsProbe['ok'])) {
        $tips[] = [
            'level' => 'critical',
            'message' => 'Teste de stats falhou: ' . ($statsProbe['error'] ?? 'timeout/memória')
                . '. Veja Error Log do cPanel (memory exhausted / Maximum execution time).',
        ];
    } elseif ($statsProbe !== null && (int) ($statsProbe['elapsed_ms'] ?? 0) > 25000) {
        $tips[] = [
            'level' => 'warn',
            'message' => 'Stats levaram ' . ((int) $statsProbe['elapsed_ms'] / 1000) . 's — perto do limite do hosting.',
        ];
    }

    if ($tips === []) {
        $tips[] = [
            'level' => 'ok',
            'message' => 'Volume dentro do esperado. Se o login falhar, confira se o token está correto (ping deve retornar auth ok).',
        ];
    }

    return $tips;
}

/** Remove heartbeats/wizard_step dos arquivos .jsonl (libera espaço e acelera leitura). */
function credpix_analytics_purge_noise_events(): array
{
    $removed = 0;
    $kept = 0;
    $files = 0;
    $dir = credpix_analytics_dir();
    $paths = array_merge(
        glob($dir . '/events-*.jsonl') ?: [],
        glob($dir . '/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].jsonl') ?: []
    );

    foreach (array_unique($paths) as $path) {
        if (!is_file($path)) {
            continue;
        }
        $files++;
        $tmp = $path . '.tmp';
        $in = @fopen($path, 'rb');
        $out = @fopen($tmp, 'wb');
        if (!$in || !$out) {
            if ($in) {
                fclose($in);
            }
            if ($out) {
                fclose($out);
            }
            @unlink($tmp);
            continue;
        }
        while (($line = fgets($in)) !== false) {
            $row = json_decode(trim($line), true);
            if (!is_array($row) || credpix_analytics_is_noise_event_type($row['type'] ?? null)) {
                $removed++;
                continue;
            }
            fwrite($out, json_encode($row, JSON_UNESCAPED_UNICODE) . "\n");
            $kept++;
        }
        fclose($in);
        fclose($out);
        if (!@rename($tmp, $path)) {
            @unlink($tmp);
            continue;
        }
    }

    credpix_analytics_clear_stats_cache();
    return ['files' => $files, 'removed' => $removed, 'kept' => $kept];
}

function credpix_analytics_session_journey(string $sessionId, int $days = 7): ?array
{
    return credpix_insights_session_journey($sessionId, $days);
}

function credpix_analytics_payment_event_exists(string $txId, int $days = 14): bool
{
    if ($txId === '') {
        return false;
    }
    $normId = strtolower(trim($txId));
    $startKey = credpix_analytics_period_start_key(max(1, $days));
    $endKey = (new DateTimeImmutable('now', credpix_analytics_tz()))->format('Y-m-d');
    foreach (credpix_analytics_list_event_files_for_range($startKey, $endKey) as $file) {
        $handle = @fopen($file, 'rb');
        if (!$handle) {
            continue;
        }
        while (($line = fgets($handle)) !== false) {
            $row = json_decode(trim($line), true);
            if (!is_array($row) || ($row['type'] ?? '') !== 'payment_paid') {
                continue;
            }
            if (credpix_analytics_event_tx_id($row) === $normId) {
                fclose($handle);
                return true;
            }
        }
        fclose($handle);
    }
    return false;
}

/** Consulta gateway ativo e grava payment_paid faltante (sem depender de webhook). */
function credpix_analytics_reconcile_missing_payments(int $days = 7, int $limit = 40): array
{
    require_once __DIR__ . '/masterfy.php';
    require_once __DIR__ . '/anubis.php';
    require_once __DIR__ . '/gateway.php';
    require_once __DIR__ . '/utmify.php';

    if (!credpix_gateway_configured()) {
        $gw = ucfirst(credpix_active_gateway());
        return ['ok' => false, 'error' => $gw . ' não configurado', 'checked' => 0, 'logged' => 0];
    }

    $days = max(1, min(30, $days));
    $limit = max(1, min(100, $limit));
    $dir = credpix_data_dir();
    if (!is_dir($dir)) {
        return ['ok' => true, 'checked' => 0, 'logged' => 0, 'updated' => 0, 'errors' => []];
    }

    $cutoffSec = (new DateTimeImmutable(credpix_analytics_period_start_key($days), credpix_analytics_tz()))->getTimestamp();
    $paths = glob($dir . '/*.json') ?: [];
    usort($paths, static fn ($a, $b) => (int) (@filemtime($b) ?: 0) <=> (int) (@filemtime($a) ?: 0));

    $checked = 0;
    $logged = 0;
    $updated = 0;
    $errors = [];

    foreach ($paths as $path) {
        if ($checked >= $limit) {
            break;
        }
        $txId = basename($path, '.json');
        if ($txId === '' || str_starts_with($txId, 'mf_')) {
            continue;
        }
        if (credpix_analytics_payment_event_exists($txId, $days + 3)) {
            continue;
        }

        $tx = json_decode((string) file_get_contents($path), true);
        if (!is_array($tx)) {
            continue;
        }
        $created = (int) ($tx['created'] ?? 0);
        if ($created > 9999999999) {
            $created = (int) floor($created / 1000);
        }
        if ($created > 0 && $created < $cutoffSec) {
            continue;
        }

        $checked++;
        if (($tx['status'] ?? '') === 'paid') {
            credpix_analytics_log_checkout_paid($txId, $tx);
            credpix_save_tx($txId, $tx);
            if (!empty($tx['analytics_paid_logged'])) {
                $logged++;
                $updated++;
            }
            continue;
        }

        $gwId = credpix_gateway_payment_id_from_tx($tx) ?: $txId;
        try {
            $payment = credpix_gateway_get_payment($gwId, $tx);
            $rawStatus = $payment['status'] ?? $payment['Status'] ?? 'PENDING';
            $status = credpix_gateway_map_status($rawStatus, $tx);
            if ($status !== 'paid') {
                continue;
            }
            $paidAt = credpix_utmify_parse_paid_at(
                $payment['paidAt'] ?? $payment['PaidAt'] ?? $payment['data']['paidAt'] ?? null
            );
            $tx['status'] = 'paid';
            credpix_utmify_on_status_paid($txId, $tx, $paidAt);
            credpix_analytics_log_checkout_paid($txId, $tx);
            credpix_save_tx($txId, $tx);
            $updated++;
            if (!empty($tx['analytics_paid_logged'])) {
                $logged++;
            }
        } catch (Throwable $e) {
            if (count($errors) < 8) {
                $errors[] = ['transaction_id' => $txId, 'error' => $e->getMessage()];
            }
        }
    }

    credpix_analytics_clear_stats_cache();

    return [
        'ok' => true,
        'days' => $days,
        'limit' => $limit,
        'checked' => $checked,
        'logged' => $logged,
        'updated' => $updated,
        'errors' => $errors,
    ];
}

/**
 * Enriquece TX antigas: perfil demográfico via CPF (API) e geo via IP (ip-api.com).
 * Usa cache em data/lead-profile/ e data/ip-geo/ — rode várias vezes no diagnóstico.
 */
function credpix_analytics_backfill_enrichment(int $days = 30, int $profileLimit = 40, int $geoLimit = 80): array
{
    require_once __DIR__ . '/consultar-cpf.php';
    require_once __DIR__ . '/lead-profile.php';
    require_once __DIR__ . '/ip-geo.php';

    $days = max(1, min(90, $days));
    $profileLimit = max(0, min(100, $profileLimit));
    $geoLimit = max(0, min(200, $geoLimit));

    $dir = credpix_data_dir();
    if (!is_dir($dir)) {
        return [
            'ok' => true,
            'days' => $days,
            'checked' => 0,
            'profiles_fetched' => 0,
            'geo_fetched' => 0,
            'updated' => 0,
            'cpf_configured' => credpix_cpf_service_configured(),
        ];
    }

    $cutoffSec = (new DateTimeImmutable(credpix_analytics_period_start_key($days), credpix_analytics_tz()))->getTimestamp();
    $paths = glob($dir . '/*.json') ?: [];
    usort($paths, static fn ($a, $b) => (int) (@filemtime($b) ?: 0) <=> (int) (@filemtime($a) ?: 0));

    $checked = 0;
    $profilesFetched = 0;
    $geoFetched = 0;
    $updated = 0;
    $profilesLeft = $profileLimit;
    $geoLeft = $geoLimit;

    foreach ($paths as $path) {
        if ($profilesLeft <= 0 && $geoLeft <= 0) {
            break;
        }
        $txId = basename($path, '.json');
        if ($txId === '' || str_starts_with($txId, 'mf_')) {
            continue;
        }

        $tx = json_decode((string) file_get_contents($path), true);
        if (!is_array($tx)) {
            continue;
        }
        $created = (int) ($tx['created'] ?? 0);
        if ($created > 9999999999) {
            $created = (int) floor($created / 1000);
        }
        if ($created > 0 && $created < $cutoffSec) {
            continue;
        }

        $checked++;
        $changed = false;

        $hasProfile = !empty($tx['lead_age']) || !empty($tx['lead_gender']) || !empty($tx['nascimento']);
        if ($profilesLeft > 0 && !$hasProfile) {
            $doc = credpix_tx_payer_document($tx);
            if ($doc !== null) {
                $fromCpf = credpix_lead_profile_lookup_by_cpf($doc, true);
                if (is_array($fromCpf)) {
                    $tx = array_merge($tx, $fromCpf);
                    $changed = true;
                    $profilesFetched++;
                    $profilesLeft--;
                }
            }
        }

        $needsGeo = empty($tx['country']) || empty($tx['city']) || empty($tx['region']);
        $ip = (string) ($tx['client_ip'] ?? '');
        if ($geoLeft > 0 && $needsGeo && $ip !== '') {
            $ipGeo = credpix_ip_geo_lookup($ip, true);
            if ($ipGeo !== []) {
                $tx = array_merge($tx, credpix_ip_geo_to_tx_fields($ipGeo));
                $changed = true;
                $geoFetched++;
                $geoLeft--;
            }
        }

        if ($changed) {
            credpix_save_tx($txId, $tx);
            $updated++;
        }
    }

    credpix_analytics_clear_stats_cache();

    return [
        'ok' => true,
        'days' => $days,
        'checked' => $checked,
        'profiles_fetched' => $profilesFetched,
        'geo_fetched' => $geoFetched,
        'updated' => $updated,
        'cpf_configured' => credpix_cpf_service_configured(),
        'profile_limit' => $profileLimit,
        'geo_limit' => $geoLimit,
    ];
}

function credpix_analytics_find_pix_generated_context(string $txId): array
{
    if ($txId === '') {
        return [];
    }
    $normId = strtolower(trim($txId));
    $startKey = credpix_analytics_period_start_key(14);
    $endKey = (new DateTimeImmutable('now', credpix_analytics_tz()))->format('Y-m-d');
    foreach (credpix_analytics_list_event_files_for_range($startKey, $endKey) as $file) {
        $handle = @fopen($file, 'rb');
        if (!$handle) {
            continue;
        }
        while (($line = fgets($handle)) !== false) {
            $row = json_decode(trim($line), true);
            if (!is_array($row) || ($row['type'] ?? '') !== 'pix_generated') {
                continue;
            }
            if (credpix_analytics_event_tx_id($row) !== $normId) {
                continue;
            }
            fclose($handle);
            return $row;
        }
        fclose($handle);
    }
    return [];
}

/** @return array<string, mixed> */
function credpix_analytics_payment_payload_from_tx(string $txId, array $tx, array $overrides = []): array
{
    $utms = is_array($tx['utms'] ?? null) ? $tx['utms'] : [];
    $analytics = is_array($tx['analytics'] ?? null) ? $tx['analytics'] : [];
    $pixCtx = credpix_analytics_find_pix_generated_context($txId);
    $pick = static function (string $key) use ($tx, $analytics, $pixCtx) {
        foreach ([$tx, $analytics, $pixCtx] as $src) {
            if (!is_array($src)) {
                continue;
            }
            if (array_key_exists($key, $src) && $src[$key] !== null && $src[$key] !== '') {
                return $src[$key];
            }
        }
        return null;
    };

    /* Herda meta do pix_generated (phone, pix_key, dados do wizard) */
    $inheritedMeta = ['transaction_id' => $txId, 'source' => 'checkout'];
    if (is_array($pixCtx['meta'] ?? null)) {
        foreach ($pixCtx['meta'] as $mk => $mv) {
            if ($mv !== null && $mv !== '' && !isset($inheritedMeta[$mk])) {
                $inheritedMeta[$mk] = $mv;
            }
        }
    }

    return array_merge([
        'type' => 'payment_paid',
        'session_id' => 'pix_' . $txId,
        'product_id' => $tx['product_id'] ?? null,
        'amount_cents' => isset($tx['amount_cents']) ? (int) $tx['amount_cents'] : null,
        'funnel_step' => 'payment_paid',
        'traffic_src' => $utms['src'] ?? null,
        'utm_source' => $utms['utm_source'] ?? null,
        'utm_medium' => $utms['utm_medium'] ?? null,
        'utm_campaign' => $utms['utm_campaign'] ?? null,
        'utm_content' => $utms['utm_content'] ?? null,
        'device_hash' => $pick('device_hash'),
        'base_path' => $pick('base_path'),
        'browser_session_id' => $pick('browser_session_id'),
        'country' => $pick('country'),
        'city' => $pick('city'),
        'region' => $pick('region'),
        'nascimento' => $pick('nascimento'),
        'sexo' => $pick('sexo'),
        'meta' => $inheritedMeta,
    ], credpix_analytics_first_touch_fields($utms), credpix_lead_sanitize_event_fields(
        credpix_insights_event_lead_fields([
            'lead_age' => $pick('lead_age'),
            'lead_age_band' => $pick('lead_age_band'),
            'lead_gender' => $pick('lead_gender'),
            'nascimento' => $pick('nascimento'),
            'sexo' => $pick('sexo'),
        ])
    ), $overrides);
}

function credpix_analytics_client_geo_for_tx(): array
{
    $geo = credpix_analytics_client_geo();
    $out = [];
    if (!empty($geo['country']) && $geo['country'] !== 'XX') {
        $out['country'] = $geo['country'];
    }
    if (!empty($geo['city'])) {
        $out['city'] = $geo['city'];
    }
    if (!empty($geo['region'])) {
        $out['region'] = $geo['region'];
    }
    return $out;
}

function credpix_analytics_log_checkout_paid(string $txId, array &$tx): void
{
    if (!empty($tx['analytics_paid_logged']) && credpix_analytics_payment_event_exists($txId)) {
        return;
    }
    if (credpix_analytics_payment_event_exists($txId)) {
        $tx['analytics_paid_logged'] = true;
        return;
    }
    $payload = credpix_analytics_payment_payload_from_tx($txId, $tx, [
        'ts' => (int) (time() * 1000),
        'meta' => ['transaction_id' => $txId, 'source' => 'checkout'],
    ]);
    $result = credpix_analytics_append($payload);
    if (!empty($result['skipped']) && ($result['reason'] ?? '') !== 'duplicate_payment') {
        return;
    }
    $tx['analytics_paid_logged'] = true;
}

function credpix_analytics_log_payment_webhook(
    string $paymentId,
    string $status,
    ?array $txData,
    bool $signatureValid = true,
    ?array $webhookBody = null
): ?array {
    if ($status !== 'paid') {
        return null;
    }
    require_once __DIR__ . '/masterfy.php';
    $tx = is_array($txData) ? $txData : credpix_load_tx($paymentId);
    if ($tx && !empty($tx['analytics_paid_logged'])) {
        return null;
    }
    $paidAt = credpix_utmify_parse_paid_at($webhookBody['paidAt'] ?? $webhookBody['data']['paidAt'] ?? null);
    $tsMs = ($paidAt ?? time()) * 1000;
    $amountCents = credpix_masterfy_resolve_amount_cents($paymentId, $webhookBody, $tx);
    if (!$tx) {
        return credpix_analytics_append([
            'type' => 'payment_paid',
            'ts' => $tsMs,
            'session_id' => 'webhook_' . $paymentId,
            'product_id' => null,
            'amount_cents' => $amountCents,
            'funnel_step' => 'payment_paid',
            'meta' => ['payment_id' => $paymentId, 'transaction_id' => $paymentId, 'source' => 'webhook'],
        ]);
    }
    if ($amountCents !== null) {
        $tx['amount_cents'] = $amountCents;
    }
    $ev = credpix_analytics_append(credpix_analytics_payment_payload_from_tx($paymentId, $tx, [
        'ts' => $tsMs,
        'meta' => ['payment_id' => $paymentId, 'transaction_id' => $paymentId, 'source' => 'webhook'],
    ]));
    $tx['analytics_paid_logged'] = true;
    credpix_save_tx($paymentId, $tx);
    return $ev;
}
