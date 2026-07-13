import {
    ChangeDetectorRef,
    Component,
    ElementRef,
    Inject,
    Input,
    OnDestroy,
    OnInit,
    PLATFORM_ID,
    ViewChild
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Title, Meta } from '@angular/platform-browser';

import { CommonModule, NgIf } from '@angular/common';
import { CustomTooltipDirective } from '../../shared/custom-tooltip.directive';
import { trigger, transition, style, animate } from '@angular/animations';
import { Carrusel } from '../../commons/carrusel/carrusel';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../layouts/auth-layout/auth.service';
import { buildApiUrl } from '../../shared/api-base';
import { FavoritesService } from '../../services/favorites.service';
import { ActivatedRoute } from '@angular/router';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WebGLViewerComponent } from './webgl-viewer/webgl-viewer.component';
import { MapProductDetailsHydrationService } from '../../services/map-product-details-hydration.service';
import { getCertificationLabel } from '../../shared/certification-labels';

export interface ProductDetailData {
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
    autonomous_community?: string;
    address_text?: string;
    owner?: any;
    media?: string[];
    uid?: string;
    _id?: string;
    slug?: string;
    model3d?: {
        url?: string;
        filename?: string;
        driveFileId?: string;
        driveMimeType?: string;
        sizeBytes?: number;
        sha256?: string;
        uploadedAt?: string;
        uploadedBy?: string;
    } | null;
}

export interface RelatedProduct {
    _id: string;
    name: string;
    slug: string;
    category: string;
    media: string[];
    image?: string;
    description?: string;
    province?: string;
    address_text?: string;
    city?: string;
}

