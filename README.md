# MuJoCo Terrain Editor

[English](README.md) | [简体中文](README-zh.md)

A browser-based 3D terrain editor for MuJoCo. Build simulation environments from boxes, cylinders, ramps, stairs, and platforms, then export them as ready-to-load MJCF XML.

The editor runs entirely in the browser and provides interactive transforms, precise parameter controls, scene persistence through MJCF import/export, and a bilingual light/dark interface.

## Features

- Compose terrain visually with reusable box, cylinder, ramp, stair, and platform primitives.
- Move and rotate objects with 3D transform gizmos or edit their values precisely in the properties panel.
- Select and move multiple objects as a group.
- Keep objects automatically grounded at `Z = 0`, or disable ground locking for unrestricted vertical placement.
- Customize MJCF-compatible geom names and terrain colors.
- Undo, redo, duplicate, and delete objects with toolbar actions or keyboard shortcuts.
- Export the scene as standalone MJCF XML and import it later for continued editing.
- Save changes directly back to an opened XML file in browsers that support the File System Access API.
- Switch between English and Chinese interfaces and light or dark themes.
- The viewport uses soft lighting in both light and dark themes.

## Getting Started

Install the dependencies and start the Vite development server:

```bash
npm install
npm run dev
```

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Usage

1. Drag a terrain primitive from the left sidebar into the viewport. Double-clicking a primitive adds it at the origin.
2. Select an object and use the toolbar to switch between move and rotate modes. Use the properties panel for exact dimensions and transforms.
3. Leave **Ground Lock** enabled to keep the bottom of the object on `Z = 0`, or disable it to edit the height freely.
4. Set the **Geom Name** used for the exported MJCF `<geom name="...">` attribute.
5. Select **Export XML** to download a timestamped file such as `terrain_08_06-21_21_.xml`.
6. Use **Load XML**, or drag an XML file anywhere onto the editor, to restore a scene and continue editing it. After loading a file, supported browsers expose a **Save** action that can overwrite the original file after permission is granted.

The editor protects unsaved changes before loading another file. Direct file saving requires a browser with File System Access API support, such as a current Chromium-based version of Chrome or Edge.

### Viewport Controls

- Left drag: orbit the camera, or manipulate the active transform gizmo.
- Right drag: pan the camera.
- Middle drag or mouse wheel: zoom.
- `Shift` / `Ctrl` / `Cmd` + click: add or remove an object from the current selection.

### Keyboard Shortcuts

| Action | Shortcut |
| --- | --- |
| Move mode | `W` |
| Rotate mode | `E` |
| Duplicate | `Ctrl+D` / `Cmd+D` |
| Undo | `Ctrl+Z` / `Cmd+Z` |
| Redo | `Ctrl+Shift+Z`, `Cmd+Shift+Z`, or `Ctrl/Cmd+Y` |
| Rotate 90° counterclockwise around Z | `Shift+[` |
| Rotate 90° clockwise around Z | `Shift+]` |
| Delete selection | `Delete` |
| Clear selection | `Esc` |

## Editor Conventions

- The scene, transform gizmos, and coordinate indicator use a right-handed, Z-up coordinate system.
- Lengths are expressed in meters and angles in degrees.
- Translation snaps in increments of `0.05 m`; rotation snaps in increments of `1°`.
- Translation gizmos operate in world space, while rotation gizmos operate in the selected object's local space.
- Multi-selection currently supports group translation only.
- MJCF names are restricted to ASCII letters, digits, underscores, hyphens, and periods.

## Terrain Parameters

- **Box:** width, depth, and height.
- **Cylinder:** radius and height.
- **Ramp:** surface width, horizontal length, and slope angle.
- **Stairs:** step width, step length, step height, and step count. Stairs rise along the positive X axis by default. Enable **Floating Stairs** for separate treads with configurable thickness (default: `0.05 m`). The thickness field appears only when enabled. Ground Lock keeps the lowest tread's bottom at `Z = 0`.
- **Platform:** width, depth, and height.

Default dimensions and terrain definitions are centralized in [`src/data/presets.js`](src/data/presets.js). Change a parameter's `default` value to update its initial dimensions. To introduce a new terrain type, add a `defineTerrainPreset` configuration; the component library, properties panel, ground-lock behavior, and XML exporter will use it automatically.

Editor-wide snapping increments and gizmo sizes are defined in [`src/editorConfig.js`](src/editorConfig.js).

### Random Boxes

Select a Box and enable **Generate Random Boxes** under Geometry Parameters. Set the count (`1–200`) and the min/max ranges for width, length, and height in meters and yaw about the local Z axis in degrees (`−180° to 180°`, default `0°`). Centers are sampled across the full base. Footprints are clipped at its edges and corners after rotation, and boxes may overlap. Click **Regenerate** for a new seed or enter a **Box Seed** to reproduce a layout.

The boxes move and rotate with the base. With **Apply Perlin Noise** enabled, each box rests at the base height under its center and its top samples the same noise field, including rotated and clipped tops. MJCF exports include the rough surfaces as collision meshes and preserve the settings when reopened in the editor.

**Export Heightfield** downloads a ZIP with `terrain.xml` and one grayscale PNG per Box that uses random boxes or Perlin noise. Extract the files together and open `terrain.xml` in MuJoCo. The heightfield samples the highest surface on a grid with 256 intervals along the longest edge and stores 256 height levels. This approximates vertical steps and clipped edges. Use **Export XML** to preserve their geometry in convex collision meshes. Other terrain elements retain their standard export format.

### Perlin Surface Roughness

Every terrain type has an **Apply Perlin Noise** checkbox. Enabling it reveals:

- **Noise Amplitude:** signed roughness range in meters, from minus to plus this value (default: `±0.02`).
- **Noise Height Step:** height-field quantization increment in meters (default: `0.01`). Heights are rounded to this step before interpolation; range limits are rounded to the nearest step as well.
- **Noise Frequency:** spatial frequency in inverse meters (default: `2`); higher values create smaller features.
- **Noise Seed:** integer seed for reproducible surfaces (default: `1`).
- **Surface Resolution:** subdivisions along the terrain's longest edge (default: `16`, range: `4–32`); increase it to capture finer noise.

Roughness follows LocoLab's shared sampler: two gradient-Perlin octaves with weights `1` and `0.25`, mean centering, signed range scaling, height quantization, and bilinear sampling. The seed also varies the coarse wavelength within one octave. Frequency is limited by grid spacing to avoid undersampling.

Noisy upper surfaces use matte shading, crisp borders, and a subtle height-based tint to keep shallow relief readable without changing the geometry or exported colors. Use the toolbar's **Roughness Wireframe** button to show a subtle inspection mesh (hidden by default).

All treads sample one terrain-wide field. Only the outer terrain border (one grid cell wide) stays flat; internal tread edges follow the roughness. Noise affects local upper surfaces, including the cylinder's circular top, while footprints and bottoms stay fixed. Deep depressions are limited to leave at least `1 mm` of material in thin treads. Settings support undo/redo and XML import/export. Export merges adjacent collision sections when their union is convex. The resulting meshes are embedded in the MJCF and preserve the surface relief. Higher resolution increases XML size and simulation cost.

## Roadmap

- [x] Add configurable Perlin noise for terrain surfaces, including amplitude, frequency, and random seed controls, with MJCF export as loadable meshes.
- [ ] Deploy on Github Page.
