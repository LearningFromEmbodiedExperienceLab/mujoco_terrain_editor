import { applySurfaceNoise, NOISE_PARAMETERS } from '../utils/surfaceNoise.js';

/**
 * 定义一个可被组件库、属性面板、场景 store 和 XML 导出器共同使用的地形预设。
 * 参数的 default 是默认物理尺寸的唯一数据源。
 */
export function defineTerrainPreset(config) {
  config = { ...config, parameters: [...config.parameters, ...NOISE_PARAMETERS] };
  const requiredFields = [
    'type',
    'label',
    'xmlName',
    'Icon',
    'parameters',
    'getSummary',
    'getGroundOffset',
    'toGeometries',
  ];
  for (const field of requiredFields) {
    if (!config[field]) throw new Error(`Terrain preset is missing required field: ${field}`);
  }

  const keys = new Set();
  if (!config.label.zh || !config.label.en) {
    throw new Error(`Terrain preset "${config.type}" needs zh and en labels`);
  }
  for (const parameter of config.parameters) {
    if (!parameter.key) throw new Error(`Terrain preset "${config.type}" has a parameter without a key`);
    if (!parameter.label?.zh || !parameter.label?.en) {
      throw new Error(`Terrain preset "${config.type}" parameter "${parameter.key}" needs zh and en labels`);
    }
    if (keys.has(parameter.key)) throw new Error(`Terrain preset "${config.type}" has duplicate parameter "${parameter.key}"`);
    if (parameter.type === 'boolean' ? typeof parameter.default !== 'boolean' : !Number.isFinite(parameter.default)) {
      throw new Error(`Terrain preset "${config.type}" parameter "${parameter.key}" needs a ${parameter.type === 'boolean' ? 'boolean' : 'numeric'} default`);
    }
    if (parameter.min !== undefined && parameter.default < parameter.min) {
      throw new Error(`Terrain preset "${config.type}" parameter "${parameter.key}" default is below min`);
    }
    if (parameter.max !== undefined && parameter.default > parameter.max) {
      throw new Error(`Terrain preset "${config.type}" parameter "${parameter.key}" default is above max`);
    }
    if (parameter.step !== undefined && parameter.step <= 0) {
      throw new Error(`Terrain preset "${config.type}" parameter "${parameter.key}" needs a positive step`);
    }
    keys.add(parameter.key);
  }

  const defaultParams = Object.fromEntries(
    config.parameters.map((parameter) => [parameter.key, parameter.default]),
  );

  return {
    ...config,
    defaultParams,
    toGeometries: (params) => {
      const values = { ...defaultParams, ...params };
      return applySurfaceNoise(config.toGeometries(values), values);
    },
  };
}
