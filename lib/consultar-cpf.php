<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

const CREDPIX_CPF_BRASIL_API_HOST = 'https://apiconsultasbrasil.com/api';
const CREDPIX_CPF_API_BASE = 'https://bk.elaiflow.dev';

function credpix_cpf_brasil_key(): string
{
    credpix_load_env();
    return trim((string) (getenv('CPF_BRASIL_API_KEY') ?: ''));
}

function credpix_cpf_brasil_configured(): bool
{
    return credpix_cpf_brasil_key() !== '';
}

function credpix_cpf_token(): string
{
    credpix_load_env();
    return trim((string) (getenv('CPF_API_TOKEN') ?: ''));
}

function credpix_cpf_configured(): bool
{
    $token = credpix_cpf_token();
    return $token !== '' && $token !== 'SEU_TOKEN_AQUI' && $token !== 'SEU_TOKEN_ELAIFLOW';
}

function credpix_cpf_service_configured(): bool
{
    return credpix_cpf_brasil_configured() || credpix_cpf_configured();
}

function credpix_format_cpf(string $digits): string
{
    return preg_replace('/(\d{3})(\d{3})(\d{3})(\d{2})/', '$1.$2.$3-$4', $digits) ?: $digits;
}

function credpix_normalize_nascimento(string $raw): string
{
    $raw = trim($raw);
    if ($raw === '') {
        return '';
    }
    if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $raw, $m)) {
        return $m[1];
    }
    return $raw;
}

/**
 * @param array<string, mixed> $data
 * @return array{ok: bool, reason?: string, message?: string, data?: array<string, mixed>}|null
 */
function credpix_map_brasil_cpf_response(array $data, string $digits): ?array
{
    $nome = trim((string) ($data['NOME'] ?? $data['nome'] ?? ''));
    $nascRaw = trim((string) ($data['NASC'] ?? $data['nascimento'] ?? $data['NASCIMENTO'] ?? ''));
    $nascimento = credpix_normalize_nascimento($nascRaw);

    if ($nome === '' || $nascimento === '') {
        return null;
    }

    return [
        'ok' => true,
        'data' => [
            'cpf' => $digits,
            'nome' => $nome,
            'mae' => trim((string) ($data['NOME_MAE'] ?? $data['mae'] ?? '')),
            'sexo' => trim((string) ($data['SEXO'] ?? $data['sexo'] ?? '')),
            'nascimento' => $nascimento,
        ],
    ];
}

/**
 * @return array{ok: bool, reason?: string, message?: string, data?: array<string, mixed>}
 */
function credpix_http_get_json(string $url, string $userAgent = 'credpix-consulta-cpf/1.0'): array
{
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 25,
            'header' => "Accept: application/json\r\nUser-Agent: {$userAgent}\r\n",
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        return ['ok' => false, 'reason' => 'network', 'message' => 'Falha de conexão. Tente novamente.'];
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return ['ok' => false, 'reason' => 'json_parse', 'message' => 'Resposta inválida da consulta de CPF.'];
    }

    return ['ok' => true, 'payload' => $data];
}

/**
 * API principal: apiconsultasbrasil.com
 *
 * @return array{ok: bool, reason?: string, message?: string, data?: array<string, mixed>}
 */
function credpix_consultar_cpf_brasil(string $cpf): array
{
    $digits = preg_replace('/\D/', '', $cpf) ?: '';
    if (strlen($digits) !== 11) {
        return ['ok' => false, 'reason' => 'invalid_format', 'message' => 'CPF inválido. Verifique e tente novamente.'];
    }

    if (!credpix_cpf_brasil_configured()) {
        return [
            'ok' => false,
            'reason' => 'missing_token',
            'message' => 'API Brasil de CPF não configurada (CPF_BRASIL_API_KEY no .env).',
        ];
    }

    $url = CREDPIX_CPF_BRASIL_API_HOST . '/' . rawurlencode(credpix_cpf_brasil_key()) . '/cpf/' . rawurlencode($digits);
    $http = credpix_http_get_json($url, 'credpix-consulta-cpf-brasil/1.0');
    if (empty($http['ok'])) {
        return $http;
    }

    /** @var array<string, mixed> $payload */
    $payload = $http['payload'];
    if (!empty($payload['erro']) || !empty($payload['error'])) {
        return [
            'ok' => false,
            'reason' => 'api_error',
            'message' => (string) ($payload['erro'] ?? $payload['error']),
        ];
    }

    $mapped = credpix_map_brasil_cpf_response($payload, $digits);
    if ($mapped === null) {
        return ['ok' => false, 'reason' => 'missing_birthdate', 'message' => 'CPF não encontrado ou dados incompletos.'];
    }

    return $mapped;
}

