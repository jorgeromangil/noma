const axios = require('axios');

const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL || '';
const GEOCODE_USER_AGENT = process.env.GEOCODE_USER_AGENT || 'syncro_abp25-backend/1.0 (noreply@example.com)';
const GEOCODE_CACHE_TTL_MS = Number(process.env.GEOCODE_CACHE_TTL_MS) || (24 * 60 * 60 * 1000); // 24h

// Simple in-memory cache to reduce repeated requests: address -> { result, expiresAt }
const cache = new Map();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Normalize typographic apostrophes and similar chars to standard ASCII apostrophe.
 * Handles curly apostrophes (\u2019, \u2018), middle dot, etc.
 * Common in Catalan/Valencian street names like "Carrer D'Alcoi"
 */
const normalizeApostrophes = (text) => {
    if (!text) return text;
    return String(text)
        .replace(/[\u2018\u2019\u02BC\u02BB\u0060]/g, "'") // curly/typographic apostrophes → '
        .replace(/\u00B7/g, "'"); // middle dot (català) → '
};

const parseAddressText = (addressText) => {
    if (!addressText) return { street: '', city: null, postalcode: null };
    
    const parts = normalizeApostrophes(String(addressText))
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0);

    // Detect postal code (Spain: 5 digits) in any position
    const postalIndex = parts.findIndex(p => /^\d{5}$/.test(p));
    let postalcode = null;
    if (postalIndex !== -1) {
        postalcode = parts[postalIndex];
        parts.splice(postalIndex, 1);
    }

    const street = parts[0] || '';
    const city = parts[1] || null;

    // If street doesn't contain letters (including apostrophes/hyphens common in Catalan/Valencian), treat as invalid
    const hasLetters = /[a-zA-ZÀ-ÿ]/.test(street);
    
    return {
        street: hasLetters ? street : '',
        city,
        postalcode
    };
};

/**
 * Build a free-text query string from address components for fallback geocoding.
 */
const buildFreeTextQuery = (street, city, state, country, postalcode) => {
    return [street, city, postalcode, state, country].filter(Boolean).map(s => String(s).trim()).join(', ');
};

/**
 * Normalize a string for loose comparison: lowercase, remove accents, remove dots/hyphens.
 * Used to compare province names from Nominatim with the user-provided province.
 */
