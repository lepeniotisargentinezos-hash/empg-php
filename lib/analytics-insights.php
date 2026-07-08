<?php
declare(strict_types=1);

function credpix_insights_dir(): string
{
    return credpix_analytics_dir();
}

function credpix_insights_ad_spend_path(): string
{
    return credpix_insights_dir() . '/ad-spend.json';
}

function credpix_insights_alerts_config_path(): string
{
    return credpix_insights_dir() . '/alerts-config.json';
}

function credpix_insights_read_json(string $path, array $fallback): array
{
    if (!is_file($path)) {
        return $fallback;
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : $fallback;
}

function credpix_insights_write_json(string $path, array $data): void
{
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n", LOCK_EX);
}

function credpix_insights_read_ad_spend(): array
{
    return credpix_insights_read_json(credpix_insights_ad_spend_path(), ['by_src' => [], 'updated_at' => null]);
}

function credpix_insights_save_ad_spend(array $bySrc): array
{
    $payload = ['by_src' => $bySrc, 'updated_at' => (int) (microtime(true) * 1000)];
    credpix_insights_write_json(credpix_insights_ad_spend_path(), $payload);
    return $payload;
}

function credpix_insights_daily_goal_path(): string
{
    return credpix_insights_dir() . '/daily-goal.json';
}

function credpix_insights_read_daily_goal(): array
{
    return credpix_insights_read_json(credpix_insights_daily_goal_path(), [
        'target_cents' => 0,
        'updated_at' => null,
    ]);
}

function credpix_insights_save_daily_goal(int $targetCents): array
{
    $payload = [
        'target_cents' => max(0, $targetCents),
        'updated_at' => (int) (microtime(true) * 1000),
    ];
    credpix_insights_write_json(credpix_insights_daily_goal_path(), $payload);
    return $payload;
}

function credpix_insights_roas_timeline(array $events, int $days, array $adSpend): array
{
    $byDay = [];
    $tz = credpix_analytics_tz();
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            continue;
        }
        $ts = credpix_analytics_ts_to_seconds(isset($ev['ts']) ? (int) $ev['ts'] : null) ?? time();
        $dt = (new DateTime('@' . $ts))->setTimezone($tz);
        $dayKey = $dt->format('Y-m-d');
        $byDay[$dayKey] = ($byDay[$dayKey] ?? 0) + (int) ($ev['amount_cents'] ?? 0);
    }
    ksort($byDay);

    $totalSpend = array_sum(array_map('intval', $adSpend['by_src'] ?? []));
    $totalRevenue = array_sum($byDay);

    $spendForDay = static function (int $revenueCents) use ($totalSpend, $totalRevenue): int {
        if ($totalSpend <= 0) {
            return 0;
        }
        if ($totalRevenue <= 0) {
            return 0;
        }
        return (int) round($totalSpend * ($revenueCents / $totalRevenue));
    };

    $rows = [];
    if ($days <= 1) {
        $revenue = array_sum($byDay);
        $roas = $totalSpend > 0 ? round(($revenue / $totalSpend) * 10) / 10 : null;
        $rows[] = [
            'label' => 'Hoje',
            'revenue_cents' => $revenue,
            'spend_cents' => $totalSpend,
            'roas' => $roas,
            'revenue_formatted' => 'R$ ' . credpix_format_brl($revenue),
            'spend_formatted' => 'R$ ' . credpix_format_brl($totalSpend),
        ];
        return $rows;
    }

    foreach ($byDay as $dayKey => $cents) {
        $dailySpend = $spendForDay($cents);
        $roas = $dailySpend > 0 ? round(($cents / $dailySpend) * 10) / 10 : null;
        $rows[] = [
            'label' => (new DateTime($dayKey))->format('d/m'),
            'revenue_cents' => $cents,
            'spend_cents' => $dailySpend,
            'roas' => $roas,
            'revenue_formatted' => 'R$ ' . credpix_format_brl($cents),
            'spend_formatted' => 'R$ ' . credpix_format_brl($dailySpend),
        ];
    }
    return $rows;
}

function credpix_insights_read_alerts_config(): array
{
    $defaults = [
        'no_sale_hours' => 2,
        'stale_pix_minutes' => 30,
        'business_hours_start' => 8,
        'business_hours_end' => 22,
    ];
    return array_merge($defaults, credpix_insights_read_json(credpix_insights_alerts_config_path(), []));
}

function credpix_insights_save_alerts_config(array $config): array
{
    $payload = array_merge(credpix_insights_read_alerts_config(), $config, ['updated_at' => (int) (microtime(true) * 1000)]);
    credpix_insights_write_json(credpix_insights_alerts_config_path(), $payload);
    return $payload;
}

function credpix_insights_format_duration(?int $ms): string
{
    if ($ms === null || $ms < 0) {
        return '—';
    }
    $sec = (int) round($ms / 1000);
    if ($sec < 60) {
        return $sec . 's';
    }
    $min = (int) round($sec / 60);
    if ($min < 60) {
        return $min . ' min';
    }
    $h = (int) floor($min / 60);
    $m = $min % 60;
    return $h . 'h' . ($m ? ' ' . $m . 'min' : '');
}

function credpix_insights_median(array $values): ?int
{
    $nums = array_values(array_filter($values, static fn ($v) => $v !== null));
    sort($nums);
    $n = count($nums);
    if ($n === 0) {
        return null;
    }
    $mid = (int) floor($n / 2);
    return $n % 2 ? (int) $nums[$mid] : (int) round(($nums[$mid - 1] + $nums[$mid]) / 2);
}

function credpix_insights_pct_change(float $current, float $previous): float
{
    if ($previous == 0.0) {
        return $current ? 100.0 : 0.0;
    }
    return round((($current - $previous) / $previous) * 1000) / 10;
}

function credpix_insights_funnel_dropoff(array $funnelCounts, array $wizardSteps = []): array
{
    $landing = (int) ($funnelCounts['landing'] ?? 0);
    $rows = [];
    $prev = null;

    $addRow = static function (
        string $key,
        string $label,
        int $count,
        bool $isWizardSubstep = false
    ) use (&$rows, &$prev, $landing): void {
        $drop = ($prev !== null && $prev > 0) ? round((($prev - $count) / $prev) * 1000) / 10 : 0;
        $retain = $landing > 0 ? round(($count / $landing) * 1000) / 10 : 0;
        $rows[] = [
            'step' => $key,
            'label' => $label,
            'count' => $count,
            'drop_from_prev_pct' => $prev === null ? 0 : $drop,
            'retain_from_landing_pct' => $retain,
            'is_wizard_substep' => $isWizardSubstep,
        ];
        $prev = $count;
    };

    $addRow('landing', 'Landing', $landing);

    if ($wizardSteps !== []) {
        foreach ($wizardSteps as $ws) {
            $addRow(
                'wizard:' . ($ws['step'] ?? 'step'),
                'Wizard · ' . ($ws['step_label'] ?? $ws['step'] ?? 'Etapa'),
                (int) ($ws['sessions'] ?? 0),
                true
            );
        }
    } else {
        $addRow('wizard', 'Wizard', (int) ($funnelCounts['wizard'] ?? 0));
    }

    $addRow('checkout', 'Checkout', (int) ($funnelCounts['checkout'] ?? 0));
    $addRow('pix_generated', 'PIX gerado', (int) ($funnelCounts['pix_generated'] ?? 0));
    $addRow('payment_paid', 'Pago', (int) ($funnelCounts['payment_paid'] ?? 0));

    return $rows;
}

