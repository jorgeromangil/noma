export type BaseColorTexture = {
  width: number;
  height: number;
  pixels: Uint8Array;
  wrapS?: number;
  wrapT?: number;
};

export type Geometry = {
  vertices: Float32Array;
  stride: number;
  attributes: Array<{
    index: number;
    size: number;
    offset: number;
  }>;
  vertexCount: number;
  indices?: Uint16Array | Uint32Array;
  mode?: GLenum;
  baseColorTexture?: BaseColorTexture;
};

// Quad en XY con z constante, con color por vértice (r,g,b).
export function createColoredQuad(size = 1, z = -0.5): Geometry {
  const halfX = size * 0.6;
  const halfY = size * 0.5;

  const vertices = new Float32Array([
    // pos.x,    pos.y,   pos.z,   nx, ny, nz,   r,    g,    b
    -halfX, -halfY, z,    0, 0, 1,   0.1, 0.6, 0.9,
     halfX, -halfY, z,    0, 0, 1,   0.1, 0.9, 0.6,
     halfX,  halfY, z,    0, 0, 1,   0.9, 0.4, 0.1,

    -halfX, -halfY, z,    0, 0, 1,   0.1, 0.6, 0.9,
     halfX,  halfY, z,    0, 0, 1,   0.9, 0.4, 0.1,
    -halfX,  halfY, z,    0, 0, 1,   0.6, 0.2, 0.9,
  ]);

  return {
    vertices,
    stride: 9 * 4,
    attributes: [
      { index: 0, size: 3, offset: 0 },
      { index: 1, size: 3, offset: 3 * 4 }, // normal
      { index: 2, size: 3, offset: 6 * 4 }, // color
    ],
    vertexCount: 6
  };
}

// Esfera low-poly en coordenadas unitarias. latSteps/longSteps controlan resolución.
// Si baseColor está definido, se usa un color plano; de lo contrario se colorea por normal.
export function createColoredSphere(
  radius = 1,
  latSteps = 12,
  longSteps = 16,
  baseColor?: [number, number, number]
): Geometry {
  const verts: number[] = [];

  for (let lat = 0; lat < latSteps; lat++) {
    const theta1 = (lat / latSteps) * Math.PI;
    const theta2 = ((lat + 1) / latSteps) * Math.PI;

    for (let lon = 0; lon <= longSteps; lon++) {
      const phi = (lon / longSteps) * 2 * Math.PI;

      const x1 = Math.sin(theta1) * Math.cos(phi);
      const y1 = Math.cos(theta1);
      const z1 = Math.sin(theta1) * Math.sin(phi);
      const n1 = [x1, y1, z1]; // normal en esfera unitaria
      const x2 = Math.sin(theta2) * Math.cos(phi);
      const y2 = Math.cos(theta2);
      const z2 = Math.sin(theta2) * Math.sin(phi);
      const n2 = [x2, y2, z2];

      // Color sencillo basado en normal para ver variación, o plano si se indica
      const c1 = baseColor ?? [0.5 + x1 * 0.5, 0.5 + y1 * 0.5, 0.5 + z1 * 0.5];
      const c2 = baseColor ?? [0.5 + x2 * 0.5, 0.5 + y2 * 0.5, 0.5 + z2 * 0.5];

      const p1 = [x1 * radius, y1 * radius, z1 * radius];
      const p2 = [x2 * radius, y2 * radius, z2 * radius];

      // Triángulo 1
      verts.push(...p1, ...n1, ...c1);
      verts.push(...p2, ...n2, ...c2);

      const phi2 = ((lon + 1) / longSteps) * 2 * Math.PI;
      const x3 = Math.sin(theta1) * Math.cos(phi2);
      const y3 = Math.cos(theta1);
      const z3 = Math.sin(theta1) * Math.sin(phi2);
      const n3 = [x3, y3, z3];
      const c3 = baseColor ?? [0.5 + x3 * 0.5, 0.5 + y3 * 0.5, 0.5 + z3 * 0.5];
      const p3 = [x3 * radius, y3 * radius, z3 * radius];
      verts.push(...p3, ...n3, ...c3);

      // Triángulo 2
      verts.push(...p2, ...n2, ...c2);
      const x4 = Math.sin(theta2) * Math.cos(phi2);
      const y4 = Math.cos(theta2);
      const z4 = Math.sin(theta2) * Math.sin(phi2);
      const n4 = [x4, y4, z4];
      const c4 = baseColor ?? [0.5 + x4 * 0.5, 0.5 + y4 * 0.5, 0.5 + z4 * 0.5];
      const p4 = [x4 * radius, y4 * radius, z4 * radius];
      verts.push(...p4, ...n4, ...c4);
      verts.push(...p3, ...n3, ...c3);
    }
  }

  const vertices = new Float32Array(verts);
  return {
    vertices,
    stride: 9 * 4,
    attributes: [
      { index: 0, size: 3, offset: 0 },
      { index: 1, size: 3, offset: 3 * 4 }, // normal
      { index: 2, size: 3, offset: 6 * 4 }, // color
    ],
    vertexCount: verts.length / 9
  };
}

