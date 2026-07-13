import { CityLabel, CITY_LABELS } from '../../../data/city-labels';
import { UtilsGeo } from '../../utils-geo';
import { Geometry } from '../geometry/geometry';
import {
  identityMat4,
  normalizeVec3,
  orientNormalOutward,
  transformPointMat4,
  Vec3,
} from '../math/opengl-math';

interface TierConfig {
  showDistance: number;
  hideDistance?: number;
  fadeInSpeed: number;
  fadeOutSpeed: number;
  scale: number;
  color: string;
  maxOpacity: number;
}

const TIER_CONFIG: Record<number, TierConfig> = {
  0: { showDistance: 92, hideDistance: 86, fadeInSpeed: 0.05, fadeOutSpeed: 0.09, scale: 0.26, color: '#F0F0F0', maxOpacity: 0.68 },
  1: { showDistance: 999, hideDistance: 92, fadeInSpeed: 0.06, fadeOutSpeed: 0.1, scale: 0.55, color: '#FFFFFF', maxOpacity: 1.0 },
  2: { showDistance: 86, fadeInSpeed: 0.05, fadeOutSpeed: 0.08, scale: 0.23, color: '#E0E0E0', maxOpacity: 0.65 },
  3: { showDistance: 86, fadeInSpeed: 0.04, fadeOutSpeed: 0.08, scale: 0.18, color: '#C0C0C0', maxOpacity: 0.6 },
  4: { showDistance: 72, fadeInSpeed: 0.03, fadeOutSpeed: 0.06, scale: 0.14, color: '#A0A0A0', maxOpacity: 0.55 },
};

const PLANET_SCALE = 80;
const LABEL_SURFACE_OFFSET_LOCAL_RATIO = 0.15 / PLANET_SCALE;
const LABEL_SIZE_FACTOR_BY_TIER: Record<number, number> = {
  0: 0.5,
  1: 0.42,
  2: 0.54,
  3: 0.54,
  4: 0.42,
};

interface LabelEntry {
  element: HTMLCanvasElement;
  data: CityLabel;
  localPos: Vec3;
  currentOpacity: number;
  targetOpacity: number;
  currentScale: number;
  targetScale: number;
  aspect: number;
}

export interface OpenGLCityLabelUpdateParams {
  zoomDistance: number;
  viewMatrix: Float32Array;
  projectionMatrix: Float32Array;
}

export class OpenGLCityLabelManager {
  private labels: LabelEntry[] = [];
  private readonly overlay: HTMLDivElement;

  private planetModelMatrix: Float32Array = identityMat4();
  private planetGeometry: Geometry | null = null;
  private planetRawRadius = 1;
  private planetRawCenter: Vec3 = [0, 0, 0];
  private planetScale = 1;
  private hasPlanetGeometry = false;
  private time = 0;
  private comunidadesThreshold = Number.POSITIVE_INFINITY;
  private provinciasThreshold = Number.POSITIVE_INFINITY;

  constructor(private readonly container: HTMLElement, cities?: CityLabel[]) {
    const containerStyle = window.getComputedStyle(this.container);
    if (containerStyle.position === 'static') {
      this.container.style.position = 'relative';
    }

    this.overlay = this.createOverlay();
    this.container.appendChild(this.overlay);
    this.createLabels(cities ?? CITY_LABELS);
  }

  setPlanetGeometry(
    planetGeometry: Geometry,
    planetRawRadius: number,
    planetRawCenter: Vec3,
    planetScale: number
  ): void {
    this.planetGeometry = planetGeometry;
    this.planetRawRadius = Math.max(planetRawRadius, 1e-6);
    this.planetRawCenter = [...planetRawCenter];
    this.planetScale = Math.max(Math.abs(planetScale), 1e-6);
    this.hasPlanetGeometry = true;
    this.rebuildLocalPositions();
  }

  clearPlanetGeometry(): void {
    this.planetGeometry = null;
    this.hasPlanetGeometry = false;
    this.hideAllLabels();
  }

  setVisibilityThresholds(comunidadesThreshold: number, provinciasThreshold: number): void {
    this.comunidadesThreshold = comunidadesThreshold;
    this.provinciasThreshold = provinciasThreshold;
  }

  clearVisibilityThresholds(): void {
    this.comunidadesThreshold = Number.POSITIVE_INFINITY;
    this.provinciasThreshold = Number.POSITIVE_INFINITY;
  }

  setPlanetModelMatrix(modelMatrix: Float32Array): void {
    this.planetModelMatrix = new Float32Array(modelMatrix);
  }

