import { Component, OnInit, ChangeDetectorRef, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { NgSelectModule } from '@ng-select/ng-select';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { ReportesService } from '../../services/reportes.service';
import { CustomTooltipDirective } from '../../../../../shared/custom-tooltip.directive';

interface ReportedProduct {
  _id: string;
  slug?: string;
  name: string;
  title: string;
  image?: string;
  media?: string[];
  thumbnail?: string;
  report_count: number;
  last_reported_at: Date;
  report_status?: 'pending' | 'reviewed' | 'dismissed' | 'actioned';
  owner: {
    _id: string;
    name: string;
    surname: string;
    email: string;
    company_name?: string;
  };
  reports: Array<{
    reason: string;
    details: string;
    reporter: {
      _id: string;
      name: string;
      surname: string;
      email: string;
    } | null;
    createdAt: Date;
  }>;
}

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, NgSelectModule, CustomTooltipDirective],
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.css'
})
export class ReportesComponent implements OnInit {
  @Input() modo: 'reportados' | 'aceptados' = 'reportados';

  productosReportados: ReportedProduct[] = [];
  productosFiltrados: ReportedProduct[] = [];
  private imagenesConError = new Set<string>();
  
  // Control de carga
  loading: boolean = false;
  error: string = '';
  
  // Paginación
  currentPage: number = 1;
  pageSize: number = 10;
  totalPages: number = 0;
  totalProducts: number = 0;
  
  // Filtros
  filtroEstado: string = '';
  filtroRazon: string = '';
  ordenarPor: string = 'last_reported_at';
  ordenAsc: boolean = false;
  busqueda: string = '';
  
  // Estados y razones disponibles
  estadosDisponibles = [
    { value: '', label: 'Todos los estados' },
    { value: 'pending', label: 'Pendiente' },
    { value: 'dismissed', label: 'Denegado' },
    { value: 'actioned', label: 'Aceptado' }
  ];
  
  razonesDisponibles = [
    { value: '', label: 'Todos los motivos' },
    { value: 'contenido_inapropiado', label: 'Contenido inapropiado' },
    { value: 'informacion_falsa', label: 'Información falsa' },
    { value: 'spam', label: 'Spam' },
    { value: 'derechos_autor', label: 'Derechos de autor' },
    { value: 'otro', label: 'Otro' }
  ];

  ordenDisponibles = [
    { value: 'report_count', label: 'Cantidad de reportes' },
    { value: 'last_reported_at', label: 'Fecha del último reporte' }
  ];
  
  // Producto expandido
  productoExpandido: string | null = null;
  actualizandoEstadoIds = new Set<string>();

  constructor(
    private authService: AuthService,
    private reportesService: ReportesService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.modo === 'aceptados') {
      this.filtroEstado = 'actioned';
    } else if (!this.filtroEstado) {
      this.filtroEstado = 'pending';
    }

