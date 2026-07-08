<?php
declare(strict_types=1);

function credpix_lead_parse_birthdate(?string $raw): ?DateTimeImmutable
{
    if ($raw === null || trim($raw) === '') {
        return null;
    }
    $raw = trim($raw);
    $tz = function_exists('credpix_analytics_tz') ? credpix_analytics_tz() : new DateTimeZone('America/Sao_Paulo');
    foreach (['d/m/Y', 'd-m-Y', 'Y-m-d', 'd/m/y'] as $fmt) {
        $dt = DateTimeImmutable::createFromFormat($fmt, $raw, $tz);
        if ($dt instanceof DateTimeImmutable) {
            $errors = DateTimeImmutable::getLastErrors();
            if ($errors && (($errors['warning_count'] ?? 0) > 0 || ($errors['error_count'] ?? 0) > 0)) {
                continue;
            }
            return $dt;
        }
    }
    return null;
}

function credpix_lead_calc_age(?string $nascimento, ?DateTimeInterface $ref = null): ?int
{
    $birth = credpix_lead_parse_birthdate($nascimento);
    if (!$birth) {
        return null;
    }
    $ref = $ref ? DateTimeImmutable::createFromInterface($ref) : new DateTimeImmutable('now', $birth->getTimezone());
    $age = (int) $ref->format('Y') - (int) $birth->format('Y');
    $monthDay = $ref->format('md');
    $birthMonthDay = $birth->format('md');
    if ($monthDay < $birthMonthDay) {
        $age--;
    }
    return $age >= 0 && $age <= 120 ? $age : null;
}

function credpix_lead_age_band(?int $age): ?string
{
    if ($age === null) {
        return null;
    }
    if ($age < 18) {
        return 'menor-18';
    }
    if ($age <= 24) {
        return '18-24';
    }
    if ($age <= 34) {
        return '25-34';
    }
    if ($age <= 44) {
        return '35-44';
    }
    if ($age <= 54) {
        return '45-54';
    }
    if ($age <= 64) {
        return '55-64';
    }
    return '65+';
}

function credpix_lead_age_band_label(?string $band): string
{
    $labels = [
        'menor-18' => 'Menor de 18',
        '18-24' => '18–24',
        '25-34' => '25–34',
        '35-44' => '35–44',
        '45-54' => '45–54',
        '55-64' => '55–64',
        '65+' => '65+',
    ];
    return $labels[$band ?? ''] ?? '—';
}

function credpix_lead_normalize_gender(?string $sexo): ?string
{
    if ($sexo === null || trim($sexo) === '') {
        return null;
    }
    $s = strtoupper(trim($sexo));
    if (in_array($s, ['M', 'MASC', 'MASCULINO', 'MALE'], true)) {
        return 'M';
    }
    if (in_array($s, ['F', 'FEM', 'FEMININO', 'FEMALE'], true)) {
        return 'F';
    }
    return 'O';
}

function credpix_lead_gender_label(?string $gender): string
{
    if ($gender === 'M') {
        return 'Masculino';
    }
    if ($gender === 'F') {
        return 'Feminino';
    }
    if ($gender === 'O') {
        return 'Outro';
    }
    return '—';
}

function credpix_lead_birth_year(?string $nascimento): ?int
{
    $birth = credpix_lead_parse_birthdate($nascimento);
    return $birth ? (int) $birth->format('Y') : null;
}

/** @return array{lead_age: ?int, lead_age_band: ?string, lead_gender: ?string, lead_birth_year: ?int} */
function credpix_lead_profile_from_nascimento(?string $nascimento, ?string $sexo = null): array
{
    $age = credpix_lead_calc_age($nascimento);
    return [
        'lead_age' => $age,
        'lead_age_band' => credpix_lead_age_band($age),
        'lead_gender' => credpix_lead_normalize_gender($sexo),
        'lead_birth_year' => credpix_lead_birth_year($nascimento),
    ];
}

/** @return array{lead_age: ?int, lead_age_band: ?string, lead_gender: ?string, lead_birth_year: ?int} */
function credpix_lead_profile_from_event(array $input): array
{
    $meta = is_array($input['meta'] ?? null) ? $input['meta'] : [];
    $nascimento = $input['nascimento'] ?? ($meta['nascimento'] ?? null);
    $sexo = $input['sexo'] ?? ($meta['sexo'] ?? null);
    if (isset($input['lead_age']) || isset($input['lead_age_band']) || isset($input['lead_gender'])) {
        $age = isset($input['lead_age']) ? (int) $input['lead_age'] : null;
        if ($age !== null && ($age < 0 || $age > 120)) {
            $age = null;
        }
        if ($age === null && is_string($nascimento) && $nascimento !== '') {
            $age = credpix_lead_calc_age($nascimento);
        }
        $genderRaw = $input['lead_gender'] ?? $sexo ?? null;
        return [
            'lead_age' => $age,
            'lead_age_band' => isset($input['lead_age_band'])
                ? substr((string) $input['lead_age_band'], 0, 16)
                : credpix_lead_age_band($age),
            'lead_gender' => credpix_lead_normalize_gender(is_string($genderRaw) ? $genderRaw : null),
            'lead_birth_year' => isset($input['lead_birth_year'])
                ? (int) $input['lead_birth_year']
                : credpix_lead_birth_year(is_string($nascimento) ? $nascimento : null),
        ];
    }
    return credpix_lead_profile_from_nascimento(
        is_string($nascimento) ? $nascimento : null,
        is_string($sexo) ? $sexo : null
    );
}

