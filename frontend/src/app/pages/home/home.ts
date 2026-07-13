import { 
    Component, 
    ViewChild, 
    ElementRef, 
    AfterViewInit, 
    OnDestroy, 
    NgZone, 
    Inject, 
    PLATFORM_ID,
    CUSTOM_ELEMENTS_SCHEMA,
    ChangeDetectorRef,
    OnInit
} from '@angular/core';
import {Title, Meta} from '@angular/platform-browser';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import * as THREE from 'three';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MotorGraficoFacade } from './engine/motor-grafico-facade';
import { UtilsGeo } from './engine/core/utils-geo';
import { Navbar } from './../../commons/navbar/navbar';
// import { EngineSwitchComponent } from '../../commons/engine-switch/engine-switch';
import { ChatbotComponent, ChatbotProduct, ChatbotMapFilter } from './chatbot/chatbot';
import { ProductModalComponent, ProductModalData } from './product-modal/product-modal';
import { InstructionsModalComponent } from './instructions-modal/instructions-modal';
import { CustomTooltipDirective } from '../../shared/custom-tooltip.directive';
import { buildApiUrl } from '../../shared/api-base';
import { CertificationKey, MapSearchFilters, MapSearchOverlayComponent } from './map-search/map-search-overlay';
import { PinPreviewCardComponent } from './pin-preview-card/pin-preview-card';
import { ClusterPreviewCardComponent } from './cluster-preview-card/cluster-preview-card';
import { PinHoverEvent, ClusterHoverEvent } from './engine/core/three/pin-manager';
import { GeolocationService } from '../../services/geolocation.service';
import { OverlapPanelComponent, OverlapProduct } from './overlap-panel/overlap-panel';
import { MapProductLite, MapProductsCacheService } from '../../services/map-products-cache.service';
import { MapProductDetailsHydrationService } from '../../services/map-product-details-hydration.service';
import { mapApiProductToModalData } from '../../services/product-modal-data.mapper';
import { AuthService } from '../../layouts/auth-layout/auth.service';
import { FavoritesService } from '../../services/favorites.service';

