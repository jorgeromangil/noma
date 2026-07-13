export type vec3 = [number, number, number];
export type mat4 = Float32Array;

export function identityMat4(): mat4 {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function multiplyMat4(a: mat4, b: mat4): mat4 {
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

export function composeLocalMatrix(
  traslacion: vec3,
  rotacion: vec3,
  escalado: vec3
): mat4 {
  const t = translateMat4(traslacion);
  const rx = rotateXMat4(rotacion[0]);
  const ry = rotateYMat4(rotacion[1]);
  const rz = rotateZMat4(rotacion[2]);
  const s = scaleMat4(escalado);
  return multiplyMat4(t, multiplyMat4(rz, multiplyMat4(ry, multiplyMat4(rx, s))));
}

function translateMat4([x, y, z]: vec3): mat4 {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

function scaleMat4([x, y, z]: vec3): mat4 {
  return new Float32Array([
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ]);
}

function rotateXMat4(angleRad: number): mat4 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return new Float32Array([
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ]);
}

function rotateYMat4(angleRad: number): mat4 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return new Float32Array([
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ]);
}

function rotateZMat4(angleRad: number): mat4 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return new Float32Array([
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}
