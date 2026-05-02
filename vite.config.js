import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './', // 確保在 GitHub Pages 上的路徑正確
  plugins: [react()],
  build: {
    outDir: 'dist',
  }
})
