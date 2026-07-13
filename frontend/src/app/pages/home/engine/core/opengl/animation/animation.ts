import { BaseColorTexture, Geometry } from '../geometry/geometry';
import { TGestorRecursos, TRecursoMalla, TRecursoTextura, TSharedPtr } from '../resources/resource-manager';
import { TEntidad } from '../scene/scene-entities';
import { composeLocalMatrix, identityMat4, mat4, multiplyMat4, vec3 } from '../scene/scene-math';

export type TEstadoAnimacion = 'stopped' | 'playing' | 'paused';

export type TTransformAnimacion = {
  traslacion?: vec3;
  rotacion?: vec3;
  escalado?: vec3;
  matriz?: mat4;
};

export type TMaterialAnimacionDef = {
  id: string;
  nombre?: string;
  baseColorFactor?: [number, number, number, number];
  textura?: BaseColorTexture;
  opacidad?: number;
  metalicidad?: number;
  rugosidad?: number;
  dobleCara?: boolean;
};

export type TMallaAnimacionDef = {
  id: string;
  nombre?: string;
  claveRecurso: string;
  cargarGeometria: () => Promise<Geometry>;
  materialId?: string;
  visible?: boolean;
  transform?: TTransformAnimacion;
};

export type TFrameAnimacionDef = {
  id?: string;
  duracionMs?: number;
  meshIds?: string[];
  transforms?: Record<string, TTransformAnimacion>;
  materialOverrides?: Record<string, Partial<TMaterialAnimacionDef>>;
  datos?: Record<string, unknown>;
};

export type TMallaAnimacionRender = {
  id: string;
  nombre?: string;
  geometria: Geometry;
  material: TMaterialAnimacionDef | null;
  matrizModel: mat4;
};

export type TFrameAnimacionRenderInfo = {
  nombre: string;
  estado: TEstadoAnimacion;
  frameIndex: number;
  frame: TFrameAnimacionDef;
  tiempoMs: number;
  progresoFrame: number;
  progresoTotal: number;
  mallas: TMallaAnimacionRender[];
};

export type TAnimacionOptions = {
  nombre: string;
  fps?: number;
  loop?: boolean;
  autoplay?: boolean;
  playbackRate?: number;
  frames?: TFrameAnimacionDef[];
  mallas?: TMallaAnimacionDef[];
  materiales?: TMaterialAnimacionDef[];
  onFrame?: (info: TFrameAnimacionRenderInfo) => void;
  onFrameChange?: (info: TFrameAnimacionRenderInfo) => void;
};

type TMallaAnimacionState = TMallaAnimacionDef & {
  ptr: TSharedPtr<TRecursoMalla> | null;
  cargada: boolean;
};

type TMaterialAnimacionState = TMaterialAnimacionDef & {
  texturaPtr: TSharedPtr<TRecursoTextura> | null;
};

/**
 * Entidad temporal del motor. Mantiene datos de clips por frames, recursos de
 * mallas/materiales y un reloj propio para avanzar la animacion dentro del grafo.
 */
export class TAnimacion extends TEntidad {
  private readonly gestorRecursos = TGestorRecursos.getInstancia();
  private readonly nombre: string;
  private readonly fps: number;
  private readonly loop: boolean;
  private readonly onFrame?: (info: TFrameAnimacionRenderInfo) => void;
  private readonly onFrameChange?: (info: TFrameAnimacionRenderInfo) => void;

  private playbackRate: number;
  private estado: TEstadoAnimacion;
  private tiempoMs = 0;
  private frameIndexActual = 0;
  private ultimoFrameNotificado = -1;
  private destruida = false;

  private readonly frames: TFrameAnimacionDef[] = [];
  private readonly mallas = new Map<string, TMallaAnimacionState>();
  private readonly materiales = new Map<string, TMaterialAnimacionState>();
  private frameStartsMs: number[] = [0];
  private duracionTotalMs = 0;
  private cargaPendiente: Promise<void> | null = null;

