import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { buildApiUrl } from '../../../../../shared/api-base';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { EstadisticasPieChartComponent } from './estadisticas-pie-chart.component';
import { EstadisticasProductosPieComponent } from './estadisticas-productos-pie.component';
import { EstadisticasProductosBarComponent } from './estadisticas-productos-bar.component';
import { BarSimpleData } from './estadisticas-barra-simple.component';
import { EstadisticasBarraSimpleComponent } from './estadisticas-barra-simple.component';

export interface AdminUserStat {
  total: number;
  artisan: number;
  artisanDelta?: string;
  artisanHelper?: string;
  regular: number;
  regularDelta?: string;
  regularHelper?: string;
}

@Component({
  selector: 'app-estadisticas-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, NgSelectModule, EstadisticasPieChartComponent, EstadisticasProductosPieComponent, EstadisticasBarraSimpleComponent],
  templateUrl: './estadisticas-admin.component.html',
  styleUrl: './estadisticas.component.css'
})
export class EstadisticasAdminComponent implements OnInit {
    hasData(arr: BarSimpleData[]): boolean {
      return arr.some(item => item.value > 0);
    }
  // Datos para gráficas de evolución temporal
  public evolucionUsuarios: BarSimpleData[] = [];
  public evolucionProductos: BarSimpleData[] = [];
  public loading = false;
  public errorMsg = '';
  public initialLoadResolved = false;
  public statsInitiallyLoaded = false;
  public stats: any = null;
  private loadingTimer: any = null;
  private pendingRequests = 0;

  // Periodo y periodos disponibles
    public periodo: 'dia' | 'semana' | 'mes' = 'dia';
  public periodos = [
    { label: 'Ayer', value: 'dia' },
    { label: 'Semana pasada', value: 'semana' },
    { label: 'Mes pasado', value: 'mes' }
  ];

  // Stats agregadas globales
  public globalStats: any = null;
  public globalLoading = false;
  public globalSummaryCards: any[] = [];

  public usersPieData: any[] = [];
  public productsPieData: any[] = [];
  public popularProducts: any[] = [];
  public popularPage: any[] = [];
  public popularPageSize = 5;
  public popularPageIndex = 0;
  public popularTotalPages = 0;
  public topProductCategory: { name: string, count: number } | null = null;
    // Datos para gráfico de productos por comunidad autónoma
    public productsByComunidad: BarSimpleData[] = [];

  constructor(private http: HttpClient, private auth: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.errorMsg = '';
    this.loadGlobalStats();
    this.loadAdminStats();
  }

  onPeriodoChange(): void {
    if (this.pendingRequests > 0) return;
    this.errorMsg = '';
    this.loadGlobalStats();
  }

