const normalizeNoAccents = (value = '') => `${value || ''}`
  .toString()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const stripTrailingPunctuation = (value = '') => `${value || ''}`
  .replace(/[¿?¡!.,;:]+$/g, '')
  .trim();

const normalizeSpaces = (value = '') => `${value || ''}`
  .replace(/\s+/g, ' ')
  .trim();

const coerceToText = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = coerceToText(item);
      if (text) return text;
    }
    return '';
  }

  if (typeof value === 'object') {
    const candidates = [
      value.original,
      value.value,
      value.text,
      value.name,
      value.displayName,
      value.stringValue,
      value.city,
      value.province,
      value.region
    ];

    for (const candidate of candidates) {
      const text = coerceToText(candidate);
      if (text) return text;
    }
  }

  return '';
};

const cleanConversationalPrefix = (value = '') => {
  const raw = normalizeSpaces(`${value || ''}`);
  if (!raw) return '';

  let current = raw;
  let prev = '';

  while (current !== prev) {
    prev = current;
    current = current
      .replace(/^(hola|buenas|ey|oye)\s+/i, '')
      .replace(/^(por\s+favor|porfa)\s+/i, '')
      .replace(/^(quiero|quisiera|me\s+gustaria|me\s+gustar[ií]a)\s+que\s+me\s+(muestres|muestrame|mu[eé]strame|ens[eé][ñn]es|ens[eé][ñn]ame|digas|recomiendes?)\s+/i, '')
      .replace(/^(me\s+encantaria|me\s+encantar[ií]a|podrias|podr[ií]as|puedes)\s+(ver|mostrar|mostrarme|muestrame|mu[eé]strame|ens[eé][ñn]ame|ens[eé][ñn]es|buscar|encontrar|recomendar(?:me)?)\s+/i, '')
      .replace(/^que\s+me\s+(muestres|muestrame|mu[eé]strame|ens[eé][ñn]es|ens[eé][ñn]ame|digas|recomiendes?)\s+/i, '')
      .replace(/^(quiero|quisiera|busco|buscar|busca|dame|muestrame|mu[eé]strame|ensename|ens[eé][ñn]ame|ver|mostrar|mostrarme|encontrar)\s+/i, '')
      .replace(/^(algo|alguna?\s+cosa|cosas?)\s+de\s+/i, '')
      .replace(/^(alg[uú]n|alguna|algunos|algunas|un|una|unos|unas)\s+/i, '')
      .replace(/^productos?\s+de\s+/i, '')
      .replace(/^de\s+/i, '')
      .replace(/\s+(por\s+favor|porfa)$/i, '')
      .replace(/[¿?¡!.,;:]+$/g, '')
      .trim();
  }

  return normalizeSpaces(current);
};

const OFFENSIVE_TERMS = [
  // insultos directos
  'gilipollas',
  'idiota',
  'imbecil',
  'subnormal',
  'tonto',
  'estupido',
  'capullo',
  'cabron',
  'mierda',
  'hijoputa',
  'mamon',
  'pendejo',
  'imbecil',
  // palabrotas / blasfemias frecuentes
  'cago',       // cubre "me cago en..."
  'joder',
  'hostia',
  'hostias',
  'coño',
  'puta',
  'puto',
  'polla',
  'verga',
  'follar',
  'chinga',
  'chingada',
];

const containsOffensiveLanguage = (value = '') => {
  const normalized = normalizeNoAccents(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return false;

  return OFFENSIVE_TERMS.some((term) => {
    const normalizedTerm = normalizeNoAccents(term).replace(/[^a-z0-9]/g, '');
    const rx = new RegExp(`(^|\\s)${normalizedTerm}(\\s|$)`, 'i');
    return rx.test(normalized);
  });
};

module.exports = {
  normalizeNoAccents,
  stripTrailingPunctuation,
  normalizeSpaces,
  coerceToText,
  cleanConversationalPrefix,
  containsOffensiveLanguage
};
