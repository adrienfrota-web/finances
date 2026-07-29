const CACHE_NAME = 'finances-cache-v4';
const FICHIERS_A_METTRE_EN_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(FICHIERS_A_METTRE_EN_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(noms) {
      return Promise.all(
        noms.filter(function(nom) { return nom !== CACHE_NAME; })
            .map(function(nom) { return caches.delete(nom); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  const url = event.request.url;

  // Ne jamais mettre en cache les appels à l'API Apps Script :
  // les données financières doivent toujours être fraîches.
  if (url.indexOf('script.google.com') !== -1) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Fichiers statiques : réseau en priorité, repli sur le cache si hors-ligne.
  event.respondWith(
    fetch(event.request)
      .then(function(reponse) {
        const copie = reponse.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, copie);
        });
        return reponse;
      })
      .catch(function() {
        return caches.match(event.request);
      })
  );
});
