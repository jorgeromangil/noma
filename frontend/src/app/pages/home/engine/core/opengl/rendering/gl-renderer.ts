// Minimal WebGL2 bootstrap used by the OpenGL-based engine.
// Los shaders se cargan como recursos externos para desacoplar código TS y GLSL.

import { ShaderProgram } from './shader-program';
import { Mesh } from './mesh';
import { createColoredSphere, Geometry } from '../geometry/geometry';
import { TGestorRecursos, TRecursoShader, TSharedPtr } from '../resources/resource-manager';

type GlObjects = {
  program: ShaderProgram;
  baseMesh: Mesh | null;
  mapLayers: Map<string, Mesh>;
  mapLayerOpacity: Map<string, number>;
  pinMeshes: Mesh[];
};

export interface GlPinHighlightSample {
  worldPosition: [number, number, number] | Float32Array;
  worldAnchor: [number, number, number] | Float32Array;
  worldNormal: [number, number, number] | Float32Array;
  worldRadius: number;
  strength: number;
  glowColor: [number, number, number] | Float32Array;
}

export interface GlPinHighlightState {
  hover: GlPinHighlightSample | null;
  active: GlPinHighlightSample | null;
}

export class GlRenderer {
  private static readonly BASIC_SHADER_KEY = 'shader:opengl:basic-phong-file-v1';
  private static readonly BASIC_VERTEX_SHADER_PATH = 'engine/opengl/shaders/basic.vert.glsl';
  private static readonly BASIC_FRAGMENT_SHADER_PATH = 'engine/opengl/shaders/basic.frag.glsl';

  private readonly resourceManager = TGestorRecursos.getInstancia();
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private objs: GlObjects | null = null;
  private shaderResourcePtr: TSharedPtr<TRecursoShader> | null = null;
  private resizeHandler: () => void;
  private viewMat: Float32Array = identity();
  private projMat: Float32Array = identity();
  private modelMat: Float32Array = identity();
  private cameraPos: Float32Array = new Float32Array([0, 0, 3]);
  private frameOpen = false;

  // Parámetros de iluminación por defecto
  private dir0Dir: Float32Array = new Float32Array([0.4, 0.7, 1.0]);
  private dir0Color: Float32Array = new Float32Array([1.02, 0.98, 0.94]);
  private dir1Dir: Float32Array = new Float32Array([-0.4, 0.2, -0.3]);
  private dir1Color: Float32Array = new Float32Array([0.28, 0.38, 0.52]); // fill tenue para preservar sombra
  private pointPos: Float32Array = new Float32Array([3.0, 3.0, 2.0]);
  private pointColor: Float32Array = new Float32Array([0.88, 0.72, 0.56]); // puntual cálida localizada
  private pointLinear = 0.14;
  private pointQuadratic = 0.07;
  private ambientColor: Float32Array = new Float32Array([0.055, 0.055, 0.06]);
  private hemiSky: Float32Array = new Float32Array([0.24, 0.31, 0.46]);
  private hemiGround: Float32Array = new Float32Array([0.21, 0.16, 0.13]);
  private hemiStrength = 0.09;
  private rimColor: Float32Array = new Float32Array([0.70, 0.82, 1.0]);
  private rimStrength = 0.1;
  private rimPower = 2.8;
  private specularStrength = 0.1;
  private shininess = 18.0;
  private pinBrightness = 0.7;
  private pinAmbientBoost = 0.86;
  private pinShadingMix = 0.56;
  private pinWrapDiffuse = 0.31;
  private pinRimBoost = 0.22;
  private pinSaturation = 0.68;
  private pinAOStrength = 0.0;
  private sceneExposure = 1.33;
  private readonly tmpPlanetCenter = new Float32Array(3);
  private readonly hoverPinPos = new Float32Array([0, 0, 0]);
  private readonly hoverPinAnchor = new Float32Array([0, 0, 0]);
  private readonly hoverPinNormal = new Float32Array([0, 1, 0]);
  private hoverPinRadius = 0.01;
  private hoverPinStrength = 0;
  private readonly activePinPos = new Float32Array([0, 0, 0]);
  private readonly activePinAnchor = new Float32Array([0, 0, 0]);
  private readonly activePinNormal = new Float32Array([0, 1, 0]);
  private activePinRadius = 0.01;
  private activePinStrength = 0;
  private readonly hoverPinGlowColor = new Float32Array([0.80, 0.92, 1.0]);
  private readonly activePinGlowColor = new Float32Array([0.80, 0.92, 1.0]);
  private pinUnderGlowGain = 0.55;
  private pinGroundGlowGain = 0.42;