@Component({
    selector: 'app-product-detail',
    standalone: true,
    imports: [CommonModule, NgIf, Carrusel, RouterModule, CustomTooltipDirective, WebGLViewerComponent, FormsModule, NgSelectModule],
    templateUrl: './product-detail.html',
    styleUrls: ['../home/product-modal/product-modal.css', './product-detail.css'],
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
export class ProductDetailComponent implements OnInit, OnDestroy {
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
        get displayCategory(): string {
            // Intenta obtener la categoría desde product.category si existe
            // Si no existe, retorna string vacío
            return (this.product && (this.product as any).category) ? (this.product as any).category : '';
        }
    @ViewChild('viewerContainer') private viewerContainerRef?: ElementRef<HTMLDivElement>;
    @Input() product: ProductDetailData | null = null;
    carouselSlides: Array<{ src: string; alt?: string }> = [];
    activeTab: string = 'history';
    productTabs = [
        { id: 'history', label: 'Historia y Patrimonio', icon: '📜' },
        { id: 'techniques', label: 'Técnicas y Procesos', icon: '🛠️' }
    ];
    public isFavorite: boolean = false;
    public favoriteLoading: boolean = false;
    public reportLoading: boolean = false;
    public reportFeedback: string | null = null;
    public showReportPopup: boolean = false;
    public selectedReportReason: string = 'contenido_inapropiado';
    public reportDetails: string = '';
    public showSharePopup: boolean = false;
    public shareUrl: string = '';
    private favoritesCache = new Set<string>();
    private favoritesLoaded = false;
    public loading: boolean = false;
    public error: string | null = null;
    public relatedProducts: RelatedProduct[] = [];
    public relatedLoading = false;
    public relatedScrollable = false;
    @ViewChild('relatedTrack') private relatedTrackRef?: ElementRef<HTMLDivElement>;
    public show3DViewer: boolean = false;
    public showExpandedCarousel: boolean = false;
    public viewerLoading: boolean = false;
    public viewerError: string | null = null;
    public viewerType: 'threejs' | 'webgl' = 'threejs'; // Switch entre visores
    public webglModelUrl: string = '';
    public isExportingPdf: boolean = false;
    public pdfExportErrorMsg: string = '';

    private exportTimestamp: Date | null = null;
    private pdfFontFamily: string = 'helvetica';
    private plusJakartaRegularBinary: string | null = null;
    private plusJakartaSemiBoldBinary: string | null = null;
    private roundedGalleryImageCache: Map<string, string> = new Map();

    private viewerModelUrl: string | null = null;
    private readonly viewerTargetMaxSize = 1.2;
    private readonly viewerFitPadding = 1.4;
    private readonly viewerMinDistanceFactor = 0.45;
    private readonly viewerMaxDistanceFactor = 1.5;
    private viewerScene: THREE.Scene | null = null;
    private viewerCamera: THREE.PerspectiveCamera | null = null;
    private viewerRenderer: THREE.WebGLRenderer | null = null;
    private viewerControls: OrbitControls | null = null;
    private viewerModel: THREE.Object3D | null = null;
    private viewerFitDistance: number | null = null;
    private viewerAnimationFrameId: number | null = null;
    private viewerResizeObserver: ResizeObserver | null = null;
    private fullProductsWarmUpTimeoutId: number | null = null;
    private readonly boundViewerResize = () => this.onViewerResize();
    private readonly boundCloseDownloadMenu = () => this.closeDownloadMenu();

    constructor(
        private router: Router,
        private http: HttpClient,
        private authService: AuthService,
        private favoritesService: FavoritesService,
        private route: ActivatedRoute,
        private cdr: ChangeDetectorRef,
        private titleService: Title,
        private metaService: Meta,
        private mapProductDetailsHydrationService: MapProductDetailsHydrationService,
        @Inject(PLATFORM_ID) private platformId: Object
    ) {}

    goToOwnerProfile(event: Event): void {
        event.stopPropagation();
        const slug = this.product?.owner?.slug;
        if (slug) {
            this.router.navigate(['/artesano', slug]);
        }
    }

    openSharePopup(event: Event): void {
        event.stopPropagation();
        this.shareUrl = window.location.href;
        this.showSharePopup = true;
        this.cdr.detectChanges();
    }

    closeSharePopup(): void {
        this.showSharePopup = false;
        this.cdr.detectChanges();
    }

    copyShareUrl(): void {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(this.shareUrl);
            // Cambiar el texto del botón temporalmente
            const textoSpan = document.querySelector('.share-copy-text-product');
            if (textoSpan) {
                const textoOriginal = textoSpan.textContent;
                textoSpan.textContent = '¡Copiado!';
                setTimeout(() => {
                    textoSpan.textContent = textoOriginal;
                }, 2000);
            }
        }
    }

    ngOnInit(): void {
        if (isPlatformBrowser(this.platformId)) {
            document.body.classList.add('product-detail-bg');
            document.addEventListener('click', this.boundCloseDownloadMenu);
        }
        this.route.params.subscribe(params => {
            const slug = params['slug'];
            this.close3DViewer();
            this.cancelScheduledProductsWarmUp();
            this.loading = true;
            this.product = null;
            this.carouselSlides = [];
            this.activeTab = 'history';
            this.error = null;
            this.showReportPopup = false;
            if (slug) {
                this.loadProductBySlug(slug);
            } else {
                this.loading = false;
                this.error = 'No se encontró el producto.';
            }
        });
    }

    ngOnDestroy(): void {
        this.disposeViewer3D();
        this.showExpandedCarousel = false;
        this.cancelScheduledProductsWarmUp();
        if (isPlatformBrowser(this.platformId)) {
            document.body.classList.remove('product-detail-bg');
            document.body.classList.remove('product-detail-carousel-expanded');
            document.removeEventListener('click', this.boundCloseDownloadMenu);
        }
    }

    public openExpandedCarousel(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        this.showExpandedCarousel = true;
        if (isPlatformBrowser(this.platformId)) {
            document.body.classList.add('product-detail-carousel-expanded');
        }
    }

    public closeExpandedCarousel(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        this.showExpandedCarousel = false;
        if (isPlatformBrowser(this.platformId)) {
            document.body.classList.remove('product-detail-carousel-expanded');
        }
    }

    public open3DViewer(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (this.show3DViewer) return;

        // No abrir si no hay modelo 3D disponible
        const modelUrl = this.getViewerModelUrl();
        if (!modelUrl) {
            this.viewerError = 'El artesano aún no ha subido un modelo 3D.';
            return;
        }
        this.viewerModelUrl = modelUrl;
        this.webglModelUrl = modelUrl;
        this.viewerType = 'threejs';

        this.show3DViewer = true;
        this.viewerLoading = true;
        this.viewerError = null;
        this.cdr.detectChanges();

        if (!isPlatformBrowser(this.platformId)) {
            this.viewerLoading = false;
            this.viewerError = 'El visor 3D solo está disponible en navegador.';
            return;
        }

        setTimeout(() => {
            void this.initViewer3D();
        }, 0);
    }

    public close3DViewer(): void {
        this.show3DViewer = false;
        this.viewerLoading = false;
        this.viewerError = null;
        this.disposeViewer3D();
    }

    public recenter3DView(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!this.viewerModel || !this.viewerCamera || !this.viewerControls) return;
        this.fitCameraToObject(this.viewerModel, this.viewerCamera, this.viewerControls);
    }

    public resetWebGLView(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        // Enviar mensaje al iframe del visor WebGL
        const iframe = document.querySelector('app-webgl-viewer iframe') as HTMLIFrameElement;
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ action: 'resetView' }, '*');
        }
    }

    public switchViewer(type: 'threejs' | 'webgl', event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!this.show3DViewer) return;
        
        this.viewerType = type;
        
        // Si cambiamos a WebGL, pausamos Three.js pero conservamos el estado
        if (type === 'webgl') {
            this.pauseViewerAnimation();
            this.viewerLoading = false;
        } else {
            // Si volvemos a Three.js, reanudamos (sin recargar si ya estaba inicializado)
            this.viewerLoading = true;
            this.cdr.detectChanges();
            setTimeout(() => {
                void this.initViewer3D();
            }, 0);
        }
        
        this.cdr.detectChanges();
    }

    private async initViewer3D(): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) return;
        if (!this.show3DViewer) return;

        const container = await this.waitForViewerContainerElement();
        if (!container) {
            this.viewerLoading = false;
            this.viewerError = 'No se pudo abrir el contenedor del visor.';
            this.cdr.markForCheck();
            return;
        }

        // Si ya hay un visor Three.js montado en memoria, reanudar sin recargar modelo
        if (this.viewerRenderer && this.viewerScene && this.viewerCamera && this.viewerControls && this.viewerModel) {
            container.innerHTML = '';
            container.appendChild(this.viewerRenderer.domElement);
            this.setupViewerResizeObserver(container);
            window.addEventListener('resize', this.boundViewerResize);
            this.onViewerResize();
            this.resumeViewerAnimation();
            this.viewerLoading = false;
            this.viewerError = null;
            this.cdr.markForCheck();
            return;
        }

        this.disposeViewer3D();

        await this.waitForNextFrame();
        if (!this.show3DViewer) return;

        const ready = await this.waitForViewerContainerReady(container);
        if (!ready) {
            this.viewerLoading = false;
            this.viewerError = 'No se pudo inicializar el visor 3D. Intenta abrirlo de nuevo.';
            this.cdr.markForCheck();
            return;
        }

        const { width, height } = this.getViewerViewport(container);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x090c14);

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;

        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = false;
        controls.screenSpacePanning = false;
        controls.rotateSpeed = 0.7;
        controls.zoomSpeed = 0.85;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
        scene.add(ambientLight);
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
        keyLight.position.set(160, 130, 110);
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0x87b6ff, 0.55);
        rimLight.position.set(-90, 50, -120);
        scene.add(rimLight);

        this.viewerScene = scene;
        this.viewerCamera = camera;
        this.viewerRenderer = renderer;
        this.viewerControls = controls;

        this.setupViewerResizeObserver(container);
        window.addEventListener('resize', this.boundViewerResize);
        this.onViewerResize();

        const animate = () => {
            if (!this.viewerRenderer || !this.viewerScene || !this.viewerCamera) return;
            this.viewerAnimationFrameId = window.requestAnimationFrame(animate);
            this.viewerControls?.update();
            this.viewerRenderer.render(this.viewerScene, this.viewerCamera);
        };
        animate();

        try {
            if (!this.viewerModelUrl) throw new Error('Modelo 3D no configurado');
            const model = await this.loadViewerModel(this.viewerModelUrl);
            if (!this.viewerScene) return;
            this.normalizeModelForViewer(model);
            this.viewerModel = model;
            this.viewerScene.add(model);
            this.fitCameraToObject(model, camera, controls);
            this.viewerLoading = false;
            this.viewerError = null;
        } catch (error) {
            console.error('[ProductDetail] Error cargando modelo 3D:', error);
            this.viewerLoading = false;
            this.viewerError = 'No se pudo cargar el modelo 3D.';
        }

        this.cdr.markForCheck();
    }

    private pauseViewerAnimation(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        if (this.viewerAnimationFrameId !== null) {
            window.cancelAnimationFrame(this.viewerAnimationFrameId);
            this.viewerAnimationFrameId = null;
        }
    }

    private resumeViewerAnimation(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        if (!this.viewerRenderer || !this.viewerScene || !this.viewerCamera) return;
        if (this.viewerAnimationFrameId !== null) return;

        const animate = () => {
            if (!this.viewerRenderer || !this.viewerScene || !this.viewerCamera) return;
            this.viewerAnimationFrameId = window.requestAnimationFrame(animate);
            this.viewerControls?.update();
            this.viewerRenderer.render(this.viewerScene, this.viewerCamera);
        };
        animate();
    }

    private loadViewerModel(url: string): Promise<THREE.Object3D> {
        return new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            loader.load(
                url,
                (gltf) => resolve(gltf.scene),
                undefined,
                (error) => reject(error)
            );
        });
    }

    private getViewerModelUrl(): string | null {
        const productId = this.getProductId();
        if (productId && this.hasModel3d) {
            return buildApiUrl(`products/${productId}/model3d/file`);
        }

        const rawUrl = this.product?.model3d?.url;
        if (!rawUrl) return null;

        const trimmed = rawUrl.trim();
        if (!trimmed) return null;

        const fromUrl = this.extractProductIdFromModelUrl(trimmed);
        if (fromUrl) {
            return buildApiUrl(`products/${fromUrl}/model3d/file`);
        }

        return trimmed;
    }

    private extractProductIdFromModelUrl(url: string): string | null {
        const match = url.match(/\/assets3d\/models\/([a-f\d]{24})\//i);
        return match?.[1] || null;
    }

    private fitCameraToObject(
        object: THREE.Object3D,
        camera: THREE.PerspectiveCamera,
        controls: OrbitControls
    ): void {
        object.updateMatrixWorld(true);
        const box = this.getRenderableBounds(object);
        if (!box) return;

        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const center = sphere.center.clone();
        const radius = Math.max(sphere.radius, 0.001);
        const vFov = THREE.MathUtils.degToRad(camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
        const minHalfFov = Math.max(Math.min(vFov, hFov) * 0.5, 0.001);
        const cameraDistance = (radius / Math.sin(minHalfFov)) * this.viewerFitPadding;
        const cameraDirection = new THREE.Vector3(0, 0.2, 1).normalize();

        camera.position.copy(center).addScaledVector(cameraDirection, cameraDistance);
        camera.near = Math.max(cameraDistance / 100, 0.01);
        camera.far = Math.max(cameraDistance + radius * 12, 50);
        camera.lookAt(center);
        camera.updateProjectionMatrix();

        controls.target.copy(center);
        controls.minDistance = Math.max(cameraDistance * this.viewerMinDistanceFactor, 0.05);
        controls.maxDistance = Math.max(cameraDistance * this.viewerMaxDistanceFactor, 0.5);
        controls.update();
        controls.saveState();
        this.viewerFitDistance = cameraDistance;
    }

    private normalizeModelForViewer(object: THREE.Object3D): void {
        object.updateMatrixWorld(true);
        const box = this.getRenderableBounds(object);
        if (!box) return;

        const size = box.getSize(new THREE.Vector3());
        const maxSize = Math.max(size.x, size.y, size.z, 0.001);
        const uniformScale = this.viewerTargetMaxSize / maxSize;
        object.scale.multiplyScalar(uniformScale);
        object.updateMatrixWorld(true);

        for (let i = 0; i < 3; i++) {
            const centeredBox = this.getRenderableBounds(object);
            if (!centeredBox) return;
            const centeredPosition = centeredBox.getCenter(new THREE.Vector3());
            object.position.sub(centeredPosition);
            object.updateMatrixWorld(true);
            if (centeredPosition.lengthSq() < 1e-8) break;
        }
    }

    private onViewerResize(): void {
        if (!this.show3DViewer || !this.viewerRenderer || !this.viewerCamera) return;
        const container = this.viewerContainerRef?.nativeElement;
        if (!container) return;

        const { width, height } = this.getViewerViewport(container);
        this.viewerRenderer.setSize(width, height);
        this.viewerCamera.aspect = width / height;
        this.viewerCamera.updateProjectionMatrix();

        if (this.viewerControls && this.viewerModel) {
            this.fitCameraToObject(this.viewerModel, this.viewerCamera, this.viewerControls);
            return;
        }

        if (this.viewerControls && this.viewerFitDistance) {
            this.viewerControls.maxDistance = Math.max(this.viewerFitDistance * this.viewerMaxDistanceFactor, 0.5);
            this.viewerControls.minDistance = Math.max(this.viewerFitDistance * this.viewerMinDistanceFactor, 0.05);
            this.viewerControls.update();
        }
    }

    private getViewerViewport(container: HTMLElement): { width: number; height: number } {
        const bounds = container.getBoundingClientRect();
        return {
            width: Math.max(Math.round(bounds.width || container.clientWidth), 1),
            height: Math.max(Math.round(bounds.height || container.clientHeight), 1)
        };
    }

    private waitForNextFrame(): Promise<void> {
        return new Promise((resolve) => {
            window.requestAnimationFrame(() => resolve());
        });
    }

    private async waitForViewerContainerReady(container: HTMLElement): Promise<boolean> {
        const maxTries = 20;
        for (let i = 0; i < maxTries; i += 1) {
            const { width, height } = this.getViewerViewport(container);
            if (width > 40 && height > 40) {
                return true;
            }
            await this.waitForNextFrame();
        }
        return false;
    }

    private async waitForViewerContainerElement(): Promise<HTMLDivElement | null> {
        const maxTries = 20;
        for (let i = 0; i < maxTries; i += 1) {
            const container = this.viewerContainerRef?.nativeElement;
            if (container) {
                return container;
            }
            await this.waitForNextFrame();
        }
        return null;
    }

    private getRenderableBounds(object: THREE.Object3D): THREE.Box3 | null {
        object.updateWorldMatrix(true, true);

        const bounds = new THREE.Box3();
        const meshBounds = new THREE.Box3();
        let hasMesh = false;

        object.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;

            if (!mesh.geometry.boundingBox) {
                mesh.geometry.computeBoundingBox();
            }
            if (!mesh.geometry.boundingBox) return;

            meshBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
            if (!Number.isFinite(meshBounds.min.x) || !Number.isFinite(meshBounds.max.x)) return;

            if (!hasMesh) {
                bounds.copy(meshBounds);
                hasMesh = true;
                return;
            }
            bounds.union(meshBounds);
        });

        if (hasMesh) return bounds;

        const fallbackBox = new THREE.Box3().setFromObject(object, true);
        return fallbackBox.isEmpty() ? null : fallbackBox;
    }

    private setupViewerResizeObserver(container: HTMLElement): void {
        if (!isPlatformBrowser(this.platformId)) return;
        if (typeof ResizeObserver === 'undefined') return;

        this.viewerResizeObserver?.disconnect();
        this.viewerResizeObserver = new ResizeObserver(() => {
            this.onViewerResize();
        });
        this.viewerResizeObserver.observe(container);
    }

    private disposeViewer3D(): void {
        const isBrowser = isPlatformBrowser(this.platformId);
        if (isBrowser) {
            window.removeEventListener('resize', this.boundViewerResize);
        }
        this.viewerResizeObserver?.disconnect();
        this.viewerResizeObserver = null;

        if (this.viewerAnimationFrameId !== null) {
            if (isBrowser) {
                window.cancelAnimationFrame(this.viewerAnimationFrameId);
            }
            this.viewerAnimationFrameId = null;
        }

        if (this.viewerControls) {
            this.viewerControls.dispose();
            this.viewerControls = null;
        }

        if (this.viewerModel) {
            this.disposeObject3D(this.viewerModel);
            this.viewerModel = null;
        }

        if (this.viewerRenderer) {
            this.viewerRenderer.dispose();
            this.viewerRenderer.forceContextLoss();
            const canvas = this.viewerRenderer.domElement;
            if (canvas.parentElement) {
                canvas.parentElement.removeChild(canvas);
            }
            this.viewerRenderer = null;
        }

        const container = this.viewerContainerRef?.nativeElement;
        if (container) {
            container.innerHTML = '';
        }

        this.viewerScene = null;
        this.viewerCamera = null;
        this.viewerFitDistance = null;
    }

    private disposeObject3D(object: THREE.Object3D): void {
        object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;

            mesh.geometry?.dispose();
            const material = mesh.material;
            if (Array.isArray(material)) {
                material.forEach((mat) => this.disposeMaterial(mat));
            } else if (material) {
                this.disposeMaterial(material);
            }
        });
    }

    private disposeMaterial(material: THREE.Material): void {
        const candidate = material as THREE.Material & Record<string, unknown>;
        Object.keys(candidate).forEach((key) => {
            const value = candidate[key];
            if (value && typeof value === 'object' && 'isTexture' in (value as Record<string, unknown>)) {
                (value as THREE.Texture).dispose();
            }
        });
        material.dispose();
    }

    public showDownloadMenu = false;

    toggleDownloadMenu(event: Event): void {
        event.stopPropagation();
        this.showDownloadMenu = !this.showDownloadMenu;
    }

    closeDownloadMenu(): void {
        this.showDownloadMenu = false;
    }

    async transformToPDF(): Promise<void> {
        this.closeDownloadMenu();
        if (!this.product) return;

        this.pdfExportErrorMsg = '';
        this.isExportingPdf = true;
        this.exportTimestamp = new Date();

        try {
            const { jsPDF } = await import('jspdf');
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
            await this.tryRegisterPlusJakarta(doc);

            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 14;
            const contentWidth = pageWidth - (margin * 2);
            let y = 16;

            const backgroundImage = this.createPdfGradientBackgroundDataUrl(pageWidth, pageHeight);
            this.drawPdfPageBackground(doc, backgroundImage, pageWidth, pageHeight);

            // Título: nombre del producto
            doc.setTextColor(232, 232, 232);
            this.setPdfFont(doc, 'bold');
            doc.setFontSize(18);
            doc.text(this.displayTitle || 'Producto artesanal', margin, 16);


            y = 30;
            // Primero galería visual
            y = await this.drawProductImageGallery(doc, y, margin, contentWidth, pageWidth, pageHeight, backgroundImage);

            // Luego resumen total
            const summaryCards = this.getProductSummaryCards();
            y = this.drawProductCardsSection(doc, y, 'Resumen del producto', summaryCards, contentWidth, pageWidth, pageHeight, margin, backgroundImage);

            const descriptionParts: string[] = [];
            if (this.displayDescription) descriptionParts.push(this.displayDescription);
            y = this.drawProductTextSection(doc, y, margin, contentWidth, 'Descripción', descriptionParts, pageWidth, pageHeight, backgroundImage);

            const heritageParts: string[] = [];
            if (this.displayHistoriaOrigen) heritageParts.push(`Origen e historia: ${this.displayHistoriaOrigen}`);
            if (this.displayImportanciaCultural) heritageParts.push(`Importancia cultural: ${this.displayImportanciaCultural}`);
            y = this.drawProductTextSection(doc, y, margin, contentWidth, 'Historia y patrimonio', heritageParts, pageWidth, pageHeight, backgroundImage);

            const processParts: string[] = [];
            if (this.displayMateriasPrimas) processParts.push(`Materias primas: ${this.displayMateriasPrimas}`);
            if (this.displayProcesoElaboracion) processParts.push(`Proceso de elaboración: ${this.displayProcesoElaboracion}`);
            if (this.displayTiempoElaboracion) processParts.push(`Tiempo de elaboración: ${this.displayTiempoElaboracion}`);
            y = this.drawProductTextSection(doc, y, margin, contentWidth, 'Técnicas y procesos', processParts, pageWidth, pageHeight, backgroundImage);

            const certificationParts = this.displayCertificaciones ? [this.displayCertificaciones] : [];
            y = this.drawProductTextSection(doc, y, margin, contentWidth, 'Certificaciones', certificationParts, pageWidth, pageHeight, backgroundImage);

            const fileBase = this.slugifyForFilename(this.displayTitle || 'producto-artesanal');
            const dateSuffix = (this.exportTimestamp || new Date()).toISOString().slice(0, 10);
            doc.save(`${fileBase}-${dateSuffix}.pdf`);
        } catch (error) {
            console.error('Error generating PDF:', error);
            this.pdfExportErrorMsg = 'No se pudo generar el PDF. Intenta de nuevo en unos segundos.';
        } finally {
            this.isExportingPdf = false;
            this.cdr.detectChanges();
        }
    }

    private getProductSummaryCards(): Array<{ label: string; value: string; helper?: string }> {
        const cards: Array<{ label: string; value: string; helper?: string }> = [];

        if (this.displayCategory) {
            cards.push({ label: 'Categoría', value: this.displayCategory, helper: 'Clasificación' });
        }
        const addressText = String(this.product?.address_text || '').trim();
        if (addressText) {
            cards.push({ label: 'Dirección', value: addressText, helper: 'Dirección detallada' });
        }
        const province = String(this.product?.province || '').trim();
        if (province) {
            cards.push({ label: 'Provincia', value: province, helper: 'Ubicación provincial' });
        }
        if (this.displayOwnerName) {
            cards.push({ label: 'Artesano', value: this.displayOwnerName, helper: 'Autor del producto' });
        }
        if (this.displayOwnerContact) {
            cards.push({ label: 'Contacto', value: this.displayOwnerContact, helper: 'Datos de contacto' });
        }
        if (this.displayCertificaciones) {
            cards.push({ label: 'Certificaciones', value: this.displayCertificaciones, helper: 'Garantías y sellos' });
        }

        return cards;
    }

    private drawProductCardsSection(
        doc: any,
        startY: number,
        title: string,
        cards: Array<{ label: string; value: string; helper?: string }>,
        contentWidth: number,
        pageWidth: number,
        pageHeight: number,
        margin: number,
        backgroundImage: string
    ): number {
        if (!cards.length) return startY;

        let y = startY;
        const gap = 6;
        const columns = 2;
        const cardWidth = (contentWidth - gap) / columns;
        const cardHeight = 20;

        y = this.ensurePdfSpace(doc, y, 16, pageWidth, pageHeight, margin, backgroundImage);
        this.setPdfFont(doc, 'bold');
        doc.setFontSize(12);
        doc.setTextColor(232, 232, 232);
        doc.text(title, margin, y);
        y += 6;

        const rows = Math.ceil(cards.length / columns);
        for (let row = 0; row < rows; row += 1) {
            y = this.ensurePdfSpace(doc, y, cardHeight + 4, pageWidth, pageHeight, margin, backgroundImage);
            for (let col = 0; col < columns; col += 1) {
                const index = row * columns + col;
                if (index >= cards.length) continue;
                const card = cards[index];
                const x = margin + (col * (cardWidth + gap));
                const cardY = y;

                doc.setDrawColor(62, 62, 62);
                doc.setLineWidth(0.16);
                doc.setFillColor(30, 30, 30);
                doc.roundedRect(x, cardY, cardWidth, cardHeight, 2, 2, 'FD');

                this.setPdfFont(doc, 'bold');
                doc.setFontSize(9);
                doc.setTextColor(191, 191, 191);
                const label = this.truncateTextToWidth(doc, card.label, cardWidth - 6);
                doc.text(label, x + 3, cardY + 5);

                this.setPdfFont(doc, 'bold');
                doc.setFontSize(14);
                doc.setTextColor(245, 245, 245);
                const value = this.truncateTextToWidth(doc, card.value, cardWidth - 6);
                doc.text(value, x + 3, cardY + 12);

                if (card.helper) {
                    this.setPdfFont(doc, 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(160, 160, 160);
                    const helper = this.truncateTextToWidth(doc, card.helper, cardWidth - 6);
                    doc.text(helper, x + 3, cardY + 17);
                }
            }
            y += cardHeight + 4;
        }

        return y + 4;
    }

    private async drawProductImageGallery(
        doc: any,
        startY: number,
        margin: number,
        contentWidth: number,
        pageWidth: number,
        pageHeight: number,
        backgroundImage: string
    ): Promise<number> {
        const images = this.displayMedia.length > 0
            ? this.displayMedia.slice(0, 3)
            : (this.displayImage ? [this.displayImage] : []);

        let y = startY;
        y = this.ensurePdfSpace(doc, y, 14, pageWidth, pageHeight, margin, backgroundImage);
        this.setPdfFont(doc, 'bold');
        doc.setFontSize(12);
        doc.setTextColor(232, 232, 232);
        doc.text('Imágenes del producto', margin, y);
        y += 6;

        if (!images.length) {
            return this.drawProductTextSection(doc, y, margin, contentWidth, '', ['Sin imágenes disponibles para este producto.'], pageWidth, pageHeight, backgroundImage);
        }

        const gap = 4;
        const imageHeight = 45;
        const imageWidth = (contentWidth - (gap * 2)) / 3;
        y = this.ensurePdfSpace(doc, y, imageHeight + 2, pageWidth, pageHeight, margin, backgroundImage);

        for (let i = 0; i < 3; i += 1) {
            const x = margin + (i * (imageWidth + gap));
            doc.setFillColor(30, 30, 30);
            doc.roundedRect(x, y, imageWidth, imageHeight, 2, 2, 'F');

            const imageUrl = images[i];
            if (!imageUrl) {
                continue;
            }

            const imageData = await this.getImageDataUrlForPdf(imageUrl);
            if (imageData) {
                const roundedImageData = await this.getRoundedCoverImageDataUrlForPdf(imageData, imageWidth, imageHeight, 2);
                doc.addImage(roundedImageData, 'PNG', x, y, imageWidth, imageHeight, undefined, 'FAST');
            }
        }

        return y + imageHeight + 10;
    }

    private drawProductTextSection(
        doc: any,
        startY: number,
        margin: number,
        contentWidth: number,
        title: string,
        paragraphs: string[],
        pageWidth: number,
        pageHeight: number,
        backgroundImage: string
    ): number {
        const cleanParagraphs = paragraphs
            .map((line) => String(line || '').trim())
            .filter((line) => line.length > 0);

        if (!cleanParagraphs.length && title) return startY;

        let y = startY;
        if (title) {
            y = this.ensurePdfSpace(doc, y, 14, pageWidth, pageHeight, margin, backgroundImage);
            this.setPdfFont(doc, 'bold');
            doc.setFontSize(12);
            doc.setTextColor(232, 232, 232);
            doc.text(title, margin, y);
            y += 6;
        }

        const padding = 3.5;
        const minHeight = 10;
        const maxLineWidth = contentWidth - (padding * 2);
        const lineHeight = 4.6;

        // Para cada párrafo, si contiene ":", lo separamos en subtítulo y texto
        for (const paragraph of cleanParagraphs.length ? cleanParagraphs : ['Sin información disponible.']) {
            let subtitle = '';
            let content = '';
            const idx = paragraph.indexOf(':');
            if (idx > 0 && idx < paragraph.length - 1) {
                subtitle = paragraph.slice(0, idx).trim();
                content = paragraph.slice(idx + 1).trim();
            } else {
                content = paragraph;
            }

            // Calcular altura necesaria
            let subtitleHeight = 0;
            let contentHeight = 0;
            let contentLines: string[] = [];
            if (subtitle) {
                subtitleHeight = 6.5;
            }
            if (content) {
                contentLines = doc.splitTextToSize(content, maxLineWidth);
                contentHeight = contentLines.length * lineHeight;
            }
            const sectionHeight = Math.max(minHeight, subtitleHeight + contentHeight + (padding));
            y = this.ensurePdfSpace(doc, y, sectionHeight + 3, pageWidth, pageHeight, margin, backgroundImage);

            doc.setDrawColor(62, 62, 62);
            doc.setLineWidth(0.16);
            doc.setFillColor(30, 30, 30);
            doc.roundedRect(margin, y, contentWidth, sectionHeight, 2, 2, 'FD');

            let textY = y + padding + 2.6;
            if (subtitle) {
                this.setPdfFont(doc, 'bold');
                doc.setFontSize(11);
                doc.setTextColor(235, 235, 235);
                doc.text(subtitle, margin + padding, textY);
                textY += subtitleHeight;
            }
            if (content) {
                this.setPdfFont(doc, 'normal');
                doc.setFontSize(10);
                doc.setTextColor(235, 235, 235);
                const normalized = contentLines.map((line) => this.truncateTextToWidth(doc, line, maxLineWidth));
                doc.text(normalized, margin + padding, textY);
            }

            y += sectionHeight + 5;
        }

        return y + 8;
    }

    private ensurePdfSpace(
        doc: any,
        y: number,
        needed: number,
        pageWidth: number,
        pageHeight: number,
        margin: number,
        backgroundImage: string
    ): number {
        if (y + needed <= pageHeight - margin) return y;
        doc.addPage();
        this.drawPdfPageBackground(doc, backgroundImage, pageWidth, pageHeight);
        return margin;
    }

    private truncateTextToWidth(doc: any, value: string, maxWidth: number): string {
        const input = String(value || '');
        if (!input) return '';
        if (doc.getTextWidth(input) <= maxWidth) return input;

        const ellipsis = '...';
        let end = input.length;
        while (end > 1) {
            const candidate = `${input.slice(0, end).trimEnd()}${ellipsis}`;
            if (doc.getTextWidth(candidate) <= maxWidth) return candidate;
            end -= 1;
        }
        return ellipsis;
    }

    private async getImageDataUrlForPdf(imageUrl: string | null): Promise<string | null> {
        if (!imageUrl) return null;
        const resolvedImageUrl = this.resolveImageUrlForPdf(imageUrl);
        if (!resolvedImageUrl) return null;

        const token = this.authService.getToken();
        const headers: HeadersInit = {};
        if (token) {
            headers['x-token'] = token;
        }

        try {
            const resp = await fetch(resolvedImageUrl, {
                mode: 'cors',
                credentials: 'include',
                headers
            });
            if (!resp.ok) throw new Error('Image fetch failed');
            const blob = await resp.blob();
            return URL.createObjectURL(blob);
        } catch (primaryError) {
            try {
                const fallbackResp = await fetch(resolvedImageUrl, { mode: 'cors', credentials: 'include' });
                if (!fallbackResp.ok) throw new Error('Image fallback fetch failed');
                const fallbackBlob = await fallbackResp.blob();
                return URL.createObjectURL(fallbackBlob);
            } catch {
                console.warn('[ProductDetail] No se pudo cargar imagen para PDF:', resolvedImageUrl, primaryError);
                return null;
            }
        }
    }

    private resolveImageUrlForPdf(imageUrl: string): string | null {
        const raw = String(imageUrl || '').trim();
        if (!raw) return null;

        if (raw.startsWith('data:') || raw.startsWith('blob:')) {
            return raw;
        }

        if (/^https?:\/\//i.test(raw)) {
            return raw;
        }

        if (raw.startsWith('//')) {
            const protocol = isPlatformBrowser(this.platformId) ? window.location.protocol : 'https:';
            return `${protocol}${raw}`;
        }

        // Las rutas de media del backend suelen venir relativas; forzamos API base.
        const normalizedPath = raw.startsWith('/') ? raw.slice(1) : raw;
        return buildApiUrl(normalizedPath);
    }

    private getRoundedCoverImageDataUrlForPdf(
        imageDataUrl: string,
        targetWidthMm: number,
        targetHeightMm: number,
        radiusMm: number
    ): Promise<string> {
        const cacheKey = `${imageDataUrl}|${targetWidthMm}|${targetHeightMm}|${radiusMm}`;
        const cached = this.roundedGalleryImageCache.get(cacheKey);
        if (cached) {
            return Promise.resolve(cached);
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const scale = 10;
                const targetW = Math.max(1, Math.round(targetWidthMm * scale));
                const targetH = Math.max(1, Math.round(targetHeightMm * scale));
                const radius = Math.max(2, Math.round(radiusMm * scale));

                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    this.roundedGalleryImageCache.set(cacheKey, imageDataUrl);
                    resolve(imageDataUrl);
                    return;
                }

                const targetRatio = targetW / targetH;
                const sourceRatio = img.width / img.height;

                let sx = 0;
                let sy = 0;
                let sw = img.width;
                let sh = img.height;

                if (sourceRatio > targetRatio) {
                    sw = img.height * targetRatio;
                    sx = (img.width - sw) / 2;
                } else if (sourceRatio < targetRatio) {
                    sh = img.width / targetRatio;
                    sy = (img.height - sh) / 2;
                }

                ctx.beginPath();
                ctx.moveTo(radius, 0);
                ctx.lineTo(targetW - radius, 0);
                ctx.quadraticCurveTo(targetW, 0, targetW, radius);
                ctx.lineTo(targetW, targetH - radius);
                ctx.quadraticCurveTo(targetW, targetH, targetW - radius, targetH);
                ctx.lineTo(radius, targetH);
                ctx.quadraticCurveTo(0, targetH, 0, targetH - radius);
                ctx.lineTo(0, radius);
                ctx.quadraticCurveTo(0, 0, radius, 0);
                ctx.closePath();
                ctx.clip();

                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
                const rounded = canvas.toDataURL('image/png');
                this.roundedGalleryImageCache.set(cacheKey, rounded);
                resolve(rounded);
            };

            img.onerror = () => {
                this.roundedGalleryImageCache.set(cacheKey, imageDataUrl);
                resolve(imageDataUrl);
            };

            img.src = imageDataUrl;
        });
    }

    private blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('No se pudo leer blob de imagen'));
            reader.readAsDataURL(blob);
        });
    }

    private slugifyForFilename(value: string): string {
        const trimmed = String(value || '').trim().toLowerCase();
        const normalized = trimmed
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return normalized || 'producto-artesanal';
    }

    private formatDateTime(date: Date | null): string {
        if (!date) return '';
        const pad = (n: number): string => String(n).padStart(2, '0');
        const day = pad(date.getDate());
        const month = pad(date.getMonth() + 1);
        const year = date.getFullYear();
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    private setPdfFont(doc: any, style: 'normal' | 'bold'): void {
        doc.setFont(this.pdfFontFamily, style);
    }

    private async tryRegisterPlusJakarta(doc: any): Promise<void> {
        this.pdfFontFamily = 'helvetica';

        try {
            if (!this.plusJakartaRegularBinary) {
                this.plusJakartaRegularBinary = await this.loadFontBinary('/assets/fonts/PlusJakartaSans-Regular.ttf');
            }
            if (!this.plusJakartaSemiBoldBinary) {
                this.plusJakartaSemiBoldBinary = await this.loadFontBinary('/assets/fonts/PlusJakartaSans-SemiBold.ttf');
            }

            doc.addFileToVFS('PlusJakartaSans-Regular.ttf', this.plusJakartaRegularBinary);
            doc.addFont('PlusJakartaSans-Regular.ttf', 'PlusJakartaSans', 'normal');
            doc.addFileToVFS('PlusJakartaSans-SemiBold.ttf', this.plusJakartaSemiBoldBinary);
            doc.addFont('PlusJakartaSans-SemiBold.ttf', 'PlusJakartaSans', 'bold');
            this.pdfFontFamily = 'PlusJakartaSans';
        } catch {
            this.pdfFontFamily = 'helvetica';
        }
    }

    private async loadFontBinary(url: string): Promise<string> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`No se pudo cargar fuente: ${url}`);
        const buffer = await response.arrayBuffer();
        return this.arrayBufferToBinaryString(buffer);
    }

    private arrayBufferToBinaryString(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        let result = '';

        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            result += String.fromCharCode(...chunk);
        }

        return result;
    }

    private drawPdfPageBackground(doc: any, imageDataUrl: string, pageWidth: number, pageHeight: number): void {
        doc.addImage(imageDataUrl, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    }

    private createPdfGradientBackgroundDataUrl(pageWidthMm: number, pageHeightMm: number): string {
        const mmToPx = 3.7795275591;
        const width = Math.max(1, Math.floor(pageWidthMm * mmToPx));
        const height = Math.max(1, Math.floor(pageHeightMm * mmToPx));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';

        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, width, height);

        this.drawRadialBlob(ctx, width * 0.18, height * 0.12, width * 0.78, height * 0.52, [235, 64, 33], 0.18, 0.12);
        this.drawRadialBlob(ctx, width * 0.8, height * 0.18, width * 0.7, height * 0.45, [147, 44, 141], 0.16, 0.12);
        this.drawRadialBlob(ctx, width * 0.5, height * 0.8, width * 0.7, height * 0.45, [55, 66, 154], 0.16, 0.12);

        return canvas.toDataURL('image/png');
    }

    private drawRadialBlob(
        ctx: CanvasRenderingContext2D,
        cx: number,
        cy: number,
        rx: number,
        ry: number,
        rgb: [number, number, number],
        alphaStart: number,
        alphaMid: number
    ): void {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        gradient.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alphaStart})`);
        gradient.addColorStop(0.7, `rgba(18, 18, 18, ${alphaMid})`);
        gradient.addColorStop(1, 'rgba(18, 18, 18, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Transformación automática a ePub
        async transformToEpub(): Promise<void> {
                this.closeDownloadMenu();
                if (!this.product) return;
                const JSZip = (await import('jszip')).default;
                const zip = new JSZip();
                const title = this.displayTitle || 'Producto';
                const description = this.displayDescription || '';
                const address = this.displayAddress || '';
                const owner = this.displayOwnerName || '';
                const contact = this.displayOwnerContact || '';
                const price = this.displayPrice || '';
                const historia = this.displayHistoriaOrigen || '';
                const importancia = this.displayImportanciaCultural || '';
                const proceso = this.displayProcesoElaboracion || '';
                const materias = this.displayMateriasPrimas || '';
                const tiempo = this.displayTiempoElaboracion || '';
                const certificaciones = this.displayCertificaciones || '';
                const media = this.displayMedia || [];

                // EPUB mimetype
                zip.file('mimetype', 'application/epub+zip');

                // META-INF/container.xml
                zip.file('META-INF/container.xml',
                        `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>`);

                // OEBPS/content.opf
                const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>${title}</dc:title>
        <dc:creator>${owner}</dc:creator>
        <dc:description>${description}</dc:description>
    </metadata>
    <manifest>
        <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
        ${media.map((url, i) => `<item id="img${i}" href="img${i}.jpg" media-type="image/jpeg"/>`).join('\n    ')}
    </manifest>
    <spine>
        <itemref idref="content"/>
    </spine>
</package>`;
                zip.folder('OEBPS')?.file('content.opf', opf);

                // OEBPS/content.xhtml
                let xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>${title}</title></head>
    <body>
        <h1>${title}</h1>
        <p><strong>Descripción:</strong> ${description}</p>
        <p><strong>Ubicación:</strong> ${address}</p>
        <p><strong>Artesano:</strong> ${owner}</p>
        <p><strong>Contacto:</strong> ${contact}</p>
        <p><strong>Origen e Historia:</strong> ${historia}</p>
        <p><strong>Importancia Cultural:</strong> ${importancia}</p>
        <p><strong>Materias Primas:</strong> ${materias}</p>
        <p><strong>Proceso de Elaboración:</strong> ${proceso}</p>
        <p><strong>Tiempo de Elaboración:</strong> ${tiempo}</p>
        <p><strong>Certificaciones:</strong> ${certificaciones}</p>
        <h2>Imágenes</h2>
        ${media.length > 0 ? media.map((url, i) => `<img src="img${i}.jpg" alt="Imagen ${i+1}" style="max-width:100%;height:auto;"/>`).join('\n    ') : '<p>No hay imágenes disponibles.</p>'}
    </body>