/** Nascimento/sexo para TX e eventos (sem CPF). */
function credpix_lead_meta_fields(array $input): array
{
    $out = [];
    $nasc = $input['nascimento'] ?? null;
    if (is_string($nasc) && trim($nasc) !== '') {
        $out['nascimento'] = substr(trim($nasc), 0, 16);
    }
    $sexo = $input['sexo'] ?? null;
    if (is_string($sexo) && trim($sexo) !== '') {
        $out['sexo'] = substr(trim($sexo), 0, 8);
    }
    return $out;
}

function credpix_lead_sanitize_event_fields(array $profile): array
{
    $out = [];
    if ($profile['lead_age'] !== null) {
        $out['lead_age'] = (int) $profile['lead_age'];
    }
    if (!empty($profile['lead_age_band'])) {
        $out['lead_age_band'] = substr((string) $profile['lead_age_band'], 0, 16);
    }
    if (!empty($profile['lead_gender'])) {
        $out['lead_gender'] = substr((string) $profile['lead_gender'], 0, 1);
    }
    if (!empty($profile['lead_birth_year'])) {
        $out['lead_birth_year'] = (int) $profile['lead_birth_year'];
    }
    return $out;
}

function credpix_lead_profile_cache_dir(): string
{
    $dir = credpix_root() . '/data/lead-profile';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function credpix_lead_profile_cache_path(string $cpfDigits): string
{
    return credpix_lead_profile_cache_dir() . '/' . hash('sha256', $cpfDigits) . '.json';
}

/** @return array<string, mixed>|null */
function credpix_lead_profile_cache_get(string $cpfDigits): ?array
{
    $path = credpix_lead_profile_cache_path($cpfDigits);
    if (!is_file($path)) {
        return null;
    }
    $row = json_decode((string) file_get_contents($path), true);
    return is_array($row) ? $row : null;
}

/** @param array<string, mixed> $fields */
function credpix_lead_profile_cache_set(string $cpfDigits, array $fields): void
{
    $fields['fetched_at'] = time();
    file_put_contents(
        credpix_lead_profile_cache_path($cpfDigits),
        json_encode($fields, JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
}

function credpix_tx_payer_document(?array $tx): ?string
{
    if (!is_array($tx)) {
        return null;
    }
    $doc = $tx['payer']['document'] ?? $tx['document'] ?? null;
    $digits = preg_replace('/\D/', '', (string) $doc) ?: '';
    return strlen($digits) === 11 ? $digits : null;
}

/**
 * Perfil demográfico a partir do CPF (cache local + API Elaiflow).
 *
 * @return array<string, mixed>|null
 */
function credpix_lead_profile_lookup_by_cpf(string $cpf, bool $allowFetch = true): ?array
{
    $digits = preg_replace('/\D/', '', $cpf) ?: '';
    if (strlen($digits) !== 11) {
        return null;
    }

    $cached = credpix_lead_profile_cache_get($digits);
    if (is_array($cached) && (!empty($cached['lead_age']) || !empty($cached['lead_gender']) || !empty($cached['nascimento']))) {
        return $cached;
    }

    if (!$allowFetch) {
        return null;
    }

    require_once __DIR__ . '/consultar-cpf.php';
    if (!credpix_cpf_service_configured()) {
        return null;
    }

    $result = credpix_consultar_cpf($digits);
    if (empty($result['ok']) || empty($result['data'])) {
        return null;
    }

    $nasc = (string) ($result['data']['nascimento'] ?? '');
    $sexo = (string) ($result['data']['sexo'] ?? '');
    $profile = credpix_lead_profile_from_nascimento($nasc, $sexo);
    $out = array_merge(
        credpix_lead_meta_fields(['nascimento' => $nasc, 'sexo' => $sexo]),
        credpix_lead_sanitize_event_fields($profile)
    );
    credpix_lead_profile_cache_set($digits, $out);
    return $out;
}

/** @param array<string, mixed> $fields */
function credpix_lead_apply_profile_fields(array $target, array $fields): array
{
    foreach (['nascimento', 'sexo', 'lead_age', 'lead_age_band', 'lead_gender'] as $key) {
        if (($target[$key] ?? null) === null && isset($fields[$key]) && $fields[$key] !== null && $fields[$key] !== '') {
            $target[$key] = $fields[$key];
        }
    }
    return $target;
}
