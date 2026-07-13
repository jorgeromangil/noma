import { Component, Input, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { ProductosService } from '../../services/productos.service';
import { EditarProductoComponent } from './editar-producto/editar-producto.component';
import { MapProductsCacheService } from '../../../../../services/map-products-cache.service';
import { ProductInventoryGridComponent } from '../shared/product-inventory-grid/product-inventory-grid.component';

@Component({
  selector: 'app-mis-productos',
  standalone: true,
  imports: [CommonModule, EditarProductoComponent, ProductInventoryGridComponent],
  templateUrl: './mis-productos.component.html',
  styleUrl: './mis-productos.component.css'
})
export class MisProductosComponent {
  @Input() usuario: any = null;
  @Output() mostrarPopup = new EventEmitter<{title: string, message: string}>();

  misProductos: any[] = [];
  productosFiltrados: any[] = [];
  productosVisibles: any[] = [];
  productosOcultos: any[] = [];
  loading: boolean = false;
  private misProductosCargados: boolean = false;
  private searchQuery: string = '';
  
  showEditarPopup: boolean = false;
  productoEditandoId: string | null = null;
  productoEditandoIndex: number | null = null;

  productoAEliminar: string | null = null;
  showDeleteConfirm: boolean = false;

  constructor(
    private authService: AuthService,
    private productosService: ProductosService,
    private mapProductsCacheService: MapProductsCacheService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.obtenerMisProductos();
  }

  obtenerMisProductos() {
    if (this.misProductosCargados) {
      return;
    }

    this.loading = true;
    const token = this.authService.getToken() || '';

    this.productosService.obtenerMisProductos(token).subscribe({
      next: (resp) => {
        if (resp.ok) {
          this.misProductos = resp.products;
          this.applyFilters();
          this.misProductosCargados = true;
        }
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar productos:', err);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  buscar(event: any) {
    const texto = event.target.value.toLowerCase().trim();
    this.searchQuery = texto;
    this.applyFilters();
    this.cdr.detectChanges();
  }

  abrirEditarProducto(prod: any, index: number) {
    this.productoEditandoId = prod._id || prod.uid || prod.id || null;
    this.productoEditandoIndex = index;
    this.showEditarPopup = true;
    this.cdr.detectChanges();
  }

  cerrarEditarPopup() {
    this.showEditarPopup = false;
    this.productoEditandoId = null;
    this.productoEditandoIndex = null;
    this.cdr.detectChanges();
  }

  onProductoActualizado(productoActualizado: any) {
    if (productoActualizado) {
      const id = productoActualizado._id || productoActualizado.uid || productoActualizado.id;
      const idx = this.misProductos.findIndex(p => (p._id || p.uid || p.id) === id);
      if (idx !== -1) {
        this.misProductos[idx] = productoActualizado;
      }
      this.applyFilters();
    }
    this.cerrarEditarPopup();
    this.cdr.detectChanges();
  }

  solicitarEliminarProducto(prod: any) {
    const id = prod?._id || prod?.uid || prod?.id || null;
    if (!id || id === 'undefined') {
      this.mostrarPopup.emit({
        title: 'Error',
        message: 'No se pudo encontrar el ID del producto.'
      });
      return;
    }

    this.productoAEliminar = id;
    this.showDeleteConfirm = true;
    this.cdr.detectChanges();
  }

  cancelarEliminacion(): void {
    if (this.loading) {
      return;
    }

    this.productoAEliminar = null;
    this.showDeleteConfirm = false;
    this.cdr.detectChanges();
  }

  confirmarEliminacionDefinitiva() {
    if (!this.productoAEliminar) return;

    const id = this.productoAEliminar;
    this.loading = true;
    const token = this.authService.getToken() || '';

    this.productosService.eliminarProducto(id, token).subscribe({
      next: (resp) => {
        if (resp.ok) {
          this.syncMapCacheAndRun(() => {
            this.loading = false;
            this.misProductos = this.misProductos.filter(p => (p._id || p.uid || p.id) !== id);
            this.applyFilters();
            this.showDeleteConfirm = false;
            this.productoAEliminar = null;
            this.cdr.detectChanges();
          });
          return;
        }
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.showDeleteConfirm = false;
        this.productoAEliminar = null;
        this.mostrarPopup.emit({
          title: 'Error',
          message: err.error?.msg || 'No se pudo eliminar el producto.'
        });
        this.cdr.detectChanges();
      }
    });
  }

  isProductHidden(prod: any): boolean {
    return prod?.active === false;
  }

  toggleProductVisibility(prod: any): void {
    const id = prod?._id || prod?.uid || prod?.id;
    if (!id) return;

    const token = this.authService.getToken() || '';
    const nextActive = prod?.active === false ? true : false;
    const prevActive = prod?.active;

    // Optimistic UI update
    prod.active = nextActive;
    this.applyFilters();
    this.cdr.detectChanges();

    this.productosService.actualizarProducto(id, { active: nextActive }, token).subscribe({
      next: (resp) => {
        if (resp.ok && resp.product) {
          const idx = this.misProductos.findIndex(p => (p._id || p.uid || p.id) === id);
          if (idx >= 0) {
            this.misProductos[idx] = resp.product;
            this.applyFilters();
          }
        }
        this.syncMapCacheAndRun(() => {
          this.cdr.detectChanges();
        });
      },
      error: (err) => {
        // Revert on failure
        prod.active = prevActive;
        this.applyFilters();
        this.mostrarPopup.emit({
          title: 'Error',
          message: err.error?.msg || 'No se pudo actualizar el producto.'
        });
        this.cdr.detectChanges();
      }
    });
  }

  private applyFilters(): void {
    const query = this.searchQuery;
    const base = query
      ? this.misProductos.filter(prod => (prod.name || '').toLowerCase().includes(query))
      : [...this.misProductos];

    this.productosFiltrados = base;
    this.productosVisibles = base.filter(prod => !this.isProductHidden(prod));
    this.productosOcultos = base.filter(prod => this.isProductHidden(prod));
  }

  private syncMapCacheAndRun(callback: () => void): void {
    this.mapProductsCacheService.refreshCacheAfterMutation().subscribe({
      next: () => callback()
    });
  }
}
