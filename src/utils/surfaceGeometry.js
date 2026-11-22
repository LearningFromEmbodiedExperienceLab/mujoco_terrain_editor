import { BufferGeometry, Float32BufferAttribute } from 'three';

export function createSurfaceGeometry(geometry) {
  const vertices = [...geometry.vertices];
  const indices = [...geometry.indices];
  // Keep smooth relief normals separate from the hard walls and underside.
  for (let index = (geometry.topFaces?.length ?? 0) * 2; index < indices.length; index += 1) {
    const source = indices[index] * 3;
    indices[index] = vertices.length / 3;
    vertices.push(...geometry.vertices.slice(source, source + 3));
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  result.setIndex(indices);
  result.computeVertexNormals();
  if (!geometry.topFaces) return result;
  const baseHeight = geometry.args.at(-1) / 2;
  let relief = 0;
  for (let index = 0; index < geometry.topCount; index += 1) {
    relief = Math.max(relief, Math.abs(vertices[index * 3 + 2] - baseHeight));
  }
  const colors = new Float32Array(vertices.length).fill(1);
  // A restrained neutral tint reveals shallow relief without altering its shape or hue.
  if (relief > 0) {
    for (let index = 0; index < geometry.topCount; index += 1) {
      const shade = 0.72 + 0.28 * (vertices[index * 3 + 2] - baseHeight) / relief;
      colors.fill(shade, index * 3, index * 3 + 3);
    }
  }
  result.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return result;
}