function credpix_insights_session_geo_map(array $events): array
{
    $map = [];
    $merge = static function (string $key, array $ev) use (&$map): void {
        if ($key === '' || $key === 'anon') {
            return;
        }
        if (!isset($map[$key])) {
            $map[$key] = [];
        }
        if (!empty($ev['country']) && $ev['country'] !== 'XX') {
            $map[$key]['country'] = $ev['country'];
        }
        if (!empty($ev['city'])) {
            $map[$key]['city'] = $ev['city'];
        }
        if (!empty($ev['region'])) {
            $map[$key]['region'] = $ev['region'];
        }
    };

    foreach ($events as $ev) {
        if (empty($ev['country']) && empty($ev['city']) && empty($ev['region'])) {
            continue;
        }
        foreach ([
            (string) ($ev['session_id'] ?? ''),
            (string) ($ev['browser_session_id'] ?? ''),
            credpix_analytics_journey_key($ev),
        ] as $key) {
            $merge($key, $ev);
        }
        $txId = credpix_analytics_event_tx_id($ev);
        if ($txId !== null && $txId !== '') {
            $merge('pix_' . $txId, $ev);
        }
    }
    return $map;
}

function credpix_insights_conversion_times(array $events): array
{
    $sessions = [];
    foreach ($events as $ev) {
        $sid = credpix_analytics_journey_key($ev);
        if ($sid === '' || $sid === 'anon') {
            continue;
        }
        if (!isset($sessions[$sid])) {
            $sessions[$sid] = ['landing' => null, 'pix' => null, 'paid' => null];
        }
        $ts = (int) ($ev['ts'] ?? 0);
        if (($ev['funnel_step'] ?? '') === 'landing' || ($ev['page_label'] ?? '') === 'Landing' || ($ev['page_label'] ?? '') === 'Início') {
            if ($sessions[$sid]['landing'] === null || $ts < $sessions[$sid]['landing']) {
                $sessions[$sid]['landing'] = $ts;
            }
        }
        if (($ev['type'] ?? '') === 'pix_generated') {
            if ($sessions[$sid]['pix'] === null || $ts < $sessions[$sid]['pix']) {
                $sessions[$sid]['pix'] = $ts;
            }
        }
        if (($ev['type'] ?? '') === 'payment_paid') {
            if ($sessions[$sid]['paid'] === null || $ts < $sessions[$sid]['paid']) {
                $sessions[$sid]['paid'] = $ts;
            }
        }
    }

    $l2p = [];
    $p2paid = [];
    $l2paid = [];
    foreach ($sessions as $row) {
        if ($row['landing'] !== null && $row['pix'] !== null && $row['pix'] >= $row['landing']) {
            $l2p[] = $row['pix'] - $row['landing'];
        }
        if ($row['pix'] !== null && $row['paid'] !== null && $row['paid'] >= $row['pix']) {
            $p2paid[] = $row['paid'] - $row['pix'];
        }
        if ($row['landing'] !== null && $row['paid'] !== null && $row['paid'] >= $row['landing']) {
            $l2paid[] = $row['paid'] - $row['landing'];
        }
    }

    $m1 = credpix_insights_median($l2p);
    $m2 = credpix_insights_median($p2paid);
    $m3 = credpix_insights_median($l2paid);

    return [
        'landing_to_pix_ms' => $m1,
        'landing_to_pix_label' => credpix_insights_format_duration($m1),
        'pix_to_paid_ms' => $m2,
        'pix_to_paid_label' => credpix_insights_format_duration($m2),
        'landing_to_paid_ms' => $m3,
        'landing_to_paid_label' => credpix_insights_format_duration($m3),
        'samples' => [
            'landing_to_pix' => count($l2p),
            'pix_to_paid' => count($p2paid),
            'landing_to_paid' => count($l2paid),
        ],
    ];
}

function credpix_insights_revenue_by_country(array $events, array $geoMap): array
{
    $map = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            continue;
        }
        $sid = $ev['session_id'] ?? '';
        $country = (!empty($ev['country']) && $ev['country'] !== 'XX')
            ? $ev['country']
            : ($geoMap[$sid]['country'] ?? 'XX');
        if (!isset($map[$country])) {
            $map[$country] = ['country' => $country, 'payments' => 0, 'revenue_cents' => 0];
        }
        $map[$country]['payments']++;
        $map[$country]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
    }
    $out = array_values($map);
    usort($out, static fn ($a, $b) => $b['revenue_cents'] <=> $a['revenue_cents']);
    foreach ($out as &$row) {
        $row['revenue_formatted'] = 'R$ ' . credpix_format_brl($row['revenue_cents']);
    }
    return $out;
}

function credpix_insights_state_label(?string $region, ?string $country = null): string
{
    if ($region === null || trim($region) === '') {
        if ($country !== null && $country !== '' && $country !== 'XX') {
            return strtoupper($country) === 'BR' ? 'Brasil (sem UF)' : ('País ' . $country);
        }
        return 'Sem geo';
    }
    $region = trim($region);
    $codes = [
        'AC' => 'Acre', 'AL' => 'Alagoas', 'AP' => 'Amapá', 'AM' => 'Amazonas', 'BA' => 'Bahia',
        'CE' => 'Ceará', 'DF' => 'Distrito Federal', 'ES' => 'Espírito Santo', 'GO' => 'Goiás',
        'MA' => 'Maranhão', 'MT' => 'Mato Grosso', 'MS' => 'Mato Grosso do Sul', 'MG' => 'Minas Gerais',
        'PA' => 'Pará', 'PB' => 'Paraíba', 'PR' => 'Paraná', 'PE' => 'Pernambuco', 'PI' => 'Piauí',
        'RJ' => 'Rio de Janeiro', 'RN' => 'Rio Grande do Norte', 'RS' => 'Rio Grande do Sul',
        'RO' => 'Rondônia', 'RR' => 'Roraima', 'SC' => 'Santa Catarina', 'SP' => 'São Paulo',
        'SE' => 'Sergipe', 'TO' => 'Tocantins',
    ];
    $upper = strtoupper($region);
    if (isset($codes[$upper])) {
        return $codes[$upper];
    }
    if (preg_match('/^(?:BR-)?([A-Z]{2})$/', $upper, $m) && isset($codes[$m[1]])) {
        return $codes[$m[1]];
    }
    if ($country !== null && strtoupper($country) !== 'BR' && $country !== 'XX') {
        return $region . ' (' . $country . ')';
    }
    return $region;
}

