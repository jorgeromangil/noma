import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { firstValueFrom, forkJoin, of, Subscription } from 'rxjs';
import { MapProductsCacheService } from '../../../../../services/map-products-cache.service';
import {
  AdminProduct,
  AdminProductsResponse,
  ProductMutationResponse,
  ProductosService
} from '../../services/productos.service';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { AdminManagedUser, AdminUsersService } from '../../services/admin-users.service';
import {
  ProductInventoryGridComponent,
  ProductInventoryPageChangeEvent,
  ProductInventoryViewMode
} from '../shared/product-inventory-grid/product-inventory-grid.component';
import {
  calculateResponsivePageSize,
  recalculatePageForPageSize
} from '../shared/responsive-page-size';
import { EditarProductoComponent } from '../mis-productos/editar-producto/editar-producto.component';
import { SubirProductoComponent } from '../subir-producto/subir-producto.component';

interface ConfirmDialogState {
  title: string;
  message: string;
  actionLabel: string;
  kind: 'primary' | 'danger';
  onConfirm: () => void;
}

interface BatchMutationResult {
  successIds: string[];
  failedIds: string[];
  failedMessages: string[];
}

interface PopupFeedback {
  title: string;
  message: string;
}

type PostMutationSelectionMode = 'failed-only' | 'preserve';
type ProductStatusFilter = 'all' | 'visible' | 'hidden';

