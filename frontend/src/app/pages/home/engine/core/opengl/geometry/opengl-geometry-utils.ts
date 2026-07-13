export interface RadiusAndCenter {
  center: [number, number, number];
  radius: number;
}

export function computeRadiusAndCenter(geometry: { vertices: Float32Array; stride: number }): RadiusAndCenter {
  const strideFloats = geometry.stride / 4;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < geometry.vertices.length; i += strideFloats) {
    const x = geometry.vertices[i];
    const y = geometry.vertices[i + 1];
    const z = geometry.vertices[i + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const center: [number, number, number] = [
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  ];

  const radius = Math.max(
    Math.hypot(maxX - center[0], maxY - center[1], maxZ - center[2]),
    Math.hypot(minX - center[0], minY - center[1], minZ - center[2])
  );

  return { center, radius };
}