  update(params: OpenGLCityLabelUpdateParams): void {
    if (!this.hasPlanetGeometry) {
      this.hideAllLabels();
      return;
    }

    const rect = this.overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const scaledPlanetRadius = this.getScaledPlanetRadius();
    const projY = params.projectionMatrix[5];
    this.time += 0.016;

    for (const entry of this.labels) {
      const config = TIER_CONFIG[entry.data.tier] ?? TIER_CONFIG[4];
      const tierSizeFactor = LABEL_SIZE_FACTOR_BY_TIER[entry.data.tier] ?? 1.0;
      const shouldShow = this.shouldShowLabel(entry.data.tier, params.zoomDistance, config);

      entry.targetOpacity = shouldShow ? config.maxOpacity : 0;
      entry.targetScale = shouldShow ? 1.0 : 0.7;

      const speed = entry.targetOpacity > entry.currentOpacity
        ? config.fadeInSpeed
        : config.fadeOutSpeed;

      entry.currentOpacity += (entry.targetOpacity - entry.currentOpacity) * speed;
      entry.currentOpacity = clamp(entry.currentOpacity, 0, config.maxOpacity);

      const scaleSpeed = speed * 1.5;
      entry.currentScale += (entry.targetScale - entry.currentScale) * scaleSpeed;
      entry.currentScale = clamp(entry.currentScale, 0.7, 1.0);

      const isVisible = entry.currentOpacity > 0.01;
      if (!isVisible) {
        this.hideLabel(entry);
        continue;
      }

      const projected = this.projectToScreen(
        entry.localPos,
        params.viewMatrix,
        params.projectionMatrix,
        rect.width,
        rect.height
      );
      if (!projected) {
        this.hideLabel(entry);
        continue;
      }

      let finalScale = entry.currentScale;
      if (entry.data.tier === 1 && entry.currentOpacity > 0.8) {
        const pulse = 1.0 + Math.sin(this.time * 2.0) * 0.03;
        finalScale *= pulse;
      }

      // `config.scale` está calibrado para el mundo Three (PLANET_RADIUS = 80).
      // Lo convertimos proporcionalmente al radio real del planeta en OpenGL.
      const worldHeight =
        (config.scale / PLANET_SCALE) *
        scaledPlanetRadius *
        finalScale *
        tierSizeFactor;
      const pixelHeight = (worldHeight * projY * rect.height * 0.5) / projected.depth;
      const pixelWidth = pixelHeight * entry.aspect;

      if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelHeight <= 0.5) {
        this.hideLabel(entry);
        continue;
      }

      entry.element.style.display = 'block';
      entry.element.style.opacity = `${entry.currentOpacity}`;
      entry.element.style.left = `${projected.x}px`;
      entry.element.style.top = `${projected.y}px`;
      entry.element.style.width = `${pixelWidth}px`;
      entry.element.style.height = `${pixelHeight}px`;
    }
  }

  dispose(): void {
    this.labels.forEach((entry) => entry.element.remove());
    this.labels = [];
    this.overlay.remove();
  }

  private createOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.overflow = 'hidden';
    overlay.style.pointerEvents = 'none';
    overlay.style.userSelect = 'none';
    overlay.style.touchAction = 'none';
    overlay.style.zIndex = '3';
    return overlay;
  }

  private createLabels(cities: CityLabel[]): void {
    for (const city of cities) {
      const config = TIER_CONFIG[city.tier] ?? TIER_CONFIG[4];
      const canvas = this.createTextCanvas(city.name, config.color);
      canvas.style.position = 'absolute';
      canvas.style.transform = 'translate(-50%, -50%)';
      canvas.style.opacity = '0';
      canvas.style.display = 'none';
      canvas.style.willChange = 'left, top, width, height, opacity';
      this.overlay.appendChild(canvas);

      this.labels.push({
        element: canvas,
        data: city,
        localPos: [0, 0, 0],
        currentOpacity: 0,
        targetOpacity: 0,
        currentScale: 0.7,
        targetScale: 1.0,
        aspect: canvas.width / Math.max(canvas.height, 1),
      });
    }
  }

  private rebuildLocalPositions(): void {
    const radius = Math.max(this.planetRawRadius, 1e-6);
    const center = this.planetRawCenter;
    const lift = radius * LABEL_SURFACE_OFFSET_LOCAL_RATIO;

    for (const entry of this.labels) {
      const dirUnit = normalizeVec3(UtilsGeo.latLonToVec3Plain(entry.data.lat, entry.data.lon, 1));
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

      entry.localPos = [
        surfacePoint[0] + outwardNormal[0] * lift,
        surfacePoint[1] + outwardNormal[1] * lift,
        surfacePoint[2] + outwardNormal[2] * lift,
      ];
    }
  }

  private createTextCanvas(text: string, color: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const fontSize = 64;
    const padding = 24;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const font = `600 ${fontSize}px 'Plus Jakarta Sans', 'Inter', 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    const extCtx = ctx as CanvasRenderingContext2D & { letterSpacing?: string };

    ctx.font = font;
    extCtx.letterSpacing = '0.5px';
    const textWidth = ctx.measureText(text).width;

    const logicalWidth = Math.ceil(textWidth + padding * 2);
    const logicalHeight = Math.ceil(fontSize * 1.4 + padding * 2);
    canvas.width = Math.ceil(logicalWidth * dpr);
    canvas.height = Math.ceil(logicalHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = logicalWidth;
    const h = logicalHeight;
    const centerX = w / 2;
    const centerY = h / 2;

    ctx.font = font;
    extCtx.letterSpacing = '0.5px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillText(text, centerX, centerY + 1);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(0, 0, 0, ${0.7 - i * 0.15})`;
      ctx.lineWidth = 7 - i * 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeText(text, centerX, centerY);
    }

    const gradient = ctx.createLinearGradient(0, centerY - fontSize / 2, 0, centerY + fontSize / 2);
    gradient.addColorStop(0, this.lightenColor(color, 1.08));
    gradient.addColorStop(0.4, color);
    gradient.addColorStop(0.7, color);
    gradient.addColorStop(1, this.darkenColor(color, 0.82));

    ctx.fillStyle = gradient;
    ctx.fillText(text, centerX, centerY);

    const highlightGradient = ctx.createLinearGradient(0, centerY - fontSize / 2, 0, centerY);
    highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.30)');
    highlightGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.12)');
    highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = highlightGradient;
    ctx.fillText(text, centerX, centerY - 0.5);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 0.8;
    ctx.strokeText(text, centerX, centerY);

    return canvas;
  }

  private darkenColor(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`;
  }

  private lightenColor(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const newR = Math.min(255, Math.floor(r * factor));
    const newG = Math.min(255, Math.floor(g * factor));
    const newB = Math.min(255, Math.floor(b * factor));
    return `rgb(${newR}, ${newG}, ${newB})`;
  }

  private getScaledPlanetRadius(): number {
    return Math.max(this.planetRawRadius * this.planetScale, 1e-6);
  }

  private toThreeScaleDistance(zoomDistance: number): number {
    const scaledRadius = this.getScaledPlanetRadius();
    return (zoomDistance / scaledRadius) * PLANET_SCALE;
  }

  private shouldShowLabel(tier: number, zoomDistance: number, config: TierConfig): boolean {
    const hasLayerThresholds = Number.isFinite(this.comunidadesThreshold) && Number.isFinite(this.provinciasThreshold);
    if (hasLayerThresholds) {
      const comunidades = this.comunidadesThreshold;
      const provincias = Math.min(this.provinciasThreshold, comunidades - 1e-6);
      if (tier === 1) return zoomDistance > comunidades;
      if (tier === 0) return zoomDistance <= comunidades && zoomDistance > provincias;
      if (tier === 2) return zoomDistance <= provincias;
      if (tier === 3) return zoomDistance <= provincias;
      return false; // En OpenGL seguimos la secuencia: capitales -> comunidades -> provincias.
    }

    const zoomDistanceThreeScale = this.toThreeScaleDistance(zoomDistance);
    if (config.hideDistance !== undefined) {
      return zoomDistanceThreeScale >= config.hideDistance && zoomDistanceThreeScale < config.showDistance;
    }
    return zoomDistanceThreeScale < config.showDistance;
  }

  private projectToScreen(
    localPos: Vec3,
    viewMatrix: Float32Array,
    projectionMatrix: Float32Array,
    viewportWidth: number,
    viewportHeight: number
  ): { x: number; y: number; depth: number } | null {
    const worldPos = transformPointMat4(this.planetModelMatrix, localPos);
    const viewPos = transformVec4(viewMatrix, [worldPos[0], worldPos[1], worldPos[2], 1]);
    const depth = -viewPos[2];
    if (depth <= 1e-6) return null;

    const clipPos = transformVec4(projectionMatrix, viewPos);
    if (Math.abs(clipPos[3]) <= 1e-8) return null;

    const invW = 1 / clipPos[3];
    const ndcX = clipPos[0] * invW;
    const ndcY = clipPos[1] * invW;
    if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return null;

    return {
      x: (ndcX * 0.5 + 0.5) * viewportWidth,
      y: (1 - (ndcY * 0.5 + 0.5)) * viewportHeight,
      depth,
    };
  }

  private hideLabel(entry: LabelEntry): void {
    entry.element.style.display = 'none';
  }

  private hideAllLabels(): void {
    for (const entry of this.labels) {
      this.hideLabel(entry);
    }
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
