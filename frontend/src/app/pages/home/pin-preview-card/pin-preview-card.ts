import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Carrusel } from '../../../commons/carrusel/carrusel';
import { PinHoverEvent } from '../engine/core/three/pin-manager';

@Component({
  selector: 'app-pin-preview-card',
  standalone: true,
  imports: [CommonModule, Carrusel],
  templateUrl: './pin-preview-card.html',
  styleUrl: './pin-preview-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PinPreviewCardComponent implements OnChanges, OnDestroy {
  @Input() hoverEvent: PinHoverEvent | null = null;
  @Output() productClick = new EventEmitter<any>();

  visible = false;
  cardX = 0;
  cardY = 0;

  productName = '';
  artisanName = '';
  location = '';
  carouselSlides: Array<{ src: string; alt?: string }> = [];

  private currentProduct: any = null;
  private lastProductRef: any = null;
  private isOverCard = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  // Tiempo que tiene el ratón para llegar a la tarjeta desde el pin
  private readonly BRIDGE_MS = 120;

  private readonly CARD_WIDTH = 260;
  private readonly CARD_HEIGHT = 240;
  private readonly OFFSET_X = 20;
  private readonly OFFSET_Y = -120;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['hoverEvent']) return;

    const event = this.hoverEvent;

    if (event?.product) {
      // Nuevo pin detectado: cancelar cualquier hide pendiente
      this.clearHide();

      // Posición y datos solo al cambiar de pin (tarjeta no se mueve con animaciones)
      if (event.product !== this.lastProductRef) {
        this.lastProductRef   = event.product;
        this.currentProduct   = event.product;
        this.updatePosition(event.screenX, event.screenY);
        this.updateProductData(event.product);
      }

      this.visible = true;
      this.cdr.markForCheck();
    } else {
      // Pin perdido: dar 120 ms para que el ratón llegue a la tarjeta
      this.scheduleHide();
    }
  }

  ngOnDestroy(): void {
    this.clearHide();
  }

  /** Ratón entra en la tarjeta: cancelar cualquier hide */
  onMouseEnter(): void {
    this.isOverCard = true;
    this.clearHide();
  }

  /** Ratón sale de la tarjeta: ocultar inmediatamente si no hay pin activo */
  onMouseLeave(): void {
    this.isOverCard = false;
    // Si el pin sigue activo, el motor 3D mantiene la tarjeta visible; si no, ocultar ya
    if (!this.hoverEvent?.product) {
      this.hide();
    }
  }

  onCardClick(e: MouseEvent): void {
    e.stopPropagation();
    if (this.currentProduct) this.productClick.emit(this.currentProduct);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private scheduleHide(): void {
    this.clearHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      // Solo ocultar si el ratón no llegó a la tarjeta Y no hay pin nuevo
      if (!this.isOverCard && !this.hoverEvent?.product) {
        this.hide();
      }
    }, this.BRIDGE_MS);
  }

  private hide(): void {
    this.visible        = false;
    this.lastProductRef = null;   // carrusel reinicia en el próximo hover
    this.cdr.markForCheck();
  }

  private clearHide(): void {
    if (this.hideTimer != null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private updatePosition(screenX: number, screenY: number): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = screenX + this.OFFSET_X;
    let y = screenY + this.OFFSET_Y;

    if (x + this.CARD_WIDTH  > vw - 12) x = screenX - this.CARD_WIDTH  - this.OFFSET_X;
    if (y + this.CARD_HEIGHT > vh - 12) y = vh - this.CARD_HEIGHT - 12;
    if (y < 12) y = 12;
    if (x < 12) x = 12;

    this.cardX = x;
    this.cardY = y;
  }

  private updateProductData(product: any): void {
    this.productName = product.title || product.nombre || product.name || 'Producto artesanal';

    const owner = product.owner;
    if (owner && typeof owner === 'object') {
      this.artisanName = owner.company_name
        || [owner.name, owner.surname].filter(Boolean).join(' ').trim()
        || '';
    } else if (product.owner_name) {
      this.artisanName = product.owner_name;
    } else if (typeof owner === 'string') {
      this.artisanName = owner;
    } else {
      this.artisanName = '';
    }

    this.location = '';

    const media  = Array.isArray(product.media) ? product.media : [];
    const fallback = product.thumbnail || product.image || product.imagenPrincipal || product.imagen || '';
    const all    = media.length > 0 ? media : (fallback ? [fallback] : []);
    this.carouselSlides = all.map((src: string) => ({ src }));
  }

  get fallbackInitial(): string {
    return this.productName?.charAt(0)?.toUpperCase() || 'N';
  }
}