</html>`;

                zip.folder('OEBPS')?.file('content.xhtml', xhtml);

                // Añadir imágenes como archivos jpg
                for (let i = 0; i < media.length; i++) {
                        try {
                                const response = await fetch(media[i]);
                                const blob = await response.blob();
                                zip.folder('OEBPS')?.file(`img${i}.jpg`, blob);
                        } catch (e) {
                                // Si falla la imagen, se ignora
                        }
                }

                // Generar y descargar ePub
                zip.generateAsync({ type: 'blob' }).then((blob: Blob) => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `${title}.epub`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                });
        }
    private loadProductBySlug(slug: string): void {
        this.loading = true;
        this.error = null;
        const url = buildApiUrl(`products/slug/${slug}`);
        const token = this.authService.getToken();
        const options = token ? { headers: new HttpHeaders().set('x-token', token) } : undefined;
        this.http.get<any>(url, options).subscribe({
            next: (resp) => {
                if (!resp.ok || !resp.product) {
                    this.product = null;
                    this.loading = false;
                    this.error = resp.msg || 'Producto no encontrado.';
                    this.cdr.markForCheck();
                    return;
                }
                this.product = resp.product;
                this.activeTab = 'history';
                this.updateCarouselSlides();
                this.loadRelatedProducts(() => this.scheduleFullProductsWarmUp());
                this.initViewer3DIfAvailable();
                const seoTitle = this.product?.title || this.product?.name || 'Producto artesanal';
                const seoDesc = this.product?.description || `${seoTitle} - Producto artesanal con denominación de origen en ${this.product?.province || 'España'}.`;
                const seoImage = this.product?.image || (this.product?.media?.[0]) || 'https://noma.ovh/Logo_Noma.png';
                const seoUrl = `https://noma.ovh/producto/${this.product?.slug || ''}`;
                this.titleService.setTitle(`${seoTitle} - Noma`);
                this.metaService.updateTag({ name: 'description', content: seoDesc });
                this.metaService.updateTag({ property: 'og:title', content: `${seoTitle} - Noma` });
                this.metaService.updateTag({ property: 'og:description', content: seoDesc });
                this.metaService.updateTag({ property: 'og:image', content: seoImage });
                this.metaService.updateTag({ property: 'og:url', content: seoUrl });
                this.metaService.updateTag({ name: 'twitter:title', content: `${seoTitle} - Noma` });
                this.metaService.updateTag({ name: 'twitter:description', content: seoDesc });
                this.metaService.updateTag({ name: 'twitter:image', content: seoImage });
                const productId = this.getProductId();
                this.isFavorite = this.favoritesLoaded ? this.favoritesCache.has(productId) : false;
                this.syncFavoriteStatus();
                if (typeof window !== 'undefined') {
                    setTimeout(() => window.scrollTo(0, 0), 0);
                }
                this.loading = false;
                this.error = null;
                this.cdr.markForCheck();
            },
            error: (err) => {
                if (this.isMongoId(slug)) {
                    this.loadProductById(slug);
                    return;
                }
                this.product = null;
                this.loading = false;
                // Si el backend devuelve un mensaje, úsalo; si no, mensaje genérico
                let msg = 'Producto no encontrado.';
                if (err && err.error && err.error.msg) {
                    msg = err.error.msg;
                }
                this.error = msg;
                this.cdr.markForCheck();
            }
        });
    }

    private loadProductById(id: string): void {
        this.loading = true;
        this.error = null;
        const url = buildApiUrl(`products/${id}`);
        const token = this.authService.getToken();
        const options = token ? { headers: new HttpHeaders().set('x-token', token) } : undefined;
        this.http.get<any>(url, options).subscribe({
            next: (resp) => {
                if (!resp.ok || !resp.product) {
                    this.product = null;
                    this.loading = false;
                    this.error = resp.msg || 'Producto no encontrado.';
                    this.cdr.markForCheck();
                    return;
                }
                this.product = resp.product;
                this.activeTab = 'history';
                this.updateCarouselSlides();
                this.loadRelatedProducts(() => this.scheduleFullProductsWarmUp());
                this.initViewer3DIfAvailable();
                const seoTitle = this.product?.title || this.product?.name || 'Producto artesanal';
                const seoDesc = this.product?.description || `${seoTitle} - Producto artesanal con denominación de origen en ${this.product?.province || 'España'}.`;
                const seoImage = this.product?.image || (this.product?.media?.[0]) || 'https://noma.ovh/Logo_Noma.png';
                const seoUrl = `https://noma.ovh/producto/${this.product?.slug || ''}`;
                this.titleService.setTitle(`${seoTitle} - Noma`);
                this.metaService.updateTag({ name: 'description', content: seoDesc });
                this.metaService.updateTag({ property: 'og:title', content: `${seoTitle} - Noma` });
                this.metaService.updateTag({ property: 'og:description', content: seoDesc });
                this.metaService.updateTag({ property: 'og:image', content: seoImage });
                this.metaService.updateTag({ property: 'og:url', content: seoUrl });
                this.metaService.updateTag({ name: 'twitter:title', content: `${seoTitle} - Noma` });
                this.metaService.updateTag({ name: 'twitter:description', content: seoDesc });
                this.metaService.updateTag({ name: 'twitter:image', content: seoImage });
                const productId = this.getProductId();
                this.isFavorite = this.favoritesLoaded ? this.favoritesCache.has(productId) : false;
                this.syncFavoriteStatus();
                if (typeof window !== 'undefined') {
                    setTimeout(() => window.scrollTo(0, 0), 0);
                }
                this.loading = false;
                this.error = null;
                this.cdr.markForCheck();
            },
            error: () => {
                this.product = null;
                this.loading = false;
                this.error = 'Error al cargar el producto.';
                this.cdr.markForCheck();
            }
        });
    }

    private isMongoId(value: string): boolean {
        return /^[a-f0-9]{24}$/i.test(String(value || ''));
    }

    private scheduleFullProductsWarmUp(): void {
        if (!isPlatformBrowser(this.platformId) || typeof window === 'undefined') {
            return;
        }

        if (this.fullProductsWarmUpTimeoutId !== null) {
            window.clearTimeout(this.fullProductsWarmUpTimeoutId);
        }

        this.fullProductsWarmUpTimeoutId = window.setTimeout(() => {
            this.fullProductsWarmUpTimeoutId = null;
            this.mapProductDetailsHydrationService.warmUpFullProductsDataset();
        }, 0);
    }

    private cancelScheduledProductsWarmUp(): void {
        if (isPlatformBrowser(this.platformId) && typeof window !== 'undefined' && this.fullProductsWarmUpTimeoutId !== null) {
            window.clearTimeout(this.fullProductsWarmUpTimeoutId);
        }

        this.fullProductsWarmUpTimeoutId = null;
    }

    private initViewer3DIfAvailable(): void {
        if (!this.hasModel3d) {
            this.show3DViewer = false;
            return;
        }
        
        const modelUrl = this.getViewerModelUrl();
        if (!modelUrl) {
            this.show3DViewer = false;
            return;
        }
        
        this.viewerModelUrl = modelUrl;
        this.webglModelUrl = modelUrl;
        this.viewerType = 'threejs';
        this.show3DViewer = true;
        this.viewerLoading = true;
        this.viewerError = null;
        this.cdr.detectChanges();
        
        if (!isPlatformBrowser(this.platformId)) {
            this.viewerLoading = false;
            this.viewerError = 'El visor 3D solo funciona en el navegador.';
            return;
        }
        
        setTimeout(() => this.initViewer3D(), 0);
    }

    get hasModel3d(): boolean {
        const model = this.product?.model3d;
        if (!model) return false;

        return Boolean(
            model.url ||
            model.filename ||
            model.driveFileId ||
            model.sizeBytes ||
            model.uploadedAt
        );
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
                    slides.push({ src: mediaUrl, alt: altText });
                }
            });
        } else if (this.product.image) {
            slides.push({ src: this.product.image, alt: altText });
        }
        this.carouselSlides = slides;
    }

    get displayTitle(): string {
        return this.product?.title || this.product?.name || '';
    }
    get displayDescription(): string {
        return this.product?.description || '';
    }
    get displayPrice(): string {
        return this.product?.price ? `Precio: ${this.product.price}` : '';
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
    // Navegación a perfil de artesano ahora se hace con <a href> target="_blank" en la plantilla
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
    private getProductId(): string {
        return this.product?.uid || this.product?._id || '';
    }
    public isAuthenticated(): boolean {
        return !!this.authService.getToken();
    }

    // ─── Productos Relacionados ─────────────────────────────────────

    private loadRelatedProducts(onSettled?: () => void): void {
        const category = this.displayCategory;
        const currentId = this.getProductId();
        if (!category) {
            this.relatedProducts = [];
            onSettled?.();
            return;
        }
        this.relatedLoading = true;
        const url = buildApiUrl(`products?category=${encodeURIComponent(category)}&limit=14&sort=favorites`);
        this.http.get<any>(url).subscribe({
            next: (resp) => {
                const all: RelatedProduct[] = resp?.products || [];
                this.relatedProducts = all
                    .filter(p =>
                        p.category === category &&
                        p._id !== currentId &&
                        p.slug !== this.product?.slug
                    )
                    .slice(0, 12);
                this.relatedLoading = false;
                this.cdr.markForCheck();
                setTimeout(() => this.checkRelatedScrollable(), 80);
                onSettled?.();
            },
            error: () => {
                this.relatedProducts = [];
                this.relatedScrollable = false;
                this.relatedLoading = false;
                this.cdr.markForCheck();
                onSettled?.();
            }
        });
    }

    getRelatedImage(product: RelatedProduct): string {
        if (product.media && product.media.length > 0) return product.media[0];
        if (product.image) return product.image;
        return '/assets/default-product.png';
    }

    goToRelatedProduct(product: RelatedProduct, event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (product.slug) {
            this.router.navigate(['/producto', product.slug]);
        }
    }

    goToMapWithCategory(event?: Event): void {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        this.router.navigate(['/home'], {
            state: { preselectedCategory: this.displayCategory }
        });
    }

    scrollRelated(direction: 'left' | 'right'): void {
        const track = this.relatedTrackRef?.nativeElement;
        if (!track) return;
        const cardWidth = 244; // 14.5em aprox a 16px de base
        const scrollAmount = cardWidth * 3;
        track.scrollBy({
            left: direction === 'right' ? scrollAmount : -scrollAmount,
            behavior: 'smooth'
        });
    }

    private checkRelatedScrollable(): void {
        const track = this.relatedTrackRef?.nativeElement;
        const scrollable = track ? track.scrollWidth > track.clientWidth + 4 : false;
        if (scrollable !== this.relatedScrollable) {
            this.relatedScrollable = scrollable;
            this.cdr.markForCheck();
        }
    }
}
