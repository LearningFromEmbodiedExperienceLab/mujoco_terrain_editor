import { createSeededRandom } from './seededRandom.js';

export const NOISE_PARAMETERS = [
  { key: 'perlinNoise', label: { zh: '应用 Perlin 噪声', en: 'Apply Perlin Noise' }, type: 'boolean', default: false },
  { key: 'noiseAmplitude', label: { zh: '噪声高度', en: 'Noise Amplitude' }, unit: 'M', default: 0.02, min: 0, step: 0.005, visibleWhen: ({ perlinNoise }) => perlinNoise },
  { key: 'noiseStep', label: { zh: '噪声高度步长', en: 'Noise Height Step' }, unit: 'M', default: 0.01, min: 0.001, step: 0.001, visibleWhen: ({ perlinNoise }) => perlinNoise },
  { key: 'noiseFrequency', label: { zh: '噪声频率', en: 'Noise Frequency' }, unit: '1/M', default: 2, min: 0.1, step: 0.1, visibleWhen: ({ perlinNoise }) => perlinNoise },
  { key: 'noiseSeed', label: { zh: '随机种子', en: 'Noise Seed' }, unit: '', default: 1, min: 0, max: 2147483647, step: 1, integer: true, visibleWhen: ({ perlinNoise }) => perlinNoise },
  { key: 'noiseResolution', label: { zh: '表面细分数', en: 'Surface Resolution' }, unit: '', default: 16, min: 4, max: 32, step: 1, integer: true, visibleWhen: ({ perlinNoise }) => perlinNoise },
];

function roundEven(value) {
  const lower = Math.floor(value);
  return value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
}

// Adapted from LocoLab's shared two-octave roughness sampler. Grid values are
// centered before range scaling and quantization; interpolation happens last.
export function generateRoughnessHeightField(width, depth, params) {
  const horizontalScale = Math.max(width, depth) / params.noiseResolution;
  const columns = Math.max(2, Math.floor(width / horizontalScale) + 1);
  const rows = Math.max(2, Math.floor(depth / horizontalScale) + 1);
  const values = new Array(columns * rows).fill(0);
  const random = createSeededRandom(params.noiseSeed);
  const downsampledScale = Math.max(0.5 / params.noiseFrequency, horizontalScale) * 2 ** random();
  let cellSize = 2 * downsampledScale / horizontalScale;
  let amplitude = 1;
  let amplitudeSum = 0;
  const fade = (value) => value ** 3 * (value * (value * 6 - 15) + 10);
  const lerp = (a, b, amount) => a + (b - a) * amount;
  for (let octave = 0; octave < 2; octave += 1) {
    const latticeColumns = Math.floor((columns - 1) / cellSize) + 2;
    const latticeRows = Math.floor((rows - 1) / cellSize) + 2;
    const angles = Array.from({ length: latticeColumns * latticeRows }, () => random() * Math.PI * 2);
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const x = column / cellSize;
        const y = row / cellSize;
        const cellX = Math.floor(x);
        const cellY = Math.floor(y);
        const dx = x - cellX;
        const dy = y - cellY;
        const dot = (offsetX, offsetY) => {
          const angle = angles[(cellX + offsetX) * latticeRows + cellY + offsetY];
          return (dx - offsetX) * Math.cos(angle) + (dy - offsetY) * Math.sin(angle);
        };
        const noise = lerp(lerp(dot(0, 0), dot(1, 0), fade(dx)), lerp(dot(0, 1), dot(1, 1), fade(dx)), fade(dy));
        values[column * rows + row] += amplitude * (Math.SQRT2 * noise * 0.5 + 0.5);
      }
    }
    amplitudeSum += amplitude;
    amplitude *= 0.25;
    cellSize /= 2;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const limit = roundEven(params.noiseAmplitude / params.noiseStep) * params.noiseStep;
  for (let index = 0; index < values.length; index += 1) {
    const normalized = Math.max(-1, Math.min(1, (values[index] - mean) / (0.5 * amplitudeSum)));
    const quantized = roundEven(normalized * params.noiseAmplitude / params.noiseStep) * params.noiseStep;
    values[index] = Math.max(-limit, Math.min(limit, quantized));
  }
  return { values, columns, rows, horizontalScale };
}

export function sampleHeightField(field, x, y) {
  const fx = Math.max(0, Math.min(field.columns - 1, x / field.horizontalScale));
  const fy = Math.max(0, Math.min(field.rows - 1, y / field.horizontalScale));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, field.columns - 1);
  const y1 = Math.min(y0 + 1, field.rows - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (column, row) => field.values[column * field.rows + row];
  return at(x0, y0) * (1 - tx) * (1 - ty) + at(x1, y0) * tx * (1 - ty)
    + at(x0, y1) * (1 - tx) * ty + at(x1, y1) * tx * ty;
}

