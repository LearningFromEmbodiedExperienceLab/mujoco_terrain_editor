# Agent Guidelines

## Project

Browser-based MuJoCo terrain editor built with React, Vite, Three.js, React Three Fiber, and Zustand. Uses JavaScript ES modules and JSX.

## Commands

- `npm install` — install dependencies.
- `npm run dev` — start the development server.
- `npm run build` — build for production.
- `npm run preview` — preview the production build.
- `node --test tests/terrain.test.mjs` — check terrain geometry, settings, and export.

## Code Map

- `src/components/` — editor UI and 3D viewport.
- `src/store/useSceneStore.js` — scene state, selection, and undo/redo.
- `src/data/presets.js` — terrain definitions, parameters, geometry, and defaults.
- `src/utils/` — MJCF import/export, grounding, names, colors, and gap calculations.
- `src/editorConfig.js` — snapping and gizmo settings.
- `src/i18n.js` — English and Chinese UI text.
- `ui/` — shared styles and themes; follow `ui/ui-contract.md` for UI changes.

## Working Rules

- State assumptions before coding. Ask when ambiguity affects the implementation.
- For multi-step work, give a brief plan with verifiable success criteria.
- Choose the simplest solution that meets the request. Avoid speculative features, abstractions, and dependencies.
- Keep changes focused. Match existing style; do not refactor or reformat unrelated code.
- Remove only unused code introduced by your changes. Report unrelated issues separately.
- Keep terrain behavior centralized in preset definitions and scene mutations in the store.
- Preserve the right-handed, Z-up coordinate system, meter units, and degree-based editor angles. Check conversions at rendering and MJCF boundaries.
- Keep English and Chinese labels in sync. Use existing UI classes and theme tokens.
- Update both READMEs when changing documented behavior.

## Verification

- Run `npm run build` and `node --test tests/terrain.test.mjs` after code changes. No lint script is currently configured.
- For bug fixes, reproduce the issue first, then verify the fix with a focused check.
- Manually check affected editor behavior, including undo/redo for scene mutations and XML round trips for import/export changes.
- Check both languages and themes when changing the UI.
- Review the final diff for unrelated edits. Report what changed, what was verified, and any remaining limitations.
