/**
 * Equivalencias flexibles para provincias insulares
 */
const PROVINCE_EQUIVALENTS = [
    // Baleares
    ['baleares', 'islas baleares', 'illes balears'],
    // Canarias: Las Palmas
    [
        'las palmas',
        'las palmas de gran canaria',
        'provincia de las palmas',
        'palmas',
        'islas canarias'
    ],
    // Canarias: Santa Cruz de Tenerife
    [
        'santa cruz de tenerife',
        'provincia de santa cruz de tenerife',
        'tenerife',
        'islas canarias'
    ]
];

/**
 * Determina si dos nombres de provincia son equivalentes, considerando insulares
 */
const areProvincesEquivalent = (a, b) => {
    const normA = normalizeText(a);
    const normB = normalizeText(b);
    if (normA === normB) return true;
    for (const group of PROVINCE_EQUIVALENTS) {
        if (group.includes(normA) && group.includes(normB)) return true;
        // Permitir coincidencia si normA o normB es substring de algún elemento del grupo
        if (group.some(equiv => normA === equiv || normA.includes(equiv) || equiv.includes(normA))) {
            if (group.some(equiv => normB === equiv || normB.includes(equiv) || equiv.includes(normB))) {
                return true;
            }
        }
    }
    return false;
};
const provinciasData = require('../data/provincias.json');

const normalizeText = (value) => {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ');
};

// Common aliases for Spanish provinces (normalized -> canonical name)
const PROVINCE_ALIASES = {
    'alava': 'Álava',
    'araba': 'Álava',
    'alacant': 'Alicante',
    'la coruna': 'A Coruña',
    'coruna': 'A Coruña',
    'castello': 'Castellón',
    'castellon': 'Castellón',
    'castello de la plana': 'Castellón',
    'castello de la plana castellon': 'Castellón',
    'lleida': 'Lleida',
    'girona': 'Girona',
    'ourense': 'Ourense',
    'guipuzcoa': 'Guipúzcoa',
    'gipuzkoa': 'Guipúzcoa',
    'vizcaya': 'Vizcaya',
    'bizkaia': 'Vizcaya',
    'lerida': 'Lleida',
    'gerona': 'Girona',
    'orense': 'Ourense',
    'islas baleares': 'Baleares',
    'balears': 'Baleares',
    'palmas': 'Las Palmas',
    'las palmas de gran canaria': 'Las Palmas',
    'rioja': 'La Rioja'
};

const provincesByNormalized = new Map(
    provinciasData.provincias.map(p => [normalizeText(p.nombre), p])
);


const resolveProvince = (provincia) => {
    if (!provincia || typeof provincia !== 'string') {
        return null;
    }

    const normalized = normalizeText(provincia);
    const alias = PROVINCE_ALIASES[normalized];
    if (alias) {
        return provincesByNormalized.get(normalizeText(alias)) || null;
    }

    // Buscar equivalencia flexible
    for (const [key, value] of provincesByNormalized.entries()) {
        if (areProvincesEquivalent(key, normalized)) {
            return value;
        }
    }

    return provincesByNormalized.get(normalized) || null;
};

/**
 * Devuelve el nombre canónico de la provincia si existe
 * @param {string} provincia - Nombre de la provincia (puede ser alias)
 * @returns {string|null}
 */
const getCanonicalProvinceName = (provincia) => {
    const found = resolveProvince(provincia);
    return found ? found.nombre : null;
};

/**
 * Obtiene todas las provincias
 * @returns {Array} Array de provincias con su código y comunidad autónoma
 */
const getProvincias = () => {
    return provinciasData.provincias;
};

/**
 * Obtiene la comunidad autónoma de una provincia
 * @param {string} provincia - Nombre de la provincia
 * @returns {string|null} Nombre de la comunidad autónoma o null si no existe
 */
const getAutonomousCommunity = (provincia) => {
    if (!provincia || typeof provincia !== 'string') {
        return null;
    }

    const found = resolveProvince(provincia);

    return found ? found.comunidad_autonoma : null;
};

/**
 * Valida si una provincia existe
 * @param {string} provincia - Nombre de la provincia
 * @returns {boolean} true si la provincia existe
 */
const isProvinceValid = (provincia) => {
    if (!provincia || typeof provincia !== 'string') {
        return false;
    }

    return Boolean(resolveProvince(provincia));
};

/**
 * Busca provincias por término de búsqueda
 * @param {string} searchTerm - Término de búsqueda
 * @returns {Array} Array de provincias que coinciden
 */
const searchProvincias = (searchTerm) => {
    if (!searchTerm || typeof searchTerm !== 'string') {
        return [];
    }

    const normalizado = normalizeText(searchTerm);
    return provinciasData.provincias.filter(p =>
        normalizeText(p.nombre).includes(normalizado)
    );
};

/**
 * Obtiene las comunidades autónomas únicas
 * @returns {Array} Array de comunidades autónomas únicas
 */
const getAutonomousCommunities = () => {
    const communities = new Set(
        provinciasData.provincias.map(p => p.comunidad_autonoma)
    );
    return Array.from(communities).sort();
};

/**
 * Obtiene las provincias de una comunidad autónoma
 * @param {string} comunidad - Nombre de la comunidad autónoma
 * @returns {Array} Array de provincias
 */
const getProvinciasByAutonomousCommunity = (comunidad) => {
    if (!comunidad || typeof comunidad !== 'string') {
        return [];
    }

    const normalizado = normalizeText(comunidad);
    return provinciasData.provincias.filter(p =>
        normalizeText(p.comunidad_autonoma) === normalizado
    );
};

module.exports = {
    getProvincias,
    getAutonomousCommunity,
    isProvinceValid,
    searchProvincias,
    getAutonomousCommunities,
    getProvinciasByAutonomousCommunity,
    getCanonicalProvinceName,
    areProvincesEquivalent // exportar para tests o uso externo
};
