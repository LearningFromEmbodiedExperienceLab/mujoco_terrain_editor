import { useEffect, useRef, useState } from 'react';
import { Copy, Dices, Pipette, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { getPreset } from '../data/presets';
import useSceneStore from '../store/useSceneStore';
import { makeUniqueXmlName, sanitizeXmlNameDraft } from '../utils/xmlNames.js';
import { localize, translate } from '../i18n';
import { ROTATION_SNAP_DEGREES, TRANSLATION_SNAP } from '../editorConfig';
import { findFacingGap } from '../utils/gap.js';
import { randomTerrainColor } from '../utils/terrainColors.js';

const AXES = ['X', 'Y', 'Z'];

function formatNumber(value) {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(6)).toString();
}

function NumericInput({ value, onChange, step = 0.1, min, max, integer = false, axis, disabled = false }) {
  // Keep a textual draft separate from the numeric store value so users can
  // temporarily type incomplete values such as "-" or "0." without resets.
  const [draft, setDraft] = useState(() => formatNumber(value));
  const focusedRef = useRef(false);
  const cancelBlurRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(formatNumber(value));
  }, [value]);

  const commit = (rawValue = draft) => {
    let parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      setDraft(formatNumber(value));
      return;
    }
    if (integer) parsed = Math.round(parsed);
    if (min !== undefined) parsed = Math.max(min, parsed);
    if (max !== undefined) parsed = Math.min(max, parsed);
    setDraft(formatNumber(parsed));
    onChange(parsed);
  };

  const handleChange = (event) => {
    const nextDraft = event.target.value;
    setDraft(nextDraft);
    const parsed = Number(nextDraft);
    if (
      nextDraft.trim() !== ''
      && Number.isFinite(parsed)
      && (min === undefined || parsed >= min)
      && (max === undefined || parsed <= max)
    ) {
      onChange(integer ? Math.round(parsed) : parsed);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      setDraft(formatNumber(value));
      cancelBlurRef.current = true;
      event.currentTarget.blur();
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (disabled) return;
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? 1 : -1;
      const base = Number.isFinite(Number(draft)) ? Number(draft) : value;
      commit(String(base + direction * step));
    }
  };

  return (
    <label className={axis ? 'app-axis' : undefined}>
      {axis && <span>{axis}</span>}
      <input
        className="app-input"
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={draft}
        disabled={disabled}
        onFocus={() => {
          focusedRef.current = true;
          cancelBlurRef.current = false;
          useSceneStore.getState().beginHistoryTransaction();
        }}
        onBlur={(event) => {
          focusedRef.current = false;
          if (!cancelBlurRef.current) commit(event.currentTarget.value);
          cancelBlurRef.current = false;
          useSceneStore.getState().endHistoryTransaction();
        }}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onWheel={(event) => event.currentTarget.blur()}
        aria-label={axis}
      />
    </label>
  );
}

