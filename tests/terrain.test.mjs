import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PRESETS, getPreset } from '../src/data/presets.js';
import useSceneStore from '../src/store/useSceneStore.js';
import { getGroundOffset, getWorldBounds } from '../src/utils/grounding.js';
import { applySurfaceNoise, generateRoughnessHeightField, sampleHeightField, surfaceCollisionGeometries } from '../src/utils/surfaceNoise.js';
import { exportToXML } from '../src/utils/xmlExporter.js';
import { createSurfaceGeometry } from '../src/utils/surfaceGeometry.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const makeElement = (preset, params = {}) => ({
  type: preset.type, name: preset.xmlName, position: [0, 0, 0], rotation: [0, 0, 0],
  scale: [1, 1, 1], color: '#c8d3cb', groundLocked: true,
  params: { ...preset.defaultParams, ...params },
});

test('rough surface borders shade independently of vertical walls without changing triangles', () => {
  const preset = getPreset('box');
  const [geometry] = preset.toGeometries({ ...preset.defaultParams, perlinNoise: true });
  const buffer = createSurfaceGeometry(geometry);
  const normals = buffer.getAttribute('normal');
  close(normals.getX(0), 0);
  close(normals.getY(0), 0);
  close(normals.getZ(0), 1);
  const positions = buffer.getAttribute('position');
  assert.equal(buffer.index.count, geometry.indices.length);
  geometry.indices.forEach((original, index) => {
    const rendered = buffer.index.getX(index);
    close(positions.getX(rendered), geometry.vertices[original * 3]);
    close(positions.getY(rendered), geometry.vertices[original * 3 + 1]);
    close(positions.getZ(rendered), geometry.vertices[original * 3 + 2]);
    if (index >= geometry.topFaces.length * 2) close(normals.getZ(rendered), 0);
  });
  buffer.dispose();
});

test('fractal roughness and bilinear sampling match the LocoLab Python reference', () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/locolab-roughness.json', import.meta.url)));
  const field = generateRoughnessHeightField(expected.width, expected.depth, expected.params);
  assert.equal(field.columns, expected.columns);
  assert.equal(field.rows, expected.rows);
  close(field.horizontalScale, expected.horizontalScale);
  field.values.forEach((value, index) => close(value, expected.values[index]));
  assert.ok(field.values.some((value) => value < 0));
  assert.ok(field.values.some((value) => value > 0));
  assert.ok(Math.abs(field.values.reduce((sum, value) => sum + value, 0) / field.values.length) <= expected.params.noiseStep / 2);
  expected.samples.forEach(({ point, height }) => close(sampleHeightField(field, ...point), height));
});

test('floating stairs preserve tread tops and support custom thickness', () => {
  const preset = getPreset('stairs');
  const solid = preset.toGeometries(preset.defaultParams);
  for (const thickness of [0.05, 0.08]) {
    const params = { ...preset.defaultParams, floating: true, floatingThickness: thickness };
    const floating = preset.toGeometries(params);
    floating.forEach((geometry, index) => {
      close(geometry.args[2], thickness);
      close(geometry.position[2] + thickness / 2, solid[index].position[2] + solid[index].args[2] / 2);
    });
    close(preset.getGroundOffset(params), getGroundOffset(makeElement(preset, params)));
  }
});

test('adjacent patches share roughness at their seam; only the terrain border stays flat', () => {
  const params = { ...getPreset('box').defaultParams, perlinNoise: true, noiseStep: 0.001 };
  const patches = [-0.5, 0.5].map((x) => ({ args: [1, 2, 1], position: [x, 0, 0] }));
  const noisy = applySurfaceNoise(patches, params);
  const seams = noisy.map((geometry, index) => {
    const seam = [];
    for (let vertex = 0; vertex < geometry.topCount; vertex += 1) {
      const [x, y, z] = geometry.vertices.slice(vertex * 3, vertex * 3 + 3);
      if (Math.abs(x - (index === 0 ? 0.5 : -0.5)) < 1e-9) seam.push([y, z]);
      if (Math.abs(y) === 1 || Math.abs(x + patches[index].position[0]) === 1) close(z, 0.5);
      close((z - 0.5) / params.noiseStep, Math.round((z - 0.5) / params.noiseStep));
    }
    return seam;
  });
  assert.deepEqual(seams[0], seams[1]);
  assert.ok(seams[0].some(([, z]) => Math.abs(z - 0.5) > 1e-9));
});

