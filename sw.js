// Offline support: every file of the editor is served from the cache once it has been fetched.
// Small files: one cache per app version, filled at install. Big files (TeX bundle parts, engines):
// a cache of their own keyed by content, so an update only downloads the big files that changed.
const CACHE = 'texpad-acb8571a9759';
const CORE = ["KaTeX_AMS-Regular.woff2", "KaTeX_Caligraphic-Bold.woff2", "KaTeX_Caligraphic-Regular.woff2", "KaTeX_Fraktur-Bold.woff2", "KaTeX_Fraktur-Regular.woff2", "KaTeX_Main-Bold.woff2", "KaTeX_Main-BoldItalic.woff2", "KaTeX_Main-Italic.woff2", "KaTeX_Main-Regular.woff2", "KaTeX_Math-BoldItalic.woff2", "KaTeX_Math-Italic.woff2", "KaTeX_SansSerif-Bold.woff2", "KaTeX_SansSerif-Italic.woff2", "KaTeX_SansSerif-Regular.woff2", "KaTeX_Script-Regular.woff2", "KaTeX_Size1-Regular.woff2", "KaTeX_Size2-Regular.woff2", "KaTeX_Size3-Regular.woff2", "KaTeX_Size4-Regular.woff2", "KaTeX_Typewriter-Regular.woff2", "app.js", "apple-touch-icon.png", "cascadia-mono-latin-400-italic.woff2", "cascadia-mono-latin-400-normal.woff2", "cascadia-mono-latin-700-normal.woff2", "icon-192.png", "icon-512.png", "index.html", "iosevka-latin-400-italic.woff2", "iosevka-latin-400-normal.woff2", "iosevka-latin-700-normal.woff2", "katex.min.css", "luahbtex.js", "manifest.webmanifest", "offline-files.json", "pdf.min.js", "pdf.worker.min.js", "pdftex.js", "styles.css", "swiftlatexpdftex.js", "texlive-extra-1.json", "texlive-lua-parts.json", "texlive-lua.json", "texlive-packs.json", "texlive-parts.json", "texlive-pdftex-parts.json", "texlive-pdftex.json", "texlive.json", "tlglue.js"];
const BIG = {"luahbtex.wasm": "e1344764769e1529", "pdftex.wasm": "732f9f191f4b4d99", "swiftlatexpdftex.wasm": "8194a24490a7a2c9", "texlive-extra-1.bin": "86c5e86dd9088fa9", "texlive-lua.bin.00": "ac7fd9659266199e", "texlive-lua.bin.01": "5408b8b0f5ab5d72", "texlive-lua.bin.02": "72ecd22c4215f527", "texlive-pdftex.bin.00": "d8b488cf871209d3", "texlive.bin.00": "8fa1c30ea56d0eba", "texlive.bin.01": "987bd0d607f9b4eb", "texlive.bin.02": "30440aa75eb1f945", "texlive.bin.03": "ce5c1c57e74dd429", "texlive.bin.04": "f84e2ee828427eb0", "texlive.bin.05": "516cb62522fb788a", "texlive.bin.06": "1b43d8b37e6b94fe"};
const DATA = 'texpad-data';

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so an update never re-caches old files.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== DATA) await caches.delete(k);
    const keep = new Set(Object.entries(BIG).map(([p, h]) => p + '?v=' + h));
    const data = await caches.open(DATA);
    for (const req of await data.keys()) {
      const u = new URL(req.url);
      if (!keep.has(u.pathname.slice(u.pathname.lastIndexOf('/') + 1) + u.search)) await data.delete(req);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const path = url.pathname.slice(url.pathname.lastIndexOf('/') + 1) || 'index.html';
  e.respondWith((async () => {
    const big = BIG[path];
    const cache = await caches.open(big ? DATA : CACHE);
    const key = big ? path + '?v=' + big : path;
    const hit = await cache.match(key);
    if (hit) return hit;
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && path !== 'sw.js') await cache.put(key, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') { const idx = await cache.match('index.html'); if (idx) return idx; }
      throw err;
    }
  })());
});