function credpix_insights_resolve_event_geo(array $ev, array $geoMap): array
{
    $txId = credpix_analytics_event_tx_id($ev);
    foreach ([
        credpix_analytics_journey_key($ev),
        (string) ($ev['browser_session_id'] ?? ''),
        (string) ($ev['session_id'] ?? ''),
        $txId !== null && $txId !== '' ? 'pix_' . $txId : '',
    ] as $key) {
        if ($key !== '' && isset($geoMap[$key])) {
            return $geoMap[$key];
        }
    }
    return [];
}

function credpix_insights_revenue_by_state(array $events, array $geoMap): array
{
    $map = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            continue;
        }
        $geo = credpix_insights_resolve_event_geo($ev, $geoMap);
        $region = $ev['region'] ?? ($geo['region'] ?? null);
        $country = (!empty($ev['country']) && $ev['country'] !== 'XX')
            ? $ev['country']
            : ($geo['country'] ?? 'XX');
        if ($region !== null && $region !== '') {
            $key = strtoupper($country) . '|' . $region;
            $label = credpix_insights_state_label($region, $country);
        } elseif ($country !== 'XX') {
            $key = strtoupper($country) . '|__country__';
            $label = credpix_insights_state_label(null, $country);
        } else {
            $key = '__unknown__';
            $label = 'Sem geo CF';
        }
        if (!isset($map[$key])) {
            $map[$key] = [
                'state_key' => $key,
                'state' => $region,
                'country' => $country,
                'state_label' => $label,
                'payments' => 0,
                'revenue_cents' => 0,
            ];
        }
        $map[$key]['payments']++;
        $map[$key]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
    }
    $out = array_values($map);
    usort($out, static fn ($a, $b) => $b['revenue_cents'] <=> $a['revenue_cents']);
    foreach ($out as &$row) {
        $row['revenue_formatted'] = 'R$ ' . credpix_format_brl($row['revenue_cents']);
    }
    unset($row);
    return $out;
}

function credpix_insights_top_cities(array $events, array $live, array $geoMap): array
{
    $map = [];
    $bump = static function (?string $city, ?string $country, int $online, int $paid, int $cents) use (&$map): void {
        if ($city === null || $city === '') {
            return;
        }
        $key = $city . '|' . ($country ?: 'XX');
        if (!isset($map[$key])) {
            $map[$key] = ['city' => $city, 'country' => $country ?: 'XX', 'online' => 0, 'payments' => 0, 'revenue_cents' => 0];
        }
        $map[$key]['online'] += $online;
        $map[$key]['payments'] += $paid;
        $map[$key]['revenue_cents'] += $cents;
    };

    foreach (($live['sessions'] ?? []) as $row) {
        if (!empty($row['city'])) {
            $bump($row['city'], $row['country'] ?? null, 1, 0, 0);
        }
    }

    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            continue;
        }
        $geo = credpix_insights_resolve_event_geo($ev, $geoMap);
        $city = $ev['city'] ?? ($geo['city'] ?? null);
        $country = $ev['country'] ?? ($geo['country'] ?? null);
        if ($country === 'XX' || $country === null || $country === '') {
            $country = null;
        }
        $region = $ev['region'] ?? ($geo['region'] ?? null);
        if (!$city && $region !== null && $region !== '') {
            $city = credpix_insights_state_label($region, $country);
        } elseif (!$city && $country) {
            $city = credpix_insights_state_label(null, $country);
        }
        if ($city) {
            $bump($city, $country, 0, 1, (int) ($ev['amount_cents'] ?? 0));
        }
    }

    $out = array_values($map);
    usort($out, static fn ($a, $b) => ($b['online'] <=> $a['online']) ?: ($b['revenue_cents'] <=> $a['revenue_cents']));
    $out = array_slice($out, 0, 15);
    foreach ($out as &$row) {
        $row['revenue_formatted'] = 'R$ ' . credpix_format_brl($row['revenue_cents']);
    }
    return $out;
}

function credpix_insights_period_compare(int $days, array $allEvents, ?string $srcFilter, ?string $utmCampaign = null, ?string $utmMedium = null, ?string $utmContent = null): array
{
    $filtered = credpix_analytics_apply_event_filters($allEvents, $srcFilter, $utmCampaign, $utmMedium, $utmContent, null);
    $currentEvents = array_values(array_filter($filtered, static fn ($ev) => credpix_analytics_event_in_period($ev, $days)));
    [$prevStart, $prevEnd] = credpix_analytics_previous_period_range($days);
    $previousEvents = array_values(array_filter($filtered, static fn ($ev) => credpix_analytics_event_in_date_range($ev, $prevStart, $prevEnd)));
    return credpix_analytics_period_compare($days, $currentEvents, $previousEvents);
}

function credpix_insights_utm_breakdown(array $events): array
{
    $dims = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
    $out = [];
    foreach ($dims as $dim) {
        $map = [];
        foreach ($events as $ev) {
            $val = $ev[$dim] ?? '(vazio)';
            if (!isset($map[$val])) {
                $map[$val] = ['value' => $val, 'sessions' => [], 'payments' => 0, 'revenue_cents' => 0];
            }
            $map[$val]['sessions'][credpix_analytics_journey_key($ev)] = true;
            if (($ev['type'] ?? '') === 'payment_paid') {
                $map[$val]['payments']++;
                $map[$val]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
            }
        }
        $rows = [];
        foreach ($map as $row) {
            $rows[] = [
                'value' => $row['value'],
                'sessions' => count($row['sessions']),
                'payments' => $row['payments'],
                'revenue_cents' => $row['revenue_cents'],
                'revenue_formatted' => 'R$ ' . credpix_format_brl($row['revenue_cents']),
            ];
        }
        usort($rows, static fn ($a, $b) => $b['revenue_cents'] <=> $a['revenue_cents']);
        $out[$dim] = array_slice($rows, 0, 12);
    }
    return $out;
}

function credpix_insights_campaigns_roas(array $campaigns, array $adSpend): array
{
    $spend = $adSpend['by_src'] ?? [];
    $out = [];
    foreach ($campaigns as $row) {
        $spendCents = (int) ($spend[$row['src']] ?? 0);
        $roas = $spendCents > 0 ? round(($row['revenue_cents'] / $spendCents) * 100) / 100 : null;
        $cpa = ($row['payments'] ?? 0) > 0 && $spendCents > 0 ? (int) round($spendCents / $row['payments']) : null;
        $out[] = array_merge($row, [
            'ad_spend_cents' => $spendCents,
            'ad_spend_formatted' => 'R$ ' . credpix_format_brl($spendCents),
            'roas' => $roas,
            'cpa_cents' => $cpa,
            'cpa_formatted' => $cpa !== null ? ('R$ ' . credpix_format_brl($cpa)) : '—',
        ]);
    }
    return $out;
}

function credpix_insights_enrich_pix_pending(array $pending, int $staleMinutes): array
{
    $now = (int) (microtime(true) * 1000);
    $out = [];
    foreach ($pending as $row) {
        $ts = (int) ($row['ts'] ?? 0);
        $ageMinutes = (int) round(($now - $ts) / 60000);
        if ($ageMinutes < 0) {
            $ageMinutes = 0;
        }
        $out[] = array_merge($row, [
            'age_minutes' => $ageMinutes,
            'age_label' => $ageMinutes < 60 ? ($ageMinutes . ' min') : ((int) floor($ageMinutes / 60) . 'h ' . ($ageMinutes % 60) . 'min'),
            'stale' => $ageMinutes >= $staleMinutes,
        ]);
    }
    return $out;
}