  static async create(container: HTMLElement): Promise<GlRenderer> {
    const renderer = new GlRenderer(container);
    try {
      await renderer.initPipeline();
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  private constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';

    const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (!gl) throw new Error('WebGL2 no soportado por el navegador');
    this.gl = gl;

    if (this.container.childElementCount === 0) {
      this.container.appendChild(this.canvas);
    } else {
      this.container.innerHTML = '';
      this.container.appendChild(this.canvas);
    }

    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);
    this.onResize();
  }

  /**
   * Reemplaza la geometría actual manteniendo el mismo shader.
   */
  setGeometry(geometry: Geometry): void {
    if (!this.objs) return;
    this.objs.baseMesh?.destroy();
    this.objs.baseMesh = new Mesh(this.gl, geometry, this.objs.program);
  }

  /**
   * Reemplaza una capa de mapa identificada por `layerId`.
   * Sirve para comunidades/provincias con opacidad independiente.
   */
  setMapLayerGeometry(layerId: string, geometry: Geometry | null): void {
    if (!this.objs) return;
    const previous = this.objs.mapLayers.get(layerId);
    if (previous) previous.destroy();
    this.objs.mapLayers.delete(layerId);

    if (geometry) {
      this.objs.mapLayers.set(layerId, new Mesh(this.gl, geometry, this.objs.program));
      if (!this.objs.mapLayerOpacity.has(layerId)) this.objs.mapLayerOpacity.set(layerId, 0);
    } else {
      this.objs.mapLayerOpacity.delete(layerId);
    }
  }

  setMapLayerOpacity(layerId: string, opacity: number): void {
    if (!this.objs) return;
    if (!this.objs.mapLayers.has(layerId)) return;
    this.objs.mapLayerOpacity.set(layerId, clamp(opacity, 0, 1));
  }

  /**
   * Define un conjunto de geometrías adicionales que se renderizan con la
   * misma matriz de modelo (p.ej. pines sobre el planeta).
   */
  setOverlayGeometries(geometries: Geometry[]): void {
    if (!this.objs) return;
    this.objs.pinMeshes.forEach((m) => m.destroy());
    this.objs.pinMeshes = geometries.map((g) => new Mesh(this.gl, g, this.objs!.program));
  }

  getDomElement(): HTMLCanvasElement {
    return this.canvas;
  }

  setCamera(viewMatrix: Float32Array, projMatrix?: Float32Array, cameraPos?: [number, number, number]): void {
    this.viewMat = viewMatrix;
    if (projMatrix) this.projMat = projMatrix;
    if (cameraPos) this.cameraPos.set(cameraPos);
  }

  setModel(modelMatrix: Float32Array): void {
    this.modelMat = modelMatrix;
  }

  setLightDirection(dir: [number, number, number]): void {
    this.dir0Dir.set(dir);
  }

  setLightColor(color: [number, number, number]): void {
    this.dir0Color.set(color);
  }

  setAmbient(color: [number, number, number]): void {
    this.ambientColor.set(color);
  }

  setHemiAmbient(sky: [number, number, number], ground: [number, number, number], strength: number): void {
    this.hemiSky.set(sky);
    this.hemiGround.set(ground);
    this.hemiStrength = strength;
  }

