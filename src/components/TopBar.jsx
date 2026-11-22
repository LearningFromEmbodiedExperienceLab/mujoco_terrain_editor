import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, Download, ImageDown, Move3D, Redo2, Rotate3D, Save, Trash2, Undo2, Upload, Waypoints } from 'lucide-react';
import useSceneStore from '../store/useSceneStore';
import { downloadXML, saveXMLToHandle, timestampedXMLFilename } from '../utils/xmlExporter';
import { hasHeightfieldSurface } from '../utils/heightfield';
import { downloadHeightfieldArchive } from '../utils/heightfieldArchive';
import { translate } from '../i18n';
import useXmlLoader from '../hooks/useXmlLoader';

const MODES = [
  { mode: 'translate', labelKey: 'move', key: 'W', Icon: Move3D },
  { mode: 'rotate', labelKey: 'rotate', key: 'E', Icon: Rotate3D },
];

function ThemeGlyph() {
  return (
    <>
      <svg className="ui-icon" data-theme-icon="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
      <svg className="ui-icon" data-theme-icon="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
    </>
  );
}

function TopBar() {
  const fileInputRef = useRef(null);
  const saveToastTimerRef = useRef(null);
  const [saveToast, setSaveToast] = useState('');
  const [exportingHeightfield, setExportingHeightfield] = useState(false);
  const elements = useSceneStore((state) => state.elements);
  const selectedId = useSceneStore((state) => state.selectedId);
  const selectedCount = useSceneStore((state) => state.selectedIds.length);
  const transformMode = useSceneStore((state) => state.transformMode);
  const setTransformMode = useSceneStore((state) => state.setTransformMode);
  const clearAll = useSceneStore((state) => state.clearAll);
  const duplicateElement = useSceneStore((state) => state.duplicateElement);
  const undo = useSceneStore((state) => state.undo);
  const redo = useSceneStore((state) => state.redo);
  const canUndo = useSceneStore((state) => state.historyPast.length > 0);
  const canRedo = useSceneStore((state) => state.historyFuture.length > 0);
  const language = useSceneStore((state) => state.language);
  const setLanguage = useSceneStore((state) => state.setLanguage);
  const theme = useSceneStore((state) => state.theme);
  const toggleTheme = useSceneStore((state) => state.toggleTheme);
  const roughnessWireframe = useSceneStore((state) => state.roughnessWireframe);
  const toggleRoughnessWireframe = useSceneStore((state) => state.toggleRoughnessWireframe);
  const sourceFileName = useSceneStore((state) => state.sourceFileName);
  const sourceFileHandle = useSceneStore((state) => state.sourceFileHandle);
  const hasUnsavedChanges = useSceneStore((state) => state.hasUnsavedChanges);
  const markSceneSaved = useSceneStore((state) => state.markSceneSaved);
  const loadXmlFile = useXmlLoader();
  const t = (key, variables) => translate(language, key, variables);

  useEffect(() => () => {
    if (saveToastTimerRef.current) window.clearTimeout(saveToastTimerRef.current);
  }, []);

  const showSaveToast = (message) => {
    if (saveToastTimerRef.current) window.clearTimeout(saveToastTimerRef.current);
    setSaveToast(message);
    saveToastTimerRef.current = window.setTimeout(() => {
      setSaveToast('');
      saveToastTimerRef.current = null;
    }, 3000);
  };

  const handleClear = () => {
    if (elements.length && window.confirm(t('clearConfirm', { count: elements.length }))) clearAll();
  };

  const handleLoad = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void loadXmlFile(file);
  };

  const handleChooseFile = async () => {
    if (!window.showOpenFilePicker) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{
          description: 'MuJoCo XML',
          accept: { 'application/xml': ['.xml'] },
        }],
      });
      await loadXmlFile(await fileHandle.getFile(), fileHandle);
    } catch (error) {
      if (error.name !== 'AbortError') window.alert(`${t('loadError')}: ${error.message}`);
    }
  };

  const handleExport = () => {
    downloadXML(elements, timestampedXMLFilename());
    markSceneSaved();
  };

  const handleHeightfieldExport = async () => {
    setExportingHeightfield(true);
    try {
      const filename = timestampedXMLFilename().replace(/\.xml$/, 'heightfield.zip');
      await downloadHeightfieldArchive(elements, filename);
      if (useSceneStore.getState().elements === elements) markSceneSaved();
    } catch (error) {
      window.alert(`${t('heightfieldExportError')}\n${error.message}`);
    } finally {
      setExportingHeightfield(false);
    }
  };

  const handleSave = async () => {
    if (!sourceFileHandle?.createWritable) {
      window.alert(t('saveUnavailable'));
      return;
    }
    try {
      const permissionOptions = { mode: 'readwrite' };
      if (sourceFileHandle.queryPermission && sourceFileHandle.requestPermission) {
        let permission = await sourceFileHandle.queryPermission(permissionOptions);
        if (permission !== 'granted') permission = await sourceFileHandle.requestPermission(permissionOptions);
        if (permission !== 'granted') throw new Error(t('savePermissionDenied'));
      }
      await saveXMLToHandle(elements, sourceFileHandle);
      markSceneSaved();
      showSaveToast(t('saveSuccess', { filename: sourceFileName }));
    } catch (error) {
      if (error.name !== 'AbortError') window.alert(`${t('saveError')}: ${error.message}`);
    }
  };

  return (
    <>
      <header className="app-bar">
        <div className="app-brand">
          <p className="ui-kicker">MUJOCO</p>
          <h1>Terrain Editor</h1>
        </div>
        <div className="ui-segment app-segment">
          {MODES.map(({ mode, labelKey, key, Icon }) => (
            <button
              key={mode}
              type="button"
              className={`ui-segment__btn${transformMode === mode ? ' ui-segment__btn--active' : ''}`}
              disabled={selectedCount > 1 && mode === 'rotate'}
              onClick={() => setTransformMode(mode)}
              title={selectedCount > 1 && mode === 'rotate' ? t('multiMoveOnly') : `${t(labelKey)} (${key})`}
            >
              <Icon size={14} strokeWidth={1.75} />
              <span className="app-label-text">{t(labelKey)}</span>
              <kbd className="app-kbd">{key}</kbd>
            </button>
          ))}
        </div>
        <div className="app-bar-actions">
          <div className="app-icon-group">
            <button type="button" className="ui-icon-button" disabled={!canUndo} onClick={undo} title={`${t('undo')} (Ctrl+Z)`} aria-label={t('undo')}>
              <Undo2 size={16} strokeWidth={1.75} />
            </button>
            <button type="button" className="ui-icon-button" disabled={!canRedo} onClick={redo} title={`${t('redo')} (Ctrl+Shift+Z)`} aria-label={t('redo')}>
              <Redo2 size={16} strokeWidth={1.75} />
            </button>
          </div>
          <span className="app-rule" />
          <div className="ui-segment app-segment app-segment--lang" aria-label="Language">
            <button type="button" className={`ui-segment__btn${language === 'zh' ? ' ui-segment__btn--active' : ''}`} onClick={() => setLanguage('zh')}>中</button>
            <button type="button" className={`ui-segment__btn${language === 'en' ? ' ui-segment__btn--active' : ''}`} onClick={() => setLanguage('en')}>EN</button>
          </div>
          <button
            type="button"
            className="ui-theme-toggle"
            onClick={toggleTheme}
            title={theme === 'light' ? t('darkMode') : t('lightMode')}
            aria-label={theme === 'light' ? t('darkMode') : t('lightMode')}
          >
            <ThemeGlyph />
          </button>
          <button
            type="button"
            className={`ui-button ui-button--secondary${roughnessWireframe ? ' is-active' : ''}`}
            onClick={toggleRoughnessWireframe}
            title={t(roughnessWireframe ? 'hideRoughnessWireframe' : 'showRoughnessWireframe')}
            aria-label={t('roughnessWireframe')}
            aria-pressed={roughnessWireframe}
          >
            <Waypoints size={16} strokeWidth={1.75} />
            <span className="app-label-text">{t('roughnessWireframe')}</span>
          </button>
          <button
            type="button"
            className="ui-icon-button"
            disabled={!selectedId}
            onClick={() => duplicateElement(selectedId)}
            title={`${t('duplicate')} (Ctrl+D)`}
            aria-label={t('duplicate')}
          >
            <Copy size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="ui-icon-button" onClick={handleClear} title={t('clear')} aria-label={t('clear')}>
            <Trash2 size={16} strokeWidth={1.75} />
          </button>
          <input
            ref={fileInputRef}
            className="app-file-input"
            type="file"
            accept=".xml,application/xml,text/xml"
            onChange={handleLoad}
          />
          <button type="button" className="ui-button ui-button--secondary" onClick={handleChooseFile} title={t('loadTitle')}>
            <Upload size={15} strokeWidth={1.75} />
            <span className="app-label-text">{t('loadXml')}</span>
          </button>
          {sourceFileName && (
            <button
              type="button"
              className="ui-button ui-button--secondary"
              disabled={!hasUnsavedChanges}
              onClick={handleSave}
              title={hasUnsavedChanges ? t('saveTitle', { filename: sourceFileName }) : t('savedTitle')}
            >
              <Save size={15} strokeWidth={1.75} />
              <span className="app-label-text">{t('saveXml')}</span>
            </button>
          )}
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={exportingHeightfield || !elements.some(hasHeightfieldSurface)}
            onClick={handleHeightfieldExport}
            title={t('heightfieldExportTitle')}
            aria-label={t('heightfieldExport')}
          >
            <ImageDown size={15} strokeWidth={1.75} />
            <span className="app-label-text">{t('heightfieldExport')}</span>
          </button>
          <button type="button" className="ui-button" onClick={handleExport} title={t('exportTitle')}>
            <Download size={15} strokeWidth={1.75} />
            <span className="app-label-text">{t('exportXml')}</span>
          </button>
        </div>
      </header>
      {saveToast && (
        <div className="app-toast ui-panel" role="status" aria-live="polite">
          <CheckCircle2 size={16} strokeWidth={1.75} />
          <span>{saveToast}</span>
        </div>
      )}
    </>
  );
}

export default TopBar;