function credpix_insights_cloudflare_geo_health(array $events): array
{
    $paid = 0;
    $withGeo = 0;
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            continue;
        }
        $paid++;
        if (!empty($ev['region']) || !empty($ev['country']) || !empty($ev['city'])) {
            $withGeo++;
        }
    }
    $pct = $paid > 0 ? (int) round(($withGeo / $paid) * 100) : 0;
    return [
        'ok' => $paid === 0 || $pct >= 25,
        'coverage_pct' => $pct,
        'paid_with_geo' => $withGeo,
        'paid_total' => $paid,
        'header' => 'CF-IPCountry / CF-Region',
    ];
}

function credpix_insights_session_journey(string $sessionId, int $days): ?array
{
    $sid = trim($sessionId);
    if ($sid === '') {
        return null;
    }
    $searchDays = max(1, min(90, $days));
    $journey = credpix_insights_session_journey_for_days($sid, $searchDays);
    if ($journey === null && $searchDays < 90) {
        $journey = credpix_insights_session_journey_for_days($sid, 90);
        if ($journey !== null) {
            $journey['extended_search'] = true;
        }
    }
    return $journey;
}

function credpix_insights_session_journey_for_days(string $sessionId, int $days): ?array
{
    $sid = trim($sessionId);
    if ($sid === '') {
        return null;
    }
    $events = credpix_analytics_read_events($days);
    $events = array_values(array_filter($events, static fn ($ev) => ($ev['session_id'] ?? '') === $sid));
    usort($events, static fn ($a, $b) => ((int) ($a['ts'] ?? 0)) <=> ((int) ($b['ts'] ?? 0)));
    if (!$events) {
        return null;
    }

    $steps = [];
    foreach ($events as $ev) {
        $cents = isset($ev['amount_cents']) ? (int) $ev['amount_cents'] : null;
        $steps[] = [
            'ts' => $ev['ts'] ?? 0,
            'type' => $ev['type'] ?? '',
            'page_label' => $ev['page_label'] ?? ($ev['page'] ?? ''),
            'funnel_step' => $ev['funnel_step'] ?? null,
            'product_name' => $ev['product_name'] ?? null,
            'amount_cents' => $cents,
            'amount_formatted' => $cents !== null ? ('R$ ' . credpix_format_brl($cents)) : null,
            'traffic_src' => $ev['traffic_src'] ?? null,
            'country' => $ev['country'] ?? null,
            'city' => $ev['city'] ?? null,
        ];
    }

    $first = $events[0];
    $last = $events[count($events) - 1];
    $paid = null;
    $pix = null;
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') === 'payment_paid') {
            $paid = $ev;
        }
        if (($ev['type'] ?? '') === 'pix_generated') {
            $pix = $ev;
        }
    }

    $duration = (int) ($last['ts'] ?? 0) - (int) ($first['ts'] ?? 0);
    $profileMaps = credpix_insights_lead_profile_maps($events);
    $lead = credpix_insights_resolve_lead_profile($first, $profileMaps);

    return [
        'session_id' => $sid,
        'event_count' => count($events),
        'started_at' => $first['ts'] ?? 0,
        'last_at' => $last['ts'] ?? 0,
        'duration_ms' => $duration,
        'duration_label' => credpix_insights_format_duration($duration),
        'traffic_src' => $first['traffic_src'] ?? null,
        'utm_campaign' => $first['utm_campaign'] ?? null,
        'country' => $first['country'] ?? null,
        'city' => $first['city'] ?? null,
        'converted' => $paid !== null,
        'pix_generated' => $pix !== null,
        'lead_age' => $lead['lead_age'] ?? null,
        'lead_age_band' => $lead['lead_age_band'] ?? null,
        'lead_age_label' => $lead['lead_age_label'] ?? '—',
        'lead_gender' => $lead['lead_gender'] ?? null,
        'lead_gender_label' => $lead['lead_gender_label'] ?? '—',
        'steps' => $steps,
    ];
}

function credpix_insights_transition_sankey(array $transitions): array
{
    $nodes = [];
    $links = [];
    foreach ($transitions as $row) {
        $parts = explode(' → ', (string) ($row['flow'] ?? ''));
        if (count($parts) !== 2) {
            continue;
        }
        $from = trim($parts[0]);
        $to = trim($parts[1]);
        $nodes[$from] = true;
        $nodes[$to] = true;
        $links[] = ['from' => $from, 'to' => $to, 'value' => (int) ($row['count'] ?? 0)];
    }
    usort($links, static fn ($a, $b) => $b['value'] <=> $a['value']);
    return ['nodes' => array_keys($nodes), 'links' => array_slice($links, 0, 15)];
}

function credpix_insights_hourly_activity(array $events): array
{
    $hours = [];
    for ($h = 0; $h < 24; $h++) {
        $hours[$h] = [
            'hour' => $h,
            'label' => str_pad((string) $h, 2, '0', STR_PAD_LEFT) . 'h',
            'page_views' => 0,
            'payments' => 0,
            'revenue_cents' => 0,
        ];
    }
    $tz = credpix_analytics_tz();
    foreach ($events as $ev) {
        $ts = credpix_analytics_ts_to_seconds(isset($ev['ts']) ? (int) $ev['ts'] : null) ?? time();
        $dt = (new DateTime('@' . $ts))->setTimezone($tz);
        $h = (int) $dt->format('G');
        if (($ev['type'] ?? '') === 'page_view') {
            $hours[$h]['page_views']++;
        }
        if (($ev['type'] ?? '') === 'payment_paid') {
            $hours[$h]['payments']++;
            $hours[$h]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
        }
    }
    foreach ($hours as &$row) {
        $row['revenue_formatted'] = 'R$ ' . credpix_format_brl($row['revenue_cents']);
    }
    unset($row);
    return array_values($hours);
}

/** @return array<string, array> */
function credpix_insights_pix_events_by_tx(array $events): array
{
    $map = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'pix_generated') {
            continue;
        }
        $txId = credpix_analytics_event_tx_id($ev);
        if ($txId) {
            $map[$txId] = $ev;
        }
    }
    return $map;
}

/** @return array{by_session: array<string, string>, by_device: array<string, string>} */
function credpix_insights_landing_base_maps(array $events): array
{
    $bySession = [];
    $byDevice = [];
    foreach ($events as $ev) {
        $base = isset($ev['base_path']) ? trim((string) $ev['base_path']) : '';
        if ($base === '') {
            continue;
        }
        $isLanding = ($ev['page_label'] ?? '') === 'Landing'
            || ($ev['funnel_step'] ?? '') === 'landing'
            || ($ev['type'] ?? '') === 'page_view';
        if (!$isLanding) {
            continue;
        }
        $sid = (string) ($ev['session_id'] ?? '');
        if ($sid !== '' && !isset($bySession[$sid])) {
            $bySession[$sid] = $base;
        }
        $device = (string) ($ev['device_hash'] ?? '');
        if ($device !== '' && !isset($byDevice[$device])) {
            $byDevice[$device] = $base;
        }
    }
    return ['by_session' => $bySession, 'by_device' => $byDevice];
}

