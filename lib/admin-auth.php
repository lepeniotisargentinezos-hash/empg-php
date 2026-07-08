<?php

declare(strict_types=1);



require_once __DIR__ . '/bootstrap.php';

require_once __DIR__ . '/security.php';



function credpix_admin_secret(): string

{

    return getenv('ANALYTICS_SECRET') ?: (getenv('ADMIN_SECRET') ?: '');

}



function credpix_allow_open_admin(): bool

{

    if (getenv('CREDPIX_ALLOW_OPEN_ADMIN') !== '1') {

        return false;

    }

    return !credpix_is_production();

}



function credpix_admin_verify(?string $header, ?string $query): bool

{

    $secret = credpix_admin_secret();

    if ($secret === '') {

        return credpix_allow_open_admin();

    }

    $token = trim((string) ($header ?: ''));

    if ($token === '' && !credpix_is_production()) {

        $token = trim((string) ($query ?: ''));

    }

    return $token !== '' && hash_equals($secret, $token);

}



function credpix_ingest_secret(): string

{

    $ingest = getenv('ANALYTICS_INGEST_KEY') ?: '';

    return $ingest !== '' ? $ingest : credpix_admin_secret();

}



function credpix_ingest_verify(?string $header): bool

{

    if (credpix_allow_open_admin()) {

        return true;

    }

    $secret = credpix_ingest_secret();

    if ($secret === '') {

        return false;

    }

    $token = trim((string) ($header ?: ''));

    return $token !== '' && hash_equals($secret, $token);

}