/**
 * API secundária: Elaiflow
 *
 * @return array{ok: bool, reason?: string, message?: string, data?: array<string, mixed>}
 */
function credpix_consultar_cpf_elaiflow(string $cpf): array
{
    $digits = preg_replace('/\D/', '', $cpf) ?: '';
    if (strlen($digits) !== 11) {
        return ['ok' => false, 'reason' => 'invalid_format', 'message' => 'CPF inválido. Verifique e tente novamente.'];
    }

    if (!credpix_cpf_configured()) {
        return [
            'ok' => false,
            'reason' => 'missing_token',
            'message' => 'API de CPF não configurada (CPF_API_TOKEN no .env).',
        ];
    }

    $url = CREDPIX_CPF_API_BASE . '/consultar-filtrada/cpf?' . http_build_query([
        'cpf' => $digits,
        'token' => credpix_cpf_token(),
    ]);

    $http = credpix_http_get_json($url);
    if (empty($http['ok'])) {
        return $http;
    }

    /** @var array<string, mixed> $data */
    $data = $http['payload'];

    if (!empty($data['erro']) || !empty($data['error'])) {
        return [
            'ok' => false,
            'reason' => 'api_error',
            'message' => (string) ($data['erro'] ?? $data['error']),
        ];
    }

    if (empty($data['nascimento'])) {
        return ['ok' => false, 'reason' => 'missing_birthdate', 'message' => 'CPF não encontrado ou dados incompletos.'];
    }

    return [
        'ok' => true,
        'data' => [
            'cpf' => $digits,
            'nome' => (string) ($data['nome'] ?? 'Cliente'),
            'mae' => (string) ($data['mae'] ?? ''),
            'sexo' => (string) ($data['sexo'] ?? ''),
            'nascimento' => credpix_normalize_nascimento((string) $data['nascimento']),
        ],
    ];
}

/**
 * Consulta CPF: Brasil (principal) → Elaiflow (fallback).
 *
 * @return array{ok: bool, reason?: string, message?: string, data?: array<string, mixed>}
 */
function credpix_consultar_cpf(string $cpf): array
{
    if (credpix_cpf_brasil_configured()) {
        $result = credpix_consultar_cpf_brasil($cpf);
        if (!empty($result['ok'])) {
            return $result;
        }
    }

    return credpix_consultar_cpf_elaiflow($cpf);
}

function credpix_cpf_brasil_api_base_url(): string
{
    if (!credpix_cpf_brasil_configured()) {
        return '';
    }
    return CREDPIX_CPF_BRASIL_API_HOST . '/' . credpix_cpf_brasil_key() . '/cpf';
}

function credpix_cpf_to_wizard_response(array $result): array
{
    if (empty($result['ok'])) {
        return [
            'success' => false,
            'error' => $result['message'] ?? 'Não foi possível consultar o CPF.',
        ];
    }

    $d = $result['data'];
    return [
        'success' => true,
        'data' => [
            'nome' => $d['nome'],
            'nascimento' => $d['nascimento'],
            'sexo' => $d['sexo'] ?? '',
            'mae' => $d['mae'],
            'cpf_formatado' => credpix_format_cpf((string) $d['cpf']),
            'primeiraparcela' => 'Novembro de 2026',
        ],
    ];
}

function credpix_lookup_cpf_for_wizard(string $cpf): array
{
    return credpix_cpf_to_wizard_response(credpix_consultar_cpf($cpf));
}