interface LocationData {
    name: string;
    lat: number;
    lon: number;
    city?: string;
    province?: string;
    autonomous_community?: string;
    product?: (ProductModalData & { id?: string; uid?: string; _id?: string; isLite?: boolean; thumbnail?: string; has3D?: boolean });
}

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, Navbar, /* EngineSwitchComponent, */ ChatbotComponent, ProductModalComponent, MapSearchOverlayComponent, InstructionsModalComponent, CustomTooltipDirective, PinPreviewCardComponent, ClusterPreviewCardComponent, OverlapPanelComponent], 
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    templateUrl: './home.html',
    styleUrl: './home.css',
    host: {
        ngSkipHydration: 'true',
    },
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy { 
    
    @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef;

    @ViewChild(MapSearchOverlayComponent) private mapSearchOverlay?: MapSearchOverlayComponent;
    
    public statusMessage: string = 'Estado: 🔴 Esperando cliente...';
    public isMapLoading: boolean = true;
    
    // Propiedades para el modal
    public modalVisible: boolean = false;
    public selectedProduct: ProductModalData | null = null;

    // Propiedades para el modal de instrucciones
    public showInstructions: boolean = false;

    // --- OVERLAP PANEL (pines solapados) ---
    public overlapPanelVisible: boolean = false;
    public overlapProducts: OverlapProduct[] = [];

    private readonly productsUrl = buildApiUrl('products'); 

    private locationsData: LocationData[] = [];
    private allLocationsData: LocationData[] = [];

    public activeMapFilters: MapSearchFilters = {
        query: '',
        categories: [],
        proximityKm: 50,
        certifications: [],
        favoritesOnly: false,
        userLat: null,
        userLon: null
    };

    public isLoggedIn = false;

    // --- HOVER PREVIEW ---
    public pinHoverEvent: PinHoverEvent | null = null;
    public clusterHoverEvent: ClusterHoverEvent | null = null;
    /** Bloquea el hover del cluster hasta que el ratón lo abandone y vuelva a entrar */
    private suppressClusterHoverUntilLeave: boolean = false;
    /** Listener de pointerdown en el mapa para cerrar el overlap panel al interactuar */
    private _mapPointerDownHandler: ((e: PointerEvent) => void) | null = null;
    private hoverFrameId: number = 0;
    private clusterHoverFrameId: number = 0;

    private pendingProductId: string | null = null;
    private pendingCategoryPreselect: string | null = null;
    private detailsResolutionSubscription: Subscription | null = null;
    private mapCacheRevalidationSubscription: Subscription | null = null;
    private hydrationUpdatesSubscription: Subscription | null = null;
    private authStateSubscription: Subscription | null = null;
    private favoritesChangedSubscription: Subscription | null = null;
    private mapBootStarted: boolean = false;
    private mapDataReady: boolean = false;
    private mapViewReady: boolean = false;
    private mapEngineInitialized: boolean = false;
    private mapDetailsHydrationStarted: boolean = false;
    private mapCacheRevalidationIntervalId: number | null = null;
    private readonly mapCacheRevalidationIntervalMs = 5_000;
    private favoritesLoaded = false;
    private favoritesLoading = false;
    private favoriteProductIds = new Set<string>();
    public engineType: 'three' | 'opengl' = 'opengl';
    public switchingEngine = false;
    public viewMode: '2d' | '3d' = '2d';

    constructor(
        private engineFacade: MotorGraficoFacade,
        private ngZone: NgZone, 
        private cdr: ChangeDetectorRef,
        private http: HttpClient,
        private mapProductsCacheService: MapProductsCacheService,
        private mapProductDetailsHydrationService: MapProductDetailsHydrationService,
        private authService: AuthService,
        private favoritesService: FavoritesService,
        private route: ActivatedRoute,
        private router: Router,
        private titleService: Title,
        private metaService: Meta,
        @Inject(PLATFORM_ID) private platformId: Object 
    ) {} 

    ngOnInit(): void {
        this.titleService.setTitle("Noma - Mapa Interactivo"); 

        this.authStateSubscription = this.authService.isLoggedIn$.subscribe((loggedIn) => {
            this.isLoggedIn = loggedIn;

            if (loggedIn) {
                this.refreshFavoriteProductIds();
                return;
            }

            this.favoriteProductIds.clear();
            this.favoritesLoaded = false;
            this.favoritesLoading = false;

            if (this.activeMapFilters.favoritesOnly) {
                this.activeMapFilters = {
                    ...this.activeMapFilters,
                    favoritesOnly: false
                };
                this.mapSearchOverlay?.deactivateFavoritesOnly();
            }

            this.applyMapFiltersToThreeEngine();
            this.cdr.markForCheck();
        });

        this.favoritesChangedSubscription = this.favoritesService.favoritesChanged$.subscribe(() => {
            if (!this.isLoggedIn) {
                return;
            }
            this.refreshFavoriteProductIds(true);
        });

        this.metaService.updateTag({ 
            name: 'description', 
            content: 'Noma ofrece un mapa interactivo para productos artesanales, permitiendo descubrir artesanos locales y patrimonio artesanal con denominación de origen.'
        });

        // Si venimos desde un perfil de artesano: /home?product=<slug>
        const qp = this.route.snapshot.queryParamMap.get('product');
        this.pendingProductId = qp ? String(qp) : null;

        // Si venimos desde la ficha de producto (estado de navegación): preselección de categoría
        const navState = (typeof history !== 'undefined' ? history.state : {}) as Record<string, unknown>;
        this.pendingCategoryPreselect = (navState?.['preselectedCategory'] as string) || null;

        if (isPlatformBrowser(this.platformId)) {
            this.statusMessage = 'Cargando mapa...';
            this.isMapLoading = true;
            this.bootMapData();
        }
    }

    ngAfterViewInit(): void {
        if (!isPlatformBrowser(this.platformId)) return;

        this.mapViewReady = true;
        this.cdr.detectChanges();
        this.tryInitializeMap();
    }

    private bootMapData(): void {
        if (this.mapBootStarted) {
            return;
        }

        this.mapBootStarted = true;
        const bootStartedAt = this.now();

        this.mapProductsCacheService.getProductsForHome().subscribe({
            next: (rawProducts: MapProductLite[]) => {
                const normalizedProducts = Array.isArray(rawProducts) ? rawProducts : [];
                const transformStartedAt = this.now();

                if (normalizedProducts.length === 0) {
                    this.statusMessage = 'No hay productos para mostrar.';
                    this.isMapLoading = false;
                    this.cdr.detectChanges();
                    return;
                }

                this.locationsData = this.buildLocationsFromMapProducts(normalizedProducts);
                this.allLocationsData = [...this.locationsData];
                this.mapDataReady = true;

                const transformDuration = Math.round(this.now() - transformStartedAt);
                this.storeMapDebugMetric('lastTransformMs', transformDuration);
                console.debug(`[MapCache] products -> locationsData completed in ${transformDuration}ms`);
                console.debug(`[MapCache] home data ready in ${Math.round(this.now() - bootStartedAt)}ms`);
                this.startBackgroundMapCacheRevalidation();

                if (this.locationsData.length === 0) {
                    this.statusMessage = 'No hay puntos válidos para pintar.';
                    this.isMapLoading = false;
                    this.cdr.detectChanges();
                    return;
                }

                this.tryInitializeMap();
            },
            error: (error) => {
                console.error('❌ Error cargando productos del mapa:', error);
                this.statusMessage = 'Error cargando datos del mapa.';
                this.isMapLoading = false;
                this.cdr.detectChanges();
            }
        });
    }

    private tryInitializeMap(): void {
        if (!this.mapViewReady || !this.mapDataReady || this.mapEngineInitialized || this.locationsData.length === 0) {
            return;
        }

        this.mapEngineInitialized = true;
        this.initThreeJS();
    }

    public onMapFiltersChanged(filters: MapSearchFilters): void {
        this.activeMapFilters = filters;

        if (filters.favoritesOnly && this.isLoggedIn && !this.favoritesLoaded && !this.favoritesLoading) {
            this.refreshFavoriteProductIds();
        }

        this.applyMapFiltersToThreeEngine();
    }

    public onDeactivateProximity(): void {
        this.mapSearchOverlay?.deactivateProximity();
    }

    public onOpenProximityPanel(): void {
        this.mapSearchOverlay?.openProximityPanel();
    }

    private normalizeText(value: unknown): string {
        return `${value ?? ''}`
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    private normalizeCertificationText(value: unknown): string {
        return this.normalizeText(value)
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private hasCertification(rawValue: unknown, certification: CertificationKey): boolean {
        const normalized = this.normalizeCertificationText(rawValue);
        if (!normalized) return false;

        const aliases: Record<CertificationKey, string[]> = {
            DO: ['do', 'denominacion de origen'],
            DOP: ['dop', 'denominacion de origen protegida'],
            IGP: ['igp', 'indicacion geografica protegida'],
            IGA: ['iga', 'indicacion geografica artesanal'],
            ARTESANIA_GARANTIZADA: ['artesania garantizada']
        };

        return aliases[certification].some((alias) => {
            const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(^|\\s)${escapedAlias}(\\s|$)`).test(normalized);
        });
    }

    private getCertificationRawValue(loc: any): unknown {
        const productId = this.getProductIdValue(loc?.product);
        const hydrated = productId ? this.mapProductDetailsHydrationService.getHydratedProduct(productId) : null;
        return loc?.product?.certificaciones_protecciones || hydrated?.certificaciones_protecciones || '';
    }

    private applyMapFiltersToThreeEngine(): void {
        const base = (this.allLocationsData?.length ? this.allLocationsData : this.locationsData) ?? [];
        const q = this.normalizeText(this.activeMapFilters.query);
        const categoryMap: Record<string, string> = {
            agroalimentario: 'Alimentación',
            textil: 'Textil',
            barro_alfareria: 'Barro y Alfarería',
            madera_mueble: 'Madera y mueble',
            otros: 'Otros'
        };
        const allowedCategories = new Set(
            (this.activeMapFilters.categories || []).map((key) => this.normalizeText(categoryMap[key] || key))
        );

        let filtered = [...base];

        if (q) {
            filtered = filtered.filter((loc: any) => {
                const product = loc?.product || {};
                const productName = this.normalizeText(product.title || product.name || loc?.name);
                const ownerName = this.normalizeText(
                    product.owner_name ||
                    product.owner?.company_name ||
                    [product.owner?.name, product.owner?.surname].filter(Boolean).join(' ')
                );
                return productName.includes(q) || ownerName.includes(q);
            });
        }

        // Certificaciones (si existe campo en producto)
        if (this.activeMapFilters.certifications?.length) {
            const hasCertificationData = filtered.some((loc: any) => Boolean(this.normalizeCertificationText(this.getCertificationRawValue(loc))));
            if (hasCertificationData) {
                const wanted = new Set(this.activeMapFilters.certifications);
                filtered = filtered.filter((loc: any) => {
                    const raw = this.getCertificationRawValue(loc);
                    return Array.from(wanted).some((certification) => this.hasCertification(raw, certification));
                });
            } else {
                console.debug('[MapCache] certification filters skipped: current map dataset is map-lite');
            }
        }

        if (this.activeMapFilters.favoritesOnly && this.isLoggedIn) {
            filtered = filtered.filter((loc: any) => {
                const productId = this.getProductIdValue(loc?.product);
                return Boolean(productId && this.favoriteProductIds.has(productId));
            });
        }

        if (allowedCategories.size > 0) {
            filtered = filtered.filter((loc: any) => {
                const product = loc?.product || {};
                const category = this.normalizeText(product.category || product.categoria);
                return category && allowedCategories.has(category);
            });
        }

        // Proximidad (requiere ubicación del usuario — Haversine)
        const { userLat, userLon, proximityKm } = this.activeMapFilters;
        if (userLat !== null && userLon !== null) {
            filtered = filtered.filter((loc: any) => {
                const locLat = loc?.lat;
                const locLon = loc?.lon;
                if (locLat == null || locLon == null) return false;
                const distKm = GeolocationService.haversineKm(userLat, userLon, locLat, locLon);
                return distKm <= proximityKm;
            });
        }

        // Actualizamos pines SOLO si el motor actual soporta setLocations() (Three.js lo implementa).
        this.engineFacade.setLocations(filtered as any[]);
    }

    private initThreeJS() {
        this.statusMessage = 'Cargando mapa...';
        this.cdr.detectChanges();

        const engineStartedAt = this.now();

        this.ngZone.runOutsideAngular(() => {
            void (async () => {
                try {
                    if (!this.mapContainer) {
                        return;
                    }

                    const containerElement = this.mapContainer.nativeElement as HTMLElement;
                    await this.engineFacade.initEngine(
                        containerElement, 
                        this.locationsData,
                        (product) => this.showProductModal(product),
                        () => this.hideProductModal(),
                        (products) => this.showOverlapPanel(products)
                    );

                    const engineDuration = Math.round(this.now() - engineStartedAt);
                    this.storeMapDebugMetric('lastEngineInitMs', engineDuration);
                    console.debug(`[MapCache] engine.init completed in ${engineDuration}ms`);

                    // Configurar hover preview callback
                    this.setupPinHoverPreview();

                    // Listener vacío — el panel persiste hasta que el usuario lo cierre
                    // manualmente (botón X) o abra una ficha de producto
                    this._mapPointerDownHandler = () => {};
                    containerElement.addEventListener('pointerdown', this._mapPointerDownHandler);

                    // Aplicamos filtros actuales (por si el usuario ya interactuó con el buscador)
                    this.applyMapFiltersToThreeEngine();
                    this.engineType = 'opengl'; // valor inicial del switch

                    // Si venimos de una ficha de producto, preseleccionamos la categoría en el overlay
                    if (this.pendingCategoryPreselect) {
                        const cat = this.pendingCategoryPreselect;
                        this.pendingCategoryPreselect = null;
                        this.ngZone.run(() => {
                            this.mapSearchOverlay?.preselectCategory(cat);
                        });
                    }

                    // Si hay un producto pendiente en la URL, lo abrimos cuando el motor ya está inicializado.
                    const hasPendingProduct = Boolean(this.pendingProductId);
                    if (hasPendingProduct) {
                        const productId = this.pendingProductId!;
                        this.pendingProductId = null;
                        this.openProductFromUrl(productId);
                    } else {
                        this.engineFacade.startHomeIntro();
                    }
                    
                    this.ngZone.run(() => {
                        if (!hasPendingProduct) {
                            this.viewMode = '3d';
                        }
                        this.startBackgroundDetailsHydration();
                        this.isMapLoading = false;
                        this.statusMessage = `${this.locationsData.length} productos en el mapa.`;
                        this.cdr.detectChanges();
                    });
                } catch (error) {
                    console.error('❌ Error en el motor:', error);
                    this.mapEngineInitialized = false;
                    this.ngZone.run(() => {
                         this.isMapLoading = false;
                         this.statusMessage = 'Error crítico en el mapa 3D.';
                    });
                }
            })();
        });
    }

    /** Click en la mini-ficha: mismo comportamiento que click en el pin (zoom + modal) */
    public onPreviewCardClick(product: any): void {
        this.showProductModalFromChatbot(product);
    }

    /** Click en un producto del cluster preview */
    public onClusterPreviewCardClick(product: any): void {
        this.showProductModalFromChatbot(product);
    }

    private setupPinHoverPreview(): void {
        const pinManager = this.engineFacade.getPinManager();
        if (!pinManager || typeof pinManager.onHoverChange !== 'function') return;

        // Hover de pines individuales
        pinManager.onHoverChange((event: PinHoverEvent | null) => {
            // Throttle con rAF para no saturar change detection
            if (this.hoverFrameId) cancelAnimationFrame(this.hoverFrameId);

            this.hoverFrameId = requestAnimationFrame(() => {
                this.hoverFrameId = 0;
                this.ngZone.run(() => {
                    if (this.switchingEngine) return;
                    this.pinHoverEvent = event ? { ...event } : null;
                    this.cdr.markForCheck();
                });
            });
        });

        // Hover de clusters (agrupaciones)
        if (typeof pinManager.onClusterHoverChange === 'function') {
            pinManager.onClusterHoverChange((event: ClusterHoverEvent | null) => {
                // Throttle con rAF para no saturar change detection
                if (this.clusterHoverFrameId) cancelAnimationFrame(this.clusterHoverFrameId);

                this.clusterHoverFrameId = requestAnimationFrame(() => {
                    this.clusterHoverFrameId = 0;
                    this.ngZone.run(() => {
                        if (this.switchingEngine) return;
                        // Si se cerró el panel y el ratón aún no ha salido del cluster, suprimir
                        if (this.suppressClusterHoverUntilLeave) {
                            if (event === null) {
                                // El ratón salió: levantar la supresión
                                this.suppressClusterHoverUntilLeave = false;
                            }
                            return;
                        }
                        this.clusterHoverEvent = event ? { ...event } : null;
                        this.cdr.markForCheck();
                    });
                });
            });
        }
    }

    private clearHoverPreviews(): void {
        if (this.hoverFrameId) {
            cancelAnimationFrame(this.hoverFrameId);
            this.hoverFrameId = 0;
        }
        if (this.clusterHoverFrameId) {
            cancelAnimationFrame(this.clusterHoverFrameId);
            this.clusterHoverFrameId = 0;
        }

        this.pinHoverEvent = null;
        this.clusterHoverEvent = null;
        this.engineFacade.getPinManager()?.clearHover?.();
    }

    private openProductFromUrl(productSlug: string): void {
        const mappedProduct = this.findProductInLocations(productSlug);
        if (mappedProduct) {
            this.showProductModalFromChatbot(mappedProduct as any);
            this.clearProductQueryParam();
            return;
        }

        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
        const requestOptions = token
            ? { headers: new HttpHeaders().set('x-token', token) }
            : {};

        // Fallback: si no está en el mapa (sin coordenadas o filtrado), pedimos el producto y abrimos la ficha igualmente.
        this.http.get<any>(`${this.productsUrl}/slug/${productSlug}`, requestOptions).subscribe({
            next: (response) => {
                const modalData = mapApiProductToModalData(response?.product);
                if (modalData) {
                    this.showProductModalFromChatbot(modalData as any);
                }
                this.clearProductQueryParam();
            },
            error: (error) => {
                if (this.isMongoId(productSlug)) {
                    this.http.get<any>(`${this.productsUrl}/${productSlug}`, requestOptions).subscribe({
                        next: (response) => {
                            const modalData = mapApiProductToModalData(response?.product);
                            if (modalData) {
                                this.showProductModalFromChatbot(modalData as any);
                            }
                            this.clearProductQueryParam();
                        },
                        error: () => {
                            console.error('❌ Error al abrir el producto desde la URL:', error);
                            this.clearProductQueryParam();
                        }
                    });
                    return;
                }
                console.error('❌ Error al abrir el producto desde la URL:', error);
                this.clearProductQueryParam();
            }
        });
    }

    private clearProductQueryParam(): void {
        this.router.navigate([], {
            queryParams: { product: null },
            queryParamsHandling: 'merge',
            replaceUrl: true
        });
    }

    ngOnDestroy(): void {
        if (isPlatformBrowser(this.platformId)) {
            this.detailsResolutionSubscription?.unsubscribe();
            this.detailsResolutionSubscription = null;
            this.hydrationUpdatesSubscription?.unsubscribe();
            this.hydrationUpdatesSubscription = null;
            this.authStateSubscription?.unsubscribe();
            this.authStateSubscription = null;
            this.favoritesChangedSubscription?.unsubscribe();
            this.favoritesChangedSubscription = null;
            this.stopBackgroundMapCacheRevalidation();
            this.mapProductDetailsHydrationService.clear();
            if (this._mapPointerDownHandler && this.mapContainer?.nativeElement) {
                (this.mapContainer.nativeElement as HTMLElement).removeEventListener('pointerdown', this._mapPointerDownHandler);
            }
            this.engineFacade.destroy();
        }
    }

    // Métodos para controlar el modal
    public onChatbotProductSelected(product: ChatbotProduct): void {
        if (!product) return;

        const productSlug = product.id;

        // Solo abrir modal si hay ID de producto válido
        if (!productSlug) {
            console.warn('⚠️ No se puede abrir ficha: producto sin ID');
            return;
        }

        const mappedProduct = this.findProductInLocations(productSlug);
        if (mappedProduct) {
            this.showProductModalFromChatbot(mappedProduct);
            return;
        }

        this.http.get<any>(`${this.productsUrl}/slug/${productSlug}`).subscribe({
            next: (response) => {
                const modalData = mapApiProductToModalData(response?.product);
                if (modalData) {
                    this.showProductModalFromChatbot(modalData);
                }
            },
            error: (error) => {
                console.error('❌ Error al obtener el producto desde el chatbot:', error);
            }
        });
    }

    /**
     * Recibe el evento del chatbot cuando filtra por categoría/certificación
     * o cuando el usuario escribe "quitar filtros".
     * Propaga el cambio al MapSearchOverlay (que a su vez actualiza el mapa).
     */
    public onChatbotMapFilterChange(filter: ChatbotMapFilter): void {
        this.ngZone.run(() => {
            if (filter.clearFilters) {
                this.mapSearchOverlay?.reset();
                this.resetMapFocusAfterChatbotClear();
                return;
            }
            if (filter.category || filter.certification) {
                this.mapSearchOverlay?.applyChatbotFilters(filter.category, filter.certification);
            }
            if (filter.focusLocation) {
                this.focusMapOnLocation(filter.focusLocation);
            }
        });
    }

    private resetMapFocusAfterChatbotClear(): void {
        // Reutilizamos el flujo nativo del motor para salir de foco de pin/ubicación.
        this.engineFacade.closeModal();

        const pinManager: any = this.engineFacade.getPinManager?.();
        pinManager?.clearActivePin?.();

        const cameraManager: any = this.engineFacade.getCameraManager?.();

        // Three.js: volver explícitamente a la vista de órbita base.
        cameraManager?.resetToOrbitView?.();
    }

    private normalizeLocationKey(value: unknown): string {
        return `${value ?? ''}`
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private setChatbotProvinceFocusZoomLocked(locked: boolean): void {
        const cameraManager: any = this.engineFacade.getCameraManager?.();
        cameraManager?.setManualFocusZoomLocked?.(locked);
    }

    private focusMapOnLocation(rawLocation: string): void {
        const locationKey = this.normalizeLocationKey(rawLocation);
        if (!locationKey) {
            this.setChatbotProvinceFocusZoomLocked(false);
            return;
        }

        const pool = (this.allLocationsData?.length ? this.allLocationsData : this.locationsData) || [];
        if (!pool.length) {
            this.setChatbotProvinceFocusZoomLocked(false);
            return;
        }

        const exactMatches = pool.filter((loc) => {
            const city = this.normalizeLocationKey(loc.city);
            const province = this.normalizeLocationKey(loc.province);
            const community = this.normalizeLocationKey(loc.autonomous_community);
            return city === locationKey || province === locationKey || community === locationKey;
        });

        const softMatches = exactMatches.length > 0 ? exactMatches : pool.filter((loc) => {
            const city = this.normalizeLocationKey(loc.city);
            const province = this.normalizeLocationKey(loc.province);
            const community = this.normalizeLocationKey(loc.autonomous_community);
            return (
                (city && (city.includes(locationKey) || locationKey.includes(city))) ||
                (province && (province.includes(locationKey) || locationKey.includes(province))) ||
                (community && (community.includes(locationKey) || locationKey.includes(community)))
            );
        });

        if (!softMatches.length) {
            this.setChatbotProvinceFocusZoomLocked(false);
            return;
        }

        const shouldLockProvinceFocusZoom = softMatches.some((loc) => {
            const province = this.normalizeLocationKey(loc.province);
            return province === locationKey || Boolean(province && (
                province.includes(locationKey) || locationKey.includes(province)
            ));
        });
        this.setChatbotProvinceFocusZoomLocked(shouldLockProvinceFocusZoom);

        const centroid = softMatches.reduce(
            (acc, loc) => {
                acc.lat += loc.lat;
                acc.lon += loc.lon;
                return acc;
            },
            { lat: 0, lon: 0 }
        );
        centroid.lat /= softMatches.length;
        centroid.lon /= softMatches.length;

        const representative = softMatches.reduce((best, candidate) => {
            const bestDistance = GeolocationService.haversineKm(centroid.lat, centroid.lon, best.lat, best.lon);
            const currentDistance = GeolocationService.haversineKm(centroid.lat, centroid.lon, candidate.lat, candidate.lon);
            return currentDistance < bestDistance ? candidate : best;
        }, softMatches[0]);

        const productId = this.getProductIdValue(representative.product);
        if (!productId) {
            this.setChatbotProvinceFocusZoomLocked(false);
            return;
        }

        const pinManager = this.engineFacade.getPinManager();
        const cameraManager = this.engineFacade.getCameraManager();
        const pin = pinManager?.getPinByProductId?.(productId);
        if (!pin || !cameraManager || typeof pin.getWorldPosition !== 'function') {
            this.setChatbotProvinceFocusZoomLocked(false);
            return;
        }

        const worldPos = new THREE.Vector3();
        pin.getWorldPosition(worldPos);

        this.ngZone.runOutsideAngular(() => {
            cameraManager.zoomToPin(worldPos);
        });
    }

    private findProductInLocations(productId: string): ProductModalData | null {
        const locationMatch = this.locationsData.find((loc) => {
            const candidate = loc.product as any;
            return (
                candidate?.slug === productId ||
                candidate?.id === productId ||
                candidate?.uid === productId ||
                candidate?._id === productId
            );
        });

        return locationMatch?.product ? { ...locationMatch.product } : null;
    }

    public showProductModal(product: ProductModalData): void {
        if (this.isLiteMapProduct(product)) {
            this.resolveLiteProductAndRun(product, (resolvedProduct) => this.renderProductModal(resolvedProduct));
            return;
        }

        this.renderProductModal(product);
    }

    private renderProductModal(product: ProductModalData): void {
        this.ngZone.run(() => {
            this.mapSearchOverlay?.closePanels();
            // Cerrar el overlap panel si está abierto
            this.overlapPanelVisible = false;
            this.overlapProducts = [];            // Limpiar hover inmediatamente
            this.pinHoverEvent = null;
            this.clusterHoverEvent = null;
            this.engineFacade.getPinManager()?.clearHover?.();            // Diferimos el cambio al siguiente ciclo para evitar ExpressionChangedAfterItHasBeenCheckedError
            queueMicrotask(() => {
                this.selectedProduct = product;
                this.modalVisible = true;
                this.cdr.markForCheck();
            });
        });
    }

    public showProductModalFromChatbot(product: ProductModalData & { _id?: string }): void {
        if (this.isLiteMapProduct(product)) {
            this.resolveLiteProductAndRun(product, (resolvedProduct) => this.renderProductModalFromChatbot(resolvedProduct as ProductModalData & { _id?: string }));
            return;
        }

        this.renderProductModalFromChatbot(product);
    }

    private renderProductModalFromChatbot(product: ProductModalData & { _id?: string }): void {
        this.ngZone.run(() => {
            this.mapSearchOverlay?.closePanels();
            // Cerrar el overlap panel si está abierto
            this.overlapPanelVisible = false;
            this.overlapProducts = [];
            // Limpiar hover inmediatamente
            this.pinHoverEvent = null;
            this.clusterHoverEvent = null;
            this.engineFacade.getPinManager()?.clearHover?.();
            queueMicrotask(() => {
                this.selectedProduct = product;
                this.modalVisible = true;

                const modalManager = this.engineFacade.getModalManager();
                modalManager.show(product);

                const productId = product.uid || (product as any)._id;
                if (productId) {
                    const pinManager = this.engineFacade.getPinManager(); // <--- Accedemos al manager
                    const cameraManager = this.engineFacade.getCameraManager();

                    const pin = pinManager.getPinByProductId(productId);
                    if (pin) {
                        // LLAMADA CLAVE: Marcamos el pin como activo para que empiece a girar
                        pinManager.setActivePin(pin);

                        if (cameraManager) {
                            const worldPos = new THREE.Vector3();
                            pin.getWorldPosition(worldPos);

                            this.ngZone.runOutsideAngular(() => {
                                cameraManager.zoomToPin(worldPos);
                            });
                        }
                    }
                }

                this.cdr.markForCheck();
            });
        });
    }

    private isLiteMapProduct(product: any): boolean {
        return Boolean(product?.isLite);
    }

    private resolveLiteProductAndRun(
        product: any,
        callback: (resolvedProduct: ProductModalData) => void
    ): void {
        const productId = this.getProductIdValue(product);
        if (!productId) {
            console.error('[MapCache] cannot resolve product detail: missing product id');
            return;
        }

        this.detailsResolutionSubscription?.unsubscribe();
        this.detailsResolutionSubscription = null;

        const hydratedProduct = this.mapProductDetailsHydrationService.getHydratedProduct(productId);
        if (hydratedProduct) {
            callback(hydratedProduct);
            return;
        }

        let resolutionSubscription: Subscription | null = null;
        resolutionSubscription = this.mapProductDetailsHydrationService.getOrFetchPriorityProduct(productId).subscribe({
            next: (resolvedProduct) => {
                callback(resolvedProduct);
            },
            error: (error) => {
                if (this.detailsResolutionSubscription === resolutionSubscription) {
                    this.detailsResolutionSubscription = null;
                }
                console.error('❌ Error obteniendo detalle completo del producto desde la hidratación:', error);
                this.fetchProductByIdAndRun(productId, callback);
            },
            complete: () => {
                if (this.detailsResolutionSubscription === resolutionSubscription) {
                    this.detailsResolutionSubscription = null;
                }
            }
        });

        this.detailsResolutionSubscription = resolutionSubscription;
    }

    private getProductIdValue(product: any): string | null {
        const id = String(product?.id || product?.uid || product?._id || '').trim();
        return id || null;
    }

    private storeMapDebugMetric(metric: 'lastTransformMs' | 'lastEngineInitMs', value: number): void {
        if (!isPlatformBrowser(this.platformId) || typeof window === 'undefined') {
            return;
        }

        window.__mapCacheDebug = window.__mapCacheDebug || {};
        window.__mapCacheDebug[metric] = value;
    }

    private now(): number {
        return typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    private buildLocationsFromMapProducts(products: MapProductLite[]): LocationData[] {
        return (Array.isArray(products) ? products : []).reduce<LocationData[]>((acc, product) => {
            if (!Number.isFinite(product.lat) || !Number.isFinite(product.lng)) {
                return acc;
            }

            acc.push({
                name: product.name || 'Sin nombre',
                lat: product.lat,
                lon: product.lng,
                city: product.city,
                province: product.province,
                autonomous_community: product.autonomous_community,
                product: {
                    title: product.name,
                    category: product.category,
                    province: product.province,
                    autonomous_community: product.autonomous_community,
                    certificaciones_protecciones: product.certificaciones_protecciones,
                    image: product.thumbnail,
                    media: product.thumbnail ? [product.thumbnail] : [],
                    id: product.id,
                    uid: product.id,
                    _id: product.id,
                    thumbnail: product.thumbnail,
                    has3D: product.has3D,
                    isLite: true
                }
            });

            return acc;
        }, []);
    }

    private startBackgroundMapCacheRevalidation(): void {
        if (!isPlatformBrowser(this.platformId) || typeof window === 'undefined') {
            return;
        }

        this.triggerMapCacheRevalidation();

        if (this.mapCacheRevalidationIntervalId !== null) {
            return;
        }

        this.mapCacheRevalidationIntervalId = window.setInterval(() => {
            this.triggerMapCacheRevalidation();
        }, this.mapCacheRevalidationIntervalMs);
    }

    private stopBackgroundMapCacheRevalidation(): void {
        this.mapCacheRevalidationSubscription?.unsubscribe();
        this.mapCacheRevalidationSubscription = null;

        if (!isPlatformBrowser(this.platformId) || typeof window === 'undefined') {
            return;
        }

        if (this.mapCacheRevalidationIntervalId !== null) {
            window.clearInterval(this.mapCacheRevalidationIntervalId);
            this.mapCacheRevalidationIntervalId = null;
        }
    }

    private triggerMapCacheRevalidation(): void {
        if (this.mapCacheRevalidationSubscription) {
            return;
        }

        this.mapCacheRevalidationSubscription = this.mapProductsCacheService.revalidateCache().subscribe({
            next: (result) => {
                if (!result.changed) {
                    return;
                }

                this.ngZone.run(() => {
                    this.applyLatestMapProducts(result.products);
                });
            },
            error: (error) => {
                this.mapCacheRevalidationSubscription = null;
                console.warn('[MapCache] background revalidation failed in Home', error);
            },
            complete: () => {
                this.mapCacheRevalidationSubscription = null;
            }
        });
    }

    private applyLatestMapProducts(products: MapProductLite[]): void {
        const nextLocations = this.buildLocationsFromMapProducts(products);

        this.locationsData = nextLocations;
        this.allLocationsData = [...nextLocations];
        this.mapDataReady = true;
        this.startBackgroundDetailsHydration();

        if (this.mapEngineInitialized) {
            this.applyMapFiltersToThreeEngine();
        } else {
            this.tryInitializeMap();
        }

        this.statusMessage = nextLocations.length > 0
            ? `${nextLocations.length} productos en el mapa.`
            : 'No hay productos para mostrar.';
        this.cdr.detectChanges();
    }

    private startBackgroundDetailsHydration(): void {
        if (!this.hydrationUpdatesSubscription) {
            this.hydrationUpdatesSubscription = this.mapProductDetailsHydrationService.hydratedUpdates$.subscribe(() => {
                if (!this.activeMapFilters.certifications?.length) {
                    return;
                }

                this.applyMapFiltersToThreeEngine();
            });
        }

        const productIds = this.locationsData
            .map((location) => this.getProductIdValue(location.product))
            .filter((productId): productId is string => Boolean(productId));

        if (productIds.length === 0) {
            return;
        }

        this.mapDetailsHydrationStarted = true;
        this.mapProductDetailsHydrationService.startHydration(productIds);
    }

    private fetchProductByIdAndRun(
        productId: string,
        callback: (resolvedProduct: ProductModalData) => void
    ): void {
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
        const requestOptions = token
            ? { headers: new HttpHeaders().set('x-token', token) }
            : {};

        this.http.get<any>(`${this.productsUrl}/${productId}`, requestOptions).subscribe({
            next: (response) => {
                const modalData = mapApiProductToModalData(response?.product);
                if (modalData) {
                    callback(modalData);
                }
            },
            error: (error) => {
                console.error('❌ Error obteniendo detalle completo del producto:', error);
            }
        });
    }

    private refreshFavoriteProductIds(force = false): void {
        if (!this.isLoggedIn) {
            this.favoriteProductIds.clear();
            this.favoritesLoaded = false;
            this.favoritesLoading = false;
            return;
        }

        if (this.favoritesLoading) {
            return;
        }

        if (this.favoritesLoaded && !force) {
            return;
        }

        const token = this.authService.getToken() || '';
        if (!token) {
            this.favoriteProductIds.clear();
            this.favoritesLoaded = false;
            this.favoritesLoading = false;
            return;
        }

        const headers = new HttpHeaders().set('x-token', token);
        const url = buildApiUrl('users/favorites');

        this.favoritesLoading = true;
        this.http.get<any>(url, { headers }).subscribe({
            next: (resp) => {
                const list = Array.isArray(resp?.favorites) ? resp.favorites : [];
                this.favoriteProductIds = new Set(
                    list
                        .map((favorite: any) => String(favorite?._id || favorite?.uid || favorite?.id || '').trim())
                        .filter(Boolean)
                );
                this.favoritesLoaded = true;
                this.favoritesLoading = false;

                if (this.activeMapFilters.favoritesOnly) {
                    this.applyMapFiltersToThreeEngine();
                }
            },
            error: (error) => {
                console.warn('[Home] no se pudieron cargar los favoritos para el filtro de mapa', error);
                this.favoriteProductIds.clear();
                this.favoritesLoaded = false;
                this.favoritesLoading = false;

                if (this.activeMapFilters.favoritesOnly) {
                    this.applyMapFiltersToThreeEngine();
                }
            }
        });
    }

    public async setEngine(engine: 'three' | 'opengl'): Promise<void> {
        if (this.switchingEngine || engine === this.engineType) return;

        this.clearHoverPreviews();
        this.switchingEngine = true;
        this.cdr.detectChanges();

        try {
            await this.engineFacade.changeEngine(engine);
            this.engineType = engine;
            this.statusMessage = `Estado: ✅ Motor ${engine === 'three' ? 'Three.js' : 'OpenGL'} activo.`;

            // Registrar callback de hover preview para el nuevo motor
            this.setupPinHoverPreview();

            // Reaplicamos filtros al motor activo (en Three.js refresca pines; en OpenGL no hace nada)
            this.applyMapFiltersToThreeEngine();

            // Relanzamos la intro para que el nuevo motor entre en 3D tras el switch
            // (Three.js arrancaba en 2D si se llegaba desde OpenGL porque no se disparaba la intro).
            this.engineFacade.startHomeIntro();
            this.viewMode = '3d';
        } catch (error) {
            console.error('❌ Error al cambiar de motor:', error);
            this.statusMessage = 'Estado: ❌ No se pudo cambiar de motor.';
        } finally {
            this.clearHoverPreviews();
            this.switchingEngine = false;
            this.cdr.detectChanges();
        }
    }

    private isMongoId(value: string): boolean {
        return /^[a-f0-9]{24}$/i.test(String(value || ''));
    }

    public hideProductModal(): void {
        this.ngZone.run(() => {
            queueMicrotask(() => {
                // 1. Ocultamos el HTML en Angular
                this.modalVisible = false;
                this.selectedProduct = null;

                // 2. IMPORTANTE: Avisamos al motor gráfico
                // Esto pone isVisibleState = false dentro del motor y desbloquea la tecla 'V'
                // Además, este método ya se encarga de llamar a releaseFocus() y limpiar pines internamente
                this.engineFacade.closeModal();

                this.cdr.markForCheck();
            });
        });
    }

    // --- OVERLAP PANEL (pines solapados en zoom máximo) ---

    /** Callback invocado por el motor cuando se detectan pines solapados al hacer click */
    public showOverlapPanel(products: any[]): void {
        // Si venimos de una ficha, ocultamos solo el estado visual/UI del modal.
        // No usamos closeModal() porque eso libera el foco y dispara el deszoom.
        if (this.modalVisible) {
            this.modalVisible = false;
            this.selectedProduct = null;
            this.engineFacade.getModalManager()?.hideSilently?.();
        }
        if (!Array.isArray(products) || products.length === 0) {
            this.overlapPanelVisible = false;
            this.overlapProducts = [];
            this.cdr.markForCheck();
            return;
        }
        this.ngZone.run(() => {
            queueMicrotask(() => {
                this.overlapProducts = products;
                this.overlapPanelVisible = true;
                // Limpiar ambos hover para que desaparezcan al abrir el panel
                this.clusterHoverEvent = null;
                this.pinHoverEvent = null;
                this.cdr.markForCheck();
            });
        });
    }

    /** El usuario seleccionó un producto del panel de desglose */
    public onOverlapProductSelected(product: any): void {
        this.overlapPanelVisible = false;
        this.overlapProducts = [];
        this.suppressClusterHoverUntilLeave = true;
        this.cdr.markForCheck();

        // Abrir la ficha completa del producto seleccionado
        this.showProductModalFromChatbot(product);
    }

    /** Cerrar el panel de desglose sin seleccionar ningún producto */
    public onOverlapPanelClose(): void {
        this.overlapPanelVisible = false;
        this.overlapProducts = [];
        this.suppressClusterHoverUntilLeave = true;
        // Tratar el cierre del panel como una deselección de cluster para
        // aplicar el mismo deszoom suave que en pines individuales.
        this.engineFacade.closeModal();
        this.cdr.markForCheck();
    }

    public toggleInstructions(): void {
        this.showInstructions = !this.showInstructions;
        this.cdr.markForCheck();
    }

    public async setViewMode(mode: '2d' | '3d'): Promise<void> {
        if (this.switchingEngine || this.viewMode === mode) return;

        const cameraManager: any = this.engineFacade.getCameraManager?.();
        const isThreeEngine = this.engineType === 'three';
        const isCinematic = cameraManager?.isCinematicMode === true;

        if (mode === '3d') {
            if (isThreeEngine) {
                this.engineFacade.setHybridAutoEnabled(true);
                if (!isCinematic) this.engineFacade.toggleCinematic(); // igual que tecla V
            } else {
                this.engineFacade.setViewMode?.('3d');
            }
            this.viewMode = '3d';
            this.cdr.detectChanges();
            return;
        }

        // mode === '2d'
        if (isThreeEngine) {
            this.engineFacade.setHybridAutoEnabled(false);
            if (isCinematic) {
                this.engineFacade.toggleCinematic(); // regresa a órbita
            } else {
                cameraManager?.resetToOrbitView?.();
            }
        } else {
            this.engineFacade.setViewMode?.('2d');
            // En OpenGL no hay modo cinemático; liberamos focus por si estaba fijado en un pin.
            cameraManager?.releaseFocus?.();
        }

        this.viewMode = '2d';
        this.cdr.detectChanges();
    }
}
