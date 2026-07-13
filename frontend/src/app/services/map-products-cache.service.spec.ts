import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  MAP_PRODUCTS_CACHE_MAX_BYTES,
  MAP_PRODUCTS_CACHE_STORAGE_KEY,
  MapProductLite,
  MapProductsCacheEntry,
  MapProductsCacheService
} from './map-products-cache.service';
import { buildApiUrl } from '../shared/api-base';

describe('MapProductsCacheService', () => {
  let service: MapProductsCacheService;
  let httpMock: HttpTestingController;

  const mapLiteUrl = buildApiUrl('products/map-lite');
  const productsUrl = buildApiUrl('products');

  beforeEach(() => {
    sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        MapProductsCacheService,
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    service = TestBed.inject(MapProductsCacheService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    sessionStorage.clear();
    httpMock.verify();
  });

  it('should download and persist lite products during warm up when cache is empty', () => {
    const products: MapProductLite[] = [
      {
        id: 'prod-1',
        name: 'Queso',
        lat: 38.34,
        lng: -0.48,
        category: 'Alimentación',
        thumbnail: 'https://example.com/queso.jpg',
        has3D: true
      }
    ];
    let received: MapProductLite[] | undefined;

    service.warmUpCache().subscribe((result) => {
      received = result;
    });

    httpMock.expectOne(mapLiteUrl).flush({ ok: true, products });

    const stored = JSON.parse(sessionStorage.getItem(MAP_PRODUCTS_CACHE_STORAGE_KEY) || '{}') as MapProductsCacheEntry;

    expect(received).toEqual(products);
    expect(stored.products).toEqual(products);
    expect(stored.total).toBe(1);
    expect(stored.payloadBytes).toBeGreaterThan(0);
  });

  it('should use sessionStorage directly in home when cache already exists', () => {
    const cachedProducts: MapProductLite[] = [
      { id: 'prod-1', name: 'Queso', lat: 38.34, lng: -0.48 }
    ];

    sessionStorage.setItem(
      MAP_PRODUCTS_CACHE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        total: 1,
        lastUpdated: null,
        signature: '1:123',
        cachedAt: '2026-03-23T10:16:00.000Z',
        payloadBytes: 256,
        products: cachedProducts
      } satisfies MapProductsCacheEntry)
    );

    let received: MapProductLite[] | undefined;

    service.getProductsForHome().subscribe((result) => {
      received = result;
    });

    httpMock.expectNone(mapLiteUrl);
    expect(received).toEqual([
      jasmine.objectContaining({ id: 'prod-1', name: 'Queso', lat: 38.34, lng: -0.48 })
    ]);
  });

  it('should reuse the in-flight warm-up request when home enters before cache is written', () => {
    const products: MapProductLite[] = [
      { id: 'prod-1', name: 'Queso', lat: 38.34, lng: -0.48 }
    ];
    let warmUpResult: MapProductLite[] | undefined;
    let homeResult: MapProductLite[] | undefined;

    service.warmUpCache().subscribe((result) => {
      warmUpResult = result;
    });

    service.getProductsForHome().subscribe((result) => {
      homeResult = result;
    });

    httpMock.expectOne(mapLiteUrl).flush({ ok: true, products });

    expect(warmUpResult).toEqual([
      jasmine.objectContaining({ id: 'prod-1', name: 'Queso', lat: 38.34, lng: -0.48 })
    ]);
    expect(homeResult).toEqual([
      jasmine.objectContaining({ id: 'prod-1', name: 'Queso', lat: 38.34, lng: -0.48 })
    ]);
  });

  it('should clear the cache if refresh after mutation fails', () => {
    sessionStorage.setItem(
      MAP_PRODUCTS_CACHE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        total: 1,
        lastUpdated: null,
        signature: '1:123',
        cachedAt: '2026-03-23T10:16:00.000Z',
        payloadBytes: 256,
        products: [{ id: 'prod-1', name: 'Queso', lat: 38.34, lng: -0.48 }]
      } satisfies MapProductsCacheEntry)
    );

    let received: MapProductsCacheEntry | null | undefined;

    service.refreshCacheAfterMutation().subscribe((result) => {
      received = result;
    });

    httpMock.expectOne(mapLiteUrl).flush(
      { ok: false },
      { status: 500, statusText: 'Server Error' }
    );

    expect(received).toBeNull();
    expect(sessionStorage.getItem(MAP_PRODUCTS_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('should revalidate the cache and report changes when the map dataset signature changes', () => {
    service.warmUpCache().subscribe();

    httpMock.expectOne(mapLiteUrl).flush({
      ok: true,
      products: [{ id: 'prod-1', name: 'Queso', lat: 38.34, lng: -0.48, category: 'Alimentación' }]
    });

    const previousEntry = JSON.parse(sessionStorage.getItem(MAP_PRODUCTS_CACHE_STORAGE_KEY) || '{}') as MapProductsCacheEntry;

    let changed: boolean | undefined;
    let received: MapProductLite[] | undefined;

    service.revalidateCache().subscribe((result) => {
      changed = result.changed;
      received = result.products;
    });

    httpMock.expectOne(mapLiteUrl).flush({
      ok: true,
      products: [{ id: 'prod-1', name: 'Queso', lat: 38.34, lng: -0.48, category: 'Madera y mueble' }]
    });

    const stored = JSON.parse(sessionStorage.getItem(MAP_PRODUCTS_CACHE_STORAGE_KEY) || '{}') as MapProductsCacheEntry;

    expect(changed).toBeTrue();
    expect(received).toEqual([
      jasmine.objectContaining({
        id: 'prod-1',
        name: 'Queso',
        lat: 38.34,
        lng: -0.48,
        category: 'Madera y mueble'
      })
    ]);
    expect(stored.products).toEqual([
      jasmine.objectContaining({
        id: 'prod-1',
        name: 'Queso',
        lat: 38.34,
        lng: -0.48,
        category: 'Madera y mueble'
      })
    ]);
    expect(stored.signature).not.toBe(previousEntry.signature);
  });

  it('should keep the existing cache when revalidation finds no dataset changes', () => {
    const cachedProducts = [{ id: 'prod-1', name: 'Queso', lat: 38.34, lng: -0.48 }];

    service.warmUpCache().subscribe();

    httpMock.expectOne(mapLiteUrl).flush({ ok: true, products: cachedProducts });

    const cachedEntry = JSON.parse(sessionStorage.getItem(MAP_PRODUCTS_CACHE_STORAGE_KEY) || '{}') as MapProductsCacheEntry;

    let changed: boolean | undefined;
    let received: MapProductLite[] | undefined;

    service.revalidateCache().subscribe((result) => {
      changed = result.changed;
      received = result.products;
    });

    httpMock.expectOne(mapLiteUrl).flush({ ok: true, products: cachedProducts });

    const stored = JSON.parse(sessionStorage.getItem(MAP_PRODUCTS_CACHE_STORAGE_KEY) || '{}') as MapProductsCacheEntry;

    expect(changed).toBeFalse();
    expect(received).toEqual([
      jasmine.objectContaining({ id: 'prod-1', name: 'Queso', lat: 38.34, lng: -0.48 })
    ]);
    expect(stored).toEqual(cachedEntry);
  });

  it('should skip writing the cache when payload exceeds the size threshold', () => {
    const hugeThumbnail = `https://example.com/${'a'.repeat(MAP_PRODUCTS_CACHE_MAX_BYTES)}`;
    const products: MapProductLite[] = [
      {
        id: 'prod-1',
        name: 'Producto enorme',
        lat: 38.34,
        lng: -0.48,
        thumbnail: hugeThumbnail
      }
    ];

    service.warmUpCache().subscribe();

    httpMock.expectOne(mapLiteUrl).flush({ ok: true, products });

    expect(sessionStorage.getItem(MAP_PRODUCTS_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('should download and persist products from /api/products during detail warm up', () => {
    const products = [
      {
        _id: 'prod-1',
        name: 'Queso',
        category: 'Alimentación',
        media: ['https://example.com/queso.jpg'],
        location: { coordinates: [-0.48, 38.34] },
        model3d: { filename: 'queso.glb' }
      }
    ];
    let received: MapProductLite[] | undefined;

    service.warmUpCacheFromProducts().subscribe((result) => {
      received = result;
    });

    httpMock.expectOne(productsUrl).flush({ ok: true, products });

    const stored = JSON.parse(sessionStorage.getItem(MAP_PRODUCTS_CACHE_STORAGE_KEY) || '{}') as MapProductsCacheEntry;

    expect(received).toEqual([
      {
        id: 'prod-1',
        name: 'Queso',
        lat: 38.34,
        lng: -0.48,
        category: 'Alimentación',
        thumbnail: 'https://example.com/queso.jpg',
        has3D: true
      }
    ]);
    expect(received).toBeDefined();
    expect(stored.products).toEqual(received!);
    expect(stored.total).toBe(1);
  });
});
