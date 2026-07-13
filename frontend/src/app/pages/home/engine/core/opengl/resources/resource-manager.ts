import { BaseColorTexture, Geometry } from '../geometry/geometry';

export type TShaderSources = {
  vertexSource: string;
  fragmentSource: string;
};

export type TMaterialData = {
  nombre?: string;
  baseColorFactor?: [number, number, number, number];
  texturaBaseColor?: BaseColorTexture;
  opacidad?: number;
  metalicidad?: number;
  rugosidad?: number;
  dobleCara?: boolean;
};

export abstract class TRecurso<TData> {
  private cargado = false;
  private data: TData | null = null;

  constructor(private readonly nombre: string) {}

  getNombre(): string {
    return this.nombre;
  }

  estaCargado(): boolean {
    return this.cargado;
  }

  protected marcarComoCargado(data: TData): void {
    this.data = data;
    this.cargado = true;
  }

  protected descargar(): void {
    this.data = null;
    this.cargado = false;
  }

  obtener(): TData {
    if (!this.cargado || this.data === null) {
      throw new Error(`El recurso "${this.nombre}" no esta cargado`);
    }
    return this.data;
  }

  abstract cargar(): Promise<void>;
}

export class TRecursoMalla extends TRecurso<Geometry> {
  constructor(nombre: string, private readonly loader: () => Promise<Geometry>) {
    super(nombre);
  }

  override async cargar(): Promise<void> {
    if (this.estaCargado()) return;
    const geometry = await this.loader();
    this.marcarComoCargado(geometry);
  }

  obtenerMalla(): Geometry {
    return this.obtener();
  }
}

export class TRecursoTextura extends TRecurso<BaseColorTexture> {
  constructor(nombre: string, textura: BaseColorTexture) {
    super(nombre);
    this.marcarComoCargado(textura);
  }

  override async cargar(): Promise<void> {
    // Recurso en memoria: ya queda cargado en constructor.
  }

  obtenerTextura(): BaseColorTexture {
    return this.obtener();
  }
}

export class TRecursoMaterial extends TRecurso<TMaterialData> {
  private readonly loader: (() => Promise<TMaterialData>) | null;

  constructor(nombre: string, materialOrLoader: TMaterialData | (() => Promise<TMaterialData>)) {
    super(nombre);
    if (typeof materialOrLoader === 'function') {
      this.loader = materialOrLoader;
    } else {
      this.loader = null;
      this.marcarComoCargado(normalizarMaterial(materialOrLoader));
    }
  }

  override async cargar(): Promise<void> {
    if (this.estaCargado()) return;
    if (!this.loader) {
      throw new Error(`Material "${this.getNombre()}" no tiene loader definido`);
    }
    const material = await this.loader();
    this.marcarComoCargado(normalizarMaterial(material));
  }

  obtenerMaterial(): TMaterialData {
    return this.obtener();
  }

  destruir(): void {
    this.descargar();
  }
}

export class TRecursoShader extends TRecurso<TShaderSources> {
  private readonly loader: (() => Promise<TShaderSources>) | null;

  constructor(
    nombre: string,
    shaderSourcesOrLoader: TShaderSources | (() => Promise<TShaderSources>)
  ) {
    super(nombre);
    if (typeof shaderSourcesOrLoader === 'function') {
      this.loader = shaderSourcesOrLoader;
    } else {
      this.loader = null;
      this.marcarComoCargado(shaderSourcesOrLoader);
    }
  }

  override async cargar(): Promise<void> {
    if (this.estaCargado()) return;
    if (!this.loader) {
      throw new Error(`Shader "${this.getNombre()}" no tiene loader definido`);
    }
    const shaderSources = await this.loader();
    this.marcarComoCargado(shaderSources);
  }

  obtenerShader(): TShaderSources {
    return this.obtener();
  }
}

export class TSharedPtr<T extends TRecurso<unknown>> { //Puntero compartido a un recurso que notifica al gestor de recursos cuando se libera para llevar un conteo de usos activos.
  private liberado = false;

  constructor(
    private readonly gestor: TGestorRecursos,
    private readonly clave: string,
    private readonly recurso: T
  ) {}

  get(): T {
    if (this.liberado) {
      throw new Error(`El puntero al recurso "${this.clave}" ya fue liberado`);
    }
    return this.recurso;
  }

  release(): void {
    if (this.liberado) return;
    this.liberado = true;
    this.gestor.liberarUsoInterno(this.clave);
  }

  isReleased(): boolean {
    return this.liberado;
  }
}

export class TGestorRecursos { //Gestor de recursos que mantiene un cache de recursos cargados, pendientes de carga y conteo de usos activos para liberar recursos no referenciados.
  private static instancia: TGestorRecursos | null = null;

  private readonly recursos = new Map<string, TRecurso<unknown>>();
  private readonly cargasPendientes = new Map<string, Promise<TRecurso<unknown>>>();
  private readonly usosActivos = new Map<string, number>();

  private readonly texturaKeyPorObjeto = new WeakMap<BaseColorTexture, string>();
  private secuenciaTexturas = 0;

  private constructor() {}

  static getInstancia(): TGestorRecursos {
    if (!this.instancia) {
      this.instancia = new TGestorRecursos();
    }
    return this.instancia;
  }

  async cargarMalla(
    clave: string,
    loader: () => Promise<Geometry>
  ): Promise<TSharedPtr<TRecursoMalla>> {
    return this.cargarConCache(clave, () => new TRecursoMalla(clave, loader));
  }

