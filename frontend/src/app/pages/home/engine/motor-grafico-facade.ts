import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { GRAPHICS_ENGINE } from './engine.token';
import { GraphicsEnginePort } from './ports/graphics-engine.port';

@Injectable({ providedIn: 'root' })
export class MotorGraficoFacade {
  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    @Inject(GRAPHICS_ENGINE) private engine: GraphicsEnginePort
  ) {}

  public initEngine(
    container: HTMLElement,
    locationsData: any[],
    showModalCallback?: (product: any) => void,
    hideModalCallback?: () => void,
    showOverlapCallback?: (products: any[]) => void
  ): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return Promise.reject('SSR active');
    return this.engine.init(container, locationsData, {
      showModal: showModalCallback ?? (() => {}),
      hideModal: hideModalCallback ?? (() => {}),
      showOverlapPanel: showOverlapCallback
    });
  }

  public closeModal(): void {
    this.engine.closeModal();
  }

  // Delegaciones de eventos
  public onPointerMove(x: number, y: number): void { this.engine.onPointerMove(x, y); }
  public onPointerDown(x: number, y: number): void { this.engine.onPointerDown(x, y); }
  public onPointerUp(x: number, y: number): void { this.engine.onPointerUp(x, y); }
  public onClick(): void { this.engine.onClick(); }
  public onKey(key: string, isTyping: boolean): void { this.engine.onKey(key, isTyping); }
  public toggleCinematic(): void { this.engine.toggleCinematic(); }
  public startHomeIntro(): void { this.engine.startHomeIntro?.(); }
  public setHybridAutoEnabled(enabled: boolean): void { this.engine.setHybridAutoEnabled?.(enabled); }

  public destroy(): void { this.engine.destroy(); }

  // Métodos usados por el componente Home / chatbot (compatibilidad)
  public getCameraManager() { return this.engine.getCameraManager?.(); }
  public getPinManager() { return this.engine.getPinManager?.(); }
  public getModalManager() { return this.engine.getModalManager?.(); }
  public getPlanetManager() { return this.engine.getPlanetManager?.(); }
  public setViewMode(mode: '2d' | '3d'): void { this.engine.setViewMode?.(mode); }

  public setLocations(locations: any[]): void {
    this.engine.setLocations?.(locations);
  }

  public changeEngine(engine: 'three' | 'opengl'): Promise<void> {
    const switchable = this.engine as any;
    if (typeof switchable.setEngine === 'function') {
      const result = switchable.setEngine(engine);
      return result instanceof Promise ? result : Promise.resolve();
    }
    return Promise.reject('El motor actual no soporta cambio dinámico');
  }
}