  setRimLight(color: [number, number, number], strength: number, power: number): void {
    this.rimColor.set(color);
    this.rimStrength = strength;
    this.rimPower = power;
  }

  setFillLight(direction: [number, number, number], color: [number, number, number]): void {
    this.dir1Dir.set(direction);
    this.dir1Color.set(color);
  }

  setPointLight(pos: [number, number, number], color: [number, number, number], linear = 0.05, quadratic = 0.012): void {
    this.pointPos.set(pos);
    this.pointColor.set(color);
    this.pointLinear = linear;
    this.pointQuadratic = quadratic;
  }

  setSpecular(strength: number, shininess: number): void {
    this.specularStrength = strength;
    this.shininess = shininess;
  }

  setSceneExposure(exposure: number): void {
    this.sceneExposure = clamp(exposure, 0.6, 1.8);
  }

  setPinHighlightState(state: GlPinHighlightState | null): void {
    const hover = state?.hover ?? null;
    const active = state?.active ?? null;

    this.copyHighlightSample(
      hover,
      this.hoverPinPos,
      this.hoverPinAnchor,
      this.hoverPinNormal,
      this.hoverPinGlowColor,
      (radius, strength) => {
        this.hoverPinRadius = radius;
        this.hoverPinStrength = strength;
      }
    );
    this.copyHighlightSample(
      active,
      this.activePinPos,
      this.activePinAnchor,
      this.activePinNormal,
      this.activePinGlowColor,
      (radius, strength) => {
        this.activePinRadius = radius;
        this.activePinStrength = strength;
      }
    );
  }

  clearGeometry(): void {
    if (this.objs) {
      this.objs.baseMesh?.destroy();
      this.objs.mapLayers.forEach((m) => m.destroy());
      this.objs.pinMeshes.forEach((m) => m.destroy());
      this.objs.program.destroy();
      this.objs = null;
    }
    this.shaderResourcePtr?.release();
    this.shaderResourcePtr = null;
  }