  registrarTexturaEnMemoria(
    textura: BaseColorTexture,
    categoria = 'textura-memoria'
  ): TSharedPtr<TRecursoTextura> {
    let clave = this.texturaKeyPorObjeto.get(textura);
    if (!clave) {
      this.secuenciaTexturas += 1;
      clave = `${categoria}:${this.secuenciaTexturas}`;
      this.texturaKeyPorObjeto.set(textura, clave);
    }

    return this.registrarEnCache(clave, () => new TRecursoTextura(clave, textura));
  }

  registrarMaterialEnMemoria(
    clave: string,
    material: TMaterialData
  ): TSharedPtr<TRecursoMaterial> {
    return this.registrarEnCache(clave, () => new TRecursoMaterial(clave, material));
  }

  async cargarMaterial(
    clave: string,
    loader: () => Promise<TMaterialData>
  ): Promise<TSharedPtr<TRecursoMaterial>> {
    return this.cargarConCache(clave, () => new TRecursoMaterial(clave, loader));
  }

  registrarShaderEnMemoria(
    clave: string,
    shaderSources: TShaderSources
  ): TSharedPtr<TRecursoShader> {
    return this.registrarEnCache(clave, () => new TRecursoShader(clave, shaderSources));
  }

  async cargarShaderDesdeUrl(
    clave: string,
    vertexUrl: string,
    fragmentUrl: string
  ): Promise<TSharedPtr<TRecursoShader>> {
    return this.cargarConCache(clave, () =>
      new TRecursoShader(clave, async () => {
        const [vertexSource, fragmentSource] = await Promise.all([
          fetchText(vertexUrl),
          fetchText(fragmentUrl),
        ]);
        return { vertexSource, fragmentSource };
      })
    );
  }

  obtenerRecurso<T extends TRecurso<unknown>>(clave: string): T | null {
    const recurso = this.recursos.get(clave);
    if (!recurso) return null;
    return recurso as T;
  }

  liberarUsoInterno(clave: string): void {
    const usos = this.usosActivos.get(clave);
    if (!usos) return;
    if (usos <= 1) {
      this.usosActivos.delete(clave);
      return;
    }
    this.usosActivos.set(clave, usos - 1);
  }

  purgarNoReferenciados(): number {
    let purgados = 0;
    for (const clave of this.recursos.keys()) {
      if ((this.usosActivos.get(clave) ?? 0) > 0) continue;
      const recurso = this.recursos.get(clave);
      recursoDestruible(recurso)?.destruir();
      this.recursos.delete(clave);
      purgados += 1;
    }
    return purgados;
  }

  getStats(): {
    totalRecursos: number;
    totalPendientes: number;
    totalUsosActivos: number;
  } {
    let totalUsosActivos = 0;
    for (const count of this.usosActivos.values()) {
      totalUsosActivos += count;
    }
    return {
      totalRecursos: this.recursos.size,
      totalPendientes: this.cargasPendientes.size,
      totalUsosActivos,
    };
  }

  private registrarEnCache<T extends TRecurso<unknown>>(
    clave: string,
    factory: () => T
  ): TSharedPtr<T> {
    const existente = this.recursos.get(clave);
    if (existente) {
      return this.crearPuntero(clave, existente as T);
    }

    const nuevo = factory();
    this.recursos.set(clave, nuevo);
    return this.crearPuntero(clave, nuevo);
  }

  private async cargarConCache<T extends TRecurso<unknown>>(
    clave: string,
    factory: () => T
  ): Promise<TSharedPtr<T>> {
    const existente = this.recursos.get(clave);
    if (existente) {
      return this.crearPuntero(clave, existente as T);
    }

    let pendiente = this.cargasPendientes.get(clave) as Promise<T> | undefined;
    if (!pendiente) {
      const recurso = factory();
      pendiente = recurso
        .cargar()
        .then(() => {
          this.recursos.set(clave, recurso);
          return recurso;
        })
        .finally(() => {
          this.cargasPendientes.delete(clave);
        });
      this.cargasPendientes.set(clave, pendiente as Promise<TRecurso<unknown>>);
    }

    const recurso = await pendiente;
    return this.crearPuntero(clave, recurso);
  }

  private crearPuntero<T extends TRecurso<unknown>>(
    clave: string,
    recurso: T
  ): TSharedPtr<T> {
    this.usosActivos.set(clave, (this.usosActivos.get(clave) ?? 0) + 1);
    return new TSharedPtr<T>(this, clave, recurso);
  }
}

function normalizarMaterial(material: TMaterialData): TMaterialData {
  return {
    ...material,
    baseColorFactor: material.baseColorFactor ?? [1, 1, 1, 1],
    opacidad: material.opacidad ?? material.baseColorFactor?.[3] ?? 1,
    metalicidad: material.metalicidad ?? 0,
    rugosidad: material.rugosidad ?? 1,
    dobleCara: material.dobleCara ?? false,
  };
}

function recursoDestruible(
  recurso: TRecurso<unknown> | undefined
): { destruir: () => void } | null {
  if (!recurso || typeof (recurso as { destruir?: unknown }).destruir !== 'function') {
    return null;
  }
  return recurso as unknown as { destruir: () => void };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo cargar shader: ${url} (${response.status})`);
  }
  return response.text();
}
