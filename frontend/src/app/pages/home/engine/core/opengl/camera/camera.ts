/**
 * Cámara simple con proyección en perspectiva y matriz de vista.
 * Mantiene matrices en formato column-major listo para WebGL.
 */
export class Camera {
  private position: [number, number, number] = [0, 0, 3];
  private target: [number, number, number] = [0, 0, 0];

  private fovRad: number = (60 * Math.PI) / 180;
  private aspect: number = 1;
  private near: number = 0.1;
  private far: number = 100;

  private viewMat: Float32Array = identity();
  private projMat: Float32Array = identity();

  setPerspective(fovDeg: number, aspect: number, near: number, far: number): void {
    this.fovRad = (fovDeg * Math.PI) / 180;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.updateProjection();
  }

  setPosition(pos: [number, number, number]): void {
    this.position = pos;
    this.updateView();
  }

  lookAt(target: [number, number, number]): void {
    this.target = target;
    this.updateView();
  }

  getPosition(): [number, number, number] {
    return this.position;
  }

  getTarget(): [number, number, number] {
    return this.target;
  }

  getViewMatrix(): Float32Array {
    return this.viewMat;
  }

  getProjectionMatrix(): Float32Array {
    return this.projMat;
  }

  private updateView(): void {
    this.viewMat = lookAt(this.position, this.target);
  }

  private updateProjection(): void {
    this.projMat = perspective(this.fovRad, this.aspect, this.near, this.far);
  }
}

// --- helpers (column-major) ---

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

function lookAt(eye: [number, number, number], center: [number, number, number]): Float32Array {
  const [ex, ey, ez] = eye;
  const [cx, cy, cz] = center;
  const worldUp: [number, number, number] = [0, 1, 0];
  let [ux, uy, uz] = worldUp;

  let zx = ex - cx;
  let zy = ey - cy;
  let zz = ez - cz;
  const zlen = Math.hypot(zx, zy, zz) || 1;
  zx /= zlen; zy /= zlen; zz /= zlen;

  let xx = uy * zz - uz * zy;
  let xy = uz * zx - ux * zz;
  let xz = ux * zy - uy * zx;
  let xlen = Math.hypot(xx, xy, xz);
  if (xlen < 1e-6) {
    // Forward casi paralelo a world-up: usar un eje auxiliar estable.
    ux = 0; uy = 0; uz = 1;
    xx = uy * zz - uz * zy;
    xy = uz * zx - ux * zz;
    xz = ux * zy - uy * zx;
    xlen = Math.hypot(xx, xy, xz);
  }
  if (xlen < 1e-6) {
    xx = 1; xy = 0; xz = 0;
    xlen = 1;
  }
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

function identity(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}