    this.cargarProductosReportados();
  }

  esModoAceptados(): boolean {
    return this.modo === 'aceptados';
  }

  cargarProductosReportados(): void {
    this.loading = true;
    this.error = '';
    
    const token = this.authService.getToken() || '';
    const sortOrder = this.ordenAsc ? 'asc' : 'desc';
    
    this.reportesService.obtenerProductosReportados(
      token,
      this.currentPage,
      this.pageSize,
      this.filtroEstado || undefined,
      this.ordenarPor,
      sortOrder,
      this.esModoAceptados()
    ).subscribe({
      next: (resp) => {
        if (resp.ok) {
          this.productosReportados = (resp.products || []).map((product: ReportedProduct) => ({
            ...product,
            reports: Array.isArray(product.reports) ? product.reports : [],
            report_status: product.report_status || 'pending'
          }));
          this.totalProducts = resp.pagination?.total || 0;
          this.totalPages = resp.pagination?.pages || 0;
          this.aplicarFiltros();
        } else {
          this.error = resp.msg || 'No se pudieron cargar los productos reportados.';
        }
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar productos reportados:', err);
        this.error = err.error?.msg || 'Error de conexión con el servidor';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  aplicarFiltros(): void {
    let filtrados = [...this.productosReportados];
    
    // Filtrar por búsqueda
    if (this.busqueda.trim()) {
      const termino = this.busqueda.toLowerCase();
      filtrados = filtrados.filter(prod =>
        (prod.name || '').toLowerCase().includes(termino) ||
        (prod.title || '').toLowerCase().includes(termino) ||
        (prod.owner?.name || '').toLowerCase().includes(termino) ||
        (prod.owner?.email || '').toLowerCase().includes(termino)
      );
    }
    
    // Filtrar por razón
    if (this.filtroRazon) {
      filtrados = filtrados.filter(prod =>
        prod.reports.some(rep => rep.reason === this.filtroRazon)
      );
    }
    
    this.productosFiltrados = filtrados;
  }

  onBusquedaChange(): void {
    this.aplicarFiltros();
  }

  onFiltroEstadoChange(): void {
    if (this.esModoAceptados()) {
      this.filtroEstado = 'actioned';
    }
    this.currentPage = 1;
    this.cargarProductosReportados();
  }

  onFiltroRazonChange(): void {
    this.aplicarFiltros();
  }

  onOrdenChange(): void {
    this.currentPage = 1;
    this.cargarProductosReportados();
  }

  toggleOrdenasc(): void {
    this.ordenAsc = !this.ordenAsc;
    this.currentPage = 1;
    this.cargarProductosReportados();
  }

  getTooltipOrden(): string {
    return this.ordenAsc ? 'Cambiar a descendente' : 'Cambiar a ascendente';
  }

  cambiarPagina(nuevaPagina: number): void {
    if (nuevaPagina >= 1 && nuevaPagina <= this.totalPages) {
      this.currentPage = nuevaPagina;
      this.cargarProductosReportados();
      window.scrollTo(0, 0);
    }
  }

  toggleProductoExpandido(productId: string): void {
    if (this.productoExpandido === productId) {
      this.productoExpandido = null;
    } else {
      this.productoExpandido = productId;
    }
  }

  obtenerImagenProducto(producto: ReportedProduct): string | null {
    if (!producto?._id || this.imagenesConError.has(producto._id)) {
      return null;
    }

    const candidatos = [
      producto.image,
      Array.isArray(producto.media) ? producto.media[0] : undefined,
      producto.thumbnail
    ];

    for (const candidato of candidatos) {
      const imagen = (candidato || '').trim();
      if (imagen) {
        return imagen;
      }
    }

    return null;
  }

  onImagenProductoError(productoId: string): void {
    if (!productoId) {
      return;
    }

    this.imagenesConError.add(productoId);
    this.cdr.markForCheck();
  }

  obtenerNombreRazon(razon: string): string {
    const item = this.razonesDisponibles.find(r => r.value === razon);
    return item ? item.label : razon;
  }

  obtenerNombreEstado(estado: string): string {
    const item = this.estadosDisponibles.find(e => e.value === estado);
    return item ? item.label : estado;
  }

  obtenerEstadoProducto(producto: ReportedProduct): 'pending' | 'reviewed' | 'dismissed' | 'actioned' {
    return producto.report_status || 'pending';
  }

  obtenerNombreProductor(producto: ReportedProduct): string {
    if (!producto.owner) return 'Desconocido';
    return producto.owner.company_name || `${producto.owner.name} ${producto.owner.surname || ''}`.trim();
  }

  obtenerCantidadReportes(producto: ReportedProduct): number {
    if (Array.isArray(producto.reports)) {
      return producto.reports.length;
    }

    return (typeof producto.report_count === 'number' && producto.report_count >= 0)
      ? producto.report_count
      : 0;
  }

  obtenerTextoReportes(cantidad: number): string {
    return cantidad === 1 ? 'reporte' : 'reportes';
  }

  obtenerUsuariosReportantes(producto: ReportedProduct): string[] {
    if (!Array.isArray(producto.reports) || producto.reports.length === 0) {
      return [];
    }

    const usuarios = new Map<string, string>();

    for (const reporte of producto.reports) {
      const reporter = reporte?.reporter;
      if (!reporter?._id) {
        continue;
      }

      const nombre = `${reporter.name || ''} ${reporter.surname || ''}`.trim() || reporter.email || 'Usuario sin nombre';
      const descripcion = reporter.email ? `${nombre} (${reporter.email})` : nombre;
      usuarios.set(reporter._id, descripcion);
    }

    return Array.from(usuarios.values());
  }

  estaActualizandoEstado(productoId: string): boolean {
    return this.actualizandoEstadoIds.has(productoId);
  }

  aceptarReporte(producto: ReportedProduct, event: Event): void {
    event.stopPropagation();
    this.actualizarEstadoReporte(producto, 'actioned');
  }

  denegarReporte(producto: ReportedProduct, event: Event): void {
    event.stopPropagation();
    this.actualizarEstadoReporte(producto, 'dismissed');
  }

  revertirReporte(producto: ReportedProduct, event: Event): void {
    event.stopPropagation();
    this.actualizarEstadoReporte(producto, 'pending');
  }

  private actualizarEstadoReporte(producto: ReportedProduct, estado: 'pending' | 'dismissed' | 'actioned'): void {
    if (!producto?._id || this.estaActualizandoEstado(producto._id)) {
      return;
    }

    const token = this.authService.getToken() || '';
    const estadoAnterior = producto.report_status || 'pending';
    const saleDelListadoActual =
      (!this.esModoAceptados() && (estado === 'dismissed' || estado === 'actioned')) ||
      (this.esModoAceptados() && estado === 'pending');
    const indiceOriginal = this.productosReportados.findIndex(prod => prod._id === producto._id);

    this.actualizandoEstadoIds.add(producto._id);

    if (saleDelListadoActual) {
      this.removerProductoDelListado(producto._id);
    } else {
      producto.report_status = estado;
    }

    this.reportesService
      .actualizarEstadoReporte(token, producto._id, estado)
      .pipe(finalize(() => this.actualizandoEstadoIds.delete(producto._id)))
      .subscribe({
        next: (resp) => {
          if (!resp?.ok) {
            if (saleDelListadoActual) {
              this.restaurarProductoEnListado(producto, indiceOriginal);
            } else {
              producto.report_status = estadoAnterior;
            }
            this.error = resp?.msg || 'No se pudo actualizar el estado del reporte.';
          } else {
            this.error = '';
            if (!saleDelListadoActual) {
              this.cargarProductosReportados();
            }
          }
          this.cdr.detectChanges();
        },
        error: (err) => {
          if (saleDelListadoActual) {
            this.restaurarProductoEnListado(producto, indiceOriginal);
          } else {
            producto.report_status = estadoAnterior;
          }
          this.error = err?.error?.msg || 'Error actualizando el estado del reporte';
          this.cdr.detectChanges();
        }
      });
  }

  private removerProductoDelListado(productoId: string): void {
    this.productosReportados = this.productosReportados.filter(prod => prod._id !== productoId);
    this.aplicarFiltros();

    if (this.productoExpandido === productoId) {
      this.productoExpandido = null;
    }

    if (this.totalProducts > 0) {
      this.totalProducts -= 1;
    }
  }

  private restaurarProductoEnListado(producto: ReportedProduct, indiceOriginal: number): void {
    const yaExiste = this.productosReportados.some(prod => prod._id === producto._id);
    if (yaExiste) {
      return;
    }

    if (indiceOriginal >= 0 && indiceOriginal <= this.productosReportados.length) {
      this.productosReportados.splice(indiceOriginal, 0, producto);
    } else {
      this.productosReportados.unshift(producto);
    }

    this.aplicarFiltros();
    this.totalProducts += 1;
  }
}
