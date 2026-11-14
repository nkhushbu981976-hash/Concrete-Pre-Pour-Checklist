import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

function japaneseLandingPageRoute() {
  return {
    name: 'concretecheck-japanese-landing-route',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url) {
          const url = new URL(request.url, 'http://localhost')
          if (url.pathname === '/ja' || url.pathname === '/ja/') {
            request.url = `/ja/index.html${url.search}`
          }
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [japaneseLandingPageRoute(), react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        app: resolve(process.cwd(), 'app/index.html'),
      },
    },
  },
})
