<?php
declare(strict_types=1);

/**
 * Geolocalização via headers Cloudflare (CF-IPCountry, CF-IPContinent, etc.).
 * @see https://developers.cloudflare.com/fundamentals/reference/http-request-headers/
 */
function credpix_request_headers(): array
{
    $out = [];

    if (function_exists('getallheaders')) {
        $raw = getallheaders();
        if (is_array($raw)) {
            foreach ($raw as $key => $value) {
                $out[strtolower((string) $key)] = (string) $value;
            }
        }
    }

    foreach ($_SERVER as $key => $value) {
        if (!is_string($key) || !is_scalar($value)) {
            continue;
        }
        if (strpos($key, 'HTTP_') === 0) {
            $name = strtolower(str_replace('_', '-', substr($key, 5)));
            if (!isset($out[$name])) {
                $out[$name] = (string) $value;
            }
            continue;
        }
        if (strpos($key, 'REDIRECT_HTTP_') === 0) {
            $name = strtolower(str_replace('_', '-', substr($key, 14)));
            if (!isset($out[$name])) {
                $out[$name] = (string) $value;
            }
        }
    }

    return $out;
}

function credpix_header_pick(array $headers, array $names): string
{
    foreach ($names as $name) {
        $key = strtolower(str_replace('_', '-', $name));
        if (!empty($headers[$key])) {
            return trim((string) $headers[$key]);
        }
    }
    return '';
}

function credpix_cloudflare_geo(?array $headers = null): array
{
    $headers = $headers ?? credpix_request_headers();

    $countryRaw = credpix_header_pick($headers, [
        'cf-ipcountry',
        'CF-IPCountry',
        'x-country-code',
        'geoip-country-code',
    ]);
    $country = strtoupper(substr($countryRaw, 0, 2));
    if ($country === '' || $country === 'XX' || $country === 'T1') {
        $country = 'XX';
    }

    $continentRaw = credpix_header_pick($headers, ['cf-ipcontinent', 'CF-IPContinent']);
    $continent = strtoupper(substr($continentRaw, 0, 2));
    if ($continent === '') {
        $continent = null;
    }

    $city = credpix_header_pick($headers, ['cf-ipcity', 'CF-IPCity']);
    $region = credpix_header_pick($headers, ['cf-region-code', 'cf-region', 'CF-Region']);
    $ray = credpix_header_pick($headers, ['cf-ray', 'CF-RAY']);
    $ip = credpix_header_pick($headers, ['cf-connecting-ip', 'CF-Connecting-IP', 'true-client-ip']);

    return [
        'country' => $country,
        'continent' => $continent,
        'city' => $city !== '' ? $city : null,
        'region' => $region !== '' ? $region : null,
        'ip' => $ip !== '' ? $ip : null,
        'cf_ray' => $ray !== '' ? $ray : null,
        'source' => $country !== 'XX' ? 'cloudflare' : 'unknown',
        'header' => 'CF-IPCountry',
    ];
}

function credpix_analytics_client_country(): string
{
    return credpix_cloudflare_geo()['country'];
}

function credpix_analytics_client_geo(): array
{
    $cf = credpix_cloudflare_geo();
    $needsIp = ($cf['country'] === 'XX') || empty($cf['city']) || empty($cf['region']);
    if (!$needsIp) {
        return $cf;
    }

    require_once __DIR__ . '/utmify.php';
    require_once __DIR__ . '/ip-geo.php';

    $ip = !empty($cf['ip']) ? (string) $cf['ip'] : (credpix_utmify_client_ip() ?? '');
    if ($ip === '') {
        return $cf;
    }

    $ipGeo = credpix_ip_geo_lookup($ip);
    if ($ipGeo === []) {
        return array_merge($cf, ['ip' => $ip]);
    }

    return [
        'country' => $cf['country'] !== 'XX' ? $cf['country'] : ($ipGeo['country'] ?? 'XX'),
        'continent' => $cf['continent'],
        'city' => $cf['city'] ?: ($ipGeo['city'] ?? null),
        'region' => $cf['region'] ?: ($ipGeo['region'] ?? null),
        'ip' => $ip,
        'cf_ray' => $cf['cf_ray'],
        'source' => $cf['country'] !== 'XX'
            ? (($cf['city'] || $cf['region']) ? 'cloudflare' : 'cloudflare+ip-api')
            : 'ip-api',
        'header' => $cf['country'] !== 'XX' ? 'CF-IPCountry' : 'IP',
    ];
}
