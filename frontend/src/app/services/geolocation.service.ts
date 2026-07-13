import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface UserCoords {
  lat: number;
  lon: number;
  accuracy: number; // metros
}

export type GeoStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'error';

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  private coords$ = new BehaviorSubject<UserCoords | null>(null);
  private status$ = new BehaviorSubject<GeoStatus>('idle');

  /** Coordenadas actuales del usuario (null si no disponibles) */
  get userCoords(): Observable<UserCoords | null> {
    return this.coords$.asObservable();
  }

  /** Estado actual del permiso/proceso */
  get geoStatus(): Observable<GeoStatus> {
    return this.status$.asObservable();
  }

  /** Valor síncrono para lectura rápida */
  get currentCoords(): UserCoords | null {
    return this.coords$.value;
  }

  get currentStatus(): GeoStatus {
    return this.status$.value;
  }

  /**
   * Solicita permiso de ubicación al navegador.
   * Devuelve las coordenadas o null si no se pudo obtener.
   */
  async requestLocation(): Promise<UserCoords | null> {
    if (!('geolocation' in navigator)) {
      this.status$.next('unavailable');
      console.warn('⚠️ Geolocation API no disponible en este navegador.');
      return null;
    }

    this.status$.next('requesting');

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 300_000 // 5 minutos de caché
        });
      });

      const coords: UserCoords = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy
      };

      this.coords$.next(coords);
      this.status$.next('granted');
      return coords;

    } catch (err: any) {
      const geoError = err as GeolocationPositionError;

      switch (geoError.code) {
        case GeolocationPositionError.PERMISSION_DENIED:
          this.status$.next('denied');
          console.warn('El usuario denegó el permiso de ubicación.');
          break;
        case GeolocationPositionError.POSITION_UNAVAILABLE:
          this.status$.next('unavailable');
          console.warn('Posición no disponible (GPS apagado o sin señal).');
          break;
        case GeolocationPositionError.TIMEOUT:
          this.status$.next('error');
          console.warn('Timeout al obtener ubicación.');
          break;
        default:
          this.status$.next('error');
          console.error('Error desconocido de geolocalización:', geoError);
      }

      this.coords$.next(null);
      return null;
    }
  }

  /**
   * Fórmula de Haversine: distancia en km entre dos puntos geográficos.
   */
  static haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radio de la Tierra en km
    const toRad = (deg: number) => deg * (Math.PI / 180);

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
