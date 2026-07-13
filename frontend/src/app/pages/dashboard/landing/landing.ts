import { AfterViewInit, Component, ElementRef, Inject, OnDestroy, OnInit, PLATFORM_ID, Renderer2, ViewChild, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { buildApiUrl } from '../../../shared/api-base';
import { CustomTooltipDirective } from '../../../shared/custom-tooltip.directive';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Title, Meta } from '@angular/platform-browser';
import { Navbar } from '../../../commons/navbar/navbar';
import { Footer } from '../../../commons/footer/footer';
import { Carrusel } from '../../../commons/carrusel/carrusel';
import { MapProductsCacheService } from '../../../services/map-products-cache.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, Navbar, Footer, Carrusel, CustomTooltipDirective],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
  encapsulation: ViewEncapsulation.None
})
export class LandingComponent implements OnInit, OnDestroy, AfterViewInit {

    // Redondea el número a la decena más baja (10, 20, 30, ...)
    getRoundedCount(n: number|null): number|string {
      if (n === null || n === undefined) return '-';
      if (n < 10) return n;
      if (n < 100) return Math.floor(n / 10) * 10;
      if (n < 1000) return Math.floor(n / 100) * 100;
      return Math.floor(n / 1000) * 1000;
    }
  @ViewChild('learningObjectFrame') learningObjectFrame?: ElementRef<HTMLIFrameElement>;
  private resizeLearningObjectHandler = () => this.syncLearningObjectSize();
  private revealObserver?: IntersectionObserver;
  private revealElements: HTMLElement[] = [];
  private revealFallbackHandler = () => this.applyRevealFallback();
  private revealSafetyTimeoutId?: number;

  heroSlides = [
    {
      src: '/assets/landing/ceramica.jpg',
      alt: 'Cerámica artesanal'
    },
    {
      src: '/assets/landing/olivo.jpg',
      alt: 'Olivo'
    },
    {
      src: '/assets/landing/cesta.jpg',
      alt: 'Cesta de mimbre'
    },
    {
      src: '/assets/landing/vino.png',
      alt: 'Vino tinto'
    },
  ];
  heroHeading = 'La tradición también se puede mapear';
  heroSubtitle = 'Noma es una plataforma digital que localiza, documenta y visibiliza a productores artesanos y productos de origen local mediante tecnología y un mapa 3D interactivo en el que explorar.';
  heroNote = 'Descubre productores locales y productos de origen directamente sobre el mapa.';
  heroCtaLabel = 'Explora el mapa';
  heroCtaLink = '/home';

  // Estadísticas públicas
  artisansCount: number|null = null;
  productsCount: number|null = null;
  categoriesCount: number|null = null;

