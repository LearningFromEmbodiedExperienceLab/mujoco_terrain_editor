import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Project Pages are served at /<repo>/; local dev and preview stay at /.
const base = process.env.GITHUB_ACTIONS ? '/mujoco_terrain_editor/' : '/';

export default defineConfig({
  plugins: [react()],
  base,
});