test('deep depressions cannot invert thin floating treads', () => {
  const element = makeElement(getPreset('stairs'), { floating: true, floatingThickness: 0.01, perlinNoise: true, noiseAmplitude: 0.2 });
  let limited = false;
  for (const geometry of getPreset('stairs').toGeometries(element.params)) {
    for (let vertex = 0; vertex < geometry.topCount; vertex += 1) {
      const thickness = geometry.vertices[vertex * 3 + 2] - geometry.vertices[(vertex + geometry.topCount) * 3 + 2];
      assert.ok(thickness >= 0.001 - 1e-9);
      if (Math.abs(thickness - 0.001) < 1e-9) limited = true;
    }
  }
  assert.ok(limited);
  element.position[2] = getGroundOffset(element);
  close(getWorldBounds(element).min[2], 0);
});

for (const preset of PRESETS) {
  test(`${preset.type}: deterministic roughness, fixed base, watertight geometry, convex collision sections`, () => {
    const plain = preset.toGeometries(preset.defaultParams);
    const params = { ...preset.defaultParams, perlinNoise: true, noiseResolution: 8 };
    const noisy = preset.toGeometries(params);
    assert.deepEqual(noisy, preset.toGeometries(params));
    assert.notDeepEqual(noisy, preset.toGeometries({ ...params, noiseSeed: 42 }));
    assert.deepEqual(plain, preset.toGeometries({ ...params, noiseAmplitude: 0 }));
    let raised = false;
    let depressed = false;
    noisy.forEach((geometry, index) => {
      const height = plain[index].shape === 'cylinder' ? plain[index].args[1] : plain[index].args[2];
      for (let vertex = 0; vertex < geometry.topCount; vertex += 1) {
        const z = geometry.vertices[vertex * 3 + 2];
        assert.ok(z >= height / 2 - params.noiseAmplitude - 1e-9 && z <= height / 2 + params.noiseAmplitude + 1e-9);
        if (z > height / 2) raised = true;
        if (z < height / 2) depressed = true;
        close(geometry.vertices[(vertex + geometry.topCount) * 3 + 2], -height / 2);
      }
      const edges = new Map();
      for (let face = 0; face < geometry.indices.length; face += 3) {
        const triangle = geometry.indices.slice(face, face + 3);
        triangle.forEach((a, offset) => {
          const b = triangle[(offset + 1) % 3];
          const key = [Math.min(a, b), Math.max(a, b)].join(',');
          const edge = edges.get(key) || { count: 0, direction: 0 };
          edge.count += 1;
          edge.direction += a < b ? 1 : -1;
          edges.set(key, edge);
        });
      }
      for (const edge of edges.values()) assert.deepEqual(edge, { count: 2, direction: 0 });
      const columns = surfaceCollisionGeometries(geometry);
      assert.equal(columns.length, geometry.topFaces.length / 3);
      columns.forEach((column) => {
        assert.equal(column.vertices.length, 18);
        const [ax, ay, , bx, by, , cx, cy] = column.vertices;
        assert.ok((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0);
      });
    });
    assert.ok(raised);
    assert.ok(depressed);
    const element = makeElement(preset, params);
    element.rotation = [17, 23, 31];
    element.scale = [1.2, 0.8, 1.5];
    element.position[2] = getGroundOffset(element);
    close(getWorldBounds(element).min[2], 0);
    const xml = exportToXML([element]);
    const metadata = JSON.parse(decodeURIComponent(xml.match(/MTE_DATA (.*?) -->/)[1]));
    const meshCount = (xml.match(/<mesh /g) || []).length;
    assert.equal(metadata.geomCount, meshCount);
    assert.equal((xml.match(/type="mesh"/g) || []).length, meshCount);
    assert.deepEqual(metadata.element.params, params);
    assert.ok(!xml.includes('NaN'));
  });
}

test('noise and floating settings survive scene loading and undo/redo; old files get defaults', () => {
  useSceneStore.getState().loadElements([]);
  useSceneStore.getState().addElement('stairs');
  const original = useSceneStore.getState().elements[0];
  const params = { ...original.params, floating: true, floatingThickness: 0.08, perlinNoise: true, noiseSeed: 42 };
  useSceneStore.getState().updateElement(original.id, { params });
  useSceneStore.getState().undo();
  assert.deepEqual(useSceneStore.getState().elements[0].params, original.params);
  useSceneStore.getState().redo();
  assert.deepEqual(useSceneStore.getState().elements[0].params, params);
  useSceneStore.getState().loadElements([{ ...original, params }]);
  assert.deepEqual(useSceneStore.getState().elements[0].params, params);
  const { noiseStep, ...oldNoiseParams } = params;
  useSceneStore.getState().loadElements([{ ...original, params: oldNoiseParams }]);
  assert.equal(useSceneStore.getState().elements[0].params.noiseStep, noiseStep);
  useSceneStore.getState().loadElements([{ ...original, params: { stepWidth: 2, stepLength: 0.3, stepHeight: 0.15, steps: 8 } }]);
  assert.deepEqual(useSceneStore.getState().elements[0].params, getPreset('stairs').defaultParams);
});
