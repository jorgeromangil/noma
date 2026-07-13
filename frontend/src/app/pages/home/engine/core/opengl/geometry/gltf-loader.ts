/**
 * Loader glTF/glb simplificado para extraer geometría.
 * Soporta:
 *  - Varios meshes/primitives (se fusionan)
 *  - Atributos POSITION (obligatorio), NORMAL/COLOR_0/TEXCOORD_0 opcionales
 *  - Índices sin compresión
 *  - Transformaciones de nodos (TRS/matrix) aplicadas a las posiciones
 *  - Opcional: horneado de baseColorTexture a color de vértice
 */
import { Geometry } from './geometry';

type GlbChunks = { json: any; bin: ArrayBuffer };
type TextureSampler = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  wrapS: number;
  wrapT: number;
};
type MaterialInfo = {
  baseColorFactor: [number, number, number, number];
  hasBaseColorFactor: boolean;
  baseColorTextureIndex: number | null;
};
type LoadContext = {
  gltf: any;
  bin: ArrayBuffer;
  baseUrl: string;
  options: Required<LoadGlbGeometryOptions>;
  textureCache: Map<number, Promise<TextureSampler | null>>;
  baseColorTexture: TextureSampler | null;
  includeNodeNameSet: Set<string>;
  excludeNodeNameSet: Set<string>;
};

export type LoadGlbGeometryOptions = {
  bakeBaseColorTexture?: boolean;
  preserveBaseColorTexture?: boolean;
  forceBaseColorClamp?: boolean;
  defaultColor?: [number, number, number];
  includeNodeNames?: string[];
  excludeNodeNames?: string[];
};

const glbChunkCache = new Map<string, Promise<GlbChunks>>();

export async function loadGlbGeometryMerged(url: string, options: LoadGlbGeometryOptions = {}): Promise<Geometry> {
  const { json, bin } = await loadGlbChunks(url);
  const gltf = json as any;
  const resolvedOptions: Required<LoadGlbGeometryOptions> = {
    bakeBaseColorTexture: options.bakeBaseColorTexture === true,
    preserveBaseColorTexture: options.preserveBaseColorTexture === true,
    forceBaseColorClamp: options.forceBaseColorClamp === true,
    defaultColor: options.defaultColor ?? [0.7, 0.7, 0.7],
    includeNodeNames: options.includeNodeNames ?? [],
    excludeNodeNames: options.excludeNodeNames ?? [],
  };
  const includeUv = resolvedOptions.preserveBaseColorTexture;
  const strideFloats = includeUv ? 11 : 9;

  const meshes = gltf.meshes ?? [];
  if (!meshes.length) throw new Error('No meshes found in GLB');

  const vertices: number[] = [];
  const indicesAll: number[] = [];
  const ctx: LoadContext = {
    gltf,
    bin,
    baseUrl: toAbsoluteUrl(url),
    options: resolvedOptions,
    textureCache: new Map(),
    baseColorTexture: null,
    includeNodeNameSet: new Set(
      resolvedOptions.includeNodeNames
        .map(normalizeNodeName)
        .filter((name) => name.length > 0)
    ),
    excludeNodeNameSet: new Set(
      resolvedOptions.excludeNodeNames
        .map(normalizeNodeName)
        .filter((name) => name.length > 0)
    ),
  };

  // Recorremos la escena principal aplicando transformaciones por nodo.
  const sceneIndex = gltf.scene ?? 0;
  const rootNodes: number[] = gltf.scenes?.[sceneIndex]?.nodes ?? [];
  for (const root of rootNodes) {
    await accumulateNode(ctx, root, identity(), vertices, indicesAll, false, false);
  }

  const verticesArray = new Float32Array(vertices);
  const useUint32 = verticesArray.length / strideFloats > 65535;
  const indicesArray = indicesAll.length
    ? (useUint32 ? new Uint32Array(indicesAll) : new Uint16Array(indicesAll))
    : undefined;
  const attributes = [
    { index: 0, size: 3, offset: 0 },
    { index: 1, size: 3, offset: 3 * 4 }, // normal
    { index: 2, size: 3, offset: 6 * 4 }, // color
  ];
  if (includeUv) attributes.push({ index: 3, size: 2, offset: 9 * 4 });

  return {
    vertices: verticesArray,
    stride: strideFloats * 4,
    attributes,
    vertexCount: indicesArray ? indicesArray.length : verticesArray.length / strideFloats,
    indices: indicesArray,
    mode: 4, // TRIANGLES
    baseColorTexture: ctx.baseColorTexture
      ? {
          width: ctx.baseColorTexture.width,
          height: ctx.baseColorTexture.height,
          pixels: new Uint8Array(ctx.baseColorTexture.pixels),
          wrapS: ctx.baseColorTexture.wrapS,
          wrapT: ctx.baseColorTexture.wrapT,
        }
      : undefined,
  };
}

