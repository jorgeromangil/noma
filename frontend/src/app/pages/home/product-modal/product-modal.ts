import { Component, Input, Output, EventEmitter, HostListener, OnChanges } from '@angular/core';
import { CustomTooltipDirective } from '../../../shared/custom-tooltip.directive';
import { CommonModule, NgIf } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';
import { Carrusel } from '../../../commons/carrusel/carrusel';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../../layouts/auth-layout/auth.service';
import { buildApiUrl } from '../../../shared/api-base';
import { FavoritesService } from '../../../services/favorites.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { getCertificationLabel } from '../../../shared/certification-labels';

export interface ProductModalData {
    title?: string;
    description?: string;
    image?: string;
    price?: string;
    name?: string;
    historia_origen?: string;
    importancia_cultural?: string;
    proceso_elaboracion?: string;
    materias_primas?: string;
    tiempo_elaboracion?: string;
    certificaciones_protecciones?: string;
    province?: string;
    resumen?: string;
    category?: string;
    autonomous_community?: string;
    address_text?: string;
    owner?: any;
    owner_name?: string;
    media?: string[];
    id?: string;
    uid?: string;
    _id?: string;
    thumbnail?: string;
    has3D?: boolean;
    isLite?: boolean;
    slug?: string;
}

@Component({
    selector: 'app-product-modal',
    standalone: true,
    imports: [CommonModule, NgIf, Carrusel, CustomTooltipDirective, FormsModule, NgSelectModule],
    templateUrl: './product-modal.html',
    styleUrl: './product-modal.css',
    animations: [
        trigger('fadeInOut', [
            transition(':enter', [
                style({ opacity: 0 }),
                animate('200ms ease-in', style({ opacity: 1 }))
            ]),
            transition(':leave', [
                animate('200ms ease-out', style({ opacity: 0 }))
            ])
        ])
    ]
})
export class ProductModalComponent implements OnChanges {
    private readonly reportReasonLabels: Record<string, string> = {
        contenido_inapropiado: 'Contenido inapropiado',
        informacion_falsa: 'Información falsa',
        spam: 'Spam',
        derechos_autor: 'Derechos de autor',
        otro: 'Otro'
    };
    public readonly reportReasonOptions: Array<{ value: string; label: string }> = [
        { value: 'contenido_inapropiado', label: 'Contenido inapropiado' },
        { value: 'informacion_falsa', label: 'Información falsa' },
        { value: 'spam', label: 'Spam' },
        { value: 'derechos_autor', label: 'Derechos de autor' },
        { value: 'otro', label: 'Otro' }
    ];
        private modalOpenedAt: number | null = null;
    @Input() product: ProductModalData | null = null;
    @Input() visible: boolean = false;
    @Output() close = new EventEmitter<void>();

    carouselSlides: Array<{ src: string; alt?: string }> = [];
    modalWidth: number = 450;
    isResizing = false;
    showResizeShadow = false;
    private startX = 0;
    private startWidth = 0;

    // Tabs
    activeTab: string = 'history';
    productTabs = [
        { id: 'history', label: 'Historia y Patrimonio', icon: '📜' },
        { id: 'techniques', label: 'Técnicas y Procesos', icon: '🛠️' },
        { id: 'certifications', label: 'Certificaciones', icon: '🔖' }
    ];

    public isFavorite: boolean = false;
    public favoriteLoading: boolean = false;
    public reportLoading: boolean = false;
    public reportFeedback: string | null = null;
    public showReportPopup: boolean = false;
    public selectedReportReason: string = 'contenido_inapropiado';
    public reportDetails: string = '';
    private favoritesCache = new Set<string>();
    private favoritesLoaded = false;
    private lastTrackedProductId: string | null = null;

    constructor(
        private router: Router,
        private http: HttpClient,
        private authService: AuthService,
        private favoritesService: FavoritesService,
        private analytics: AnalyticsService
    ) {}

