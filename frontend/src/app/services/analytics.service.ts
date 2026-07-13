
import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ConsentService } from './consent.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { buildApiUrl } from '../shared/api-base';
import { AuthService } from '../layouts/auth-layout/auth.service';

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private isBrowser: boolean;

  constructor(
    @Inject(PLATFORM_ID) platformId: Object,
    private consentService: ConsentService,
    private http: HttpClient,
    private authService: AuthService
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  public trackEvent(eventName: string, params: Record<string, any> = {}): void {
    if (!this.isBrowser) return;
    if (!this.consentService.getConsent().analytics) return;

    // Google Analytics (si está disponible)
    if (window.gtag) {
      window.gtag('event', eventName, {
        ...params,
        debug_mode: true
      });
    }

    // Enviar al backend
    const token = this.authService.getToken();
    const headers = token ? new HttpHeaders().set('x-token', token) : undefined;
    const body: any = { tipo: eventName };
    if (params['product_id']) body.producto = params['product_id'];
    if (params['ciudad']) body.ciudad = params['ciudad'];
    // Siempre pasar todos los detalles relevantes
    if (Object.keys(params).length > 0) body.detalles = params;

    this.http.post(buildApiUrl('analytics/event'), body, { headers }).subscribe({
      next: () => {},
      error: () => {}
    });
  }
}