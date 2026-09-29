/**
 * Cloudflare Worker for God's Eye View
 * Handles edge caching, API proxying for live feeds, and static asset delivery.
 */

const USER_AGENT = 'GodsEyeView-CloudflareWorker/1.0 (+https://github.com/Nanefouad/gods-eye-view)';

/** Security & CORS headers */
function getSecurityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Requested-With',
  };
}

/** Helper to return JSON responses with standard headers */
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getSecurityHeaders(),
      ...headers,
    },
  });
}

/**
 * Handle edge-cached API calls using Cloudflare's Cache API
 */
async function fetchWithCache(request, upstreamUrl, ttlSeconds = 300, upstreamHeaders = {}) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  let response = await cache.match(cacheKey);

  if (response) {
    const cachedResponse = new Response(response.body, response);
    cachedResponse.headers.set('X-Edge-Cache', 'HIT');
    return cachedResponse;
  }

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        ...upstreamHeaders,
      },
    });

    if (!upstreamRes.ok) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: {
          ...getSecurityHeaders(),
          'Content-Type': upstreamRes.headers.get('Content-Type') || 'text/plain',
        },
      });
    }

    const responseHeaders = new Headers(upstreamRes.headers);
    responseHeaders.set('Cache-Control', `public, max-age=${ttlSeconds}`);
    responseHeaders.set('X-Edge-Cache', 'MISS');
    for (const [k, v] of Object.entries(getSecurityHeaders())) {
      responseHeaders.set(k, v);
    }

    response = new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });

    // Store in Cloudflare Edge Cache
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    return jsonResponse({ error: 'upstream_fetch_failed', detail: error.message }, 502);
  }
}

/**
 * Route handler for all /api/* requests
 */
async function handleApiRequest(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  // OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getSecurityHeaders(),
    });
  }

  // Healthcheck endpoint
  if (pathname === '/api/health') {
    return jsonResponse({
      status: 'ok',
      service: "God's Eye View",
      runtime: 'cloudflare-workers',
      timestamp: new Date().toISOString(),
    });
  }

  // CelesTrak satellite TLE proxy (cached for 6 hours)
  if (pathname.startsWith('/api/celestrak')) {
    const subpath = pathname.replace('/api/celestrak', '').replace(/^\//, '');
    const group = subpath || searchParams.get('GROUP') || 'active';
    const upstream = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
    return fetchWithCache(request, upstream, 21600);
  }

  // Rocket Launches proxy (Launch Library 2, cached for 30 minutes)
  if (pathname === '/api/launches') {
    const upstream = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10';
    return fetchWithCache(request, upstream, 1800);
  }

  // ADSB.lol military & live aircraft feeds
  if (pathname.startsWith('/api/adsblol/')) {
    const subpath = pathname.replace('/api/adsblol/', '');
    const upstream = `https://api.adsb.lol/v2/${subpath}${url.search}`;
    return fetchWithCache(request, upstream, 5); // 5s short cache for live positions
  }

  // NASA FIRMS active fires
  if (pathname.startsWith('/api/firms')) {
    const key = env.FIRMS_MAP_KEY;
    if (!key) {
      return jsonResponse({ error: 'no_key', message: 'FIRMS_MAP_KEY is not configured in Worker secrets.' }, 200);
    }
    const subpath = pathname.replace('/api/firms', '').replace(/^\//, '');
    const upstream = `https://firms.modaps.eosdis.nasa.gov/api/${subpath}${url.search}`;
    return fetchWithCache(request, upstream, 300);
  }

  // OpenStreetMap Nominatim / Geocoding
  if (pathname === '/api/geocode') {
    const query = searchParams.get('q') || '';
    if (!query.trim()) {
      return jsonResponse([]);
    }
    const upstream = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=10`;
    return fetchWithCache(request, upstream, 3600);
  }

  // OpenStreetMap Overpass API
  if (pathname === '/api/overpass') {
    const upstream = 'https://overpass-api.de/api/interpreter';
    if (request.method === 'POST') {
      const body = await request.text();
      const res = await fetch(upstream, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      return new Response(res.body, {
        status: res.status,
        headers: { ...getSecurityHeaders(), 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
      });
    }
    return fetchWithCache(request, `${upstream}${url.search}`, 300);
  }

  // OpenSky Network proxy
  if (pathname === '/api/opensky') {
    const upstream = 'https://opensky-network.org/api/states/all';
    const headers = {};
    if (env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET) {
      const basic = btoa(`${env.OPENSKY_CLIENT_ID}:${env.OPENSKY_CLIENT_SECRET}`);
      headers['Authorization'] = `Basic ${basic}`;
    }
    return fetchWithCache(request, upstream, 10, headers);
  }

  // TomTom Traffic Flow
  if (pathname.startsWith('/api/tomtom')) {
    const key = env.TOMTOM_API_KEY;
    if (!key) {
      return jsonResponse({ error: 'no_key', message: 'TOMTOM_API_KEY is not configured in Worker secrets.' }, 200);
    }
    const subpath = pathname.replace('/api/tomtom', '').replace(/^\//, '');
    const upstream = `https://api.tomtom.com/traffic/${subpath}?key=${key}&${searchParams.toString()}`;
    return fetchWithCache(request, upstream, 60);
  }

  // CCTV Sources and Tile Fallback
  if (pathname === '/api/cctv/sources') {
    return jsonResponse({
      sources: [],
      message: 'CCTV catalog initialized on Cloudflare edge',
    });
  }

  // Setup / Provider status check
  if (pathname === '/api/setup/status' || pathname === '/api/setup/keys') {
    return jsonResponse({
      platform: 'cloudflare-workers',
      keys: [
        { id: 'google-maps', configured: Boolean(env.GOOGLE_MAPS_API_KEY) },
        { id: 'cesium-ion', configured: Boolean(env.CESIUM_ION_TOKEN) },
        { id: 'firms-map', configured: Boolean(env.FIRMS_MAP_KEY) },
        { id: 'tomtom-api', configured: Boolean(env.TOMTOM_API_KEY) },
        { id: 'openai-api', configured: Boolean(env.OPENAI_API_KEY) },
        { id: 'aisstream-api', configured: Boolean(env.AISSTREAM_API_KEY) },
      ],
    });
  }

  // Default API fallback
  return jsonResponse({ error: 'not_found', path: pathname }, 404);
}

export default {
  /**
   * Main Cloudflare Worker fetch handler
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route API requests
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, ctx);
    }

    // Serve static assets via Cloudflare Assets binding
    if (env.ASSETS) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          // Add security headers to the static asset response
          const headers = new Headers(assetResponse.headers);
          for (const [k, v] of Object.entries(getSecurityHeaders())) {
            headers.set(k, v);
          }
          return new Response(assetResponse.body, {
            status: assetResponse.status,
            statusText: assetResponse.statusText,
            headers,
          });
        }
      } catch (err) {
        // Continue to SPA fallback
      }

      // Single-Page Application (SPA) fallback: serve index.html for navigation routes
      if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
        const indexRequest = new Request(new URL('/index.html', request.url), request);
        return env.ASSETS.fetch(indexRequest);
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