/** @return array<string, array{country?: string, region?: string, city?: string}> */
function credpix_insights_device_geo_map(array $events): array
{
    $map = [];
    foreach ($events as $ev) {
        $device = (string) ($ev['device_hash'] ?? '');
        if ($device === '') {
            continue;
        }
        if (!isset($map[$device])) {
            $map[$device] = [];
        }
        if (!empty($ev['country']) && $ev['country'] !== 'XX') {
            $map[$device]['country'] = $ev['country'];
        }
        if (!empty($ev['city'])) {
            $map[$device]['city'] = $ev['city'];
        }
        if (!empty($ev['region'])) {
            $map[$device]['region'] = $ev['region'];
        }
    }
    return $map;
}

function credpix_insights_merge_event_fields(array $target, array $source, array $keys): array
{
    foreach ($keys as $key) {
        if (($target[$key] ?? null) === null || $target[$key] === '') {
            if (isset($source[$key]) && $source[$key] !== null && $source[$key] !== '') {
                $target[$key] = $source[$key];
            }
        }
    }
    return $target;
}

function credpix_insights_enrich_payment_events(array $events, array $allEvents, ?array $scanMaps = null, ?array $profileMaps = null): array
{
    $pixByTx = is_array($scanMaps['pix_by_tx'] ?? null)
        ? $scanMaps['pix_by_tx']
        : credpix_insights_pix_events_by_tx($allEvents);
    $baseMaps = is_array($scanMaps['landing_base_maps'] ?? null)
        ? $scanMaps['landing_base_maps']
        : credpix_insights_landing_base_maps($allEvents);
    $deviceGeo = is_array($scanMaps['device_geo_map'] ?? null)
        ? $scanMaps['device_geo_map']
        : credpix_insights_device_geo_map($allEvents);
    $sessionGeo = is_array($scanMaps['session_geo_map'] ?? null)
        ? $scanMaps['session_geo_map']
        : credpix_insights_session_geo_map($allEvents);
    $contextKeys = [
        'device_hash', 'base_path', 'browser_session_id', 'country', 'city', 'region', 'continent',
        'lead_age', 'lead_age_band', 'lead_gender', 'lead_age_label', 'lead_gender_label',
        'traffic_src', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
        'first_touch_src', 'first_touch_utm_campaign', 'first_touch_utm_medium', 'first_touch_utm_content',
    ];

    $out = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            $out[] = $ev;
            continue;
        }

        $txId = credpix_analytics_event_tx_id($ev);
        $pix = ($txId && isset($pixByTx[$txId])) ? $pixByTx[$txId] : null;
        if ($pix) {
            $ev = credpix_insights_merge_event_fields($ev, $pix, $contextKeys);
        }

        if ($txId) {
            $tx = credpix_load_tx($txId);
            if (is_array($tx)) {
                $txContext = array_merge(
                    is_array($tx['analytics'] ?? null) ? $tx['analytics'] : [],
                    [
                        'base_path' => $tx['base_path'] ?? null,
                        'browser_session_id' => $tx['browser_session_id'] ?? null,
                        'device_hash' => $tx['device_hash'] ?? null,
                        'country' => $tx['country'] ?? null,
                        'city' => $tx['city'] ?? null,
                        'region' => $tx['region'] ?? null,
                    ]
                );
                $ev = credpix_insights_merge_event_fields($ev, $txContext, $contextKeys);
                foreach (['lead_age', 'lead_age_band', 'lead_gender', 'lead_age_label', 'lead_gender_label'] as $field) {
                    if (($ev[$field] ?? null) === null && isset($tx[$field])) {
                        $ev[$field] = $tx[$field];
                    }
                }
                if (($ev['lead_age'] ?? null) === null && ($ev['lead_gender'] ?? null) === null) {
                    if (!empty($tx['nascimento'])) {
                        $ev['nascimento'] = $tx['nascimento'];
                    }
                    if (!empty($tx['sexo'])) {
                        $ev['sexo'] = $tx['sexo'];
                    }
                    $fromNasc = credpix_insights_event_lead_fields($ev);
                    foreach (['lead_age', 'lead_age_band', 'lead_gender'] as $field) {
                        if (($ev[$field] ?? null) === null && ($fromNasc[$field] ?? null) !== null) {
                            $ev[$field] = $fromNasc[$field];
                        }
                    }
                }
                if (($ev['country'] ?? null) === null || ($ev['city'] ?? null) === null || ($ev['region'] ?? null) === null) {
                    require_once __DIR__ . '/ip-geo.php';
                    $ip = (string) ($tx['client_ip'] ?? '');
                    if ($ip !== '') {
                        $ipGeo = credpix_ip_geo_lookup($ip, false);
                        if ($ipGeo !== []) {
                            $ev = credpix_insights_merge_event_fields(
                                $ev,
                                credpix_ip_geo_to_tx_fields($ipGeo),
                                ['country', 'city', 'region']
                            );
                        }
                    }
                }
                if (($ev['lead_age'] ?? null) === null && ($ev['lead_gender'] ?? null) === null) {
                    require_once __DIR__ . '/lead-profile.php';
                    $doc = credpix_tx_payer_document($tx);
                    if ($doc !== null) {
                        $fromCpf = credpix_lead_profile_lookup_by_cpf($doc, false);
                        if (is_array($fromCpf)) {
                            $ev = credpix_lead_apply_profile_fields($ev, $fromCpf);
                            $fromProf = credpix_insights_event_lead_fields($ev);
                            foreach (['lead_age', 'lead_age_band', 'lead_gender'] as $field) {
                                if (($ev[$field] ?? null) === null && ($fromProf[$field] ?? null) !== null) {
                                    $ev[$field] = $fromProf[$field];
                                }
                            }
                        }
                    }
                }
            }
        }

        $browserSid = (string) ($ev['browser_session_id'] ?? '');
        $jKey = credpix_analytics_journey_key($ev);
        if ($jKey !== '' && $jKey !== 'anon' && isset($sessionGeo[$jKey])) {
            $ev = credpix_insights_merge_event_fields($ev, $sessionGeo[$jKey], ['country', 'city', 'region']);
        }
        if ($browserSid !== '' && isset($sessionGeo[$browserSid])) {
            $ev = credpix_insights_merge_event_fields($ev, $sessionGeo[$browserSid], ['country', 'city', 'region']);
        }
        if ($txId !== null && $txId !== '' && isset($sessionGeo['pix_' . $txId])) {
            $ev = credpix_insights_merge_event_fields($ev, $sessionGeo['pix_' . $txId], ['country', 'city', 'region']);
        }

        $device = (string) ($ev['device_hash'] ?? '');
        if ($device !== '') {
            if (isset($deviceGeo[$device])) {
                $ev = credpix_insights_merge_event_fields($ev, $deviceGeo[$device], ['country', 'city', 'region']);
            }
            if (($ev['base_path'] ?? '') === '' && isset($baseMaps['by_device'][$device])) {
                $ev['base_path'] = $baseMaps['by_device'][$device];
            }
        }

        foreach ([$jKey, $browserSid, (string) ($ev['session_id'] ?? '')] as $lookup) {
            if (($ev['base_path'] ?? '') !== '' || $lookup === '') {
                break;
            }
            if (isset($baseMaps['by_session'][$lookup])) {
                $ev['base_path'] = $baseMaps['by_session'][$lookup];
                break;
            }
        }

        if (is_array($profileMaps)) {
            $prof = credpix_insights_resolve_lead_profile($ev, $profileMaps);
            foreach (['lead_age', 'lead_age_band', 'lead_gender'] as $field) {
                if (($ev[$field] ?? null) === null && ($prof[$field] ?? null) !== null) {
                    $ev[$field] = $prof[$field];
                }
            }
        }

        $out[] = $ev;
    }

    return $out;
}