  // Limpia el frame actual y deja el pipeline listo para dibujado por nodos.
  beginFrame(): boolean {
    const gl = this.gl;
    if (!this.objs || !this.objs.baseMesh) return false;

    this.syncCanvasResolution();
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.0, 0.0, 0.0, 1.0); // fondo negro
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.objs.program.use();
    this.frameOpen = true;
    return true;
  }

  endFrame(): void {
    this.frameOpen = false;
  }

  drawBaseLayer(modelMatrix: Float32Array): void {
    if (!this.frameOpen || !this.objs) return;
    const baseMesh = this.objs.baseMesh;
    if (!baseMesh) return;
    this.drawMeshes([baseMesh], modelMatrix, { isPinOverlay: false, opacity: 1.0 });
  }

  drawMapLayer(modelMatrix: Float32Array, layerId: string): void {
    if (!this.frameOpen || !this.objs) return;
    const mesh = this.objs.mapLayers.get(layerId);
    if (!mesh) return;
    const opacity = this.objs.mapLayerOpacity.get(layerId) ?? 0;
    if (opacity <= 0.001) return;
    this.drawMeshes([mesh], modelMatrix, {
      isPinOverlay: false,
      opacity,
      transparent: opacity < 0.999,
    });
  }

  drawOverlayLayer(modelMatrix: Float32Array, opacity: number = 1.0): void {
    if (!this.frameOpen || !this.objs) return;
    const overlays = this.objs.pinMeshes;
    if (overlays.length === 0) return;
    const clampedOpacity = clamp(opacity, 0, 1);
    if (clampedOpacity <= 0.001) return;
    this.drawMeshes(overlays, modelMatrix, { isPinOverlay: true, opacity: clampedOpacity });
  }

  // Compatibilidad con el flujo previo: dibuja base + overlays con el mismo modelo.
  render(): void {
    const frameReady = this.beginFrame();
    if (!frameReady) return;
    this.drawBaseLayer(this.modelMat);
    if (this.objs) {
      for (const layerId of this.objs.mapLayers.keys()) {
        this.drawMapLayer(this.modelMat, layerId);
      }
    }
    this.drawOverlayLayer(this.modelMat, 1.0);
    this.endFrame();
  }

  destroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
    if (this.objs) {
      this.objs.baseMesh?.destroy();
      this.objs.mapLayers.forEach((m) => m.destroy());
      this.objs.pinMeshes.forEach((m) => m.destroy());
      this.objs.program.destroy();
      this.objs = null;
    }
    this.shaderResourcePtr?.release();
    this.shaderResourcePtr = null;
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }

  private onResize(): void {
    this.syncCanvasResolution();
  }

  private syncCanvasResolution(): void {
    let cssWidth = Math.floor(this.container.clientWidth);
    let cssHeight = Math.floor(this.container.clientHeight);
    if (cssWidth <= 0 || cssHeight <= 0) {
      cssWidth = window.innerWidth || 800;
      cssHeight = window.innerHeight || 600;
    }

    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const bufferWidth = Math.max(1, Math.round(cssWidth * dpr));
    const bufferHeight = Math.max(1, Math.round(cssHeight * dpr));

    if (this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight) {
      this.canvas.width = bufferWidth;
      this.canvas.height = bufferHeight;
    }

    if (this.canvas.style.width !== `${cssWidth}px`) this.canvas.style.width = `${cssWidth}px`;
    if (this.canvas.style.height !== `${cssHeight}px`) this.canvas.style.height = `${cssHeight}px`;

    this.projMat = perspective((60 * Math.PI) / 180, cssWidth / cssHeight, 0.1, 100.0);
  }

  private async initPipeline(): Promise<void> {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE); // evitamos ocultar el quad de prueba

    this.shaderResourcePtr = await this.resourceManager.cargarShaderDesdeUrl(
      GlRenderer.BASIC_SHADER_KEY,
      resolvePublicAssetUrl(GlRenderer.BASIC_VERTEX_SHADER_PATH),
      resolvePublicAssetUrl(GlRenderer.BASIC_FRAGMENT_SHADER_PATH)
    );
    const shader = this.shaderResourcePtr.get().obtenerShader();
    const program = new ShaderProgram(gl, shader.vertexSource, shader.fragmentSource);
    // Cambia aquí la primitiva: esfera coloreada o quad.
    const geometry = createColoredSphere(1.0, 24, 32);
    const mesh = new Mesh(gl, geometry, program);
    this.viewMat = lookAt([0, 0, 3], [0, 0, 0], [0, 1, 0]);
    this.modelMat = identity();
    this.cameraPos = new Float32Array([0, 0, 3]);
    this.objs = {
      program,
      baseMesh: mesh,
      mapLayers: new Map(),
      mapLayerOpacity: new Map(),
      pinMeshes: [],
    };
  }

  private copyHighlightSample(
    sample: GlPinHighlightSample | null,
    pos: Float32Array,
    anchor: Float32Array,
    normal: Float32Array,
    glowColor: Float32Array,
    setScalars: (radius: number, strength: number) => void
  ): void {
    if (!sample) {
      setScalars(0.01, 0);
      return;
    }

    pos.set(sample.worldPosition);
    anchor.set(sample.worldAnchor);
    normal.set(sample.worldNormal);
    glowColor.set(sample.glowColor);
    setScalars(
      Math.max(sample.worldRadius || 0.01, 1e-4),
      clamp(sample.strength || 0, 0, 2)
    );
  }

  private drawMeshes(
    meshes: Mesh[],
    modelMatrix: Float32Array,
    options: { isPinOverlay: boolean; opacity: number; transparent?: boolean }
  ): void {
    if (!this.objs || meshes.length === 0) return;

    const program = this.objs.program;
    const opacity = clamp(options.opacity, 0, 1);
    const transparent = options.transparent ?? opacity < 0.999;
    const pinOverlayWithTextures =
      options.isPinOverlay && meshes.some((mesh) => mesh.hasBaseColorTexture());
    const useBlend = transparent || pinOverlayWithTextures;
    const keepDepthWrite = options.isPinOverlay;
    const isPinOverlay = options.isPinOverlay;
    const specularStrength = isPinOverlay ? this.specularStrength * 0.74 : this.specularStrength;
    const shininess = isPinOverlay ? Math.max(this.shininess * 1.2, 14.0) : this.shininess;

    this.tmpPlanetCenter[0] = modelMatrix[12];
    this.tmpPlanetCenter[1] = modelMatrix[13];
    this.tmpPlanetCenter[2] = modelMatrix[14];

    program.use();
    program.setMat4('uModel', modelMatrix);
    program.setMat4('uView', this.viewMat);
    program.setMat4('uProj', this.projMat);
    program.setVec3('uDir0Dir', this.dir0Dir);
    program.setVec3('uDir0Color', this.dir0Color);
    program.setVec3('uDir1Dir', this.dir1Dir);
    program.setVec3('uDir1Color', this.dir1Color);
    program.setVec3('uPointPos', this.pointPos);
    program.setVec3('uPointColor', this.pointColor);
    program.setFloat('uPointLinear', this.pointLinear);
    program.setFloat('uPointQuadratic', this.pointQuadratic);
    program.setVec3('uAmbient', this.ambientColor);
    program.setVec3('uHemiSky', this.hemiSky);
    program.setVec3('uHemiGround', this.hemiGround);
    program.setFloat('uHemiStrength', this.hemiStrength);
    program.setVec3('uRimColor', this.rimColor);
    program.setFloat('uRimStrength', this.rimStrength);
    program.setFloat('uRimPower', this.rimPower);
    program.setVec3('uPlanetCenter', this.tmpPlanetCenter);
    program.setVec3('uCameraPos', this.cameraPos);
    program.setFloat('uSpecularStrength', specularStrength);
    program.setFloat('uShininess', shininess);
    program.setFloat('uUsePinGamma', isPinOverlay ? 1.0 : 0.0);
    program.setFloat('uPinAmbientBoost', isPinOverlay ? this.pinAmbientBoost : 1.0);
    program.setFloat('uPinShadingMix', isPinOverlay ? this.pinShadingMix : 1.0);
    program.setFloat('uPinBrightness', isPinOverlay ? this.pinBrightness : 1.0);
    program.setFloat('uPinWrapDiffuse', isPinOverlay ? this.pinWrapDiffuse : 0.0);
    program.setFloat('uPinRimBoost', isPinOverlay ? this.pinRimBoost : 1.0);
    program.setFloat('uPinSaturation', isPinOverlay ? this.pinSaturation : 1.0);
    program.setFloat('uPinAOStrength', isPinOverlay ? this.pinAOStrength : 0.0);
    program.setFloat('uSceneExposure', isPinOverlay ? 1.0 : this.sceneExposure);
    program.setVec3('uHoverPinPos', this.hoverPinPos);
    program.setVec3('uHoverPinAnchor', this.hoverPinAnchor);
    program.setVec3('uHoverPinNormal', this.hoverPinNormal);
    program.setFloat('uHoverPinRadius', this.hoverPinRadius);
    program.setFloat('uHoverPinStrength', this.hoverPinStrength);
    program.setVec3('uActivePinPos', this.activePinPos);
    program.setVec3('uActivePinAnchor', this.activePinAnchor);
    program.setVec3('uActivePinNormal', this.activePinNormal);
    program.setFloat('uActivePinRadius', this.activePinRadius);
    program.setFloat('uActivePinStrength', this.activePinStrength);
    program.setVec3('uHoverPinGlowColor', this.hoverPinGlowColor);
    program.setVec3('uActivePinGlowColor', this.activePinGlowColor);
    program.setFloat('uPinUnderGlowGain', this.pinUnderGlowGain);
    program.setFloat('uPinGroundGlowGain', this.pinGroundGlowGain);
    program.setFloat('uOpacity', opacity);

    if (options.isPinOverlay) {
      // Mitiga z-fighting con la superficie del planeta sin despegar visualmente el pin.
      this.gl.enable(this.gl.POLYGON_OFFSET_FILL);
      this.gl.polygonOffset(-1, -2);
      this.gl.depthFunc(this.gl.LEQUAL);
    }

    if (useBlend) {
      this.gl.enable(this.gl.BLEND);
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
      this.gl.depthMask(keepDepthWrite);
    } else {
      this.gl.disable(this.gl.BLEND);
      this.gl.depthMask(true);
    }

    for (const mesh of meshes) {
      const hasTexture = mesh.hasBaseColorTexture();
      program.setFloat('uUseTexture', hasTexture ? 1.0 : 0.0);
      if (hasTexture) {
        mesh.bindBaseColorTexture(0);
        program.setInt('uBaseColorTex', 0);
      }
      mesh.draw();
    }

    if (useBlend) {
      this.gl.depthMask(true);
      this.gl.disable(this.gl.BLEND);
    }
    if (options.isPinOverlay) {
      this.gl.depthFunc(this.gl.LESS);
      this.gl.disable(this.gl.POLYGON_OFFSET_FILL);
    }
  }
}

