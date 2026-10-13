import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // El proyecto vive en /mnt/c (OneDrive): inotify no funciona ahí.
    watch: { usePolling: true, interval: 300 },
  },
});
