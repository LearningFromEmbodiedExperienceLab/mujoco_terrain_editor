import * as THREE from 'three';
import { getPreset } from '../data/presets.js';
import { sanitizeXmlName } from './xmlNames.js';
import { surfaceCollisionGeometries } from './surfaceCollision.js';
import { hasHeightfieldSurface, rasterizeBoxSurface } from './heightfield.js';

const round = (value) => {
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  return Number(normalized.toFixed(6)).toString();
};

const vector = (values) => values.map(round).join(' ');

const escapeXML = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const attrs = (values) => Object.entries(values)
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => `${key}="${escapeXML(value)}"`)
  .join(' ');

function hexToRgba(hex) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#cccccc';
  return [1, 3, 5].map((offset) => round(parseInt(safe.slice(offset, offset + 2), 16) / 255)).join(' ') + ' 1';
}

function editorMetadata(element, geomCount) {
  // MuJoCo ignores comments, so the simulation still sees flat world geoms.
  // Hyphens are escaped because an XML comment cannot contain "--".
  const payload = encodeURIComponent(JSON.stringify({
    version: 1,
    geomCount,
    element: {
      type: element.type,
      name: element.name,
      position: element.position,
      rotation: element.rotation,
      scale: element.scale,
      groundLocked: element.groundLocked,
      color: element.color,
      params: element.params,
    },
  })).replaceAll('-', '%2D');
  return `    <!-- MTE_DATA ${payload} -->`;
}

function elementGeoms(element, elementIndex, assets, heightfields) {
  const preset = getPreset(element.type);
  if (!preset) return '';
  const sourceGeometries = preset.toGeometries(element.params);
  if (!sourceGeometries.length) return '';
  const elementNumber = String(elementIndex + 1).padStart(3, '0');
  const namePrefix = sanitizeXmlName(element.name, `${preset.xmlName}_${elementNumber}`);
  const elementQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    ...element.rotation.map((degree) => degree * Math.PI / 180),
  ));
  if (heightfields && hasHeightfieldSurface(element)) {
    const field = rasterizeBoxSurface(sourceGeometries);
    const hfield = `mte_heightfield_${elementIndex + 1}`;
    const file = `${hfield}.png`;
    heightfields.push({ ...field, file });
    const [sx, sy, sz] = element.scale;
    const size = vector([field.width * sx / 2, field.depth * sy / 2,
      Math.max(1e-6, field.relief * sz), field.baseDepth * sz]);
    const position = new THREE.Vector3(0, 0, field.minHeight * sz)
      .applyQuaternion(elementQuaternion).add(new THREE.Vector3(...element.position));
    const { w, x, y, z } = elementQuaternion;
    assets.push(`    <hfield ${attrs({ name: hfield, file, size })}/>`);
    return `${editorMetadata(element, 1)}\n    <geom ${attrs({
      name: namePrefix, type: 'hfield', hfield, pos: vector(position.toArray()), quat: vector([w, x, y, z]),
      rgba: hexToRgba(element.color), friction: '1 0.005 0.0001', condim: '3',
    })}/>`;
  }
  const geometries = sourceGeometries.flatMap(surfaceCollisionGeometries);
  const geoms = geometries.map((geometry, index) => {
    const name = geometries.length === 1 || index === 0
      ? namePrefix
      : `${namePrefix}_step_${String(index + 1).padStart(2, '0')}`;
    if (geometry.shape === 'mesh') {
      const meshName = `mte_surface_${elementIndex + 1}_${index + 1}`;
      const childQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(geometry.rotation || [0, 0, 0])));
      const vertices = [];
      for (let offset = 0; offset < geometry.vertices.length; offset += 3) {
        const vertex = new THREE.Vector3(...geometry.vertices.slice(offset, offset + 3))
          .applyQuaternion(childQuaternion)
          .add(new THREE.Vector3(...geometry.position))
          .multiply(new THREE.Vector3(...element.scale))
          .applyQuaternion(elementQuaternion)
          .add(new THREE.Vector3(...element.position));
        vertices.push(...vertex.toArray());
      }
      assets.push(`    <mesh ${attrs({ name: meshName, vertex: vector(vertices) })}/>`);
      return `    <geom ${attrs({ name, type: 'mesh', mesh: meshName, rgba: hexToRgba(element.color), friction: '1 0.005 0.0001', condim: '3' })}/>`;
    }
    // MuJoCo boxes use half-extents, while cylinders use radius and half-height.
    // With no wrapper body, bake the element transform into every geom.
    const geomType = geometry.shape === 'cylinder' ? 'cylinder' : 'box';
    const size = geomType === 'cylinder'
      ? [geometry.args[0] * Math.max(element.scale[0], element.scale[1]), geometry.args[1] * element.scale[2] / 2]
      : geometry.args.map((length, axis) => length * element.scale[axis] / 2);
    const position = new THREE.Vector3(
      ...geometry.position.map((value, axis) => value * element.scale[axis]),
    ).applyQuaternion(elementQuaternion).add(new THREE.Vector3(...element.position));
    const geometryQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(geometry.rotation || [0, 0, 0])),
    );
    const quaternion = elementQuaternion.clone().multiply(geometryQuaternion).normalize();
    const hasRotation = Math.abs(quaternion.x) > 1e-9
      || Math.abs(quaternion.y) > 1e-9
      || Math.abs(quaternion.z) > 1e-9
      || Math.abs(quaternion.w - 1) > 1e-9;
    return `    <geom ${attrs({
      name,
      type: geomType,
      size: vector(size),
      pos: vector(position.toArray()),
      quat: hasRotation ? vector([quaternion.w, quaternion.x, quaternion.y, quaternion.z]) : undefined,
      rgba: hexToRgba(element.color),
      friction: '1 0.005 0.0001',
      condim: '3',
    })}/>`;
  }).join('\n');
  return `${editorMetadata(element, geometries.length)}\n${geoms}`;
}

function serializeScene(elements, heightfields) {
  const assets = [];
  const terrain = elements.map((element, index) => elementGeoms(element, index, assets, heightfields)).filter(Boolean).join('\n');
  const assetSection = assets.length ? `\n  <asset>\n${assets.join('\n')}\n  </asset>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<mujoco model="terrain">
  <compiler angle="radian" coordinate="local"/>
  <option timestep="0.002" gravity="0 0 -9.81"/>${assetSection}
  <worldbody>
    <geom name="ground" type="plane" size="30 30 0.1" friction="1 0.005 0.0001" condim="3"/>
${terrain}
  </worldbody>
</mujoco>
`;
}

export function exportToXML(elements) {
  return serializeScene(elements);
}

export function exportHeightfieldScene(elements) {
  const heightfields = [];
  const xml = serializeScene(elements, heightfields);
  return { xml, heightfields };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking on the next task avoids cancelling downloads in stricter browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadXML(elements, filename = 'terrain.xml') {
  downloadBlob(new Blob([exportToXML(elements)], { type: 'application/xml;charset=utf-8' }), filename);
}

export function timestampedXMLFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `terrain_${pad(date.getMonth() + 1)}_${pad(date.getDate())}-${pad(date.getHours())}_${pad(date.getMinutes())}_.xml`;
}

export async function saveXMLToHandle(elements, fileHandle) {
  if (!fileHandle?.createWritable) throw new Error('Writable file handle unavailable');
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(exportToXML(elements));
    await writable.close();
  } catch (error) {
    if (writable.abort) await writable.abort().catch(() => {});
    throw error;
  }
}
