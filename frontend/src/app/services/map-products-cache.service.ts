import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, finalize, map, shareReplay, tap } from 'rxjs/operators';
import { buildApiUrl } from '../shared/api-base';

export type MapProductLite = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  province?: string;
  autonomous_community?: string;
  category?: string;
  certificaciones_protecciones?: string;
  thumbnail?: string;
  has3D?: boolean;
};

export interface MapProductsCacheEntry {
  version: 1;
  total: number;
  lastUpdated: string | null;
  signature: string;
  cachedAt: string;
  payloadBytes: number;
  products: MapProductLite[];
}

export interface MapProductsRevalidationResult {
  products: MapProductLite[];
  changed: boolean;
}

type MapCacheFetchContext = 'warmUp' | 'home-fallback' | 'mutation-refresh' | 'detail-background' | 'home-revalidate';

type MapCacheDebugState = {
  datasetFetches: number;
  cacheHits: number;
  apiFallbacks: number;
  cacheWrites: number;
  cacheWriteFailures: number;
  lastCacheBytes: number;
  lastWarmUpMs: number;
  lastTransformMs: number;
  lastEngineInitMs: number;
};

declare global {
  interface Window {
    __mapCacheDebug?: Partial<MapCacheDebugState>;
  }
}

export const MAP_PRODUCTS_CACHE_STORAGE_KEY = 'noma_map_products_cache_v1';
export const MAP_PRODUCTS_CACHE_MAX_BYTES = 4.75 * 1024 * 1024;

@Injectable({
  providedIn: 'root'
})
export class MapProductsCacheService {
  private readonly mapLiteUrl = buildApiUrl('products/map-lite');
  private readonly productsUrl = buildApiUrl('products');
  private readonly cacheVersion = 1 as const;

  private inFlightProductsRequest$: Observable<MapProductLite[]> | null = null;
  private requestSequence = 0;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  warmUpCache(): Observable<MapProductLite[]> {
    if (!this.isBrowser()) {
      return of([]);
    }

    this.debugLog('[MapCache] warmUp started');
    const startedAt = this.now();

    if (this.inFlightProductsRequest$) {
      this.debugLog('[MapCache] warmUp reusing in-flight request');
      return this.inFlightProductsRequest$;
    }

    return this.startSharedRequest((requestId) =>
      this.downloadMapLiteAndPersist(requestId, 'warmUp', startedAt)
    );
  }

  warmUpCacheFromProducts(): Observable<MapProductLite[]> {
    if (!this.isBrowser()) {
      return of([]);
    }

    const cache = this.readCache();
    if (cache) {
      this.incrementDebug('cacheHits');
      this.debugLog('[MapCache] detail warm-up skipped: cache already present');
      return of(cache.products);
    }

    if (this.inFlightProductsRequest$) {
      this.debugLog('[MapCache] detail warm-up reusing in-flight request');
      return this.inFlightProductsRequest$;
    }

    this.debugLog('[MapCache] detail warm-up started (/products)');
    const startedAt = this.now();

    return this.startSharedRequest((requestId) =>
      this.downloadProductsAndPersist(requestId, 'detail-background', startedAt)
    );
  }

  primeCacheFromProducts(products: any[]): MapProductLite[] {
    if (!this.isBrowser()) {
      return [];
    }

    const normalizedProducts = this.normalizeMapLiteProducts(Array.isArray(products) ? products : []);
    const entry = this.buildCacheEntry(normalizedProducts);
    this.writeCacheEntry(entry);
    this.debugLog(`[MapCache] cache primed from /products payload: ${normalizedProducts.length}`);
    return normalizedProducts;
  }

  getProductsForHome(): Observable<MapProductLite[]> {
    if (!this.isBrowser()) {
      return of([]);
    }

    this.debugLog('[MapCache] home boot');
    const cache = this.readCache();

    if (cache) {
      this.incrementDebug('cacheHits');
      this.debugLog('[MapCache] cache found in sessionStorage');
      this.debugLog('[MapCache] using cached products');
      this.debugLog(
        `[MapCache] cached payload: ${this.formatBytes(cache.payloadBytes)} | products: ${cache.products.length}`
      );
      return of(cache.products);
    }

    if (this.inFlightProductsRequest$) {
      this.debugLog('[MapCache] no valid cache, reusing in-flight request');
      return this.inFlightProductsRequest$;
    }

    this.incrementDebug('apiFallbacks');
    this.debugLog('[MapCache] no valid cache, falling back to API');
    const startedAt = this.now();
    return this.startSharedRequest((requestId) =>
      this.downloadMapLiteAndPersist(requestId, 'home-fallback', startedAt)
    );
  }