  loadGlobalStats(): void {
    this.globalLoading = true;
    this.pendingRequests++;
    this.startLoadingTimer();
    this.errorMsg = '';
    const token = this.auth.getToken();
    if (!token) {
      this.errorMsg = 'Falta token de autenticación.';
      this.globalLoading = false;
      // Si ambas cargas han terminado, loading debe ser false
      this.checkLoadingDone();
      return;
    }
    const headers = new HttpHeaders().set('x-token', token);
    this.http.get<any>(buildApiUrl(`admin/stats-aggregate?periodo=${this.periodo}`), { headers }).subscribe({
      next: (resp) => {
        if (!resp.ok) {
          this.errorMsg = 'No autorizado o error de backend.';
          this.globalSummaryCards = [];
          this.globalLoading = false;
          this.checkLoadingDone();
          this.cdr.detectChanges();
          return;
        }
        this.globalStats = resp.datos;
        // Tarjetas resumen globales (ejemplo: favoritos, vistas, clics)
        this.globalSummaryCards = [
          { label: 'Visitas a perfiles de artesanos', value: this.globalStats['view_artisan_profile']?.total ?? '-', helper: 'Total visitas a perfiles' },
          { label: 'Clics en productos de artesanos', value: this.globalStats['product_modal_open']?.total ?? '-', helper: 'Total clics en productos' }
        ];

        // --- Gráficas de evolución temporal ---
        // Usuarios
        let labelsUsuarios: string[] = [];
        let dataUsuarios: number[] = [];
        if (this.periodo === 'dia') {
          labelsUsuarios = Array.from({ length: 24 }, (_, i) => `${i}h`);
          dataUsuarios = this.globalStats.usuariosPorHora || [];
        } else if (this.periodo === 'semana') {
          labelsUsuarios = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
          dataUsuarios = this.globalStats.usuariosPorDia || [];
        } else if (this.periodo === 'mes') {
          const diasMes = (this.globalStats.usuariosPorDia || []).length;
          labelsUsuarios = Array.from({ length: diasMes }, (_, i) => `${i + 1}`);
          dataUsuarios = this.globalStats.usuariosPorDia || [];
        }
        this.evolucionUsuarios = (dataUsuarios || []).map((val, idx) => ({ name: labelsUsuarios[idx] || '', value: val || 0 }));

        // Productos
        let labelsProductos: string[] = [];
        let dataProductos: number[] = [];
        if (this.periodo === 'dia') {
          labelsProductos = Array.from({ length: 24 }, (_, i) => `${i}h`);
          dataProductos = this.globalStats.productosPorHora || [];
        } else if (this.periodo === 'semana') {
          labelsProductos = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
          dataProductos = this.globalStats.productosPorDia || [];
        } else if (this.periodo === 'mes') {
          const diasMes = (this.globalStats.productosPorDia || []).length;
          labelsProductos = Array.from({ length: diasMes }, (_, i) => `${i + 1}`);
          dataProductos = this.globalStats.productosPorDia || [];
        }
        this.evolucionProductos = (dataProductos || []).map((val, idx) => ({ name: labelsProductos[idx] || '', value: val || 0 }));
        this.globalLoading = false;
        this.checkLoadingDone();
        this.cdr.detectChanges();
      },
      error: () => {
        this.errorMsg = 'Error al cargar estadísticas para el periodo seleccionado, se muestran las estadísticas generales.';
        // Limpiar gráficas dependientes del periodo
        this.globalSummaryCards = [];
        this.evolucionUsuarios = [];
        this.evolucionProductos = [];
        this.globalLoading = false;
        this.checkLoadingDone();
        this.cdr.detectChanges();
      }
    });
  }

