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
import { ClusterHoverEvent } from '../engine/core/three/pin-manager';

@Component({
  selector: 'app-cluster-preview-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cluster-preview-card.html',
  styleUrl: './cluster-preview-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ClusterPreviewCardComponent implements OnChanges, OnDestroy {
  @Input() hoverEvent: ClusterHoverEvent | null = null;
  @Output() productClick = new EventEmitter<any>();

  visible = false;
  cardX = 0;
  cardY = 0;

  products: any[] = [];
  count = 0;
  displayProducts: any[] = [];
  displayedProducts: any[] = [];
  extraCount = 0;

  private lastClusterRef: any = null;
  private isOverCard = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  // Tiempo que tiene el ratón para llegar a la tarjeta desde el cluster
  private readonly BRIDGE_MS = 120;

  private readonly CARD_WIDTH = 320;
  private readonly CARD_HEIGHT = 400;
  private readonly OFFSET_X = 20;
  private readonly OFFSET_Y = -200;
  private readonly MAX_DISPLAY = 5;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['hoverEvent']) return;

    const event = this.hoverEvent;

    if (event?.products && event.products.length > 0) {
      // Nuevo cluster detectado: cancelar cualquier hide pendiente
      this.clearHide();

      // Actualizar datos solo al cambiar de cluster
      const clusterKey = event.products.map((p: any) => p._id || p.uid).join(',');
      if (clusterKey !== this.lastClusterRef) {
        this.lastClusterRef = clusterKey;
        this.products = event.products;
        this.count = event.count;
        this.displayProducts = this.products.slice(0, this.MAX_DISPLAY);
        this.displayedProducts = this.displayProducts;
        this.extraCount = Math.max(0, this.count - this.MAX_DISPLAY);
        this.updatePosition(event.screenX, event.screenY);
      }

      this.visible = true;
      this.cdr.markForCheck();
    } else {
      // Cluster perdido: dar tiempo para que el ratón llegue a la tarjeta
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

  /** Ratón sale de la tarjeta: siempre programar ocultación (igual que los pines) */
  onMouseLeave(): void {
    this.isOverCard = false;
    this.scheduleHide();
  }

  onProductClick(e: MouseEvent, product: any): void {
    e.stopPropagation();
    this.hide();
    this.productClick.emit(product);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private scheduleHide(): void {
    this.clearHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      // Ocultar siempre que el ratón no esté sobre la tarjeta
      if (!this.isOverCard) {
        this.hide();
      }
    }, this.BRIDGE_MS);
  }

  private hide(): void {
    this.visible = false;
    this.lastClusterRef = null;
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

  // ── Template helpers ─────────────────────────────────────────────────────────

  getProductName(product: any): string {
    return product.title || product.name || product.nombre || 'Producto sin nombre';
  }

  getProductImage(product: any): string | null {
    if (product.media && product.media.length > 0) return product.media[0];
    return product.thumbnail || product.image || null;
  }

  getProductCategory(product: any): string {
    return product.category || product.categoria || '';
  }

  getArtisanName(product: any): string {
    if (product.owner_name) return product.owner_name;
    const owner = product.owner;
    if (!owner) return '';
    if (typeof owner === 'string') return owner;
    return owner.company_name
      || [owner.name, owner.surname].filter(Boolean).join(' ').trim()
      || '';
  }

  get remainingCount(): number {
    return Math.max(0, this.count - this.MAX_DISPLAY);
  }
}