export function buildSurfaceMesh(geometry, height, points, topFaces, boundary, reliefAt) {
  const vertices = [];
  const minRelief = -height + Math.min(0.001, height / 2);
  for (const [x, y] of points) {
    vertices.push(x, y, height / 2 + Math.max(minRelief, reliefAt(x, y)));
  }
  for (const [x, y] of points) vertices.push(x, y, -height / 2);

  const topCount = points.length;
  const indices = [...topFaces];
  for (let index = 0; index < topFaces.length; index += 3) {
    indices.push(topFaces[index + 2] + topCount, topFaces[index + 1] + topCount, topFaces[index] + topCount);
  }
  for (const [a, b] of boundary) {
    indices.push(a, a + topCount, b + topCount, a, b + topCount, b);
  }
  return { ...geometry, shape: 'mesh', vertices, indices, topFaces, topCount };
}

function noisyGeometry(geometry, params, field, bounds) {
  const circular = geometry.shape === 'cylinder';
  const [width, depth, height] = circular
    ? [geometry.args[0] * 2, geometry.args[0] * 2, geometry.args[1]]
    : geometry.args;
  const points = [];
  const topFaces = [];
  const boundary = [];
  let surfaceGrid;
  const reliefAt = (x, y) => {
    const sampleX = x + geometry.position[0] - bounds.minX;
    const sampleY = y + geometry.position[1] - bounds.minY;
    const border = field.horizontalScale;
    const onBorder = sampleX < border || sampleY < border
      || sampleX > bounds.width - border || sampleY > bounds.depth - border;
    return onBorder ? 0 : sampleHeightField(field, sampleX, sampleY);
  };

  if (circular) {
    const rings = Math.max(2, Math.ceil(width / 2 / field.horizontalScale));
    const segments = Math.max(48, params.noiseResolution * 4);
    points.push([0, 0]);
    for (let ring = 1; ring <= rings; ring += 1) {
      const radius = width / 2 * ring / rings;
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = segment / segments * Math.PI * 2;
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
        const current = 1 + (ring - 1) * segments + segment;
        const next = 1 + (ring - 1) * segments + (segment + 1) % segments;
        if (ring === 1) topFaces.push(0, current, next);
        else {
          const previous = current - segments;
          const previousNext = next - segments;
          topFaces.push(previous, current, next, previous, next, previousNext);
        }
        if (ring === rings) boundary.push([current, next]);
      }
    }
  } else {
    const columns = Math.max(2, Math.ceil(width / field.horizontalScale));
    const rows = Math.max(2, Math.ceil(depth / field.horizontalScale));
    surfaceGrid = { columns, rows, field };
    for (let row = 0; row <= rows; row += 1) {
      for (let column = 0; column <= columns; column += 1) {
        points.push([width * (column / columns - 0.5), depth * (row / rows - 0.5)]);
        const current = row * (columns + 1) + column;
        if (row < rows && column < columns) {
          const above = current + columns + 1;
          topFaces.push(current, current + 1, above + 1, current, above + 1, above);
        }
        if (row === 0 && column < columns) boundary.push([current, current + 1]);
        if (column === columns && row < rows) boundary.push([current, current + columns + 1]);
        if (row === rows && column > 0) boundary.push([current, current - 1]);
        if (column === 0 && row > 0) boundary.push([current, current - columns - 1]);
      }
    }
  }

  return buildSurfaceMesh({ ...geometry, surfaceGrid }, height, points, topFaces, boundary, reliefAt);
}

export function applySurfaceNoise(geometries, params) {
  if (!params.perlinNoise || params.noiseAmplitude === 0) return geometries;
  const extents = geometries.map((geometry) => ({
    x: geometry.position[0], y: geometry.position[1],
    width: geometry.shape === 'cylinder' ? geometry.args[0] * 2 : geometry.args[0],
    depth: geometry.shape === 'cylinder' ? geometry.args[0] * 2 : geometry.args[1],
  }));
  const minX = Math.min(...extents.map((extent) => extent.x - extent.width / 2));
  const minY = Math.min(...extents.map((extent) => extent.y - extent.depth / 2));
  const width = Math.max(...extents.map((extent) => extent.x + extent.width / 2)) - minX;
  const depth = Math.max(...extents.map((extent) => extent.y + extent.depth / 2)) - minY;
  const field = generateRoughnessHeightField(width, depth, params);
  return geometries.map((geometry) => noisyGeometry(geometry, params, field, { minX, minY, width, depth }));
}
