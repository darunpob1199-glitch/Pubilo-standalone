import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'https://pubilo-api-dev.lungnuek.workers.dev',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  define: {
    __API_BASE__: JSON.stringify(process.env.VITE_API_BASE || ''),
  },
})
