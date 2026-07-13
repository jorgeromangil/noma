import { Component, ChangeDetectorRef, OnInit, ViewEncapsulation, ChangeDetectionStrategy } from '@angular/core';
import { CustomTooltipDirective } from '../../shared/custom-tooltip.directive';
import { CommonModule } from '@angular/common';
import { Title, Meta } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AnalyticsService } from '../../services/analytics.service';

import { buildApiUrl } from '../../shared/api-base';

@Component({
  selector: 'app-artesano-publico',
  standalone: true,
    imports: [CommonModule, RouterModule, CustomTooltipDirective],
  templateUrl: './artesano-publico.html',
  // Reutiliza el CSS del perfil para mantener el estilo
  styleUrls: ['../dashboard/perfil/perfil.css', './artesano-publico.css'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ArtesanoPublicoComponent implements OnInit {
  openProductDetail(product: any): void {
    const productSlug = product?.slug;
    if (!productSlug) {
      console.warn('El producto no tiene slug:', product);
      return;
    }
    this.router.navigate(['/producto', productSlug]);
  }
  public loading = true;
  public errorMsg = '';

  public artesano: any = null;
  public productos: any[] = [];
  public productosFiltrados: any[] = [];
  public totalProductos = 0;
  private resolvedArtisanId = '';
  private productSearchQuery = '';
  // Paginación

  public showSharePopup = false;
  public shareUrl = '';

  copiarUrl(): void {
    this.shareUrl = window.location.href;
    this.showSharePopup = true;
    this.cdr.detectChanges();
  }

  closeSharePopup(): void {
    this.showSharePopup = false;
    this.cdr.detectChanges();
  }

  copiarAlPortapapeles(): void {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(this.shareUrl);
      // Cambiar el texto del botón temporalmente
      const textoSpan = document.querySelector('.share-copy-text');
      if (textoSpan) {
        const textoOriginal = textoSpan.textContent;
        textoSpan.textContent = '¡Copiado!';
        setTimeout(() => {
          textoSpan.textContent = textoOriginal;
        }, 2000);
      }
    }
  }

  contactarArtesano(): void {
    if (this.artesano?.email) {
      const mailto = `mailto:${this.artesano.email}`;
      window.open(mailto, '_blank');
    }
  }
  public page = 1;
  public pageSize = 8;
  public get totalPages(): number {
    return Math.ceil(this.totalProductos / this.pageSize) || 1;
  }
  public get paginatedProductos(): any[] {
    return this.productosFiltrados;
  }
  setPage(p: number) {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.cargarProductosArtesano();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private router: Router,
    private analytics: AnalyticsService,
    private cdr: ChangeDetectorRef,
    private titleService: Title,
    private metaService: Meta
  ) {}

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.errorMsg = 'No se pudo identificar al artesano.';
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.errorMsg = '';

    const artisanUrl = buildApiUrl(`users/artisan/slug/${slug}`);
    this.http.get<any>(artisanUrl).subscribe({
      next: (resp) => {
        this.artesano = resp?.artisan || null;
        const resolvedId = this.artesano?.uid || this.artesano?._id || this.artesano?.id;
        if (resolvedId) {
          this.resolvedArtisanId = String(resolvedId);
          this.analytics.trackEvent('view_artisan_profile', {
            artisan_id: String(resolvedId)
          });
          this.cargarProductosArtesano(() => {
            this.loading = false;
            const artesanoName = this.artesano?.company_name || [this.artesano?.name, this.artesano?.surname].filter(Boolean).join(' ') || 'Artesano';
            const artesanoDesc = `Perfil de ${artesanoName} en Noma. Descubre sus productos artesanales con denominación de origen.`;
            this.titleService.setTitle(`${artesanoName} - Artesano en Noma`);
            this.metaService.updateTag({ name: 'description', content: artesanoDesc });
            this.metaService.updateTag({ property: 'og:title', content: `${artesanoName} - Artesano en Noma` });
            this.metaService.updateTag({ property: 'og:description', content: artesanoDesc });
            this.metaService.updateTag({ property: 'og:url', content: `https://noma.ovh/artesano/${slug}` });
            this.cdr.markForCheck();
          });
        } else {
          this.productos = [];
          this.productosFiltrados = [];
          this.loading = false;
          this.errorMsg = 'Artesano no encontrado.';
          this.cdr.markForCheck();
        }
      },
      error: (err) => {
        this.artesano = null;
        this.productos = [];
        this.productosFiltrados = [];
        this.loading = false;
        let msg = 'Artesano no encontrado.';
        if (err && err.error && err.error.msg) {
          msg = err.error.msg;
        }
        this.errorMsg = msg;
        this.cdr.markForCheck();
      }
    });
  }

  buscar(event: any) {
    this.productSearchQuery = String(event?.target?.value || '').trim();
    this.page = 1;
    this.cargarProductosArtesano();
  }

  private cargarProductosArtesano(done?: () => void): void {
    if (!this.resolvedArtisanId) {
      this.productos = [];
      this.productosFiltrados = [];
      this.totalProductos = 0;
      done?.();
      this.cdr.markForCheck();
      return;
    }

    const params = new URLSearchParams({
      owner: this.resolvedArtisanId,
      from: String((this.page - 1) * this.pageSize),
      recordsPerPage: String(this.pageSize)
    });

    if (this.productSearchQuery) {
      params.set('q', this.productSearchQuery);
    }

    this.http.get<any>(buildApiUrl(`products?${params.toString()}`)).pipe(
      catchError(() => of({ products: [], total: 0 }))
    ).subscribe((resp) => {
      this.productos = Array.isArray(resp?.products) ? resp.products : [];
      this.productosFiltrados = [...this.productos];
      this.totalProductos = Number(resp?.page?.total ?? resp?.total ?? this.productos.length);
      done?.();
      this.cdr.markForCheck();
    });
  }

  getPrimaryImage(product: any): string {
    const media: string[] = Array.isArray(product?.media) ? product.media : [];
    return media.length > 0 ? media[0] : (product?.image || '/default-product.png');
  }

  openProductOnMap(product: any, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    const productSlug = product?.slug;
    if (!productSlug) return;
    this.router.navigate(['/home'], {
      queryParams: { product: String(productSlug) }
    });
  }

}