  revalidateCache(): Observable<MapProductsRevalidationResult> {
    if (!this.isBrowser()) {
      return of({ products: [], changed: false });
    }

    const currentCache = this.readCache();
    const currentSignature = currentCache?.signature || null;

    this.debugLog('[MapCache] home revalidation started');
    const startedAt = this.now();

    return this.downloadMapLiteForRevalidation(currentSignature, startedAt).pipe(
      catchError((error) => {
        this.debugLog('[MapCache] home revalidation failed', error);
        return of({
          products: currentCache?.products || [],
          changed: false
        });
      })
    );
  }

  refreshCacheAfterMutation(): Observable<MapProductsCacheEntry | null> {
    if (!this.isBrowser()) {
      return of(null);
    }

    this.debugLog('[MapCache] mutation success -> refreshing cache');
    const startedAt = this.now();

    return this.startSharedRequest(
      (requestId) => this.downloadMapLiteAndPersist(requestId, 'mutation-refresh', startedAt),
      true
    ).pipe(
      map(() => this.readCache()),
      tap((entry) => {
        if (entry) {
          this.debugLog('[MapCache] cache refreshed after mutation');
          return;
        }

        this.debugLog('[MapCache] refresh failed -> cache cleared');
      }),
      catchError((error) => {
        this.clearCache();
        this.debugLog('[MapCache] refresh failed -> cache cleared', error);
        return of(null);
      })
    );
  }

  clearCache(): void {
    if (!this.isBrowser()) {
      return;
    }

    try {
      sessionStorage.removeItem(MAP_PRODUCTS_CACHE_STORAGE_KEY);
    } catch (error) {
      console.warn('[MapCache] failed to clear sessionStorage cache', error);
    }
  }

  private startSharedRequest(
    factory: (requestId: number) => Observable<MapProductLite[]>,
    forceNewRequest: boolean = false
  ): Observable<MapProductLite[]> {
    if (!forceNewRequest && this.inFlightProductsRequest$) {
      return this.inFlightProductsRequest$;
    }

    const requestId = ++this.requestSequence;
    let sharedRequest$: Observable<MapProductLite[]>;

    sharedRequest$ = factory(requestId).pipe(
      shareReplay(1),
      finalize(() => {
        if (this.inFlightProductsRequest$ === sharedRequest$) {
          this.inFlightProductsRequest$ = null;
        }
      })
    );

    this.inFlightProductsRequest$ = sharedRequest$;
    return sharedRequest$;
  }

  private downloadMapLiteAndPersist(
    requestId: number,
    context: MapCacheFetchContext,
    startedAt: number
  ): Observable<MapProductLite[]> {
    this.incrementDebug('datasetFetches');
    console.count('[MapCache] GET /api/products/map-lite');

    return this.fetchMapProductsForCache().pipe(
      tap((products) => {
        this.debugLog(`[MapCache] products fetched: ${products.length}`);
        const entry = this.buildCacheEntry(products);
        this.writeCacheEntry(entry, requestId);
        this.storeDuration(context, this.now() - startedAt);
      })
    );
  }

  private downloadMapLiteForRevalidation(
    currentSignature: string | null,
    startedAt: number
  ): Observable<MapProductsRevalidationResult> {
    this.incrementDebug('datasetFetches');
    console.count('[MapCache] GET /api/products/map-lite');

    return this.fetchMapProductsForCache().pipe(
      map((products) => {
        this.debugLog(`[MapCache] products fetched: ${products.length}`);
        const entry = this.buildCacheEntry(products);
        const changed = entry.signature !== currentSignature;

        if (changed) {
          this.writeCacheEntry(entry);
          this.debugLog('[MapCache] home revalidation detected changes');
        } else {
          this.debugLog('[MapCache] home revalidation found no changes');
        }

        this.storeDuration('home-revalidate', this.now() - startedAt);

        return {
          products,
          changed
        };
      })
    );
  }

