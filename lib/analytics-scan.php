<?php
declare(strict_types=1);

/**
 * Leitura streaming de eventos — não guarda page_view na memória (evita HTTP 500).
 *
 * @return array<string, mixed>
 */
function credpix_analytics_scan_events(
    int $days,
    ?string $srcFilter = null,
    ?string $utmCampaign = null,
    ?string $utmMedium = null,
    ?string $utmContent = null,
    ?string $productFilter = null
): array {
    $compact = [];
    $pageViewCountAll = 0;
    $pageViewCountFiltered = 0;
    $uniqueSessionsAll = [];
    $uniqueSessionsFiltered = [];

    $pageViews = [];
    $pageUniques = [];
    $transitions = [];
    $sources = [];
    $funnel = [
        'landing' => [],
        'wizard' => [],
        'checkout' => [],
        'pix_generated' => [],
        'payment_paid' => [],
        'upsell' => [],
    ];

    $landingBaseBySession = [];
    $landingBaseByDevice = [];
    $sessionGeo = [];
    $deviceGeo = [];
    $pixByTx = [];
    $availableSrcs = [];
    $utmValues = [
        'utm_campaign' => [],
        'utm_medium' => [],
        'utm_content' => [],
    ];

    $hours = [];
    for ($h = 0; $h < 24; $h++) {
        $hours[$h] = ['hour' => $h, 'label' => str_pad((string) $h, 2, '0', STR_PAD_LEFT) . 'h', 'page_views' => 0, 'payments' => 0, 'revenue_cents' => 0];
    }
    $tz = credpix_analytics_tz();

    $funnelByBase = [];
    $ensureBase = static function (?string $base) use (&$funnelByBase): string {
        $key = $base !== null && $base !== '' ? $base : '/ (sem base)';
        if (!isset($funnelByBase[$key])) {
            $funnelByBase[$key] = [
                'base_path' => $key,
                'page_views' => 0,
                'landing' => [],
                'payment_paid' => [],
                'revenue_cents' => 0,
            ];
        }
        return $key;
    };

    $upsellRows = [];
    for ($i = 1; $i <= 20; $i++) {
        $upsellRows[$i] = ['upsell' => $i, 'views' => 0, 'clicks' => 0, 'payments' => 0, 'revenue_cents' => 0];
    }
    $upsellProducts = credpix_analytics_upsell_product_map();

    $campaignsMap = [];
    $conversionSessions = [];
    $wizardStepJourneys = [];
    $paidTxSeenUtm = [];
    $paidTxSeenCampaign = [];
    $recentRing = [];
    $recentMax = 80;
    $utmBreakdown = [
        'utm_source' => [],
        'utm_medium' => [],
        'utm_campaign' => [],
        'utm_content' => [],
    ];

    $jk = static fn (array $ev): string => credpix_analytics_journey_key($ev);

    $eventInPeriod = static fn (array $ev): bool => credpix_analytics_event_in_period($ev, $days);

    $trackUtmBreakdown = static function (array $ev) use (&$utmBreakdown, &$paidTxSeenUtm, $jk): void {
        foreach (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as $dim) {
            $val = (string) ($ev[$dim] ?? '(vazio)');
            if ($val === '') {
                $val = '(vazio)';
            }
            if (!isset($utmBreakdown[$dim][$val])) {
                $utmBreakdown[$dim][$val] = ['value' => $val, 'sessions' => [], 'payments' => 0, 'revenue_cents' => 0];
            }
            $utmBreakdown[$dim][$val]['sessions'][$jk($ev)] = true;
            if (($ev['type'] ?? '') === 'payment_paid') {
                $txId = credpix_analytics_event_tx_id($ev);
                if ($txId !== '' && isset($paidTxSeenUtm[$txId])) {
                    continue;
                }
                if ($txId !== '') {
                    $paidTxSeenUtm[$txId] = true;
                }
                $utmBreakdown[$dim][$val]['payments']++;
                $utmBreakdown[$dim][$val]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
            }
        }
    };

    $srcNeedle = ($srcFilter !== null && $srcFilter !== '') ? strtolower(trim($srcFilter)) : null;

    $matchesUtm = static function (array $ev) use ($utmCampaign, $utmMedium, $utmContent): bool {
        $filters = [
            'utm_campaign' => $utmCampaign,
            'utm_medium' => $utmMedium,
            'utm_content' => $utmContent,
        ];
        foreach ($filters as $field => $value) {
            if ($value === null || $value === '') {
                continue;
            }
            if (strtolower(credpix_analytics_event_utm($ev, $field)) !== strtolower(trim($value))) {
                return false;
            }
        }
        return true;
    };

    $matchesSrc = static function (array $ev) use ($srcNeedle): bool {
        if ($srcNeedle === null) {
            return true;
        }
        return strtolower(credpix_analytics_event_src($ev)) === $srcNeedle;
    };

    $matchesProduct = static function (array $ev) use ($productFilter): bool {
        if ($productFilter === null || $productFilter === '') {
            return true;
        }
        $type = $ev['type'] ?? '';
        if ($type === 'payment_paid' || $type === 'pix_generated') {
            return ($ev['product_name'] ?? $ev['product_id'] ?? '') === $productFilter;
        }
        return true;
    };

    $matchesFiltered = static function (array $ev) use ($matchesSrc, $matchesUtm, $matchesProduct): bool {
        return $matchesSrc($ev) && $matchesUtm($ev) && $matchesProduct($ev);
    };

    $trackGeo = static function (array $ev) use (&$sessionGeo, &$deviceGeo, $jk): void {
        $geoPatch = static function (array &$bucket, array $ev): void {
            if (!empty($ev['country']) && $ev['country'] !== 'XX') {
                $bucket['country'] = $ev['country'];
            }
            if (!empty($ev['city'])) {
                $bucket['city'] = $ev['city'];
            }
            if (!empty($ev['region'])) {
                $bucket['region'] = $ev['region'];
            }
        };
        $sid = (string) ($ev['session_id'] ?? '');
        if ($sid !== '') {
            if (!isset($sessionGeo[$sid])) {
                $sessionGeo[$sid] = [];
            }
            $geoPatch($sessionGeo[$sid], $ev);
        }
        $jKey = $jk($ev);
        if ($jKey !== '' && $jKey !== 'anon') {
            if (!isset($sessionGeo[$jKey])) {
                $sessionGeo[$jKey] = [];
            }
            $geoPatch($sessionGeo[$jKey], $ev);
        }
        $browser = trim((string) ($ev['browser_session_id'] ?? ''));
        if ($browser !== '' && !preg_match('/^(pix_|webhook_)/', $browser)) {
            if (!isset($sessionGeo[$browser])) {
                $sessionGeo[$browser] = [];
            }
            $geoPatch($sessionGeo[$browser], $ev);
        }
        $device = (string) ($ev['device_hash'] ?? '');
        if ($device !== '') {
            if (!isset($deviceGeo[$device])) {
                $deviceGeo[$device] = [];
            }
            $geoPatch($deviceGeo[$device], $ev);
        }
    };

    $trackSrcList = static function (array $ev) use (&$availableSrcs): void {
        $src = credpix_analytics_event_src($ev);
        if ($src !== '') {
            $availableSrcs[$src] = ($availableSrcs[$src] ?? 0) + 1;
        }
    };

    $trackUtmValues = static function (array $ev) use (&$utmValues): void {
        foreach (['utm_campaign', 'utm_medium', 'utm_content'] as $field) {
            $val = credpix_analytics_event_utm($ev, $field);
            if ($val !== '') {
                $utmValues[$field][$val] = true;
            }
        }
    };

    $pushRecent = static function (array $ev) use (&$recentRing, $recentMax): void {
        $meta = is_array($ev['meta'] ?? null) ? $ev['meta'] : [];
        $recentRing[] = [
            'ts'           => $ev['ts'] ?? 0,
            'type'         => $ev['type'] ?? '',
            'page'         => $ev['page'] ?? null,
            'page_label'   => $ev['page_label'] ?? null,
            'funnel_step'  => $ev['funnel_step'] ?? null,
            'wizard_step'  => $meta['step'] ?? $meta['field'] ?? null,
            'product_name' => $ev['product_name'] ?? null,
            'amount_cents' => $ev['amount_cents'] ?? null,
            'traffic_src'  => $ev['traffic_src'] ?? null,
            'utm_source'   => $ev['utm_source'] ?? null,
            'country'      => $ev['country'] ?? null,
            'city'         => $ev['city'] ?? null,
            'region'       => $ev['region'] ?? null,
        ];
        if (count($recentRing) > $recentMax) {
            array_shift($recentRing);
        }
    };

    /* Chave preferencial: device_hash (persistente entre sessões) > session_id */
    $conversionKey = static function (array $ev) use ($jk): string {
        $dev = trim((string) ($ev['device_hash'] ?? ''));
        if ($dev !== '') {
            return 'd_' . $dev;
        }
        $sid = $jk($ev);
        return ($sid !== '' && $sid !== 'anon') ? $sid : '';
    };

    $trackConversion = static function (array $ev) use (&$conversionSessions, $conversionKey): void {
        $key = $conversionKey($ev);
        if ($key === '') {
            return;
        }
        if (!isset($conversionSessions[$key])) {
            $conversionSessions[$key] = ['landing' => null, 'pix' => null, 'paid' => null];
        }
        $ts   = (int) ($ev['ts'] ?? 0);
        $type = (string) ($ev['type'] ?? '');

        $applyMin = function (string $slot, int $ts) use (&$conversionSessions, $key): void {
            if ($conversionSessions[$key][$slot] === null || ($ts > 0 && $ts < $conversionSessions[$key][$slot])) {
                $conversionSessions[$key][$slot] = $ts;
            }
        };

        /* Landing: só page_view de landing conta */
        if ($type === 'page_view' && (
            ($ev['funnel_step'] ?? '') === 'landing' ||
            ($ev['page_label'] ?? '') === 'Landing' ||
            ($ev['page_label'] ?? '') === 'Início'
        )) {
            $applyMin('landing', $ts);
        }
        if ($type === 'pix_generated')  $applyMin('pix',  $ts);
        if ($type === 'payment_paid')   $applyMin('paid', $ts);
    };

    $trackCampaign = static function (array $ev) use (&$campaignsMap, &$paidTxSeenCampaign, $jk): void {
        $src = credpix_analytics_event_src($ev) ?: '(direto)';
        if (!isset($campaignsMap[$src])) {
            $campaignsMap[$src] = ['sessions' => [], 'landing' => [], 'payments' => [], 'revenue_cents' => 0];
        }
        $key = $jk($ev);
        $campaignsMap[$src]['sessions'][$key] = true;
        if (($ev['funnel_step'] ?? '') === 'landing' || ($ev['page_label'] ?? '') === 'Landing' || ($ev['page_label'] ?? '') === 'Início') {
            $campaignsMap[$src]['landing'][$key] = true;
        }
        if (($ev['type'] ?? '') === 'payment_paid') {
            $txId = credpix_analytics_event_tx_id($ev);
            if ($txId !== '' && isset($paidTxSeenCampaign[$txId])) {
                return;
            }
            if ($txId !== '') {
                $paidTxSeenCampaign[$txId] = true;
            }
            $campaignsMap[$src]['payments'][$key] = true;
            $campaignsMap[$src]['revenue_cents'] += (int) ($ev['amount_cents'] ?? 0);
        }
    };

    $trackPageView = static function (array $ev) use (
        &$pageViews,
        &$pageUniques,
        &$transitions,
        &$sources,
        &$funnel,
        &$landingBaseBySession,
        &$landingBaseByDevice,
        &$funnelByBase,
        &$upsellRows,
        &$wizardStepJourneys,
        $ensureBase,
        $trackConversion,
        $trackCampaign,
        $trackUtmBreakdown,
        $jk
    ): void {
        $label = $ev['page_label'] ?? credpix_analytics_page_label((string) ($ev['page'] ?? '/'));
        if ($label === 'Início') {
            $label = 'Landing';
        }
        $pageViews[$label] = ($pageViews[$label] ?? 0) + 1;
        $journey = $jk($ev);
        $pageUniques[$label][$journey] = true;

        if (!empty($ev['referrer'])) {
            $from = credpix_analytics_page_label((string) $ev['referrer']);
            $key = $from . ' → ' . $label;
            $transitions[$key] = ($transitions[$key] ?? 0) + 1;
        }

        $src = credpix_analytics_event_src($ev) ?: '(direto)';
        $sources[$src] = ($sources[$src] ?? 0) + 1;

        $wizardStep = credpix_analytics_wizard_step_from_page((string) ($ev['page'] ?? ''));
        if ($wizardStep === null && (($ev['funnel_step'] ?? '') === 'wizard' || $label === 'Wizard')) {
            $wizardStep = 'wizard';
        }
        if ($wizardStep !== null) {
            $wizardStepJourneys[$wizardStep][$journey] = true;
        }

        $step = $ev['funnel_step'] ?? null;
        if ($step && isset($funnel[$step])) {
            $funnel[$step][$journey] = true;
        }

        $base = $ev['base_path'] ?? null;
        $baseKey = $ensureBase($base);
        $funnelByBase[$baseKey]['page_views']++;
        if ($label === 'Landing' || ($ev['funnel_step'] ?? '') === 'landing') {
            $funnelByBase[$baseKey]['landing'][$journey] = true;
            $basePath = isset($ev['base_path']) ? trim((string) $ev['base_path']) : '';
            if ($basePath !== '') {
                if ($journey !== '' && !isset($landingBaseBySession[$journey])) {
                    $landingBaseBySession[$journey] = $basePath;
                }
                $device = (string) ($ev['device_hash'] ?? '');
                if ($device !== '' && !isset($landingBaseByDevice[$device])) {
                    $landingBaseByDevice[$device] = $basePath;
                }
            }
        }

        if (preg_match('/^Upsell (\d+)$/', (string) $label, $m)) {
            $n = (int) $m[1];
            if ($n >= 1 && $n <= 20) {
                $upsellRows[$n]['views']++;
            }
        }

        $trackConversion($ev);
        $trackCampaign($ev);
        $trackUtmBreakdown($ev);
    };

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
            if (!is_array($row) || credpix_analytics_is_noise_event_type($row['type'] ?? null)) {
                continue;
            }

            $type = (string) ($row['type'] ?? '');
            if (!$eventInPeriod($row)) {
                continue;
            }
            $trackGeo($row);
            $trackSrcList($row);
            $trackUtmValues($row);
            if (!empty($row['session_id'])) {
                $uniqueSessionsAll[(string) $row['session_id']] = true;
            }

            if ($type === 'page_view') {
                $pageViewCountAll++;
                if ($matchesFiltered($row)) {
                    $pageViewCountFiltered++;
                    $uniqueSessionsFiltered[$jk($row)] = true;
                    $trackPageView($row);
                    if ($eventInPeriod($row)) {
                        $ts = credpix_analytics_ts_to_seconds(isset($row['ts']) ? (int) $row['ts'] : null) ?? time();
                        $h = (int) (new DateTime('@' . $ts))->setTimezone($tz)->format('G');
                        $hours[$h]['page_views']++;
                    }
                    $pushRecent($row);
                }
                continue;
            }

            if ($type === 'pix_generated') {
                $txId = credpix_analytics_event_tx_id($row);
                if ($txId && !isset($pixByTx[$txId])) {
                    $pixByTx[$txId] = $row;
                    if ($matchesFiltered($row)) {
                        $funnel['pix_generated'][$jk($row)] = true;
                        $trackConversion($row);
                    }
                }
            }

            $compact[] = $row;

            if (!$matchesFiltered($row)) {
                continue;
            }

            if ($type !== 'pix_generated') {
                $uniqueSessionsFiltered[$jk($row)] = true;
            }

            $step = $row['funnel_step'] ?? null;
            if ($step && isset($funnel[$step]) && $type !== 'page_view') {
                $funnel[$step][$jk($row)] = true;
            }
            if ($type === 'payment_paid') {
                $funnel['payment_paid'][$jk($row)] = true;
                $baseKey = $ensureBase($row['base_path'] ?? null);
                $funnelByBase[$baseKey]['payment_paid'][$jk($row)] = true;
                $funnelByBase[$baseKey]['revenue_cents'] += (int) ($row['amount_cents'] ?? 0);
                if ($eventInPeriod($row)) {
                    $ts = credpix_analytics_ts_to_seconds(isset($row['ts']) ? (int) $row['ts'] : null) ?? time();
                    $h = (int) (new DateTime('@' . $ts))->setTimezone($tz)->format('G');
                    $hours[$h]['payments']++;
                    $hours[$h]['revenue_cents'] += (int) ($row['amount_cents'] ?? 0);
                }
                $pid = (string) ($row['product_id'] ?? '');
                $upN = $upsellProducts[$pid] ?? 0;
                if ($upN >= 1 && $upN <= 20) {
                    $upsellRows[$upN]['payments']++;
                    $upsellRows[$upN]['revenue_cents'] += (int) ($row['amount_cents'] ?? 0);
                }
            }
            if ($type === 'upsell_click') {
                $key = (string) ($row['meta']['upsell_key'] ?? $row['meta']['upsell'] ?? '');
                $n = (int) preg_replace('/\D/', '', $key);
                if ($n >= 1 && $n <= 20) {
                    $upsellRows[$n]['clicks']++;
                }
            }

            if ($type !== 'pix_generated') {
                $trackConversion($row);
            }
            $trackCampaign($row);
            $pushRecent($row);
            $trackUtmBreakdown($row);
        }
        fclose($handle);
    }

    arsort($availableSrcs);
    $availableSrcList = [];
    foreach ($availableSrcs as $src => $count) {
        $availableSrcList[] = ['src' => $src, 'count' => $count];
    }

    $availableUtms = [];
    foreach ($utmValues as $field => $set) {
        $vals = array_keys($set);
        sort($vals);
        $rows = [];
        foreach ($vals as $val) {
            $rows[] = ['value' => $val];
        }
        $availableUtms[$field] = $rows;
    }

    foreach ($hours as &$hourRow) {
        $hourRow['revenue_formatted'] = 'R$ ' . credpix_format_brl($hourRow['revenue_cents']);
    }
    unset($hourRow);

    $funnelByBaseOut = [];
    foreach ($funnelByBase as $row) {
        $landing = count($row['landing']);
        $paid = count($row['payment_paid']);
        if ($landing === 0 && $paid === 0 && $row['page_views'] === 0) {
            continue;
        }
        $funnelByBaseOut[] = [
            'base_path' => $row['base_path'],
            'page_views' => $row['page_views'],
            'landing' => $landing,
            'payments' => $paid,
            'revenue_cents' => $row['revenue_cents'],
            'revenue_formatted' => 'R$ ' . credpix_format_brl($row['revenue_cents']),
            'conversion_rate' => $landing > 0 ? round(($paid / $landing) * 1000) / 10 : 0,
            'conversion_label' => credpix_analytics_format_conversion_rate($paid, $landing),
        ];
    }
    usort($funnelByBaseOut, static fn ($a, $b) => $b['revenue_cents'] <=> $a['revenue_cents']);

    $upsellReport = [];
    foreach ($upsellRows as $r) {
        $upsellReport[] = [
            'upsell' => $r['upsell'],
            'views' => $r['views'],
            'clicks' => $r['clicks'],
            'payments' => $r['payments'],
            'revenue_cents' => $r['revenue_cents'],
            'take_rate' => $r['views'] > 0 ? round(($r['payments'] / $r['views']) * 1000) / 10 : 0,
            'revenue_formatted' => 'R$ ' . credpix_format_brl($r['revenue_cents']),
        ];
    }

    $campaignsBase = [];
    foreach ($campaignsMap as $src => $row) {
        if (!$matchesSrc(['traffic_src' => $src, 'utm_source' => $src])) {
            continue;
        }
        $landing = count($row['landing']);
        $paid = count($row['payments']);
        $campaignsBase[] = [
            'src' => $src,
            'sessions' => count($row['sessions']),
            'landing' => $landing,
            'payments' => $paid,
            'revenue_cents' => $row['revenue_cents'],
            'revenue_formatted' => 'R$ ' . credpix_format_brl($row['revenue_cents']),
            'conversion_rate' => $landing > 0 ? round(($paid / $landing) * 1000) / 10 : 0,
        ];
    }
    usort($campaignsBase, static fn ($a, $b) => $b['revenue_cents'] <=> $a['revenue_cents']);

    $l2p = [];
    $p2paid = [];
    $l2paid = [];
    foreach ($conversionSessions as $row) {
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
    $conversionTimes = [
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

    $utmBreakdownOut = [];
    foreach ($utmBreakdown as $dim => $map) {
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
        $utmBreakdownOut[$dim] = array_slice($rows, 0, 12);
    }

    $recent = array_reverse(array_slice($recentRing, -50));

    return [
        'compact' => $compact,
        'page_view_count_all' => $pageViewCountAll,
        'page_view_count_filtered' => $pageViewCountFiltered,
        'unique_sessions_all' => count($uniqueSessionsAll),
        'unique_sessions_filtered' => count($uniqueSessionsFiltered),
        'page_views' => $pageViews,
        'page_uniques' => $pageUniques,
        'transitions' => $transitions,
        'sources' => $sources,
        'funnel' => $funnel,
        'landing_base_maps' => ['by_session' => $landingBaseBySession, 'by_device' => $landingBaseByDevice],
        'session_geo_map' => $sessionGeo,
        'device_geo_map' => $deviceGeo,
        'pix_by_tx' => $pixByTx,
        'available_srcs' => $availableSrcList,
        'available_utms' => $availableUtms,
        'hourly_activity' => array_values($hours),
        'funnel_by_base' => $funnelByBaseOut,
        'upsell_report' => $upsellReport,
        'campaigns_base' => $campaignsBase,
        'conversion_times' => $conversionTimes,
        'utm_breakdown' => $utmBreakdownOut,
        'wizard_steps' => $wizardStepJourneys,
        'recent' => $recent,
        '_scan' => true,
    ];
}
