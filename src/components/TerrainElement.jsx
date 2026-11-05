import { forwardRef, useEffect, useMemo } from 'react';
import { BufferGeometry, Color, Float32BufferAttribute, WireframeGeometry } from 'three';
import { Edges } from '@react-three/drei';
import { getPreset } from '../data/presets';
import useSceneStore from '../store/useSceneStore';
import { paletteFor, scenePalette } from '../../ui/scenePalette.js';
import { createSurfaceGeometry } from '../utils/surfaceGeometry.js';

function SurfaceGeometry({ geometry }) {
  const buffer = useMemo(() => createSurfaceGeometry(geometry), [geometry]);
  useEffect(() => () => buffer.dispose(), [buffer]);
  return <primitive object={buffer} attach="geometry" />;
}

function SurfaceWireframe({ geometry, color, opacity }) {
  const wireframe = useMemo(() => {
    const surface = new BufferGeometry();
    surface.setAttribute('position', new Float32BufferAttribute(geometry.vertices.slice(0, geometry.topCount * 3), 3));
    surface.setIndex(geometry.topFaces);
    const result = new WireframeGeometry(surface);
    surface.dispose();
    return result;
  }, [geometry]);
  useEffect(() => () => wireframe.dispose(), [wireframe]);
  return (
    <lineSegments geometry={wireframe} raycast={() => null}>
      <lineBasicMaterial color={color} opacity={opacity} transparent depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}

const TerrainElement = forwardRef(function TerrainElement({ element, selected = false }, ref) {
  const selectElement = useSceneStore((state) => state.selectElement);
  const colorPickTargetId = useSceneStore((state) => state.colorPickTargetId);
  const applyColorFromElement = useSceneStore((state) => state.applyColorFromElement);
  const theme = useSceneStore((state) => state.theme);
  const roughnessWireframe = useSceneStore((state) => state.roughnessWireframe);
  const palette = paletteFor(theme);
  const preset = getPreset(element.type);
  const geometries = useMemo(() => preset?.toGeometries(element.params) || [], [preset, element.params]);
  if (!preset) return null;

  const rotation = element.rotation.map((degrees) => degrees * Math.PI / 180);
  const color = new Color(element.color);
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  const wireframeColor = luminance > 0.18 ? scenePalette.light.accent : scenePalette.dark.accent;

  return (
    <group ref={ref} position={element.position} rotation={rotation} scale={element.scale}>
      {geometries.map((geometry, index) => (
        <mesh
          key={`${element.id}-${index}`}
          position={geometry.position}
          rotation={geometry.shape === 'cylinder' ? [Math.PI / 2, 0, 0] : (geometry.rotation || [0, 0, 0])}
          castShadow
          receiveShadow
          onClick={(event) => {
            event.stopPropagation();
            if (colorPickTargetId) applyColorFromElement(element.id);
            else selectElement(element.id, event.shiftKey || event.ctrlKey || event.metaKey);
          }}
        >
          {geometry.shape === 'mesh' ? (
            <SurfaceGeometry geometry={geometry} />
          ) : geometry.shape === 'cylinder' ? (
            <cylinderGeometry args={[geometry.args[0], geometry.args[0], geometry.args[1], 48]} />
          ) : (
            <boxGeometry args={geometry.args} />
          )}
          <meshStandardMaterial
            color={element.color}
            vertexColors={geometry.shape === 'mesh'}
            roughness={0.88}
            metalness={0}
            polygonOffset={geometry.shape === 'mesh'}
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
          {geometry.shape === 'mesh' && roughnessWireframe && (
            <SurfaceWireframe geometry={geometry} color={wireframeColor} opacity={selected ? 0.28 : 0.16} />
          )}
          <Edges
            threshold={geometry.shape === 'mesh' ? 60 : 15}
            color={selected ? palette.edgeSelected : palette.edge}
            opacity={selected ? 1 : 0.55}
            transparent
          />
        </mesh>
      ))}
    </group>
  );
});

export default TerrainElement;
