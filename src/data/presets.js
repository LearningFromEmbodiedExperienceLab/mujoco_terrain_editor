import { Box, Cylinder, Layers3, Mountain, PanelsTopLeft } from 'lucide-react';
import { defineTerrainPreset } from './defineTerrainPreset.js';

const RAMP_THICKNESS = 0.08;

export const PRESETS = [
  defineTerrainPreset({
    type: 'box',
    label: { zh: '方块', en: 'Box' },
    xmlName: 'Box',
    Icon: Box,
    parameters: [
      { key: 'width', label: { zh: '宽度 / X', en: 'Width / X' }, unit: 'M', default: 1, min: 0.01, step: 0.05 },
      { key: 'depth', label: { zh: '长度 / Y', en: 'Length / Y' }, unit: 'M', default: 1, min: 0.01, step: 0.05 },
      { key: 'height', label: { zh: '高度 / Z', en: 'Height / Z' }, unit: 'M', default: 1, min: 0.01, step: 0.05 },
    ],
    getSummary: ({ width, depth, height }) => `${width} × ${depth} × ${height}`,
    getGroundOffset: ({ height }) => height / 2,
    toGeometries: ({ width, depth, height }) => [
      { args: [width, depth, height], position: [0, 0, 0] },
    ],
  }),
  defineTerrainPreset({
    type: 'ramp',
    label: { zh: '斜坡', en: 'Ramp' },
    xmlName: 'Ramp',
    Icon: Mountain,
    parameters: [
      { key: 'width', label: { zh: '坡面宽度', en: 'Ramp Width' }, unit: 'M', default: 2, min: 0.01, step: 0.05 },
      { key: 'length', label: { zh: '水平长度', en: 'Horizontal Length' }, unit: 'M', default: 3, min: 0.01, step: 0.05 },
      { key: 'slope', label: { zh: '坡度', en: 'Slope' }, unit: 'DEG', default: 30, min: 0, max: 89, step: 1 },
    ],
    getSummary: ({ slope }, language = 'zh') => `${slope.toFixed(1)}° ${language === 'zh' ? '坡度' : 'slope'}`,
    getGroundOffset: ({ length, slope }) => {
      const angle = slope * Math.PI / 180;
      return Math.abs(length * Math.tan(angle)) / 2 + RAMP_THICKNESS * Math.abs(Math.cos(angle)) / 2;
    },
    toGeometries: ({ width, length, slope }) => {
      const angle = slope * Math.PI / 180;
      const surfaceLength = length / Math.max(0.001, Math.cos(angle));
      return [{
        args: [width, surfaceLength, RAMP_THICKNESS],
        position: [0, 0, 0],
        rotation: [angle, 0, 0],
      }];
    },
  }),
  defineTerrainPreset({
    type: 'cylinder',
    label: { zh: '圆柱', en: 'Cylinder' },
    xmlName: 'Cylinder',
    Icon: Cylinder,
    parameters: [
      { key: 'radius', label: { zh: '半径', en: 'Radius' }, unit: 'M', default: 0.5, min: 0.01, step: 0.05 },
      { key: 'height', label: { zh: '高度', en: 'Height' }, unit: 'M', default: 1, min: 0.01, step: 0.05 },
    ],
    getSummary: ({ radius, height }) => `Ø ${(radius * 2).toFixed(2)} × ${height.toFixed(2)}`,
    getGroundOffset: ({ height }) => height / 2,
    toGeometries: ({ radius, height }) => [
      { shape: 'cylinder', args: [radius, height], position: [0, 0, 0] },
    ],
  }),
  defineTerrainPreset({
    type: 'stairs',
    label: { zh: '楼梯', en: 'Stairs' },
    xmlName: 'Stairs',
    Icon: Layers3,
    parameters: [
      { key: 'stepWidth', label: { zh: '踏步宽度 / Y', en: 'Step Width / Y' }, unit: 'M', default: 2, min: 0.01, step: 0.05 },
      { key: 'stepLength', label: { zh: '踏步长度 / X', en: 'Step Length / X' }, unit: 'M', default: 0.3, min: 0.01, step: 0.05 },
      { key: 'stepHeight', label: { zh: '踏步高度', en: 'Step Height' }, unit: 'M', default: 0.15, min: 0.01, step: 0.05 },
      { key: 'steps', label: { zh: '台阶级数', en: 'Step Count' }, unit: '', default: 8, min: 1, step: 1, integer: true },
      { key: 'floating', label: { zh: '悬浮楼梯', en: 'Floating Stairs' }, type: 'boolean', default: false },
      { key: 'floatingThickness', label: { zh: '悬浮踏步厚度', en: 'Floating Stair Thickness' }, unit: 'M', default: 0.05, min: 0.01, step: 0.01, visibleWhen: ({ floating }) => floating },
    ],
    getSummary: ({ stepLength, stepHeight }, language = 'zh') => `${language === 'zh' ? '阶梯 ' : 'Step '}${stepLength.toFixed(2)} × ${stepHeight.toFixed(2)} m`,
    getGroundOffset: ({ stepHeight, steps, floating, floatingThickness }) => (
      stepHeight * Math.max(1, Math.round(steps)) / 2 - (floating ? stepHeight - floatingThickness : 0)
    ),
    toGeometries: ({ stepWidth, stepLength, stepHeight, steps: rawSteps, floating, floatingThickness }) => {
      const steps = Math.max(1, Math.round(rawSteps));
      const totalLength = stepLength * steps;
      const totalHeight = stepHeight * steps;
      return Array.from({ length: steps }, (_, i) => {
        const currentHeight = stepHeight * (i + 1);
        const thickness = floating ? floatingThickness : currentHeight;
        return {
          args: [stepLength * 0.97, stepWidth, thickness],
          position: [-totalLength / 2 + stepLength * (i + 0.5), 0, currentHeight - thickness / 2 - totalHeight / 2],
        };
      });
    },
  }),
  defineTerrainPreset({
    type: 'platform',
    label: { zh: '平台', en: 'Platform' },
    xmlName: 'Platform',
    Icon: PanelsTopLeft,
    parameters: [
      { key: 'width', label: { zh: '平台宽度', en: 'Platform Width' }, unit: 'M', default: 1, min: 0.01, step: 0.05 },
      { key: 'depth', label: { zh: '平台长度', en: 'Platform Length' }, unit: 'M', default: 1, min: 0.01, step: 0.05 },
      { key: 'height', label: { zh: '平台高度', en: 'Platform Height' }, unit: 'M', default: 0.5, min: 0.01, step: 0.05 },
    ],
    getSummary: ({ width, depth, height }) => `${width} × ${depth} × ${height}`,
    getGroundOffset: ({ height }) => height / 2,
    toGeometries: ({ width, depth, height }) => [
      { args: [width, depth, height], position: [0, 0, 0] },
    ],
  }),
];

export const PRESET_REGISTRY = new Map(PRESETS.map((preset) => [preset.type, preset]));
if (PRESET_REGISTRY.size !== PRESETS.length) {
  throw new Error('Terrain preset types must be unique');
}

export function getPreset(type) {
  return PRESET_REGISTRY.get(type);
}
