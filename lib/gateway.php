<?php
declare(strict_types=1);

function credpix_active_gateway(): string
{
    $gw = strtolower(trim((string) (getenv('PAYMENT_GATEWAY') ?: 'masterfy')));
    return in_array($gw, ['masterfy', 'anubis', 'novus'], true) ? $gw : 'masterfy';
}

function credpix_gateway_configured(): bool
{
    $gw = credpix_active_gateway();
    if ($gw === 'anubis') {
        return credpix_anubis_configured();
    }
    if ($gw === 'novus') {
        return credpix_novus_configured();
    }
    return credpix_masterfy_configured();
}

function credpix_gateway_create_pix(string $productId, array $payer, ?string $deviceHash = null, array $context = []): array
{
    $gw = credpix_active_gateway();
    if ($gw === 'anubis') {
        return credpix_create_anubis_pix_payment($productId, $payer, $deviceHash, $context);
    }
    if ($gw === 'novus') {
        return credpix_novus_create_pix_payment($productId, $payer, $deviceHash, $context);
    }
    return credpix_create_pix_payment($productId, $payer, $deviceHash, $context);
}

function credpix_gateway_get_payment(string $paymentId, array $tx = []): array
{
    $gw = $tx['gateway'] ?? credpix_active_gateway();
    if ($gw === 'anubis') {
        return credpix_anubis_get_payment($paymentId);
    }
    if ($gw === 'novus') {
        return credpix_novus_get_payment($paymentId);
    }
    return credpix_get_payment($paymentId);
}

function credpix_gateway_map_status(string $rawStatus, array $tx = []): string
{
    $gw = $tx['gateway'] ?? credpix_active_gateway();
    if ($gw === 'anubis') {
        return credpix_anubis_map_status($rawStatus);
    }
    if ($gw === 'novus') {
        return credpix_novus_map_status($rawStatus);
    }
    return credpix_map_status($rawStatus);
}

function credpix_gateway_payment_id_from_tx(array $tx): string
{
    $gw = $tx['gateway'] ?? 'masterfy';
    if ($gw === 'anubis') {
        return (string) ($tx['anubis_id'] ?? '');
    }
    if ($gw === 'novus') {
        return (string) ($tx['novus_id'] ?? '');
    }
    return (string) ($tx['masterfy_id'] ?? '');
}
