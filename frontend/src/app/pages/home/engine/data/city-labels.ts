/**
 * Jerarquía de ciudades por nivel de importancia (tier).
 *
 * Tier 0 → Comunidades autónomas:   visibles antes de provincias
 * Tier 1 → Grandes capitales:        visibles desde lejos
 * Tier 2 → Ciudades importantes:     visibles a zoom medio
 * Tier 3 → Capitales de provincia:   visibles a zoom medio-alto
 * Tier 4 → Municipios / localidades: visibles solo a zoom alto
 */

export interface CityLabel {
  name: string;
  lat: number;
  lon: number;
  /** 0 = comunidad autónoma, 1 = capital nacional, 2 = gran ciudad, 3 = capital de provincia, 4 = municipio */
  tier: 0 | 1 | 2 | 3 | 4;
}

export const CITY_LABELS: CityLabel[] = [
  // ── Tier 0: Comunidades autónomas ──────────────────────────
  { name: 'Andalucía',            lat: 37.5000, lon: -4.5000,   tier: 0 },
  { name: 'Aragón',               lat: 41.5000, lon: -0.9000,   tier: 0 },
  { name: 'Asturias',             lat: 43.3000, lon: -5.8000,   tier: 0 },
  { name: 'Islas Baleares',       lat: 39.5000, lon:  3.0000,   tier: 0 },
  { name: 'Canarias',             lat: 28.3000, lon: -16.0000,  tier: 0 },
  { name: 'Cantabria',            lat: 43.2000, lon: -4.0000,   tier: 0 },
  { name: 'Castilla y León',     lat: 41.8000, lon: -4.8000,   tier: 0 },
  { name: 'Castilla-La Mancha',  lat: 39.5000, lon: -3.0000,   tier: 0 },
  { name: 'Cataluña',             lat: 41.8000, lon:  1.5000,   tier: 0 },
  { name: 'C. Valenciana',        lat: 39.5000, lon: -0.5000,   tier: 0 },
  { name: 'Extremadura',          lat: 39.5000, lon: -6.0000,   tier: 0 },
  { name: 'Galicia',              lat: 42.8000, lon: -8.0000,   tier: 0 },
  { name: 'La Rioja',             lat: 42.3000, lon: -2.5000,   tier: 0 },
  { name: 'C. de Madrid',         lat: 40.4000, lon: -3.7000,   tier: 0 },
  { name: 'Región de Murcia',    lat: 38.0000, lon: -1.5000,   tier: 0 },
  { name: 'Navarra',              lat: 42.7000, lon: -1.6000,   tier: 0 },
  { name: 'País Vasco',           lat: 43.0000, lon: -2.6000,   tier: 0 },

  // ── Tier 1: Grandes capitales ──────────────────────────────
  { name: 'Madrid',       lat: 40.4168, lon: -3.7038,   tier: 2 },
  { name: 'Barcelona',    lat: 41.3851, lon:  2.1734,   tier: 2 },

  // ── Tier 2: Ciudades importantes ───────────────────────────
  // Coordenadas centradas en cada provincia (no en la capital exacta)
  { name: 'Valencia',     lat: 39.6000, lon: -0.6000,   tier: 2 },
  { name: 'Sevilla',      lat: 37.5000, lon: -5.5000,   tier: 2 },
  { name: 'Bilbao',       lat: 43.2500, lon: -2.9000,   tier: 2 },
  { name: 'Málaga',       lat: 36.7000, lon: -4.5000,   tier: 2 },
  { name: 'Zaragoza',     lat: 41.5000, lon: -1.0000,   tier: 2 },
  { name: 'Palma',        lat: 39.6000, lon:  2.9000,   tier: 2 },
  { name: 'Las Palmas',   lat: 28.1000, lon: -15.5000,  tier: 2 },
  { name: 'Murcia',       lat: 37.9000, lon: -1.5000,   tier: 2 },
  { name: 'A Coruña',     lat: 43.3000, lon: -8.2000,   tier: 2 },
  { name: 'Oviedo',       lat: 43.3000, lon: -5.8000,   tier: 2 },
  { name: 'Santander',    lat: 43.3000, lon: -4.0000,   tier: 2 },
  { name: 'Badajoz',      lat: 38.8000, lon: -6.5000,   tier: 2 },
  { name: 'Valladolid',   lat: 41.7000, lon: -4.8000,   tier: 2 },
  { name: 'Ciudad Real',  lat: 38.8000, lon: -3.6000,   tier: 2 },
  { name: 'Guadalajara',  lat: 40.8000, lon: -2.7000,   tier: 2 },

  // ── Tier 3: TODAS las capitales de provincia (50) ──────────
  // Coordenadas centradas en cada provincia (no en la capital exacta)
  // Madrid y Barcelona ya están en Tier 2, no se repiten aquí
  { name: 'Albacete',          lat: 38.9000, lon: -1.9000,  tier: 3 },
  { name: 'Alicante',          lat: 38.4500, lon: -0.5500,  tier: 3 },
  { name: 'Almería',           lat: 37.0000, lon: -2.4000,  tier: 3 },
  { name: 'Ávila',             lat: 40.5500, lon: -4.9000,  tier: 3 },
  { name: 'Burgos',            lat: 42.3000, lon: -3.7000,  tier: 3 },
  { name: 'Cáceres',           lat: 39.7000, lon: -6.0000,  tier: 3 },
  { name: 'Cádiz',             lat: 36.3500, lon: -5.8000,  tier: 3 },
  { name: 'Castellón',         lat: 40.1500, lon: -0.1500,  tier: 3 },
  { name: 'Córdoba',           lat: 37.9000, lon: -4.6000,  tier: 3 },
  { name: 'Cuenca',            lat: 40.1000, lon: -2.2000,  tier: 3 },
  { name: 'Girona',            lat: 42.0500, lon:  2.7000,  tier: 3 },
  { name: 'Granada',           lat: 37.1000, lon: -3.3000,  tier: 3 },
  { name: 'Huelva',            lat: 37.4000, lon: -6.7000,  tier: 3 },
  { name: 'Huesca',            lat: 42.1500, lon:  0.0000,  tier: 3 },
  { name: 'Jaén',              lat: 37.9000, lon: -3.5000,  tier: 3 },
  { name: 'León',              lat: 42.5000, lon: -5.5000,  tier: 3 },
  { name: 'Lleida',            lat: 41.7000, lon:  0.9000,  tier: 3 },
  { name: 'Logroño',           lat: 42.3000, lon: -2.5000,  tier: 3 },
  { name: 'Lugo',              lat: 43.0000, lon: -7.5000,  tier: 3 },
  { name: 'Ourense',           lat: 42.2000, lon: -7.7000,  tier: 3 },
  { name: 'Palencia',          lat: 42.1500, lon: -4.5000,  tier: 3 },
  { name: 'Pamplona',          lat: 42.7000, lon: -1.6000,  tier: 3 },
  { name: 'Pontevedra',        lat: 42.3000, lon: -8.5000,  tier: 3 },
  { name: 'Salamanca',         lat: 40.8000, lon: -6.0000,  tier: 3 },
  { name: 'S. C. Tenerife',    lat: 28.3000, lon: -16.4000, tier: 3 },
  { name: 'San Sebastián',     lat: 43.2000, lon: -2.2000,  tier: 3 },
  { name: 'Segovia',           lat: 41.1000, lon: -4.0000,  tier: 3 },
  { name: 'Soria',             lat: 41.6000, lon: -2.6000,  tier: 3 },
  { name: 'Tarragona',         lat: 41.1000, lon:  1.1000,  tier: 3 },
  { name: 'Teruel',            lat: 40.5000, lon: -0.8000,  tier: 3 },
  { name: 'Toledo',            lat: 39.7000, lon: -4.2000,  tier: 3 },
  { name: 'Vitoria-Gasteiz',   lat: 42.8500, lon: -2.6500,  tier: 3 },
  { name: 'Zamora',            lat: 41.6000, lon: -5.8000,  tier: 3 },

  // ── Tier 4: Municipios y localidades menores ───────────────

  // Costa norte (W → E)
  { name: 'Vigo',              lat: 42.2406, lon: -8.7207,  tier: 4 },
  { name: 'Santiago',          lat: 42.8805, lon: -8.5456,  tier: 4 },
  { name: 'Ferrol',            lat: 43.4846, lon: -8.2343,  tier: 4 },
  { name: 'Gijón',             lat: 43.5453, lon: -5.6619,  tier: 4 },
  { name: 'Torrelavega',       lat: 43.3522, lon: -4.0483,  tier: 4 },
  { name: 'Irún',              lat: 43.3369, lon: -1.7888,  tier: 4 },

  // Interior norte
  { name: 'Ponferrada',        lat: 42.5462, lon: -6.5979,  tier: 4 },
  { name: 'Briviesca',         lat: 42.5437, lon: -3.3126,  tier: 4 },
  { name: 'Haro',              lat: 42.5761, lon: -2.8475,  tier: 4 },
  { name: 'Nájera',            lat: 42.4166, lon: -2.7328,  tier: 4 },
  { name: 'Tudela',            lat: 42.0639, lon: -1.6050,  tier: 4 },

  // Noreste – Aragón y Cataluña
  { name: 'Jaca',              lat: 42.5690, lon: -0.5504,  tier: 4 },
  { name: 'Figueres',          lat: 42.2666, lon:  2.9600,  tier: 4 },
  { name: 'Reus',              lat: 41.1559, lon:  1.1058,  tier: 4 },
  { name: 'Tortosa',           lat: 40.8134, lon:  0.5255,  tier: 4 },

  // Costa levantina (N → S)
  { name: 'Morella',           lat: 40.6225, lon: -0.0958,  tier: 4 },
  { name: 'Sagunto',           lat: 39.6811, lon: -0.2731,  tier: 4 },
  { name: 'Gandía',            lat: 38.9600, lon: -0.1814,  tier: 4 },
  { name: 'Xàtiva',           lat: 38.9900, lon: -0.5190,  tier: 4 },
  { name: 'Calpe',             lat: 38.6420, lon:  0.0450,  tier: 4 },
  { name: 'Elche',             lat: 38.2669, lon: -0.6983,  tier: 4 },
  { name: 'Cartagena',         lat: 37.6057, lon: -0.9913,  tier: 4 },

  // Sureste interior
  { name: 'Lorca',             lat: 37.6716, lon: -1.7004,  tier: 4 },
  { name: 'Hellín',            lat: 38.5070, lon: -1.6969,  tier: 4 },

  // Andalucía
  { name: 'Úbeda',             lat: 38.0133, lon: -3.3705,  tier: 4 },
  { name: 'Motril',            lat: 36.7460, lon: -3.5208,  tier: 4 },
  { name: 'Ronda',             lat: 36.7422, lon: -5.1665,  tier: 4 },
  { name: 'Marbella',          lat: 36.5100, lon: -4.8820,  tier: 4 },
  { name: 'Algeciras',         lat: 36.1333, lon: -5.4500,  tier: 4 },
  { name: 'Jerez',             lat: 36.6850, lon: -6.1261,  tier: 4 },

  // Extremadura
  { name: 'Mérida',            lat: 38.9163, lon: -6.3436,  tier: 4 },
  { name: 'Plasencia',         lat: 40.0303, lon: -6.0906,  tier: 4 },

  // Centro
  { name: 'Talavera',          lat: 39.9635, lon: -4.8307,  tier: 4 },
  { name: 'Puertollano',       lat: 38.6866, lon: -4.1080,  tier: 4 },
  { name: 'La Solana',         lat: 38.9456, lon: -3.2359,  tier: 4 },
  { name: 'Aranda de Duero',   lat: 41.6686, lon: -3.6894,  tier: 4 },
  { name: 'Aranjuez',          lat: 40.0321, lon: -3.6036,  tier: 4 },

  // Islas
  { name: 'Manacor',           lat: 39.5642, lon:  3.2145,  tier: 4 },
  { name: 'Arrecife',          lat: 28.9628, lon: -13.5514, tier: 4 },
  { name: 'La Orotava',        lat: 28.3900, lon: -16.5225, tier: 4 },
];