    ngOnChanges(): void {
        this.updateCarouselSlides();
        // Resetea la pestaña activa cuando se abre un nuevo producto
        if (this.visible) {
            this.activeTab = 'history';
        }
        if (!this.visible) {
            this.closeReportPopup();
        }

        // Registrar duración del producto anterior si hay uno abierto
        if (this.visible && this.product) {
            if (this.modalOpenedAt && this.lastTrackedProductId) {
                const durationMs = Date.now() - this.modalOpenedAt;
                const ownerId = this.product?.owner?.uid || this.product?.owner?._id || this.product?.owner?.id;
                this.analytics.trackEvent('product_modal_duration', {
                    product_id: this.lastTrackedProductId,
                    artisan_id: ownerId,
                    duration_ms: durationMs
                });
            }
            // Guardar timestamp de apertura para el nuevo producto
            this.modalOpenedAt = Date.now();
            const productId = this.getProductId();
            this.isFavorite = this.favoritesLoaded ? this.favoritesCache.has(productId) : false;
            this.syncFavoriteStatus();

            if (productId && productId !== this.lastTrackedProductId) {
                const ownerId = this.product?.owner?.uid || this.product?.owner?._id || this.product?.owner?.id;
                this.analytics.trackEvent('product_modal_open', {
                    product_id: String(productId),
                    artisan_id: ownerId ? String(ownerId) : undefined
                });
                this.lastTrackedProductId = productId;
            }
        }
    }

    private updateCarouselSlides(): void {
        if (!this.product) {
            this.carouselSlides = [];
            return;
        }
        
        const slides: Array<{ src: string; alt?: string }> = [];
        const media = Array.isArray(this.product.media)
            ? this.product.media
            : (this.product.media ? [this.product.media as unknown as string] : []);
        const altText = this.product.title || this.product.name || 'Imagen del producto';

        if (media.length > 0) {
            media.forEach(mediaUrl => {
                if (mediaUrl) {
                    slides.push({
                        src: mediaUrl,
                        alt: altText
                    });
                }
            });
        } else if (this.product.image) {
            slides.push({
                src: this.product.image,
                alt: altText
            });
        }
        
        this.carouselSlides = slides;
    }

    get displayTitle(): string {
        return this.product?.title || this.product?.name || '';
    }

    get displayDescription(): string {
        return this.product?.description || '';
    }

    get displayResumen(): string {
        return this.product?.resumen || '';
    }

    get displayCategory(): string {
        return this.product?.category || '';
    }
    



   
    get displayImage(): string {
        return this.product?.image || '';
    }

    get displayHistoriaOrigen(): string {
        return this.product?.historia_origen || '';
    }

    get displayImportanciaCultural(): string {
        return this.product?.importancia_cultural || '';
    }

    get displayProcesoElaboracion(): string {
        return this.product?.proceso_elaboracion || '';
    }

    get displayMateriasPrimas(): string {
        return this.product?.materias_primas || '';
    }

    get displayTiempoElaboracion(): string {
        return this.product?.tiempo_elaboracion || '';
    }

    get displayCertificaciones(): string {
        return getCertificationLabel(this.product?.certificaciones_protecciones);
    }

    get displayAddress(): string {
        const parts = [this.product?.address_text, this.product?.province, this.product?.autonomous_community].filter(Boolean);
        return parts.join(', ');
    }

    get displayMedia(): string[] {
        return this.product?.media || [];
    }

    get displayOwnerName(): string {
        const owner = this.product?.owner;
        if (!owner) return '';
        return owner.company_name || `${owner.name} ${owner.surname || ''}`.trim();
    }

    get displayOwnerContact(): string {
        return this.product?.owner?.contact || '';
    }

    get ownerProfileSlug(): string {
        const owner = this.product?.owner;
        return owner?.slug || '';
    }

    get displayOwnerImage(): string {
        return this.product?.owner?.image || '';
    }

