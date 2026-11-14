const CACHE_PREFIX = 'concretecheck-shell-'
const CACHE_NAME = `${CACHE_PREFIX}v3`
const APP_SHELL_URL = '/app/'
const APP_SHELL_FILE = '/app/index.html'
const PUBLIC_ASSETS = [
  '/',
  '/ja/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/pwa-maskable-512.png',
]

async function cacheApplicationShell(cache) {
  const response = await fetch(APP_SHELL_URL, { cache: 'reload' })
  if (!response.ok) throw new Error(`Application shell request failed: ${response.status}`)

  const html = await response.clone().text()
  await cache.put(APP_SHELL_URL, response.clone())
  await cache.put(APP_SHELL_FILE, response.clone())

  const bundledAssets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/gi)]
    .map(match => new URL(match[1], self.location.origin).href)

  await Promise.all(bundledAssets.map(async assetUrl => {
    try {
      const assetResponse = await fetch(assetUrl, { cache: 'reload' })
      if (assetResponse.ok) await cache.put(assetUrl, assetResponse)
    } catch {
      // The application shell can still install if an optional bundle is unavailable.
    }
  }))
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await cacheApplicationShell(cache)
    await Promise.all(PUBLIC_ASSETS.map(async asset => {
      try {
        const response = await fetch(asset, { cache: 'reload' })
        if (response.ok) await cache.put(asset, response)
      } catch {
        // Public landing pages and icons are optional to the offline app shell.
      }
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  event.respondWith((async () => {
    try {
      const response = await fetch(request, request.mode === 'navigate' ? { cache: 'no-store' } : undefined)
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME)
        await cache.put(request, response.clone())
      }
      return response
    } catch {
      const cached = await caches.match(request, { ignoreSearch: true })
      if (cached) return cached
      if (request.mode === 'navigate') {
        if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
          return (await caches.match(APP_SHELL_FILE)) || (await caches.match(APP_SHELL_URL)) || Response.error()
        }
        if (url.pathname === '/ja' || url.pathname.startsWith('/ja/')) {
          return (await caches.match('/ja/')) || Response.error()
        }
        if (url.pathname === '/') return (await caches.match('/')) || Response.error()
      }
      return Response.error()
    }
  })())
})
