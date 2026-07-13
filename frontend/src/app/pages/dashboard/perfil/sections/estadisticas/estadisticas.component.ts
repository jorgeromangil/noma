import { EstadisticasProductosBarComponent, ProductoBarData } from './estadisticas-productos-bar.component';
import { EstadisticasProductosPieComponent, ProductoPieData } from './estadisticas-productos-pie.component';
import { EstadisticasPieChartComponent } from './estadisticas-pie-chart.component';
import { FavoritosPieChartComponent, PieFavoritosData } from './favoritos-pie-chart.component';
import { EstadisticasProductosScatterComponent } from './estadisticas-productos-scatter.component';
import { Component, Input, OnChanges, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from '../../../../../layouts/auth-layout/auth.service';
import { buildApiUrl } from '../../../../../shared/api-base';
import { CustomTooltipDirective } from '../../../../../shared/custom-tooltip.directive';

type PeriodoEstadisticas = 'dia' | 'semana' | 'mes';

interface StatCard {
  label: string;
  value: string;
  delta?: string;
  helper?: string;
}

interface FavoriteBreakdownItem {
  productId: string;
  name: string;
  favorites: number;
  thumbnail?: string | null;
}

@Component({
  selector: 'app-estadisticas',
  standalone: true,
  imports: [CommonModule, FormsModule, NgSelectModule, CustomTooltipDirective, EstadisticasPieChartComponent, EstadisticasProductosBarComponent, EstadisticasProductosPieComponent, EstadisticasProductosScatterComponent],
  templateUrl: './estadisticas.component.html',
  styleUrl: './estadisticas.component.css'
})
export class EstadisticasComponent implements OnInit, OnChanges {
  // Datos para las nuevas gráficas
  public productosBarData: ProductoBarData[] = [];
  public productosPieData: ProductoPieData[] = [];
  public modalFichaChartData: { label: string; value: number; color?: string }[] = [];
  @Input() usuario: any = null;
  public isMockData: boolean = true;

  // --- Estadísticas globales (para sección global) ---
  public globalLoading: boolean = false;
  public globalSummaryCards: StatCard[] = [];
  public globalErrorMsg: string = '';

  public periodo: PeriodoEstadisticas | null = 'dia';
  public periodos: { label: string, value: PeriodoEstadisticas }[] = [
    { label: 'Ayer', value: 'dia' },
    { label: 'Semana pasada', value: 'semana' },
    { label: 'Mes pasado', value: 'mes' }
  ];

  public loading: boolean = false;
  public errorMsg: string = '';
  public statsLoaded: boolean = false;
  public totalStatsLoaded: boolean = false;
  private lastRequestKey: string | null = null;
  private loadingKey: string | null = null;
  private loadingTimer: any = null;

  public periodSummaryCards: StatCard[] = [
    { label: 'Visitas al perfil', value: '-', helper: 'Total' },
    { label: 'Clics en productos', value: '-', helper: 'Total' }
  ];
  public totalSummaryCards: StatCard[] = [
    { label: 'Favoritos recibidos', value: '-', helper: 'Total' },
    { label: 'Productos publicados', value: '-', helper: 'Publicados' }
  ];

  public favoritesBreakdown: FavoriteBreakdownItem[] = [];
  public favoritesPage: FavoriteBreakdownItem[] = [];
  public favoritesPageSize: number = 5;
  public favoritesPageIndex: number = 0;
  public favoritesTotalPages: number = 0;
  public topFavoritosPieData: PieFavoritosData[] = [];
  public productsVisibleCount: number = 0;
  public productsHiddenCount: number = 0;
  public isExportingPdf: boolean = false;
  public pdfExportErrorMsg: string = '';
  public exportTimestamp: Date | null = null;
  private pdfFontFamily: string = 'helvetica';
  private plusJakartaRegularBinary: string | null = null;
  private plusJakartaSemiBoldBinary: string | null = null;
  private favoritesImageCache: Map<string, string | null> = new Map();
  private roundedImageCache: Map<string, string> = new Map();

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.usuario) {
      this.waitForTotalStats().then(() => this.loadStats());
    }
  }

  ngOnChanges(): void {
    if (this.usuario) {
      this.totalStatsLoaded = false;
      this.waitForTotalStats().then(() => {
        this.statsLoaded = false;
        this.loadStats();
      });
    }
  }

  private waitForTotalStats(): Promise<void> {
    if (this.totalStatsLoaded) return Promise.resolve();

    this.loadTotalStats();

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.totalStatsLoaded) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);

      // Timeout de seguridad de 5s
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    });
  }

  public onPeriodoChange(): void {
    this.statsLoaded = false;
    this.loadStats();
  }

  private loadTotalStats(): void {
    const artisanId = this.usuario?._id || this.usuario?.uid || this.usuario?.id;
    if (!artisanId) return;

    if (this.totalStatsLoaded) return;

    const token = this.authService.getToken() || '';
    if (!token) {
      this.errorMsg = 'Falta token de autorizacion.';
      this.totalStatsLoaded = true;
      return;
    }

    const headers = new HttpHeaders().set('x-token', token);
    const urlTotal = buildApiUrl(`stats/artisan/${artisanId}`);

    this.http.get<any>(urlTotal, { headers }).toPromise().then((totalResp) => {
      if (totalResp?.ok && totalResp.stats) {
        this.favoritesBreakdown = Array.isArray(totalResp.stats.favoritesBreakdown)
          ? totalResp.stats.favoritesBreakdown : [];
        this.resetFavoritesPagination();
        // Top 5 para la gráfica circular
        this.topFavoritosPieData = this.favoritesBreakdown
          .slice(0, 5)
          .map((item, idx) => ({
            label: item.name,
            value: item.favorites,
            color: [
              '#f83d3a', // rojo
              '#ff708f', // azul
              '#b44194', // naranja
              '#9153ca', // verde
              '#5384ee'  // violeta
            ][idx % 5]
          }));
        this.productsVisibleCount = Number(totalResp.stats.productsVisible ?? 0);
        this.productsHiddenCount = Number(totalResp.stats.productsHidden ?? 0);
        this.totalSummaryCards = [
          { label: 'Favoritos recibidos', value: String(totalResp.stats.favoritesReceived ?? 0), helper: 'Total' },
          { label: 'Productos publicados', value: String(totalResp.stats.productsPublished ?? 0), helper: 'Publicados' }
        ];
      } else {
        this.favoritesBreakdown = [];
        this.resetFavoritesPagination();
        this.topFavoritosPieData = [];
        this.productsVisibleCount = 0;
        this.productsHiddenCount = 0;
        this.totalSummaryCards = [
          { label: 'Favoritos recibidos', value: '-', helper: 'Total' },
          { label: 'Productos publicados', value: '-', helper: 'Publicados' }
        ];
      }
      this.totalStatsLoaded = true;
      this.cdr.detectChanges();
    }).catch((err) => {
      this.totalStatsLoaded = true;
      this.cdr.detectChanges();
    });
  }

  private loadStats(): void {
    const artisanId = this.usuario?._id || this.usuario?.uid || this.usuario?.id;
    if (!artisanId) return;

    const requestKey = `${String(artisanId)}:${String(this.periodo ?? '')}`;
    if (this.loadingKey === requestKey) return;
    if (this.statsLoaded && this.lastRequestKey === requestKey) return;

    this.lastRequestKey = requestKey;
    this.loadingKey = requestKey;

    this.loading = false;
    this.errorMsg = '';
    if (this.loadingTimer) clearTimeout(this.loadingTimer);
    this.loadingTimer = setTimeout(() => {
      if (this.loadingKey === requestKey) {
        this.loading = true;
        this.cdr.detectChanges();
      }
    }, 250);

    const token = this.authService.getToken() || '';
    if (!token) {
      this.errorMsg = 'Falta token de autorizacion.';
      this.loading = false;
      this.statsLoaded = true;
      this.loadingKey = null;
      return;
    }

    const headers = new HttpHeaders().set('x-token', token);
    const urlAgg = buildApiUrl(`stats/artisan/${artisanId}/aggregate?periodo=${this.periodo}`);

    this.http.get<any>(urlAgg, { headers }).toPromise().then((aggResp) => {
      // Métricas por periodo
      if (aggResp?.ok && aggResp.datos) {
        let currentArtisanId = this.usuario?._id || this.usuario?.uid || this.usuario?.id;
        if (typeof currentArtisanId === 'object' && currentArtisanId !== null && currentArtisanId.toString) {
          currentArtisanId = currentArtisanId.toString();
        }
        const artisanIdStr = String(currentArtisanId);
        let profileViews = 0;
        let productClicks = 0;
        if (aggResp.datos['view_artisan_profile']?.porArtisan) {
          const porArtisanProfile = aggResp.datos['view_artisan_profile'].porArtisan;
          profileViews = porArtisanProfile[artisanIdStr] ?? 0;
        } else {
          profileViews = aggResp.datos['view_artisan_profile']?.total ?? 0;
        }
        if (aggResp.datos['product_modal_open']?.porArtisan) {
          const porArtisan = aggResp.datos['product_modal_open'].porArtisan;
          productClicks = porArtisan[artisanIdStr] ?? 0;
        } else {
          productClicks = aggResp.datos['product_modal_open']?.total ?? 0;
        }
        this.periodSummaryCards = [
          { label: 'Visitas al perfil', value: String(profileViews), helper: 'Total' },
          { label: 'Clics en productos', value: String(productClicks), helper: 'Total' }
        ];
        // Preparar datos cruzados para gráficas
        this.productosBarData = [];
        this.productosPieData = [];
        if (aggResp.datos.productAnalytics && Array.isArray(this.favoritesBreakdown)) {
          const productosArtesano = this.favoritesBreakdown.map((p: any) => ({
            id: p.productId,
            name: p.name
          }));
          this.productosBarData = productosArtesano.map((prod: { id: string, name: string }) => {
            const cruzado = aggResp.datos.productAnalytics[prod.id] || { clicks: 0, avgDuration: 0 };
            return {
              name: prod.name,
              clicks: cruzado.clicks,
              avgDuration: cruzado.avgDuration
            };
          });
          let totalClicks = 0, totalViewFull = 0;
          productosArtesano.forEach((prod: { id: string, name: string }) => {
            const cruzado = aggResp.datos.productAnalytics[prod.id] || { clicks: 0, viewFull: 0 };
            totalClicks += cruzado.clicks;
            totalViewFull += cruzado.viewFull;
          });
          const soloModal = Math.max(totalClicks - totalViewFull, 0);
          this.productosPieData = [
            { label: 'Solo vieron el modal del producto', value: soloModal, color: '#3b82f6' },
            { label: 'Vieron la ficha completa', value: totalViewFull, color: '#f59e42' }
          ];
          this.modalFichaChartData = [
            { label: 'Modal', value: soloModal, color: '#3b82f6' },
            { label: 'Ficha', value: totalViewFull, color: '#b44194' }
          ];
        } else {
          this.modalFichaChartData = [];
        }
      } else {
        this.periodSummaryCards = [
          { label: 'Visitas al perfil', value: '-', helper: 'Total' },
          { label: 'Clics en productos', value: '-', helper: 'Total' }
        ];
        this.productosBarData = [];
        this.productosPieData = [];
        this.modalFichaChartData = [];
      }
      this.isMockData = false;
      this.statsLoaded = true;
      if (this.loadingTimer) { clearTimeout(this.loadingTimer); this.loadingTimer = null; }
      this.loading = false;
      this.loadingKey = null;
      this.cdr.detectChanges();
    }).catch((err) => {
      this.errorMsg = 'No se pudieron cargar las estadísticas por periodo. Se muestran las estadísticas generales.';
      this.statsLoaded = true;
      if (this.loadingTimer) { clearTimeout(this.loadingTimer); this.loadingTimer = null; }
      this.loading = false;
      this.loadingKey = null;
      this.cdr.detectChanges();
    });
  }

  get isPrimerDia(): boolean {
    const createdAt = this.usuario?.createdAt;
    if (!createdAt) return false;
    const hoy = new Date();
    const fecha = new Date(createdAt);
    return (
      fecha.getFullYear() === hoy.getFullYear() &&
      fecha.getMonth() === hoy.getMonth() &&
      fecha.getDate() === hoy.getDate()
    );
  }

  get periodoLabel(): string {
    return this.periodos.find((p) => p.value === this.periodo)?.label ?? 'Periodo';
  }

  public async exportarPdf(): Promise<void> {
    if (this.loading || this.isPrimerDia) return;

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

      const ensureSpace = (needed: number): void => {
        if (y + needed <= pageHeight - margin) return;
        doc.addPage();
        this.drawPdfPageBackground(doc, backgroundImage, pageWidth, pageHeight);
        y = margin;
      };

      doc.setTextColor(232, 232, 232);
      this.setPdfFont(doc, 'bold');
      doc.setFontSize(16);
      doc.text('Resumen de tus productos - Noma', margin, 12);
      doc.setFontSize(10);
      this.setPdfFont(doc, 'normal');
      doc.text(`Usuario: ${this.getUsuarioNombre()}`, margin, 18);
      doc.text(`Generado: ${this.formatDateTime(this.exportTimestamp)}`, pageWidth - margin, 18, { align: 'right' });

      y = 30;
      y = this.drawCardsSection(doc, y, 'Resumen total', this.totalSummaryCards, contentWidth, ensureSpace);

      y = await this.drawFavoritesTable(doc, y, margin, contentWidth, ensureSpace);

      const filename = `resumen-estadisticas-${this.exportTimestamp.toISOString().slice(0, 10)}.pdf`;
      doc.save(filename);
    } catch {
      this.pdfExportErrorMsg = 'No se pudo generar el PDF. Intenta de nuevo en unos segundos.';
    } finally {
      this.isExportingPdf = false;
      this.cdr.detectChanges();
    }
  }

  get hasProductActivity(): boolean {
    return this.productosBarData.some(p => p.clicks > 0 || p.avgDuration > 0);
  }

  get hasFullViewData(): boolean {
    return (this.productosPieData[0]?.value ?? 0) > 0 || (this.productosPieData[1]?.value ?? 0) > 0;
  }

  get hasFavoritesData(): boolean {
    return this.favoritesBreakdown.some(p => p.favorites > 0);
  }

  public nextFavoritesPage(): void {
    if (this.favoritesPageIndex + 1 >= this.favoritesTotalPages) return;
    this.favoritesPageIndex += 1;
    this.updateFavoritesPage();
  }

  public prevFavoritesPage(): void {
    if (this.favoritesPageIndex <= 0) return;
    this.favoritesPageIndex -= 1;
    this.updateFavoritesPage();
  }

  private resetFavoritesPagination(): void {
    this.favoritesPageIndex = 0;
    this.favoritesTotalPages = Math.ceil(this.favoritesBreakdown.length / this.favoritesPageSize) || 0;
    this.updateFavoritesPage();
  }

  private updateFavoritesPage(): void {
    const start = this.favoritesPageIndex * this.favoritesPageSize;
    const end = start + this.favoritesPageSize;
    this.favoritesPage = this.favoritesBreakdown.slice(start, end);
  }

  private drawCardsSection(
    doc: any,
    startY: number,
    title: string,
    cards: StatCard[],
    contentWidth: number,
    ensureSpace: (needed: number) => void
  ): number {
    const filteredCards = cards.filter((card) => card.value !== '-');
    if (!filteredCards.length) return startY;

    let y = startY;
    const margin = 14;
    const gap = 6;
    const columns = 2;
    const cardWidth = (contentWidth - gap) / columns;
    const cardHeight = 20;

    ensureSpace(14);
    this.setPdfFont(doc, 'bold');
    doc.setFontSize(12);
    doc.setTextColor(232, 232, 232);
    doc.text(title, margin, y);
    y += 6;

    filteredCards.forEach((card, index) => {
      const col = index % columns;
      if (col === 0) ensureSpace(cardHeight + 2);
      const row = Math.floor(index / columns);
      const x = margin + (col * (cardWidth + gap));
      const cardY = y + (row * (cardHeight + 4));

      doc.setDrawColor(62, 62, 62);
      doc.setLineWidth(0.16);
      
      doc.setFillColor(30, 30, 30);
      doc.roundedRect(x, cardY, cardWidth, cardHeight, 2, 2, 'FD');
      doc.setTextColor(191, 191, 191);
      this.setPdfFont(doc, 'bold');
      doc.setFontSize(9);
      doc.text(card.label, x + 3, cardY + 5);
      doc.setTextColor(245, 245, 245);
      this.setPdfFont(doc, 'bold');
      doc.setFontSize(14);
      doc.text(card.value, x + 3, cardY + 12);
      if (card.helper) {
        this.setPdfFont(doc, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(160, 160, 160);
        doc.text(card.helper, x + 3, cardY + 17);
      }
    });

    const rows = Math.ceil(filteredCards.length / columns);
    return y + (rows * (cardHeight + 4)) + 4;
  }

  private async drawFavoritesTable(
    doc: any,
    startY: number,
    margin: number,
    contentWidth: number,
    ensureSpace: (needed: number) => void
  ): Promise<number> {
    let y = startY;
    ensureSpace(14);
    this.setPdfFont(doc, 'bold');
    doc.setFontSize(12);
    doc.setTextColor(232, 232, 232);
    doc.text('Favoritos por producto', margin, y);
    y += 6;

    if (!this.favoritesBreakdown.length) {
      this.setPdfFont(doc, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(232, 232, 232);
      doc.text('Sin datos de favoritos para este usuario.', margin, y);
      return y + 6;
    }

    const colFav = Math.max(22, contentWidth * 0.18);
    const colProduct = contentWidth - colFav;
    const rowHeight = 10;
    const thumbSize = rowHeight - 2.4;
    const tableRadius = 1.8;
    const tableStartY = y;
    const tableRows = this.favoritesBreakdown.length + 1;
    const tableHeight = tableRows * rowHeight;

    ensureSpace(tableHeight + 2);
    doc.setDrawColor(62, 62, 62);
    doc.setLineWidth(0.16);
    doc.setFillColor(30, 30, 30);
    doc.roundedRect(margin, y, contentWidth, tableHeight, tableRadius, tableRadius, 'FD');

    doc.setFillColor(45, 45, 45);
    doc.roundedRect(margin, y, contentWidth, rowHeight, tableRadius, tableRadius, 'F');
    // Flatten header bottom corners so only top corners remain rounded.
    doc.rect(margin, y + rowHeight - tableRadius, contentWidth, tableRadius, 'F');
    this.setPdfFont(doc, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(240, 240, 240);
    doc.text('Producto', margin + 2, y + 6.2);
    doc.text('Favoritos', margin + colProduct + colFav - 2, y + 6.2, { align: 'right' });
    y += rowHeight;

    for (const item of this.favoritesBreakdown) {
      ensureSpace(rowHeight + 1);
      this.setPdfFont(doc, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(225, 225, 225);

      const imageDataUrl = await this.getImageDataUrlForPdf(item.thumbnail ?? null);
      if (imageDataUrl) {
        const roundedImageDataUrl = await this.getRoundedImageDataUrlForPdf(imageDataUrl);
        const format = imageDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(roundedImageDataUrl, format, margin + 1.2, y + 1.2, thumbSize, thumbSize);
      } else {
        doc.setDrawColor(90, 96, 110);
        doc.roundedRect(margin + 1.5, y + 1.5, thumbSize - 0.6, thumbSize - 0.6, 1.1, 1.1, 'S');
      }

      const name = this.truncateText(item.name, 42);
      doc.text(name, margin + thumbSize + 3.2, y + 6.2);
      doc.text(String(item.favorites), margin + colProduct + colFav - 2, y + 6.2, { align: 'right' });
      y += rowHeight;
    }

    doc.setDrawColor(62, 62, 62);
    doc.setLineWidth(0.16);
    doc.roundedRect(margin, tableStartY, contentWidth, tableHeight, tableRadius, tableRadius, 'S');
    doc.line(margin + colProduct, tableStartY, margin + colProduct, tableStartY + tableHeight);

    for (let i = 1; i < tableRows; i += 1) {
      const rowY = tableStartY + (i * rowHeight);
      doc.line(margin, rowY, margin + contentWidth, rowY);
    }

    return y + 6;
  }

  private async getImageDataUrlForPdf(imageUrl: string | null): Promise<string | null> {
    if (!imageUrl) return null;
    if (this.favoritesImageCache.has(imageUrl)) {
      return this.favoritesImageCache.get(imageUrl) ?? null;
    }

    const resolvedImageUrl = this.resolveImageUrlForPdf(imageUrl);
    if (!resolvedImageUrl) return null;

    const token = this.authService.getToken();
    const headers: HeadersInit = {};
    if (token) {
      headers['x-token'] = token;
    }

    try {
      // Intentar con headers de autenticación primero
      const resp = await fetch(resolvedImageUrl, {
        mode: 'cors',
        credentials: 'include',
        headers
      });
      if (!resp.ok) throw new Error('Image fetch failed');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      this.favoritesImageCache.set(imageUrl, blobUrl);
      return blobUrl;
    } catch (primaryError) {
      try {
        // Fallback sin headers
        const fallbackResp = await fetch(resolvedImageUrl, { mode: 'cors', credentials: 'include' });
        if (!fallbackResp.ok) throw new Error('Image fallback fetch failed');
        const fallbackBlob = await fallbackResp.blob();
        const blobUrl = URL.createObjectURL(fallbackBlob);
        this.favoritesImageCache.set(imageUrl, blobUrl);
        return blobUrl;
      } catch {
        console.warn('[Estadisticas] No se pudo cargar imagen para PDF:', resolvedImageUrl, primaryError);
        this.favoritesImageCache.set(imageUrl, null);
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
      const protocol = typeof window !== 'undefined' ? window.location.protocol : 'https:';
      return `${protocol}${raw}`;
    }

    // Las rutas de media del backend suelen venir relativas; forzamos API base.
    const normalizedPath = raw.startsWith('/') ? raw.slice(1) : raw;
    return buildApiUrl(normalizedPath);
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('No se pudo leer blob de imagen'));
      reader.readAsDataURL(blob);
    });
  }

  private getRoundedImageDataUrlForPdf(imageDataUrl: string): Promise<string> {
    if (this.roundedImageCache.has(imageDataUrl)) {
      return Promise.resolve(this.roundedImageCache.get(imageDataUrl)!);
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const size = 96;
        const radius = 14;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          this.roundedImageCache.set(imageDataUrl, imageDataUrl);
          resolve(imageDataUrl);
          return;
        }

        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(size - radius, 0);
        ctx.quadraticCurveTo(size, 0, size, radius);
        ctx.lineTo(size, size - radius);
        ctx.quadraticCurveTo(size, size, size - radius, size);
        ctx.lineTo(radius, size);
        ctx.quadraticCurveTo(0, size, 0, size - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        ctx.clip();

        ctx.drawImage(img, 0, 0, size, size);
        const rounded = canvas.toDataURL('image/png');
        this.roundedImageCache.set(imageDataUrl, rounded);
        resolve(rounded);
      };
      img.onerror = () => {
        this.roundedImageCache.set(imageDataUrl, imageDataUrl);
        resolve(imageDataUrl);
      };
      img.src = imageDataUrl;
    });
  }

  private truncateText(value: string, max: number): string {
    if (!value) return '';
    return value.length > max ? `${value.slice(0, max - 1)}...` : value;
  }

  private getUsuarioNombre(): string {
    return this.usuario?.email
      || this.usuario?.name
      || this.usuario?.nombre
      || this.usuario?.displayName
      || 'Artesano';
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
    const mmToPx = 3.7795275591; // 96 DPI
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
    this.drawRadialBlob(ctx, width * 0.80, height * 0.18, width * 0.70, height * 0.45, [147, 44, 141], 0.16, 0.12);
    this.drawRadialBlob(ctx, width * 0.50, height * 0.80, width * 0.70, height * 0.45, [55, 66, 154], 0.16, 0.12);

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
}
