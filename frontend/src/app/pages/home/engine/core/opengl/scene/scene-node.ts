import { TEntidad } from './scene-entities';
import { composeLocalMatrix, identityMat4, mat4, multiplyMat4, vec3 } from './scene-math';

export class TNodo {
  public padre: TNodo | null = null;
  public hijos: TNodo[] = [];
  public entidad: TEntidad | null = null;

  public traslacion: vec3 = [0, 0, 0];
  public rotacion: vec3 = [0, 0, 0];
  public escalado: vec3 = [1, 1, 1];
  public actualizarMatriz = true;

  private matrizLocal: mat4 = identityMat4();
  private matrizBasePersonalizada: mat4 | null = null;

  constructor(entidad: TEntidad | null = null) {
    this.entidad = entidad;
  }

  agregarHijo(hijo: TNodo): TNodo {
    if (hijo.padre === this) return hijo;
    if (hijo.padre) hijo.padre.eliminarHijo(hijo);
    hijo.padre = this;
    this.hijos.push(hijo);
    return hijo;
  }

  addHijo(hijo: TNodo): TNodo {
    return this.agregarHijo(hijo);
  }

  eliminarHijo(hijo: TNodo): void {
    const index = this.hijos.indexOf(hijo);
    if (index < 0) return;
    this.hijos.splice(index, 1);
    hijo.padre = null;
  }

  remHijo(hijo: TNodo): void {
    this.eliminarHijo(hijo);
  }

  setEntidad(entidad: TEntidad | null): void {
    this.entidad = entidad;
  }

  getEntidad(): TEntidad | null {
    return this.entidad;
  }

  getPadre(): TNodo | null {
    return this.padre;
  }

  getHijos(): TNodo[] {
    return this.hijos;
  }

  setTraslacion(traslacion: vec3): void {
    this.traslacion = [...traslacion];
    this.actualizarMatriz = true;
  }

  setRotacion(rotacion: vec3): void {
    this.rotacion = [...rotacion];
    this.actualizarMatriz = true;
  }

  setEscalado(escalado: vec3): void {
    this.escalado = [...escalado];
    this.actualizarMatriz = true;
  }

  trasladar(delta: vec3): void {
    this.traslacion = [
      this.traslacion[0] + delta[0],
      this.traslacion[1] + delta[1],
      this.traslacion[2] + delta[2],
    ];
    this.actualizarMatriz = true;
  }

  rotar(delta: vec3): void {
    this.rotacion = [
      this.rotacion[0] + delta[0],
      this.rotacion[1] + delta[1],
      this.rotacion[2] + delta[2],
    ];
    this.actualizarMatriz = true;
  }

  escalar(factor: vec3): void {
    this.escalado = [
      this.escalado[0] * factor[0],
      this.escalado[1] * factor[1],
      this.escalado[2] * factor[2],
    ];
    this.actualizarMatriz = true;
  }

  getTraslacion(): vec3 {
    return [...this.traslacion];
  }

  getRotacion(): vec3 {
    return [...this.rotacion];
  }

  getEscalado(): vec3 {
    return [...this.escalado];
  }

  setMatrizBasePersonalizada(matriz: mat4 | null): void {
    this.matrizBasePersonalizada = matriz ? new Float32Array(matriz) : null;
    this.actualizarMatriz = true;
  }

  setMatrizTransf(matriz: mat4 | null): void {
    this.setMatrizBasePersonalizada(matriz);
  }

  getMatrizTransf(): mat4 {
    return this.getMatrizLocal();
  }

  getMatrizLocal(): mat4 {
    if (this.actualizarMatriz) {
      const matrizTrs = composeLocalMatrix(this.traslacion, this.rotacion, this.escalado);
      this.matrizLocal = this.matrizBasePersonalizada
        ? multiplyMat4(matrizTrs, this.matrizBasePersonalizada)
        : matrizTrs;
      this.actualizarMatriz = false;
    }
    return this.matrizLocal;
  }

  actualizar(dt: number): void {
    this.entidad?.actualizar(dt);
    for (const hijo of this.hijos) {
      hijo.actualizar(dt);
    }
  }

  recorrer(matrizAcum: mat4): void {
    const matrizGlobal = multiplyMat4(matrizAcum, this.getMatrizLocal());
    this.entidad?.dibujar(matrizGlobal);
    for (const hijo of this.hijos) {
      hijo.recorrer(matrizGlobal);
    }
  }

  destruir(): void {
    this.entidad?.destruir();
    for (const hijo of this.hijos) {
      hijo.destruir();
    }
  }
}
