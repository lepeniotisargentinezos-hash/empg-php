<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/analytics.php';
credpix_load_env();

/* Auth */
$token    = $_SERVER['HTTP_X_ANALYTICS_TOKEN'] ?? '';
$expected = (string)(getenv('ANALYTICS_SECRET') ?: '');
if ($token === '' || !hash_equals($expected, $token)) {
    credpix_json(401, ['ok' => false, 'error' => 'Unauthorized']);
}

/* Lê os últimos N eventos diretamente dos arquivos JSONL — sem cache */
$limit  = max(1, min(50, (int)($_GET['limit'] ?? 20)));
$days   = max(1, min(7,  (int)($_GET['days']  ?? 1)));
$events = [];

foreach (array_reverse(credpix_analytics_list_event_files($days)) as $file) {
    $lines = @file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!$lines) continue;
    foreach (array_reverse($lines) as $line) {
        $ev = json_decode($line, true);
        if (!is_array($ev)) continue;
        $type = $ev['type'] ?? '';
        if (!in_array($type, ['payment_paid', 'pix_generated'], true)) continue;
        $meta = is_array($ev['meta'] ?? null) ? $ev['meta'] : [];
        $events[] = [
            'type'          => $type,
            'ts'            => $ev['ts']            ?? null,
            'product_name'  => $ev['product_name']  ?? null,
            'product_id'    => $ev['product_id']    ?? null,
            'amount_cents'  => $ev['amount_cents']  ?? null,
            'traffic_src'   => $ev['traffic_src']   ?? null,
            'session_id'    => $ev['session_id']    ?? null,
            'country'       => $ev['country']       ?? null,
            'city'          => $ev['city']          ?? null,
            'region'        => $ev['region']        ?? null,
            /* Dados do cliente vindos do meta */
            'phone'         => $meta['phone']         ?? null,
            'pix_key'       => $meta['pix_key']       ?? null,
            'pix_key_type'  => $meta['pix_key_type']  ?? null,
            'valor_emprestimo' => $meta['valor_emprestimo'] ?? null,
            'num_parcelas'  => $meta['num_parcelas']  ?? null,
            'renda_mensal'  => $meta['renda_mensal']  ?? null,
            'tipo_renda'    => $meta['tipo_renda']    ?? null,
            'dia_pagamento' => $meta['dia_pagamento'] ?? null,
            'metodo_pagamento' => $meta['metodo_pagamento'] ?? null,
            /* Demografia */
            'lead_age'      => $ev['lead_age']      ?? null,
            'lead_gender'   => $ev['lead_gender']   ?? null,
            'transaction_id'=> $meta['transaction_id'] ?? null,
        ];
        if (count($events) >= $limit) break 2;
    }
}

credpix_json(200, ['ok' => true, 'events' => $events, 'count' => count($events)]);
