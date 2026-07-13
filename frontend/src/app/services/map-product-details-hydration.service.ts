import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, defer, of, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { buildApiUrl } from '../shared/api-base';
import { mapApiProductToModalData } from './product-modal-data.mapper';
import type { ProductModalData } from '../pages/home/product-modal/product-modal';
import { MapProductsCacheService } from './map-products-cache.service';

type BatchDetailsResponse = {
  ok?: boolean;
  products?: any[];
};

@Injectable({
  providedIn: 'root'
})
export class MapProductDetailsHydrationService {
  private readonly batchDetailsUrl = buildApiUrl('products/batch-details');
  private readonly productsUrl = buildApiUrl('products');
  private readonly batchSize = 20;

  private readonly hydratedProducts = new Map<string, ProductModalData>();
  private pendingQueue: string[] = [];
  private pendingQueueSet = new Set<string>();
  private currentBatchIds: string[] = [];

  private batchRequestSubscription: { unsubscribe: () => void } | null = null;
  private priorityRequestSubscription: { unsubscribe: () => void } | null = null;
  private fullProductsWarmUpSubscription: { unsubscribe: () => void } | null = null;
  private priorityRequestToken = 0;
  private activePriorityProductId: string | null = null;

  private hydrationEnabled = false;
  private hydrationPaused = false;
  private hydrationCompletionLogged = false;
  private fullProductsWarmUpCompleted = false;
  private readonly hydratedUpdatesSubject = new Subject<void>();

  public readonly hydratedUpdates$ = this.hydratedUpdatesSubject.asObservable();

