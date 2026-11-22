const GRID_CELLS = 256;

export function hasHeightfieldSurface(element) {
  return element.type === 'box' && (element.params.randomBoxes
    || (element.params.perlinNoise && element.params.noiseAmplitude !== 0));
}

export function rasterizeBoxSurface(geometries) {
  const [width, depth, height] = geometries[0].args;
  const spacing = Math.max(width, depth) / GRID_CELLS;
  const columns = Math.max(2, Math.round(width / spacing) + 1);
  const rows = Math.max(2, Math.round(depth / spacing) + 1);
  const heights = new Float64Array(columns * rows).fill(-Infinity);
  const toPixel = (x, y, z) => [
    (x / width + 0.5) * (columns - 1),
    (0.5 - y / depth) * (rows - 1),
    z,
  ];
  const turn = ([ax, ay], [bx, by], x, y) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const paint = (a, b, c) => {
    const area = turn(a, b, c[0], c[1]);
    // PNG rows run from +Y to -Y, so an upward face winds clockwise here.
    if (area >= 0) return;
    const minX = Math.max(0, Math.ceil(Math.min(a[0], b[0], c[0]) - 1e-9));
    const maxX = Math.min(columns - 1, Math.floor(Math.max(a[0], b[0], c[0]) + 1e-9));
    const minY = Math.max(0, Math.ceil(Math.min(a[1], b[1], c[1]) - 1e-9));
    const maxY = Math.min(rows - 1, Math.floor(Math.max(a[1], b[1], c[1]) + 1e-9));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const u = turn(b, c, x, y) / area;
        const v = turn(c, a, x, y) / area;
        const w = 1 - u - v;
        if (Math.min(u, v, w) >= -1e-9) {
          const index = y * columns + x;
          heights[index] = Math.max(heights[index], u * a[2] + v * b[2] + w * c[2]);
        }
      }
    }
  };

  for (const geometry of geometries) {
    const [x, y, z] = geometry.position;
    if (geometry.shape === 'mesh') {
      const { vertices } = geometry;
      const points = Array.from({ length: geometry.topCount ?? vertices.length / 3 }, (_, index) => (
        toPixel(x + vertices[index * 3], y + vertices[index * 3 + 1], z + vertices[index * 3 + 2])
      ));
      const faces = geometry.topFaces ?? geometry.indices;
      for (let i = 0; i < faces.length; i += 3) {
        paint(points[faces[i]], points[faces[i + 1]], points[faces[i + 2]]);
      }
    } else {
      const [boxWidth, boxDepth, boxHeight] = geometry.args;
      const [a, b, c, d] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => (
        toPixel(x + u * boxWidth / 2, y + v * boxDepth / 2, z + boxHeight / 2)
      ));
      paint(a, b, c);
      paint(a, c, d);
    }
  }

  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (const sample of heights) {
    minHeight = Math.min(minHeight, sample);
    maxHeight = Math.max(maxHeight, sample);
  }
  const relief = maxHeight - minHeight > 1e-9 ? maxHeight - minHeight : 0;
  const pixels = relief > 0
    ? Uint8Array.from(heights, (sample) => Math.round((sample - minHeight) / relief * 255))
    : new Uint8Array(heights.length);
  return { width, depth, columns, rows, pixels, minHeight, relief, baseDepth: minHeight + height / 2 };
}
