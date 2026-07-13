import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MapProductDetailsHydrationService } from './map-product-details-hydration.service';
import { MAP_PRODUCTS_CACHE_STORAGE_KEY, MapProductsCacheService } from './map-products-cache.service';
import { buildApiUrl } from '../shared/api-base';

describe('MapProductDetailsHydrationService', () => {
  let service: MapProductDetailsHydrationService;
  let httpMock: HttpTestingController;

  const batchDetailsUrl = buildApiUrl('products/batch-details');
  const productsUrl = buildApiUrl('products');

  const buildId = (index: number): string => index.toString(16).padStart(24, '0');
  const buildApiProduct = (id: string, name: string) => ({
    _id: id,
    name,
    category: 'Alimentación',
    description: `${name} description`,
    resumen: `${name} resumen`,
    historia_origen: `${name} historia`,
    importancia_cultural: `${name} importancia`,
    proceso_elaboracion: `${name} proceso`,
    materias_primas: `${name} materias`,
    tiempo_elaboracion: `${name} tiempo`,
    certificaciones_protecciones: 'DOP',
    province: 'Alicante',
    autonomous_community: 'Comunidad Valenciana',
    address_text: 'Calle Falsa 123',
    media: [`https://example.com/${id}.jpg`],
    location: { coordinates: [-0.48, 38.34] },
    owner: {
      name: 'Ana',
      surname: 'García',
      company_name: 'Taller Noma'
    }
  });

  beforeEach(() => {
    sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        MapProductDetailsHydrationService,
        MapProductsCacheService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    service = TestBed.inject(MapProductDetailsHydrationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    service.clear();
    sessionStorage.clear();
    httpMock.verify();
  });

  it('hydrates products in sequential batches', () => {
    const ids = Array.from({ length: 21 }, (_, index) => buildId(index + 1));

    service.startHydration(ids);

    const firstBatchRequest = httpMock.expectOne(batchDetailsUrl);
    expect(firstBatchRequest.request.method).toBe('POST');
    expect(firstBatchRequest.request.body.ids).toEqual(ids.slice(0, 20));
    firstBatchRequest.flush({
      ok: true,
      products: ids.slice(0, 20).map((id, index) => buildApiProduct(id, `Producto ${index + 1}`))
    });

    const secondBatchRequest = httpMock.expectOne(batchDetailsUrl);
    expect(secondBatchRequest.request.body.ids).toEqual([ids[20]]);
    secondBatchRequest.flush({
      ok: true,
      products: [buildApiProduct(ids[20], 'Producto 21')]
    });

    expect(service.getHydratedProduct(ids[0])?.title).toBe('Producto 1');
    expect(service.getHydratedProduct(ids[20])?.title).toBe('Producto 21');
  });

  it('pauses the active batch, prioritizes a clicked product, and resumes hydration', () => {
    const ids = Array.from({ length: 21 }, (_, index) => buildId(index + 1));
    let resolvedTitle: string | undefined;

    service.startHydration(ids);

    const activeBatchRequest = httpMock.expectOne(batchDetailsUrl);
    service.getOrFetchPriorityProduct(ids[20]).subscribe((product) => {
      resolvedTitle = product.title;
    });

    expect(activeBatchRequest.cancelled).toBeTrue();

    const priorityRequest = httpMock.expectOne(batchDetailsUrl);
    expect(priorityRequest.request.body.ids).toEqual([ids[20]]);
    priorityRequest.flush({
      ok: true,
      products: [buildApiProduct(ids[20], 'Producto prioritario')]
    });

    expect(resolvedTitle).toBe('Producto prioritario');

    const resumedBatchRequest = httpMock.expectOne(batchDetailsUrl);
    expect(resumedBatchRequest.request.body.ids).toEqual(ids.slice(0, 20));
    resumedBatchRequest.flush({
      ok: true,
      products: ids.slice(0, 20).map((id, index) => buildApiProduct(id, `Producto ${index + 1}`))
    });
  });

  it('returns a hydrated product without issuing a new request', () => {
    const id = buildId(1);

    service.startHydration([id]);

    const batchRequest = httpMock.expectOne(batchDetailsUrl);
    batchRequest.flush({
      ok: true,
      products: [buildApiProduct(id, 'Producto cacheado')]
    });

    let resolvedTitle: string | undefined;
    service.getOrFetchPriorityProduct(id).subscribe((product) => {
      resolvedTitle = product.title;
    });

    httpMock.expectNone(batchDetailsUrl);
    expect(resolvedTitle).toBe('Producto cacheado');
  });

  it('warms the full products dataset and primes the map cache', () => {
    const id = buildId(1);

    service.warmUpFullProductsDataset();

    const request = httpMock.expectOne(productsUrl);
    expect(request.request.method).toBe('GET');
    request.flush({
      ok: true,
      products: [buildApiProduct(id, 'Producto completo')]
    });

    expect(service.getHydratedProduct(id)?.title).toBe('Producto completo');

    const storedCache = JSON.parse(sessionStorage.getItem(MAP_PRODUCTS_CACHE_STORAGE_KEY) || '{}');
    expect(storedCache.products?.[0]?.id).toBe(id);
  });
});