async function accumulateNode(
  ctx: LoadContext,
  nodeIndex: number,
  parentMat: Float32Array,
  vertices: number[],
  indicesAll: number[],
  ancestorIncluded: boolean,
  ancestorExcluded: boolean
) {
  const gltf = ctx.gltf;
  const bin = ctx.bin;
  const node = gltf.nodes[nodeIndex];
  const localMat = buildLocalMatrix(node);
  const worldMat = multiplyMat4(parentMat, localMat);
  const normalMat = computeNormalMatrix(worldMat);
  const nodeName = normalizeNodeName(node?.name);
  const nodeMatchedInclude = nodeName ? ctx.includeNodeNameSet.has(nodeName) : false;
  const nodeMatchedExclude = nodeName ? ctx.excludeNodeNameSet.has(nodeName) : false;
  const branchExcluded = ancestorExcluded || nodeMatchedExclude;
  const branchIncluded = ctx.includeNodeNameSet.size === 0
    ? true
    : ancestorIncluded || nodeMatchedInclude;

  if (!branchExcluded && branchIncluded && node.mesh !== undefined) {
    const mesh = gltf.meshes[node.mesh];
    for (const primitive of mesh.primitives ?? []) {
      const accessorPosition = gltf.accessors[primitive.attributes.POSITION];
      const accessorNormal = primitive.attributes.NORMAL !== undefined ? gltf.accessors[primitive.attributes.NORMAL] : null;
      const accessorColor = primitive.attributes.COLOR_0 !== undefined ? gltf.accessors[primitive.attributes.COLOR_0] : null;
      const accessorUv0 = primitive.attributes.TEXCOORD_0 !== undefined ? gltf.accessors[primitive.attributes.TEXCOORD_0] : null;
      const accessorIndices = primitive.indices !== undefined ? gltf.accessors[primitive.indices] : null;
      const materialInfo = getMaterialInfo(gltf, primitive.material);

      const positions = readAccessor(bin, gltf, accessorPosition);
      const normals = accessorNormal ? readAccessor(bin, gltf, accessorNormal) : null;
      const colorRaw = accessorColor ? readAccessor(bin, gltf, accessorColor) : null;
      const uvRaw = accessorUv0 ? readAccessor(bin, gltf, accessorUv0) : null;
      const indices = accessorIndices ? readIndices(bin, gltf, accessorIndices) : null;

      const vertCount = accessorPosition.count;
      const colorComps = accessorColor ? numComponents(accessorColor.type) : 0;
      const uvComps = accessorUv0 ? numComponents(accessorUv0.type) : 0;
      const hasUv = !!uvRaw && uvComps >= 2;
      const texIndex = materialInfo.baseColorTextureIndex;
      const shouldBakeTexture = ctx.options.bakeBaseColorTexture && !ctx.options.preserveBaseColorTexture;
      if (ctx.options.preserveBaseColorTexture && texIndex !== null && !ctx.baseColorTexture) {
        ctx.baseColorTexture = await getTextureSampler(ctx, texIndex);
      }
      const textureSampler = (
        shouldBakeTexture &&
        texIndex !== null &&
        hasUv
      )
        ? await getTextureSampler(ctx, texIndex)
        : null;
      const preserveTextureForRuntime = ctx.options.preserveBaseColorTexture && texIndex !== null && hasUv;
      const colors = buildColors({
        vertCount,
        colorRaw,
        colorComps,
        uvRaw,
        uvComps,
        textureSampler,
        preserveTextureForRuntime,
        materialInfo,
        defaultColor: ctx.options.defaultColor,
      });

      // 1) Transformar posiciones al espacio mundial
      const positionsWorld = new Float32Array(vertCount * 3);
      for (let i = 0; i < vertCount; i++) {
        const x = positions[i * 3 + 0];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const v = applyMat4(worldMat, [x, y, z]);
        positionsWorld[i * 3 + 0] = v[0];
        positionsWorld[i * 3 + 1] = v[1];
        positionsWorld[i * 3 + 2] = v[2];
      }

      // 2) Calcular normales en espacio mundial
      const normalsWorld = new Float32Array(vertCount * 3);
      if (normals) {
        for (let i = 0; i < vertCount; i++) {
          const nx = normals[i * 3 + 0];
          const ny = normals[i * 3 + 1];
          const nz = normals[i * 3 + 2];
          const n = applyNormalMat3(normalMat, [nx, ny, nz]);
          const len = Math.hypot(n[0], n[1], n[2]) || 1;
          normalsWorld[i * 3 + 0] = n[0] / len;
          normalsWorld[i * 3 + 1] = n[1] / len;
          normalsWorld[i * 3 + 2] = n[2] / len;
        }
      } else {
        // Generamos normales suavizadas a partir de las caras.
        if (indices) {
          for (let i = 0; i < indices.length; i += 3) {
            const ia = indices[i];
            const ib = indices[i + 1];
            const ic = indices[i + 2];
            accumulateFaceNormal(positionsWorld, normalsWorld, ia, ib, ic);
          }
        } else {
          for (let i = 0; i < vertCount; i += 3) {
            accumulateFaceNormal(positionsWorld, normalsWorld, i, i + 1, i + 2);
          }
        }
        normalizeNormals(normalsWorld);
      }

      const strideFloats = ctx.options.preserveBaseColorTexture ? 11 : 9;
      const vertBase = vertices.length / strideFloats;
      for (let i = 0; i < vertCount; i++) {
        const u = hasUv ? (uvRaw![i * uvComps + 0] ?? 0) : 0;
        const v = hasUv ? (uvRaw![i * uvComps + 1] ?? 0) : 0;
        vertices.push(
          positionsWorld[i * 3 + 0],
          positionsWorld[i * 3 + 1],
          positionsWorld[i * 3 + 2],
          normalsWorld[i * 3 + 0],
          normalsWorld[i * 3 + 1],
          normalsWorld[i * 3 + 2],
          colors[i * 3 + 0],
          colors[i * 3 + 1],
          colors[i * 3 + 2],
          ...(ctx.options.preserveBaseColorTexture ? [u, v] : []),
        );
      }

      if (indices) {
        for (let i = 0; i < indices.length; i++) {
          indicesAll.push(indices[i] + vertBase);
        }
      }
    }
  }

  for (const child of node.children ?? []) {
    await accumulateNode(ctx, child, worldMat, vertices, indicesAll, branchIncluded, branchExcluded);
  }
}