  constructor(
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) private platformId: Object,
    private titleService: Title,
    private metaService: Meta,
    private http: HttpClient,
    private mapProductsCacheService: MapProductsCacheService
  ) {}

  ngOnInit(): void {
    this.titleService.setTitle('Noma - Artesanía Española en el Mapa');
    this.metaService.updateTag({ name: 'description', content: 'Noma localiza, documenta y visibiliza productores artesanos y productos de origen local en España mediante un mapa 3D interactivo.' });
    this.metaService.updateTag({ property: 'og:title', content: 'Noma - Artesanía Española en el Mapa' });
    this.metaService.updateTag({ property: 'og:description', content: 'Descubre productores artesanos locales y productos con denominación de origen directamente sobre el mapa 3D interactivo de Noma.' });
    this.metaService.updateTag({ property: 'og:url', content: 'https://noma.ovh' });
    this.metaService.updateTag({ name: 'twitter:title', content: 'Noma - Artesanía Española en el Mapa' });
    this.metaService.updateTag({ name: 'twitter:description', content: 'Descubre productores artesanos locales y productos con denominación de origen en el mapa 3D de Noma.' });
    this.renderer.addClass(this.document.body, 'landing-mode');
    this.renderer.addClass(this.document.documentElement, 'landing-mode');

    if (isPlatformBrowser(this.platformId)) {
      this.mapProductsCacheService.warmUpCache().subscribe({
        error: (error) => {
          console.warn('[Landing] No se pudo precargar la caché del mapa.', error);
        }
      });
    }

    // Obtener estadísticas públicas
    this.http.get<any>(buildApiUrl('public/stats')).subscribe({
      next: (resp) => {
        if (resp && resp.ok && resp.stats) {
          this.artisansCount = resp.stats.artisans;
          this.productsCount = resp.stats.products;
          this.categoriesCount = resp.stats.categories;
        } else {
          console.warn('Respuesta sin datos esperados', resp);
        }
      },
      error: (err) => {
        console.error('Error al obtener /api/public/stats', err);
        this.artisansCount = null;
        this.productsCount = null;
        this.categoriesCount = null;
      }
    });
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId) || typeof window === 'undefined') {
      return;
    }

    this.initRevealAnimations();

    const iframeElement = this.learningObjectFrame?.nativeElement;

    if (iframeElement) {
      iframeElement.addEventListener('load', this.resizeLearningObjectHandler);
      window.addEventListener('resize', this.resizeLearningObjectHandler);
      // Run once in case the iframe is served from cache.
      setTimeout(this.resizeLearningObjectHandler, 0);
    }
  }

  ngOnDestroy(): void {
    this.renderer.removeClass(this.document.body, 'landing-mode');
    this.renderer.removeClass(this.document.documentElement, 'landing-mode');
    this.renderer.removeClass(this.document.body, 'reveal-ready');

    if (isPlatformBrowser(this.platformId) && typeof window !== 'undefined') {
      const iframeElement = this.learningObjectFrame?.nativeElement;
      if (iframeElement) {
        iframeElement.removeEventListener('load', this.resizeLearningObjectHandler);
      }
      if (this.revealSafetyTimeoutId) {
        clearTimeout(this.revealSafetyTimeoutId);
      }
      window.removeEventListener('resize', this.resizeLearningObjectHandler);
      window.removeEventListener('scroll', this.revealFallbackHandler, { capture: false });
      window.removeEventListener('resize', this.revealFallbackHandler, { capture: false });
      this.revealObserver?.disconnect();
    }
  }

  private initRevealAnimations(): void {
    if (!isPlatformBrowser(this.platformId) || typeof window === 'undefined') {
      return;
    }

    this.revealElements = Array.from(this.document.querySelectorAll<HTMLElement>('.reveal'));
    if (!this.revealElements.length) {
      return;
    }

    this.renderer.addClass(this.document.body, 'reveal-ready');

    // Escalonar con una pequeña demora progresiva para que el efecto se sienta fluido.
    this.revealElements.forEach((element, index) => {
      const delay = Math.min(index * 80, 480);
      element.style.setProperty('--reveal-delay', `${delay}ms`);
    });

    this.revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.08,
      rootMargin: '0px 0px -2% 0px'
    });

    this.revealElements.forEach((element) => this.revealObserver?.observe(element));

    // Fallback manual en caso de que el observer falle (p.ej. navegadores antiguos o iframes).
    window.addEventListener('scroll', this.revealFallbackHandler, { passive: true, capture: false });
    window.addEventListener('resize', this.revealFallbackHandler, { passive: true, capture: false });
    // Ejecutar al menos una vez tras el siguiente frame para mostrar lo que ya está en viewport.
    requestAnimationFrame(this.revealFallbackHandler);
    // Seguridad extra: si algo impide que el observer dispare, mostramos todo tras un pequeño delay.
    this.revealSafetyTimeoutId = window.setTimeout(() => {
      const someVisible = this.revealElements.some((el) => el.classList.contains('is-visible'));
      if (!someVisible) {
        this.revealElements.forEach((el) => el.classList.add('is-visible'));
      }
    }, 2000);
  }

  private applyRevealFallback(): void {
    if (!this.revealElements.length) {
      return;
    }
    const viewportH = window.innerHeight || 0;
    this.revealElements.forEach((el) => {
      if (el.classList.contains('is-visible')) return;
      const rect = el.getBoundingClientRect();
      const visible = rect.top < viewportH * 0.96 && rect.bottom > 0;
      if (visible) {
        el.classList.add('is-visible');
        this.revealObserver?.unobserve(el);
      }
    });
  }

  private syncLearningObjectSize(): void {
    const iframeElement = this.learningObjectFrame?.nativeElement;
    if (!iframeElement) {
      return;
    }

    const iframeDocument = iframeElement.contentDocument ?? iframeElement.contentWindow?.document;
    const iframeRoot = iframeDocument?.documentElement;
    const iframeBody = iframeDocument?.body;

    if (!iframeDocument || !iframeRoot) {
      return;
    }

    this.applyLearningObjectOverflowFixes(iframeDocument);

    iframeElement.style.height = '';
    iframeRoot.style.transform = '';
    iframeRoot.style.width = '';
    iframeRoot.style.overflowX = 'hidden';
    iframeRoot.style.overflowY = 'auto';
    iframeRoot.style.transformOrigin = 'top left';
    iframeRoot.style.maxWidth = '100%';
    iframeElement.style.overflowX = 'hidden';
    iframeElement.style.overflowY = 'auto';
    iframeElement.style.overflow = 'auto';
    iframeElement.setAttribute('scrolling', 'yes');
    if (iframeBody) {
      iframeBody.style.overflowX = 'hidden';
      iframeBody.style.overflowY = 'auto';
      iframeBody.style.maxWidth = '100%';
    }

    const availableWidth = iframeElement.clientWidth || iframeElement.parentElement?.clientWidth || 0;
    const contentWidth = iframeRoot.scrollWidth;
    const scale = contentWidth && availableWidth ? Math.min(1, availableWidth / contentWidth) : 1;

    iframeRoot.style.transform = scale < 1 ? `scale(${scale})` : '';
    iframeRoot.style.width = scale < 1 ? `${100 / scale}%` : '100%';
    iframeElement.style.width = '100%';
    iframeElement.style.maxWidth = '100%';

    const contentHeight = (iframeBody?.scrollHeight || iframeRoot.scrollHeight || iframeDocument.body?.scrollHeight || 0);
    const scaledHeight = Math.ceil(contentHeight * (scale || 1));
    const minHeight = 420;
    const maxHeight = Math.max(Math.floor((typeof window !== 'undefined' ? window.innerHeight : 0) * 0.8), minHeight);
    const targetHeight = scaledHeight > 0
      ? Math.min(Math.max(scaledHeight, minHeight), maxHeight)
      : minHeight;

    iframeElement.style.height = `${targetHeight}px`;
    iframeElement.style.minHeight = `${minHeight}px`;
  }

  private applyLearningObjectOverflowFixes(doc: Document): void {
    const styleId = 'learning-object-overflow-fix';
    if (doc.getElementById(styleId)) {
      return;
    }

    const style = doc.createElement('style');
    style.id = styleId;
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
      :root {
        --primary: #eb4224;
        --accent: #932c8d;
        --secondary: #37429a;
        --panel: #0f1120;
        --panel-2: #15182b;
        --text: #e9ecf7;
        --muted: #b1b5c5;
        --border: rgba(255, 255, 255, 0.08);
      }
      /* Reset fondos claros del objeto */
      html, body, #content, .exe-content, .exe-content *, main.page, .page-content, #node-content-container, #node-content {
        background: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
      }
      html, body { overflow-x: hidden !important; width: 100% !important; max-width: 100% !important; }
      body { font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif !important; background: var(--panel) !important; color: var(--text) !important; line-height: 1.6 !important; }
      body.exe-web-site { background: var(--panel) !important; }
      html { background: var(--panel) !important; }
      body::before {
        content: '';
        position: fixed;
        inset: 0;
        background:
          radial-gradient(90% 120% at 16% 16%, rgba(235, 66, 36, 0.16), rgba(12, 13, 22, 0.9) 60%),
          radial-gradient(90% 130% at 84% 12%, rgba(55, 66, 154, 0.16), rgba(12, 13, 22, 0.95) 68%),
          linear-gradient(180deg, rgba(12, 13, 22, 0.6), rgba(12, 13, 22, 0.95));
        z-index: -1;
        pointer-events: none;
      }
      .siteNav-hidden { background: transparent !important; }
      #exe-index, .exe-content, main.page { width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }
      .exe-content { background: transparent !important; }
      .exe-web-site .exe-content,
      body.siteNav-off .exe-content {
        background: transparent !important;
        box-shadow: none !important;
        position: relative !important;
      }
      body.exe-web-site .exe-content,
      #node-content-container.exe-content {
        background: transparent !important;
        box-shadow: none !important;
      }
      .exe-web-site .exe-content::before,
      .exe-web-site .exe-content::after,
      main.page::before,
      main.page::after {
        content: none !important;
        display: none !important;
      }
      #node-content-container,
      #node-content,
      .page-content,
      #content {
        background: transparent !important;
        box-shadow: none !important;
      }
      .exe-content .iDevice_wrapper,
      .exe-content .iDevice {
        background: rgba(0, 0, 0, 0.08) !important;
        border-radius: 0.9em !important;
        border: 0.0625em solid var(--border) !important;
      }
      .exe-web-site main { background: transparent !important; }
      main.page {
        background:
          radial-gradient(90% 120% at 16% 16%, rgba(235, 66, 36, 0.14), rgba(12, 13, 22, 0.85) 58%),
          radial-gradient(80% 120% at 86% 10%, rgba(55, 66, 154, 0.14), rgba(12, 13, 22, 0.92) 68%),
          linear-gradient(180deg, rgba(12, 13, 22, 0.6), rgba(12, 13, 22, 0.95));
        border-radius: 1.1em;
        padding: 1.25em 1.25em 1.75em 236px !important;
        box-shadow: 0 1.25em 3em rgba(0, 0, 0, 0.36);
        border: 0.0625em solid var(--border);
      }
      body.siteNav-off main.page { padding-left: 1.1em !important; }
      body.siteNav-off #siteFooter { padding-left: 1.1em !important; }
      #siteNav {
        width: 220px !important;
        max-width: 220px !important;
        background:
          radial-gradient(90% 110% at 20% 12%, rgba(235, 66, 36, 0.16), rgba(12, 13, 22, 0.9) 60%),
          radial-gradient(90% 120% at 80% 8%, rgba(55, 66, 154, 0.16), rgba(12, 13, 22, 0.95) 62%),
          rgba(12, 13, 22, 0.92) !important;
        background-image: none !important;
        border-right: 0.0625em solid var(--border) !important;
        backdrop-filter: blur(0.6em) !important;
        -webkit-backdrop-filter: blur(0.6em) !important;
      }
      #siteNav .navbar,
      #siteNav .navbar-inner,
      #siteNav .well { background: transparent !important; border: none !important; box-shadow: none !important; }
      #siteNav ul,
      #siteNav li { background: transparent !important; }
      #siteNav * { background: transparent !important; background-image: none !important; color: var(--muted) !important; }
      #siteNav a {
        color: var(--muted) !important;
        font-weight: 600 !important;
        text-decoration: none !important;
        background: transparent !important;
        border-radius: 0.65em !important;
        padding: 0.45em 0.65em !important;
      }
      #siteNav a:hover { color: #f3d9ff !important; }
      #siteNav a.active, #siteNav a.highlighted-link {
        color: var(--primary) !important;
        font-weight: 800 !important;
        background: rgba(235, 66, 36, 0.12) !important;
        box-shadow: inset 0 0 0 0.0625em rgba(255, 255, 255, 0.08);
      }
      #siteNav li.active > a,
      #siteNav li > a.active { background: rgba(235, 66, 36, 0.12) !important; color: var(--primary) !important; }
      #siteNav .list-group-item,
      #siteNav li a.list-group-item {
        background: transparent !important;
        border: none !important;
        padding-left: 0.4em !important;
      }
      #content,
      .exe-web-site #content { background: transparent !important; }
      .main-header,
      .page-header,
      .package-header {
        background: transparent !important;
        border: none !important;
        padding: 0.35em 0 0.5em !important;
      }
      .package-title,
      .page-title {
        color: #f7f6ff !important;
        font-weight: 800 !important;
        letter-spacing: -0.01em !important;
      }
      .box {
        background: rgba(255, 255, 255, 0.04) !important;
        border: 0.0625em solid var(--border) !important;
        border-radius: 1em !important;
        box-shadow: 0 1em 2.35em rgba(0, 0, 0, 0.32) !important;
        color: var(--text) !important;
      }
      .box-head {
        border-bottom: 0.0625em solid rgba(255, 255, 255, 0.06) !important;
        padding: 0.75em 0.9em !important;
      }
      .box-title { font-weight: 800 !important; font-size: 1.05rem !important; color: #f9f7ff !important; }
      .box-toggle {
        background: linear-gradient(140deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.06)) !important;
        border: 0.0625em solid var(--border) !important;
        color: var(--text) !important;
        box-shadow: 0 0.35em 1em rgba(0, 0, 0, 0.32) !important;
        background-image: none !important;
      }
      .box-toggle span { display: none !important; }
      .box-toggle::after {
        content: '';
        position: absolute;
        inset: 0.25em;
        border-radius: 50%;
        background: rgba(12, 13, 22, 0.45);
      }
      .box-content {
        padding: 1em 1.05em 1.15em !important;
        background: rgba(0, 0, 0, 0.14) !important;
      }
      /* Panel principal del contenido (lado derecho) */
      #node-content,
      .page-content,
      main.page {
        background:
          radial-gradient(90% 120% at 12% 10%, rgba(235, 66, 36, 0.12), rgba(12, 13, 22, 0.92) 62%),
          radial-gradient(110% 130% at 86% 12%, rgba(55, 66, 154, 0.12), rgba(12, 13, 22, 0.95) 70%),
          linear-gradient(180deg, rgba(12, 13, 22, 0.55), rgba(12, 13, 22, 0.92));
        border-radius: 1.15em !important;
        border: 0.0625em solid rgba(255, 255, 255, 0.06) !important;
        box-shadow: inset 0 0 0 0.0625em rgba(255, 255, 255, 0.03), 0 1.25em 3em rgba(0, 0, 0, 0.34) !important;
      }
      .exe-text-activity p,
      .exe-text-activity li {
        color: var(--text) !important;
      }
      .exe-text-activity a { color: #f08a73 !important; }
      .exe-text-activity ol { padding-left: 1.1em !important; }
      .exe-text-activity li::marker { color: var(--primary) !important; }
      h1, h2, h3, h4 { color: #f7f6ff !important; }
      p, li, a, span, strong { color: var(--text) !important; }
      #siteFooter {
        background: transparent !important;
        border-top: 0.0625em solid rgba(255, 255, 255, 0.08) !important;
        color: var(--muted) !important;
        padding: 0.75em 0 !important;
      }
      #packageLicense a { color: #f08a73 !important; }
      #made-with-eXe { display: none !important; }
      .nav-buttons { display: none !important; }
      /* Controles superiores (tres líneas) */
      .navbar-toggle,
      .navbar-toggler {
        background: rgba(255, 255, 255, 0.08) !important;
        border: 0.0625em solid var(--border) !important;
        color: var(--text) !important;
        border-radius: 0.7em !important;
      }
      /* Meseta blanca original */
      .exe-web-site main.page,
      .exe-web-site #content {
        background: transparent !important;
      }
      /* Scrollbar dentro del iframe */
      ::-webkit-scrollbar { width: 0.5em; }
      ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.18); border-radius: 0.65em; box-shadow: inset 0 0 0 0.0625em rgba(0,0,0,0.4); }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.24); }
      ::-webkit-scrollbar-track { background: rgba(12, 13, 22, 0.65); border-radius: 0.65em; }
      html { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) rgba(12,13,22,0.65); }
      /* Mantener overflow y ancho forzado */
      .exe-web-site main.page { box-sizing: border-box !important; }
      /* Menú hamburguesa dentro del objeto */
      .navbar-toggle,
      .navbar-toggler,
      .navbar-light .navbar-toggler {
        background: rgba(255, 255, 255, 0.08) !important;
        border: 0.0625em solid var(--border) !important;
        color: var(--text) !important;
      }
      .navbar-light .navbar-toggler-icon {
        filter: invert(1) opacity(0.9) !important;
      }
      * { box-sizing: border-box !important; }
      @media (max-width: 860px) {
        main.page { padding: 1em !important; }
        #siteNav { width: 100% !important; max-width: 100% !important; border-radius: 0.9em !important; margin-bottom: 0.9em !important; }
      }
    `;
    doc.head?.appendChild(style);
  }

}
