export interface EngineCallbacks {
  showModal(product: any): void;
  hideModal(): void;
  /** Se invoca cuando se detectan múltiples pines solapados en un click */
  showOverlapPanel?(products: any[]): void;
}

/**
 * Puerto del motor gráfico: define qué necesita la app sin acoplarse a Three u OpenGL.
 */
export interface GraphicsEnginePort {
  init(container: HTMLElement, locations: any[], callbacks: EngineCallbacks): Promise<void>;

  onPointerMove(x: number, y: number): void;
  onPointerDown(x: number, y: number): void;
  onPointerUp(x: number, y: number): void;
  onClick(): void;
  onKey(key: string, isTyping: boolean): void;
  toggleCinematic(): void;
  closeModal(): void;

  update(): void;
  destroy(): void;

  // Métodos de acceso usados por componentes externos (ej. chatbot)
  getCameraManager?(): any;
  getPinManager?(): any;
  getModalManager?(): any;
  getPlanetManager?(): any;

  /**
   * Actualiza el dataset de ubicaciones sin reinicializar el motor.
   * Implementación opcional (en este proyecto se usa en Three.js para refrescar pines).
   */
  setLocations?(locations: any[]): void;

  // Implementación opcional para cambiar de motor en tiempo de ejecución
  setEngine?(engine: 'three' | 'opengl'): Promise<void> | void;

  // Intro opcional de cámara al cargar la Home (solo aplica en Three.js)
  startHomeIntro?(): void;

  // Controla si el híbrido 3D/2D automático por zoom está activo.
  setHybridAutoEnabled?(enabled: boolean): void;

  // Cambia la vista entre 2D y 3D sin cambiar de motor.
  setViewMode?(mode: '2d' | '3d'): void;
}