function VectorInput({ label, hint, value, onChange, step = 0.1, min, disabledIndices = [] }) {
  return (
    <div className="app-field">
      <div className="app-label"><span>{label}</span>{hint && <code>{hint}</code>}</div>
      <div className="app-vector">
        {AXES.map((axis, index) => (
          <NumericInput
            key={axis}
            axis={axis}
            value={value[index]}
            step={step}
            min={min}
            disabled={disabledIndices.includes(index)}
            onChange={(nextValue) => {
              const next = [...value];
              next[index] = nextValue;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ParameterInput({ label, unit = 'M', value, onChange, min = 0.01, max, step = 0.1, integer = false }) {
  return (
    <div className="app-field">
      <div className="app-label"><span>{label}</span>{unit && <code>{unit}</code>}</div>
      <NumericInput
        value={value}
        step={step}
        min={min}
        max={max}
        integer={integer}
        onChange={onChange}
      />
    </div>
  );
}

function PropertiesPanel() {
  const elements = useSceneStore((state) => state.elements);
  const selectedId = useSceneStore((state) => state.selectedId);
  const selectedIds = useSceneStore((state) => state.selectedIds);
  const setPairGap = useSceneStore((state) => state.setPairGap);
  const updateElement = useSceneStore((state) => state.updateElement);
  const removeElement = useSceneStore((state) => state.removeElement);
  const duplicateElement = useSceneStore((state) => state.duplicateElement);
  const rotateElement90 = useSceneStore((state) => state.rotateElement90);
  const setSelectedElementsColor = useSceneStore((state) => state.setSelectedElementsColor);
  const colorPickTargetId = useSceneStore((state) => state.colorPickTargetId);
  const startColorPicking = useSceneStore((state) => state.startColorPicking);
  const cancelColorPicking = useSceneStore((state) => state.cancelColorPicking);
  const language = useSceneStore((state) => state.language);
  const t = (key, variables) => translate(language, key, variables);
  const element = elements.find((item) => item.id === selectedId);
  const anchor = selectedIds.length === 2 ? elements.find((item) => item.id === selectedIds[0]) : null;
  const mover = selectedIds.length === 2 ? elements.find((item) => item.id === selectedIds[1]) : null;
  const gap = anchor && mover ? findFacingGap(anchor, mover) : null;

  if (!element) {
    return (
      <aside className="app-inspector">
        <div className="ui-pane-heading"><h3>{t('inspector')}</h3></div>
        <div className="app-empty">
          <strong>{t('noSelection')}</strong>
          <p className="ui-hint">{t('noSelectionHint')}</p>
        </div>
      </aside>
    );
  }

  const preset = getPreset(element.type);
  const Icon = preset.Icon;
  const patch = (field, value) => updateElement(element.id, { [field]: value });
  const updateParam = (key, value) => patch('params', { ...element.params, [key]: value });
  const commitName = (value) => {
    const otherNames = elements.filter((item) => item.id !== element.id).map((item) => item.name);
    patch('name', makeUniqueXmlName(value, otherNames, preset.xmlName));
  };

  return (
    <aside className="app-inspector">
      <div className="ui-pane-heading">
        <h3>{t('inspector')}</h3>
      </div>
      {gap && (
        <section className="app-section">
          <div className="app-field">
            <div className="app-label">
              <span>{t('gap')}</span>
              <code>{gap.axis === 0 ? 'X' : 'Y'}</code>
            </div>
            <NumericInput
              value={gap.gap}
              min={0}
              step={0.05}
              onChange={(next) => setPairGap(anchor.id, mover.id, gap.axis, next)}
            />
            <p className="ui-hint app-gap-note">{t('gapHint')}</p>
          </div>
        </section>
      )}
      <section className="app-section">
        <div className="app-field">
          <div className="app-label"><span>{t('geomName')}</span><code>MJCF</code></div>
          <input
            className="app-input app-input--text"
            value={element.name}
            maxLength={64}
            spellCheck={false}
            onFocus={() => useSceneStore.getState().beginHistoryTransaction()}
            onChange={(event) => patch('name', sanitizeXmlNameDraft(event.target.value))}
            onBlur={(event) => {
              commitName(event.target.value);
              useSceneStore.getState().endHistoryTransaction();
            }}
          />
        </div>
        <div className="app-type">
          <Icon size={14} strokeWidth={1.75} />
          {localize(preset.label, language)}
        </div>
      </section>
      <section className="app-section">
        <p className="ui-kicker">{t('transform')}</p>
        <label className="ui-check app-lock">
          <input
            type="checkbox"
            checked={element.groundLocked}
            onChange={(event) => patch('groundLocked', event.target.checked)}
          />
          <span>
            <strong>{t('groundLock')}</strong>
            <span className="ui-hint">{t('groundLockHint')}</span>
          </span>
        </label>
        <VectorInput
          label={t('position')}
          hint={element.groundLocked ? 'Z AUTO' : `M · ${TRANSLATION_SNAP}`}
          value={element.position}
          step={TRANSLATION_SNAP}
          disabledIndices={element.groundLocked ? [2] : []}
          onChange={(value) => patch('position', value)}
        />
        <VectorInput
          label={t('rotation')}
          hint={`DEG · ${ROTATION_SNAP_DEGREES}`}
          value={element.rotation}
          step={ROTATION_SNAP_DEGREES}
          onChange={(value) => patch('rotation', value)}
        />
        <div className="app-split">
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => rotateElement90(element.id, 1)}
            title={`${t('rotateLeft90')} (Shift+[)`}
          >
            <RotateCcw size={14} /> {t('rotateLeft90')}
          </button>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            onClick={() => rotateElement90(element.id, -1)}
            title={`${t('rotateRight90')} (Shift+])`}
          >
            <RotateCw size={14} /> {t('rotateRight90')}
          </button>
        </div>
      </section>
      <section className="app-section">
        <p className="ui-kicker">{t('geometryParameters')}</p>
        {preset.parameters.filter((parameter) => !parameter.visibleWhen || parameter.visibleWhen(element.params)).map((parameter) => (
          parameter.type === 'boolean' ? (
            <label key={parameter.key} className="ui-check app-lock">
              <input
                type="checkbox"
                checked={element.params[parameter.key]}
                onChange={(event) => updateParam(parameter.key, event.target.checked)}
              />
              <span>{localize(parameter.label, language)}</span>
            </label>
          ) : (
            <ParameterInput
              key={parameter.key}
              {...parameter}
              label={localize(parameter.label, language)}
              value={element.params[parameter.key]}
              onChange={(next) => updateParam(parameter.key, next)}
            />
          )
        ))}
        <div className="app-field">
          <div className="app-label"><span>{t('displayColor')}</span></div>
          <div className="app-color">
            <label className="app-color-swatch">
              <input
                type="color"
                value={element.color}
                onFocus={() => useSceneStore.getState().beginHistoryTransaction()}
                onBlur={() => useSceneStore.getState().endHistoryTransaction()}
                onChange={(event) => setSelectedElementsColor(event.target.value)}
                aria-label={t('displayColor')}
              />
              <code>{element.color.toUpperCase()}</code>
            </label>
            <div className="app-color-actions">
              <button
                type="button"
                className="ui-button ui-button--secondary"
                onClick={() => setSelectedElementsColor(randomTerrainColor(element.color))}
                title={t('randomColor')}
                aria-label={t('randomColor')}
              >
                <Dices size={14} /> {t('randomColor')}
              </button>
              <button
                type="button"
                className={`ui-button ui-button--secondary${colorPickTargetId === element.id ? ' is-active' : ''}`}
                disabled={elements.length < 2}
                onClick={() => {
                  if (colorPickTargetId === element.id) cancelColorPicking();
                  else startColorPicking(element.id);
                }}
                title={colorPickTargetId === element.id ? t('cancelColorPick') : t('pickColorHint')}
                aria-pressed={colorPickTargetId === element.id}
              >
                <Pipette size={14} /> {t('pickColor')}
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="app-section app-actions">
        <button type="button" className="ui-button ui-button--secondary" onClick={() => duplicateElement(element.id)}>
          <Copy size={14} /> {t('duplicateElement')}
        </button>
        <button type="button" className="ui-button ui-button--ghost" onClick={() => removeElement(element.id)}>
          <Trash2 size={14} /> {t('deleteElement')}
        </button>
      </section>
    </aside>
  );
}

export default PropertiesPanel;