  constructor(
    private http: HttpClient,
    private mapProductsCacheService: MapProductsCacheService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  warmUpFullProductsDataset(): void {
    if (!this.isBrowser() || this.fullProductsWarmUpCompleted || this.fullProductsWarmUpSubscription) {
      return;
    }

    this.fullProductsWarmUpSubscription = this.http.get<any>(this.productsUrl).pipe(
      map((response) => (Array.isArray(response?.products) ? response.products : []))
    ).subscribe({
      next: (products) => {
        this.mapProductsCacheService.primeCacheFromProducts(products);
        const hydratedCount = this.storeHydratedProducts(products);
        this.fullProductsWarmUpCompleted = true;
        console.debug(`[MapDetails] full dataset hydrated from /products: ${hydratedCount}`);
      },
      error: (error) => {
        console.warn('[MapDetails] full dataset warm-up failed', error);
        this.fullProductsWarmUpSubscription = null;
      },
      complete: () => {
        this.fullProductsWarmUpSubscription = null;
      }
    });
  }

  startHydration(ids: string[]): void {
    if (!this.isBrowser()) {
      return;
    }

    const queued = this.enqueueIds(ids);
    this.hydrationEnabled = true;
    this.hydrationCompletionLogged = false;

    if (queued > 0) {
      console.debug(`[MapDetails] hydration started (${this.pendingQueue.length} pending)`);
    }

    this.processNextBatch();
  }

  pauseHydration(reason?: string): void {
    if (!this.isBrowser()) {
      return;
    }

    this.hydrationPaused = true;
    if (reason) {
      console.debug(reason);
    }

    if (!this.batchRequestSubscription) {
      return;
    }

    const batchIdsToRequeue = [...this.currentBatchIds];
    const activeRequest = this.batchRequestSubscription;

    this.batchRequestSubscription = null;
    this.currentBatchIds = [];
    activeRequest.unsubscribe();
    this.enqueueIds(batchIdsToRequeue, true);
  }

  resumeHydration(): void {
    if (!this.isBrowser()) {
      return;
    }

    const wasPaused = this.hydrationPaused;
    this.hydrationPaused = false;

    if (wasPaused) {
      console.debug('[MapDetails] hydration resumed');
    }

    this.processNextBatch();
  }

  getHydratedProduct(id: string): ProductModalData | null {
    const normalizedId = this.normalizeId(id);
    if (!normalizedId) {
      return null;
    }

    return this.hydratedProducts.get(normalizedId) || null;
  }

  getOrFetchPriorityProduct(id: string): Observable<ProductModalData> {
    return defer(() => {
      if (!this.isBrowser()) {
        return throwError(() => new Error('Hydration service is only available in browser'));
      }

      const normalizedId = this.normalizeId(id);
      if (!normalizedId) {
        return throwError(() => new Error('Missing product id for priority hydration'));
      }

      const cachedProduct = this.getHydratedProduct(normalizedId);
      if (cachedProduct) {
        return of(cachedProduct);
      }

      return new Observable<ProductModalData>((observer) => {
        this.cancelActivePriorityRequest(false);
        this.pauseHydration(`[MapDetails] hydration paused for priority product: ${normalizedId}`);

        const requestToken = ++this.priorityRequestToken;
        this.activePriorityProductId = normalizedId;

        const requestSubscription = this.fetchBatchDetails([normalizedId]).subscribe({
          next: (products) => {
            if (this.priorityRequestToken !== requestToken) {
              return;
            }

            const resolvedProduct = products.find((product) => this.getProductId(product) === normalizedId) || null;
            if (!resolvedProduct) {
              observer.error(new Error(`Product ${normalizedId} not found in priority hydration`));
              this.completePriorityRequest(requestToken, true);
              return;
            }

            this.storeHydratedProduct(resolvedProduct);
            console.debug(`[MapDetails] priority product fetched: ${normalizedId}`);
            observer.next(resolvedProduct);
            observer.complete();
            this.completePriorityRequest(requestToken, true);
          },
          error: (error) => {
            if (this.priorityRequestToken !== requestToken) {
              return;
            }

            observer.error(error);
            this.completePriorityRequest(requestToken, true);
          }
        });

        this.priorityRequestSubscription = requestSubscription;

        return () => {
          if (this.priorityRequestToken !== requestToken) {
            return;
          }

          this.cancelActivePriorityRequest(true);
        };
      });
    });
  }

  clear(): void {
    this.cancelActivePriorityRequest(false);

    if (this.batchRequestSubscription) {
      this.batchRequestSubscription.unsubscribe();
      this.batchRequestSubscription = null;
    }

    if (this.fullProductsWarmUpSubscription) {
      this.fullProductsWarmUpSubscription.unsubscribe();
      this.fullProductsWarmUpSubscription = null;
    }

    this.hydratedProducts.clear();
    this.pendingQueue = [];
    this.pendingQueueSet.clear();
    this.currentBatchIds = [];
    this.activePriorityProductId = null;
    this.hydrationEnabled = false;
    this.hydrationPaused = false;
    this.hydrationCompletionLogged = false;
    this.fullProductsWarmUpCompleted = false;
  }

  private processNextBatch(): void {
    if (!this.isBrowser() || !this.hydrationEnabled || this.hydrationPaused) {
      return;
    }

    if (this.batchRequestSubscription || this.priorityRequestSubscription) {
      return;
    }

    if (this.pendingQueue.length === 0) {
      if (!this.hydrationCompletionLogged) {
        console.debug('[MapDetails] hydration completed');
        this.hydrationCompletionLogged = true;
      }
      return;
    }

    const batchIds = this.takeNextBatchIds();
    if (batchIds.length === 0) {
      if (!this.hydrationCompletionLogged) {
        console.debug('[MapDetails] hydration completed');
        this.hydrationCompletionLogged = true;
      }
      return;
    }

    this.currentBatchIds = batchIds;

    let batchRequest: { unsubscribe: () => void } | null = null;
    batchRequest = this.fetchBatchDetails(batchIds).subscribe({
      next: (products) => {
        if (this.batchRequestSubscription !== batchRequest) {
          return;
        }

        products.forEach((product) => this.storeHydratedProduct(product));
        console.debug(`[MapDetails] batch fetched: ${products.length}`);
      },
      error: (error) => {
        if (this.batchRequestSubscription !== batchRequest) {
          return;
        }

        console.error('[MapDetails] hydration batch failed', error);
        this.batchRequestSubscription = null;
        this.currentBatchIds = [];
        this.pendingQueue = [];
        this.pendingQueueSet.clear();
        this.hydrationEnabled = false;
      },
      complete: () => {
        if (this.batchRequestSubscription !== batchRequest) {
          return;
        }

        this.batchRequestSubscription = null;
        this.currentBatchIds = [];
        this.processNextBatch();
      }
    });

    this.batchRequestSubscription = batchRequest;
  }

  private fetchBatchDetails(ids: string[]): Observable<ProductModalData[]> {
    return this.http.post<BatchDetailsResponse>(this.batchDetailsUrl, { ids }).pipe(
      map((response) => {
        const products = Array.isArray(response?.products) ? response.products : [];

        return products
          .map((product) => mapApiProductToModalData(product))
          .filter((product): product is ProductModalData => Boolean(product));
      })
    );
  }

  private storeHydratedProducts(products: any[]): number {
    let storedCount = 0;

    for (const product of Array.isArray(products) ? products : []) {
      const mappedProduct = mapApiProductToModalData(product);
      if (!mappedProduct) {
        continue;
      }

      this.storeHydratedProduct(mappedProduct);
      storedCount += 1;
    }

    return storedCount;
  }

  private storeHydratedProduct(product: ProductModalData): void {
    const productId = this.getProductId(product);
    if (!productId) {
      return;
    }

    this.hydratedProducts.set(productId, product);
    this.removePendingId(productId);
    this.hydratedUpdatesSubject.next();
  }

  private takeNextBatchIds(): string[] {
    const batchIds: string[] = [];

    while (batchIds.length < this.batchSize && this.pendingQueue.length > 0) {
      const nextId = this.pendingQueue.shift();
      if (!nextId) {
        continue;
      }

      this.pendingQueueSet.delete(nextId);

      if (this.hydratedProducts.has(nextId)) {
        continue;
      }

      batchIds.push(nextId);
    }

    return batchIds;
  }

  private enqueueIds(ids: string[], prepend: boolean = false): number {
    const normalizedIds: string[] = [];

    for (const rawId of ids) {
      const normalizedId = this.normalizeId(rawId);
      if (!normalizedId || this.shouldSkipQueueId(normalizedId)) {
        continue;
      }

      this.pendingQueueSet.add(normalizedId);
      normalizedIds.push(normalizedId);
    }

    if (normalizedIds.length === 0) {
      return 0;
    }

    this.pendingQueue = prepend
      ? [...normalizedIds, ...this.pendingQueue]
      : [...this.pendingQueue, ...normalizedIds];

    return normalizedIds.length;
  }

  private shouldSkipQueueId(id: string): boolean {
    return (
      this.hydratedProducts.has(id) ||
      this.pendingQueueSet.has(id) ||
      this.currentBatchIds.includes(id) ||
      this.activePriorityProductId === id
    );
  }

  private removePendingId(id: string): void {
    this.pendingQueueSet.delete(id);
    this.pendingQueue = this.pendingQueue.filter((queuedId) => queuedId !== id);
  }

  private cancelActivePriorityRequest(resumeHydration: boolean): void {
    if (!this.priorityRequestSubscription) {
      if (resumeHydration) {
        this.resumeHydration();
      }
      return;
    }

    const activeRequest = this.priorityRequestSubscription;
    this.priorityRequestSubscription = null;
    this.activePriorityProductId = null;
    this.priorityRequestToken += 1;
    activeRequest.unsubscribe();

    if (resumeHydration) {
      this.resumeHydration();
    }
  }

  private completePriorityRequest(requestToken: number, resumeHydration: boolean): void {
    if (this.priorityRequestToken !== requestToken) {
      return;
    }

    this.priorityRequestSubscription = null;
    this.activePriorityProductId = null;
    this.priorityRequestToken += 1;

    if (resumeHydration) {
      this.resumeHydration();
    }
  }

  private getProductId(product: ProductModalData | null | undefined): string | null {
    const id = String(product?.id || product?.uid || product?._id || '').trim();
    return id || null;
  }

  private normalizeId(id: string | null | undefined): string | null {
    const normalizedId = String(id || '').trim();
    return normalizedId || null;
  }

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }
}