function resolvePublicAssetUrl(assetPath: string): string {
  const normalized = assetPath.replace(/^\/+/, '');
  if (typeof document === 'undefined') return `/${normalized}`;
  return new URL(normalized, document.baseURI).toString();
}

// --- Minimal matrix helpers (column-major) ---

function identity(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = (2 * far * near) * nf;
  return out;
}

function lookAt(eye: [number, number, number], center: [number, number, number], up: [number, number, number]): Float32Array {
  const [ex, ey, ez] = eye;
  const [cx, cy, cz] = center;
  const [ux, uy, uz] = up;

  let zx = ex - cx;
  let zy = ey - cy;
  let zz = ez - cz;
  const zlen = Math.hypot(zx, zy, zz) || 1;
  zx /= zlen; zy /= zlen; zz /= zlen;

  let xx = uy * zz - uz * zy;
  let xy = uz * zx - ux * zz;
  let xz = ux * zy - uy * zx;
  const xlen = Math.hypot(xx, xy, xz) || 1;
  xx /= xlen; xy /= xlen; xz /= xlen;

  let yx = zy * xz - zz * xy;
  let yy = zz * xx - zx * xz;
  let yz = zx * xy - zy * xx;
  const ylen = Math.hypot(yx, yy, yz) || 1;
  yx /= ylen; yy /= ylen; yz /= ylen;

  const out = new Float32Array(16);
  out[0] = xx; out[4] = yx; out[8]  = zx; out[12] = -(xx * ex + yx * ey + zx * ez);
  out[1] = xy; out[5] = yy; out[9]  = zy; out[13] = -(xy * ex + yy * ey + zy * ez);
  out[2] = xz; out[6] = yz; out[10] = zz; out[14] = -(xz * ex + yz * ey + zz * ez);
  out[3] = 0;  out[7] = 0;  out[11] = 0; out[15] = 1;
  return out;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function rotateY(angleRad: number): Float32Array {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return new Float32Array([
     c, 0, -s, 0, // col0: [c, 0, -s, 0]
     0, 1,  0, 0, // col1
     s, 0,  c, 0, // col2
     0, 0,  0, 1, // col3
  ]);
}

export function scaleUniform(f: number): Float32Array {
  return new Float32Array([
    f, 0, 0, 0,
    0, f, 0, 0,
    0, 0, f, 0,
    0, 0, 0, 1,
  ]);
}

export function translate(x: number, y: number, z: number): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

export function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  // Column-major multiplication: out = a * b
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}
