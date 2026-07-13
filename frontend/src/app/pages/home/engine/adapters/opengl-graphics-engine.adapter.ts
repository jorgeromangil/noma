import { NgZone } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { EngineCallbacks, GraphicsEnginePort } from '../ports/graphics-engine.port';
import { Camera } from '../core/opengl/camera/camera';
import { OpenGLCameraManager } from '../core/opengl/camera/opengl-camera-manager';
import { OpenGLControlsManager } from '../core/opengl/camera/opengl-controls-manager';
import { OpenGLRotationManager } from '../core/opengl/camera/opengl-rotation-manager';
import { createColoredSphere } from '../core/opengl/geometry/geometry';
import { loadGlbGeometryMerged, LoadGlbGeometryOptions } from '../core/opengl/geometry/gltf-loader';
import { computeRadiusAndCenter } from '../core/opengl/geometry/opengl-geometry-utils';
import { transformPointMat4, Vec3 } from '../core/opengl/math/opengl-math';
import { OpenGLAdministrativeLayersManager } from '../core/opengl/overlays/opengl-administrative-layers-manager';
import { OpenGLCityLabelManager } from '../core/opengl/overlays/opengl-city-label-manager';
import { OpenGLPinManager } from '../core/opengl/overlays/opengl-pin-manager';
import { GlRenderer } from '../core/opengl/rendering/gl-renderer';
import { TGestorRecursos, TRecursoMalla, TSharedPtr } from '../core/opengl/resources/resource-manager';
import { TCamara, TLuz, TMalla, TMarker } from '../core/opengl/scene/scene-entities';
import { identityMat4 as sceneIdentityMat4 } from '../core/opengl/scene/scene-math';
import { TNodo } from '../core/opengl/scene/scene-node';
import { ModalManager } from '../core/three/modal-manager';

type HomeIntroState = 'idle' | 'zoom2d' | 'to3d';

export class OpenGLGraphicsEngineAdapter implements GraphicsEnginePort {
  private static readonly TILT_RAD = 0.3490659; // debe coincidir con la cámara para 3D (~20°)
  private static readonly INTRO_TILT_TRIGGER_ZOOM_RATIO = 1.14;
  private static readonly INTRO_TILT_TRIGGER_ANGLE = 0.16;
  private static readonly INTRO_TO_3D_DURATION_MS = 1050;
  private static readonly HYBRID_EXIT_TO_2D_RADIUS_RATIO = 1.12;
  private readonly resourceManager = TGestorRecursos.getInstancia();
  private glRenderer!: GlRenderer;
  private animationFrameId = 0;
  private lastFrameTime = 0;

  private camera!: Camera;
  private cameraManager!: OpenGLCameraManager;
  private rotationManager!: OpenGLRotationManager;
  private controlsManager!: OpenGLControlsManager;
  private modalManager!: ModalManager;

  private readonly pinManager = new OpenGLPinManager();
  private readonly layersManager = new OpenGLAdministrativeLayersManager();
  private cityLabelManager: OpenGLCityLabelManager | null = null;
  private viewMode: '2d' | '3d' = '2d';

  private ready = false;
  private dom!: HTMLCanvasElement;
  private container!: HTMLElement;
  private pointerCursorActive = false;
  private lastPointerNdc: { x: number; y: number } | null = null;
  private readonly target: Vec3 = [0, 0, 0];
  private overlapCallback: ((products: any[]) => void) | null = null;
  private homeIntroState: HomeIntroState = 'idle';
  private autoStartIntroPending = true;
  private hybridAutoEnabled = true;
  private pendingViewMode: '2d' | '3d' | null = null;
  private controlsLockedForViewTransition = false;
  // Clave estable para evitar depender del índice interno, que cambia al reconstruir clusters.
  private selectedPinSelectionKey: string | null = null;
  private selectionOpenedAtMs = Number.NEGATIVE_INFINITY;
  private readonly selectionReclickCloseDebounceMs = 450;

  // --- Cluster count badges (DOM overlay) ---
  private clusterBadgeOverlay: HTMLDivElement | null = null;
  private clusterBadgePool: HTMLDivElement[] = [];

  private readonly sceneIdentity = sceneIdentityMat4();
  private sceneRoot = new TNodo();
  private cameraNode = new TNodo();
  private lightNode = new TNodo();
  private mapPivotNode = new TNodo();
  private mapBaseNode = new TNodo();
  private planetaLayerNode = new TNodo();
  private comunidadesLayerNode = new TNodo();
  private provinciasLayerNode = new TNodo();
  private pinLayerNode = new TNodo();

  private readonly layerIds = {
    comunidades: 'comunidades',
    provincias: 'provincias',
  } as const;

