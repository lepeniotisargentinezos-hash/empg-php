<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function credpix_ip_geo_cache_dir(): string
{
    $dir = credpix_root() . '/data/ip-geo';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function credpix_ip_geo_cache_path(string $ip): string
{
    return credpix_ip_geo_cache_dir() . '/' . hash('sha256', $ip) . '.json';
}

/** @return array<string, mixed>|null */
function credpix_ip_geo_cache_get(string $ip): ?array
{
    $path = credpix_ip_geo_cache_path($ip);
    if (!is_file($path)) {
        return null;
    }
    $row = json_decode((string) file_get_contents($path), true);
    if (!is_array($row)) {
        return null;
    }
    $ttl = (int) (getenv('IP_GEO_CACHE_TTL') ?: 604800);
    $fetched = (int) ($row['fetched_at'] ?? 0);
    if ($fetched > 0 && (time() - $fetched) > $ttl) {
        return null;
    }
    return $row;
}

/** @param array<string, mixed> $data */
function credpix_ip_geo_cache_set(string $ip, array $data): void
{
    $data['fetched_at'] = time();
    $data['ip'] = $ip;
    file_put_contents(
        credpix_ip_geo_cache_path($ip),
        json_encode($data, JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
}

function credpix_ip_geo_lookup(?string $ip, bool $allowFetch = true): array
{
    $ip = trim((string) $ip);
    if ($ip === '' || !filter_var($ip, FILTER_VALIDATE_IP)) {
        return [];
    }

    $cached = credpix_ip_geo_cache_get($ip);
    if ($cached !== null) {
        return $cached;
    }
    if (!$allowFetch || (getenv('IP_GEO_ENABLED') ?: '1') === '0') {
        return [];
    }

    $url = 'http://ip-api.com/json/' . rawurlencode($ip) . '?fields=status,message,country,countryCode,region,regionName,city&lang=pt-BR';
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 8,
            'header' => "Accept: application/json\r\nUser-Agent: credpix-ip-geo/1.0\r\n",
        ],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data) || ($data['status'] ?? '') !== 'success') {
        return [];
    }

    $country = strtoupper(substr((string) ($data['countryCode'] ?? ''), 0, 2));
    if ($country === '' || $country === 'XX') {
        return [];
    }

    $region = trim((string) ($data['region'] ?? ''));
    $city = trim((string) ($data['city'] ?? ''));
    $out = [
        'country' => $country,
        'region' => $region !== '' ? $region : null,
        'region_name' => trim((string) ($data['regionName'] ?? '')) ?: null,
        'city' => $city !== '' ? $city : null,
        'source' => 'ip-api',
    ];
    credpix_ip_geo_cache_set($ip, $out);
    return $out;
}

/** @param array<string, mixed> $geo */
function credpix_ip_geo_to_tx_fields(array $geo): array
{
    $out = [];
    if (!empty($geo['country']) && $geo['country'] !== 'XX') {
        $out['country'] = $geo['country'];
    }
    if (!empty($geo['city'])) {
        $out['city'] = substr((string) $geo['city'], 0, 64);
    }
    if (!empty($geo['region'])) {
        $out['region'] = substr((string) $geo['region'], 0, 16);
    }
    if (!empty($geo['source'])) {
        $out['geo_source'] = (string) $geo['source'];
    }
    return $out;
}
