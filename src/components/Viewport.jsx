import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import GroundPlane from './GroundPlane';
import TerrainElement from './TerrainElement';
import TransformGizmo from './TransformGizmo';
import GapCallout from './GapCallout';
import useSceneStore from '../store/useSceneStore';
import { translate } from '../i18n';
import { paletteFor } from '../../ui/scenePalette.js';

function Scene({ showOriginAxes }) {
  const elements = useSceneStore((state) => state.elements);
  const selectedIds = useSceneStore((state) => state.selectedIds);
  const selectedSet = new Set(selectedIds);
  const selectedElements = selectedIds
    .map((id) => elements.find((element) => element.id === id))
    .filter(Boolean);
  const theme = useSceneStore((state) => state.theme);
  const dark = theme === 'dark';
  const palette = paletteFor(theme);

  return (
    <>
      <color attach="background" args={[palette.background]} />
      <fog attach="fog" args={[palette.background, 19, 42]} />
      <ambientLight intensity={dark ? 0.7 : 1.05} />
      <hemisphereLight
        position={[0, 1, 0]}
        args={[palette.sky, palette.hemiGround, dark ? 0.7 : 1.1]}
      />
      <directionalLight
        position={[-7, -9, 14]}
        intensity={dark ? 2.2 : 2.6}
        castShadow
        shadow-bias={-0.0001}
        shadow-normalBias={0.015}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
      />
      <GroundPlane />
      {showOriginAxes && <axesHelper args={[1.5]} position={[0, 0, 0.008]} />}
      {elements.filter((element) => !selectedSet.has(element.id)).map((element) => (
        <TerrainElement key={element.id} element={element} />
      ))}
      {selectedElements.length > 0 && (
        <TransformGizmo key={selectedIds.join(':')} elements={selectedElements} />
      )}
      {selectedElements.length === 2 && (
        <GapCallout anchor={selectedElements[0]} mover={selectedElements[1]} />
      )}
      <OrbitControls
        makeDefault
        target={[0, 0, 0.5]}
        minDistance={2}
        maxDistance={42}
        enableDamping={false}
      />
      <GizmoHelper alignment="bottom-right" margin={[74, 74]}>
        <GizmoViewport
          hideNegativeAxes
          scale={40}
          axisColors={['#f06460', '#6fc66f', '#638fe3']}
          labelColor={palette.label}
        />
      </GizmoHelper>
    </>
  );
}

function Viewport() {
  const containerRef = useRef(null);
  const cameraRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const addElement = useSceneStore((state) => state.addElement);
  const elementCount = useSceneStore((state) => state.elements.length);
  const sourceFileName = useSceneStore((state) => state.sourceFileName);
  const language = useSceneStore((state) => state.language);
  const colorPickTargetId = useSceneStore((state) => state.colorPickTargetId);
  const [showShortcutGuide, setShowShortcutGuide] = useState(
    () => elementCount === 0 && !sourceFileName,
  );
  const t = (key) => translate(language, key);

  useEffect(() => {
    if (elementCount > 0 || sourceFileName) setShowShortcutGuide(false);
  }, [elementCount, sourceFileName]);

  const shortcuts = [
    ['W', t('move')],
    ['E', t('rotate')],
    ['Ctrl/Cmd + Z', t('undo')],
    ['Ctrl/Cmd + Shift + Z', t('redo')],
    ['Ctrl/Cmd + Y', t('redo')],
    ['Ctrl/Cmd + D', t('duplicateElement')],
    ['Delete', t('deleteElement')],
    ['Shift + [ / ]', t('rotate90')],
    ['Shift/Ctrl/Cmd + Click', t('multiSelect')],
    ['Esc', t('deselect')],
  ];

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    const type = event.dataTransfer.getData('application/x-terrain-preset')
      || event.dataTransfer.getData('text/plain');
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!type || !camera || !container) return;

    // Convert the browser pointer to normalized device coordinates, then
    // intersect its camera ray with the Z=0 editing plane.
    const rect = container.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const point = new THREE.Vector3();
    const ground = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    if (raycaster.ray.intersectPlane(ground, point)) {
      addElement(type, [point.x, point.y, 0]);
    }
  };

  return (
    <section
      ref={containerRef}
      className={`app-viewport${dragActive ? ' is-drag' : ''}${colorPickTargetId ? ' is-picking' : ''}`}
      data-drop-label={translate(language, 'dropTerrain')}
      onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [8, -10, 7.5], up: [0, 0, 1], fov: 46, near: 0.1, far: 100 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onCreated={({ camera, gl }) => {
          camera.up.set(0, 0, 1);
          cameraRef.current = camera;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <Suspense fallback={null}><Scene showOriginAxes={!showShortcutGuide} /></Suspense>
      </Canvas>
      {colorPickTargetId && (
        <div className="app-pick ui-panel" role="status">
          <span className="app-pick-dot" />
          {t('pickColorHint')}
          <kbd className="app-kbd">Esc</kbd>
        </div>
      )}
      {showShortcutGuide && (
        <div className="app-shortcuts ui-panel" role="status">
          <p className="ui-kicker">{t('shortcutGuideTitle')}</p>
          <div className="app-shortcut-grid">
            {shortcuts.map(([keys, label]) => (
              <div className="app-shortcut" key={keys}>
                <kbd className="app-kbd">{keys}</kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="app-badge">
        Z-UP · RIGHT-HANDED · GRID 1.0 M
        <span className="app-axis-key"><b>X</b><b>Y</b><b>Z</b></span>
      </div>
    </section>
  );
}

export default Viewport;
