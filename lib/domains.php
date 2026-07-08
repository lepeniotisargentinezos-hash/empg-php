<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function credpix_request_host(): string
{
    $host = (string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? '');
    $host = explode(',', $host)[0];
    $host = trim($host);
    if (strpos($host, ':') !== false) {
        $host = explode(':', $host)[0];
    }
    return strtolower($host);
}

function credpix_site_info_defaults(): array
{
    return [
        'razaoSocial' => 'C E A AUGUSTO DESENVOLVIMENTO DE SISTEMAS LTDA',
        'cnpj' => '48.280.494/0001-31',
        'telefone' => '(41) 99880-0068',
        'endereco' => 'Rua 26 Carmelo Cali, 89 - Vila Santa Lucia - São Paulo/SP • CEP 04940-070',
        'email' => 'contato@credpix.com.br',
        'marca' => 'CredPix',
    ];
}

function credpix_domains_config_path(): string
{
    return credpix_root() . '/config/domains.json';
}

function credpix_normalize_site_info(array $raw): array
{
    $defaults = credpix_site_info_defaults();
    $out = [];
    foreach ($defaults as $key => $fallback) {
        $val = trim((string) ($raw[$key] ?? $fallback));
        $out[$key] = $val !== '' ? $val : $fallback;
    }
    return $out;
}

function credpix_normalize_domain_key(string $host): string
{
    $host = strtolower(trim($host));
    if (strpos($host, ':') !== false) {
        $host = explode(':', $host)[0];
    }
    if (strpos($host, 'www.') === 0) {
        $host = substr($host, 4);
    }
    return $host;
}

function credpix_domains_read(): array
{
    $defaults = credpix_site_info_defaults();
    $path = credpix_domains_config_path();

    if (!is_file($path)) {
        return [
            'default' => $defaults,
            'domains' => [],
            'savedAt' => null,
        ];
    }

    try {
        $data = json_decode((string) file_get_contents($path), true);
        if (!is_array($data)) {
            throw new RuntimeException('invalid json');
        }

        $default = credpix_normalize_site_info(is_array($data['default'] ?? null) ? $data['default'] : []);
        $domains = [];
        foreach ((array) ($data['domains'] ?? []) as $host => $row) {
            if (!is_string($host) || !is_array($row)) {
                continue;
            }
            $key = credpix_normalize_domain_key($host);
            if ($key === '') {
                continue;
            }
            $domains[$key] = credpix_normalize_site_info($row);
        }

        return [
            'default' => $default,
            'domains' => $domains,
            'savedAt' => $data['savedAt'] ?? null,
        ];
    } catch (Throwable $e) {
        return [
            'default' => $defaults,
            'domains' => [],
            'savedAt' => null,
        ];
    }
}

function credpix_domains_write(array $config): array
{
    $dir = credpix_root() . '/config';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    $default = credpix_normalize_site_info(is_array($config['default'] ?? null) ? $config['default'] : []);
    $domains = [];
    foreach ((array) ($config['domains'] ?? []) as $host => $row) {
        if (!is_string($host) || !is_array($row)) {
            continue;
        }
        $key = credpix_normalize_domain_key($host);
        if ($key === '') {
            continue;
        }
        $domains[$key] = credpix_normalize_site_info($row);
    }

    $payload = [
        'default' => $default,
        'domains' => $domains,
        'savedAt' => gmdate('c'),
    ];

    file_put_contents(
        credpix_domains_config_path(),
        json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n"
    );

    return $payload;
}

function credpix_site_info_for_host(?string $host = null): array
{
    $host = credpix_normalize_domain_key($host ?? credpix_request_host());
    $cfg = credpix_domains_read();
    $base = $cfg['default'];

    if ($host !== '' && isset($cfg['domains'][$host])) {
        return credpix_normalize_site_info(array_merge($base, $cfg['domains'][$host]));
    }

    return $base;
}

function credpix_registered_domain_hosts(): array
{
    $cfg = credpix_domains_read();
    return array_keys($cfg['domains']);
}