  private downloadProductsAndPersist(
    requestId: number,
    context: MapCacheFetchContext,
    startedAt: number
  ): Observable<MapProductLite[]> {
    this.incrementDebug('datasetFetches');
    console.count('[MapCache] GET /api/products');

    return this.http.get<any>(this.productsUrl).pipe(
      map((response) => this.normalizeMapLiteProducts(this.extractProducts(response))),
      tap((products) => {
        this.debugLog(`[MapCache] products fetched from /products: ${products.length}`);
        const entry = this.buildCacheEntry(products);
        this.writeCacheEntry(entry, requestId);
        this.storeDuration(context, this.now() - startedAt);
      })
    );
  }

  private fetchMapProductsForCache(): Observable<MapProductLite[]> {
    return this.http.get<any>(this.mapLiteUrl).pipe(
      map((response) => this.normalizeMapLiteProducts(this.extractProducts(response))),
      catchError((error) => {
        if (!this.shouldFallbackToLegacyProducts(error)) {
          return throwError(() => error);
        }

        this.debugLog('[MapCache] /products/map-lite unavailable, falling back to /products', error);
        console.count('[MapCache] GET /api/products (legacy fallback)');

        return this.http.get<any>(this.productsUrl).pipe(
          map((response) => this.normalizeMapLiteProducts(this.extractProducts(response)))
        );
      })
    );
  }

  private extractProducts(response: any): any[] {
    if (Array.isArray(response?.products)) {
      return response.products;
    }

    if (Array.isArray(response)) {
      return response;
    }

    return [];
  }

