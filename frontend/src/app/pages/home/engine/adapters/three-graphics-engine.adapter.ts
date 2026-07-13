import { NgZone } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';

import { EngineCallbacks, GraphicsEnginePort } from '../ports/graphics-engine.port';
import { SceneManager } from '../core/three/scene-manager';
import { CameraManager } from '../core/three/camera-manager';
import { LightsManager } from '../core/three/lights-manager';
import { PlanetManager } from '../core/three/planet-manager';
import { PinManager } from '../core/three/pin-manager';
import { ModalManager } from '../core/three/modal-manager';

type HomeIntroState = 'idle' | 'zoom2d' | 'to3d';
type HybridMode = 'disabled' | 'near3d' | 'toFar2d' | 'far2d' | 'toNear3d';

export class ThreeGraphicsEngineAdapter implements GraphicsEnginePort {
  private mouse: THREE.Vector2 = new THREE.Vector2();
  private mouseDownStart: THREE.Vector2 = new THREE.Vector2();
  private isDragging = false;
  private pointerInputActive = false;

  private sceneManager!: SceneManager;
  private cameraManager!: CameraManager;
  private lightsManager!: LightsManager;
  private planetManager!: PlanetManager;
  private pinManager!: PinManager;
  private modalManager!: ModalManager;
  private overlapCallback: ((products: any[]) => void) | null = null;

  private animationFrameId = 0;
  private homeIntroState: HomeIntroState = 'idle';
  private hybridAutoEnabled = true;
  private hybridMode: HybridMode = 'disabled';
  private lastUserInputMs = Number.NEGATIVE_INFINITY;
  private lastWheelInputMs = Number.NEGATIVE_INFINITY;
  private lastHybridReentryAttemptMs = Number.NEGATIVE_INFINITY;
  private readonly introTiltTriggerDistance = 108;
  private readonly hybridExitToFar2dRadius = 92;
  private readonly hybridReenterNear3dRadius = 89;
  private readonly hybridInputDebounceMs = 150;
  private readonly hybridWheelRealtimeWindowMs = 220;
  private readonly hybridReentryCooldownMs = 80;

  private mouseMoveHandler = (e: MouseEvent) => this.onPointerMove(e.clientX, e.clientY);
  private mouseDownHandler = (e: MouseEvent) => this.onPointerDown(e.clientX, e.clientY);
  private mouseUpHandler = (e: MouseEvent) => this.onPointerUp(e.clientX, e.clientY);
  private windowMouseUpHandler = () => this.onGlobalPointerUp();
  private wheelHandler = () => this.onWheelInput();
  private clickHandler = (_e: MouseEvent) => this.onClick();
  private keyHandler = (e: KeyboardEvent) => this.onKey(e.key, this.isTypingTarget(e.target as HTMLElement));

  constructor(private ngZone: NgZone, private platformId: Object) {}

