<?php
declare(strict_types=1);

/**
 * Código Amung (waust.at) por etapa — lê .env com fallback do deploy antigo.
 */
function credpix_amung_code(string $slot): string
{
    credpix_load_env();
    $envKey = match ($slot) {
        'funil', 'funnel' => 'AMUNG_FUNIL',
        'checkout' => 'AMUNG_CHECKOUT',
        'upsell' => 'AMUNG_UPSELL',
        default => '',
    };
    $fallback = match ($slot) {
        'funil', 'funnel' => '',
        'checkout' => '',
        'upsell' => '',
        default => '',
    };
    if ($envKey === '') {
        return $fallback;
    }
    $v = trim((string) (getenv($envKey) ?: ''));
    return $v !== '' ? $v : $fallback;
}
