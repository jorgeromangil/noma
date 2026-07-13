import { environment } from '../../environments/environment';

// Normaliza la URL base (sin barras finales) y aporta fallback al origen del navegador
const normalize = (value: string) => value.replace(/\/+$/, '');

const resolveBase = (): string => {
  const envBase = (environment.base_url || '').trim();
  if (envBase) return normalize(envBase);

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${normalize(window.location.origin)}/api`;
  }

  return '/api';
};

export const API_BASE = resolveBase();

export const buildApiUrl = (path: string): string => {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `${API_BASE}/${cleanPath}`;
};
