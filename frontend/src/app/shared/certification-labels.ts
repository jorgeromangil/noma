export type CertificationValue =
  | 'Sin certificación'
  | 'DO'
  | 'DOP'
  | 'IGP'
  | 'IGA'
  | 'Artesanía garantizada';

export interface CertificationOption {
  value: CertificationValue;
  label: string;
}

export const CERTIFICATION_OPTIONS: CertificationOption[] = [
  { value: 'Sin certificación', label: 'Sin certificación' },
  { value: 'DO', label: 'DO (Denominación de Origen)' },
  { value: 'DOP', label: 'DOP (Denominación de Origen Protegida)' },
  { value: 'IGA', label: 'IGA (Indicación Geográfica Artesanal)' },
  { value: 'IGP', label: 'IGP (Indicación Geográfica Protegida)' },
  { value: 'Artesanía garantizada', label: 'Artesanía garantizada' }
];

const CERTIFICATION_LABEL_BY_VALUE: Record<string, string> = {
  'Sin certificación': 'Sin certificación',
  DO: 'DO (Denominación de Origen)',
  DOP: 'DOP (Denominación de Origen Protegida)',
  IGA: 'IGA (Indicación Geográfica Artesanal)',
  IGP: 'IGP (Indicación Geográfica Protegida)',
  'Artesanía garantizada': 'Artesanía garantizada'
};

const CERTIFICATION_ALIAS_TO_VALUE: Record<string, CertificationValue> = {
  'sin certificacion': 'Sin certificación',
  do: 'DO',
  dop: 'DOP',
  iga: 'IGA',
  igp: 'IGP',
  'denominacion de origen': 'DO',
  'denominacion de origen protegida': 'DOP',
  'indicacion geografica artesanal': 'IGA',
  'indicacion geografica protegida': 'IGP',
  'artesania garantizada': 'Artesanía garantizada'
};

function normalizeCertificationText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function getCertificationLabel(rawValue: string | null | undefined): string {
  const value = `${rawValue ?? ''}`.trim();
  if (!value) return '';

  // Soporta múltiples valores separados por coma o punto y coma.
  const parts = value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return parts.map((part) => getCertificationLabel(part)).join(', ');
  }

  if (CERTIFICATION_LABEL_BY_VALUE[value]) {
    return CERTIFICATION_LABEL_BY_VALUE[value];
  }

  const normalized = normalizeCertificationText(value);
  const canonical = CERTIFICATION_ALIAS_TO_VALUE[normalized];
  if (canonical) {
    return CERTIFICATION_LABEL_BY_VALUE[canonical];
  }

  return value;
}