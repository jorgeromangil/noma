export interface OpenGLControlsCallbacks {
  onInteractionStart(): void;
  onWheel(deltaY: number, clientX: number, clientY: number): void;
  onPointerHover?(x: number, y: number): void;
  onPointerDrag?(deltaX: number, deltaY: number): void;
}

export class OpenGLControlsManager {
  private dom: HTMLCanvasElement | null = null;
  private enabled = true;

  private isPointerDown = false;
  private isDragging = false;
  private hadDragging = false;
  private pointerDownStart = { x: 0, y: 0 };
  private lastPointer = { x: 0, y: 0 };
  private readonly dragThresholdSq = 4;

  private pointerMoveHandler = (e: PointerEvent) => this.onPointerMove(e.clientX, e.clientY);

  private pointerDownHandler = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.dom?.setPointerCapture?.(e.pointerId);
    this.onPointerDown(e.clientX, e.clientY);
  };

  private pointerUpHandler = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.dom?.releasePointerCapture?.(e.pointerId);
    this.onPointerUp(e.clientX, e.clientY);
  };

  private wheelHandler = (e: WheelEvent) => {
    // El canvas del mapa nunca debe ceder la rueda al documento:
    // si los controles están temporalmente bloqueados, evitamos que
    // el navegador haga scroll de la página o active reflows externos.
    e.preventDefault();
    e.stopPropagation();
    if (!this.enabled) return;
    this.callbacks.onWheel(e.deltaY, e.clientX, e.clientY);
  };

  constructor(private readonly callbacks: OpenGLControlsCallbacks) {}

  attach(dom: HTMLCanvasElement): void {
    this.dom = dom;
    dom.addEventListener('pointerdown', this.pointerDownHandler);
    dom.addEventListener('pointermove', this.pointerMoveHandler);
    dom.addEventListener('pointerup', this.pointerUpHandler);
    dom.addEventListener('pointerleave', this.pointerUpHandler);
    dom.addEventListener('wheel', this.wheelHandler, { passive: false });
  }

  detach(): void {
    if (!this.dom) return;
    this.dom.removeEventListener('pointerdown', this.pointerDownHandler);
    this.dom.removeEventListener('pointermove', this.pointerMoveHandler);
    this.dom.removeEventListener('pointerup', this.pointerUpHandler);
    this.dom.removeEventListener('pointerleave', this.pointerUpHandler);
    this.dom.removeEventListener('wheel', this.wheelHandler);
    this.dom = null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) return;

    this.isPointerDown = false;
    this.isDragging = false;
    this.hadDragging = false;
    this.lastPointer = { x: 0, y: 0 };
  }

  onPointerMove(x: number, y: number): void {
    if (!this.enabled) return;
    this.callbacks.onPointerHover?.(x, y);
    if (!this.isPointerDown) return;

    if (!this.isDragging) {
      const distSq = (x - this.pointerDownStart.x) ** 2 + (y - this.pointerDownStart.y) ** 2;
      this.isDragging = distSq > this.dragThresholdSq;
    }

    const deltaX = x - this.lastPointer.x;
    const deltaY = y - this.lastPointer.y;

    if (this.isDragging) {
      this.callbacks.onPointerDrag?.(deltaX, deltaY);
    }
    this.lastPointer = { x, y };
  }

  onPointerDown(x: number, y: number): void {
    if (!this.enabled) return;
    this.isPointerDown = true;
    this.isDragging = false;
    this.pointerDownStart = { x, y };
    this.lastPointer = { x, y };
    this.callbacks.onInteractionStart();
  }

  onPointerUp(_x: number, _y: number): void {
    if (!this.enabled) return;
    this.isPointerDown = false;
    this.hadDragging = this.isDragging;
    this.isDragging = false;
    this.lastPointer = { x: 0, y: 0 };
  }

  shouldIgnoreClick(): boolean {
    if (!this.hadDragging) return false;
    this.hadDragging = false;
    return true;
  }

}
