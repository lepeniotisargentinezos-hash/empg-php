'use strict';

function parseBirthdate(raw) {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

function calcAge(nascimento, refDate) {
  const birth = parseBirthdate(nascimento);
  if (!birth || Number.isNaN(birth.getTime())) return null;
  const ref = refDate instanceof Date ? refDate : new Date();
  let age = ref.getFullYear() - birth.getFullYear();
  const md = (ref.getMonth() + 1) * 100 + ref.getDate();
  const bmd = (birth.getMonth() + 1) * 100 + birth.getDate();
  if (md < bmd) age--;
  return age >= 0 && age <= 120 ? age : null;
}

function ageBand(age) {
  if (age == null) return null;
  if (age < 18) return 'menor-18';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  if (age <= 64) return '55-64';
  return '65+';
}

function ageBandLabel(band) {
  const labels = {
    'menor-18': 'Menor de 18',
    '18-24': '18–24',
    '25-34': '25–34',
    '35-44': '35–44',
    '45-54': '45–54',
    '55-64': '55–64',
    '65+': '65+',
  };
  return labels[band] || '—';
}

function normalizeGender(sexo) {
  if (!sexo || !String(sexo).trim()) return null;
  const s = String(sexo).trim().toUpperCase();
  if (['M', 'MASC', 'MASCULINO', 'MALE'].includes(s)) return 'M';
  if (['F', 'FEM', 'FEMININO', 'FEMALE'].includes(s)) return 'F';
  return 'O';
}

function genderLabel(gender) {
  if (gender === 'M') return 'Masculino';
  if (gender === 'F') return 'Feminino';
  if (gender === 'O') return 'Outro';
  return '—';
}

function birthYear(nascimento) {
  const birth = parseBirthdate(nascimento);
  return birth && !Number.isNaN(birth.getTime()) ? birth.getFullYear() : null;
}

function profileFromNascimento(nascimento, sexo) {
  const age = calcAge(nascimento);
  return {
    lead_age: age,
    lead_age_band: ageBand(age),
    lead_gender: normalizeGender(sexo),
    lead_birth_year: birthYear(nascimento),
  };
}

function profileFromEvent(input) {
  if (!input || typeof input !== 'object') {
    return { lead_age: null, lead_age_band: null, lead_gender: null, lead_birth_year: null };
  }
  if (input.lead_age != null || input.lead_age_band || input.lead_gender) {
    let age = input.lead_age != null ? Number(input.lead_age) : null;
    if (age != null && (age < 0 || age > 120)) age = null;
    return {
      lead_age: age,
      lead_age_band: input.lead_age_band ? String(input.lead_age_band).slice(0, 16) : ageBand(age),
      lead_gender: normalizeGender(input.lead_gender),
      lead_birth_year: input.lead_birth_year != null ? Number(input.lead_birth_year) : null,
    };
  }
  const meta = input.meta && typeof input.meta === 'object' ? input.meta : {};
  return profileFromNascimento(input.nascimento || meta.nascimento, input.sexo || meta.sexo);
}

function sanitizeEventFields(profile) {
  const out = {};
  if (profile.lead_age != null) out.lead_age = Math.round(profile.lead_age);
  if (profile.lead_age_band) out.lead_age_band = String(profile.lead_age_band).slice(0, 16);
  if (profile.lead_gender) out.lead_gender = String(profile.lead_gender).slice(0, 1);
  if (profile.lead_birth_year) out.lead_birth_year = Number(profile.lead_birth_year);
  return out;
}

module.exports = {
  parseBirthdate,
  calcAge,
  ageBand,
  ageBandLabel,
  normalizeGender,
  genderLabel,
  birthYear,
  profileFromNascimento,
  profileFromEvent,
  sanitizeEventFields,
};
