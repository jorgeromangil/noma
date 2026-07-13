import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { AdminProductsComponent } from './admin-products.component';
import { AdminProduct, ProductosService } from '../../services/productos.service';
import { AdminUsersService } from '../../services/admin-users.service';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { MapProductsCacheService } from '../../../../../services/map-products-cache.service';

describe('AdminProductsComponent', () => {
  const viewModeStorageKey = 'admin_products_view_mode';
  let component: AdminProductsComponent;
  let fixture: ComponentFixture<AdminProductsComponent>;
  let productosServiceSpy: jasmine.SpyObj<ProductosService>;
  let adminUsersServiceSpy: jasmine.SpyObj<AdminUsersService>;
  let mapProductsCacheServiceSpy: jasmine.SpyObj<MapProductsCacheService>;
  let productsState: AdminProduct[];

  const buildProducts = (): AdminProduct[] => ([
    {
      _id: 'prod-visible',
      name: 'Jarron azul',
      category: 'Textil',
      province: 'Valencia',
      active: true,
      media: ['visible.jpg'],
      owner: {
        uid: 'artisan-1',
        name: 'Mario',
        surname: 'Moya',
        company_name: 'Taller Moya'
      }
    },
    {
      _id: 'prod-hidden',
      name: 'Cuenco rojo',
      category: 'Otros',
      province: 'Sevilla',
      active: false,
      media: ['hidden.jpg'],
      owner: {
        uid: 'artisan-2',
        name: 'Lucia',
        surname: 'Lopez',
        company_name: 'Barro Lopez'
      }
    }
  ]);

  const flushAsync = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(async () => {
    localStorage.removeItem(viewModeStorageKey);
    productsState = buildProducts();

    const usersChanged$ = new Subject<void>();

    productosServiceSpy = jasmine.createSpyObj<ProductosService>(
      'ProductosService',
      ['obtenerProductosAdmin', 'actualizarProducto', 'eliminarProducto']
    );
    adminUsersServiceSpy = jasmine.createSpyObj<AdminUsersService>(
      'AdminUsersService',
      ['getUsers'],
      { usersChanged$: usersChanged$.asObservable() }
    );
    mapProductsCacheServiceSpy = jasmine.createSpyObj<MapProductsCacheService>(
      'MapProductsCacheService',
      ['refreshCacheAfterMutation']
    );

    productosServiceSpy.obtenerProductosAdmin.and.callFake((_token: string, filters: any = {}) => {
      const normalize = (value: string): string => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
      const query = normalize(filters.q || '');
      let products = productsState.filter((prod) => (
        filters.status === 'hidden' ? prod.active === false : prod.active !== false
      ));

      if (filters.owner) {
        products = products.filter((prod) => prod.owner?.uid === filters.owner);
      }

      if (filters.category) {
        products = products.filter((prod) => prod.category === filters.category);
      }

      if (filters.province) {
        products = products.filter((prod) => prod.province === filters.province);
      }

      if (query) {
        products = products.filter((prod) => normalize([
          prod.name,
          prod.category,
          prod.province,
          prod.owner?.name,
          prod.owner?.surname,
          prod.owner?.company_name
        ].filter(Boolean).join(' ')).includes(query));
      }

      const total = products.length;
      const from = filters.from || 0;
      const recordsPerPage = filters.recordsPerPage || component?.pageSize || 8;

      return of({
        ok: true,
        products: products.slice(from, from + recordsPerPage),
        total,
        page: {
          from,
          recordsPerPage,
          total,
          page: Math.floor(from / recordsPerPage) + 1,
          totalPages: Math.max(Math.ceil(total / recordsPerPage), 1)
        },
        facets: {
          categories: ['Textil', 'Otros'],
          provinces: ['Valencia', 'Sevilla']
        }
      });
    });
    productosServiceSpy.actualizarProducto.and.callFake((id: string, payload: { active: boolean }) => {
      const source = productsState.find((prod) => prod._id === id)!;
      const updatedProduct = {
        ...source,
        active: payload.active
      };
      productsState = productsState.map((prod) => prod._id === id ? updatedProduct : prod);
      return of({
        ok: true,
        product: updatedProduct
      });
    });
    productosServiceSpy.eliminarProducto.and.callFake((id: string) => {
      productsState = productsState.filter((prod) => prod._id !== id);
      return of({
        ok: true,
        msg: 'Producto eliminado correctamente'
      });
    });

    adminUsersServiceSpy.getUsers.and.returnValue(of([
      {
        uid: 'artisan-1',
        name: 'Mario',
        surname: 'Moya',
        email: 'mario@noma.test',
        role: 'artisan',
        active: true,
        company_name: 'Taller Moya'
      }
    ]));

    mapProductsCacheServiceSpy.refreshCacheAfterMutation.and.returnValue(of(null));

    await TestBed.configureTestingModule({
      imports: [AdminProductsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ProductosService, useValue: productosServiceSpy },
        { provide: AdminUsersService, useValue: adminUsersServiceSpy },
        { provide: MapProductsCacheService, useValue: mapProductsCacheServiceSpy },
        { provide: AuthService, useValue: { getToken: () => 'token-admin' } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AdminProductsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem(viewModeStorageKey);
  });

  it('separates visible and hidden products on load', () => {
    expect(productosServiceSpy.obtenerProductosAdmin).toHaveBeenCalledWith('token-admin', jasmine.objectContaining({
      status: 'visible',
      from: 0,
      recordsPerPage: component.pageSize
    }));
    expect(productosServiceSpy.obtenerProductosAdmin).toHaveBeenCalledWith('token-admin', jasmine.objectContaining({
      status: 'hidden',
      from: 0,
      recordsPerPage: component.pageSize
    }));
    expect(adminUsersServiceSpy.getUsers).toHaveBeenCalledTimes(1);
    expect(component.categoriaOptions[0]).toEqual({ value: '__all__', label: 'Todas' });
    expect(component.artesanoFilterOptions[0]).toEqual({ value: '__all__', label: 'Todos' });
    expect(component.provinciaOptions[0]).toEqual({ value: '__all__', label: 'Todas' });
    expect(component.productosVisibles.map((prod) => prod._id)).toEqual(['prod-visible']);
    expect(component.productosOcultos.map((prod) => prod._id)).toEqual(['prod-hidden']);
  });

  it('filters products by artisan company name in memory', () => {
    component.searchQuery = 'taller moya';
    component.applyFiltersFromControls();

    expect(component.productosVisibles.map((prod) => prod._id)).toEqual(['prod-visible']);
    expect(component.productosOcultos.length).toBe(0);
    expect(productosServiceSpy.obtenerProductosAdmin).toHaveBeenCalledWith('token-admin', jasmine.objectContaining({
      q: 'taller moya',
      status: 'visible',
      recordsPerPage: component.pageSize
    }));
  });

  it('filters products by status, category, artisan and province in memory', () => {
    component.selectedStatus = 'visible';
    component.selectedCategory = 'Textil';
    component.selectedArtisan = 'artisan-1';
    component.selectedProvince = 'Valencia';

    component.applyFiltersFromControls();

    expect(component.productosFiltrados.map((prod) => prod._id)).toEqual(['prod-visible']);
  });

  it('recalculates product page offsets when the responsive page size changes', () => {
    const host = fixture.nativeElement.querySelector('.form-scroll-container') as HTMLElement;
    spyOn(host, 'getBoundingClientRect').and.returnValue({ width: 1530 } as DOMRect);
    spyOnProperty(host, 'clientWidth', 'get').and.returnValue(1530);
    component.pageSize = 8;
    component.visibleCurrentPage = 3;
    component.hiddenCurrentPage = 2;
    component.totalVisibleProducts = 50;
    component.totalHiddenProducts = 50;
    productsState = [
      ...Array.from({ length: 50 }, (_, index) => ({
        _id: `visible-${index}`,
        name: `Visible ${index}`,
        category: 'Textil',
        province: 'Valencia',
        active: true,
        media: ['visible.jpg'],
        owner: { uid: 'artisan-1', company_name: 'Taller Moya' }
      })),
      ...Array.from({ length: 50 }, (_, index) => ({
        _id: `hidden-${index}`,
        name: `Hidden ${index}`,
        category: 'Otros',
        province: 'Sevilla',
        active: false,
        media: ['hidden.jpg'],
        owner: { uid: 'artisan-2', company_name: 'Barro Lopez' }
      }))
    ];

    (component as any).handleResponsivePageSizeChange();

    expect(component.pageSize).toBe(12);
    expect(component.visibleCurrentPage).toBe(2);
    expect(component.hiddenCurrentPage).toBe(1);
    expect(productosServiceSpy.obtenerProductosAdmin).toHaveBeenCalledWith('token-admin', jasmine.objectContaining({
      status: 'visible',
      from: 12,
      recordsPerPage: 12
    }));
    expect(productosServiceSpy.obtenerProductosAdmin).toHaveBeenCalledWith('token-admin', jasmine.objectContaining({
      status: 'hidden',
      from: 0,
      recordsPerPage: 12
    }));
  });

  it('restores the preferred table view from localStorage and renders the table', () => {
    localStorage.setItem(viewModeStorageKey, 'table');

    fixture.destroy();
    fixture = TestBed.createComponent(AdminProductsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;

    expect(component.viewMode).toBe('table');
    expect(host.querySelector('.productos-table')).not.toBeNull();
    expect(host.querySelector('.producto-card')).toBeNull();
  });

  it('switches between mosaic and table without changing the filtered dataset and persists the preference', () => {
    component.selectedStatus = 'visible';
    component.applyFiltersFromControls();
    fixture.detectChanges();

    const filteredIdsBeforeSwitch = component.productosFiltrados.map((prod) => prod._id);
    const host: HTMLElement = fixture.nativeElement;
    const tableViewButton = host.querySelectorAll('.inventory-view-btn')[1] as HTMLButtonElement;

    tableViewButton.click();
    fixture.detectChanges();

    expect(component.viewMode).toBe('table');
    expect(component.productosFiltrados.map((prod) => prod._id)).toEqual(filteredIdsBeforeSwitch);
    expect(localStorage.getItem(viewModeStorageKey)).toBe('table');
    expect(host.querySelector('.productos-table')).not.toBeNull();
    expect(host.querySelectorAll('.productos-table-row').length).toBe(1);
  });

  it('keeps selection controls hidden until selection mode is opened', () => {
    const host: HTMLElement = fixture.nativeElement;

    expect(component.selectionMode).toBeFalse();
    expect(host.querySelector('.producto-selection-checkbox')).toBeNull();
    expect(host.querySelector('.menu-puntos-btn')).not.toBeNull();

    component.openSelectionMode();
    fixture.detectChanges();

    expect(component.selectionMode).toBeTrue();
    expect(host.querySelector('.producto-selection-checkbox')).not.toBeNull();
    expect(host.querySelector('.menu-puntos-btn')).toBeNull();

    component.closeSelectionMode();
    fixture.detectChanges();

    expect(component.selectionMode).toBeFalse();
    expect(host.querySelector('.producto-selection-checkbox')).toBeNull();
    expect(host.querySelector('.menu-puntos-btn')).not.toBeNull();
  });

  it('toggles product selection when clicking anywhere on the card in selection mode', () => {
    component.openSelectionMode();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const firstCard = host.querySelector('.producto-card') as HTMLElement;

    firstCard.click();
    fixture.detectChanges();

    expect(component.selectedCount).toBe(1);
    expect(component.selectedProductIds.has('prod-visible')).toBeTrue();

    firstCard.click();
    fixture.detectChanges();

    expect(component.selectedCount).toBe(0);
    expect(component.selectedProductIds.has('prod-visible')).toBeFalse();
  });

  it('toggles product selection from a table row in selection mode', () => {
    component.setViewMode('table');
    component.openSelectionMode();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const firstRow = host.querySelector('.productos-table-row') as HTMLElement;

    firstRow.click();
    fixture.detectChanges();

    expect(component.selectedCount).toBe(1);
    expect(component.selectedProductIds.has('prod-visible')).toBeTrue();
  });

  it('selects, deselects and prunes the selection when filters change', () => {
    component.openSelectionMode();
    component.toggleProductSelection(component.productosVisibles[0], true);
    component.toggleProductSelection(component.productosOcultos[0], true);

    expect(component.selectedCount).toBe(2);

    component.selectedStatus = 'visible';
    component.applyFiltersFromControls();

    expect(component.selectedCount).toBe(1);
    expect(component.selectedProductIds.has('prod-visible')).toBeTrue();
    expect(component.selectedProductIds.has('prod-hidden')).toBeFalse();

    component.clearSelection();
    expect(component.selectedCount).toBe(0);
  });

  it('selects all filtered products and exposes derived counters for bulk actions', () => {
    component.openSelectionMode();
    component.selectAllFilteredProducts();

    expect(component.allFilteredSelected).toBeTrue();
    expect(component.selectedCount).toBe(2);
    expect(component.selectedVisibleCount).toBe(1);
    expect(component.selectedHiddenCount).toBe(1);
  });

  it('loads artisans once and reuses the cache when opening create product', () => {
    expect(adminUsersServiceSpy.getUsers).toHaveBeenCalledTimes(1);

    component.abrirCrearProducto();

    expect(adminUsersServiceSpy.getUsers).toHaveBeenCalledTimes(1);
    expect(component.showCreatePopup).toBeTrue();

    component.cerrarCrearProducto();
    component.abrirCrearProducto();

    expect(adminUsersServiceSpy.getUsers).toHaveBeenCalledTimes(1);
    expect(component.showCreatePopup).toBeTrue();
  });

  it('applies bulk hide only to selected visible products and clears the selection after full success', async () => {
    spyOn(component.mostrarPopup, 'emit');
    component.openSelectionMode();
    component.selectAllFilteredProducts();

    component.executeBulkVisibility(false);
    await flushAsync();

    expect(productosServiceSpy.actualizarProducto).toHaveBeenCalledTimes(1);
    expect(productosServiceSpy.actualizarProducto).toHaveBeenCalledWith('prod-visible', { active: false }, 'token-admin');
    expect(component.productosVisibles.length).toBe(0);
    expect(component.productosOcultos.map((prod) => prod._id)).toEqual(['prod-visible', 'prod-hidden']);
    expect(component.selectedCount).toBe(0);
    expect(mapProductsCacheServiceSpy.refreshCacheAfterMutation).toHaveBeenCalledTimes(1);
    expect(component.mostrarPopup.emit).toHaveBeenCalledWith(jasmine.objectContaining({
      title: 'Producto actualizado'
    }));
  });

  it('requests confirmation before bulk delete and refreshes cache once after success', async () => {
    component.openSelectionMode();
    component.selectAllFilteredProducts();
    component.requestBulkDelete();

    expect(component.confirmDialog).not.toBeNull();
    expect(productosServiceSpy.eliminarProducto).not.toHaveBeenCalled();

    component.confirmCurrentAction();
    await flushAsync();

    expect(productosServiceSpy.eliminarProducto).toHaveBeenCalledTimes(2);
    expect(component.productos.length).toBe(0);
    expect(component.selectedCount).toBe(0);
    expect(component.confirmDialog).toBeNull();
    expect(mapProductsCacheServiceSpy.refreshCacheAfterMutation).toHaveBeenCalledTimes(1);
  });

  it('keeps only failed ids selected after a partial bulk delete failure', async () => {
    spyOn(component.mostrarPopup, 'emit');
    productosServiceSpy.eliminarProducto.and.callFake((id: string) => (
      id === 'prod-visible'
        ? (() => {
            productsState = productsState.filter((prod) => prod._id !== id);
            return of({ ok: true, msg: 'Producto eliminado correctamente' });
          })()
        : throwError(() => ({ error: { msg: 'No se pudo eliminar el producto.' } }))
    ));

    component.openSelectionMode();
    component.selectAllFilteredProducts();
    component.requestBulkDelete();
    component.confirmCurrentAction();
    await flushAsync();

    expect(component.productos.map((prod) => prod._id)).toEqual(['prod-hidden']);
    expect(component.selectedCount).toBe(1);
    expect(component.selectedProductIds.has('prod-hidden')).toBeTrue();
    expect(component.selectedProductIds.has('prod-visible')).toBeFalse();
    expect(mapProductsCacheServiceSpy.refreshCacheAfterMutation).toHaveBeenCalledTimes(1);
    expect(component.mostrarPopup.emit).toHaveBeenCalledWith(jasmine.objectContaining({
      title: 'Eliminación parcial'
    }));
  });

  it('does not refresh cache when a bulk visibility action fails completely and keeps the failed selection', async () => {
    spyOn(component.mostrarPopup, 'emit');
    productosServiceSpy.actualizarProducto.and.returnValue(
      throwError(() => ({ error: { msg: 'No se pudo actualizar el producto.' } }))
    );

    component.openSelectionMode();
    component.toggleProductSelection(component.productosVisibles[0], true);
    component.executeBulkVisibility(false);
    await flushAsync();

    expect(component.productosVisibles.map((prod) => prod._id)).toEqual(['prod-visible']);
    expect(component.selectedCount).toBe(1);
    expect(component.selectedProductIds.has('prod-visible')).toBeTrue();
    expect(mapProductsCacheServiceSpy.refreshCacheAfterMutation).not.toHaveBeenCalled();
    expect(component.mostrarPopup.emit).toHaveBeenCalledWith(jasmine.objectContaining({
      title: 'Error'
    }));
  });
});
