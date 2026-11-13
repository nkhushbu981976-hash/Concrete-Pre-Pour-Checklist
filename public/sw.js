const CACHE_PREFIX = 'concretecheck-shell-'
const CACHE_NAME = `${CACHE_PREFIX}v1`
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/pwa-maskable-512.png',
]

async function cacheCurrentShell(cache) {
  const response = await fetch('/', { cache: 'reload' })
  if (!response.ok) throw new Error(`App shell request failed: ${response.status}`)

  const html = await response.clone().text()
  await cache.put('/', response.clone())
  await cache.put('/index.html', response.clone())

  const bundledAssets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/gi)]
    .map(match => new URL(match[1], self.location.origin).href)

  await Promise.all(bundledAssets.map(async assetUrl => {
    try {
      const assetResponse = await fetch(assetUrl, { cache: 'reload' })
      if (assetResponse.ok) await cache.put(assetUrl, assetResponse)
    } catch {
      // A single optional bundle must not prevent the new worker from installing.
    }
  }))
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await cacheCurrentShell(cache)
    await Promise.all(SHELL_ASSETS.slice(2).map(async asset => {
      try {
        const response = await fetch(asset, { cache: 'reload' })
        if (response.ok) await cache.put(asset, response)
      } catch {
        // The app shell can still be used if a nonessential icon is unavailable.
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
        if (request.mode === 'navigate') await cache.put('/index.html', response.clone())
      }
      return response
    } catch {
      const cached = await caches.match(request, { ignoreSearch: true })
      if (cached) return cached
      if (request.mode === 'navigate') {
        return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error()
      }
      return Response.error()
    }
  })())
})