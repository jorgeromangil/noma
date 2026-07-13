export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function distanceVec3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function identityMat4(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function transformPointMat4(mat: Float32Array, point: Vec3): Vec3 {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  return [
    mat[0] * x + mat[4] * y + mat[8] * z + mat[12],
    mat[1] * x + mat[5] * y + mat[9] * z + mat[13],
    mat[2] * x + mat[6] * y + mat[10] * z + mat[14],
  ];
}

export function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function orientNormalOutward(normal: Vec3, outwardHint: Vec3): Vec3 {
  const n = normalizeVec3(normal);
  const dot = dotVec3(n, outwardHint);
  if (dot >= 0) return n;
  return [-n[0], -n[1], -n[2]];
}

export function quatToMat4(q: Quat): Float32Array {
  const [x, y, z, w] = q;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return new Float32Array([
    1 - 2 * (yy + zz),
    2 * (xy + wz),
    2 * (xz - wy),
    0,
    2 * (xy - wz),
    1 - 2 * (xx + zz),
    2 * (yz + wx),
    0,
    2 * (xz + wy),
    2 * (yz - wx),
    1 - 2 * (xx + yy),
    0,
    0,
    0,
    0,
    1,
  ]);
}

export function mulQuat(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function dotQuat(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let cosom = dotQuat(a, b);
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];

  // Camino corto en la hiperesfera de cuaterniones.
  if (cosom < 0) {
    cosom = -cosom;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  let sclp: number;
  let sclq: number;
  if (1 - cosom > 1e-6) {
    const omega = Math.acos(cosom);
    const sinom = Math.sin(omega) || 1;
    sclp = Math.sin((1 - t) * omega) / sinom;
    sclq = Math.sin(t * omega) / sinom;
  } else {
    sclp = 1 - t;
    sclq = t;
  }

  return [
    sclp * a[0] + sclq * bx,
    sclp * a[1] + sclq * by,
    sclp * a[2] + sclq * bz,
    sclp * a[3] + sclq * bw,
  ];
}

// Convierte Euler XYZ en cuaternion (alineado con THREE.Euler por defecto).
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const cx = Math.cos(x * 0.5);
  const sx = Math.sin(x * 0.5);
  const cy = Math.cos(y * 0.5);
  const sy = Math.sin(y * 0.5);
  const cz = Math.cos(z * 0.5);
  const sz = Math.sin(z * 0.5);
  return normalizeQuat([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]);
}

export function rotationFromTo(from: Vec3, to: Vec3): Float32Array {
  const f = normalizeVec3(from);
  const t = normalizeVec3(to);
  const d = clamp(dotVec3(f, t), -1, 1);

  if (d > 0.999999) return identityMat4();

  if (d < -0.999999) {
    const axisA = crossVec3([1, 0, 0], f);
    const axis = Math.hypot(axisA[0], axisA[1], axisA[2]) > 1e-6
      ? normalizeVec3(axisA)
      : normalizeVec3(crossVec3([0, 0, 1], f));
    return axisAngleToMat4(axis, Math.PI);
  }

  const axis = normalizeVec3(crossVec3(f, t));
  const angle = Math.acos(d);
  return axisAngleToMat4(axis, angle);
}

export function axisAngleToMat4(axis: Vec3, angle: number): Float32Array {
  const [x, y, z] = normalizeVec3(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;

  return new Float32Array([
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ]);
}

export function rotateX(angleRad: number): Float32Array {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return new Float32Array([
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ]);
}