  private baseMeshResourcePtr: TSharedPtr<TRecursoMalla> | null = null;
  private comunidadesMeshResourcePtr: TSharedPtr<TRecursoMalla> | null = null;
  private provinciasMeshResourcePtr: TSharedPtr<TRecursoMalla> | null = null;
  private clickHandler = (event: MouseEvent) => {
    this.updatePointerNdcFromClient(event.clientX, event.clientY);
    this.onClick();
  };
  private pointerLeaveHandler = () => {
    this.pinManager.clearPointer();
    this.setCanvasPointerCursor(false);
    this.lastPointerNdc = null;
  };

  constructor(private ngZone: NgZone, private platformId: Object) {}

  async init(container: HTMLElement, locations: any[], callbacks: EngineCallbacks): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) throw new Error('SSR activo');

    this.pinManager.setLocations(locations);
    this.modalManager = new ModalManager(callbacks.showModal, callbacks.hideModal);
    this.overlapCallback = callbacks.showOverlapPanel ?? null;

    this.glRenderer = await GlRenderer.create(container);
    this.dom = this.glRenderer.getDomElement();
    this.container = container;
    this.cityLabelManager = new OpenGLCityLabelManager(container);

    // Registrar DOM en pin manager para proyecciones 3D → 2D
    this.pinManager.setDom(this.dom);

    // Badge overlay for cluster count circles
    this.clusterBadgeOverlay = document.createElement('div');
    this.clusterBadgeOverlay.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:4;';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(this.clusterBadgeOverlay);

    this.camera = new Camera();
    this.cameraManager = new OpenGLCameraManager(this.camera, this.target);
    const { width, height } = container.getBoundingClientRect();
    this.cameraManager.initializePerspective(width, height);
    this.glRenderer.setCamera(
      this.camera.getViewMatrix(),
      this.camera.getProjectionMatrix(),
      this.camera.getPosition()
    );

    this.setupSceneTree();

    this.rotationManager = new OpenGLRotationManager((matrix) => {
      this.mapPivotNode.setMatrizBasePersonalizada(matrix);
    });

    this.controlsManager = new OpenGLControlsManager({
      onInteractionStart: () => {
        this.rotationManager.cancelIntroAnimation();
        this.cameraManager.cancelIntroCamera();
        this.cameraManager.cancelFocus();
        this.rotationManager.syncTargetToCurrent();
      },
      onPointerDrag: (dx, dy) => this.rotationManager.applyPointerDrag(dx, dy),
      onWheel: (deltaY, clientX, clientY) => this.onWheel(deltaY, clientX, clientY),
      onPointerHover: (x, y) => this.updatePointerNdcFromClient(x, y),
    });
    this.controlsManager.attach(this.dom);
    this.dom.addEventListener('click', this.clickHandler);
    this.dom.addEventListener('pointerleave', this.pointerLeaveHandler);

    this.loadPlanet();
    this.startAnimationLoop();
    window.addEventListener('resize', this.onResize);
  }

  onPointerMove(x: number, y: number): void {
    if (this.isHomeIntroActive()) return;
    this.updatePointerNdcFromClient(x, y);
    this.controlsManager?.onPointerMove(x, y);
  }

  onPointerDown(x: number, y: number): void {
    if (this.isHomeIntroActive()) return;
    this.updatePointerNdcFromClient(x, y);
    this.controlsManager?.onPointerDown(x, y);
  }

  onPointerUp(x: number, y: number): void {
    if (this.isHomeIntroActive()) return;
    this.updatePointerNdcFromClient(x, y);
    this.controlsManager?.onPointerUp(x, y);
  }

  onClick(): void {
    if (this.isHomeIntroActive()) return;
    if (this.controlsManager?.shouldIgnoreClick()) return;

    const selectedPin = this.pinManager.activatePinAtPointer({
      overlayOpacity: this.layersManager.getOverlayOpacity(),
      cameraPosition: this.camera.getPosition(),
      viewMatrix: this.camera.getViewMatrix(),
      projectionMatrix: this.camera.getProjectionMatrix(),
    }) ?? this.pinManager.activateHoveredPin();
    if (!selectedPin) return;

    const clickedSelectionKey = this.getPinSelectionKey(selectedPin);
    if (clickedSelectionKey && this.selectedPinSelectionKey === clickedSelectionKey) {
      if (this.isWithinSelectionOpenDebounce()) return;

      if (selectedPin.isCluster) {
        this.closeClusterSelection();
        return;
      }
      // Pin individual: no cerramos la ficha por re-click sobre el mismo pin.
      // Safari puede reemitir clicks tras abrir el modal y cerrar la ficha accidentalmente.
      return;
    }

    // Cluster: mostrar panel de solapamiento (igual que Three.js)
    if (selectedPin.isCluster) {
      const activePin = this.pinManager.getActivePin();
      const worldPos = activePin?.getWorldPosition?.();
      const zoomTarget = this.asVec3(worldPos);
      if (zoomTarget) this.cameraManager.zoomToPin(zoomTarget);
      this.selectedPinSelectionKey = clickedSelectionKey;
      this.selectionOpenedAtMs = this.nowMs();

      const products = selectedPin.clusterProducts ?? [];
      if (products.length > 0 && this.overlapCallback) {
        this.overlapCallback(products);
        return;
      }

      // Si no hay callback, mantenemos el foco de cámara en el cluster
      // y permitimos re-click para deseleccionar con deszoom.
      return;
    }

    // Pin individual
    const activePin = this.pinManager.getActivePin();
    const worldPos = activePin?.getWorldPosition?.();
    const zoomTarget = this.asVec3(worldPos);
    if (zoomTarget) {
      this.cameraManager.zoomToPin(zoomTarget);
    }

    const product = selectedPin.product ?? { title: selectedPin.name ?? 'Producto' };
    this.selectedPinSelectionKey = clickedSelectionKey;
    this.selectionOpenedAtMs = this.nowMs();
    this.modalManager?.show(product);
  }

  onKey(_key: string, _isTyping: boolean): void {}
  toggleCinematic(): void {
    const currentMode = this.pendingViewMode ?? this.viewMode;
    this.setViewMode(currentMode === '3d' ? '2d' : '3d');
  }
  startHomeIntro(): void {
    if (!this.cameraManager || !this.rotationManager || !this.controlsManager) return;
    if (this.homeIntroState !== 'idle') return;

    this.homeIntroState = 'zoom2d';
    this.autoStartIntroPending = false;
    this.hybridAutoEnabled = true;
    this.controlsManager.setEnabled(false);
  }
  setHybridAutoEnabled(enabled: boolean): void {
    this.hybridAutoEnabled = enabled;
  }
  closeModal(): void {
    if (this.modalManager?.isVisible()) this.modalManager.hide();
    this.overlapCallback?.([]);
    this.cameraManager?.startDefocusZoom?.();
    this.pinManager.clearActivePin();
    this.selectedPinSelectionKey = null;
    this.selectionOpenedAtMs = Number.NEGATIVE_INFINITY;
  }

  private closeClusterSelection(): void {
    this.overlapCallback?.([]);
    this.cameraManager?.startDefocusZoom?.();
    this.pinManager.clearActivePin();
    this.selectedPinSelectionKey = null;
    this.selectionOpenedAtMs = Number.NEGATIVE_INFINITY;
  }

  setViewMode(mode: '2d' | '3d'): void {
    if (!this.cameraManager || !this.rotationManager) return;
    if (mode === '3d') {
      this.start3DViewTransition();
    } else {
      this.start2DViewTransition();
    }
  }

  update(dt?: number): void {
    const delta = dt ?? 0;
    if (!this.ready) return;

    this.rotationManager.runIntroAnimation();
    this.cameraManager.runIntroCamera();
    this.runHomeIntroStep();
    this.runHybridZoomMode();
    this.cameraManager.runIntro3DEntry(delta);
    this.cameraManager.runViewModeTransition(delta);
    this.rotationManager.runTiltTransition(delta);
    this.cameraManager.runFocusZoom();
    this.cameraManager.runDefocusZoom();
    this.rotationManager.relaxDragRotation(delta);
    this.syncViewModeState();

    const zoomDistance = this.cameraManager.getZoomDistanceMetric();
  this.pinManager.setZoomDistance(zoomDistance);
    this.pinManager.setClusterDistance(zoomDistance);
    this.layersManager.update(zoomDistance, this.glRenderer, this.layerIds);
    const overlayOpacity = this.layersManager.getOverlayOpacity();
    const provinciasOpacity = this.layersManager.getProvinciasOpacity();
    this.pinManager.setProvinciasOpacity(provinciasOpacity);

    const interaction = this.pinManager.updateInteraction({
      dt: delta,
      overlayOpacity,
      cameraPosition: this.camera.getPosition(),
      viewMatrix: this.camera.getViewMatrix(),
      projectionMatrix: this.camera.getProjectionMatrix(),
    });
    if (interaction.needsOverlayRefresh) {
      this.refreshPinOverlays();
    }
    this.setCanvasPointerCursor(interaction.isHovering);

    this.sceneRoot.actualizar(delta);
    if (!this.glRenderer.beginFrame()) return;
    this.sceneRoot.recorrer(this.sceneIdentity);
    this.cityLabelManager?.update({
      zoomDistance,
      viewMatrix: this.camera.getViewMatrix(),
      projectionMatrix: this.camera.getProjectionMatrix(),
    });
    this.updateClusterBadges(overlayOpacity, zoomDistance);
    this.glRenderer.endFrame();
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.onResize);
    this.dom?.removeEventListener('click', this.clickHandler);
    this.dom?.removeEventListener('pointerleave', this.pointerLeaveHandler);
    this.controlsManager?.detach();
    this.setCanvasPointerCursor(false);
    this.releasePlanetMeshResources();
    this.pinManager.dispose();
    this.cityLabelManager?.dispose();
    this.cityLabelManager = null;
    this.clusterBadgeOverlay?.remove();
    this.clusterBadgeOverlay = null;
    this.clusterBadgePool = [];
    this.sceneRoot?.destruir();
    this.glRenderer?.destroy();
  }

  setLocations(locations: any[]): void {
    this.pinManager.setLocations(locations);
    this.refreshPinOverlays();
    // Enlazar callback para refrescar overlays cuando se cargue una geometría
    (this.pinManager as any).onGeometryLoaded = () => {
      this.refreshPinOverlays();
    };
  }

  getCameraManager() {
    return this.cameraManager;
  }

  getPinManager() {
    return this.pinManager;
  }

  getModalManager() {
    return this.modalManager;
  }

  private runHomeIntroStep(): void {
    if (this.homeIntroState === 'idle' || !this.cameraManager || !this.rotationManager) return;

    if (this.homeIntroState === 'zoom2d') {
      const zoomDistance = this.cameraManager.getDistanceToTarget();
      const introTargetRadius = this.cameraManager.getIntroTargetRadius();
      const introRemainingAngle = this.rotationManager.getIntroRemainingAngle();
      const shouldStartTilt =
        zoomDistance <= introTargetRadius * OpenGLGraphicsEngineAdapter.INTRO_TILT_TRIGGER_ZOOM_RATIO &&
        introRemainingAngle <= OpenGLGraphicsEngineAdapter.INTRO_TILT_TRIGGER_ANGLE;
      if (!shouldStartTilt) return;

      this.cameraManager.startIntro3DEntry({
        durationMs: OpenGLGraphicsEngineAdapter.INTRO_TO_3D_DURATION_MS
      });
      this.rotationManager.startTiltTransition(
        -OpenGLGraphicsEngineAdapter.TILT_RAD,
        0,
        OpenGLGraphicsEngineAdapter.INTRO_TO_3D_DURATION_MS / 1000
      );
      this.pinManager.setViewMode('3d');
      this.viewMode = '3d';
      this.homeIntroState = 'to3d';
      return;
    }

    if (
      this.homeIntroState === 'to3d' &&
      !this.cameraManager.isIntroCameraActive() &&
      !this.cameraManager.isIntro3DEntryActive() &&
      !this.rotationManager.isTiltTransitionActive()
    ) {
      this.finishHomeIntro();
    }
  }

  private finishHomeIntro(): void {
    this.homeIntroState = 'idle';
    this.controlsManager?.setEnabled(true);
  }

  private isHomeIntroActive(): boolean {
    return this.homeIntroState !== 'idle';
  }

  private onWheel(deltaY: number, clientX: number, clientY: number): void {
    // Evitar que la cámara se mueva cuando el modal está abierto
    if (this.modalManager?.isVisible?.()) return;
    this.updatePointerNdcFromClient(clientX, clientY);
    if (this.controlsLockedForViewTransition) return;
    this.cameraManager.onWheel(deltaY, this.lastPointerNdc ?? undefined);
  }

  private runHybridZoomMode(): void {
    if (!this.hybridAutoEnabled) return;
    if (this.homeIntroState !== 'idle') return;
    if (!this.cameraManager || !this.rotationManager) return;
    if (this.pendingViewMode) return;
    if (this.cameraManager.isFocusZoomActive()) return;
    if (this.cameraManager.isIntro3DEntryActive()) return;
    if (this.cameraManager.isViewModeTransitionActive()) return;
    if (this.rotationManager.isTiltTransitionActive()) return;

    const currentMode = this.cameraManager.getViewMode();
    const zoomDistance = this.cameraManager.getZoomDistanceMetric();
    const introTargetRadius = this.cameraManager.getIntroTargetRadius();
    const layerThresholds = this.layersManager.getThresholds();

    if (currentMode === '2d') {
      const enterRadius = layerThresholds.comunidades;
      if (zoomDistance > enterRadius) return;

      this.start3DViewTransition();
      return;
    }

    if (currentMode !== '3d') return;

    const exitRadius =
      introTargetRadius * OpenGLGraphicsEngineAdapter.HYBRID_EXIT_TO_2D_RADIUS_RATIO;
    if (zoomDistance < exitRadius) return;

    this.start2DViewTransition();
  }

  private start3DViewTransition(): void {
    if (!this.cameraManager || !this.rotationManager) return;
    const currentMode = this.pendingViewMode ?? this.cameraManager.getViewMode();
    const transitionActive =
      this.cameraManager.isViewModeTransitionActive() || this.rotationManager.isTiltTransitionActive();
    if (currentMode === '3d' && !transitionActive) return;

    this.cameraManager.startViewModeTransition('3d');
    this.rotationManager.startTiltTransition(-OpenGLGraphicsEngineAdapter.TILT_RAD, 0);
    this.pendingViewMode = '3d';
    this.setViewTransitionControlsLocked(true);
    this.pinManager.setViewMode('3d');
    this.refreshPinOverlays();
  }

  private start2DViewTransition(): void {
    if (!this.cameraManager || !this.rotationManager) return;
    const currentMode = this.pendingViewMode ?? this.cameraManager.getViewMode();
    const transitionActive =
      this.cameraManager.isViewModeTransitionActive() || this.rotationManager.isTiltTransitionActive();
    if (currentMode === '2d' && !transitionActive) return;

    this.cameraManager.startViewModeTransition('2d');
    this.rotationManager.startTiltTransition(0, 0);
    this.pendingViewMode = '2d';
    this.setViewTransitionControlsLocked(true);
    this.pinManager.setViewMode('2d');
    this.refreshPinOverlays();
  }

  private syncViewModeState(): void {
    if (!this.cameraManager || !this.rotationManager) return;

    const transitionActive =
      this.cameraManager.isViewModeTransitionActive() || this.rotationManager.isTiltTransitionActive();
    if (transitionActive) return;

    this.viewMode = this.cameraManager.getViewMode();
    if (this.pendingViewMode === this.viewMode) {
      this.pendingViewMode = null;
    }
    if (!this.pendingViewMode) {
      this.setViewTransitionControlsLocked(false);
    }
  }

  private setViewTransitionControlsLocked(locked: boolean): void {
    if (this.controlsLockedForViewTransition === locked) return;
    this.controlsLockedForViewTransition = locked;
    if (!locked) {
      if (!this.isHomeIntroActive()) this.controlsManager?.setEnabled(true);
      return;
    }
    this.controlsManager?.setEnabled(false);
  }

  private startAnimationLoop(): void {
    this.ngZone.runOutsideAngular(() => {
      const loop = (time: number) => {
        const dt = this.lastFrameTime ? (time - this.lastFrameTime) / 1000 : 1 / 60;
        this.lastFrameTime = time;
        this.update(dt);
        this.animationFrameId = requestAnimationFrame(loop);
      };
      this.animationFrameId = requestAnimationFrame(loop);
    });
  }

  private setupSceneTree(): void { //Se configura el arbol de escena con nodos para la camara, luces, planeta y capas administrativas.
    const cameraEntity = new TCamara(() => {
      this.glRenderer.setCamera(
        this.camera.getViewMatrix(),
        this.camera.getProjectionMatrix(),
        this.camera.getPosition()
      );
    });

    const lightsEntity = new TLuz((modelMatrix) => {
      // Aproximación al rig de Three.js:
      // AmbientLight(white, 0.5) + Directional(white, 1.2) + Fill(0x88ccff, 0.6) + Point(0xffddaa, 0.6)
      this.glRenderer.setLightDirection([-0.577, -0.577, -0.577]);
      this.glRenderer.setLightColor([1.20, 1.20, 1.20]);
      this.glRenderer.setAmbient([0.032, 0.032, 0.032]);
      this.glRenderer.setHemiAmbient([0.0, 0.0, 0.0], [0.0, 0.0, 0.0], 0.0);
      this.glRenderer.setRimLight([0.72, 0.84, 1.0], 0.0, 2.8);
      this.glRenderer.setFillLight([0.742, -0.371, 0.557], [0.32, 0.48, 0.60]);
      const pointWorld = transformPointMat4(modelMatrix, [3.0, 3.0, 2.0]);
      this.glRenderer.setPointLight(pointWorld, [0.60, 0.52, 0.40], 0.14, 0.07);
      this.glRenderer.setSpecular(0.06, 16.0);
      this.glRenderer.setSceneExposure(0.95);
    });

    const planetaEntity = new TMalla((modelMatrix) => {
      this.pinManager.setPinLayerModelMatrix(modelMatrix);
      this.glRenderer.setPinHighlightState(this.pinManager.getHighlightState());
      this.glRenderer.drawBaseLayer(modelMatrix);
    });

    const comunidadesEntity = new TMalla((modelMatrix) => {
      this.glRenderer.drawMapLayer(modelMatrix, this.layerIds.comunidades);
    });

    const provinciasEntity = new TMalla((modelMatrix) => {
      this.glRenderer.drawMapLayer(modelMatrix, this.layerIds.provincias);
    });

    const pinEntity = new TMarker((modelMatrix) => {
      this.pinManager.setPinLayerModelMatrix(modelMatrix);
      this.cityLabelManager?.setPlanetModelMatrix(modelMatrix);
      this.glRenderer.setPinHighlightState(this.pinManager.getHighlightState());
      this.glRenderer.drawOverlayLayer(modelMatrix, this.layersManager.getOverlayOpacity());
    });

    this.sceneRoot = new TNodo();
    this.cameraNode = new TNodo(cameraEntity);
    this.lightNode = new TNodo(lightsEntity);
    this.mapPivotNode = new TNodo(); //Rotacion y orientacion del mapa.
    this.mapBaseNode = new TNodo(); //Traslacion y escalado del mapa.
    this.planetaLayerNode = new TNodo(planetaEntity);
    this.comunidadesLayerNode = new TNodo(comunidadesEntity);
    this.provinciasLayerNode = new TNodo(provinciasEntity);
    this.pinLayerNode = new TNodo(pinEntity);

    this.sceneRoot.agregarHijo(this.cameraNode);
    this.sceneRoot.agregarHijo(this.lightNode);
    this.sceneRoot.agregarHijo(this.mapPivotNode);
    this.mapPivotNode.agregarHijo(this.mapBaseNode);
    this.mapBaseNode.agregarHijo(this.planetaLayerNode);
    this.planetaLayerNode.agregarHijo(this.comunidadesLayerNode);
    this.planetaLayerNode.agregarHijo(this.pinLayerNode);
    this.comunidadesLayerNode.agregarHijo(this.provinciasLayerNode);
  }

  private async loadPlanet(): Promise<void> {
    let baseMeshPtr: TSharedPtr<TRecursoMalla> | null = null;
    let comunidadesMeshPtr: TSharedPtr<TRecursoMalla> | null = null;
    let provinciasMeshPtr: TSharedPtr<TRecursoMalla> | null = null;

    const file = 'assets/models/planeta_noma_definitivo.glb';
    const baseOptions: LoadGlbGeometryOptions = {
      excludeNodeNames: ['Comunidades_autonomas', 'Provincias'],
    };
    const comunidadesOptions: LoadGlbGeometryOptions = { includeNodeNames: ['Comunidades_autonomas'] };
    const provinciasOptions: LoadGlbGeometryOptions = { includeNodeNames: ['Provincias'] };

    try {
      [baseMeshPtr, comunidadesMeshPtr, provinciasMeshPtr] = await Promise.all([
        this.resourceManager.cargarMalla(this.buildGlbResourceKey(file, baseOptions), () =>
          loadGlbGeometryMerged(file, baseOptions)
        ),
        this.resourceManager.cargarMalla(this.buildGlbResourceKey(file, comunidadesOptions), () =>
          loadGlbGeometryMerged(file, comunidadesOptions)
        ),
        this.resourceManager.cargarMalla(this.buildGlbResourceKey(file, provinciasOptions), () =>
          loadGlbGeometryMerged(file, provinciasOptions)
        ),
      ]);
      if (!baseMeshPtr || !comunidadesMeshPtr || !provinciasMeshPtr) throw new Error('No se pudo cargar alguna malla');
      const baseGeometry = baseMeshPtr.get().obtenerMalla();
      const comunidadesGeometry = comunidadesMeshPtr.get().obtenerMalla();
      const provinciasGeometry = provinciasMeshPtr.get().obtenerMalla();

      this.releasePlanetMeshResources();
      this.baseMeshResourcePtr = baseMeshPtr;
      this.comunidadesMeshResourcePtr = comunidadesMeshPtr;
      this.provinciasMeshResourcePtr = provinciasMeshPtr;
      baseMeshPtr = null;
      comunidadesMeshPtr = null;
      provinciasMeshPtr = null;

      this.ready = false;
      this.glRenderer.setGeometry(baseGeometry);
      this.glRenderer.setMapLayerGeometry(this.layerIds.comunidades, comunidadesGeometry);
      this.glRenderer.setMapLayerGeometry(this.layerIds.provincias, provinciasGeometry);
      this.layersManager.resetState(this.glRenderer, this.layerIds);

      const radiusAndCenter = computeRadiusAndCenter(baseGeometry);
      const radius = radiusAndCenter.radius || 1;
      const center = radiusAndCenter.center;
      const scale = 2.5 / radius;

      this.mapBaseNode.setTraslacion([
        -center[0] * scale,
        -center[1] * scale,
        -center[2] * scale,
      ]);
      this.mapBaseNode.setEscalado([scale, scale, scale]);

      this.rotationManager.resetOrientation();

      const scaledRadius = radius * scale;
      const cameraFit = this.cameraManager.configureFromPlanetRadius(scaledRadius);
      this.layersManager.configureThresholds({
        cameraDistance: cameraFit.cameraDistance,
        introTargetRadius: cameraFit.introTargetRadius,
        minRadius: cameraFit.minRadius,
      });
      const layerThresholds = this.layersManager.getThresholds();
      this.cityLabelManager?.setVisibilityThresholds(
        layerThresholds.comunidades,
        layerThresholds.provincias
      );

      this.pinManager.setPlanetGeometry(baseGeometry, radius, center, scale);
      this.cityLabelManager?.setPlanetGeometry(baseGeometry, radius, center, scale);
      this.refreshPinOverlays();

      this.glRenderer.setCamera(
        this.camera.getViewMatrix(),
        this.camera.getProjectionMatrix(),
        this.camera.getPosition()
      );

      this.ready = true;

      if (this.autoStartIntroPending && this.homeIntroState === 'idle') {
        this.startHomeIntro();
      }

      // const thresholds = this.layersManager.getThresholds();
      // console.info('[OpenGL] Planeta cargado OK', {
      //   file,
      //   vertices: baseGeometry.vertices.length / (baseGeometry.stride / 4),
      //   indices: baseGeometry.indices?.length ?? 0,
      //   comunidadesVertices: comunidadesGeometry.vertices.length / (comunidadesGeometry.stride / 4),
      //   provinciasVertices: provinciasGeometry.vertices.length / (provinciasGeometry.stride / 4),
      //   zoomThresholdComunidades: thresholds.comunidades,
      //   zoomThresholdProvincias: thresholds.provincias,
      //   introCamTargetRadius: cameraFit.introTargetRadius,
      //   radius,
      //   center,
      // });
    } catch (err) {
      baseMeshPtr?.release();
      comunidadesMeshPtr?.release();
      provinciasMeshPtr?.release();

      console.error('Error cargando glTF del planeta:', err);
      this.ready = false;

      this.releasePlanetMeshResources();
      this.pinManager.clearPlanetGeometry();
      this.cityLabelManager?.clearPlanetGeometry();
      this.cityLabelManager?.clearVisibilityThresholds();
      this.glRenderer.setGeometry(createColoredSphere(1.0, 24, 32));
      this.glRenderer.setMapLayerGeometry(this.layerIds.comunidades, null);
      this.glRenderer.setMapLayerGeometry(this.layerIds.provincias, null);
      this.layersManager.resetState(this.glRenderer, this.layerIds);
      this.layersManager.clearThresholds();
      this.glRenderer.setOverlayGeometries([]);

      this.mapBaseNode.setTraslacion([0, 0, 0]);
      this.mapBaseNode.setEscalado([1, 1, 1]);
      this.rotationManager.resetOrientation();

      this.ready = true;

      if (this.autoStartIntroPending && this.homeIntroState === 'idle') {
        this.startHomeIntro();
      }
    }
  }

  private refreshPinOverlays(): void {
    if (!this.glRenderer) return;
    const overlays = this.pinManager.rebuildOverlays();
    this.glRenderer.setOverlayGeometries(overlays);
  }

  private updateClusterBadges(overlayOpacity: number, distance: number): void {
    const overlay = this.clusterBadgeOverlay;
    if (!overlay || !this.camera) return;

    // Mirror the same threshold used by the pin manager so badges
    // appear and disappear exactly together with the pin meshes.
    const OPACITY_THRESHOLD = 0.1;
    if (overlayOpacity <= OPACITY_THRESHOLD) {
      overlay.style.opacity = '0';
      return;
    }
    overlay.style.opacity = String(Math.min(overlayOpacity, 1));

    const badges = this.pinManager.getClusterBadges(
      this.camera.getViewMatrix(),
      this.camera.getProjectionMatrix(),
    );

    // Scale badge size based on camera distance: larger when close, smaller when far.
    // scaledRadius ≈ 2.5 (radius * 2.5/radius). close ≈ 1.5, full-Spain view ≈ 4.5.
    const t = Math.min(Math.max((distance - 1.5) / (6.0 - 1.5), 0), 1);
    const badgePx = Math.round(22 - t * 14);  // 22px close → 8px far
    const fontPx  = Math.round(badgePx * 0.7); // 70% of circle → number fills most of it

    // Grow pool as needed
    while (this.clusterBadgePool.length < badges.length) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;border-radius:50%;' +
        'background:#fff;border:2px solid #111;color:#111;' +
        'font-family:Arial,sans-serif;font-weight:bold;display:flex;align-items:center;' +
        'justify-content:center;transform:translate(-50%,-50%);' +
        'pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.35);';
      overlay.appendChild(el);
      this.clusterBadgePool.push(el);
    }

    // Update visible badges
    for (let i = 0; i < this.clusterBadgePool.length; i++) {
      const el = this.clusterBadgePool[i];
      if (i < badges.length) {
        const { x, y, count } = badges[i];
        el.style.display = 'flex';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.width = `${badgePx}px`;
        el.style.height = `${badgePx}px`;
        el.style.fontSize = `${fontPx}px`;
        el.textContent = String(count);
      } else {
        el.style.display = 'none';
      }
    }
  }

  private updatePointerNdcFromClient(clientX: number, clientY: number): void {
    if (!this.dom) return;
    const rect = this.dom.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.pinManager.setPointerNdc(ndcX, ndcY);
    this.lastPointerNdc = { x: ndcX, y: ndcY };
  }

  private setCanvasPointerCursor(isPointer: boolean): void {
    if (!this.dom) return;
    if (this.pointerCursorActive === isPointer) return;
    this.pointerCursorActive = isPointer;
    this.dom.style.cursor = isPointer ? 'pointer' : 'default';
  }

  private isWithinSelectionOpenDebounce(): boolean {
    return this.nowMs() - this.selectionOpenedAtMs < this.selectionReclickCloseDebounceMs;
  }

  private nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  private asVec3(point: any): Vec3 | null {
    const x = Number(point?.x);
    const y = Number(point?.y);
    const z = Number(point?.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return [x, y, z];
  }

  private getProductId(product: any): string | null {
    const uid = String(product?.uid ?? '').trim();
    if (uid) return uid;
    const id = String(product?._id ?? '').trim();
    return id || null;
  }

  private getPinSelectionKey(pin: any): string | null {
    if (!pin) return null;

    if (pin.isCluster) {
      const clusterKey = this.getClusterSelectionKey(pin);
      if (clusterKey) return `cluster:${clusterKey}`;

      const clusterCount = Array.isArray(pin.clusterProducts) ? pin.clusterProducts.length : 0;
      const lat = Number(pin.lat);
      const lon = Number(pin.lon);
      const name = String(pin.name ?? '').trim();
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return `cluster:${lat.toFixed(6)}:${lon.toFixed(6)}:${clusterCount}:${name}`;
      }
      return clusterCount > 0 ? `cluster:count:${clusterCount}` : null;
    }

    const productId = this.getProductId(pin.product);
    if (productId) return `pin:${productId}`;

    const lat = Number(pin.lat);
    const lon = Number(pin.lon);
    const name = String(pin.name ?? '').trim();
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return `pin:${lat.toFixed(6)}:${lon.toFixed(6)}:${name}`;
    }
    return name ? `pin:name:${name}` : null;
  }

  private getClusterSelectionKey(pin: any): string | null {
    const products = Array.isArray(pin?.clusterProducts) ? pin.clusterProducts : [];
    if (!products.length) return null;
    const ids = products
      .map((p: any) => this.getProductId(p))
      .filter((id: string | null): id is string => !!id)
      .sort();
    if (!ids.length) return null;
    return ids.join('|');
  }

  private onResize = (): void => {
    if (!this.glRenderer || !this.cameraManager) return;
    const { width, height } = this.glRenderer.getDomElement().getBoundingClientRect();
    this.cameraManager.onResize(width, height);
  };

  private releasePlanetMeshResources(): void { //Se liberan los recursos de las mallas del planeta para liberar memoria GPU.
    this.baseMeshResourcePtr?.release();
    this.baseMeshResourcePtr = null;
    this.comunidadesMeshResourcePtr?.release();
    this.comunidadesMeshResourcePtr = null;
    this.provinciasMeshResourcePtr?.release();
    this.provinciasMeshResourcePtr = null;
  }

  private buildGlbResourceKey(url: string, options: LoadGlbGeometryOptions): string {
    const includeNodeNames = [...(options.includeNodeNames ?? [])]
      .map((name) => name.trim().toLowerCase())
      .sort()
      .join(',');
    const excludeNodeNames = [...(options.excludeNodeNames ?? [])]
      .map((name) => name.trim().toLowerCase())
      .sort()
      .join(',');
    const defaultColor = options.defaultColor ? options.defaultColor.join(',') : '';
    const bake = options.bakeBaseColorTexture === true ? 1 : 0;
    const preserve = options.preserveBaseColorTexture === true ? 1 : 0;
    return [
      `malla:${url}`,
      `include=${includeNodeNames}`,
      `exclude=${excludeNodeNames}`,
      `bake=${bake}`,
      `preserve=${preserve}`,
      `defaultColor=${defaultColor}`,
    ].join('|');
  }
}