  constructor(options: TAnimacionOptions) {
    super();
    this.nombre = options.nombre;
    this.fps = Math.max(options.fps ?? 24, 1);
    this.loop = options.loop ?? true;
    this.playbackRate = options.playbackRate ?? 1;
    this.estado = options.autoplay === false ? 'stopped' : 'playing';
    this.onFrame = options.onFrame;
    this.onFrameChange = options.onFrameChange;

    for (const material of options.materiales ?? []) {
      this.materiales.set(material.id, {
        ...material,
        texturaPtr: material.textura
          ? this.gestorRecursos.registrarTexturaEnMemoria(material.textura, `animacion:${this.nombre}:textura`)
          : null,
      });
    }

    for (const malla of options.mallas ?? []) {
      this.mallas.set(malla.id, {
        ...malla,
        visible: malla.visible ?? true,
        ptr: null,
        cargada: false,
      });
    }

    this.frames.push(...(options.frames?.length ? options.frames : [{ id: 'default' }]));
    this.reconstruirLineaTemporal();
  }

  async cargarRecursos(): Promise<void> {
    if (this.destruida) return;
    if (this.cargaPendiente) return this.cargaPendiente;

    this.cargaPendiente = Promise.all(
      Array.from(this.mallas.values()).map(async (malla) => {
        if (malla.ptr) return;
        const ptr = await this.gestorRecursos.cargarMalla(malla.claveRecurso, malla.cargarGeometria);
        if (this.destruida) {
          ptr.release();
          return;
        }
        malla.ptr = ptr;
        malla.cargada = true;
      })
    ).then(() => undefined);

    return this.cargaPendiente;
  }

  override actualizar(dt: number): void {
    if (this.estado !== 'playing' || this.frames.length === 0 || this.duracionTotalMs <= 0) return;

    const deltaMs = Math.max(dt, 0) * 1000 * this.playbackRate;
    this.seekTime(this.tiempoMs + deltaMs);
  }

  override dibujar(matrizModel: mat4): void {
    if (!this.onFrame && !this.onFrameChange) return;

    const info = this.crearFrameRenderInfo(matrizModel);
    if (this.onFrameChange && this.ultimoFrameNotificado !== this.frameIndexActual) {
      this.ultimoFrameNotificado = this.frameIndexActual;
      this.onFrameChange(info);
    }
    this.onFrame?.(info);
  }

  play(): void {
    if (this.destruida) return;
    this.estado = 'playing';
  }

  pause(): void {
    if (this.estado === 'playing') this.estado = 'paused';
  }

  stop(): void {
    this.estado = 'stopped';
    this.tiempoMs = 0;
    this.frameIndexActual = 0;
    this.ultimoFrameNotificado = -1;
  }

  reset(): void {
    this.seekTime(0);
    this.ultimoFrameNotificado = -1;
  }

  seekFrame(frameIndex: number): void {
    const safeIndex = Number.isFinite(frameIndex) ? Math.trunc(frameIndex) : 0;
    const clampedIndex = clamp(safeIndex, 0, Math.max(this.frames.length - 1, 0));
    this.tiempoMs = this.frameStartsMs[clampedIndex] ?? 0;
    this.frameIndexActual = clampedIndex;
  }

  seekTime(tiempoMs: number): void {
    if (this.duracionTotalMs <= 0) {
      this.tiempoMs = 0;
      this.frameIndexActual = 0;
      return;
    }

    let nextTime = Number.isFinite(tiempoMs) ? tiempoMs : 0;
    if (this.loop) {
      nextTime = positiveModulo(nextTime, this.duracionTotalMs);
    } else {
      nextTime = clamp(nextTime, 0, this.duracionTotalMs);
      if (nextTime >= this.duracionTotalMs) {
        nextTime = Math.max(this.duracionTotalMs - 0.0001, 0);
        this.estado = 'stopped';
      }
    }

    this.tiempoMs = nextTime;
    this.frameIndexActual = this.frameIndexAtTime(nextTime);
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Number.isFinite(rate) ? rate : 1;
  }

  addFrame(frame: TFrameAnimacionDef): void {
    this.frames.push(frame);
    this.reconstruirLineaTemporal();
  }

  addMalla(malla: TMallaAnimacionDef): void {
    this.mallas.set(malla.id, {
      ...malla,
      visible: malla.visible ?? true,
      ptr: null,
      cargada: false,
    });
    this.cargaPendiente = null;
  }

  addMaterial(material: TMaterialAnimacionDef): void {
    const previo = this.materiales.get(material.id);
    previo?.texturaPtr?.release();
    this.materiales.set(material.id, {
      ...material,
      texturaPtr: material.textura
        ? this.gestorRecursos.registrarTexturaEnMemoria(material.textura, `animacion:${this.nombre}:textura`)
        : null,
    });
  }

