const CACHE = 'radio-movil-v3';
const ASSETS = [
  './', './index.html', './app.js', './manifest.webmanifest', './icon.svg',
  'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js',
  'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
  'https://unpkg.com/lz-string@1.5.0/libs/lz-string.min.js'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
