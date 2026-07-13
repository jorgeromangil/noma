import * as THREE from 'three';

export class SceneManager {
  public scene: THREE.Scene;
  public renderer: THREE.WebGLRenderer;

  private resizeHandler: () => void;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Crear Escena
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000); 

    // 2. Crear Renderer
    // Obtenemos las medidas REALES del div contenedor
    const width = this.container.clientWidth; 
    const height = this.container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true // Útil si quieres que el fondo sea transparente
    });
    
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 3. Adjuntar al DOM
    if (container.childElementCount === 0) {
        container.appendChild(this.renderer.domElement);
    } else {
        container.innerHTML = ''; 
        container.appendChild(this.renderer.domElement);
    }

    // 4. Gestionar Resize
    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);
  }

  private onResize(): void {
    // ⭐ CAMBIO CLAVE: Ajustar al contenedor, no a la ventana
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    // Evitamos errores si el contenedor mide 0 (ej: cambio de pestaña rápido)
    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height);
    
    // NOTA: Recuerda que el CameraManager también necesita saber que el aspect ratio cambió.
    // Normalmente el Facade se encarga de avisarle.
  }

  public render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  public getScene(): THREE.Scene {
    return this.scene;
  }

  public getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  public destroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.renderer.dispose();
    
    // Limpiamos referencias del DOM
    if (this.container) {
        this.container.innerHTML = '';
    }
  }
}