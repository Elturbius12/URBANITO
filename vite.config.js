import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base '/' para que los recursos carguen bien en cualquier ruta de la SPA
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
})