@Component({
  selector: 'app-admin-products',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgSelectModule,
    ProductInventoryGridComponent,
    EditarProductoComponent,
    SubirProductoComponent
  ],
  templateUrl: './admin-products.component.html',
  styleUrl: './admin-products.component.css'
})
export class AdminProductsComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly ALL_FILTER_VALUE = '__all__';
  private static readonly VIEW_MODE_STORAGE_KEY = 'admin_products_view_mode';
  private static readonly PRODUCT_CARD_MIN_WIDTH_PX = 240;
  private static readonly PRODUCT_GRID_GAP_PX = 12.8;
  private static readonly RESPONSIVE_PAGE_ROWS = 2;
  private static readonly RESPONSIVE_FALLBACK_COLUMNS = 4;

  @Output() mostrarPopup = new EventEmitter<{ title: string; message: string }>();
  @ViewChild('inventoryPagerHost') private inventoryPagerHost?: ElementRef<HTMLElement>;

  productos: AdminProduct[] = [];
  productosFiltrados: AdminProduct[] = [];
  productosVisibles: AdminProduct[] = [];
  productosOcultos: AdminProduct[] = [];
  artesanos: AdminManagedUser[] = [];
  categoriaOptions: Array<{ value: string; label: string }> = [];
  artesanoFilterOptions: Array<{ value: string; label: string }> = [];
  provinciaOptions: Array<{ value: string; label: string }> = [];

  loading = false;
  loadingVisibleProducts = false;
  loadingHiddenProducts = false;
  loadingArtisans = false;
  mutationLoading = false;
  showCreatePopup = false;
  showEditarPopup = false;
  selectionMode = false;
  productoEditandoId: string | null = null;
  productoEditandoIndex: number | null = null;
  confirmDialog: ConfirmDialogState | null = null;
  selectedProductIds = new Set<string>();
  selectedStatus: ProductStatusFilter = 'all';
  selectedCategory = AdminProductsComponent.ALL_FILTER_VALUE;
  selectedArtisan = AdminProductsComponent.ALL_FILTER_VALUE;
  selectedProvince = AdminProductsComponent.ALL_FILTER_VALUE;
  searchQuery = '';
  viewMode: ProductInventoryViewMode = 'mosaic';
  visibleCurrentPage = 1;
  hiddenCurrentPage = 1;
  pageSize = 8;
  totalVisibleProducts = 0;
  totalHiddenProducts = 0;

  private artisansLoaded = false;
  private artisansCacheDirty = false;
  private editPopupReopenBlockedUntil = 0;
  private readonly subscriptions = new Subscription();
  private inventoryResizeObserver: ResizeObserver | null = null;
  private inventoryResizeFrame: number | null = null;
  private pendingResponsiveReload = false;
  private readonly categoryOrder = [
    'Alimentación',
    'Textil',
    'Barro y Alfarería',
    'Madera y mueble',
    'Otros'
  ];

  readonly statusOptions: Array<{ value: ProductStatusFilter; label: string }> = [
    { value: 'all', label: 'Todos los estados' },
    { value: 'visible', label: 'Visibles' },
    { value: 'hidden', label: 'Ocultos' }
  ];

  readonly viewModeOptions: Array<{
    value: ProductInventoryViewMode;
    label: string;
    icon: string;
    description: string;
  }> = [
    {
      value: 'mosaic',
      label: 'Mosaico',
      icon: 'grid_view',
      description: 'Visualiza las tarjetas del inventario.'
    },
    {
      value: 'table',
      label: 'Lista',
      icon: 'table_rows',
      description: 'Gestiona productos de forma más rápida.'
    }
  ];

  constructor(
    private authService: AuthService,
    private productosService: ProductosService,
    private adminUsersService: AdminUsersService,
    private mapProductsCacheService: MapProductsCacheService,
    private cdr: ChangeDetectorRef
  ) {}

  get selectedCount(): number {
    return this.selectedProductIds.size;
  }

  get hasSelection(): boolean {
    return this.selectedCount > 0;
  }

  get allFilteredSelected(): boolean {
    return this.productosFiltrados.length > 0
      && this.productosFiltrados.every((prod) => this.selectedProductIds.has(this.getProductId(prod)));
  }

  get selectedProducts(): AdminProduct[] {
    return this.productosFiltrados.filter((prod) => this.selectedProductIds.has(this.getProductId(prod)));
  }

  get selectedVisibleCount(): number {
    return this.selectedProducts.filter((prod) => !this.isProductHidden(prod)).length;
  }

  get selectedHiddenCount(): number {
    return this.selectedProducts.filter((prod) => this.isProductHidden(prod)).length;
  }

  get selectionDisabled(): boolean {
    return this.loading || this.mutationLoading;
  }

  get visibleTotalPages(): number {
    return Math.max(Math.ceil(this.totalVisibleProducts / this.pageSize), 1);
  }

  get hiddenTotalPages(): number {
    return Math.max(Math.ceil(this.totalHiddenProducts / this.pageSize), 1);
  }

  get visiblePagination() {
    return {
      currentPage: this.visibleCurrentPage,
      totalPages: this.visibleTotalPages,
      totalItems: this.totalVisibleProducts,
      pageSize: this.pageSize,
      disabled: this.loadingVisibleProducts || this.mutationLoading
    };
  }

  get hiddenPagination() {
    return {
      currentPage: this.hiddenCurrentPage,
      totalPages: this.hiddenTotalPages,
      totalItems: this.totalHiddenProducts,
      pageSize: this.pageSize,
      disabled: this.loadingHiddenProducts || this.mutationLoading
    };
  }

  ngOnInit(): void {
    this.restoreViewModePreference();
    this.ensureArtisansLoaded(false);

    this.subscriptions.add(
      this.adminUsersService.usersChanged$.subscribe(() => {
        this.artisansCacheDirty = true;
      })
    );
  }

  ngAfterViewInit(): void {
    this.updateResponsivePageSize(false);
    this.setupInventoryResizeObserver();
    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.teardownInventoryResizeObserver();
  }

  applyFiltersFromControls(): void {
    this.resetSectionPages();
    this.loadProducts();
  }

  abrirCrearProducto(): void {
    if (this.loadingArtisans) {
      return;
    }

    if (this.artisansLoaded && !this.artisansCacheDirty) {
      this.openCreatePopupIfPossible();
      return;
    }

    this.ensureArtisansLoaded(true);
  }

  cerrarCrearProducto(): void {
    this.showCreatePopup = false;
    this.cdr.detectChanges();
  }

  abrirEditarProducto(prod: AdminProduct, index: number): void {
    if (Date.now() < this.editPopupReopenBlockedUntil) {
      return;
    }

    this.productoEditandoId = this.getProductId(prod) || null;
    this.productoEditandoIndex = index;
    this.showEditarPopup = true;
    this.cdr.detectChanges();
  }

  cerrarEditarPopup(): void {
    this.editPopupReopenBlockedUntil = Date.now() + 250;
    this.showEditarPopup = false;
    this.productoEditandoId = null;
    this.productoEditandoIndex = null;
    this.cdr.detectChanges();
  }

  onProductoCreadoExitosamente(): void {
    this.showCreatePopup = false;
    this.loadProducts();
  }

  onProductoActualizado(productoActualizado: AdminProduct): void {
    if (productoActualizado) {
      this.replaceProduct(productoActualizado);
      this.rebuildFilterOptions();
      this.applyFilters();
    }

    this.cerrarEditarPopup();
    this.loadProducts();
    this.cdr.detectChanges();
  }

  toggleProductSelection(prod: AdminProduct, selected: boolean): void {
    if (this.selectionDisabled) {
      return;
    }

    const id = this.getProductId(prod);
    if (!id) {
      return;
    }

    const nextSelection = new Set(this.selectedProductIds);
    if (selected) {
      nextSelection.add(id);
    } else {
      nextSelection.delete(id);
    }

    this.selectedProductIds = nextSelection;
    this.cdr.detectChanges();
  }

  openSelectionMode(): void {
    if (this.selectionDisabled || this.productosFiltrados.length === 0) {
      return;
    }

    this.selectionMode = true;
    this.cdr.detectChanges();
  }

  closeSelectionMode(): void {
    if (this.selectionDisabled) {
      return;
    }

    this.selectionMode = false;
    this.selectedProductIds = new Set<string>();
    this.confirmDialog = null;
    this.cdr.detectChanges();
  }

  selectAllFilteredProducts(): void {
    if (this.selectionDisabled || this.productosFiltrados.length === 0) {
      return;
    }

    this.selectedProductIds = new Set(
      this.productosFiltrados
        .map((prod) => this.getProductId(prod))
        .filter((id): id is string => Boolean(id))
    );
    this.cdr.detectChanges();
  }

  clearSelection(): void {
    if (this.selectionDisabled || this.selectedProductIds.size === 0) {
      return;
    }

    this.selectedProductIds = new Set<string>();
    this.cdr.detectChanges();
  }

  solicitarEliminarProducto(prod: AdminProduct): void {
    if (this.selectionDisabled) {
      return;
    }

    const id = this.getProductId(prod);
    if (!id || id === 'undefined') {
      this.mostrarPopup.emit({
        title: 'Error',
        message: 'No se pudo encontrar el ID del producto.'
      });
      return;
    }

    this.confirmDialog = {
      title: 'Eliminar producto',
      message: '¿Estás seguro de que deseas eliminar este producto?',
      actionLabel: 'Eliminar',
      kind: 'danger',
      onConfirm: () => {
        void this.executeDeleteMutation([id], 'preserve');
      }
    };
    this.cdr.detectChanges();
  }

  requestBulkDelete(): void {
    if (this.selectionDisabled || !this.hasSelection) {
      return;
    }

    this.confirmDialog = {
      title: 'Eliminar productos seleccionados',
      message: this.selectedCount === 1
        ? '¿Estás seguro de que deseas eliminar el producto seleccionado?'
        : `¿Estás seguro de que deseas eliminar los ${this.selectedCount} productos seleccionados?`,
      actionLabel: 'Eliminar',
      kind: 'danger',
      onConfirm: () => {
        void this.executeDeleteMutation([...this.selectedProductIds], 'failed-only');
      }
    };
    this.cdr.detectChanges();
  }

  closeConfirmDialog(): void {
    if (this.mutationLoading) {
      return;
    }

    this.confirmDialog = null;
    this.cdr.detectChanges();
  }

  confirmCurrentAction(): void {
    this.confirmDialog?.onConfirm();
  }

  toggleProductVisibility(prod: AdminProduct): void {
    if (this.selectionDisabled) {
      return;
    }

    const id = this.getProductId(prod);
    if (!id) {
      return;
    }

    void this.executeVisibilityMutation([id], this.isProductHidden(prod), 'preserve');
  }

  executeBulkVisibility(active: boolean): void {
    if (this.selectionDisabled) {
      return;
    }

    const ids = this.getSelectedIdsForVisibility(active);
    if (ids.length === 0) {
      return;
    }

    void this.executeVisibilityMutation(ids, active, 'failed-only');
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.selectedStatus = 'all';
    this.selectedCategory = AdminProductsComponent.ALL_FILTER_VALUE;
    this.selectedArtisan = AdminProductsComponent.ALL_FILTER_VALUE;
    this.selectedProvince = AdminProductsComponent.ALL_FILTER_VALUE;
    this.resetSectionPages();
    this.loadProducts();
  }

  setSectionPage(event: ProductInventoryPageChangeEvent): void {
    if (this.mutationLoading) {
      return;
    }

    if (event.section === 'hidden') {
      if (this.loadingHiddenProducts || event.page < 1 || event.page > this.hiddenTotalPages || event.page === this.hiddenCurrentPage) {
        return;
      }

      this.hiddenCurrentPage = event.page;
    } else {
      if (this.loadingVisibleProducts || event.page < 1 || event.page > this.visibleTotalPages || event.page === this.visibleCurrentPage) {
        return;
      }

      this.visibleCurrentPage = event.page;
    }

    this.loadProducts(event.section);
  }

  setViewMode(mode: ProductInventoryViewMode): void {
    if (this.viewMode === mode) {
      return;
    }

    this.viewMode = mode;
    this.persistViewModePreference();
    this.cdr.detectChanges();
  }

  private loadProducts(scope: ProductStatusFilter = 'all'): void {
    this.loading = true;
    const token = this.authService.getToken() || '';
    const loadVisible = this.selectedStatus !== 'hidden' && (scope === 'all' || scope === 'visible');
    const loadHidden = this.selectedStatus !== 'visible' && (scope === 'all' || scope === 'hidden');

    if (loadVisible) {
      this.loadingVisibleProducts = true;
      this.productosVisibles = [];
    } else if (scope === 'all' && this.selectedStatus === 'hidden') {
      this.totalVisibleProducts = 0;
      this.productosVisibles = [];
      this.loadingVisibleProducts = false;
    }

    if (loadHidden) {
      this.loadingHiddenProducts = true;
      this.productosOcultos = [];
    } else if (scope === 'all' && this.selectedStatus === 'visible') {
      this.totalHiddenProducts = 0;
      this.productosOcultos = [];
      this.loadingHiddenProducts = false;
    }

    this.syncProductCollections(false);
    this.cdr.detectChanges();

    forkJoin({
      visible: loadVisible
        ? this.productosService.obtenerProductosAdmin(token, this.buildServerFilters('visible', this.visibleCurrentPage))
        : of(null),
      hidden: loadHidden
        ? this.productosService.obtenerProductosAdmin(token, this.buildServerFilters('hidden', this.hiddenCurrentPage))
        : of(null)
    }).subscribe({
      next: ({ visible, hidden }) => {
        const visibleProducts = visible ? this.extractResponseProducts(visible) : this.productosVisibles;
        const hiddenProducts = hidden ? this.extractResponseProducts(hidden) : this.productosOcultos;
        const nextTotalVisibleProducts = visible
          ? this.extractResponseTotal(visible, visibleProducts)
          : this.totalVisibleProducts;
        const nextTotalHiddenProducts = hidden
          ? this.extractResponseTotal(hidden, hiddenProducts)
          : this.totalHiddenProducts;
        const nextVisibleTotalPages = Math.max(Math.ceil(nextTotalVisibleProducts / this.pageSize), 1);
        const nextHiddenTotalPages = Math.max(Math.ceil(nextTotalHiddenProducts / this.pageSize), 1);

        if (
          (loadVisible && this.visibleCurrentPage > nextVisibleTotalPages)
          || (loadHidden && this.hiddenCurrentPage > nextHiddenTotalPages)
        ) {
          if (loadVisible && this.visibleCurrentPage > nextVisibleTotalPages) {
            this.visibleCurrentPage = nextVisibleTotalPages;
          }
          if (loadHidden && this.hiddenCurrentPage > nextHiddenTotalPages) {
            this.hiddenCurrentPage = nextHiddenTotalPages;
          }
          this.loadProducts(scope);
          return;
        }

        if (visible) {
          this.productosVisibles = visibleProducts;
          this.totalVisibleProducts = nextTotalVisibleProducts;
          this.loadingVisibleProducts = false;
        }

        if (hidden) {
          this.productosOcultos = hiddenProducts;
          this.totalHiddenProducts = nextTotalHiddenProducts;
          this.loadingHiddenProducts = false;
        }

        this.syncProductCollections();
        this.rebuildFilterOptions(visible?.facets ? visible : (hidden || undefined));
        this.syncSelectionModeVisibility();
        this.loading = this.loadingVisibleProducts || this.loadingHiddenProducts;
        if (this.runPendingResponsiveReloadIfNeeded()) {
          return;
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (loadVisible) {
          this.loadingVisibleProducts = false;
        }
        if (loadHidden) {
          this.loadingHiddenProducts = false;
        }
        this.loading = this.loadingVisibleProducts || this.loadingHiddenProducts;
        this.mostrarPopup.emit({
          title: 'Error',
          message: err?.error?.msg || 'No se pudo cargar la lista de productos.'
        });
        this.cdr.detectChanges();
      }
    });
  }

  private ensureArtisansLoaded(openWhenReady: boolean = false): void {
    if (this.loadingArtisans) {
      return;
    }

    this.loadingArtisans = true;
    const request$ = this.artisansCacheDirty
      ? this.adminUsersService.getUsers({ forceRefresh: true })
      : this.adminUsersService.getUsers();

    request$.subscribe({
      next: (users) => {
        this.artesanos = (Array.isArray(users) ? users : []).filter((user) => (
          user.role === 'artisan' && user.active !== false
        ));
        this.artisansLoaded = true;
        this.artisansCacheDirty = false;
        this.loadingArtisans = false;
        this.rebuildFilterOptions();

        if (openWhenReady) {
          this.openCreatePopupIfPossible();
        }

        this.cdr.detectChanges();
      },
      error: (err) => {
        this.loadingArtisans = false;
        this.artesanos = [];
        this.artisansLoaded = false;
        this.mostrarPopup.emit({
          title: 'Error',
          message: err?.error?.msg || 'No se pudieron cargar los artesanos disponibles.'
        });
        this.cdr.detectChanges();
      }
    });
  }

  private isProductHidden(prod: AdminProduct): boolean {
    return prod?.active === false;
  }

  private applyFilters(): void {
    this.productosFiltrados = [...this.productos];
    this.productosVisibles = this.productosFiltrados.filter((prod) => !this.isProductHidden(prod));
    this.productosOcultos = this.productosFiltrados.filter((prod) => this.isProductHidden(prod));
    this.pruneSelectionToFilteredProducts();
  }

  private syncProductCollections(pruneSelection = true): void {
    this.productos = [...this.productosVisibles, ...this.productosOcultos];
    this.productosFiltrados = [...this.productos];
    if (pruneSelection) {
      this.pruneSelectionToFilteredProducts();
    }
  }

  private pruneSelectionToFilteredProducts(): void {
    if (this.selectedProductIds.size === 0) {
      return;
    }

    const allowedIds = new Set(
      this.productosFiltrados
        .map((prod) => this.getProductId(prod))
        .filter((id): id is string => Boolean(id))
    );

    this.selectedProductIds = new Set(
      [...this.selectedProductIds].filter((id) => allowedIds.has(id))
    );
  }

  private syncSelectionModeVisibility(): void {
    if (this.selectionMode && this.productos.length === 0) {
      this.selectionMode = false;
    }
  }

  private openCreatePopupIfPossible(): void {
    if (this.artesanos.length === 0) {
      this.mostrarPopup.emit({
        title: 'Sin artesanos disponibles',
        message: 'No hay artesanos activos disponibles para asignar el producto.'
      });
      return;
    }

    this.showCreatePopup = true;
    this.cdr.detectChanges();
  }

  private resetSectionPages(): void {
    this.visibleCurrentPage = 1;
    this.hiddenCurrentPage = 1;
  }

  private setupInventoryResizeObserver(): void {
    const element = this.inventoryPagerHost?.nativeElement;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }

    this.inventoryResizeObserver = new ResizeObserver(() => {
      if (this.inventoryResizeFrame !== null) {
        cancelAnimationFrame(this.inventoryResizeFrame);
      }

      this.inventoryResizeFrame = requestAnimationFrame(() => {
        this.inventoryResizeFrame = null;
        this.handleResponsivePageSizeChange();
      });
    });

    this.inventoryResizeObserver.observe(element);
  }

  private teardownInventoryResizeObserver(): void {
    this.inventoryResizeObserver?.disconnect();
    this.inventoryResizeObserver = null;

    if (this.inventoryResizeFrame !== null) {
      cancelAnimationFrame(this.inventoryResizeFrame);
      this.inventoryResizeFrame = null;
    }
  }

  private handleResponsivePageSizeChange(): void {
    const changed = this.updateResponsivePageSize(true);
    if (!changed) {
      return;
    }

    if (this.loading || this.loadingVisibleProducts || this.loadingHiddenProducts || this.mutationLoading) {
      this.pendingResponsiveReload = true;
      this.cdr.detectChanges();
      return;
    }

    this.loadProducts();
  }

  private updateResponsivePageSize(preservePosition: boolean): boolean {
    const nextPageSize = calculateResponsivePageSize({
      containerWidth: this.getInventoryContainerWidth(),
      minItemWidth: AdminProductsComponent.PRODUCT_CARD_MIN_WIDTH_PX,
      gap: AdminProductsComponent.PRODUCT_GRID_GAP_PX,
      rows: AdminProductsComponent.RESPONSIVE_PAGE_ROWS,
      fallbackColumns: AdminProductsComponent.RESPONSIVE_FALLBACK_COLUMNS
    });

    if (nextPageSize === this.pageSize) {
      return false;
    }

    const previousPageSize = this.pageSize;
    this.pageSize = nextPageSize;

    if (preservePosition) {
      this.visibleCurrentPage = recalculatePageForPageSize(
        this.visibleCurrentPage,
        previousPageSize,
        nextPageSize
      );
      this.hiddenCurrentPage = recalculatePageForPageSize(
        this.hiddenCurrentPage,
        previousPageSize,
        nextPageSize
      );
      this.clampSectionPages();
    }

    return true;
  }

  private getInventoryContainerWidth(): number {
    const element = this.inventoryPagerHost?.nativeElement;
    if (!element) {
      return 0;
    }

    const bounds = element.getBoundingClientRect();
    return Math.max(bounds.width || 0, element.clientWidth || 0);
  }

  private clampSectionPages(): void {
    this.visibleCurrentPage = Math.min(
      Math.max(this.visibleCurrentPage, 1),
      Math.max(Math.ceil(this.totalVisibleProducts / this.pageSize), 1)
    );
    this.hiddenCurrentPage = Math.min(
      Math.max(this.hiddenCurrentPage, 1),
      Math.max(Math.ceil(this.totalHiddenProducts / this.pageSize), 1)
    );
  }

  private runPendingResponsiveReloadIfNeeded(): boolean {
    if (!this.pendingResponsiveReload) {
      return false;
    }

    this.pendingResponsiveReload = false;
    this.loadProducts();
    return true;
  }

  private buildServerFilters(status: 'visible' | 'hidden', page: number) {
    return {
      q: this.searchQuery.trim() || undefined,
      owner: this.selectedArtisan !== AdminProductsComponent.ALL_FILTER_VALUE ? this.selectedArtisan : undefined,
      category: this.selectedCategory !== AdminProductsComponent.ALL_FILTER_VALUE ? this.selectedCategory : undefined,
      province: this.selectedProvince !== AdminProductsComponent.ALL_FILTER_VALUE ? this.selectedProvince : undefined,
      status,
      from: (page - 1) * this.pageSize,
      recordsPerPage: this.pageSize
    };
  }

  private extractResponseProducts(resp: AdminProductsResponse): AdminProduct[] {
    return Array.isArray(resp?.products) ? resp.products : [];
  }

  private extractResponseTotal(resp: AdminProductsResponse, products: AdminProduct[]): number {
    return Number(resp?.page?.total ?? resp?.total ?? products.length);
  }

  private rebuildFilterOptions(resp?: AdminProductsResponse): void {
    const categoriasSet = new Set<string>(resp?.facets?.categories || []);
    const provincesSet = new Set<string>(resp?.facets?.provinces || []);
    const ownersMap = new Map<string, string>();

    this.productos.forEach((prod) => {
      const category = String(prod?.category || '').trim();
      const province = String(prod?.province || '').trim();
      const ownerId = this.getOwnerId(prod);
      const ownerLabel = this.getOwnerLabel(prod);

      if (category) {
        categoriasSet.add(category);
      }

      if (province) {
        provincesSet.add(province);
      }

      if (ownerId && ownerLabel) {
        ownersMap.set(ownerId, ownerLabel);
      }
    });

    this.artesanos.forEach((artisan) => {
      const ownerId = String(artisan.uid || '').trim();
      const ownerLabel = this.getUserOwnerLabel(artisan);
      if (ownerId && ownerLabel) {
        ownersMap.set(ownerId, ownerLabel);
      }
    });

    const orderedCategories = [
      ...this.categoryOrder.filter((category) => categoriasSet.has(category)),
      ...[...categoriasSet]
        .filter((category) => !this.categoryOrder.includes(category))
        .sort((a, b) => a.localeCompare(b, 'es'))
    ];

    this.categoriaOptions = [
      { value: AdminProductsComponent.ALL_FILTER_VALUE, label: 'Todas' },
      ...orderedCategories.map((category) => ({
        value: category,
        label: category
      }))
    ];

    this.artesanoFilterOptions = [
      { value: AdminProductsComponent.ALL_FILTER_VALUE, label: 'Todos' },
      ...[...ownersMap.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es'))
    ];

    this.provinciaOptions = [
      { value: AdminProductsComponent.ALL_FILTER_VALUE, label: 'Todas' },
      ...[...provincesSet]
        .sort((a, b) => a.localeCompare(b, 'es'))
        .map((province) => ({
          value: province,
          label: province
        }))
    ];

    if (
      this.selectedCategory !== AdminProductsComponent.ALL_FILTER_VALUE
      && !this.categoriaOptions.some((option) => option.value === this.selectedCategory)
    ) {
      this.selectedCategory = AdminProductsComponent.ALL_FILTER_VALUE;
    }

    if (
      this.selectedArtisan !== AdminProductsComponent.ALL_FILTER_VALUE
      && !this.artesanoFilterOptions.some((option) => option.value === this.selectedArtisan)
    ) {
      this.selectedArtisan = AdminProductsComponent.ALL_FILTER_VALUE;
    }

    if (
      this.selectedProvince !== AdminProductsComponent.ALL_FILTER_VALUE
      && !this.provinciaOptions.some((option) => option.value === this.selectedProvince)
    ) {
      this.selectedProvince = AdminProductsComponent.ALL_FILTER_VALUE;
    }
  }

  private async executeVisibilityMutation(
    ids: string[],
    active: boolean,
    selectionMode: PostMutationSelectionMode
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    this.mutationLoading = true;
    this.cdr.detectChanges();

    try {
      const result = await this.updateProductsVisibilityByIds(ids, active);
      this.handleBatchMutationCompletion(
        result,
        selectionMode,
        this.buildVisibilityFeedback(result, active)
      );
    } catch (error) {
      this.handleUnexpectedMutationError(
        this.extractErrorMessage(
          error,
          active ? 'No se pudieron mostrar los productos seleccionados.' : 'No se pudieron ocultar los productos seleccionados.'
        )
      );
    }
  }

  private async executeDeleteMutation(
    ids: string[],
    selectionMode: PostMutationSelectionMode
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    this.mutationLoading = true;
    this.cdr.detectChanges();

    try {
      const result = await this.deleteProductsByIds(ids);
      this.handleBatchMutationCompletion(
        result,
        selectionMode,
        this.buildDeleteFeedback(result)
      );
    } catch (error) {
      this.handleUnexpectedMutationError(
        this.extractErrorMessage(error, 'No se pudieron eliminar los productos seleccionados.')
      );
    }
  }

  private async updateProductsVisibilityByIds(
    ids: string[],
    active: boolean
  ): Promise<BatchMutationResult> {
    const token = this.authService.getToken() || '';
    const result: BatchMutationResult = {
      successIds: [],
      failedIds: [],
      failedMessages: []
    };

    for (const id of ids) {
      try {
        const response = await firstValueFrom(
          this.productosService.actualizarProducto(id, { active }, token)
        );
        const normalizedResponse = this.ensureSuccessfulResponse(
          response,
          'No se pudo actualizar el producto.'
        );

        this.replaceProduct(normalizedResponse.product || this.buildFallbackUpdatedProduct(id, active));
        result.successIds.push(id);
      } catch (error) {
        result.failedIds.push(id);
        result.failedMessages.push(
          this.extractErrorMessage(error, 'No se pudo actualizar el producto.')
        );
      }
    }

    return result;
  }

  private async deleteProductsByIds(ids: string[]): Promise<BatchMutationResult> {
    const token = this.authService.getToken() || '';
    const result: BatchMutationResult = {
      successIds: [],
      failedIds: [],
      failedMessages: []
    };

    for (const id of ids) {
      try {
        const response = await firstValueFrom(this.productosService.eliminarProducto(id, token));
        this.ensureSuccessfulResponse(response, 'No se pudo eliminar el producto.');
        result.successIds.push(id);
      } catch (error) {
        result.failedIds.push(id);
        result.failedMessages.push(
          this.extractErrorMessage(error, 'No se pudo eliminar el producto.')
        );
      }
    }

    if (result.successIds.length > 0) {
      const deletedIds = new Set(result.successIds);
      this.productos = this.productos.filter((prod) => !deletedIds.has(this.getProductId(prod)));
    }

    return result;
  }

  private ensureSuccessfulResponse(
    response: ProductMutationResponse,
    fallbackMessage: string
  ): ProductMutationResponse {
    if (!response?.ok) {
      throw new Error(response?.msg || fallbackMessage);
    }

    return response;
  }

  private handleBatchMutationCompletion(
    result: BatchMutationResult,
    selectionMode: PostMutationSelectionMode,
    feedback: PopupFeedback
  ): void {
    this.updateSelectionAfterMutation(result, selectionMode);

    if (result.successIds.length > 0) {
      this.rebuildFilterOptions();
      this.applyFilters();
      this.syncSelectionModeVisibility();
    } else {
      this.pruneSelectionToFilteredProducts();
    }

    const finish = () => {
      this.mutationLoading = false;
      this.confirmDialog = null;
      this.mostrarPopup.emit(feedback);
      if (result.successIds.length > 0) {
        this.loadProducts();
      }
      this.cdr.detectChanges();
    };

    if (result.successIds.length > 0) {
      this.syncMapCacheAndRun(finish);
      return;
    }

    finish();
  }

  private handleUnexpectedMutationError(message: string): void {
    this.mutationLoading = false;
    this.confirmDialog = null;
    this.mostrarPopup.emit({
      title: 'Error',
      message
    });
    this.cdr.detectChanges();
  }

  private updateSelectionAfterMutation(
    result: BatchMutationResult,
    mode: PostMutationSelectionMode
  ): void {
    if (mode === 'failed-only') {
      this.selectedProductIds = new Set(result.failedIds);
      return;
    }

    const successSet = new Set(result.successIds);
    this.selectedProductIds = new Set(
      [...this.selectedProductIds].filter((id) => !successSet.has(id))
    );
  }

  private getSelectedIdsForVisibility(active: boolean): string[] {
    return this.selectedProducts
      .filter((prod) => active ? this.isProductHidden(prod) : !this.isProductHidden(prod))
      .map((prod) => this.getProductId(prod))
      .filter((id): id is string => Boolean(id));
  }

  private buildFallbackUpdatedProduct(id: string, active: boolean): AdminProduct {
    const currentProduct = this.productos.find((prod) => this.getProductId(prod) === id);
    return {
      ...(currentProduct || { _id: id }),
      active
    };
  }

  private replaceProduct(product: AdminProduct): void {
    const id = this.getProductId(product);
    if (!id) {
      return;
    }

    const idx = this.productos.findIndex((item) => this.getProductId(item) === id);
    if (idx !== -1) {
      this.productos[idx] = {
        ...this.productos[idx],
        ...product
      };
    }
  }

  private buildVisibilityFeedback(
    result: BatchMutationResult,
    active: boolean
  ): PopupFeedback {
    const successCount = result.successIds.length;
    const failedCount = result.failedIds.length;
    const actionLabel = active
      ? { singular: 'mostrado', plural: 'mostrados', infinitive: 'mostrar' }
      : { singular: 'ocultado', plural: 'ocultados', infinitive: 'ocultar' };

    if (successCount > 0 && failedCount === 0) {
      return {
        title: successCount === 1 ? 'Producto actualizado' : 'Productos actualizados',
        message: `${this.describeProductCount(successCount)} ${successCount === 1 ? 'ha sido' : 'han sido'} ${successCount === 1 ? actionLabel.singular : actionLabel.plural} correctamente.`
      };
    }

    if (successCount > 0) {
      return {
        title: 'Actualización parcial',
        message: `${this.describeProductCount(successCount)} ${successCount === 1 ? 'ha sido' : 'han sido'} ${successCount === 1 ? actionLabel.singular : actionLabel.plural} correctamente. No se pudieron ${actionLabel.infinitive} ${this.describeProductCount(failedCount)}.${this.buildFailureDetails(result)}`
      };
    }

    return {
      title: 'Error',
      message: `No se pudieron ${actionLabel.infinitive} ${this.describeProductCount(failedCount)}.${this.buildFailureDetails(result)}`
    };
  }

  private buildDeleteFeedback(result: BatchMutationResult): PopupFeedback {
    const successCount = result.successIds.length;
    const failedCount = result.failedIds.length;

    if (successCount > 0 && failedCount === 0) {
      return {
        title: successCount === 1 ? 'Producto eliminado' : 'Productos eliminados',
        message: `${this.describeProductCount(successCount)} ${successCount === 1 ? 'se ha eliminado' : 'se han eliminado'} correctamente.`
      };
    }

    if (successCount > 0) {
      return {
        title: 'Eliminación parcial',
        message: `${this.describeProductCount(successCount)} ${successCount === 1 ? 'se ha eliminado' : 'se han eliminado'} correctamente. No se pudieron eliminar ${this.describeProductCount(failedCount)}.${this.buildFailureDetails(result)}`
      };
    }

    return {
      title: 'Error',
      message: `No se pudieron eliminar ${this.describeProductCount(failedCount)}.${this.buildFailureDetails(result)}`
    };
  }

  private buildFailureDetails(result: BatchMutationResult): string {
    const uniqueMessages = [...new Set(
      result.failedMessages
        .map((message) => String(message || '').trim())
        .filter(Boolean)
    )];

    if (uniqueMessages.length === 0) {
      return '';
    }

    return ` Detalle: ${uniqueMessages.slice(0, 2).join(' ')}`;
  }

  private describeProductCount(count: number): string {
    return count === 1 ? '1 producto' : `${count} productos`;
  }

  private restoreViewModePreference(): void {
    const storedMode = this.getStorage()?.getItem(AdminProductsComponent.VIEW_MODE_STORAGE_KEY);
    if (storedMode === 'mosaic' || storedMode === 'table') {
      this.viewMode = storedMode;
    }
  }

  private persistViewModePreference(): void {
    this.getStorage()?.setItem(AdminProductsComponent.VIEW_MODE_STORAGE_KEY, this.viewMode);
  }

  private extractErrorMessage(error: any, fallback: string): string {
    return error?.error?.msg || error?.message || fallback;
  }

  private getProductId(prod: AdminProduct): string {
    return String(prod?._id || prod?.uid || prod?.id || '').trim();
  }

  private getOwnerId(prod: AdminProduct): string {
    return String(prod?.owner?.uid || prod?.owner?._id || '').trim();
  }

  private getOwnerLabel(prod: AdminProduct): string {
    const companyName = String(prod?.owner?.company_name || '').trim();
    if (companyName) {
      return companyName;
    }

    return [prod?.owner?.name, prod?.owner?.surname]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  private getUserOwnerLabel(user: AdminManagedUser): string {
    const companyName = String(user?.company_name || '').trim();
    if (companyName) {
      return companyName;
    }

    return [user?.name, user?.surname]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  private syncMapCacheAndRun(callback: () => void): void {
    this.mapProductsCacheService.refreshCacheAfterMutation().subscribe({
      next: () => callback()
    });
  }

  private getStorage(): Storage | null {
    try {
      return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
    } catch {
      return null;
    }
  }

  
}
