import * as THREE from 'three';
import { getPreset } from '../data/presets.js';

const corner = new THREE.Vector3();
const childEuler = new THREE.Euler();
const childQuaternion = new THREE.Quaternion();
const elementEuler = new THREE.Euler();
const elementQuaternion = new THREE.Quaternion();
const childPosition = new THREE.Vector3();
const BOX_CORNER_SIGNS = [-1, 1].flatMap((x) =>
  [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])),
);

function forEachLocalCorner(element, visit) {
  const preset = getPreset(element.type);
  if (!preset) return false;

  const geometries = preset.toGeometries(element.params);
  const scale = element.scale || [1, 1, 1];
  const rotation = element.rotation || [0, 0, 0];
  elementEuler.set(...rotation.map((degree) => degree * Math.PI / 180));
  elementQuaternion.setFromEuler(elementEuler);

  for (const geometry of geometries) {
    childPosition.fromArray(geometry.position);
    childEuler.set(...(geometry.rotation || [0, 0, 0]));
    childQuaternion.setFromEuler(childEuler);

    const points = geometry.shape === 'mesh'
      ? Array.from({ length: geometry.vertices.length / 3 }, (_, index) => geometry.vertices.slice(index * 3, index * 3 + 3))
      : geometry.shape === 'cylinder'
      ? [-1, 1].flatMap((zSign) => Array.from({ length: 32 }, (_, index) => {
        const angle = index * Math.PI * 2 / 32;
        return [
          Math.cos(angle) * geometry.args[0],
          Math.sin(angle) * geometry.args[0],
          zSign * geometry.args[1] / 2,
        ];
      }))
      : BOX_CORNER_SIGNS.map(([xSign, ySign, zSign]) => [
        xSign * geometry.args[0] / 2,
        ySign * geometry.args[1] / 2,
        zSign * geometry.args[2] / 2,
      ]);

    for (const point of points) {
      corner.fromArray(point);
      corner.applyQuaternion(childQuaternion);
      corner.add(childPosition);
      corner.set(corner.x * scale[0], corner.y * scale[1], corner.z * scale[2]);
      corner.applyQuaternion(elementQuaternion);
      visit(corner);
    }
  }
  return true;
}

/**
 * Compute the element origin height required to place its transformed AABB on Z=0.
 * Presets can contain several rotated boxes, so using half of a declared height is
 * insufficient for ramps, stairs, or freely rotated elements.
 */
export function getGroundOffset(element) {
  let minimumZ = Infinity;
  const found = forEachLocalCorner(element, (point) => {
    minimumZ = Math.min(minimumZ, point.z);
  });
  if (!found || !Number.isFinite(minimumZ)) return element.position?.[2] || 0;
  return Number((-minimumZ).toFixed(6));
}

export function getWorldBounds(element) {
  const position = element.position || [0, 0, 0];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const found = forEachLocalCorner(element, (point) => {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = point.getComponent(axis) + position[axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  });
  if (!found) return { min: [...position], max: [...position] };
  return { min, max };
}
