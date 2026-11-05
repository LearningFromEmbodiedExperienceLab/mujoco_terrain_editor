import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { getPreset } from '../data/presets.js';
import { getGroundOffset } from '../utils/grounding.js';
import { measureAxis } from '../utils/gap.js';
import { makeUniqueXmlName, sanitizeXmlName } from '../utils/xmlNames.js';
import { snapToStep, TRANSLATION_SNAP } from '../editorConfig.js';
import { terrainColorForIndex } from '../utils/terrainColors.js';

const MAX_HISTORY = 100;

function cloneElements(elements) {
  return elements.map((element) => ({
    ...element,
    position: [...element.position],
    rotation: [...element.rotation],
    scale: [...element.scale],
    params: { ...element.params },
  }));
}

function sceneSnapshot(state) {
  return {
    elements: cloneElements(state.elements),
    selectedId: state.selectedId,
    selectedIds: [...state.selectedIds],
  };
}

function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
      && keys.every((key) => valuesEqual(left[key], right[key]));
  }
  return false;
}

function recordSceneChange(state, scenePatch) {
  const alreadyRecorded = state.historyTransactionOpen && state.historyTransactionRecorded;
  const historyPast = alreadyRecorded
    ? state.historyPast
    : [...state.historyPast, sceneSnapshot(state)].slice(-MAX_HISTORY);
  return {
    ...scenePatch,
    historyPast,
    historyFuture: [],
    historyTransactionRecorded: state.historyTransactionOpen,
    hasUnsavedChanges: true,
  };
}

function normalizeParams(preset, params = {}) {
  return Object.fromEntries(preset.parameters.map((parameter) => {
    if (parameter.type === 'boolean') {
      const value = params[parameter.key];
      return [parameter.key, typeof value === 'boolean' ? value : parameter.default];
    }
    let value = Number(params[parameter.key]);
    if (!Number.isFinite(value)) value = parameter.default;
    if (parameter.integer) value = Math.round(value);
    if (parameter.min !== undefined) value = Math.max(parameter.min, value);
    if (parameter.max !== undefined) value = Math.min(parameter.max, value);
    return [parameter.key, value];
  }));
}

function sanitizeElement(element) {
  const preset = getPreset(element?.type);
  if (!preset) return null;
  return {
    id: typeof element.id === 'string' ? element.id : nanoid(8),
    type: preset.type,
    name: sanitizeXmlName(element.name, preset.xmlName),
    position: validVector(element.position, [0, 0, 0]),
    rotation: validVector(element.rotation, [0, 0, 0]),
    // Scale is no longer editable, but remains in the scene schema so older
    // saved data can still be loaded and exported without changing geometry.
    scale: validVector(element.scale, [1, 1, 1]).map((value) => Math.max(0.1, value)),
    groundLocked: element.groundLocked !== false,
    color: /^#[0-9a-f]{6}$/i.test(element.color) ? element.color : '#c8d3cb',
    params: normalizeParams(preset, element.params),
  };
}

function validVector(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return value.map((item, index) => Number.isFinite(Number(item)) ? Number(item) : fallback[index]);
}

function normalizeDegrees(value) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

