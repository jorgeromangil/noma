import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';

export interface OverlapProduct {
  title?: string;
  name?: string;
  thumbnail?: string;
  image?: string;
  media?: string[];
  owner_name?: string;
  owner?: any;
  category?: string;
  [key: string]: any;
}

@Component({
  selector: 'app-overlap-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './overlap-panel.html',
  styleUrl: './overlap-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('panelAnim', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(-1.5em)' }),
        animate('250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          style({ opacity: 1, transform: 'translateX(0)' }))
      ]),
      transition(':leave', [
        animate('180ms ease-out',
          style({ opacity: 0, transform: 'translateX(-1em)' }))
      ])
    ]),
    trigger('backdropAnim', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0 }))
      ])
    ])
  ]
})
export class OverlapPanelComponent {
  @Input() products: OverlapProduct[] = [];
  @Input() visible: boolean = false;
  @Output() productSelected = new EventEmitter<OverlapProduct>();
  @Output() close = new EventEmitter<void>();

  getProductName(product: OverlapProduct): string {
    return product.title || product.name || 'Producto sin nombre';
  }

  getArtisanName(product: OverlapProduct): string {
    if (product.owner_name) return product.owner_name;
    const owner = product.owner;
    if (!owner) return '';
    if (typeof owner === 'string') return owner;
    return owner.company_name
      || [owner.name, owner.surname].filter(Boolean).join(' ').trim()
      || '';
  }

  getProductImage(product: OverlapProduct): string {
    if (product.media && product.media.length > 0) return product.media[0];
    return product.thumbnail || product.image || 'https://via.placeholder.com/80x80?text=Sin+foto';
  }

  getCategoryLabel(product: OverlapProduct): string {
    return product.category || '';
  }

  onSelect(product: OverlapProduct): void {
    this.productSelected.emit(product);
  }

  onClose(): void {
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('overlap-backdrop')) {
      this.onClose();
    }
  }
}
