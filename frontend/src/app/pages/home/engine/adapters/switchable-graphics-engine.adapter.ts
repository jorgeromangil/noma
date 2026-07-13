import { NgZone } from '@angular/core';
import { GraphicsEnginePort, EngineCallbacks } from '../ports/graphics-engine.port';
import { ThreeGraphicsEngineAdapter } from './three-graphics-engine.adapter';
import { OpenGLGraphicsEngineAdapter } from './opengl-graphics-engine.adapter';

type EngineType = 'three' | 'opengl';

/**
 * Adaptador que permite alternar entre Three.js y el motor WebGL propio
 * sin cambiar el resto de la app. Guarda los últimos parámetros de init()
 * para re‑inicializar el motor al vuelo.
 */
export class SwitchableGraphicsEngineAdapter implements GraphicsEnginePort {
  private current: GraphicsEnginePort;
  private currentType: EngineType = 'opengl';
  private currentToken = 0;
  private lastInit:
    | { container: HTMLElement; locations: any[]; callbacks: EngineCallbacks }
    | null = null;

  constructor(private ngZone: NgZone, private platformId: Object) {
    this.current = this.instantiate('opengl');
  }

  async init(container: HTMLElement, locations: any[], callbacks: EngineCallbacks): Promise<void> {
    this.lastInit = { container, locations, callbacks };
    return this.current.init(container, locations, callbacks);
  }

  onPointerMove(x: number, y: number): void { this.current.onPointerMove(x, y); }
  onPointerDown(x: number, y: number): void { this.current.onPointerDown(x, y); }
  onPointerUp(x: number, y: number): void { this.current.onPointerUp(x, y); }
  onClick(): void { this.current.onClick(); }
  onKey(key: string, isTyping: boolean): void { this.current.onKey(key, isTyping); }
  toggleCinematic(): void { this.current.toggleCinematic(); }
  startHomeIntro(): void { this.current.startHomeIntro?.(); }
  setHybridAutoEnabled(enabled: boolean): void { this.current.setHybridAutoEnabled?.(enabled); }
  closeModal(): void { this.current.closeModal(); }
  update(): void { this.current.update(); }
  destroy(): void { this.current.destroy(); }

  getCameraManager() { return this.current.getCameraManager?.(); }
  getPinManager() { return this.current.getPinManager?.(); }
  getModalManager() { return this.current.getModalManager?.(); }
  getPlanetManager() { return this.current.getPlanetManager?.(); }
  setViewMode(mode: '2d' | '3d'): void { this.current.setViewMode?.(mode); }

  setLocations(locations: any[]): void {
    if (this.lastInit) {
      this.lastInit = { ...this.lastInit, locations };
    }
    this.current.setLocations?.(locations);
  }

  /**
   * Cambia de motor y re‑inicializa usando los últimos datos conocidos.
   */
  async setEngine(engine: EngineType): Promise<void> {
    if (engine === this.currentType) return;

    if (!this.lastInit) {
      console.warn('Switch de motor ignorado: init() no se ha llamado todavía.');
      return;
    }

    const token = ++this.currentToken;

    // Limpia la instancia anterior
    try {
      this.current.destroy();
    } catch (err) {
      console.warn('Destroy previo falló, continuamos con el cambio de motor', err);
    }

    // Si había un canvas en el contenedor, lo vaciamos para evitar overlays
    if (this.lastInit?.container) {
      const container = this.lastInit.container;
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    }

    this.current = this.instantiate(engine);

    if (this.lastInit) {
      const { container, locations, callbacks } = this.lastInit;
      await this.current.init(container, locations, callbacks);
    }

    // Si durante el init alguien pidió otro cambio, abortamos esta activación.
    if (token !== this.currentToken) {
      this.current.destroy();
      return;
    }

    this.currentType = engine;
  }

  private instantiate(engine: EngineType): GraphicsEnginePort {
    return engine === 'three'
      ? new ThreeGraphicsEngineAdapter(this.ngZone, this.platformId)
      : new OpenGLGraphicsEngineAdapter(this.ngZone, this.platformId);
  }
}