const normalizeForCompare = (text) => {
    if (!text) return '';
    return String(text)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
        .replace(/[.\-_]/g, ' ')
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const stripProvinceDecorators = (text) => {
    return normalizeForCompare(text)
        .replace(/\b(provincia|province|prov\.)\b\s*(de|d')?/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const splitProvinceCandidate = (text) => {
    const cleaned = stripProvinceDecorators(text);
    if (!cleaned) return [];
    return cleaned
        .split(/\s*[/,;|]\s*/)
        .map(part => part.trim())
        .filter(Boolean);
};

/**
 * Check if the road in the Nominatim result loosely matches the street the user entered.
 * Nominatim may return a nearby street instead of the searched one — we reject those.
 */
/**
 * Normalize street type prefixes to handle Spanish/Valencian/Catalan bilingual variants.
 * e.g. "Avinguda" → "avenida", "Carrer" → "calle", "Plaça" → "plaza"
 */
const normalizeStreetType = (text) => {
    if (!text) return '';
    return text
        .replace(/\bavinguda\b/gi, 'avenida')
        .replace(/\bav\.\b/gi, 'avenida')
        .replace(/\bcarrer\b/gi, 'calle')
        .replace(/\bc\/\b/gi, 'calle')
        .replace(/\bplaca\b/gi, 'plaza')  // already accent-stripped by normalizeForCompare
        .replace(/\bplaca\b/gi, 'plaza')
        .replace(/\bpasseig\b/gi, 'paseo')
        .replace(/\bpassatge\b/gi, 'pasaje')
        .replace(/\brambla\b/gi, 'rambla')
        .replace(/\btravessera\b/gi, 'travesia')
        .replace(/\bcami\b/gi, 'camino')   // accent already stripped
        .replace(/\bvial\b/gi, 'calle')
        .replace(/\bcami\b/gi, 'camino');
};

const isRoadMatch = (item, searchedStreet) => {
    if (!searchedStreet) return false;
    const addr = item.address || {};
    const resultRoad = addr.road || addr.pedestrian || addr.footway || addr.path || '';
    if (!resultRoad) return false;
    const normalizedResult = normalizeStreetType(normalizeForCompare(resultRoad));
    const normalizedSearch = normalizeStreetType(normalizeForCompare(searchedStreet));
    // Permitir coincidencia parcial o inclusiva (más flexible)
    if (normalizedResult === normalizedSearch) return true;
    if (normalizedResult.includes(normalizedSearch) || normalizedSearch.includes(normalizedResult)) return true;
    // Permitir coincidencia si ambos contienen la palabra principal (por ejemplo, "luceros")
    const mainWord = normalizedSearch.split(' ').find(w => w.length > 4);
    if (mainWord && normalizedResult.includes(mainWord)) return true;
    return false;
};

/**
 * Check if the Nominatim result belongs to the expected province.
 * Nominatim returns address.state for the Spanish province/autonomy.
 * We do a loose substring match to handle variations like
 * "Provincia de Albacete" vs "Albacete".
 */
const { areProvincesEquivalent, getCanonicalProvinceName } = require('./provincias');
const isInExpectedProvince = (item, expectedState) => {
    if (!expectedState) return true; // no province to validate against
    const addr = item.address || {};
    // Nominatim fields that may contain province info
    const candidates = [addr.state, addr.county, addr.province, addr.region, item.display_name].filter(Boolean);
    if (candidates.length === 0) return false;

    const expectedCanonical = getCanonicalProvinceName(expectedState) || expectedState;
    const normalizedExpected = stripProvinceDecorators(expectedCanonical);

    return candidates.some(candidate => {
        if (areProvincesEquivalent(candidate, expectedCanonical)) return true;

        const candidateParts = splitProvinceCandidate(candidate);
        if (candidateParts.some(part => areProvincesEquivalent(part, expectedCanonical))) return true;

        const normalizedCandidate = stripProvinceDecorators(candidate);
        if (normalizedCandidate && normalizedExpected) {
            if (normalizedCandidate.includes(normalizedExpected) || normalizedExpected.includes(normalizedCandidate)) {
                return true;
            }
        }

        return false;
    });
};

/**
 * Geocode an address using Nominatim (OpenStreetMap).
 * First tries a structured query, then falls back to a free-text query
 * (better for apostrophes and non-standard names like "Carrer D'Alcoi").
 * Returns { latitude, longitude } or null if not found.
 *
 * @param {string} street - Street address (e.g., "Carrer D'Alcoi", "Calle Mayor 23")
 * @param {string} city - City/town name (e.g., "Alicante")
 * @param {string} state - Province name (e.g., "Alicante")
 * @param {string} country - Country (default: "Spain")
 * @param {string} postalcode - Optional postal code for better precision
 * @returns {Promise<{latitude, longitude}|null>}
 */

/**
 * Devuelve un array de coincidencias relevantes para la dirección buscada.
 * Cada coincidencia incluye: display, lat, lon, raw (objeto Nominatim)
 */
const geocodeAddress = async (street, city = null, state = null, country = 'Spain', postalcode = null) => {
    

    if (!street || String(street).trim().length === 0) return [];

    // Normalize apostrophes in all inputs
    street = normalizeApostrophes(String(street).trim());
    if (city) city = normalizeApostrophes(String(city).trim());
    if (state) state = normalizeApostrophes(String(state).trim());


    // --- Filtrado de variantes de tipo de vía según provincia ---
    // Mapeo de comunidades autónomas a idiomas oficiales
    const COMMUNITY_LANGS = {
        'Cataluña': ['es', 'ca'],
        'Comunidad Valenciana': ['es', 'ca'],
        'Islas Baleares': ['es', 'ca'],
        'Galicia': ['es', 'gl'],
        'País Vasco': ['es', 'eu'],
        'Comunidad Foral de Navarra': ['es', 'eu'],
        'Principado de Asturias': ['es', 'ast'],
        // Resto: solo español
    };

    // Diccionario de variantes por idioma
    const VIA_VARIANTS_LANG = {
        'Calle': {
            es: 'Calle', ca: 'Carrer', gl: 'Rúa', eu: 'Kalea', ast: 'Cai'
        },
        'Avenida': {
            es: 'Avenida', ca: 'Avinguda', gl: 'Avenida', eu: 'Etorbidea', ast: 'Avenida'
        },
        'Plaza': {
            es: 'Plaza', ca: 'Plaça', gl: 'Praza', eu: 'Enparantza', ast: 'Plaza'
        },
        'Camino': {
            es: 'Camino', ca: 'Camí', gl: 'Camiño', eu: 'Bidea', ast: 'Camín'
        },
        'Paseo': {
            es: 'Paseo', ca: 'Passeig', gl: 'Paseo', eu: 'Pasealekua', ast: 'Paseo'
        },
        'Travesía': {
            es: 'Travesía', ca: 'Travessera', gl: 'Travesía', eu: 'Travesia', ast: 'Travesía'
        },
        'Pasaje': {
            es: 'Pasaje', ca: 'Passatge', gl: 'Pasaxe', eu: 'Pasabidea', ast: 'Pasaxe'
        }
    };

    // Obtener comunidad autónoma de la provincia
    let comunidad = null;
    try {
        // Lazy require para evitar ciclos
        comunidad = require('./provincias').getAutonomousCommunity(state);
    } catch (e) {}
    const langs = (comunidad && COMMUNITY_LANGS[comunidad]) ? COMMUNITY_LANGS[comunidad] : ['es'];

    // Extraer tipo de vía y resto del nombre
    const viaMatch = street.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ\.]+)\s+(.*)$/);
    let viaType = null;
    let viaRest = null;
    if (viaMatch) {
        viaType = viaMatch[1];
        viaRest = viaMatch[2];
    }

    // Construir variantes a probar
    let streetVariants = [street];
    if (viaType && viaRest) {
        // Buscar variantes para el tipo de vía detectado
        const variants = [];
        for (const lang of langs) {
            if (VIA_VARIANTS_LANG[viaType] && VIA_VARIANTS_LANG[viaType][lang]) {
                variants.push(VIA_VARIANTS_LANG[viaType][lang] + ' ' + viaRest);
            }
        }
        // Si no se encontró ninguna variante, usar la original
        if (variants.length > 0) {
            streetVariants = variants;
        }
        // Añadir también la variante "sin tipo de vía"
        streetVariants.push(viaRest);
    }

    // Eliminar duplicados
    streetVariants = [...new Set(streetVariants)];

    // Limitar el número de variantes para evitar esperas excesivas
    const MAX_VARIANTS = 5;
    streetVariants = streetVariants.slice(0, MAX_VARIANTS);

    // Probar cada variante hasta encontrar resultados
    let lastError = null;
    for (const variant of streetVariants) {
        // Build cache key from all parameters
        const key = [variant, city, state, country, postalcode].filter(Boolean).map(s => String(s).trim().toLowerCase()).join('|');
        const cached = cache.get(key);
        if (cached && Date.now() < cached.expiresAt) {
            if (cached.result.length > 0) return cached.result;
            continue;
        }

        let attempt = 0;
        let allMatches = [];
        const maxAttempts = 3;

        while (attempt < maxAttempts) {
            attempt += 1;
            try {
                // Use structured query parameters for better precision
                const params = {
                    street: variant,
                    format: 'json',
                    addressdetails: 1,
                    limit: 10
                };
                if (city) params.city = city;
                if (state) params.state = state;
                if (country) params.country = String(country).trim();
                if (postalcode) params.postalcode = String(postalcode).trim();
                if (NOMINATIM_EMAIL) params.email = NOMINATIM_EMAIL;

                const res = await axios.get('https://nominatim.openstreetmap.org/search', {
                    params,
                    headers: {
                        'User-Agent': GEOCODE_USER_AGENT
                    },
                    timeout: 5000
                });

                if (Array.isArray(res.data) && res.data.length > 0) {
                    allMatches = res.data.filter(item => {
                        const latitude = Number(item.lat);
                        const longitude = Number(item.lon);
                        const roadMatch = isRoadMatch(item, variant);
                        const inProvince = isInExpectedProvince(item, state);
                        return !isNaN(latitude) && !isNaN(longitude) && roadMatch && inProvince;
                    }).map(item => ({
                        display: item.display_name,
                        lat: Number(item.lat),
                        lon: Number(item.lon),
                        raw: item
                    }));
                }

                if (allMatches.length > 0) {
                    cache.set(key, { result: allMatches, expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS });
                    return allMatches;
                }

                // --- FALLBACK: free-text query ---
                const freeText = buildFreeTextQuery(variant, city, state, country, postalcode);
                const fallbackParams = {
                    q: freeText,
                    format: 'json',
                    addressdetails: 1,
                    limit: 10,
                    countrycodes: 'es'
                };
                if (NOMINATIM_EMAIL) fallbackParams.email = NOMINATIM_EMAIL;

                const fallbackRes = await axios.get('https://nominatim.openstreetmap.org/search', {
                    params: fallbackParams,
                    headers: { 'User-Agent': GEOCODE_USER_AGENT },
                    timeout: 5000
                });

                if (Array.isArray(fallbackRes.data) && fallbackRes.data.length > 0) {
                    allMatches = fallbackRes.data.filter(item => {
                        const latitude = Number(item.lat);
                        const longitude = Number(item.lon);
                        const roadMatch = isRoadMatch(item, variant);
                        const inProvince = isInExpectedProvince(item, state);
                        return !isNaN(latitude) && !isNaN(longitude) && roadMatch && inProvince;
                    }).map(item => ({
                        display: item.display_name,
                        lat: Number(item.lat),
                        lon: Number(item.lon),
                        raw: item
                    }));
                }

                if (allMatches.length > 0) {
                    cache.set(key, { result: allMatches, expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS });
                    return allMatches;
                }

                // No result in any query — street does not exist in the given province
                cache.set(key, { result: [], expiresAt: Date.now() + (5 * 60 * 1000) });
                break;

            } catch (error) {
                lastError = error;
                const status = error && error.response && error.response.status;
                if (status === 429 || (status >= 500 && status < 600)) {
                    const backoff = attempt * 500;
                    console.warn(`Geocode attempt ${attempt} got status ${status}. Retrying after ${backoff}ms`);
                    await sleep(backoff);
                    continue;
                }
                console.error('Geocoding error:', error.message || error, 'status:', status);
                break;
            }
        }
    }

    // If we reach here, log and return []
    console.error('Geocoding failed for all variants. LastError:', (lastError && (lastError.message || lastError)));
    return [];
};

module.exports = {
    geocodeAddress,
    parseAddressText
};
