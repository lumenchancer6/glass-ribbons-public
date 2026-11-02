import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5238, host: '127.0.0.1', strictPort: false },
  preview: { port: 5238, host: '127.0.0.1' },
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
})
