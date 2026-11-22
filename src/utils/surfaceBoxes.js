import { createSeededRandom } from './seededRandom.js';
import { buildSurfaceMesh, sampleHeightField } from './surfaceNoise.js';

function surfaceHeight(base, x, y) {
  const [width, depth, height] = base.args;
  if (!base.surfaceGrid) return height / 2;

  const { columns, rows } = base.surfaceGrid;
  const gridX = (x / width + 0.5) * columns;
  const gridY = (y / depth + 0.5) * rows;
  const column = Math.min(columns - 1, Math.floor(gridX));
  const row = Math.min(rows - 1, Math.floor(gridY));
  const tx = gridX - column;
  const ty = gridY - row;
  const lowerLeft = row * (columns + 1) + column;
  const upperLeft = lowerLeft + columns + 1;
  const z = (vertex) => base.vertices[vertex * 3 + 2];
  // The mesh splits each cell along the lower-left to upper-right diagonal.
  return z(lowerLeft) * (1 - Math.max(tx, ty))
    + z(upperLeft + 1) * Math.min(tx, ty)
    + z(tx >= ty ? lowerLeft + 1 : upperLeft) * Math.abs(tx - ty);
}

function clipEdge(polygon, axis, boundary, sign) {
  const clipped = [];
  let previous = polygon.at(-1);
  for (const point of polygon) {
    const start = sign * (previous[axis] - boundary);
    const end = sign * (point[axis] - boundary);
    if ((start < 0 && end > 0) || (start > 0 && end < 0)) {
      const other = 1 - axis;
      const intersection = [...point];
      intersection[axis] = boundary;
      intersection[other] = previous[other] + (point[other] - previous[other]) * (start / (start - end));
      clipped.push(intersection);
    }
    if (end >= 0) clipped.push(point);
    previous = point;
  }
  return clipped;
}

function extrudeFootprint(footprint, height, position) {
  const [x, y] = position;
  const count = footprint.length;
  const vertices = [height / 2, -height / 2]
    .flatMap((z) => footprint.flatMap(([px, py]) => [px - x, py - y, z]));
  const indices = [];
  for (let i = 1; i < count - 1; i += 1) {
    indices.push(0, i, i + 1, count, count + i + 1, count + i);
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    indices.push(i, i + count, next + count, i, next + count, next);
  }
  return { shape: 'mesh', vertices, indices, position };
}

function roughFootprint(footprint, args, position, spacing, reliefAt) {
  const [x, y] = position;
  const outline = footprint.map(([px, py]) => [px - x, py - y]);
  const centerX = outline.reduce((sum, [px]) => sum + px, 0) / outline.length;
  const centerY = outline.reduce((sum, [, py]) => sum + py, 0) / outline.length;
  const perimeter = outline.flatMap(([ax, ay], index) => {
    const [bx, by] = outline[(index + 1) % outline.length];
    const segments = Math.ceil(Math.hypot(bx - ax, by - ay) / spacing);
    return Array.from({ length: segments }, (_, i) => [
      ax + (bx - ax) * i / segments,
      ay + (by - ay) * i / segments,
    ]);
  });
  const radius = Math.max(...outline.map(([px, py]) => Math.hypot(px - centerX, py - centerY)));
  const rings = Math.ceil(radius / spacing);
  const points = [[centerX, centerY]];
  const topFaces = [];
  const boundary = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    perimeter.forEach(([px, py], segment) => {
      points.push([centerX + (px - centerX) * ring / rings, centerY + (py - centerY) * ring / rings]);
      const current = 1 + (ring - 1) * perimeter.length + segment;
      const next = 1 + (ring - 1) * perimeter.length + (segment + 1) % perimeter.length;
      if (ring === 1) topFaces.push(0, current, next);
      else {
        const previous = current - perimeter.length;
        const previousNext = next - perimeter.length;
        topFaces.push(previous, current, next, previous, next, previousNext);
      }
      if (ring === rings) boundary.push([current, next]);
    });
  }
  return buildSurfaceMesh({ args, position }, args[2], points, topFaces, boundary, reliefAt);
}

export function generateSurfaceBoxes(base, params) {
  const [width, depth] = base.args;
  const field = base.surfaceGrid?.field;
  const random = createSeededRandom(params.randomBoxSeed);
  const sample = (a, b) => Math.min(a, b) + Math.abs(b - a) * random();

  return Array.from({ length: params.randomBoxCount }, () => {
    const boxWidth = sample(params.randomBoxMinWidth, params.randomBoxMaxWidth);
    const boxDepth = sample(params.randomBoxMinDepth, params.randomBoxMaxDepth);
    const boxHeight = sample(params.randomBoxMinHeight, params.randomBoxMaxHeight);
    const x = (random() - 0.5) * width;
    const y = (random() - 0.5) * depth;
    const yaw = sample(params.randomBoxMinYaw, params.randomBoxMaxYaw) * Math.PI / 180;
    const position = [x, y, surfaceHeight(base, x, y) + boxHeight / 2];
    if (!field && yaw === 0 && Math.abs(x) + boxWidth / 2 <= width / 2 && Math.abs(y) + boxDepth / 2 <= depth / 2) {
      return { args: [boxWidth, boxDepth, boxHeight], position };
    }

    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const footprint = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [
      x + (u * boxWidth * cos - v * boxDepth * sin) / 2,
      y + (u * boxWidth * sin + v * boxDepth * cos) / 2,
    ]);
    const left = clipEdge(footprint, 0, -width / 2, 1);
    const right = clipEdge(left, 0, width / 2, -1);
    const bottom = clipEdge(right, 1, -depth / 2, 1);
    const clipped = clipEdge(bottom, 1, depth / 2, -1);
    if (!field) return extrudeFootprint(clipped, boxHeight, position);
    return roughFootprint(clipped, [boxWidth, boxDepth, boxHeight], position, field.horizontalScale,
      (px, py) => sampleHeightField(field, px + x + width / 2, py + y + depth / 2));
  });
}
