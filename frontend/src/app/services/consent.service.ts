import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ConsentSettings {
  analytics: boolean;
  necessary: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ConsentService {
  private isBrowser: boolean;
  private consentSubject: BehaviorSubject<ConsentSettings>;
  public consent$: Observable<ConsentSettings>;
  
  private acknowledgedSubject: BehaviorSubject<boolean>;
  public acknowledged$: Observable<boolean>;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
    
    // Inicializar con valores del localStorage si es navegador
    const initialAcknowledged = this.isBrowser ? this.getAcknowledgedStatus() : true;
    const initialConsent = this.isBrowser ? this.getStoredConsent() : this.getDefaultConsent();
    
    this.acknowledgedSubject = new BehaviorSubject<boolean>(initialAcknowledged);
    this.acknowledged$ = this.acknowledgedSubject.asObservable();
    
    this.consentSubject = new BehaviorSubject<ConsentSettings>(initialConsent);
    this.consent$ = this.consentSubject.asObservable();
    
    if (this.isBrowser) {
      this.updateGoogleConsent(initialConsent);
    }
  }

  private getStoredConsent(): ConsentSettings {
    if (!this.isBrowser) return this.getDefaultConsent();
    
    const stored = localStorage.getItem('noma_consent');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        return this.getDefaultConsent();
      }
    }
    return this.getDefaultConsent();
  }

  private getDefaultConsent(): ConsentSettings {
    return {
      necessary: true,
      analytics: false
    };
  }

  private getAcknowledgedStatus(): boolean {
    if (!this.isBrowser) return true;
    const stored = localStorage.getItem('noma_consent_acknowledged');
    return stored === 'true';
  }

  public setConsent(settings: Partial<ConsentSettings>): void {
    if (!this.isBrowser) return;
    
    const current = this.consentSubject.value;
    const updated = { ...current, ...settings };
    
    this.consentSubject.next(updated);
    localStorage.setItem('noma_consent', JSON.stringify(updated));
    this.updateGoogleConsent(updated);
  }

  public acceptAll(): void {
    this.setConsent({ necessary: true, analytics: true });
  }

  public rejectAll(): void {
    this.setConsent({ necessary: true, analytics: false });
  }

  public getConsent(): ConsentSettings {
    return this.consentSubject.value;
  }

  public hasConsented(): boolean {
    if (!this.isBrowser) return true;
    return this.acknowledgedSubject.value;
  }

  public setConsentAcknowledged(): void {
    if (!this.isBrowser) return;
    
    localStorage.setItem('noma_consent_acknowledged', 'true');
    this.acknowledgedSubject.next(true);
  }

  public resetConsent(): void {
    if (!this.isBrowser) return;
    
    localStorage.removeItem('noma_consent_acknowledged');
    this.acknowledgedSubject.next(false);
    this.consentSubject.next(this.getDefaultConsent());
  }

  private updateGoogleConsent(settings: ConsentSettings): void {
    if (!this.isBrowser || typeof window === 'undefined' || !(window as any).gtag) {
      return;
    }
    
    (window as any).gtag('consent', 'update', {
      'analytics_storage': settings.analytics ? 'granted' : 'denied',
      'ad_storage': 'denied',
      'ad_user_data': 'denied',
      'ad_personalization': 'denied'
    });
  }
}