    get favoriteTitle(): string {
        if (!this.isAuthenticated()) return 'Inicia sesión para guardar';
        return this.isFavorite ? 'Quitar de favoritos' : 'Guardar en favoritos';
    }

    get reportTitle(): string {
        if (!this.isAuthenticated()) return 'Inicia sesión para reportar';
        return 'Reportar producto';
    }

    selectTab(tabId: string): void {
        this.activeTab = tabId;
    }

    hasTabContent(): boolean {
        return this.displayHistoriaOrigen !== '' || 
               this.displayImportanciaCultural !== '' || 
               this.displayProcesoElaboracion !== '' || 
               this.displayMateriasPrimas !== '' || 
               this.displayTiempoElaboracion !== '' || 
               this.displayCertificaciones !== '';
    }

    goToOwnerProfile(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const slug = this.ownerProfileSlug;
        if (!slug) return;
        const profileUrl = this.router.serializeUrl(
            this.router.createUrlTree(['/artesano', slug])
        );
        window.open(profileUrl, '_blank', 'noopener');
    }

    goToProductDetail(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        const productSlug = this.getProductSlug();
        const productId = this.getProductId();
        if (!productSlug || !productId) return;
        // Track evento GA4 y backend, usando el ObjectId real
        this.analytics.trackEvent('product_modal_view_full', {
            product_id: productId,
            artisan_id: this.product?.owner?.uid || this.product?.owner?._id || this.product?.owner?.id
        });
        const detailUrl = this.router.serializeUrl(
            this.router.createUrlTree(['/producto', productSlug])
        );
        window.open(detailUrl, '_blank', 'noopener');
    }

    toggleFavorite(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (!this.isAuthenticated()) {
            this.router.navigate(['/auth/login']);
            return;
        }

        const productId = this.getProductId();
        if (!productId) return;

        if (this.favoriteLoading) return;

        this.favoriteLoading = true;
        const token = this.authService.getToken() || '';
        const headers = new HttpHeaders().set('x-token', token);

        if (this.isFavorite) {
            this.isFavorite = false;
            this.favoritesCache.delete(productId);
            const url = buildApiUrl(`users/favorites/${productId}`);
            this.http.delete<any>(url, { headers }).subscribe({
                next: (resp) => {
                    if (resp.ok) {
                        this.favoritesLoaded = true;
                        this.favoritesService.notifyFavoritesChanged();
                    }
                    this.favoriteLoading = false;
                },
                error: () => {
                    this.isFavorite = true;
                    this.favoritesCache.add(productId);
                    this.favoriteLoading = false;
                }
            });
        } else {
            this.isFavorite = true;
            this.favoritesCache.add(productId);
            const url = buildApiUrl(`users/favorites/${productId}`);
            this.http.post<any>(url, {}, { headers }).subscribe({
                next: (resp) => {
                    if (resp.ok) {
                        this.favoritesLoaded = true;
                        this.favoritesService.notifyFavoritesChanged();
                    }
                    this.favoriteLoading = false;
                },
                error: () => {
                    this.isFavorite = false;
                    this.favoritesCache.delete(productId);
                    this.favoriteLoading = false;
                }
            });
        }
    }

    public openReportPopup(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!this.isAuthenticated()) {
            this.router.navigate(['/auth/login']);
            return;
        }
        if (this.reportLoading) return;

