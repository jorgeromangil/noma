// utils/linguistica.js

/**
 * Helpers simples para texto en español (singular/plural, capitalización, puntuación).
 */

const pluralize = (count, singular, plural = null) => {
  return count === 1 ? singular : (plural || `${singular}s`);
};

const toTitle = (value) => {
  const s = `${value || ''}`.trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const ensureFinalPunctuation = (text) => {
  const s = `${text ?? ''}`.trim();
  if (!s) return s;
  return /[.!?…]$/.test(s) ? s : `${s}.`;
};

// Title case simple con excepciones típicas en español
const toSpanishTitleCase = (text) => {
  const s = `${text ?? ''}`.trim();
  if (!s) return s;

  const lowerExceptions = new Set([
    'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'por', 'para', 'a'
  ]);

  const words = s.split(/\s+/g);

  return words
    .map((w, idx) => {
      const wTrim = w.trim();
      if (!wTrim) return '';

      const lower = wTrim.toLowerCase();
      if (idx !== 0 && lowerExceptions.has(lower)) return lower;

      // Mantener acrónimos / códigos tipo ES-RI
      if (/^[A-Z]{2}-[A-Z0-9]{2,3}$/.test(wTrim)) return wTrim;

      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .filter(Boolean)
    .join(' ');
};

module.exports = {
  pluralize,
  toTitle,
  ensureFinalPunctuation,
  toSpanishTitleCase,
};
