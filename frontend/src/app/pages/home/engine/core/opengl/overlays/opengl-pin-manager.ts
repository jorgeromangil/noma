import { loadGlbGeometryMerged } from '../geometry/gltf-loader';
import { createColoredSphere, Geometry, transformGeometry } from '../geometry/geometry';
import { clamp, identityMat4, normalizeVec3, orientNormalOutward, rotateX, rotationFromTo, transformPointMat4, Vec3 } from '../math/opengl-math';
import { TGestorRecursos, TRecursoMalla, TSharedPtr } from '../resources/resource-manager';
import { UtilsGeo } from '../../utils-geo';
import { multiplyMat4, rotateY, scaleUniform, translate } from '../rendering/gl-renderer';

// Interfaz compartida con Three.js pin manager
export interface PinHoverEvent {
  product: any;
  screenX: number;
  screenY: number;
}

export interface OpenGLLocationData {
  id?: string | number;
  name?: string;
  lat: number;
  lon: number;
  product?: any;
  /** Presente cuando esta ubicación representa un cluster sintético */
  isCluster?: boolean;
  /** Productos agrupados en el cluster (solo cuando isCluster === true) */
  clusterProducts?: any[];
}

export interface ClusterHoverEvent {
  products: any[];
  count: number;
  screenX: number;
  screenY: number;
}

type PointerNdc = { x: number; y: number };

type OpenGLPinState = {
  location: OpenGLLocationData;
  baseSurfacePoint: Vec3;
  outwardNormal: Vec3;
  currentLift: number;
  currentScale: number;
  breathPhase: number;
  /** 'single' para pines individuales, 'cluster' para nodos agrupados */
  kind: 'single' | 'cluster';
  /** Escala base de reposo: 1 para singles, CLUSTER_SCALE_MULTIPLIER para clusters */
  baseScale: number;
  /** Ubicaciones originales aggrupadas (solo para clusters) */
  memberLocations?: OpenGLLocationData[];
};

export type OpenGLPinHandle = {
  __openglPinIndex: number;
  getWorldPosition(target?: { set?: (x: number, y: number, z: number) => any }): any;
};

export interface OpenGLPinInteractionParams {
  dt: number;
  overlayOpacity: number;
  cameraPosition: Vec3;
  viewMatrix: Float32Array;
  projectionMatrix: Float32Array;
}

export interface OpenGLPinInteractionResult {
  isHovering: boolean;
  needsOverlayRefresh: boolean;
}

export interface OpenGLPinClickParams {
  overlayOpacity: number;
  cameraPosition: Vec3;
  viewMatrix: Float32Array;
  projectionMatrix: Float32Array;
}

export interface OpenGLPinHighlightState {
  hover: OpenGLPinHighlightSample | null;
  active: OpenGLPinHighlightSample | null;
}

export interface OpenGLPinHighlightSample {
  worldPosition: Vec3;
  worldAnchor: Vec3;
  worldNormal: Vec3;
  worldRadius: number;
  strength: number;
  glowColor: Vec3;
}

export class OpenGLPinManager {
  /** Callback opcional para avisar cuando se carga una geometría de pin */
  public onGeometryLoaded?: (category: string) => void;
  private readonly resourceManager = TGestorRecursos.getInstancia();
  private locations: OpenGLLocationData[] = [];

  private planetGeometry: Geometry | null = null;
  private planetRawRadius = 1;
  private planetRawCenter: Vec3 = [0, 0, 0];
  private planetScale = 1;

  // Pines por categoría
  private readonly categoryPinModels: Record<string, string> = {
    'alimentacion': 'assets/models/pin-alimentacion.glb',
    'textil': 'assets/models/pin-textil.glb',
    'barro y alfareria': 'assets/models/pin-barro.glb',
    'madera y mueble': 'assets/models/pin-madera.glb',
    'otros': 'assets/models/pin-otros.glb',
    'cluster': 'assets/models/marcador_noma.glb',
  };

  // Normaliza una categoría: minúsculas y sin tildes
  private normalizeCategory(category: string): string {
    return category
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');
  }
  private readonly pinTemplateScale = 0.001;
  private readonly pinTilt2DRad = Math.PI / 2;
  private readonly categoryColors: Record<string, [number, number, number]> = {
    'alimentacion': [0.22, 0.52, 0.98],      // azul
    'textil': [0.96, 0.15, 0.78],            // fucsia
    'barro y alfareria': [0.96, 0.20, 0.22], // rojo
    'madera y mueble': [1.00, 0.72, 0.86],   // rosa claro
    'otros': [0.57, 0.34, 0.86],             // morado
  };

  // Almacena geometrías cargadas por categoría
  private pinCategoryGeometries: Record<string, Geometry | null> = {};
  private pinCategoryResourcePtrs: Record<string, TSharedPtr<TRecursoMalla> | null> = {};
  private pinCategoryLoading: Record<string, Promise<void> | null> = {};

  private readonly pins: OpenGLPinState[] = [];
  private overlayGeometries: Geometry[] = [];
  private pointerNdc: PointerNdc | null = null;
  private hoveredPinIndex: number | null = null;
  private activePinIndex: number | null = null;
  /** Product ID to activate as soon as its cluster dissolves into an individual pin */
  private pendingActiveProductId: string | null = null;
  private pinLayerModelMatrix: Float32Array = identityMat4();
  private viewMode: '2d' | '3d' = '2d';
  private viewModeBlend = 0;
  private viewModeBlendTarget = 0;
  private readonly viewModeBlendHz = 10;

  private readonly interactionOpacityThreshold = 0.1;
  private readonly baseLiftRatio = 0.00045;
  private readonly breathLiftRatio = 0.00025;
  private readonly hoveredBaseScale = 1.05;
  private readonly activeBaseScale = 1.12;
  private readonly hoverLerpFactor = 0.12;
  private readonly activeLerpFactor = 0.14;
  private readonly releaseLerpFactor = 0.1;
  // --- Escalado dependiente del zoom (paridad visual con Three.js) ---
  private readonly pinScaleReferenceDistanceRatio = 0.65;
  private readonly pinScaleReferenceFovRad = Math.PI / 3; // 60°
  private readonly pinScaleReferenceHeight = 1080;
  private readonly pinScaleMinMultiplier = 0.2;
  private readonly pinScaleMaxMultiplier = 4.5;
  /** Distancia de zoom reportada por la cámara (desacopla escala del pin respecto a su lat/lon) */
  private zoomDistanceOverride: number | null = null;
  private readonly pickRadiusMultiplier = 1.05; // casi igual al pin visible para picking preciso
  private readonly pickDepthSlackRatio = 0.03;  // menor tolerancia en profundidad para clavar el hit
  private readonly highlightRadiusMultiplier = 3.4;
  private readonly highlightRadiusMinRatio = 0.0009;
  private readonly highlightRadiusMaxRatio = 0.0048;
  private readonly hoverHighlightStrength = 0.52;
  private readonly activeHighlightStrength = 0.95;

  // --- HOVER PREVIEW ---
  private onHoverCallback: ((event: PinHoverEvent | null) => void) | null = null;
  private lastHoveredPinIndex: number | null = null;
  private dom: HTMLCanvasElement | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  /** Framas consecutivos sin detectar el pin antes de emitir null */
  private hoverMissFrames: number = 0;
  private readonly HOVER_MISS_TOLERANCE = 5;