  loadAdminStats(): void {
    this.pendingRequests++;
    this.startLoadingTimer();
    const token = this.auth.getToken();
    if (!token) {
      this.errorMsg = 'Falta token de autenticación.';
      this.checkLoadingDone();
      return;
    }
    const headers = new HttpHeaders().set('x-token', token);
    this.http.get<any>(buildApiUrl('admin/stats'), { headers }).subscribe({
      next: (resp) => {
        if (!resp.ok) {
          this.errorMsg = 'No autorizado o error de backend.';
          this.loading = false;
          this.cdr.detectChanges();
          return;
        }
        this.stats = resp.stats;
        // Añadir delta y helper a usuarios
        this.stats.users.totalDelta = typeof this.stats.users.totalDelta !== 'undefined' ? this.stats.users.totalDelta : '';
        this.stats.users.totalHelper = typeof this.stats.users.totalHelper !== 'undefined' ? this.stats.users.totalHelper : 'Usuarios totales en Noma';
        this.stats.users.artisanDelta = typeof this.stats.users.artisanDelta !== 'undefined' ? this.stats.users.artisanDelta : '';
        this.stats.users.artisanHelper = typeof this.stats.users.artisanHelper !== 'undefined' ? this.stats.users.artisanHelper : 'Usuarios artesanos en Noma';
        this.stats.users.regularDelta = typeof this.stats.users.regularDelta !== 'undefined' ? this.stats.users.regularDelta : '';
        this.stats.users.regularHelper = typeof this.stats.users.regularHelper !== 'undefined' ? this.stats.users.regularHelper : 'Usuarios regulares en Noma';
        // Añadir delta y helper a productos
        this.stats.products.totalDelta = typeof this.stats.products.totalDelta !== 'undefined' ? this.stats.products.totalDelta : '';
        this.stats.products.totalHelper = typeof this.stats.products.totalHelper !== 'undefined' ? this.stats.products.totalHelper : 'Productos publicados';
        // Calcular la categoría con más productos
        if (this.stats.products.byCategory) {
          const entries: [string, number][] = Object.entries(this.stats.products.byCategory) as [string, number][];
          if (entries.length > 0) {
            const [topCat, topCount] = entries.reduce(
              (max: [string, number], curr: [string, number]) => curr[1] > max[1] ? curr : max
            );
            this.topProductCategory = { name: topCat, count: topCount };
          } else {
            this.topProductCategory = null;
          }
        } else {
          this.topProductCategory = null;
        }
          // Gráfico de barras: productos por comunidad autónoma
          if (this.stats.products.byComunidad) {
            this.productsByComunidad = Object.entries(this.stats.products.byComunidad)
              .map(([comunidad, count]) => ({ name: comunidad, value: Number(count) }));
          } else {
            this.productsByComunidad = [];
          }
        // Pie usuarios
        const palette = ['#f83d3a','#ff708f','#b44194','#9153ca','#5384ee'];
        this.usersPieData = [
          { label: 'Artesanos', value: this.stats.users.artisan, color: palette[2] },
          { label: 'Regulares', value: this.stats.users.regular, color: palette[4] }
        ];
        // Pie productos por categoría
        this.productsPieData = Object.entries(this.stats.products.byCategory).map(([cat, val], idx) => ({
          label: cat,
          value: val,
          color: palette[idx % palette.length]
        }));
        // Top productos populares
        this.popularProducts = (this.stats.popularProducts || []).map((p: any) => ({
          ...p,
          thumbnail: p.thumbnail
            || (p.media && Array.isArray(p.media) && p.media.length > 0 ? p.media[0] : null)
            || '/default-product.png'
        }));
        this.resetPopularPagination();
        this.loading = false; // se sobreescribe, pero para compatibilidad
        this.checkLoadingDone();
        this.cdr.detectChanges();
      },
      error: () => {
        this.errorMsg = 'Error al cargar las estadísticas globales.';
        this.loading = false; // se sobreescribe, pero para compatibilidad
        this.checkLoadingDone();
        this.cdr.detectChanges();
      }
    });
  }

  // Unifica el control de loading para ambas cargas
  private checkLoadingDone(): void {
    this.pendingRequests = Math.max(0, this.pendingRequests - 1);
    if (!this.globalLoading && this.pendingRequests === 0) {
      if (this.loadingTimer) { clearTimeout(this.loadingTimer); this.loadingTimer = null; }
      this.loading = false;
      this.initialLoadResolved = true;
    }
  }

  private startLoadingTimer(): void {
    if (this.loadingTimer) return;
    this.loadingTimer = setTimeout(() => {
      if (this.pendingRequests > 0 || this.globalLoading) {
        this.loading = true;
        this.cdr.detectChanges();
      }
    }, 250);
  }

  nextPopularPage(): void {
    if (this.popularPageIndex + 1 >= this.popularTotalPages) return;
    this.popularPageIndex += 1;
    this.updatePopularPage();
  }

  prevPopularPage(): void {
    if (this.popularPageIndex <= 0) return;
    this.popularPageIndex -= 1;
    this.updatePopularPage();
  }

  private resetPopularPagination(): void {
    this.popularPageIndex = 0;
    this.popularTotalPages = Math.ceil(this.popularProducts.length / this.popularPageSize) || 0;
    this.updatePopularPage();
  }

  private updatePopularPage(): void {
    const start = this.popularPageIndex * this.popularPageSize;
    const end = start + this.popularPageSize;
    this.popularPage = this.popularProducts.slice(start, end);
  }
}