// Aplica una matriz 4x4 (column-major) a posiciones y la derivada 3x3 a normales.
// Devuelve una nueva geometría (no muta la original).
export function transformGeometry(geometry: Geometry, mat: Float32Array): Geometry {
  const strideFloats = geometry.stride / 4;
  const vertCount = geometry.vertices.length / strideFloats;
  const out = new Float32Array(geometry.vertices.length);

  // Extraemos los 3x3 superiores y calculamos su inversa-transpuesta para las normales.
  const a00 = mat[0], a01 = mat[4], a02 = mat[8];
  const a10 = mat[1], a11 = mat[5], a12 = mat[9];
  const a20 = mat[2], a21 = mat[6], a22 = mat[10];

  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);
  const invDet = Math.abs(det) > 1e-8 ? 1 / det : 1e-8;

  const n00 = (a11 * a22 - a12 * a21) * invDet;
  const n01 = (a02 * a21 - a01 * a22) * invDet;
  const n02 = (a01 * a12 - a02 * a11) * invDet;
  const n10 = (a12 * a20 - a10 * a22) * invDet;
  const n11 = (a00 * a22 - a02 * a20) * invDet;
  const n12 = (a02 * a10 - a00 * a12) * invDet;
  const n20 = (a10 * a21 - a11 * a20) * invDet;
  const n21 = (a01 * a20 - a00 * a21) * invDet;
  const n22 = (a00 * a11 - a01 * a10) * invDet;

  for (let i = 0; i < vertCount; i++) {
    const base = i * strideFloats;
    const px = geometry.vertices[base + 0];
    const py = geometry.vertices[base + 1];
    const pz = geometry.vertices[base + 2];

    const nx = geometry.vertices[base + 3];
    const ny = geometry.vertices[base + 4];
    const nz = geometry.vertices[base + 5];

    // Posición transformada (mat * vec4(pos,1))
    const tx = mat[0] * px + mat[4] * py + mat[8]  * pz + mat[12];
    const ty = mat[1] * px + mat[5] * py + mat[9]  * pz + mat[13];
    const tz = mat[2] * px + mat[6] * py + mat[10] * pz + mat[14];

    // Normal transformada por la inversa-transpuesta, luego normalizada
    let tnx = n00 * nx + n01 * ny + n02 * nz;
    let tny = n10 * nx + n11 * ny + n12 * nz;
    let tnz = n20 * nx + n21 * ny + n22 * nz;
    const nlen = Math.hypot(tnx, tny, tnz) || 1;
    tnx /= nlen; tny /= nlen; tnz /= nlen;

    out[base + 0] = tx;
    out[base + 1] = ty;
    out[base + 2] = tz;
    out[base + 3] = tnx;
    out[base + 4] = tny;
    out[base + 5] = tnz;
    // El resto de atributos (color, uv, etc.) se copian tal cual.
    for (let j = 6; j < strideFloats; j++) {
      out[base + j] = geometry.vertices[base + j];
    }
  }

  return {
    vertices: out,
    stride: geometry.stride,
    attributes: geometry.attributes,
    vertexCount: geometry.vertexCount,
    indices: geometry.indices ? geometry.indices.slice() as typeof geometry.indices : undefined,
    mode: geometry.mode,
    baseColorTexture: geometry.baseColorTexture
  };
}