function credpix_analytics_format_conversion_rate(int $paid, int $landing): string
{
    if ($landing <= 0) {
        return $paid > 0 ? '—' : '0%';
    }
    $pct = ($paid / $landing) * 100;
    if ($pct > 0 && $pct < 0.1) {
        return '<0,1%';
    }
    if ($pct < 10) {
        return number_format($pct, 2, ',', '') . '%';
    }
    return number_format(round($pct, 1), 1, ',', '') . '%';
}

function credpix_insights_system_status(array $allEvents, array $live, array $backup): array
{
    $lastEventTs = null;
    foreach ($allEvents as $ev) {
        $ts = (int) ($ev['ts'] ?? 0);
        if ($lastEventTs === null || $ts > $lastEventTs) {
            $lastEventTs = $ts;
        }
    }

    $lastPaid = null;
    foreach ($allEvents as $ev) {
        if (($ev['type'] ?? '') === 'payment_paid') {
            if ($lastPaid === null || (int) ($ev['ts'] ?? 0) > (int) ($lastPaid['ts'] ?? 0)) {
                $lastPaid = $ev;
            }
        }
    }

    return [
        'cloudflare_geo' => credpix_insights_cloudflare_geo_health($allEvents),
        'utmify' => ['enabled' => credpix_utmify_enabled()],
        'backup' => $backup,
        'webhook' => credpix_webhook_health(),
        'live_total' => (int) ($live['total'] ?? 0),
        'last_event_at' => $lastEventTs,
        'last_event_ago_ms' => $lastEventTs ? max(0, (int) (microtime(true) * 1000) - $lastEventTs) : null,
        'last_sale_at' => $lastPaid ? (int) ($lastPaid['ts'] ?? 0) : null,
        'last_sale_amount' => $lastPaid ? ('R$ ' . credpix_format_brl((int) ($lastPaid['amount_cents'] ?? 0))) : null,
        'recent_webhooks' => credpix_webhook_log_read(5),
        'storage' => credpix_analytics_storage_status(),
        'tracking' => [
            'page_view_only' => true,
            'noise_skipped' => credpix_analytics_noise_event_types(),
        ],
    ];
}

function credpix_insights_enhanced_alerts(array $events, int $days, array $baseAlerts, array $pixPending, int $ordersFailedUtmify): array
{
    $config = credpix_insights_read_alerts_config();
    $alerts = $baseAlerts;
    $now = (int) (microtime(true) * 1000);

    $lastPaidTs = null;
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') === 'payment_paid') {
            $ts = (int) ($ev['ts'] ?? 0);
            if ($lastPaidTs === null || $ts > $lastPaidTs) {
                $lastPaidTs = $ts;
            }
        }
    }

    if ($days === 1 && $lastPaidTs !== null) {
        $hoursSince = ($now - $lastPaidTs) / 3600000;
        $hour = (int) (new DateTime('now', credpix_analytics_tz()))->format('G');
        if ($hoursSince >= $config['no_sale_hours'] && $hour >= $config['business_hours_start'] && $hour < $config['business_hours_end']) {
            $alerts[] = ['level' => 'warning', 'message' => 'Nenhuma venda nas últimas ' . $config['no_sale_hours'] . 'h (horário comercial).'];
        }
    }

    $stale = array_filter(
        credpix_insights_enrich_pix_pending($pixPending, (int) $config['stale_pix_minutes']),
        static fn ($p) => !empty($p['stale'])
    );
    if (count($stale) >= 2) {
        $alerts[] = ['level' => 'warning', 'message' => count($stale) . ' PIX pendentes há mais de ' . $config['stale_pix_minutes'] . ' min.'];
    }

    $wh = credpix_webhook_health();
    if (($wh['invalid_signature_24h'] ?? 0) > 0) {
        $alerts[] = ['level' => 'danger', 'message' => $wh['invalid_signature_24h'] . ' webhook(s) com assinatura inválida em 24h.'];
    }

    if (credpix_utmify_enabled() && $ordersFailedUtmify >= 3) {
        $alerts[] = ['level' => 'warning', 'message' => $ordersFailedUtmify . ' pedidos com falha/envio Utmify pendente.'];
    }

    return $alerts;
}

function credpix_insights_event_lead_fields(array $ev): array
{
    if (($ev['lead_age'] ?? null) !== null || !empty($ev['lead_age_band']) || !empty($ev['lead_gender'])) {
        $age = isset($ev['lead_age']) ? (int) $ev['lead_age'] : null;
        $gender = credpix_lead_normalize_gender($ev['lead_gender'] ?? ($ev['sexo'] ?? null));
        $band = $ev['lead_age_band'] ?? credpix_lead_age_band($age);
        return [
            'lead_age' => ($age !== null && $age >= 0 && $age <= 120) ? $age : null,
            'lead_age_band' => $band,
            'lead_gender' => $gender,
            'lead_age_label' => credpix_lead_age_band_label($band),
            'lead_gender_label' => credpix_lead_gender_label($gender),
        ];
    }
    $meta = is_array($ev['meta'] ?? null) ? $ev['meta'] : [];
    $nascimento = $ev['nascimento'] ?? ($meta['nascimento'] ?? null);
    $sexo = $ev['sexo'] ?? ($meta['sexo'] ?? null);
    if (is_string($nascimento) && $nascimento !== '' || is_string($sexo) && $sexo !== '') {
        $profile = credpix_lead_profile_from_nascimento(
            is_string($nascimento) ? $nascimento : null,
            is_string($sexo) ? $sexo : null
        );
        return [
            'lead_age' => $profile['lead_age'],
            'lead_age_band' => $profile['lead_age_band'],
            'lead_gender' => $profile['lead_gender'],
            'lead_age_label' => credpix_lead_age_band_label($profile['lead_age_band']),
            'lead_gender_label' => credpix_lead_gender_label($profile['lead_gender']),
        ];
    }
    return [
        'lead_age' => null,
        'lead_age_band' => null,
        'lead_gender' => null,
        'lead_age_label' => '—',
        'lead_gender_label' => '—',
    ];
}

