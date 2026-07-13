import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface DireccionOpcion {
  display: string;
  lat: number;
  lon: number;
  raw?: any;
}

@Component({
  selector: 'app-direccion-selector-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="popup-overlay direccion-selector-overlay">
      <div class="popup-card direccion-selector-modal">
        <button type="button" class="popup-close editar-popup-close" (click)="cancelar.emit()" [attr.aria-label]="'Cerrar selector'">
          <span class="material-symbols-outlined">close</span>
        </button>
        <h4>Se han encontrado varias coincidencias, por favor selecciona la dirección correcta:</h4>
        <ul class="direccion-list scrollable-direcciones">
          <li *ngFor="let opcion of opciones" (click)="seleccionar(opcion)" class="direccion-opcion">
            <p>{{ opcion.display }}</p>
            <span *ngIf="opcion.raw?.city">, {{ opcion.raw.city }}</span>
            <span *ngIf="opcion.raw?.state">, {{ opcion.raw.state }}</span>
            <span *ngIf="opcion.raw?.postcode">, {{ opcion.raw.postcode }}</span>
          </li>
        </ul>
      </div>
    </div>
  `,
  styles: [`
    .popup-overlay.direccion-selector-overlay {
      position: fixed;
      inset: 0;
      z-index: 30000;
      background: rgba(8, 10, 18, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .popup-card.direccion-selector-modal {
      background: #181818;
      border-radius: 16px;
      max-width: 480px;
      width: 96vw;
      max-height: 90vh;
      padding: 32px 32px 32px 32px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
      color: #fff;
      position: relative;
      display: flex;
      flex-direction: column;
      animation: popup-appear 0.2s ease-out;
    }
    .direccion-list {
      list-style: none;
      padding: 0;
    }
    .scrollable-direcciones {
      max-height: 38vh;
      overflow-y: auto;
      overflow-x: hidden;
      border-radius: 8px;
      background: none;
      padding-right: 0.75em;
      margin-right: 0;
      margin-bottom: 0;
      scrollbar-gutter: stable;
    }
    .scrollable-direcciones::-webkit-scrollbar {
      width: 0.3125em;
      background: transparent;
    }
    .scrollable-direcciones::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.05);
      border-radius: 0.625em;
      min-height: 1.875em;
      transition: background 0.2s ease;
    }
    .scrollable-direcciones::-webkit-scrollbar-track {
      background: transparent;
    }
    .direccion-opcion {
      cursor: pointer;
      margin-bottom: 1rem;
      padding: 0.75rem 1rem;
      border-radius: 6px;
      background: #232323;
      transition: background 0.2s;
      color: #fff;
      font-size: 0.9em;
      border: 1px solid transparent;
    }
    .direccion-opcion:hover {
      background: #2e2e2e;
      border-color: #8884;
    }
    .popup-close.editar-popup-close {
      position: absolute;
      top: 14px;
      right: 18px;
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      cursor: pointer;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      border-radius: 50%;
      z-index: 1;
      opacity: 0.7;
      transition: all 0.2s ease;
    }
    .popup-close.editar-popup-close .material-symbols-outlined {
      font-size: 20px;
    }
    .popup-close.editar-popup-close:hover {
      color: #fff;
      background: rgba(0, 0, 0, 0.5);
      border-color: rgba(255, 255, 255, 0.2);
      transform: scale(1.05);
      opacity: 1;
    }
    .syncro-btn {
      margin-top: 1rem;
      align-self: flex-end;
    }
  `]
})
export class DireccionSelectorModalComponent {
  @Input() opciones: DireccionOpcion[] = [];
  @Output() seleccionarOpcion = new EventEmitter<DireccionOpcion>();
  @Output() cancelar = new EventEmitter<void>();

  seleccionar(opcion: DireccionOpcion) {
    this.seleccionarOpcion.emit(opcion);
  }
}
