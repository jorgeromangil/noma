import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CustomTooltipDirective } from '../../../../../../shared/custom-tooltip.directive';

export type ProductInventoryViewMode = 'mosaic' | 'table';
export type ProductInventorySectionKind = 'visible' | 'hidden';

export interface ProductSelectionChangeEvent {
  product: any;
  selected: boolean;
}

export interface ProductInventoryPagination {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  disabled?: boolean;
}

export interface ProductInventoryPageChangeEvent {
  section: ProductInventorySectionKind;
  page: number;
}

interface InventoryViewOption {
  value: ProductInventoryViewMode;
  label: string;
  icon: string;
}

interface ProductInventorySection {
  title: string;
  products: any[];
  hidden: boolean;
  kind: ProductInventorySectionKind;
}

@Component({
  selector: 'app-product-inventory-grid',
  standalone: true,
  imports: [CommonModule, RouterModule, CustomTooltipDirective],
  templateUrl: './product-inventory-grid.component.html',
  styleUrl: './product-inventory-grid.component.css'
})
export class ProductInventoryGridComponent {
  readonly trackBySection = (_: number, section: ProductInventorySection): string => section.title;
  readonly viewModeOptions: InventoryViewOption[] = [
    { value: 'mosaic', label: 'Mosaico', icon: 'grid_view' },
    { value: 'table', label: 'Lista', icon: 'view_list' }
  ];
  @Input() productosVisibles: any[] = [];
  @Input() productosOcultos: any[] = [];
  @Input() showOwnerInfo = false;
  @Input() showViewModeSwitcher = false;
  @Input() selectionEnabled = false;
  @Input() selectedProductIds: ReadonlySet<string> = new Set<string>();
  @Input() selectionDisabled = false;
  @Input() viewMode: ProductInventoryViewMode = 'mosaic';
  @Input() visiblePagination: ProductInventoryPagination | null = null;
  @Input() hiddenPagination: ProductInventoryPagination | null = null;
  @Input() visibleLoading = false;
  @Input() hiddenLoading = false;

  @Output() editProduct = new EventEmitter<{ product: any; index: number }>();
  @Output() deleteProduct = new EventEmitter<any>();
  @Output() toggleVisibility = new EventEmitter<any>();
  @Output() productSelectionChange = new EventEmitter<ProductSelectionChangeEvent>();
  @Output() viewModeChange = new EventEmitter<ProductInventoryViewMode>();
  @Output() sectionPageChange = new EventEmitter<ProductInventoryPageChangeEvent>();

  readonly trackByProduct = (_: number, prod: any): string => this.getProductId(prod);

  getProductId(prod: any): string {
    return prod?._id || prod?.uid || prod?.id || '';
  }

  get productSections(): ProductInventorySection[] {
    const sections: ProductInventorySection[] = [
      {
        title: 'Productos visibles',
        products: this.productosVisibles,
        hidden: false,
        kind: 'visible'
      },
      {
        title: 'Productos ocultos',
        products: this.productosOcultos,
        hidden: true,
        kind: 'hidden'
      }
    ];

    return sections.filter((section) => (
      section.products.length > 0
      || this.isSectionLoading(section)
      || Boolean(this.getSectionPagination(section)?.totalItems)
    ));
  }

  get tableProducts(): any[] {
    return [...this.productosVisibles, ...this.productosOcultos];
  }

  get tableHasContent(): boolean {
    return this.tableProducts.length > 0 || this.visibleLoading || this.hiddenLoading;
  }

  getProductImage(prod: any): string {
    return Array.isArray(prod?.media) && prod.media.length > 0
      ? prod.media[0]
      : '/default-product.png';
  }

  getOwnerLabel(prod: any): string {
    const companyName = String(prod?.owner?.company_name || '').trim();
    if (companyName) {
      return companyName;
    }

    return [prod?.owner?.name, prod?.owner?.surname]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  isProductHidden(prod: any): boolean {
    return prod?.active === false;
  }

  getProductStatusLabel(prod: any): string {
    return this.isProductHidden(prod) ? 'Oculto' : 'Visible';
  }

  getProductEditIndex(prod: any): number {
    const source = this.isProductHidden(prod) ? this.productosOcultos : this.productosVisibles;
    return source.findIndex((item) => this.getProductId(item) === this.getProductId(prod));
  }

  getCardTooltip(prod: any, hidden: boolean = false): string {
    if (this.selectionEnabled) {
      return this.isProductSelected(prod)
        ? 'Deseleccionar producto'
        : 'Seleccionar producto';
    }

    return hidden ? 'Producto oculto' : 'Ver producto en el mapa';
  }

  toggleMenu(prod: any, event: Event): void {
    event.stopPropagation();

    if (this.selectionEnabled) {
      prod.menuAbierto = false;
      return;
    }

    prod.menuAbierto = !prod.menuAbierto;
  }

  isProductSelected(prod: any): boolean {
    return this.selectedProductIds.has(this.getProductId(prod));
  }

  onSelectionCheckboxClick(event: Event): void {
    event.stopPropagation();
  }

  onSelectionToggle(prod: any, selected: boolean, event: Event): void {
    event.stopPropagation();

    if (this.selectionDisabled) {
      return;
    }

    this.productSelectionChange.emit({ product: prod, selected });
  }

  onCardClick(prod: any, event: Event): void {
    if (!this.selectionEnabled || this.selectionDisabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.productSelectionChange.emit({
      product: prod,
      selected: !this.isProductSelected(prod)
    });
  }

  onTableRowClick(prod: any, event: Event): void {
    if (!this.selectionEnabled || this.selectionDisabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.productSelectionChange.emit({
      product: prod,
      selected: !this.isProductSelected(prod)
    });
  }

  onEdit(prod: any, index: number, event: Event): void {
    event.stopPropagation();
    prod.menuAbierto = false;
    this.editProduct.emit({ product: prod, index });
  }

  onDelete(prod: any, event: Event): void {
    event.stopPropagation();
    prod.menuAbierto = false;
    this.deleteProduct.emit(prod);
  }

  onToggleVisibility(prod: any, event: Event): void {
    event.stopPropagation();
    prod.menuAbierto = false;
    this.toggleVisibility.emit(prod);
  }

  requestViewModeChange(mode: ProductInventoryViewMode): void {
    if (mode === this.viewMode) {
      return;
    }

    this.viewModeChange.emit(mode);
  }

  getSectionPagination(section: ProductInventorySection): ProductInventoryPagination | null {
    return this.getPaginationForKind(section.kind);
  }

  getPaginationForKind(kind: ProductInventorySectionKind): ProductInventoryPagination | null {
    return kind === 'hidden' ? this.hiddenPagination : this.visiblePagination;
  }

  isSectionLoading(section: ProductInventorySection): boolean {
    return this.isKindLoading(section.kind);
  }

  isKindLoading(kind: ProductInventorySectionKind): boolean {
    return kind === 'hidden' ? this.hiddenLoading : this.visibleLoading;
  }

  shouldShowPagination(pagination: ProductInventoryPagination | null): pagination is ProductInventoryPagination {
    return Boolean(pagination && pagination.totalItems > pagination.pageSize && pagination.totalPages > 1);
  }

  requestSectionPageChange(section: ProductInventorySection, page: number): void {
    this.requestPageForKind(section.kind, page);
  }

  requestPageForKind(kind: ProductInventorySectionKind, page: number): void {
    const pagination = this.getPaginationForKind(kind);
    if (!pagination || pagination.disabled || page < 1 || page > pagination.totalPages || page === pagination.currentPage) {
      return;
    }

    this.sectionPageChange.emit({ section: kind, page });
  }
}
