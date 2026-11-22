import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Mesh, Raycaster, Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { PRESETS, getPreset } from '../src/data/presets.js';
import useSceneStore from '../src/store/useSceneStore.js';
import { getGroundOffset, getWorldBounds } from '../src/utils/grounding.js';
import { applySurfaceNoise, generateRoughnessHeightField, sampleHeightField } from '../src/utils/surfaceNoise.js';
import { surfaceCollisionGeometries } from '../src/utils/surfaceCollision.js';
import { rasterizeBoxSurface } from '../src/utils/heightfield.js';
import { exportHeightfieldScene, exportToXML } from '../src/utils/xmlExporter.js';
import { createSurfaceGeometry } from '../src/utils/surfaceGeometry.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const makeElement = (preset, params = {}) => ({
  type: preset.type, name: preset.xmlName, position: [0, 0, 0], rotation: [0, 0, 0],
  scale: [1, 1, 1], color: '#c8d3cb', groundLocked: true,
  params: { ...preset.defaultParams, ...params },
});

function checkCollisionVolume(geometry, pieces) {
  const { vertices, topFaces, topCount } = geometry;
  const bottom = vertices[topCount * 3 + 2];
  let volume = 0;
  for (let i = 0; i < topFaces.length; i += 3) {
    const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = topFaces.slice(i, i + 3)
      .map((vertex) => vertices.slice(vertex * 3, vertex * 3 + 3));
    const area = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    assert.ok(area > 0);
    volume += area * ((az + bz + cz) / 3 - bottom);
  }
  const collisionVolume = pieces.reduce((sum, piece) => {
    const points = Array.from({ length: piece.vertices.length / 3 }, (_, index) => (
      new Vector3().fromArray(piece.vertices, index * 3)
    ));
    const hull = new ConvexHull().setFromPoints(points);
    return hull.faces.reduce((total, face) => total + face.area * face.constant / 3, sum);
  }, 0);
  close(collisionVolume, volume);
}

test('random boxes are reproducible and clip at base edges and corners', () => {
  const preset = getPreset('box');
  assert.equal(preset.toGeometries({}).length, 1);
  const params = {
    width: 0.5, depth: 0.4, height: 0.2, randomBoxes: true, randomBoxCount: 40,
    randomBoxMinWidth: 0.2, randomBoxMaxWidth: 0.1,
    randomBoxMinDepth: 0.12, randomBoxMaxDepth: 0.15,
    randomBoxMinHeight: 0.07, randomBoxMaxHeight: 0.11,
  };
  const geometries = preset.toGeometries(params);
  assert.deepEqual(geometries, preset.toGeometries(params));
  assert.notDeepEqual(geometries, preset.toGeometries({ ...params, randomBoxSeed: 42 }));
  const boxes = geometries.slice(1);
  assert.equal(boxes.length, params.randomBoxCount);
  let clipsCorner = false;
  assert.ok(boxes.some(({ args }) => args));
  for (const { args, vertices, position: [x, y, z] } of boxes) {
    const height = args ? args[2] : vertices[2] * 2;
    assert.ok(height >= 0.07 && height <= 0.11);
    close(z - height / 2, params.height / 2);
    if (args) {
      assert.ok(args[0] >= 0.1 && args[0] <= 0.2);
      assert.ok(args[1] >= 0.12 && args[1] <= 0.15);
      assert.ok(Math.abs(x) + args[0] / 2 <= params.width / 2 + 1e-9);
      assert.ok(Math.abs(y) + args[1] / 2 <= params.depth / 2 + 1e-9);
    } else {
      assert.equal(vertices.length, 24);
      for (let i = 0; i < vertices.length; i += 3) {
        const px = Math.abs(x + vertices[i]);
        const py = Math.abs(y + vertices[i + 1]);
        assert.ok(px <= params.width / 2 + 1e-9 && py <= params.depth / 2 + 1e-9);
        if (Math.abs(px - params.width / 2) < 1e-9 && Math.abs(py - params.depth / 2) < 1e-9) {
          clipsCorner = true;
        }
      }
    }
  }
  assert.ok(clipsCorner);
});

test('yaw rotates boxes before clipping and preserves their convex footprints', () => {
  const preset = getPreset('box');
  const params = {
    randomBoxes: true, randomBoxCount: 50, randomBoxMinYaw: -40, randomBoxMaxYaw: -20,
    randomBoxMinWidth: 0.3, randomBoxMaxWidth: 0.3,
    randomBoxMinDepth: 0.2, randomBoxMaxDepth: 0.2,
  };
  const boxes = preset.toGeometries(params).slice(1);
  const sampledAngles = new Set();
  let clipped = false;
  for (const box of boxes) {
    assert.deepEqual(surfaceCollisionGeometries(box), [box]);
    const count = box.vertices.length / 6;
    const [x, y] = box.position;
    let area = 0;
    for (let i = 0; i < count; i += 1) {
      const [ax, ay] = box.vertices.slice(i * 3, i * 3 + 2);
      const [bx, by] = box.vertices.slice(((i + 1) % count) * 3);
      assert.ok(Math.abs(ax + x) <= 0.5 + 1e-9 && Math.abs(ay + y) <= 0.5 + 1e-9);
      area += (ax * by - ay * bx) / 2;
      if (Math.abs(bx - ax) > 1e-9 && Math.abs(by - ay) > 1e-9) {
        const degrees = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
        const yaw = ((degrees % 90) + 180) % 90 - 90;
        assert.ok(yaw >= -40 - 1e-9 && yaw <= -20 + 1e-9);
        sampledAngles.add(yaw.toFixed(3));
      }
    }
    assert.ok(area > 0 && area <= 0.06 + 1e-9);
    if (area < 0.06 - 1e-9) clipped = true;
  }
  assert.ok(clipped && sampledAngles.size > 1);
});

