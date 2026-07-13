import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { buildApiUrl } from '../../../shared/api-base';
import { UserCoords } from '../../../services/geolocation.service';

@Injectable({
  providedIn: 'root'
})
export class ChatbotService {
  private apiUrl = buildApiUrl('dialogflow'); 
  private productsUrl = buildApiUrl('products');
  private usersUrl = buildApiUrl('users');
  private sessionId = this.createSessionId();

  // Debe coincidir con el projectId del bridge (backend/controllers/dialogflowBridge.js)
  private readonly dialogflowProjectId = 'small-talk-kygk';

  // Guardamos el estado conversacional entre turnos
  private outputContexts: any[] = [];
  private userCoords: UserCoords | null = null;

  constructor(private http: HttpClient) {}

  setOutputContexts(contexts: any[] | undefined) {
    // Keep current contexts when backend response does not include them.
    // This preserves conversation state across prompt-only turns.
    if (!Array.isArray(contexts)) return;
    this.outputContexts = contexts;
  }

  setUserLocation(coords: UserCoords | null): void {
    this.userCoords = coords;
  }

  resetConversationState(): void {
    this.sessionId = this.createSessionId();
    this.outputContexts = [];
    this.userCoords = null;
  }

  private createSessionId(): string {
    return Math.random().toString(36).substring(2, 14);
  }

  private buildLocationContext(session: string): any | null {
    if (!this.userCoords) return null;

    return {
      name: `${session}/contexts/ubicacion-usuario`,
      lifespanCount: 10,
      parameters: {
        lat: this.userCoords.lat,
        lon: this.userCoords.lon,
        accuracy: this.userCoords.accuracy,
        source: 'browser-geolocation',
        updated_at: new Date().toISOString()
      }
    };
  }

  private mergeContexts(base: any[], extras: Array<any | null>): any[] {
    const byName = new Map<string, any>();

    for (const ctx of base || []) {
      const name = `${ctx?.name || ''}`.trim();
      if (!name) continue;
      byName.set(name, ctx);
    }

    for (const ctx of extras || []) {
      const name = `${ctx?.name || ''}`.trim();
      if (!name) continue;
      byName.set(name, ctx);
    }

    return Array.from(byName.values());
  }

  sendMessage(text: string): Observable<any> {
    const session = `projects/${this.dialogflowProjectId}/agent/sessions/${this.sessionId}`;
    const locationContext = this.buildLocationContext(session);
    const mergedContexts = this.mergeContexts(this.outputContexts, [locationContext]);

    const body = {
      queryResult: {
        queryText: text,
        parameters: {}
      },
      session,
      outputContexts: mergedContexts
    };
    return this.http.post(this.apiUrl, body);
  }

  getProductCardDataBySlug(slug: string): Observable<{ image?: string | null; images?: string[]; province?: string; category?: string; certification?: string; artisanName?: string } | null> {
    const safeSlug = `${slug || ''}`.trim();
    if (!safeSlug) return of(null);

    return this.http.get<any>(`${this.productsUrl}/slug/${safeSlug}`).pipe(
      map((response) => {
        const product = response?.product || {};
        const media = Array.isArray(product.media) ? product.media : [];
        const mediaImages = media
          .filter((item: unknown) => typeof item === 'string')
          .map((item: string) => item.trim())
          .filter(Boolean);
        const fallbackImage = typeof product.image === 'string' ? product.image.trim() : '';
        const images = Array.from(new Set([
          ...mediaImages,
          ...(fallbackImage ? [fallbackImage] : [])
        ]));
        const image = images[0] || null;
        const owner = product.owner || {};
        const artisanName = owner?.company_name || [owner?.name, owner?.surname].filter(Boolean).join(' ').trim() || undefined;

        return {
          image,
          images,
          province: product.province || product.address_text || undefined,
          category: product.category || undefined,
          certification: product.certificaciones_protecciones || undefined,
          artisanName
        };
      }),
      catchError(() => of(null))
    );
  }

  getArtisanCardDataBySlug(slug: string): Observable<{ image?: string | null; province?: string; specialty?: string } | null> {
    const safeSlug = `${slug || ''}`.trim();
    if (!safeSlug) return of(null);

    return this.http.get<any>(`${this.usersUrl}/artisan/slug/${safeSlug}`).pipe(
      map((response) => {
        const artisan = response?.artisan || {};

        return {
          image: typeof artisan.image === 'string' ? artisan.image : null,
          province: artisan.province || artisan.address_text || undefined,
          specialty: artisan.description || undefined
        };
      }),
      catchError(() => of(null))
    );
  }
}