/** @return array{by_session: array<string, array>, by_device: array<string, array>} */
function credpix_insights_lead_profile_maps(array $events): array
{
    $bySession = [];
    $byDevice = [];
    foreach ($events as $ev) {
        $fields = credpix_insights_event_lead_fields($ev);
        if ($fields['lead_age'] === null && $fields['lead_gender'] === null) {
            continue;
        }
        foreach (['session_id', 'browser_session_id'] as $sessionKey) {
            $session = (string) ($ev[$sessionKey] ?? '');
            if ($session !== '') {
                $bySession[$session] = $fields;
            }
        }
        $device = (string) ($ev['device_hash'] ?? '');
        if ($device !== '') {
            $byDevice[$device] = $fields;
        }
    }
    return ['by_session' => $bySession, 'by_device' => $byDevice];
}

function credpix_insights_resolve_lead_profile(array $ev, array $maps): array
{
    $direct = credpix_insights_event_lead_fields($ev);
    if ($direct['lead_age'] !== null || $direct['lead_gender'] !== null) {
        return $direct;
    }
    $device = (string) ($ev['device_hash'] ?? '');
    if ($device !== '' && isset($maps['by_device'][$device])) {
        return $maps['by_device'][$device];
    }
    foreach (['browser_session_id', 'session_id'] as $sessionKey) {
        $session = (string) ($ev[$sessionKey] ?? '');
        if ($session !== '' && isset($maps['by_session'][$session])) {
            return $maps['by_session'][$session];
        }
    }
    return $direct;
}

function credpix_insights_demographics(array $events, array $orders): array
{
    $bandOrder = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'menor-18'];
    $emptyBands = [];
    foreach ($bandOrder as $band) {
        $emptyBands[$band] = 0;
    }

    $verified = 0;
    $ages = [];
    $bands = $emptyBands;
    $gender = ['M' => 0, 'F' => 0, 'O' => 0];

    foreach ($events as $ev) {
        $type = $ev['type'] ?? '';
        if ($type !== 'lead_profile' && $type !== 'pix_generated') {
            continue;
        }
        $p = credpix_insights_event_lead_fields($ev);
        if ($p['lead_age'] === null && $p['lead_gender'] === null) {
            continue;
        }
        $verified++;
        if ($p['lead_age'] !== null) {
            $ages[] = $p['lead_age'];
        }
        if (!empty($p['lead_age_band']) && isset($bands[$p['lead_age_band']])) {
            $bands[$p['lead_age_band']]++;
        }
        if (!empty($p['lead_gender']) && isset($gender[$p['lead_gender']])) {
            $gender[$p['lead_gender']]++;
        }
    }

    $paidAges = [];
    $paidBands = $emptyBands;
    $paidGender = ['M' => 0, 'F' => 0, 'O' => 0];
    $paidWithProfile = 0;
    foreach ($orders as $order) {
        if (($order['lead_age'] ?? null) === null && empty($order['lead_gender'])) {
            continue;
        }
        $paidWithProfile++;
        if ($order['lead_age'] !== null) {
            $paidAges[] = (int) $order['lead_age'];
        }
        $band = $order['lead_age_band'] ?? null;
        if ($band && isset($paidBands[$band])) {
            $paidBands[$band]++;
        }
        $g = $order['lead_gender'] ?? null;
        if ($g && isset($paidGender[$g])) {
            $paidGender[$g]++;
        }
    }

    $avg = static function (array $values): ?float {
        if (!$values) {
            return null;
        }
        return round(array_sum($values) / count($values), 1);
    };

    $bandRows = static function (array $counts) use ($bandOrder): array {
        $rows = [];
        foreach ($bandOrder as $band) {
            if (($counts[$band] ?? 0) <= 0) {
                continue;
            }
            $rows[] = [
                'band' => $band,
                'label' => credpix_lead_age_band_label($band),
                'count' => $counts[$band],
            ];
        }
        return $rows;
    };

    $genderRows = static function (array $counts): array {
        $rows = [];
        foreach (['M', 'F', 'O'] as $g) {
            if (($counts[$g] ?? 0) <= 0) {
                continue;
            }
            $rows[] = [
                'gender' => $g,
                'label' => credpix_lead_gender_label($g),
                'count' => $counts[$g],
            ];
        }
        return $rows;
    };

    return [
        'verified_leads' => $verified,
        'paid_with_profile' => $paidWithProfile,
        'payments_total' => count($orders),
        'avg_age' => $avg($ages),
        'avg_age_paid' => $avg($paidAges),
        'age_bands' => $bandRows($bands),
        'age_bands_paid' => $bandRows($paidBands),
        'gender' => $genderRows($gender),
        'gender_paid' => $genderRows($paidGender),
    ];
}

function credpix_insights_attach_geo(array $event, ?array $geo = null): array
{
    $geo = $geo ?? credpix_analytics_client_geo();
    if (!empty($geo['country']) && $geo['country'] !== 'XX') {
        $event['country'] = $geo['country'];
    }
    if (!empty($geo['city'])) {
        $event['city'] = $geo['city'];
    }
    if (!empty($geo['region'])) {
        $event['region'] = $geo['region'];
    }
    if (!empty($geo['continent'])) {
        $event['continent'] = $geo['continent'];
    }
    return $event;
}

/** Conversão PIX (gerado → pago) por hora do dia — fuso do painel. */
function credpix_insights_pix_hourly_conversion(array $events): array
{
    $hours = [];
    for ($h = 0; $h < 24; $h++) {
        $hours[$h] = [
            'hour' => $h,
            'label' => str_pad((string) $h, 2, '0', STR_PAD_LEFT) . 'h',
            'pix_generated' => 0,
            'pix_paid' => 0,
            'pix_pending' => 0,
            'conversion_rate' => 0.0,
        ];
    }

    $paidTx = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid') {
            continue;
        }
        $tx = credpix_analytics_event_tx_id($ev);
        if ($tx !== null && $tx !== '') {
            $paidTx[strtolower($tx)] = true;
        }
    }

    $tz = credpix_analytics_tz();
    $pixSeen = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'pix_generated') {
            continue;
        }
        $tx = credpix_analytics_event_tx_id($ev);
        if ($tx === null || $tx === '') {
            continue;
        }
        $txKey = strtolower($tx);
        if (isset($pixSeen[$txKey])) {
            continue;
        }
        $pixSeen[$txKey] = true;
        $ts = credpix_analytics_ts_to_seconds(isset($ev['ts']) ? (int) $ev['ts'] : null) ?? time();
        $hi = (int) (new DateTime('@' . $ts))->setTimezone($tz)->format('G');
        $hours[$hi]['pix_generated']++;
        if (isset($paidTx[$txKey])) {
            $hours[$hi]['pix_paid']++;
        }
    }

    $totGen = 0;
    $totPaid = 0;
    foreach ($hours as &$row) {
        $gen = (int) $row['pix_generated'];
        $paid = (int) $row['pix_paid'];
        $row['pix_pending'] = max(0, $gen - $paid);
        $row['conversion_rate'] = $gen > 0 ? round(($paid / $gen) * 1000) / 10 : 0.0;
        $totGen += $gen;
        $totPaid += $paid;
    }
    unset($row);

    return [
        'hours' => array_values($hours),
        'totals' => [
            'pix_generated' => $totGen,
            'pix_paid' => $totPaid,
            'pix_pending' => max(0, $totGen - $totPaid),
            'conversion_rate' => $totGen > 0 ? round(($totPaid / $totGen) * 1000) / 10 : 0.0,
        ],
    ];
}

