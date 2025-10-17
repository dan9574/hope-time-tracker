import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist' },
  // Use relative base in production so file:// URLs work in Electron
  base: mode === 'development' ? '/' : './',
}))