test('Perlin roughens uncut and clipped box tops with compact collision meshes', () => {
  const preset = getPreset('box');
  for (const yaw of [0, 35]) {
    const element = makeElement(preset, {
      width: 1, depth: 0.8, height: 0.4, randomBoxes: true, randomBoxCount: 24,
      randomBoxMinWidth: 0.19, randomBoxMaxWidth: 0.32,
      randomBoxMinDepth: 0.13, randomBoxMaxDepth: 0.28,
      randomBoxMinYaw: yaw, randomBoxMaxYaw: yaw,
      perlinNoise: true, noiseAmplitude: 0.3, noiseResolution: 8,
    });
    const [base, ...boxes] = preset.toGeometries(element.params);
    const [, ...flatBoxes] = preset.toGeometries({ ...element.params, perlinNoise: false });
    assert.deepEqual(base, preset.toGeometries({ ...element.params, randomBoxes: false })[0]);
    assert.equal(boxes.length, element.params.randomBoxCount);
    const surface = new Mesh(createSurfaceGeometry(base));
    const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1));
    let roughUncut = false;
    let roughClipped = false;
    boxes.forEach(({ args: [width, depth, height], vertices, topCount, topFaces, position: [x, y, z] }, index) => {
      assert.deepEqual([x, y], flatBoxes[index].position.slice(0, 2));
      ray.ray.origin.set(x, y, 1);
      const [hit] = ray.intersectObject(surface);
      close(z - height / 2, hit.point.z);

      const top = [];
      for (let i = 0; i < topCount; i += 1) {
        const [px, py, pz] = vertices.slice(i * 3, i * 3 + 3);
        const bottom = vertices.slice((topCount + i) * 3, (topCount + i) * 3 + 3);
        assert.ok(Math.abs(x + px) <= 0.5 + 1e-9 && Math.abs(y + py) <= 0.4 + 1e-9);
        assert.ok(pz - bottom[2] >= 0.001 - 1e-9);
        assert.deepEqual(bottom, [px, py, -height / 2]);
        top.push(pz);
      }
      let area = 0;
      for (let i = 0; i < topFaces.length; i += 3) {
        const [[ax, ay], [bx, by], [cx, cy]] = topFaces.slice(i, i + 3)
          .map((vertex) => vertices.slice(vertex * 3, vertex * 3 + 2));
        area += ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
      }
      assert.ok(area > 0 && area <= width * depth + 1e-9);
      if (Math.max(...top) - Math.min(...top) > 1e-6) {
        if (area < width * depth - 1e-9) roughClipped = true;
        else roughUncut = true;
      }
    });
    surface.geometry.dispose();
    surface.material.dispose();
    assert.ok(roughUncut);
    assert.ok(roughClipped);

    const xml = exportToXML([element]);
    const metadata = JSON.parse(decodeURIComponent(xml.match(/MTE_DATA (.*?) -->/)[1]));
    assert.equal((xml.match(/type="mesh"/g) || []).length, metadata.geomCount);
    let pieceCount = 0;
    for (const geometry of [base, ...boxes]) {
      const pieces = surfaceCollisionGeometries(geometry);
      checkCollisionVolume(geometry, pieces);
      pieceCount += pieces.length;
    }
    assert.equal(metadata.geomCount, pieceCount);
    assert.ok(pieceCount < [base, ...boxes].reduce((sum, geometry) => sum + geometry.topFaces.length / 3, 0));
    assert.deepEqual(metadata.element.params, element.params);
  }
});

test('Box heightfields record the highest surfaces with +Y at the top of the PNG', () => {
  const field = rasterizeBoxSurface([
    { args: [1, 0.5, 0.2], position: [0, 0, 0] },
    { args: [0.25, 0.125, 0.2], position: [-0.25, 0.125, 0.2] },
    { args: [0.125, 0.0625, 0.3], position: [-0.25, 0.125, 0.25] },
  ]);
  assert.equal(field.columns, 257);
  assert.equal(field.rows, 129);
  close(field.minHeight, 0.1);
  close(field.baseDepth, 0.2);
  close(field.relief, 0.3);
  assert.equal(field.pixels[32 * field.columns + 64], 255);
  assert.equal(field.pixels[96 * field.columns + 64], 0);

  const box = makeElement(getPreset('box'), {
    randomBoxes: true, randomBoxMinYaw: 30, randomBoxMaxYaw: 70,
    perlinNoise: true, noiseAmplitude: 0.08,
  });
  const ramp = makeElement(getPreset('ramp'));
  const { xml, heightfields } = exportHeightfieldScene([box, ramp]);
  assert.equal(heightfields.length, 1);
  assert.ok(new Set(heightfields[0].pixels).size > 20);
  assert.match(xml, /<hfield name="mte_heightfield_1" file="mte_heightfield_1.png"/);
  assert.match(xml, /type="hfield" hfield="mte_heightfield_1"/);
  assert.match(xml, /name="Ramp" type="box"/);
  const metadata = JSON.parse(decodeURIComponent(xml.match(/MTE_DATA (.*?) -->/)[1]));
  assert.deepEqual(metadata.element.params, box.params);
  assert.equal(metadata.geomCount, 1);
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
      checkCollisionVolume(geometry, surfaceCollisionGeometries(geometry));
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