const useSceneStore = create((set, get) => ({
  elements: [],
  selectedId: null,
  selectedIds: [],
  colorPickTargetId: null,
  transformMode: 'translate',
  isTransforming: false,
  language: 'zh',
  theme: 'light',
  roughnessWireframe: false,
  historyPast: [],
  historyFuture: [],
  historyTransactionOpen: false,
  historyTransactionRecorded: false,
  sourceFileName: null,
  sourceFileHandle: null,
  hasUnsavedChanges: false,

  addElement: (presetType, position = [0, 0, 0]) => {
    const preset = getPreset(presetType);
    if (!preset) return;
    const existingNames = new Set(get().elements.map((item) => item.name));
    let nextIndex = 1;
    while (existingNames.has(`${preset.xmlName}_${nextIndex}`)) nextIndex += 1;
    const params = { ...preset.defaultParams };
    // Callers provide a point on the ground plane; scene elements are stored
    // by their transform origin, so lift that point by the preset's offset.
    const groundPosition = validVector(position, [0, 0, 0]);
    const centerPosition = [
      groundPosition[0],
      groundPosition[1],
      groundPosition[2] + preset.getGroundOffset(params),
    ];
    const element = {
      id: nanoid(8),
      type: presetType,
      name: `${preset.xmlName}_${nextIndex}`,
      position: [
        snapToStep(centerPosition[0], TRANSLATION_SNAP),
        snapToStep(centerPosition[1], TRANSLATION_SNAP),
        Number(centerPosition[2].toFixed(6)),
      ],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      groundLocked: true,
      color: terrainColorForIndex(get().elements.length),
      params,
    };
    set((state) => recordSceneChange(state, {
      elements: [...state.elements, element],
      selectedId: element.id,
      selectedIds: [element.id],
      colorPickTargetId: null,
    }));
  },

  updateElement: (id, patch) => set((state) => {
    const current = state.elements.find((element) => element.id === id);
    if (!current || Object.entries(patch).every(([key, value]) => valuesEqual(current[key], value))) {
      return state;
    }
    const elements = state.elements.map((element) => {
      if (element.id !== id) return element;
      const next = { ...element, ...patch };
      // Recalculate instead of merely clamping Z: parameter and rotation
      // changes can alter the actual lowest corner of composite terrain.
      if (next.groundLocked) {
        next.position = [next.position[0], next.position[1], getGroundOffset(next)];
      }
      return next;
    });
    return recordSceneChange(state, { elements });
  }),

  rotateElement90: (id, direction) => {
    const element = get().elements.find((item) => item.id === id);
    if (!element) return;
    const rotation = [...element.rotation];
    rotation[2] = normalizeDegrees(rotation[2] + (direction < 0 ? -90 : 90));
    get().updateElement(id, { rotation });
  },

  removeElement: (id) => set((state) => {
    if (!state.elements.some((element) => element.id === id)) return state;
    const selectedIds = state.selectedIds.filter((selectedId) => selectedId !== id);
    return recordSceneChange(state, {
      elements: state.elements.filter((element) => element.id !== id),
      selectedId: state.selectedId === id ? (selectedIds.at(-1) || null) : state.selectedId,
      selectedIds,
      colorPickTargetId: state.colorPickTargetId === id ? null : state.colorPickTargetId,
    });
  }),

  removeSelectedElements: () => set((state) => {
    if (!state.selectedIds.length) return state;
    const selected = new Set(state.selectedIds);
    return recordSceneChange(state, {
      elements: state.elements.filter((element) => !selected.has(element.id)),
      selectedId: null,
      selectedIds: [],
      colorPickTargetId: null,
    });
  }),

  duplicateElement: (id) => {
    const source = get().elements.find((element) => element.id === id);
    if (!source) return;
    const existingNames = get().elements.map((element) => element.name);
    const copy = {
      ...source,
      id: nanoid(8),
      name: makeUniqueXmlName(`${source.name}_copy`, existingNames, source.name),
      position: [source.position[0] + 0.5, source.position[1] - 0.5, source.position[2]],
      rotation: [...source.rotation],
      scale: [...source.scale],
      params: { ...source.params },
    };
    set((state) => recordSceneChange(state, {
      elements: [...state.elements, copy],
      selectedId: copy.id,
      selectedIds: [copy.id],
      colorPickTargetId: null,
    }));
  },

  selectElement: (id, additive = false) => set((state) => {
    if (!id) return { selectedId: null, selectedIds: [], colorPickTargetId: null };
    if (!state.elements.some((element) => element.id === id)) return state;
    if (!additive) return { selectedId: id, selectedIds: [id] };

    if (state.selectedIds.includes(id)) {
      const selectedIds = state.selectedIds.filter((selectedId) => selectedId !== id);
      return {
        selectedId: state.selectedId === id ? (selectedIds.at(-1) || null) : state.selectedId,
        selectedIds,
      };
    }
    return {
      selectedId: id,
      selectedIds: [...state.selectedIds, id],
      transformMode: 'translate',
    };
  }),
  setPairGap: (anchorId, moverId, axis, gap) => set((state) => {
    if (axis !== 0 && axis !== 1) return state;
    const anchor = state.elements.find((element) => element.id === anchorId);
    const mover = state.elements.find((element) => element.id === moverId);
    if (!anchor || !mover) return state;
    const nextGap = Math.max(0, Number(gap));
    if (!Number.isFinite(nextGap)) return state;
    const measured = measureAxis(anchor, mover, axis);
    const delta = measured.moverSign * (nextGap - measured.gap);
    if (Math.abs(delta) < 1e-8) return state;
    const position = [...mover.position];
    position[axis] += delta;
    const next = { ...mover, position };
    if (next.groundLocked) {
      next.position = [position[0], position[1], getGroundOffset(next)];
    }
    return recordSceneChange(state, {
      elements: state.elements.map((element) => (element.id === mover.id ? next : element)),
    });
  }),
  moveElements: (ids, delta) => set((state) => {
    const moving = new Set(ids);
    const [dx, dy, dz] = validVector(delta, [0, 0, 0]);
    if (!moving.size || (dx === 0 && dy === 0 && dz === 0)) return state;
    return recordSceneChange(state, {
      elements: state.elements.map((element) => (
        moving.has(element.id)
          ? { ...element, position: [
            element.position[0] + dx,
            element.position[1] + dy,
            element.position[2] + dz,
          ] }
          : element
      )),
    });
  }),
  setSelectedElementsColor: (color) => set((state) => {
    const nextColor = String(color || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(nextColor) || !state.selectedId) return state;
    const targetIds = new Set(
      state.selectedIds.includes(state.selectedId) ? state.selectedIds : [state.selectedId],
    );
    const needsChange = state.elements.some((element) => (
      targetIds.has(element.id) && element.color !== nextColor
    ));
    if (!needsChange) return state;
    return recordSceneChange(state, {
      elements: state.elements.map((element) => (
        targetIds.has(element.id) ? { ...element, color: nextColor } : element
      )),
    });
  }),
  startColorPicking: (targetId) => {
    if (get().elements.some((element) => element.id === targetId)) {
      set({ colorPickTargetId: targetId });
    }
  },
  cancelColorPicking: () => set({ colorPickTargetId: null }),
  applyColorFromElement: (sourceId) => set((state) => {
    const source = state.elements.find((element) => element.id === sourceId);
    if (!source || !state.colorPickTargetId) return { colorPickTargetId: null };
    const targetIds = new Set(
      state.selectedIds.includes(state.colorPickTargetId) ? state.selectedIds : [state.colorPickTargetId],
    );
    targetIds.delete(sourceId);
    const needsChange = state.elements.some((element) => (
      targetIds.has(element.id) && element.color !== source.color
    ));
    if (!needsChange) return { colorPickTargetId: null };
    return recordSceneChange(state, {
      elements: state.elements.map((element) => (
        targetIds.has(element.id) ? { ...element, color: source.color } : element
      )),
      colorPickTargetId: null,
    });
  }),
  setTransformMode: (mode) => {
    if (mode === 'translate' || (mode === 'rotate' && get().selectedIds.length <= 1)) {
      set({ transformMode: mode });
    }
  },
  setTransforming: (isTransforming) => set({ isTransforming }),
  setLanguage: (language) => {
    if (language === 'zh' || language === 'en') set({ language });
  },
  toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
  toggleRoughnessWireframe: () => set((state) => ({ roughnessWireframe: !state.roughnessWireframe })),
  beginHistoryTransaction: () => set({
    historyTransactionOpen: true,
    historyTransactionRecorded: false,
  }),
  endHistoryTransaction: () => set({
    historyTransactionOpen: false,
    historyTransactionRecorded: false,
  }),
  undo: () => set((state) => {
    if (!state.historyPast.length) return state;
    const previous = state.historyPast[state.historyPast.length - 1];
    return {
      elements: cloneElements(previous.elements),
      selectedId: previous.selectedId,
      selectedIds: [...(previous.selectedIds || (previous.selectedId ? [previous.selectedId] : []))],
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: [sceneSnapshot(state), ...state.historyFuture].slice(0, MAX_HISTORY),
      historyTransactionOpen: false,
      historyTransactionRecorded: false,
      isTransforming: false,
      colorPickTargetId: null,
      hasUnsavedChanges: true,
    };
  }),
  redo: () => set((state) => {
    if (!state.historyFuture.length) return state;
    const next = state.historyFuture[0];
    return {
      elements: cloneElements(next.elements),
      selectedId: next.selectedId,
      selectedIds: [...(next.selectedIds || (next.selectedId ? [next.selectedId] : []))],
      historyPast: [...state.historyPast, sceneSnapshot(state)].slice(-MAX_HISTORY),
      historyFuture: state.historyFuture.slice(1),
      historyTransactionOpen: false,
      historyTransactionRecorded: false,
      isTransforming: false,
      colorPickTargetId: null,
      hasUnsavedChanges: true,
    };
  }),
  clearAll: () => set((state) => {
    if (!state.elements.length) return state;
    return recordSceneChange(state, {
      elements: [], selectedId: null, selectedIds: [], isTransforming: false, colorPickTargetId: null,
    });
  }),
  loadElements: (elements, sourceFileName = null, sourceFileHandle = null) => {
    const sanitized = Array.isArray(elements) ? elements.map(sanitizeElement).filter(Boolean) : [];
    const usedNames = new Set();
    sanitized.forEach((element) => {
      element.name = makeUniqueXmlName(element.name, usedNames, getPreset(element.type).xmlName);
      usedNames.add(element.name);
      if (element.groundLocked) element.position[2] = getGroundOffset(element);
    });
    set({
      elements: sanitized,
      selectedId: null,
      selectedIds: [],
      colorPickTargetId: null,
      historyPast: [],
      historyFuture: [],
      historyTransactionOpen: false,
      historyTransactionRecorded: false,
      sourceFileName,
      sourceFileHandle,
      hasUnsavedChanges: false,
    });
  },
  markSceneSaved: () => set({ hasUnsavedChanges: false }),
}));

export default useSceneStore;
