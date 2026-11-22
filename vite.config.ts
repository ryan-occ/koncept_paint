import { defineConfig } from 'vite';

// `base: './'` keeps asset paths relative, so the build works from any folder or GitHub Pages.
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
        },
      },
    },
  },
});
