// Offline support: every file of the editor is served from the cache once it has been fetched.
const CACHE = 'texpad-80be96b519c2';
const CORE = ["KaTeX_AMS-Regular.woff2", "KaTeX_Caligraphic-Bold.woff2", "KaTeX_Caligraphic-Regular.woff2", "KaTeX_Fraktur-Bold.woff2", "KaTeX_Fraktur-Regular.woff2", "KaTeX_Main-Bold.woff2", "KaTeX_Main-BoldItalic.woff2", "KaTeX_Main-Italic.woff2", "KaTeX_Main-Regular.woff2", "KaTeX_Math-BoldItalic.woff2", "KaTeX_Math-Italic.woff2", "KaTeX_SansSerif-Bold.woff2", "KaTeX_SansSerif-Italic.woff2", "KaTeX_SansSerif-Regular.woff2", "KaTeX_Script-Regular.woff2", "KaTeX_Size1-Regular.woff2", "KaTeX_Size2-Regular.woff2", "KaTeX_Size3-Regular.woff2", "KaTeX_Size4-Regular.woff2", "KaTeX_Typewriter-Regular.woff2", "app.js", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "index.html", "iosevka-latin-400-italic.woff2", "iosevka-latin-400-normal.woff2", "iosevka-latin-700-normal.woff2", "katex.min.css", "manifest.webmanifest", "offline-files.json", "pdf.min.js", "pdf.worker.min.js", "styles.css", "swiftlatexpdftex.js", "texlive-parts.json", "texlive.json"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  let path = url.pathname.slice(url.pathname.lastIndexOf('/') + 1) || 'index.html';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(path);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && path !== 'sw.js') await cache.put(path, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') { const idx = await cache.match('index.html'); if (idx) return idx; }
      throw err;
    }
  })());
});