        this.selectedReportReason = 'contenido_inapropiado';
        this.reportDetails = '';
        this.reportFeedback = null;
        this.showReportPopup = true;
    }

    public closeReportPopup(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (this.reportLoading) return;
        this.reportFeedback = null;
        this.showReportPopup = false;
    }

    public submitReport(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!this.isAuthenticated()) {
            this.router.navigate(['/auth/login']);
            return;
        }
        if (this.reportLoading) return;

        const productId = this.getProductId();
        if (!productId) return;
        const reason = String(this.selectedReportReason || '').trim();
        if (!reason) {
            this.reportFeedback = 'Selecciona un motivo de reporte';
            return;
        }
        const details = String(this.reportDetails || '').trim();

        this.reportLoading = true;

        const token = this.authService.getToken() || '';
        const headers = new HttpHeaders().set('x-token', token);
        const url = buildApiUrl(`products/${productId}/report`);

        this.http.post<any>(url, { reason, details }, { headers }).subscribe({
            next: () => {
                const reasonLabel = this.reportReasonLabels[reason] || reason;
                this.analytics.trackEvent('product_modal_report_submitted', {
                    product_id: productId,
                    reason: reason,
                    reason_label: reasonLabel
                });
                this.reportFeedback = null;
                this.reportLoading = false;
                this.showReportPopup = false;
            },
            error: (err) => {
                this.reportFeedback = err?.error?.msg || 'No se pudo enviar el reporte';
                this.reportLoading = false;
            }
        });
    }

    private syncFavoriteStatus(): void {
        if (!this.isAuthenticated()) {
            this.isFavorite = false;
            this.favoritesLoaded = false;
            return;
        }

        const productId = this.getProductId();
        if (!productId) {
            this.isFavorite = false;
            return;
        }

        const token = this.authService.getToken() || '';
        const headers = new HttpHeaders().set('x-token', token);

        this.favoriteLoading = true;
        const url = buildApiUrl('users/favorites');
        this.http.get<any>(url, { headers }).subscribe({
            next: (resp) => {
                const list = resp?.favorites || [];
                this.favoritesCache = new Set(
                    list.map((p: any) => p._id || p.uid).filter(Boolean)
                );
                this.favoritesLoaded = true;
                this.isFavorite = this.favoritesCache.has(productId);
                this.favoriteLoading = false;
            },
            error: () => {
                this.isFavorite = false;
                this.favoriteLoading = false;
            }
        });
    }

    public getProductId(): string {
        return this.product?.uid || this.product?._id || '';
    }

    public getProductSlug(): string {
        return this.product?.slug || '';
    }

    public isAuthenticated(): boolean {
        return !!this.authService.getToken();
    }

    onClose(): void {
        // Trackear duración si se abrió el modal
        if (this.modalOpenedAt && this.product) {
            const durationMs = Date.now() - this.modalOpenedAt;
            const productId = this.getProductId();
            const ownerId = this.product?.owner?.uid || this.product?.owner?._id || this.product?.owner?.id;
            this.analytics.trackEvent('product_modal_duration', {
                product_id: productId,
                artisan_id: ownerId,
                duration_ms: durationMs
            });
        }
        this.closeReportPopup();
        this.modalOpenedAt = null;
        this.close.emit();
    }

    onResizeStart(event: MouseEvent): void {
        event.preventDefault();
        this.isResizing = true;
        this.showResizeShadow = true;
        this.startX = event.clientX;
        this.startWidth = this.modalWidth;

        document.addEventListener('mousemove', this.onResize);
        document.addEventListener('mouseup', this.onResizeEnd);
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    }

    onResizeHoverStart(): void {
        if (!this.isResizing) {
            this.showResizeShadow = true;
        }
    }

    onResizeHoverEnd(): void {
        if (!this.isResizing) {
            this.showResizeShadow = false;
        }
    }

    private onResize = (event: MouseEvent): void => {
        if (!this.isResizing) return;

        const deltaX = event.clientX - this.startX;
        let newWidth = this.startWidth + deltaX;

        // Aplicar límites
        newWidth = Math.max(350, Math.min(800, newWidth));
        this.modalWidth = newWidth;
    };

    private onResizeEnd = (): void => {
        this.isResizing = false;
        this.showResizeShadow = false;
        document.removeEventListener('mousemove', this.onResize);
        document.removeEventListener('mouseup', this.onResizeEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    @HostListener('document:keydown.escape')
    onEscapeKey(): void {
        if (this.visible) {
            this.onClose();
        }
    }
}