  // --- CLUSTERING (paridad con Three.js PinManager) ---
  /** Todos los pines individuales (source of truth antes de agrupar) */
  private readonly allSinglePins: OpenGLPinState[] = [];
  /** Factor de cuantización actual (null = sin clustering) */
  private clusterFactor: number | null = null;
  /** Timestamp hasta el que el factor está bloqueado (evita regresar tras expandir) */
  private clusterLockUntil: number = 0;
  /** Indica que hay que reconstruir clusters en el próximo tick */
  private clusterDirty: boolean = false;
  /** Matrices de la última cámara para el paso de clustering en pantalla */
  private lastViewMatrix: Float32Array | null = null;
  private lastProjMatrix: Float32Array | null = null;
  /** Distancia de cámara en el último frame y contador de frames estables.
   *  Cuando la cámara lleva CAMERA_STABLE_FRAMES sin moverse se hace un rebuild
   *  final con las matrices correctas de reposo (keyframe de pantalla preciso). */
  private lastSeenDistance: number = 0;
  private cameraStableFrames: number = 0;
  private readonly CAMERA_STABLE_FRAMES = 6;
  /** Callback al cambiar el cluster en hover */
  private onClusterHoverCallback: ((event: ClusterHoverEvent | null) => void) | null = null;
  /**
   * Niveles de clustering — sólo agrupación geográfica por celda (Paso 1).
   * No hay Paso 2 de proximidad en pantalla para factor ≠ null: dos pines de
   * ciudades distintas nunca deben unirse por un umbral px que depende del zoom.
   *
   * factor=2 → cuadrícula 0.5° (~55 km) — activo desde vista España hasta zoom muy cercano
   *
   * Con effectiveRadius=2.5:
   *   intro cámara termina en d ≈ 1.625
   *   umbral factor=2 → 0.60 × 2.5 = 1.50
   *   → el usuario recorre ~82% del rango de zoom antes de desagrupar
   *   zoom máximo 3D  → d ≈ 1.47  → null (desagrupa solo al final) ✓
   *
   * Separaciones preservadas con factor=2:
   *   Madrid (lat 40.5) vs Toledo (lat 40.0) → celdas distintas ✓
   *   Alicante + Elche (~20km)               → misma celda       ✓
   */
  private readonly clusterLevels = [
    { minDistanceRatio: 0.60, factor: 2 },  // desde España completa hasta zoom muy cercano – 0.5° grid
    // Por debajo de 0.60 × effectiveRadius (d < 1.50) → null = zoom máximo, se desagrupa
  ];
  /** Escala visual de un nodo cluster respecto a un pin individual (igual que Three.js) */
  private readonly CLUSTER_SCALE_MULTIPLIER = 1.8;
  /** Umbral para solapamiento visual real (factor=null): sólo pines prácticamente
   *  encima del mismo punto geográfico deben agruparse permanentemente. */
  private readonly OVERLAP_PIXEL_THRESHOLD = 14;
  /** Umbral base para refino dentro de celdas geográficas, usado cuando ya hay bastante zoom. */
  private readonly GEO_CELL_OVERLAP_PIXEL_THRESHOLD_NEAR = 36;
  /** Umbral más permisivo al inicio del refino geográfico para retrasar la desagrupación temprana. */
  private readonly GEO_CELL_OVERLAP_PIXEL_THRESHOLD_FAR = 52;
  /** Histéresis del refino por pantalla dentro de celdas geográficas.
   *  enable: zoom-in (más cerca) para desagrupar.
   *  disable: zoom-out (menos zoom) para reagrupar pronto sin flicker. */
  private readonly GEO_REFINEMENT_ENABLE_DISTANCE_RATIO = 0.70;
  private readonly GEO_REFINEMENT_DISABLE_DISTANCE_RATIO = 0.73;
  /** Sincroniza desagrupación con la entrada visual de provincias en pantalla. */
  private readonly PROVINCIAS_OPACITY_FOR_GEO_REFINEMENT = 0.14;
  private provinciasOpacity = 0;
  private geoScreenRefinementActive = false;

  setLocations(locations: any[]): void {
    this.locations = Array.isArray(locations) ? locations : [];
    this.preloadCategories(locations);
    this.rebuildPinStates();
  }

  setPlanetGeometry(
    planetGeometry: Geometry,
    planetRawRadius: number,
    planetRawCenter: Vec3,
    planetScale: number
  ): void {
    this.planetGeometry = planetGeometry;
    this.planetRawRadius = planetRawRadius;
    this.planetRawCenter = planetRawCenter;
    this.planetScale = planetScale;
    this.rebuildPinStates();
  }

  private preloadCategories(locations: any[]): void {
    const seen = new Set<string>();
    locations?.forEach((loc: any) => {
      const cat = this.normalizeCategory(String(loc?.product?.category || 'otros'));
      if (this.categoryPinModels[cat]) seen.add(cat);
    });
    // Asegurar el modelo por defecto y el de clusters
    seen.add('otros');
    seen.add('cluster');
    seen.forEach((cat) => this.ensurePinCategoryLoaded(cat));
  }

  setPinLayerModelMatrix(modelMatrix: Float32Array): void {
    this.pinLayerModelMatrix = new Float32Array(modelMatrix);
  }

  getFrontSurfaceWorldPoint(): Vec3 | null {
    if (!this.planetGeometry) return null;
    const frontSurfaceLocal: Vec3 = [
      this.planetRawCenter[0],
      this.planetRawCenter[1],
      this.planetRawCenter[2] + Math.max(this.planetRawRadius, 1e-3),
    ];
    return transformPointMat4(this.pinLayerModelMatrix, frontSurfaceLocal);
  }

  setViewMode(mode: '2d' | '3d'): void {
    const nextBlendTarget = mode === '3d' ? 1 : 0;
    if (this.viewMode === mode && nearlyEqual(this.viewModeBlendTarget, nextBlendTarget, 1e-6)) {
      return;
    }
    this.viewMode = mode;
    this.viewModeBlendTarget = nextBlendTarget;
  }

  /** Registra el DOM para poder proyectar coordenadas 3D → 2D */
  public setDom(dom: HTMLCanvasElement): void {
    this.dom = dom;
    // Inicializar pointerNdc en el centro de la pantalla para permitir hover sin necesidad de mover el cursor
    this.pointerNdc = { x: 0, y: 0 };
  }

  /** Registra un callback que se invocará cuando cambie el pin hovereado */
  public onHoverChange(callback: (event: PinHoverEvent | null) => void): void {
    this.onHoverCallback = callback;
  }

  /** Actualiza las dimensiones del viewport desde el canvas */
  private updateViewportSize(): void {
    if (!this.dom) {
      this.viewportWidth = window.innerWidth;
      this.viewportHeight = window.innerHeight;
      return;
    }
    const rect = this.dom.getBoundingClientRect();
    this.viewportWidth = rect.width > 0 ? rect.width : window.innerWidth;
    this.viewportHeight = rect.height > 0 ? rect.height : window.innerHeight;
  }

  clearPlanetGeometry(): void {
    this.planetGeometry = null;
    this.hoveredPinIndex = null;
    this.activePinIndex = null;
    this.pendingActiveProductId = null;
    this.geoScreenRefinementActive = false;
    this.allSinglePins.length = 0;
    this.pins.length = 0;
    this.overlayGeometries = [];
  }

  async ensurePinCategoryLoaded(category: string): Promise<void> {
    const normCategory = this.normalizeCategory(category);
    if (!this.categoryPinModels[normCategory]) {
      console.warn(`[OpenGL] No hay modelo configurado para la categoría normalizada '${normCategory}' (original: '${category}')`);
      return;
    }
    if (this.pinCategoryGeometries[normCategory]) {
      return;
    }
    if (this.pinCategoryLoading[normCategory]) {
      return this.pinCategoryLoading[normCategory]!;
    }

    this.pinCategoryLoading[normCategory] = (async () => {
      try {
        const resourcePtr = await this.resourceManager.cargarMalla(
          this.buildPinCategoryResourceKey(normCategory),
          () =>
            loadGlbGeometryMerged(this.categoryPinModels[normCategory], {
              preserveBaseColorTexture: true,
              forceBaseColorClamp: true,
              defaultColor: [1, 1, 1],
            })
        );
        this.pinCategoryResourcePtrs[normCategory]?.release();
        this.pinCategoryResourcePtrs[normCategory] = resourcePtr;
        this.pinCategoryGeometries[normCategory] = resourcePtr.get().obtenerMalla();
        // Forzar refresco/redraw de overlays cuando la geometría esté lista
        if (typeof this['onGeometryLoaded'] === 'function') {
          this['onGeometryLoaded'](normCategory);
        }
      } catch (err) {
        this.pinCategoryGeometries[normCategory] = null;
        console.warn(`[OpenGL] No se pudo cargar el pin GLB para categoría ${normCategory}, se usará esfera fallback:`, err);
      } finally {
        this.pinCategoryLoading[normCategory] = null;
      }
    })();

    return this.pinCategoryLoading[normCategory]!;
  }

  dispose(): void {
    // Liberar recursos de pines por categoría
    for (const cat in this.pinCategoryResourcePtrs) {
      this.pinCategoryResourcePtrs[cat]?.release();
      this.pinCategoryResourcePtrs[cat] = null;
      this.pinCategoryGeometries[cat] = null;
      this.pinCategoryLoading[cat] = null;
    }
    this.pointerNdc = null;
    this.hoveredPinIndex = null;
    this.activePinIndex = null;
    this.pendingActiveProductId = null;
    this.geoScreenRefinementActive = false;
    this.allSinglePins.length = 0;
    this.pins.length = 0;
    this.overlayGeometries = [];
  }