  private normalizeMapLiteProducts(products: any[]): MapProductLite[] {
    return (Array.isArray(products) ? products : []).reduce<MapProductLite[]>((acc, product) => {
      const id = String(product?.id || product?._id || product?.uid || '').trim();
      const coordinates = Array.isArray(product?.location?.coordinates)
        ? product.location.coordinates
        : [];
      const lat = Number(product?.lat ?? coordinates?.[1]);
      const lng = Number(product?.lng ?? coordinates?.[0]);
      const thumbnail = this.normalizeOptionalString(
        product?.thumbnail ||
        (Array.isArray(product?.media) && product.media.length > 0 ? product.media[0] : product?.image)
      );
      const has3D = typeof product?.has3D === 'boolean'
        ? product.has3D
        : Boolean(product?.model3d?.url || product?.model3d?.filename);

      if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return acc;
      }

      acc.push({
        id,
        name: String(product?.name || 'Sin nombre'),
        lat,
        lng,
        city: this.normalizeOptionalString(product?.city),
        province: this.normalizeOptionalString(product?.province),
        autonomous_community: this.normalizeOptionalString(product?.autonomous_community),
        category: this.normalizeOptionalString(product?.category),
        thumbnail,
        has3D
      });

      return acc;
    }, []);
  }

  private readCache(): MapProductsCacheEntry | null {
    if (!this.isBrowser()) {
      return null;
    }

    try {
      const raw = sessionStorage.getItem(MAP_PRODUCTS_CACHE_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<MapProductsCacheEntry>;
      const rawProducts = Array.isArray(parsed?.products) ? parsed.products : null;
      const products = this.normalizeMapLiteProducts(rawProducts || []);

      if (
        parsed?.version !== this.cacheVersion ||
        typeof parsed?.signature !== 'string' ||
        rawProducts === null ||
        (rawProducts.length > 0 && products.length === 0)
      ) {
        this.clearCache();
        return null;
      }

      return {
        version: this.cacheVersion,
        total: Number(parsed.total || products.length),
        lastUpdated: this.normalizeIsoDate(parsed.lastUpdated),
        signature: parsed.signature,
        cachedAt: this.normalizeIsoDate(parsed.cachedAt) || new Date().toISOString(),
        payloadBytes: Number(parsed.payloadBytes || this.measurePayloadSize(raw)),
        products
      };
    } catch (error) {
      this.clearCache();
      return null;
    }
  }

  private buildCacheEntry(products: MapProductLite[]): MapProductsCacheEntry {
    return {
      version: this.cacheVersion,
      total: products.length,
      lastUpdated: null,
      signature: this.buildSignature(products),
      cachedAt: new Date().toISOString(),
      payloadBytes: 0,
      products
    };
  }

  private writeCacheEntry(entry: MapProductsCacheEntry, requestId?: number): boolean {
    if (!this.isBrowser()) {
      return false;
    }

    if (requestId !== undefined && requestId !== this.requestSequence) {
      return false;
    }

    const serializableEntry: MapProductsCacheEntry = {
      ...entry,
      payloadBytes: 0
    };
    const firstPass = JSON.stringify(serializableEntry);
    const payloadBytes = this.measurePayloadSize(firstPass);
    const finalEntry: MapProductsCacheEntry = {
      ...serializableEntry,
      payloadBytes
    };
    const jsonString = JSON.stringify(finalEntry);
    const finalBytes = this.measurePayloadSize(jsonString);

    this.setDebugValue('lastCacheBytes', finalBytes);
    this.debugLog(
      `[MapCache] cache payload: ${this.formatBytes(finalBytes)} | products: ${entry.products.length}`
    );

    if (finalBytes > MAP_PRODUCTS_CACHE_MAX_BYTES) {
      this.incrementDebug('cacheWriteFailures');
      this.clearCache();
      console.warn(
        `[MapCache] cache not written: payload exceeds limit (${this.formatBytes(finalBytes)} > ${this.formatBytes(MAP_PRODUCTS_CACHE_MAX_BYTES)})`
      );
      return false;
    }

    try {
      sessionStorage.setItem(MAP_PRODUCTS_CACHE_STORAGE_KEY, jsonString);
      this.incrementDebug('cacheWrites');
      this.debugLog('[MapCache] cache written to sessionStorage');
      this.debugLog(`[MapCache] signature: ${finalEntry.signature}`);
      return true;
    } catch (error) {
      this.incrementDebug('cacheWriteFailures');
      this.clearCache();
      console.warn('[MapCache] failed to write cache to sessionStorage', error);
      return false;
    }
  }

  private buildSignature(products: MapProductLite[]): string {
    let hash = 0;

    for (const product of products) {
      const source = [
        product.id,
        product.name,
        product.city || '',
        product.province || '',
        product.autonomous_community || '',
        product.category || '',
        product.thumbnail || '',
        product.lat,
        product.lng,
        product.has3D ? '1' : '0'
      ].join('|');

      for (let index = 0; index < source.length; index += 1) {
        hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
      }
    }

    return `${products.length}:${Math.abs(hash)}`;
  }

  private normalizeIsoDate(value: unknown): string | null {
    if (!value) {
      return null;
    }

    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  private measurePayloadSize(payload: string): number {
    if (typeof Blob !== 'undefined') {
      return new Blob([payload]).size;
    }

    return new TextEncoder().encode(payload).length;
  }

  private formatBytes(bytes: number): string {
    const kb = bytes / 1024;
    const mb = bytes / (1024 * 1024);

    if (mb >= 1) {
      return `${mb.toFixed(2)} MB`;
    }

    return `${kb.toFixed(2)} KB`;
  }

  private shouldFallbackToLegacyProducts(error: any): boolean {
    const status = Number(error?.status || 0);
    const validationErrors = error?.error?.errors;
    const invalidIdError = validationErrors?.id?.msg === 'El id del producto no es válido';

    return status === 404 || status === 405 || status === 501 || (status === 400 && invalidIdError);
  }

  private storeDuration(context: MapCacheFetchContext, durationMs: number): void {
    const roundedDuration = Math.round(durationMs);

    if (context === 'warmUp') {
      this.setDebugValue('lastWarmUpMs', roundedDuration);
    }

    this.debugLog(`[MapCache] ${context} completed in ${roundedDuration}ms`);
  }

  private getDebugState(): Partial<MapCacheDebugState> | null {
    if (!this.isBrowser() || typeof window === 'undefined') {
      return null;
    }

    window.__mapCacheDebug = window.__mapCacheDebug || {};
    return window.__mapCacheDebug;
  }

  private incrementDebug(key: keyof MapCacheDebugState): void {
    const debugState = this.getDebugState();
    if (!debugState) {
      return;
    }

    const currentValue = Number(debugState[key] || 0);
    debugState[key] = currentValue + 1;
  }

  private setDebugValue(key: keyof MapCacheDebugState, value: number): void {
    const debugState = this.getDebugState();
    if (!debugState) {
      return;
    }

    debugState[key] = value;
  }

  private debugLog(message: string, extra?: unknown): void {
    if (extra === undefined) {
      console.debug(message);
      return;
    }

    console.debug(message, extra);
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId) && typeof sessionStorage !== 'undefined';
  }
}