async function loadGlbChunks(url: string): Promise<GlbChunks> {
  const cached = glbChunkCache.get(url);
  if (cached) return cached;

  const pending = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GLB fetch failed: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return parseGlb(arrayBuffer);
  })();

  glbChunkCache.set(url, pending);
  try {
    return await pending;
  } catch (err) {
    glbChunkCache.delete(url);
    throw err;
  }
}

function parseGlb(arrayBuffer: ArrayBuffer): GlbChunks {
  const dv = new DataView(arrayBuffer);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error('Invalid GLB magic');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}`);

  // First chunk: JSON
  const jsonLen = dv.getUint32(12, true);
  const jsonType = dv.getUint32(16, true);
  if (jsonType !== 0x4E4F534A) throw new Error('First GLB chunk is not JSON');
  const jsonStart = 20;
  const jsonStr = new TextDecoder().decode(new Uint8Array(arrayBuffer, jsonStart, jsonLen));
  const json = JSON.parse(jsonStr);
  // Second chunk: BIN (padded to 4-byte boundary)
  const jsonPadded = (jsonLen + 3) & ~3;
  const binHeader = jsonStart + jsonPadded;
  const binLen = dv.getUint32(binHeader, true);
  const binType = dv.getUint32(binHeader + 4, true);
  if (binType !== 0x004E4942) throw new Error('Second GLB chunk is not BIN');
  const binStart = binHeader + 8;
  const bin = arrayBuffer.slice(binStart, binStart + binLen);
  return { json, bin };
}

function readAccessor(bin: ArrayBuffer, gltf: any, accessor: any): Float32Array {
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const accessorOffset = accessor.byteOffset || 0;
  const bufferOffset = bufferView.byteOffset || 0;
  const compCount = numComponents(accessor.type);
  const compSize = componentTypeSize(accessor.componentType);
  const stride = bufferView.byteStride || compCount * compSize;
  const count = accessor.count;
  const out = new Float32Array(count * compCount);
  const dv = new DataView(bin);
  let outIndex = 0;

  for (let i = 0; i < count; i++) {
    const base = bufferOffset + accessorOffset + i * stride;
    for (let c = 0; c < compCount; c++) {
      const byteOffset = base + c * compSize;
      const raw = readComponent(dv, byteOffset, accessor.componentType);
      out[outIndex++] = accessor.normalized ? normalizeComponent(raw, accessor.componentType) : raw;
    }
  }
  return out;
}

function readIndices(bin: ArrayBuffer, gltf: any, accessor: any): Uint16Array | Uint32Array {
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const accessorOffset = accessor.byteOffset || 0;
  const bufferOffset = bufferView.byteOffset || 0;
  const compSize = componentTypeSize(accessor.componentType);
  const stride = bufferView.byteStride || compSize;
  const count = accessor.count;
  const dv = new DataView(bin);
  const out32 = new Uint32Array(count);
  let max = 0;

  for (let i = 0; i < count; i++) {
    const base = bufferOffset + accessorOffset + i * stride;
    const val = readIndexComponent(dv, base, accessor.componentType);
    out32[i] = val;
    if (val > max) max = val;
  }

  if (accessor.componentType === 5125 || max > 65535) return out32;
  const out16 = new Uint16Array(count);
  for (let i = 0; i < count; i++) out16[i] = out32[i];
  return out16;
}

function numComponents(type: string): number {
  switch (type) {
    case 'SCALAR': return 1;
    case 'VEC2': return 2;
    case 'VEC3': return 3;
    case 'VEC4': return 4;
    case 'MAT4': return 16;
    default: throw new Error(`Unsupported accessor type ${type}`);
  }
}

function componentTypeSize(componentType: number): number {
  switch (componentType) {
    case 5120: return 1; // BYTE
    case 5121: return 1; // UNSIGNED_BYTE
    case 5122: return 2; // SHORT
    case 5123: return 2; // UNSIGNED_SHORT
    case 5125: return 4; // UNSIGNED_INT
    case 5126: return 4; // FLOAT
    default: throw new Error(`Unsupported componentType ${componentType}`);
  }
}

function readComponent(dv: DataView, byteOffset: number, componentType: number): number {
  switch (componentType) {
    case 5120: return dv.getInt8(byteOffset);
    case 5121: return dv.getUint8(byteOffset);
    case 5122: return dv.getInt16(byteOffset, true);
    case 5123: return dv.getUint16(byteOffset, true);
    case 5125: return dv.getUint32(byteOffset, true);
    case 5126: return dv.getFloat32(byteOffset, true);
    default: throw new Error(`Unsupported componentType ${componentType}`);
  }
}

function readIndexComponent(dv: DataView, byteOffset: number, componentType: number): number {
  switch (componentType) {
    case 5121: return dv.getUint8(byteOffset);
    case 5123: return dv.getUint16(byteOffset, true);
    case 5125: return dv.getUint32(byteOffset, true);
    default: throw new Error('Only UNSIGNED_BYTE/UNSIGNED_SHORT/UNSIGNED_INT indices supported');
  }
}

function normalizeComponent(value: number, componentType: number): number {
  switch (componentType) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32767, -1);
    case 5123: return value / 65535;
    case 5125: return value / 4294967295;
    case 5126: return value;
    default: return value;
  }
}

function getMaterialInfo(gltf: any, materialIndex: number | undefined): MaterialInfo {
  if (materialIndex === undefined || !gltf.materials?.[materialIndex]) {
    return {
      baseColorFactor: [1, 1, 1, 1],
      hasBaseColorFactor: false,
      baseColorTextureIndex: null,
    };
  }

  const mat = gltf.materials[materialIndex];
  const pbr = mat?.pbrMetallicRoughness ?? {};
  const factor = pbr.baseColorFactor;
  const baseColorFactor: [number, number, number, number] = (factor && factor.length >= 4)
    ? [factor[0], factor[1], factor[2], factor[3]]
    : [1, 1, 1, 1];

  return {
    baseColorFactor,
    hasBaseColorFactor: Array.isArray(factor) && factor.length >= 3,
    baseColorTextureIndex: pbr?.baseColorTexture?.index ?? null,
  };
}

function buildColors(params: {
  vertCount: number;
  colorRaw: Float32Array | null;
  colorComps: number;
  uvRaw: Float32Array | null;
  uvComps: number;
  textureSampler: TextureSampler | null;
  preserveTextureForRuntime: boolean;
  materialInfo: MaterialInfo;
  defaultColor: [number, number, number];
}): Float32Array {
  const {
    vertCount,
    colorRaw,
    colorComps,
    uvRaw,
    uvComps,
    textureSampler,
    preserveTextureForRuntime,
    materialInfo,
    defaultColor,
  } = params;
  const out = new Float32Array(vertCount * 3);
  const useTexture = !!textureSampler && !!uvRaw && uvComps >= 2;

  for (let i = 0; i < vertCount; i++) {
    let r = 1;
    let g = 1;
    let b = 1;

    if (colorRaw && colorComps > 0) {
      const base = i * colorComps;
      r = colorRaw[base + 0] ?? 1;
      g = colorRaw[base + 1] ?? r;
      b = colorRaw[base + 2] ?? r;
    } else if (!useTexture && !preserveTextureForRuntime && !materialInfo.hasBaseColorFactor) {
      r = defaultColor[0];
      g = defaultColor[1];
      b = defaultColor[2];
    }

    r *= materialInfo.baseColorFactor[0];
    g *= materialInfo.baseColorFactor[1];
    b *= materialInfo.baseColorFactor[2];

    if (useTexture) {
      const uvBase = i * uvComps;
      const u = uvRaw![uvBase + 0] ?? 0;
      const v = uvRaw![uvBase + 1] ?? 0;
      const tex = sampleTexture(textureSampler!, u, v);
      r *= tex[0];
      g *= tex[1];
      b *= tex[2];
    }

    out[i * 3 + 0] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }

  return out;
}

async function getTextureSampler(ctx: LoadContext, textureIndex: number): Promise<TextureSampler | null> {
  const existing = ctx.textureCache.get(textureIndex);
  if (existing) return existing;

  const pending = (async () => {
    const textureDef = ctx.gltf.textures?.[textureIndex];
    if (!textureDef) return null;
    const imageDef = ctx.gltf.images?.[textureDef.source];
    if (!imageDef) return null;

    const samplerDef = textureDef.sampler !== undefined ? ctx.gltf.samplers?.[textureDef.sampler] : null;
    const blob = await getImageBlob(ctx.gltf, ctx.bin, imageDef, ctx.baseUrl);
    if (!blob) return null;
    const imageData = await decodeImageData(blob);
    if (!imageData) return null;

    return {
      width: imageData.width,
      height: imageData.height,
      pixels: imageData.pixels,
      wrapS: ctx.options.forceBaseColorClamp ? 33071 : (samplerDef?.wrapS ?? 10497),
      wrapT: ctx.options.forceBaseColorClamp ? 33071 : (samplerDef?.wrapT ?? 10497),
    };
  })();

  ctx.textureCache.set(textureIndex, pending);
  return pending;
}

async function getImageBlob(gltf: any, bin: ArrayBuffer, imageDef: any, baseUrl: string): Promise<Blob | null> {
  if (imageDef.bufferView !== undefined) {
    const bv = gltf.bufferViews?.[imageDef.bufferView];
    if (!bv) return null;
    const offset = bv.byteOffset || 0;
    const length = bv.byteLength || 0;
    const bytes = new Uint8Array(bin, offset, length);
    return new Blob([bytes], { type: imageDef.mimeType || 'application/octet-stream' });
  }

  if (typeof imageDef.uri === 'string') {
    const uri = imageDef.uri;
    const resolved = uri.startsWith('data:') ? uri : resolveUri(baseUrl, uri);
    const res = await fetch(resolved);
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
    return await res.blob();
  }

  return null;
}

async function decodeImageData(blob: Blob): Promise<{ width: number; height: number; pixels: Uint8ClampedArray } | null> {
  if (typeof document === 'undefined') return null;

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return { width: canvas.width, height: canvas.height, pixels };
  }

  const image = await loadImageElement(blob);
  if (!image) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, pixels };
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function sampleTexture(tex: TextureSampler, u: number, v: number): [number, number, number] {
  const uu = wrapCoord(u, tex.wrapS);
  const vv = wrapCoord(v, tex.wrapT);
  const fx = uu * (tex.width - 1);
  const fy = vv * (tex.height - 1);
  const x0 = clamp(Math.floor(fx), 0, tex.width - 1);
  const y0 = clamp(Math.floor(fy), 0, tex.height - 1);
  const x1 = clamp(x0 + 1, 0, tex.width - 1);
  const y1 = clamp(y0 + 1, 0, tex.height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const c00 = texelRgb(tex, x0, y0);
  const c10 = texelRgb(tex, x1, y0);
  const c01 = texelRgb(tex, x0, y1);
  const c11 = texelRgb(tex, x1, y1);
  const r0 = mix(c00[0], c10[0], tx);
  const g0 = mix(c00[1], c10[1], tx);
  const b0 = mix(c00[2], c10[2], tx);
  const r1 = mix(c01[0], c11[0], tx);
  const g1 = mix(c01[1], c11[1], tx);
  const b1 = mix(c01[2], c11[2], tx);
  return [mix(r0, r1, ty), mix(g0, g1, ty), mix(b0, b1, ty)];
}

function texelRgb(tex: TextureSampler, x: number, y: number): [number, number, number] {
  const idx = (y * tex.width + x) * 4;
  const p = tex.pixels;
  return [p[idx + 0] / 255, p[idx + 1] / 255, p[idx + 2] / 255];
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrapCoord(value: number, mode: number): number {
  if (mode === 33071) { // CLAMP_TO_EDGE
    return clamp(value, 0, 1);
  }
  if (mode === 33648) { // MIRRORED_REPEAT
    const x = positiveModulo(value, 2);
    return x <= 1 ? x : 2 - x;
  }
  return positiveModulo(value, 1); // REPEAT
}

function positiveModulo(value: number, mod: number): number {
  return ((value % mod) + mod) % mod;
}

function toAbsoluteUrl(url: string): string {
  if (typeof window === 'undefined' || !window.location) return url;
  return new URL(url, window.location.href).toString();
}

function resolveUri(baseUrl: string, uri: string): string {
  return new URL(uri, baseUrl).toString();
}

function normalizeNodeName(name: string): string {
  return String(name ?? '').trim().toLowerCase();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function buildLocalMatrix(node: any): Float32Array {
  if (node.matrix) {
    return new Float32Array(node.matrix);
  }
  const t = node.translation ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  const r = node.rotation ?? [0, 0, 0, 1]; // quaternion
  return composeTRS(t, r, s);
}

function composeTRS(t: number[], q: number[], s: number[]): Float32Array {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  const sx = s[0], sy = s[1], sz = s[2];

  const out = new Float32Array(16);
  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;

  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;

  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;

  out[12] = t[0];
  out[13] = t[1];
  out[14] = t[2];
  out[15] = 1;
  return out;
}

function applyMat4(m: Float32Array, v: [number, number, number]): [number, number, number] {
  const x = v[0], y = v[1], z = v[2];
  const nx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const ny = m[1] * x + m[5] * y + m[9] * z + m[13];
  const nz = m[2] * x + m[6] * y + m[10] * z + m[14];
  return [nx, ny, nz];
}

function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
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

function identity(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

// --- Normales ---

function computeNormalMatrix(mat4: Float32Array): Float32Array {
  // Extraemos los 3x3 superiores (sin traslación)
  const a00 = mat4[0], a01 = mat4[4], a02 = mat4[8];
  const a10 = mat4[1], a11 = mat4[5], a12 = mat4[9];
  const a20 = mat4[2], a21 = mat4[6], a22 = mat4[10];

  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);

  const invDet = Math.abs(det) > 1e-8 ? 1 / det : 1e-8;

  // Inversa (row-major) y luego la transponemos al llenar (column-major del transpuesto)
  const b00 = (a11 * a22 - a12 * a21) * invDet;
  const b01 = (a02 * a21 - a01 * a22) * invDet;
  const b02 = (a01 * a12 - a02 * a11) * invDet;
  const b10 = (a12 * a20 - a10 * a22) * invDet;
  const b11 = (a00 * a22 - a02 * a20) * invDet;
  const b12 = (a02 * a10 - a00 * a12) * invDet;
  const b20 = (a10 * a21 - a11 * a20) * invDet;
  const b21 = (a01 * a20 - a00 * a21) * invDet;
  const b22 = (a00 * a11 - a01 * a10) * invDet;

  return new Float32Array([
    b00, b01, b02,
    b10, b11, b12,
    b20, b21, b22,
  ]);
}

function applyNormalMat3(mat3: Float32Array, n: [number, number, number]): [number, number, number] {
  const x = n[0], y = n[1], z = n[2];
  return [
    mat3[0] * x + mat3[3] * y + mat3[6] * z,
    mat3[1] * x + mat3[4] * y + mat3[7] * z,
    mat3[2] * x + mat3[5] * y + mat3[8] * z,
  ];
}

function accumulateFaceNormal(positions: Float32Array, normals: Float32Array, ia: number, ib: number, ic: number): void {
  const ax = positions[ia * 3 + 0], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
  const bx = positions[ib * 3 + 0], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
  const cx = positions[ic * 3 + 0], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];

  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;

  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;

  normals[ia * 3 + 0] += nx; normals[ia * 3 + 1] += ny; normals[ia * 3 + 2] += nz;
  normals[ib * 3 + 0] += nx; normals[ib * 3 + 1] += ny; normals[ib * 3 + 2] += nz;
  normals[ic * 3 + 0] += nx; normals[ic * 3 + 1] += ny; normals[ic * 3 + 2] += nz;
}

function normalizeNormals(normals: Float32Array): void {
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i], y = normals[i + 1], z = normals[i + 2];
    const len = Math.hypot(x, y, z) || 1;
    normals[i] = x / len;
    normals[i + 1] = y / len;
    normals[i + 2] = z / len;
  }
}