  getNombre(): string {
    return this.nombre;
  }

  getEstado(): TEstadoAnimacion {
    return this.estado;
  }

  getFrameIndexActual(): number {
    return this.frameIndexActual;
  }

  getFrameActual(): TFrameAnimacionDef {
    return this.frames[this.frameIndexActual] ?? this.frames[0];
  }

  getTiempoMs(): number {
    return this.tiempoMs;
  }

  getDuracionTotalMs(): number {
    return this.duracionTotalMs;
  }

  estaCargada(): boolean {
    return Array.from(this.mallas.values()).every((malla) => malla.cargada);
  }

  override destruir(): void {
    if (this.destruida) return;
    this.destruida = true;
    this.estado = 'stopped';
    for (const malla of this.mallas.values()) {
      malla.ptr?.release();
      malla.ptr = null;
      malla.cargada = false;
    }
    for (const material of this.materiales.values()) {
      material.texturaPtr?.release();
      material.texturaPtr = null;
    }
    this.cargaPendiente = null;
  }

  private reconstruirLineaTemporal(): void {
    this.frameStartsMs = [];
    let cursor = 0;
    for (const frame of this.frames) {
      this.frameStartsMs.push(cursor);
      cursor += this.getFrameDuration(frame);
    }
    this.duracionTotalMs = cursor;
    this.seekTime(Math.min(this.tiempoMs, Math.max(this.duracionTotalMs - 0.0001, 0)));
  }

  private getFrameDuration(frame: TFrameAnimacionDef): number {
    return Math.max(frame.duracionMs ?? 1000 / this.fps, 1);
  }

  private frameIndexAtTime(tiempoMs: number): number {
    if (this.frames.length <= 1) return 0;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (tiempoMs >= this.frameStartsMs[i]) return i;
    }
    return 0;
  }

  private crearFrameRenderInfo(matrizModel: mat4): TFrameAnimacionRenderInfo {
    const frame = this.getFrameActual();
    const inicioFrame = this.frameStartsMs[this.frameIndexActual] ?? 0;
    const duracionFrame = this.getFrameDuration(frame);
    const activeMeshIds = frame.meshIds ?? Array.from(this.mallas.keys());
    const mallas: TMallaAnimacionRender[] = [];

    for (const meshId of activeMeshIds) {
      const malla = this.mallas.get(meshId);
      if (!malla || malla.visible === false || !malla.ptr) continue;

      const geometria = malla.ptr.get().obtenerMalla();
      const materialBase = malla.materialId ? this.materiales.get(malla.materialId) ?? null : null;
      const override = malla.materialId ? frame.materialOverrides?.[malla.materialId] : undefined;
      const material = materialBase ? { ...materialBase, ...override } : null;
      const frameTransform = frame.transforms?.[meshId];
      const matrizMalla = combinarMatricesTransform(malla.transform, frameTransform);
      mallas.push({
        id: malla.id,
        nombre: malla.nombre,
        geometria,
        material,
        matrizModel: multiplyMat4(matrizModel, matrizMalla),
      });
    }

    return {
      nombre: this.nombre,
      estado: this.estado,
      frameIndex: this.frameIndexActual,
      frame,
      tiempoMs: this.tiempoMs,
      progresoFrame: clamp((this.tiempoMs - inicioFrame) / duracionFrame, 0, 1),
      progresoTotal: this.duracionTotalMs > 0 ? clamp(this.tiempoMs / this.duracionTotalMs, 0, 1) : 0,
      mallas,
    };
  }
}

function combinarMatricesTransform(
  base?: TTransformAnimacion,
  frame?: TTransformAnimacion
): mat4 {
  const baseMat = transformToMat4(base);
  const frameMat = transformToMat4(frame);
  return multiplyMat4(baseMat, frameMat);
}

function transformToMat4(transform?: TTransformAnimacion): mat4 {
  if (!transform) return identityMat4();
  const trs = composeLocalMatrix(
    transform.traslacion ?? [0, 0, 0],
    transform.rotacion ?? [0, 0, 0],
    transform.escalado ?? [1, 1, 1]
  );
  return transform.matriz ? multiplyMat4(trs, transform.matriz) : trs;
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