  async init(container: HTMLElement, locations: any[], callbacks: EngineCallbacks): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) throw new Error('SSR active');

    this.sceneManager = new SceneManager(container);
    this.cameraManager = new CameraManager(this.sceneManager.getDomElement());
    this.lightsManager = new LightsManager(this.sceneManager.getScene());
    this.planetManager = new PlanetManager(this.sceneManager.getScene());

    this.planetManager.setCamera(this.cameraManager.getCamera());
    this.planetManager.setControls(this.cameraManager.controls);

    this.pinManager = new PinManager(this.sceneManager.getScene(), locations);
    this.pinManager.setRenderer(this.sceneManager.renderer);
    this.overlapCallback = callbacks.showOverlapPanel ?? null;
    this.modalManager = new ModalManager(callbacks.showModal, callbacks.hideModal);

    const dom = this.sceneManager.getDomElement();
    dom.addEventListener('mousemove', this.mouseMoveHandler);
    dom.addEventListener('mousedown', this.mouseDownHandler);
    dom.addEventListener('mouseup', this.mouseUpHandler);
    dom.addEventListener('wheel', this.wheelHandler, { passive: true });
    dom.addEventListener('click', this.clickHandler);
    window.addEventListener('mouseup', this.windowMouseUpHandler);
    window.addEventListener('keydown', this.keyHandler);

    const planetModel = await this.planetManager.loadPlanet();
    this.pinManager.loadModels(planetModel);

    const initialDistance = this.cameraManager
      .getCamera()
      .position.distanceTo(this.cameraManager.controls.target);
    this.pinManager.setClusterDistance(initialDistance);

    this.startAnimationLoop();
  }

  onPointerMove(x: number, y: number): void {
    if (this.isHomeIntroActive()) return;
    const rect = this.sceneManager.getDomElement().getBoundingClientRect();
    this.mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((y - rect.top) / rect.height) * 2 + 1;
    if (this.pointerInputActive) this.markUserInput();
  }

  onPointerDown(x: number, y: number): void {
    if (this.isHomeIntroActive()) return;
    this.mouseDownStart.set(x, y);
    this.isDragging = false;
    this.pointerInputActive = true;
    this.markUserInput();
    if (this.cameraManager?.isFocusTransitionActive?.()) {
      this.cameraManager.cancelFocusForUserInteraction();
    }
  }

  onPointerUp(x: number, y: number): void {
    if (this.isHomeIntroActive()) return;
    const dist = Math.hypot(x - this.mouseDownStart.x, y - this.mouseDownStart.y);
    this.isDragging = dist > 7;
    this.pointerInputActive = false;
    this.markUserInput();
  }

  onKey(key: string, isTyping: boolean): void {
    if (this.isHomeIntroActive()) return;
    if (isTyping) return;
    if (this.modalManager.isVisible()) return;
    this.markUserInput();
    if (key.toLowerCase() === 'v') this.toggleCinematic();
  }

  toggleCinematic(): void {
    if (this.cameraManager.isCinematicMode) {
      this.hybridMode = 'disabled';
      this.cameraManager.resetToOrbitView();
    } else {
      const activated = this.enterCinematicAtScreenCenter();
      if (activated) {
        this.hybridMode = this.hybridAutoEnabled ? 'near3d' : 'disabled';
      }
    }
  }

  onClick(): void {
    if (this.isHomeIntroActive()) return;
    if (this.isDragging) return;
    const clickedPin = this.pinManager.handleClick(this.mouse, this.cameraManager.getCamera());
    
    if (clickedPin) {
      const worldPos = new THREE.Vector3();
      clickedPin.getWorldPosition(worldPos);

      if (clickedPin.userData?.['isCluster']) {
        // Siempre mostrar el panel de overlap para clusters—nunca expandir/deshacer la agrupación
        if (this.overlapCallback) {
          const products = this.pinManager.getClusterProducts(clickedPin);
          if (products.length > 0) {
            this.overlapCallback(products);
            return;
          }
        }
        // Fallback sin callback: zoom al centro del cluster
        this.cameraManager.zoomToPin(worldPos);
        return;
      }

      // Pin individual: abrir ficha directamente
      this.cameraManager.zoomToPin(worldPos);
      const product = clickedPin.userData['product'] ?? { title: clickedPin.userData['name'] };
      this.modalManager.show(product);
      return;
    }
    // No cerramos el modal al hacer click en el fondo/planeta.
    // El usuario cierra la ficha solo con el botón ✖ del modal.
  }

  closeModal(): void {
    if (this.modalManager && this.modalManager.isVisible()) this.modalManager.hide();
    if (this.cameraManager) this.cameraManager.releaseFocus();
    if (this.pinManager) this.pinManager.clearActivePin();
  }

  setLocations(locations: any[]): void {
    if (!this.pinManager) return;
    this.pinManager.setLocations(locations);
  }

  setHybridAutoEnabled(enabled: boolean): void {
    this.hybridAutoEnabled = enabled;
    if (!enabled) {
      this.hybridMode = 'disabled';
      this.lastWheelInputMs = Number.NEGATIVE_INFINITY;
      this.lastHybridReentryAttemptMs = Number.NEGATIVE_INFINITY;
      return;
    }
    if (this.cameraManager?.isCinematicMode) {
      this.hybridMode = 'near3d';
    }
  }

  update(): void {
    if (!this.planetManager || !this.cameraManager || !this.pinManager) return;

    // Decidimos transiciones antes del update de cámara para evitar desfase visual.
    this.runHomeIntroStep();
    this.runHybridZoomMode();

    this.planetManager.update();
    this.cameraManager.update();
    
    const camera = this.cameraManager.getCamera();
    const zoomDistance = this.cameraManager.getZoomDistanceToTarget();

    // En modo cinemático (3D) la distancia al target de órbita es casi 0,
    // por lo que usamos el radio real al centro del planeta para que los
    // umbrales de clustering coincidan con los del modo 2D.
    const clusterDistance = this.cameraManager.isCinematicMode
      ? this.cameraManager.getCameraRadiusFromCenter()
      : zoomDistance;
    
    this.pinManager.setPinsTargetVisibility(zoomDistance < this.planetManager.zoomDistanceThreshold);
    this.pinManager.setPinsTargetRotation(this.cameraManager.isCinematicMode);

    // Hacemos que el tamaño de los pines dependa solo del zoom (rueda) y no de su distancia angular
    this.pinManager.setZoomDistance(zoomDistance);
    this.pinManager.setClusterDistance(clusterDistance);
    this.pinManager.update(this.mouse, camera);
    this.sceneManager.render(camera);
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrameId);
    const dom = this.sceneManager?.getDomElement();
    if (dom) {
      dom.removeEventListener('mousemove', this.mouseMoveHandler);
      dom.removeEventListener('mousedown', this.mouseDownHandler);
      dom.removeEventListener('mouseup', this.mouseUpHandler);
      dom.removeEventListener('wheel', this.wheelHandler);
      dom.removeEventListener('click', this.clickHandler);
    }
    window.removeEventListener('mouseup', this.windowMouseUpHandler);
    window.removeEventListener('keydown', this.keyHandler);
    this.planetManager?.dispose();
    this.sceneManager?.destroy();
    this.cameraManager?.setUserControlsEnabled(true);
    this.cameraManager?.destroy();
  }

  getCameraManager() { return this.cameraManager; }
  startHomeIntro(): void {
    if (!this.cameraManager || !this.planetManager) return;
    if (this.homeIntroState !== 'idle') return;
    if (!this.planetManager.getPlanet()) return;

    this.homeIntroState = 'zoom2d';
    this.hybridAutoEnabled = true;
    this.hybridMode = 'disabled';
    this.pointerInputActive = false;
    this.lastUserInputMs = Number.NEGATIVE_INFINITY;
    this.lastWheelInputMs = Number.NEGATIVE_INFINITY;
    this.lastHybridReentryAttemptMs = Number.NEGATIVE_INFINITY;
    this.cameraManager.setUserControlsEnabled(false);
  }

  private startAnimationLoop(): void {
    this.ngZone.runOutsideAngular(() => {
      const loop = () => {
        this.update();
        this.animationFrameId = requestAnimationFrame(loop);
      };
      this.animationFrameId = requestAnimationFrame(loop);
    });
  }

  private isTypingTarget(target: HTMLElement | null): boolean {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  private onGlobalPointerUp(): void {
    if (!this.pointerInputActive) return;
    this.pointerInputActive = false;
    this.markUserInput();
  }

  private onWheelInput(): void {
    if (this.isHomeIntroActive()) return;
    if (this.cameraManager?.isFocusTransitionActive?.() && !this.cameraManager?.isCinematicMode) return;
    const now = this.nowMs();
    this.lastWheelInputMs = now;
    this.markUserInput(now);
  }

  private markUserInput(atMs?: number): void {
    this.lastUserInputMs = atMs ?? this.nowMs();
  }

  private isHybridSwitchingAllowedNow(): boolean {
    if (this.pointerInputActive) return false;
    const now = this.nowMs();
    if (now - this.lastWheelInputMs <= this.hybridWheelRealtimeWindowMs) return true;
    return now - this.lastUserInputMs >= this.hybridInputDebounceMs;
  }

  private enterCinematicAtScreenCenter(options?: {
    targetRadius?: number;
    minSurfaceDistance?: number;
    focusSmoothingOverride?: number;
    controlsBlendInSpeedOverride?: number;
  }): boolean {
    const planet = this.planetManager.getPlanet();
    if (!planet) return false;
    const camera = this.cameraManager.getCamera();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    let intersects = raycaster.intersectObject(planet, true);

    if (intersects.length === 0) {
      const fallbackTarget = this.cameraManager.controls?.target;
      if (fallbackTarget instanceof THREE.Vector3) {
        const fallbackDir = fallbackTarget.clone().sub(camera.position);
        if (fallbackDir.lengthSq() > 1e-8) {
          raycaster.set(camera.position.clone(), fallbackDir.normalize());
          intersects = raycaster.intersectObject(planet, true);
        }
      }
    }

    if (intersects.length === 0) return false;
    this.cameraManager.activateTiltView(intersects[0].point.clone(), options);
    return true;
  }

  private runHomeIntroStep(): void {
    if (this.homeIntroState === 'idle') return;

    if (this.homeIntroState === 'zoom2d') {
      const zoomDistance = this.cameraManager.getZoomDistanceToTarget();
      const shouldStartTilt =
        !this.cameraManager.isAutoZoomActive() || zoomDistance <= this.introTiltTriggerDistance;
      if (!shouldStartTilt) return;

      const activated = this.enterCinematicAtScreenCenter({
        focusSmoothingOverride: 0.052,
        controlsBlendInSpeedOverride: 0.03
      });
      if (!activated) {
        this.finishHomeIntro();
        return;
      }
      this.homeIntroState = 'to3d';
      return;
    }

    if (this.homeIntroState === 'to3d' && !this.cameraManager.isFocusTransitionActive()) {
      this.hybridMode = this.hybridAutoEnabled ? 'near3d' : 'disabled';
      this.finishHomeIntro();
    }
  }

  private runHybridZoomMode(): void {
    if (this.homeIntroState !== 'idle') return;

    if (!this.hybridAutoEnabled) {
      this.hybridMode = 'disabled';
      return;
    }

    if (this.hybridMode === 'disabled') {
      if (this.cameraManager.isCinematicMode && !this.cameraManager.isFocusTransitionActive()) {
        this.hybridMode = 'near3d';
      }
      return;
    }

    if (this.hybridMode === 'toFar2d') {
      if (this.cameraManager.isFocusTransitionActive()) return;
      this.hybridMode = this.cameraManager.isCinematicMode ? 'near3d' : 'far2d';
      return;
    }

    if (this.hybridMode === 'toNear3d') {
      if (this.cameraManager.isFocusTransitionActive()) return;
      this.hybridMode = this.cameraManager.isCinematicMode ? 'near3d' : 'far2d';
      return;
    }

    if (!this.isHybridSwitchingAllowedNow()) return;

    const cameraRadius = this.cameraManager.getCameraRadiusFromCenter();

    if (this.hybridMode === 'near3d') {
      if (!this.cameraManager.isCinematicMode) {
        this.hybridMode = 'disabled';
        return;
      }
      if (this.cameraManager.isFocusTransitionActive()) return;
      if (cameraRadius < this.hybridExitToFar2dRadius) return;

      this.cameraManager.transitionToTopDownMapForHybrid();
      this.hybridMode = 'toFar2d';
      return;
    }

    // far2d
    if (this.cameraManager.isCinematicMode || this.cameraManager.isFocusTransitionActive()) return;
    if (cameraRadius > this.hybridReenterNear3dRadius) return;

    const now = this.nowMs();
    if (now - this.lastHybridReentryAttemptMs < this.hybridReentryCooldownMs) return;
    this.lastHybridReentryAttemptMs = now;

    const activated = this.enterCinematicAtScreenCenter();
    if (activated) this.hybridMode = 'toNear3d';
  }

  private finishHomeIntro(): void {
    this.homeIntroState = 'idle';
    this.cameraManager.setUserControlsEnabled(true);
  }

  private isHomeIntroActive(): boolean {
    return this.homeIntroState !== 'idle';
  }

  private nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }
  getPinManager() { return this.pinManager; }
  getModalManager() { return this.modalManager; }
  getPlanetManager() { return this.planetManager; }
}
