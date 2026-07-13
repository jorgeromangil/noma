import { Directive, ElementRef, HostListener, Input, Renderer2, OnDestroy } from '@angular/core';

@Directive({
  selector: '[customTooltip]'
})
export class CustomTooltipDirective implements OnDestroy {
  @Input('customTooltip') tooltipText = '';
  private tooltip: HTMLElement | null = null;

  constructor(private el: ElementRef, private renderer: Renderer2) {}

  @HostListener('mouseenter') onMouseEnter() {
    if (!this.tooltipText) return;
    this.createTooltip();
  }

  @HostListener('mouseleave') onMouseLeave() {
    this.destroyTooltip();
  }

  @HostListener('click') onClick() {
    // Destruir el tooltip cuando se hace click, especialmente importante
    // para elementos con routerLink que navegan y desaparecen del DOM
    this.destroyTooltip();
  }

  ngOnDestroy() {
    // Limpiar el tooltip si el componente se destruye
    this.destroyTooltip();
  }

  private createTooltip() {
    this.tooltip = this.renderer.createElement('span');
    if (this.tooltip) {
      this.tooltip.innerText = this.tooltipText;
      this.renderer.addClass(this.tooltip, 'custom-tooltip');
      this.renderer.setStyle(this.tooltip, 'transition', 'none');
      this.renderer.setStyle(this.tooltip, 'position', 'fixed');
      this.renderer.setStyle(this.tooltip, 'z-index', '9999999');
      this.renderer.appendChild(document.body, this.tooltip);

      const rect = this.el.nativeElement.getBoundingClientRect();

      // Posicionar provisionalmente debajo para poder medir el tooltip
      this.renderer.setStyle(this.tooltip, 'left', `${rect.left}px`);
      this.renderer.setStyle(this.tooltip, 'top', `${rect.bottom + 8}px`);

      requestAnimationFrame(() => {
        if (!this.tooltip) return;

        const tipRect = this.tooltip.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;

        // Si no hay espacio suficiente debajo, mostrar encima del elemento
        if (spaceBelow < tipRect.height + 12) {
          this.renderer.setStyle(this.tooltip, 'top', `${rect.top - tipRect.height - 8}px`);
        }

        // Activar la transición y mostrar
        this.renderer.setStyle(this.tooltip, 'transition', 'opacity 0.2s, transform 0.2s');
        this.renderer.addClass(this.tooltip, 'show');
      });
    }
  }

  private destroyTooltip() {
    if (this.tooltip) {
      this.renderer.removeChild(document.body, this.tooltip);
      this.tooltip = null;
    }
  }
}
