<?php
declare(strict_types=1);

function credpix_google_pixels_defaults(): array
{
    return [
        'googleAds' => [
            ['id' => 'AW-18039024616', 'label' => 'hKx2CIeUgI8cEOjX1plD', 'description' => '1315'],
            ['id' => 'AW-830291866', 'label' => 'FlGnCIW26bUcEJr_9IsD', 'description' => 'Gustavo'],
        ],
        'ga4' => [],
    ];
}

function credpix_google_pixels_config_path(): string
{
    return credpix_root() . '/config/google-pixels.json';
}

function credpix_normalize_aw_id(string $raw): string
{
    $s = trim($raw);
    if ($s === '') {
        return '';
    }
    if (strpos($s, '/') !== false) {
        $id = explode('/', $s, 2)[0];
        return (strpos($id, 'AW-') === 0) ? $id : 'AW-' . preg_replace('/^AW-?/i', '', $id);
    }
    return (strpos($s, 'AW-') === 0) ? $s : 'AW-' . preg_replace('/\D/', '', $s);
}

function credpix_normalize_label(string $raw): string
{
    $s = trim($raw);
    if ($s === '') {
        return '';
    }
    if (strpos($s, '/') !== false) {
        $parts = explode('/', $s);
        return end($parts) ?: '';
    }
    return $s;
}

function credpix_normalize_ga4(string $raw): string
{
    $s = strtoupper(trim($raw));
    if ($s === '') {
        return '';
    }
    return (strpos($s, 'G-') === 0) ? $s : 'G-' . preg_replace('/^G-?/i', '', $s);
}

function credpix_normalize_google_pixels(array $raw): array
{
    $ads = [];
    foreach ($raw['googleAds'] ?? [] as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = credpix_normalize_aw_id((string) ($row['id'] ?? ''));
        $label = credpix_normalize_label((string) ($row['label'] ?? ''));
        if ($id !== '' && $label !== '') {
            $entry = ['id' => $id, 'label' => $label];
            $desc = trim((string) ($row['description'] ?? ''));
            if ($desc !== '') {
                $entry['description'] = substr($desc, 0, 80);
            }
            $ads[] = $entry;
        }
    }

    $ga4 = [];
    foreach ($raw['ga4'] ?? [] as $item) {
        $id = credpix_normalize_ga4(is_string($item) ? $item : (string) ($item['id'] ?? ''));
        if ($id !== '') {
            $ga4[$id] = true;
        }
    }

    return [
        'googleAds' => $ads,
        'ga4' => array_keys($ga4),
    ];
}

function credpix_google_pixels_merge_ads(array $defaults, array $saved): array
{
    $map = [];
    $add = static function (array $row) use (&$map): void {
        if (empty($row['id']) || empty($row['label'])) {
            return;
        }
        $k = $row['id'] . '/' . $row['label'];
        $prev = $map[$k] ?? null;
        $entry = ['id' => $row['id'], 'label' => $row['label']];
        $desc = trim((string) ($row['description'] ?? ($prev['description'] ?? '')));
        if ($desc !== '') {
            $entry['description'] = substr($desc, 0, 80);
        }
        $map[$k] = $entry;
    };
    foreach ($defaults as $row) {
        $add($row);
    }
    foreach ($saved as $row) {
        $add($row);
    }
    return array_values($map);
}

function credpix_google_pixels_read(): array
{
    $defaults = credpix_google_pixels_defaults();
    $path = credpix_google_pixels_config_path();

    if (!is_file($path)) {
        return [
            'googleAds' => $defaults['googleAds'],
            'ga4' => $defaults['ga4'],
            'savedAt' => null,
            'fromDefaults' => true,
        ];
    }

    try {
        $data = json_decode((string) file_get_contents($path), true);
        if (!is_array($data)) {
            throw new RuntimeException('invalid json');
        }
        $cfg = credpix_normalize_google_pixels($data);
        return [
            'googleAds' => $cfg['googleAds'],
            'ga4' => $cfg['ga4'],
            'savedAt' => $data['savedAt'] ?? null,
            'fromDefaults' => false,
        ];
    } catch (Throwable $e) {
        return [
            'googleAds' => $defaults['googleAds'],
            'ga4' => $defaults['ga4'],
            'savedAt' => null,
            'fromDefaults' => true,
        ];
    }
}

function credpix_google_pixels_write(array $config): array
{
    $dir = credpix_root() . '/config';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $normalized = credpix_normalize_google_pixels($config);
    $payload = [
        'googleAds' => $normalized['googleAds'],
        'ga4' => $normalized['ga4'],
        'savedAt' => gmdate('c'),
    ];
    $path = credpix_google_pixels_config_path();
    file_put_contents($path, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
    return $payload;
}

function credpix_google_pixels_send_to_list(array $config): array
{
    $out = [];
    foreach ($config['googleAds'] ?? [] as $row) {
        if (!empty($row['id']) && !empty($row['label'])) {
            $out[] = $row['id'] . '/' . $row['label'];
        }
    }
    return $out;
}
