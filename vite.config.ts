import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    build: { outDir: 'dist/client' },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/socket.io': { target: env.DEV_SOCKET_PROXY_TARGET || `http://127.0.0.1:${env.PORT || '3001'}`, ws: true },
      },
    },
  }
})
