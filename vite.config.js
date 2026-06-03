import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// base: '/' for dev and the Tauri desktop build (served from root). The GitHub
// Pages build sets BASE_PATH=/agent-atlas-studio/ (the project-pages subpath) so
// assets resolve correctly there. Set via the Pages workflow.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
