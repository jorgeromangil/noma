import { mat4 } from './scene-math';

export abstract class TEntidad {
  actualizar(_dt: number): void {
    // Por defecto una entidad no tiene estado temporal propio.
  }

  abstract dibujar(matrizModel: mat4): void;

  destruir(): void {
    // Por defecto una entidad no posee recursos que liberar.
  }
}

export class TMalla extends TEntidad {
  constructor(private readonly onDraw: (matrizModel: mat4) => void) {
    super();
  }

  override dibujar(matrizModel: mat4): void {
    this.onDraw(matrizModel);
  }
}

export class TMarker extends TEntidad {
  constructor(private readonly onDraw: (matrizModel: mat4) => void) {
    super();
  }

  override dibujar(matrizModel: mat4): void {
    this.onDraw(matrizModel);
  }
}

export class TLuz extends TEntidad {
  constructor(private readonly onDraw: (matrizModel: mat4) => void) {
    super();
  }

  override dibujar(matrizModel: mat4): void {
    this.onDraw(matrizModel);
  }
}

export class TCamara extends TEntidad {
  constructor(private readonly onDraw: (matrizModel: mat4) => void) {
    super();
  }

  override dibujar(matrizModel: mat4): void {
    this.onDraw(matrizModel);
  }
}
