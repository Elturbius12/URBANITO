import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' para que funcione cargado desde archivo dentro del programa
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
})