  setPointerNdc(x: number, y: number): void {
    this.pointerNdc = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  clearPointer(): void {
    this.pointerNdc = null;
  }

  // Compatibilidad con Home/Three: limpiar hover activo sin tocar selección.
  clearHover(_cooldownMs: number = 0): void {
    this.hoveredPinIndex = null;
    this.lastHoveredPinIndex = null;
    this.hoverMissFrames = this.HOVER_MISS_TOLERANCE;
    this._emitBothHoverNull();
  }

  updateInteraction(params: OpenGLPinInteractionParams): OpenGLPinInteractionResult {
    const prevViewModeBlend = this.viewModeBlend;
    const viewModeBlendStep =
      params.dt > 0 ? 1 - Math.exp(-this.viewModeBlendHz * params.dt) : 0.16;
    this.viewModeBlend = lerp(this.viewModeBlend, this.viewModeBlendTarget, clamp(viewModeBlendStep, 0, 1));
    if (Math.abs(this.viewModeBlend - this.viewModeBlendTarget) < 1e-4) {
      this.viewModeBlend = this.viewModeBlendTarget;
    }

    // Guardar matrices para el paso de clustering en pantalla (paso 2)
    this.lastViewMatrix = params.viewMatrix;
    this.lastProjMatrix = params.projectionMatrix;

    // Reglas de histéresis: desagrupar al acercar y reagrupar al alejar un poco.
    this._updateGeoScreenRefinementState();

    // Reconstruir clusters si el factor cambió, pero SOLO cuando los pines ya son
    // visibles (overlayOpacity > threshold). Así evitamos que durante la animación
    // de intro (cámara muy alejada) el Paso 2 agrupe todos los pines en uno solo.
    let needsOverlayRefresh = !nearlyEqual(prevViewModeBlend, this.viewModeBlend, 1e-6);
    if (this.clusterDirty && params.overlayOpacity > this.interactionOpacityThreshold) {
      this._rebuildClusters(this.clusterFactor);
      this.clusterDirty = false;
      this.hoveredPinIndex = null;
      this.lastHoveredPinIndex = null;
      needsOverlayRefresh = true; // siempre redibujar tras reconstruir clusters
    }

    if (this.pins.length === 0) {
      this.hoveredPinIndex = null;
      this._emitBothHoverNull();
      return { isHovering: false, needsOverlayRefresh };
    }

    const canInteract = params.overlayOpacity > this.interactionOpacityThreshold && !!this.pointerNdc;
    const nextHovered = canInteract ? this.pickHoveredPin(params) : null;
    const zoomScale = this.computePinScaleMultiplier(params.projectionMatrix, params.cameraPosition);

    needsOverlayRefresh = needsOverlayRefresh || nextHovered !== this.hoveredPinIndex;
    this.hoveredPinIndex = nextHovered;

    // --- EMITIR EVENTO DE HOVER PREVIEW (similar a Three.js) ---
    if (nextHovered !== this.lastHoveredPinIndex) {
      // Cambio de pin detectado
      this.lastHoveredPinIndex = nextHovered;
      this.hoverMissFrames = 0;
      if (nextHovered !== null) {
        this._emitHoverEventForPin(nextHovered, params);
      } else {
        this._emitBothHoverNull();
      }
    } else if (nextHovered === null && this.lastHoveredPinIndex !== null) {
      // Sin pin: acumular frames de miss antes de aceptar la salida
      this.hoverMissFrames++;
      if (this.hoverMissFrames >= this.HOVER_MISS_TOLERANCE) {
        if (this.lastHoveredPinIndex !== null) {
          this.lastHoveredPinIndex = null;
          this._emitBothHoverNull();
        }
      } else if (this.lastHoveredPinIndex !== null) {
        // Mantener posición del último pin conocido durante los frames de tolerancia
        this._emitHoverEventForPin(this.lastHoveredPinIndex, params);
      }
    } else if (nextHovered !== null) {
      // Mantener emitiendo el evento mientras se hover el pin
      this._emitHoverEventForPin(nextHovered, params);
    }

    const baseLift = this.getBaseLiftLocal();
    const breathLiftAmp = this.getBreathLiftAmplitudeLocal();
    const hoverLift = baseLift + breathLiftAmp * 0.7;
    const activeLift = baseLift + breathLiftAmp * 1.6;

    for (let i = 0; i < this.pins.length; i++) {
      const pin = this.pins[i];
      const isHovered = i === this.hoveredPinIndex;
      const isActive = i === this.activePinIndex;
      const prevLift = pin.currentLift;
      const prevScale = pin.currentScale;
      const prevPhase = pin.breathPhase;

      const baseScale = pin.baseScale ?? 1;
      let targetLift = 0;
      let targetScale = baseScale * zoomScale;
      let lerpFactor = this.releaseLerpFactor;

      if (isActive) {
        pin.breathPhase = 0;
        targetLift = activeLift;
        targetScale = baseScale * zoomScale * this.activeBaseScale;
        lerpFactor = this.activeLerpFactor;
      } else if (isHovered) {
        pin.breathPhase = 0;
        targetLift = hoverLift;
        targetScale = baseScale * zoomScale * this.hoveredBaseScale;
        lerpFactor = this.hoverLerpFactor;
      } else {
        pin.breathPhase = 0;
      }

      pin.currentLift = lerp(pin.currentLift, targetLift, lerpFactor);
      pin.currentScale = lerp(pin.currentScale, targetScale, lerpFactor);

      if (
        !nearlyEqual(prevLift, pin.currentLift, 1e-8) ||
        !nearlyEqual(prevScale, pin.currentScale, 1e-8) ||
        !nearlyEqual(prevPhase, pin.breathPhase, 1e-8)
      ) {
        needsOverlayRefresh = true;
      }
    }

    return {
      isHovering: this.hoveredPinIndex !== null,
      needsOverlayRefresh,
    };
  }

  activateHoveredPin(): OpenGLLocationData | null {
    if (this.hoveredPinIndex === null) return null;
    this.activePinIndex = this.hoveredPinIndex;
    this._trackActiveProductId(this.hoveredPinIndex);
    return this.pins[this.hoveredPinIndex]?.location ?? null;
  }

  activatePinAtPointer(params: OpenGLPinClickParams): OpenGLLocationData | null {
    const canInteract = params.overlayOpacity > this.interactionOpacityThreshold && !!this.pointerNdc;
    const pickedIndex = canInteract
      ? this.pickHoveredPin({
          dt: 0,
          overlayOpacity: params.overlayOpacity,
          cameraPosition: params.cameraPosition,
          viewMatrix: params.viewMatrix,
          projectionMatrix: params.projectionMatrix,
        })
      : null;

    this.hoveredPinIndex = pickedIndex;
    if (pickedIndex === null) return null;
    this.activePinIndex = pickedIndex;
    this._trackActiveProductId(pickedIndex);
    return this.pins[pickedIndex]?.location ?? null;
  }

  /** Store the product ID of pin at index so glow survives cluster rebuilds. */
  private _trackActiveProductId(index: number): void {
    const pin = this.pins[index];
    if (!pin) return;
    const prod = pin.location.product;
    const id = String(prod?.uid || prod?._id || '') || null;
    this.pendingActiveProductId = id;
  }

  clearActivePin(): void {
    this.activePinIndex = null;
    this.pendingActiveProductId = null;
  }

  setActivePin(pin: OpenGLPinHandle | null): void {
    const index = this.resolvePinIndex(pin);
    this.activePinIndex = index;
    if (index !== null && this.pins[index]?.kind === 'single') {
      // Store the product ID so the glow survives cluster rebuilds (e.g. during zoom-in fly).
      const prod = this.pins[index].location.product;
      const id = String(prod?.uid || prod?._id || '') || null;
      if (id) this.pendingActiveProductId = id;
    }
    // For cluster pins: pendingActiveProductId was already set in getPinByProductId.
  }

  getActivePin(): OpenGLPinHandle | null {
    if (this.activePinIndex === null) return null;
    return this.createPinHandle(this.activePinIndex);
  }

  getPinByProductId(productId: string): OpenGLPinHandle | null {
    const wanted = String(productId || '');
    if (!wanted) return null;

    // First: look only among visible INDIVIDUAL pins (skip cluster nodes — even if the
    // cluster's synthetic product happens to share the same ID as a member).
    const index = this.pins.findIndex((pin) => {
      if (pin.kind !== 'single') return false;
      const prod = pin.location.product;
      const uid = String(prod?.uid || '');
      const id = String(prod?._id || '');
      return uid === wanted || id === wanted;
    });

    if (index >= 0) return this.createPinHandle(index);

    // Fallback: product may be inside a cluster — search memberLocations
    const clusterIndex = this.pins.findIndex((pin) => {
      if (pin.kind !== 'cluster' || !pin.memberLocations) return false;
      return pin.memberLocations.some((loc) => {
        const prod = loc.product;
        return String(prod?.uid || '') === wanted || String(prod?._id || '') === wanted;
      });
    });

    if (clusterIndex >= 0) {
      // Track pending activation so the individual pin gets the glow once the cluster dissolves
      this.pendingActiveProductId = wanted;
      const clusterPin = this.pins[clusterIndex];
      // Use the member's own surface point (from allSinglePins) for a precise zoom target
      const memberSinglePin = this.allSinglePins.find((sp) => {
        const prod = sp.location.product;
        return String(prod?.uid || '') === wanted || String(prod?._id || '') === wanted;
      });
      const memberSurface: Vec3 = memberSinglePin
        ? memberSinglePin.baseSurfacePoint
        : clusterPin.baseSurfacePoint;
      const memberNormal: Vec3 = memberSinglePin
        ? memberSinglePin.outwardNormal
        : clusterPin.outwardNormal;
      const lift = clusterPin.currentLift;
      const modelMatrix = this.pinLayerModelMatrix;
      return {
        __openglPinIndex: clusterIndex,
        getWorldPosition: (target?: { set?: (x: number, y: number, z: number) => any }) => {
          const liftedPos: Vec3 = [
            memberSurface[0] + memberNormal[0] * lift,
            memberSurface[1] + memberNormal[1] * lift,
            memberSurface[2] + memberNormal[2] * lift,
          ];
          const worldPos = transformPointMat4(modelMatrix, liftedPos);
          if (target?.set) return target.set(worldPos[0], worldPos[1], worldPos[2]);
          return { x: worldPos[0], y: worldPos[1], z: worldPos[2] };
        },
      };
    }

    return null;
  }

  /** If a product was selected while clustered, activate its pin as soon as it becomes individual */
  private _tryRestorePendingActivePin(): void {
    if (!this.pendingActiveProductId) return;
    const wanted = this.pendingActiveProductId;
    const index = this.pins.findIndex((pin) => {
      if (pin.kind !== 'single') return false;
      const prod = pin.location.product;
      return String(prod?.uid || '') === wanted || String(prod?._id || '') === wanted;
    });
    if (index >= 0) {
      this.activePinIndex = index;
      // Do NOT clear pendingActiveProductId here — it must survive future rebuilds
      // so the glow persists as long as the product is selected (modal open).
      // It is only cleared by clearActivePin() when the modal closes.
    }
    // If still clustered, activePinIndex stays null until the next rebuild dissolves the cluster.
  }

  getHighlightState(): OpenGLPinHighlightState {
    const active = this.buildHighlightSample(this.activePinIndex, this.activeHighlightStrength);
    const hover =
      this.hoveredPinIndex !== null && this.hoveredPinIndex !== this.activePinIndex
        ? this.buildHighlightSample(this.hoveredPinIndex, this.hoverHighlightStrength)
        : null;

    return { hover, active };
  }

  /**
   * Returns screen-space positions and product counts for all visible cluster pins.
   * Used by the adapter to render DOM count badges over each cluster.
   */
  getClusterBadges(
    viewMatrix: Float32Array,
    projMatrix: Float32Array,
  ): Array<{ x: number; y: number; count: number }> {
    if (!this.lastViewMatrix || !this.lastProjMatrix) return [];
    const result: Array<{ x: number; y: number; count: number }> = [];
    for (const pin of this.pins) {
      if (pin.kind !== 'cluster') continue;
      const count = pin.memberLocations?.length ?? pin.location.clusterProducts?.length ?? 0;
      if (count < 2) continue;
      // Compute the exact screen position of the balloon center (GLB model space y=2.2,
      // same anchor Three.js uses for its sprite).  We go through the same
      // composePinPlacementMatrix the renderer uses, so the badge lands on the balloon
      // regardless of view mode or tilt direction.
      const liftedPos: Vec3 = [
        pin.baseSurfacePoint[0] + pin.outwardNormal[0] * pin.currentLift,
        pin.baseSurfacePoint[1] + pin.outwardNormal[1] * pin.currentLift,
        pin.baseSurfacePoint[2] + pin.outwardNormal[2] * pin.currentLift,
      ];
      const pinMat = this.composePinPlacementMatrix(liftedPos, pin.outwardNormal, pin.currentScale);
      const badgeLocalPos = transformPointMat4(pinMat, [0, 2.2, 0]);
      const screen = this._projectPinToScreenRaw(pin, viewMatrix, projMatrix, badgeLocalPos);
      if (!screen) continue;
      result.push({ x: screen.x, y: screen.y, count });
    }
    return result;
  }

  rebuildOverlays(): Geometry[] {
    if (!this.planetGeometry || this.pins.length === 0) {
      this.overlayGeometries = [];
      return this.overlayGeometries;
    }

    const overlays: Geometry[] = [];
    const baseFallbackRadius = this.getFallbackPinRadiusLocal();
    const fallbackGeometriesByCategory = new Map<string, Geometry>();
    const defaultPinGeometry = this.pinCategoryGeometries['otros'] || null;

    for (const pin of this.pins) {
      const liftedPos: Vec3 = [
        pin.baseSurfacePoint[0] + pin.outwardNormal[0] * pin.currentLift,
        pin.baseSurfacePoint[1] + pin.outwardNormal[1] * pin.currentLift,
        pin.baseSurfacePoint[2] + pin.outwardNormal[2] * pin.currentLift,
      ];

      // Los clusters siempre usan el marcador de Noma, igual que Three.js usa pinTemplate (marcador_noma.glb)
      const rawCategory = pin.kind === 'cluster' ? 'cluster' : (pin.location.product?.category || 'otros');
      const normCategory = this.normalizeCategory(rawCategory);
      if (pin.kind !== 'cluster') {
        if (!pin.location.product) {
          console.warn('[OpenGL] Pin sin producto:', pin.location);
        } else if (!this.pinCategoryGeometries[normCategory] && !this.pinCategoryLoading[normCategory]) {
          if (!this.categoryPinModels[normCategory]) {
            console.warn(`[OpenGL][DEBUG] No existe modelo configurado para '${normCategory}'`);
          } else {
            this.ensurePinCategoryLoaded(normCategory);
          }
        }
      }
      const pinGeo = this.pinCategoryGeometries[normCategory] || null;

      if (pinGeo) {
        const pinMat = this.composePinPlacementMatrix(liftedPos, pin.outwardNormal, pin.currentScale);
        overlays.push(transformGeometry(pinGeo, pinMat));
      } else if (defaultPinGeometry) {
        // Si la categoría aún no está lista, conservamos silueta de pin realista
        // con el modelo por defecto en lugar de degradar inmediatamente a esfera.
        const pinMat = this.composePinPlacementMatrix(liftedPos, pin.outwardNormal, pin.currentScale);
        overlays.push(transformGeometry(defaultPinGeometry, pinMat));
      } else {
        const fallbackCategory = this.categoryColors[normCategory] ? normCategory : 'otros';
        let fallbackGeo = fallbackGeometriesByCategory.get(fallbackCategory);
        if (!fallbackGeo) {
          const fallbackColor = this.categoryColors[fallbackCategory] ?? this.categoryColors['otros'];
          fallbackGeo = createColoredSphere(baseFallbackRadius, 14, 18, fallbackColor);
          fallbackGeometriesByCategory.set(fallbackCategory, fallbackGeo);
        }
        const finalRadius = baseFallbackRadius * pin.currentScale;
        const fallbackPos: Vec3 = [
          pin.baseSurfacePoint[0] + pin.outwardNormal[0] * (finalRadius + pin.currentLift),
          pin.baseSurfacePoint[1] + pin.outwardNormal[1] * (finalRadius + pin.currentLift),
          pin.baseSurfacePoint[2] + pin.outwardNormal[2] * (finalRadius + pin.currentLift),
        ];
        const fallbackMat = multiplyMat4(
          translate(fallbackPos[0], fallbackPos[1], fallbackPos[2]),
          scaleUniform(pin.currentScale)
        );
        overlays.push(transformGeometry(fallbackGeo, fallbackMat));
      }
    }

    this.overlayGeometries = overlays;
    return this.overlayGeometries;
  }

  private rebuildPinStates(): void {
    this.allSinglePins.length = 0;
    this.pins.length = 0;
    this.hoveredPinIndex = null;
    this.activePinIndex = null;
    this.pendingActiveProductId = null;
    this.geoScreenRefinementActive = false;

    if (!this.planetGeometry) return;

    const radius = Math.max(this.planetRawRadius, 1e-3);
    const center = this.planetRawCenter;

    for (const loc of this.locations) {
      const lat = Number((loc as any)?.lat);
      const lon = Number((loc as any)?.lon);
      if (!isFinite(lat) || !isFinite(lon)) continue;

      const dirUnit = normalizeVec3(UtilsGeo.latLonToVec3Plain(lat, lon, 1));
      const rayOrigin: Vec3 = [
        center[0] + dirUnit[0] * radius * 5,
        center[1] + dirUnit[1] * radius * 5,
        center[2] + dirUnit[2] * radius * 5,
      ];
      const rayDir: Vec3 = [-dirUnit[0], -dirUnit[1], -dirUnit[2]];
      const hit = this.raycastPlanet(rayOrigin, rayDir);
      const surfacePoint: Vec3 = hit?.point ?? [
        center[0] + dirUnit[0] * radius,
        center[1] + dirUnit[1] * radius,
        center[2] + dirUnit[2] * radius,
      ];
      const outwardNormal = orientNormalOutward(hit?.normal ?? dirUnit, dirUnit);

      this.allSinglePins.push({
        location: loc,
        baseSurfacePoint: surfacePoint,
        outwardNormal,
        currentLift: 0,
        currentScale: 1,
        breathPhase: 0,
        kind: 'single',
        baseScale: 1,
      });
    }

    // NO llamar a _rebuildClusters aquí: se hará en updateInteraction cuando
    // overlayOpacity > threshold (pins ya visibles, cámara en posición estable).
    this.clusterDirty = true;
  }

  // ─── CLUSTERING API (paridad con Three.js PinManager) ────────────────────

  /** Registra el callback para hover sobre clusters */
  public onClusterHoverChange(callback: (event: ClusterHoverEvent | null) => void): void {
    this.onClusterHoverCallback = callback;
  }

  /** Inyecta la distancia de zoom para mantener tamaño aparente estable de pines. */
  public setZoomDistance(distance: number | null): void {
    this.zoomDistanceOverride = distance ?? null;
  }

  /** Opacidad actual de la capa de provincias (0..1), usada para sincronía visual. */
  public setProvinciasOpacity(opacity: number): void {
    this.provinciasOpacity = clamp(opacity, 0, 1);
  }

  /**
   * Actualiza el factor de clustering según la distancia cámara→target.
   * Llamar cada frame desde el bucle de renderizado del adaptador.
   */
  public setClusterDistance(distance: number): void {
    if (performance.now() < this.clusterLockUntil) return;
    const nextFactor = this._pickFactorByDistance(distance);

    if (nextFactor !== this.clusterFactor) {
      // Factor cambió → rebuild inmediato + resetear contador de estabilidad
      this.clusterFactor = nextFactor;
      this.clusterDirty = true;
      this.cameraStableFrames = 0;
    } else if (Math.abs(distance - this.lastSeenDistance) < 0.001) {
      // La cámara no se ha movido este frame
      this.cameraStableFrames++;
      if (this.cameraStableFrames === this.CAMERA_STABLE_FRAMES) {
        // Cámara estabilizada: rebuild final con matrices de reposo precisas
        this.clusterDirty = true;
      }
    } else {
      // La cámara se está moviendo (mismo factor pero diferente distancia)
      this.cameraStableFrames = 0;
    }

    this.lastSeenDistance = distance;
  }

  /**
   * Fuerza el modo sin clustering y bloquea el reagrupamiento durante `lockMs`.
   * Equivale al Three.js expandCluster().
   * Reducido de 3000ms a 1200ms para que el cluster pueda recalcularse más rápido
   * al moverse después de hacer zoom sobre el "3" de Madrid.
   */
  public expandCluster(lockMs: number = 1200): void {
    this.clusterFactor = null;
    this.clusterLockUntil = performance.now() + lockMs;
    this.clusterDirty = true;
  }

  /** Devuelve los productos de un nodo cluster dado su índice en this.pins */
  public getClusterProducts(pinIndex: number): any[] {
    const pin = this.pins[pinIndex];
    if (!pin || pin.kind !== 'cluster') return [];
    return pin.memberLocations?.map(l => l.product).filter(Boolean) ?? [];
  }

  // ─── CLUSTERING INTERNALS ─────────────────────────────────────────────────

  private _pickFactorByDistance(distance: number): number | null {
    const effectiveRadius = Math.max(this.planetRawRadius * this.planetScale, 1e-3);
    for (const lvl of this.clusterLevels) {
      if (distance >= lvl.minDistanceRatio * effectiveRadius) return lvl.factor;
    }
    return null;
  }

  /** Clave de cuantización geográfica — idéntica a Three.js _quantKey */
  private _quantKey(lat: number, lon: number, factor: number): string {
    const qLat = Math.round(lat * factor) / factor;
    const qLon = Math.round(lon * factor) / factor;
    return `${qLat.toFixed(5)}|${qLon.toFixed(5)}`;
  }

  /**
   * Reconstruye this.pins con un paso geográfico y, cuando es posible,
   * refina por solape real en pantalla para no mantener agrupados pines
   * que ya no se pisan visualmente.
   *
   * - factor !== null: agrupa por celda lat/lon y después separa por
   *   proximidad en pantalla dentro de cada celda.
   * - factor === null: solo aplica proximidad en pantalla (solape real).
   */
  private _rebuildClusters(factor: number | null): void {
    this.pins.length = 0;
    this.hoveredPinIndex = null;
    this.activePinIndex = null;

    if (factor === null) {
      this._applyPixelProximityOnly(this.allSinglePins);
    } else {
      // Paso 1: agrupar pines en la misma celda geográfica
      const cellMap = new Map<string, OpenGLPinState[]>();
      for (const pin of this.allSinglePins) {
        const key = this._quantKey(Number(pin.location.lat), Number(pin.location.lon), factor);
        const arr = cellMap.get(key) ?? [];
        arr.push(pin);
        cellMap.set(key, arr);
      }

      const effectiveRadius = Math.max(this.planetRawRadius * this.planetScale, 1e-3);
      const distanceRatio =
        this.lastSeenDistance > 0
          ? this.lastSeenDistance / effectiveRadius
          : Number.POSITIVE_INFINITY;
      const canRefineByScreen = this.geoScreenRefinementActive;
      const geoCellThresholdPx = this._computeGeoCellOverlapThreshold(distanceRatio);

      for (const members of cellMap.values()) {
        if (members.length <= 1) {
          this.pins.push(members[0]);
          continue;
        }

        if (!canRefineByScreen) {
          this.pins.push(this._makeClusterPin(members));
          continue;
        }

        // Paso 2 (refino): dentro de la misma celda, separar grupos que ya no
        // se solapan en pantalla con el zoom/cámara actuales.
        const overlapGroups = this._groupByPixelOverlap(
          members,
          geoCellThresholdPx,
        );
        for (const group of overlapGroups) {
          this.pins.push(group.length > 1 ? this._makeClusterPin(group) : group[0]);
        }
      }
    }

    // Restore active pin if a product was selected while it was still clustered
    this._tryRestorePendingActivePin();
  }

  /**
   * Solo aplica el Paso 2 de agrupación por proximidad en pantalla, sin Paso 1 geográfico.
   * Se usa cuando factor===null (zoom máximo): los pines que se solapan visualmente
   * permanecen agrupados siempre, independientemente del nivel de zoom.
   */
  private _applyPixelProximityOnly(candidates: OpenGLPinState[]): void {
    if (candidates.length < 2) {
      for (const p of candidates) this.pins.push(p);
      return;
    }

    const overlapGroups = this._groupByPixelOverlap(
      candidates,
      this.OVERLAP_PIXEL_THRESHOLD,
    );
    for (const group of overlapGroups) {
      this.pins.push(group.length > 1 ? this._makeClusterPin(group) : group[0]);
    }
  }

  /** Agrupa por componentes conectadas de solape en pantalla (distancia px). */
  private _groupByPixelOverlap(
    candidates: OpenGLPinState[],
    thresholdPx: number,
  ): OpenGLPinState[][] {
    if (!this.lastViewMatrix || !this.lastProjMatrix || candidates.length < 2) {
      return candidates.map((p) => [p]);
    }

    const vm = this.lastViewMatrix;
    const pm = this.lastProjMatrix;
    const screenPos = candidates.map((p) => this._projectPinToScreenRaw(p, vm, pm));
    const assigned = new Set<number>();
    const groups: OpenGLPinState[][] = [];

    for (let i = 0; i < candidates.length; i++) {
      if (assigned.has(i)) continue;
      const currentGroup: OpenGLPinState[] = [candidates[i]];
      const stack: number[] = [i];
      assigned.add(i);

      while (stack.length > 0) {
        const idx = stack.pop()!;
        const a = screenPos[idx];
        if (!a) continue;

        for (let j = 0; j < candidates.length; j++) {
          if (assigned.has(j) || !screenPos[j]) continue;
          const dx = a.x - screenPos[j]!.x;
          const dy = a.y - screenPos[j]!.y;
          if (Math.hypot(dx, dy) < thresholdPx) {
            assigned.add(j);
            stack.push(j);
            currentGroup.push(candidates[j]);
          }
        }
      }

      groups.push(currentGroup);
    }

    return groups;
  }

  private _computeGeoCellOverlapThreshold(distanceRatio: number): number {
    const nearRatio = 0.60;
    const farRatio = this.GEO_REFINEMENT_DISABLE_DISTANCE_RATIO;
    const t = clamp((distanceRatio - nearRatio) / Math.max(farRatio - nearRatio, 1e-6), 0, 1);
    return Math.round(
      lerp(
        this.GEO_CELL_OVERLAP_PIXEL_THRESHOLD_NEAR,
        this.GEO_CELL_OVERLAP_PIXEL_THRESHOLD_FAR,
        t,
      ),
    );
  }

  private _updateGeoScreenRefinementState(): void {
    if (this.clusterFactor === null) {
      if (this.geoScreenRefinementActive) {
        this.geoScreenRefinementActive = false;
        this.clusterDirty = true;
      }
      return;
    }

    const effectiveRadius = Math.max(this.planetRawRadius * this.planetScale, 1e-3);
    const distanceRatio =
      this.lastSeenDistance > 0
        ? this.lastSeenDistance / effectiveRadius
        : Number.POSITIVE_INFINITY;
    const provinciasReady = this.provinciasOpacity >= this.PROVINCIAS_OPACITY_FOR_GEO_REFINEMENT;

    let nextActive = this.geoScreenRefinementActive;

    if (nextActive) {
      // En zoom-out, reagrupar en cuanto salgamos un poco del rango de desagrupación.
      if (!provinciasReady || distanceRatio >= this.GEO_REFINEMENT_DISABLE_DISTANCE_RATIO) {
        nextActive = false;
      }
    } else {
      // En zoom-in, exigir cámara estable para evitar desagrupaciones prematuras.
      if (
        provinciasReady &&
        distanceRatio <= this.GEO_REFINEMENT_ENABLE_DISTANCE_RATIO &&
        this.cameraStableFrames >= this.CAMERA_STABLE_FRAMES
      ) {
        nextActive = true;
      }
    }

    if (nextActive !== this.geoScreenRefinementActive) {
      this.geoScreenRefinementActive = nextActive;
      this.clusterDirty = true;
    }
  }

  /** Construye el nodo sintético de cluster a partir de sus pines miembros */
  private _makeClusterPin(members: OpenGLPinState[]): OpenGLPinState {
    // Promedio de los surface points → reproject al radio del primer miembro
    let ax = 0, ay = 0, az = 0;
    for (const m of members) {
      ax += m.baseSurfacePoint[0];
      ay += m.baseSurfacePoint[1];
      az += m.baseSurfacePoint[2];
    }
    const n = members.length;
    ax /= n; ay /= n; az /= n;

    const cx = ax - this.planetRawCenter[0];
    const cy = ay - this.planetRawCenter[1];
    const cz = az - this.planetRawCenter[2];

    const memberRadius = Math.hypot(
      members[0].baseSurfacePoint[0] - this.planetRawCenter[0],
      members[0].baseSurfacePoint[1] - this.planetRawCenter[1],
      members[0].baseSurfacePoint[2] - this.planetRawCenter[2],
    );
    const len = Math.hypot(cx, cy, cz) || 1;
    const avgDir: Vec3 = [cx / len, cy / len, cz / len];
    const clusterSurface: Vec3 = [
      this.planetRawCenter[0] + avgDir[0] * memberRadius,
      this.planetRawCenter[1] + avgDir[1] * memberRadius,
      this.planetRawCenter[2] + avgDir[2] * memberRadius,
    ];
    const outward = orientNormalOutward(avgDir, avgDir);

    const memberLocations = members.map(m => m.location);
    const syntheticLocation: OpenGLLocationData = {
      ...memberLocations[0],
      isCluster: true,
      clusterProducts: memberLocations.map(l => l.product).filter(Boolean),
    };

    return {
      location: syntheticLocation,
      baseSurfacePoint: clusterSurface,
      outwardNormal: outward,
      currentLift: 0,
      currentScale: this.CLUSTER_SCALE_MULTIPLIER,
      breathPhase: 0,
      kind: 'cluster',
      baseScale: this.CLUSTER_SCALE_MULTIPLIER,
      memberLocations,
    };
  }

  /**
   * Proyecta un pin a coordenadas de pantalla usando matrices explícitas.
   * Usado por el algoritmo de clustering en paso 2 (sin acceder a params).
   */
  private _projectPinToScreenRaw(
    pin: OpenGLPinState,
    viewMatrix: Float32Array,
    projMatrix: Float32Array,
    overrideLocalPos?: Vec3,
  ): { x: number; y: number } | null {
    this.updateViewportSize();
    if (this.viewportWidth <= 0 || this.viewportHeight <= 0) return null;

    const pinLocalPos: Vec3 = overrideLocalPos ?? [
      pin.baseSurfacePoint[0] + pin.outwardNormal[0] * pin.currentLift,
      pin.baseSurfacePoint[1] + pin.outwardNormal[1] * pin.currentLift,
      pin.baseSurfacePoint[2] + pin.outwardNormal[2] * pin.currentLift,
    ];
    const pinWorldPos = transformPointMat4(this.pinLayerModelMatrix, pinLocalPos);
    const viewProj = multiplyMat4(projMatrix, viewMatrix);
    const clip = transformVec4(viewProj, [pinWorldPos[0], pinWorldPos[1], pinWorldPos[2], 1]);
    if (Math.abs(clip[3]) < 1e-6) return null;
    const nx = clip[0] / clip[3];
    const ny = clip[1] / clip[3];
    return {
      x: ((nx + 1) / 2) * this.viewportWidth,
      y: ((1 - ny) / 2) * this.viewportHeight,
    };
  }

  private composePinPlacementMatrix(
    position: Vec3,
    outwardNormal: Vec3,
    scaleFactor: number
  ): Float32Array {
    const align = rotationFromTo([0, 1, 0], outwardNormal);
    const yawFix = rotateY(Math.PI / 2);
    const scale = scaleUniform(this.pinTemplateScale * scaleFactor);

    // Interpolamos la pose del pin para evitar el snap visual al pasar de 2D a 3D.
    const tiltAngle = this.pinTilt2DRad * (1 - this.viewModeBlend);
    const tilt = Math.abs(tiltAngle) > 1e-6 ? rotateX(tiltAngle) : identityMat4();

    const localTransform = multiplyMat4(align, multiplyMat4(yawFix, multiplyMat4(tilt, scale)));
    return multiplyMat4(translate(position[0], position[1], position[2]), localTransform);
  }

  private buildPinCategoryResourceKey(category: string): string {
    const normCategory = this.normalizeCategory(category);
    return `malla:${this.categoryPinModels[normCategory]}|preserveTexture=1|forceClamp=1|v=2`;
  }

  private pickHoveredPin(params: OpenGLPinInteractionParams): number | null {
    if (!this.pointerNdc) return null;

    const ray = this.buildWorldRay(
      this.pointerNdc,
      params.viewMatrix,
      params.projectionMatrix,
      params.cameraPosition
    );
    if (!ray) return null;

    const worldScale = extractUniformScale(this.pinLayerModelMatrix);
    const worldPlanetCenter = transformPointMat4(this.pinLayerModelMatrix, this.planetRawCenter);
    const worldPlanetRadius = Math.max(this.planetRawRadius * worldScale, 1e-3);
    const frontSurfaceDistance = intersectRaySphere(
      ray.origin,
      ray.direction,
      worldPlanetCenter,
      worldPlanetRadius
    );
    const depthTolerance = worldPlanetRadius * this.pickDepthSlackRatio;

    let bestIndex: number | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.pins.length; i++) {
      const pin = this.pins[i];
      const pinLocalPos: Vec3 = [
        pin.baseSurfacePoint[0] + pin.outwardNormal[0] * pin.currentLift,
        pin.baseSurfacePoint[1] + pin.outwardNormal[1] * pin.currentLift,
        pin.baseSurfacePoint[2] + pin.outwardNormal[2] * pin.currentLift,
      ];
      const pinLocalMatrix = this.composePinPlacementMatrix(
        pinLocalPos,
        pin.outwardNormal,
        pin.currentScale
      );
      const pinWorldMatrix = multiplyMat4(this.pinLayerModelMatrix, pinLocalMatrix);
      let hitDistance: number | null = null;

      // Usar geometría de la categoría para el picking si está cargada
      const rawCategory = pin.location.product?.category || 'otros';
      const normCategory = this.normalizeCategory(rawCategory);
      const pinGeo = this.pinCategoryGeometries[normCategory] || null;
      if (pinGeo) {
        hitDistance = this.intersectRayWithPinGeometry(pinGeo, ray.origin, ray.direction, pinWorldMatrix);
      }

      // Fallback o refuerzo con una esfera algo mayor para asegurar hit
      if (hitDistance === null) {
        const worldPos = transformPointMat4(this.pinLayerModelMatrix, pinLocalPos);
        const fallbackRadius = this.getFallbackPinRadiusLocal() * pin.currentScale * this.pickRadiusMultiplier;
        const pickRadius = Math.max(worldScale * fallbackRadius, 1e-5);
        hitDistance = intersectRaySphere(ray.origin, ray.direction, worldPos, pickRadius);
      }

      if (hitDistance === null) continue;
      if (frontSurfaceDistance !== null && hitDistance > frontSurfaceDistance + depthTolerance) continue;

      if (hitDistance < closestDistance) {
        closestDistance = hitDistance;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  private buildWorldRay(
    pointer: PointerNdc,
    view: Float32Array,
    projection: Float32Array,
    cameraPosition: Vec3
  ): { origin: Vec3; direction: Vec3 } | null {
    const viewProjection = multiplyMat4(projection, view);
    const invViewProjection = invertMat4(viewProjection);
    if (!invViewProjection) return null;

    const farClip = transformVec4(invViewProjection, [pointer.x, pointer.y, 1, 1]);
    if (Math.abs(farClip[3]) < 1e-6) return null;

    const farPoint: Vec3 = [
      farClip[0] / farClip[3],
      farClip[1] / farClip[3],
      farClip[2] / farClip[3],
    ];
    const dir = normalizeVec3([
      farPoint[0] - cameraPosition[0],
      farPoint[1] - cameraPosition[1],
      farPoint[2] - cameraPosition[2],
    ]);

    return { origin: [...cameraPosition] as Vec3, direction: dir };
  }

  private intersectRayWithPinGeometry(
    geometry: Geometry,
    rayOriginWorld: Vec3,
    rayDirectionWorld: Vec3,
    pinWorldMatrix: Float32Array
  ): number | null {
    if (!geometry) return null;

    const invPinWorld = invertMat4(pinWorldMatrix);
    if (!invPinWorld) return null;

    const localOrigin4 = transformVec4(invPinWorld, [
      rayOriginWorld[0],
      rayOriginWorld[1],
      rayOriginWorld[2],
      1,
    ]);
    if (Math.abs(localOrigin4[3]) < 1e-8) return null;

    const localOrigin: Vec3 = [
      localOrigin4[0] / localOrigin4[3],
      localOrigin4[1] / localOrigin4[3],
      localOrigin4[2] / localOrigin4[3],
    ];
    const localDirRaw = transformDirMat4(invPinWorld, rayDirectionWorld);
    const localDirection = normalizeVec3(localDirRaw);

    const localHit = raycastGeometryPoint(geometry, localOrigin, localDirection);
    if (!localHit) return null;

    const worldHit = transformPointMat4(pinWorldMatrix, localHit);
    const hitVector: Vec3 = [
      worldHit[0] - rayOriginWorld[0],
      worldHit[1] - rayOriginWorld[1],
      worldHit[2] - rayOriginWorld[2],
    ];
    const worldDistance = dot3(hitVector, rayDirectionWorld);
    if (worldDistance <= 1e-6) return null;
    return worldDistance;
  }

  private getBaseLiftLocal(): number {
    return Math.max(this.planetRawRadius, 1e-3) * this.baseLiftRatio;
  }

  private getBreathLiftAmplitudeLocal(): number {
    return Math.max(this.planetRawRadius, 1e-3) * this.breathLiftRatio;
  }

  private computePinScaleMultiplier(projectionMatrix: Float32Array, cameraPosition: Vec3): number {
    this.updateViewportSize();

    const effectiveRadius = Math.max(this.planetRawRadius * this.planetScale, 1e-3);
    const referenceDistance = Math.max(effectiveRadius * this.pinScaleReferenceDistanceRatio, 1e-4);
    const effectiveDistance = Math.max(
      this.zoomDistanceOverride ?? this.estimateCameraDistanceToTarget(cameraPosition),
      1e-4
    );

    const viewportHeight = this.viewportHeight > 0 ? this.viewportHeight : this.pinScaleReferenceHeight;
    const projectionY = Math.abs(projectionMatrix[5]) > 1e-6
      ? projectionMatrix[5]
      : 1 / Math.tan(this.pinScaleReferenceFovRad * 0.5);
    const tanHalfFov = Math.max(1 / projectionY, 1e-6);
    const refTanHalfFov = Math.tan(this.pinScaleReferenceFovRad * 0.5);

    const distanceTerm = effectiveDistance / referenceDistance;
    const fovTerm = tanHalfFov / refTanHalfFov;
    const heightTerm = this.pinScaleReferenceHeight / viewportHeight;

    return clamp(
      distanceTerm * fovTerm * heightTerm,
      this.pinScaleMinMultiplier,
      this.pinScaleMaxMultiplier
    );
  }

  private estimateCameraDistanceToTarget(cameraPosition: Vec3): number {
    const worldPlanetCenter = transformPointMat4(this.pinLayerModelMatrix, this.planetRawCenter);
    return Math.hypot(
      cameraPosition[0] - worldPlanetCenter[0],
      cameraPosition[1] - worldPlanetCenter[1],
      cameraPosition[2] - worldPlanetCenter[2]
    );
  }

  private getFallbackPinRadiusLocal(): number {
    const planetScaleSafe = Math.max(this.planetScale, 1e-6);
    return 0.001 / planetScaleSafe;
  }

  private buildHighlightSample(index: number | null, strength: number): OpenGLPinHighlightSample | null {
    if (index === null) return null;
    const pin = this.pins[index];
    if (!pin) return null;
    const rawCategory = pin.location.product?.category || 'otros';
    const normCategory = this.normalizeCategory(rawCategory);
    const glowColor = this.categoryColors[normCategory] ?? this.categoryColors['otros'];

    const worldScale = extractUniformScale(this.pinLayerModelMatrix);
    const worldPlanetRadius = Math.max(this.planetRawRadius * worldScale, 1e-4);
    const fallbackPinRadiusWorld = Math.max(this.getFallbackPinRadiusLocal() * worldScale, 1e-5);
    const worldRadius = clamp(
      fallbackPinRadiusWorld * this.highlightRadiusMultiplier,
      worldPlanetRadius * this.highlightRadiusMinRatio,
      worldPlanetRadius * this.highlightRadiusMaxRatio
    );

    const localLiftedPos: Vec3 = [
      pin.baseSurfacePoint[0] + pin.outwardNormal[0] * pin.currentLift,
      pin.baseSurfacePoint[1] + pin.outwardNormal[1] * pin.currentLift,
      pin.baseSurfacePoint[2] + pin.outwardNormal[2] * pin.currentLift,
    ];
    const worldPosition = transformPointMat4(this.pinLayerModelMatrix, localLiftedPos);
    const worldAnchor = transformPointMat4(this.pinLayerModelMatrix, pin.baseSurfacePoint);
    const worldNormalRaw = transformDirMat4(this.pinLayerModelMatrix, pin.outwardNormal);
    const worldNormal = normalizeSafe(worldNormalRaw, [0, 1, 0]);

    return {
      worldPosition,
      worldAnchor,
      worldNormal,
      worldRadius,
      strength: clamp(strength, 0, 2),
      glowColor: [glowColor[0], glowColor[1], glowColor[2]],
    };
  }

  private resolvePinIndex(pin: OpenGLPinHandle | null): number | null {
    if (!pin || typeof pin !== 'object') return null;
    const idx = Number((pin as OpenGLPinHandle).__openglPinIndex);
    if (!Number.isInteger(idx)) return null;
    if (idx < 0 || idx >= this.pins.length) return null;
    return idx;
  }

  private createPinHandle(index: number): OpenGLPinHandle {
    return {
      __openglPinIndex: index,
      getWorldPosition: (target?: { set?: (x: number, y: number, z: number) => any }) => {
        const pin = this.pins[index];
        if (!pin) return target ?? { x: 0, y: 0, z: 0 };

        const localPos: Vec3 = [
          pin.baseSurfacePoint[0] + pin.outwardNormal[0] * pin.currentLift,
          pin.baseSurfacePoint[1] + pin.outwardNormal[1] * pin.currentLift,
          pin.baseSurfacePoint[2] + pin.outwardNormal[2] * pin.currentLift,
        ];
        const worldPos = transformPointMat4(this.pinLayerModelMatrix, localPos);

        if (target?.set) return target.set(worldPos[0], worldPos[1], worldPos[2]);
        return { x: worldPos[0], y: worldPos[1], z: worldPos[2] };
      },
    };
  }

  // --- HOVER PREVIEW HELPERS ---

  private _emitHoverEvent(event: PinHoverEvent | null): void {
    if (this.onHoverCallback) this.onHoverCallback(event);
    // Al limpiar el hover individual también limpiamos el de cluster
    if (event === null && this.onClusterHoverCallback) this.onClusterHoverCallback(null);
  }

  /** Emite null para ambos callbacks sin recursión */
  private _emitBothHoverNull(): void {
    if (this.onHoverCallback) this.onHoverCallback(null);
    if (this.onClusterHoverCallback) this.onClusterHoverCallback(null);
  }

  private _emitHoverEventForPin(pinIndex: number, params: OpenGLPinInteractionParams): void {
    if (pinIndex < 0 || pinIndex >= this.pins.length) return;
    const pin = this.pins[pinIndex];
    const screenPos = this._projectPinToScreen(pin, params);
    if (!screenPos) return;

    if (pin.kind === 'cluster') {
      // Cluster: emitir evento de cluster y limpiar hover individual
      if (this.onClusterHoverCallback) {
        const products = pin.memberLocations?.map(l => l.product).filter(Boolean) ?? [];
        this.onClusterHoverCallback({
          products,
          count: products.length,
          screenX: screenPos.x,
          screenY: screenPos.y,
        });
      }
      if (this.onHoverCallback) this.onHoverCallback(null);
    } else {
      // Pin individual: emitir evento de pin y limpiar hover de cluster
      if (this.onHoverCallback) {
        this.onHoverCallback({
          product: pin.location.product,
          screenX: screenPos.x,
          screenY: screenPos.y,
        });
      }
      if (this.onClusterHoverCallback) this.onClusterHoverCallback(null);
    }
  }

  private _projectPinToScreen(
    pin: OpenGLPinState,
    params: OpenGLPinInteractionParams
  ): { x: number; y: number } | null {
    // Actualizar siempre las dimensiones del viewport
    this.updateViewportSize();
    
    if (this.viewportWidth <= 0 || this.viewportHeight <= 0) {
      return null;
    }

    // Posición local del pin en el espacio del planeta
    const pinLocalPos: Vec3 = [
      pin.baseSurfacePoint[0] + pin.outwardNormal[0] * pin.currentLift,
      pin.baseSurfacePoint[1] + pin.outwardNormal[1] * pin.currentLift,
      pin.baseSurfacePoint[2] + pin.outwardNormal[2] * pin.currentLift,
    ];

    // Transformar al espacio mundial
    const pinWorldPos = transformPointMat4(this.pinLayerModelMatrix, pinLocalPos);

    // Proyectar al espacio NDC (normalized device coordinates)
    const viewProj = multiplyMat4(params.projectionMatrix, params.viewMatrix);
    const pinClipSpace = transformVec4(viewProj, [pinWorldPos[0], pinWorldPos[1], pinWorldPos[2], 1]);

    if (Math.abs(pinClipSpace[3]) < 1e-6) return null;

    const pinNdc = {
      x: pinClipSpace[0] / pinClipSpace[3],
      y: pinClipSpace[1] / pinClipSpace[3],
    };

    // Convertir de NDC a pantalla
    const screenX = ((pinNdc.x + 1) / 2) * this.viewportWidth;
    const screenY = ((1 - pinNdc.y) / 2) * this.viewportHeight;

    return { x: screenX, y: screenY };
  }

  private raycastPlanet(
    origin: Vec3,
    dir: Vec3
  ): { point: Vec3; normal: Vec3 } | null {
    if (!this.planetGeometry) return null;

    const geom = this.planetGeometry;
    const stride = geom.stride / 4;
    const positions = geom.vertices;
    const hasIndices = !!geom.indices;
    const triCount = hasIndices
      ? geom.indices!.length / 3
      : positions.length / stride / 3;

    let closestT = Number.POSITIVE_INFINITY;
    let hit: { point: Vec3; normal: Vec3 } | null = null;

    const ox = origin[0];
    const oy = origin[1];
    const oz = origin[2];
    const dx = dir[0];
    const dy = dir[1];
    const dz = dir[2];

    const getPos = (i: number): Vec3 => {
      const idx = hasIndices ? geom.indices![i] : i;
      const base = idx * stride;
      return [
        positions[base + 0],
        positions[base + 1],
        positions[base + 2],
      ];
    };

    for (let t = 0; t < triCount; t++) {
      const i0 = t * 3;
      const i1 = t * 3 + 1;
      const i2 = t * 3 + 2;
      const v0 = getPos(i0);
      const v1 = getPos(i1);
      const v2 = getPos(i2);

      const e1x = v1[0] - v0[0];
      const e1y = v1[1] - v0[1];
      const e1z = v1[2] - v0[2];
      const e2x = v2[0] - v0[0];
      const e2y = v2[1] - v0[1];
      const e2z = v2[2] - v0[2];

      const px = dy * e2z - dz * e2y;
      const py = dz * e2x - dx * e2z;
      const pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-8) continue;
      const invDet = 1 / det;

      const tx = ox - v0[0];
      const ty = oy - v0[1];
      const tz = oz - v0[2];
      const u = (tx * px + ty * py + tz * pz) * invDet;
      if (u < 0 || u > 1) continue;

      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * invDet;
      if (v < 0 || u + v > 1) continue;

      const tHit = (e2x * qx + e2y * qy + e2z * qz) * invDet;
      if (tHit <= 1e-6 || tHit >= closestT) continue;

      closestT = tHit;
      const hitX = ox + dx * tHit;
      const hitY = oy + dy * tHit;
      const hitZ = oz + dz * tHit;

      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const nlen = Math.hypot(nx, ny, nz) || 1;
      hit = {
        point: [hitX, hitY, hitZ],
        normal: [nx / nlen, ny / nlen, nz / nlen],
      };
    }

    return hit;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function nearlyEqual(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon;
}

function extractUniformScale(mat: Float32Array): number {
  const sx = Math.hypot(mat[0], mat[1], mat[2]);
  const sy = Math.hypot(mat[4], mat[5], mat[6]);
  const sz = Math.hypot(mat[8], mat[9], mat[10]);
  return (sx + sy + sz) / 3 || 1;
}

function transformVec4(
  mat: Float32Array,
  v: [number, number, number, number]
): [number, number, number, number] {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const w = v[3];
  return [
    mat[0] * x + mat[4] * y + mat[8] * z + mat[12] * w,
    mat[1] * x + mat[5] * y + mat[9] * z + mat[13] * w,
    mat[2] * x + mat[6] * y + mat[10] * z + mat[14] * w,
    mat[3] * x + mat[7] * y + mat[11] * z + mat[15] * w,
  ];
}

function transformDirMat4(mat: Float32Array, dir: Vec3): Vec3 {
  const x = dir[0];
  const y = dir[1];
  const z = dir[2];
  return [
    mat[0] * x + mat[4] * y + mat[8] * z,
    mat[1] * x + mat[5] * y + mat[9] * z,
    mat[2] * x + mat[6] * y + mat[10] * z,
  ];
}

function normalizeSafe(v: Vec3, fallback: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len <= 1e-8) return [...fallback] as Vec3;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function raycastGeometryPoint(geometry: Geometry, origin: Vec3, dir: Vec3): Vec3 | null {
  const stride = geometry.stride / 4;
  const positions = geometry.vertices;
  const hasIndices = !!geometry.indices;
  const triCount = hasIndices
    ? geometry.indices!.length / 3
    : positions.length / stride / 3;

  let closestT = Number.POSITIVE_INFINITY;
  let hitPoint: Vec3 | null = null;

  const ox = origin[0];
  const oy = origin[1];
  const oz = origin[2];
  const dx = dir[0];
  const dy = dir[1];
  const dz = dir[2];

  const getPos = (i: number): Vec3 => {
    const idx = hasIndices ? geometry.indices![i] : i;
    const base = idx * stride;
    return [positions[base + 0], positions[base + 1], positions[base + 2]];
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const i1 = t * 3 + 1;
    const i2 = t * 3 + 2;
    const v0 = getPos(i0);
    const v1 = getPos(i1);
    const v2 = getPos(i2);

    const e1x = v1[0] - v0[0];
    const e1y = v1[1] - v0[1];
    const e1z = v1[2] - v0[2];
    const e2x = v2[0] - v0[0];
    const e2y = v2[1] - v0[1];
    const e2z = v2[2] - v0[2];

    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-8) continue;
    const invDet = 1 / det;

    const tx = ox - v0[0];
    const ty = oy - v0[1];
    const tz = oz - v0[2];
    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < 0 || u > 1) continue;

    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < 0 || u + v > 1) continue;

    const tHit = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    if (tHit <= 1e-6 || tHit >= closestT) continue;

    closestT = tHit;
    hitPoint = [ox + dx * tHit, oy + dy * tHit, oz + dz * tHit];
  }

  return hitPoint;
}

function intersectRaySphere(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  radius: number
): number | null {
  const ocX = origin[0] - center[0];
  const ocY = origin[1] - center[1];
  const ocZ = origin[2] - center[2];

  const b = ocX * dir[0] + ocY * dir[1] + ocZ * dir[2];
  const c = ocX * ocX + ocY * ocY + ocZ * ocZ - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t0 = -b - sqrtDisc;
  const t1 = -b + sqrtDisc;

  if (t0 > 1e-6) return t0;
  if (t1 > 1e-6) return t1;
  return null;
}

function invertMat4(m: Float32Array): Float32Array | null {
  const out = new Float32Array(16);

  const a00 = m[0];
  const a01 = m[1];
  const a02 = m[2];
  const a03 = m[3];
  const a10 = m[4];
  const a11 = m[5];
  const a12 = m[6];
  const a13 = m[7];
  const a20 = m[8];
  const a21 = m[9];
  const a22 = m[10];
  const a23 = m[11];
  const a30 = m[12];
  const a31 = m[13];
  const a32 = m[14];
  const a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det =
    b00 * b11 -
    b01 * b10 +
    b02 * b09 +
    b03 * b08 -
    b04 * b07 +
    b05 * b06;
  if (Math.abs(det) < 1e-10) return null;
  det = 1 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

  return out;
}