/**
 * Compara checkout principal R$ 29,86 vs R$ 39,86 (produto principal / amount_cents).
 *
 * @return array{tiers: list<array>, winner_label: ?string, insight: string, has_data: bool}
 */
function credpix_insights_main_price_comparison(array $events): array
{
    $mainId = trim((string) (getenv('MASTERFY_MAIN_PRODUCT_ID') ?: 'prod_698630abcbdde'));
    if ($mainId === '') {
        $mainId = 'prod_698630abcbdde';
    }
    $tierCents = [2986, 3986];
    $byPrice = [];
    foreach ($tierCents as $cents) {
        $byPrice[$cents] = [
            'price_cents' => $cents,
            'label' => 'R$ ' . credpix_format_brl($cents),
            'pix_generated' => 0,
            'pix_paid' => 0,
            'pix_pending' => 0,
            'conversion_rate' => 0.0,
            'revenue_cents' => 0,
            'revenue_formatted' => 'R$ ' . credpix_format_brl(0),
            'revenue_per_pix_cents' => 0,
            'revenue_per_pix_formatted' => 'R$ ' . credpix_format_brl(0),
        ];
    }

    $isMainCheckout = static function (array $ev) use ($mainId, $tierCents): bool {
        $cents = (int) ($ev['amount_cents'] ?? 0);
        if (!in_array($cents, $tierCents, true)) {
            return false;
        }
        $pid = trim((string) ($ev['product_id'] ?? ''));
        if ($pid !== '' && $pid !== $mainId) {
            return false;
        }
        return true;
    };

    $paidTx = [];
    $paidSeen = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'payment_paid' || !$isMainCheckout($ev)) {
            continue;
        }
        $tx = credpix_analytics_event_tx_id($ev);
        if ($tx === null || $tx === '') {
            continue;
        }
        $txKey = strtolower($tx);
        if (isset($paidSeen[$txKey])) {
            continue;
        }
        $paidSeen[$txKey] = true;
        $cents = (int) ($ev['amount_cents'] ?? 0);
        $paidTx[$txKey] = $cents;
    }

    $pixSeen = [];
    foreach ($events as $ev) {
        if (($ev['type'] ?? '') !== 'pix_generated' || !$isMainCheckout($ev)) {
            continue;
        }
        $tx = credpix_analytics_event_tx_id($ev);
        if ($tx === null || $tx === '') {
            continue;
        }
        $txKey = strtolower($tx);
        if (isset($pixSeen[$txKey])) {
            continue;
        }
        $pixSeen[$txKey] = true;
        $cents = (int) ($ev['amount_cents'] ?? 0);
        if (!isset($byPrice[$cents])) {
            continue;
        }
        $byPrice[$cents]['pix_generated']++;
        if (isset($paidTx[$txKey]) && $paidTx[$txKey] === $cents) {
            $byPrice[$cents]['pix_paid']++;
            $byPrice[$cents]['revenue_cents'] += $cents;
        }
    }

    $tiers = [];
    foreach ($tierCents as $cents) {
        $row = $byPrice[$cents];
        $gen = (int) $row['pix_generated'];
        $paid = (int) $row['pix_paid'];
        $row['pix_pending'] = max(0, $gen - $paid);
        $row['conversion_rate'] = $gen > 0 ? round(($paid / $gen) * 1000) / 10 : 0.0;
        $row['revenue_formatted'] = 'R$ ' . credpix_format_brl((int) $row['revenue_cents']);
        $row['revenue_per_pix_cents'] = $gen > 0 ? (int) round(((int) $row['revenue_cents']) / $gen) : 0;
        $row['revenue_per_pix_formatted'] = 'R$ ' . credpix_format_brl($row['revenue_per_pix_cents']);
        $tiers[] = $row;
    }

    $withPix = array_values(array_filter($tiers, static fn ($t) => ((int) ($t['pix_generated'] ?? 0)) > 0));
    $winnerLabel = null;
    $insight = 'Ainda não há PIX do produto principal com R$ 29,86 ou R$ 39,86 no período.';

    if (count($withPix) === 1) {
        $only = $withPix[0];
        $winnerLabel = (string) ($only['label'] ?? '');
        $insight = sprintf(
            'Só há dados em %s: %d PIX, %d pagos (%.1f%%), receita %s.',
            $winnerLabel,
            (int) $only['pix_generated'],
            (int) $only['pix_paid'],
            (float) $only['conversion_rate'],
            (string) $only['revenue_formatted']
        );
    } elseif (count($withPix) >= 2) {
        usort($withPix, static fn ($a, $b) => ((int) ($b['revenue_cents'] ?? 0)) <=> ((int) ($a['revenue_cents'] ?? 0)));
        $bestRev = $withPix[0];
        $winnerLabel = (string) ($bestRev['label'] ?? '');
        $other = $withPix[1];
        $revDiff = (int) ($bestRev['revenue_cents'] ?? 0) - (int) ($other['revenue_cents'] ?? 0);
        $insight = sprintf(
            '%s gerou mais receita no período (%s vs %s, +%s). Conversão: %s %.1f%% · %s %.1f%%. Receita/PIX: %s vs %s.',
            $winnerLabel,
            (string) ($bestRev['revenue_formatted'] ?? ''),
            (string) ($other['revenue_formatted'] ?? ''),
            'R$ ' . credpix_format_brl(max(0, $revDiff)),
            (string) ($bestRev['label'] ?? ''),
            (float) ($bestRev['conversion_rate'] ?? 0),
            (string) ($other['label'] ?? ''),
            (float) ($other['conversion_rate'] ?? 0),
            (string) ($bestRev['revenue_per_pix_formatted'] ?? ''),
            (string) ($other['revenue_per_pix_formatted'] ?? '')
        );
        $alt = $withPix;
        usort($alt, static fn ($a, $b) => ((float) ($b['revenue_per_pix_cents'] ?? 0)) <=> ((float) ($a['revenue_per_pix_cents'] ?? 0)));
        if (($alt[0]['price_cents'] ?? 0) !== ($bestRev['price_cents'] ?? 0)
            && ((int) ($alt[0]['revenue_per_pix_cents'] ?? 0)) > (int) ($bestRev['revenue_per_pix_cents'] ?? 0)) {
            $insight .= ' Por eficiência (receita por PIX gerado), ' . ($alt[0]['label'] ?? '') . ' performa melhor.';
        }
    }

    return [
        'tiers' => $tiers,
        'winner_label' => $winnerLabel,
        'insight' => $insight,
        'has_data' => count($withPix) > 0,
    ];
}
