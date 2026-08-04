/**
 * sw.js — Service Worker AutoRigon (Fase 5, PWA).
 * Gestisce ESCLUSIVAMENTE la cache degli asset statici dell'app (cache-first),
 * per il funzionamento offline. Non tocca mai i dati utente: quelli vivono solo
 * in IndexedDB (db.js), a cui il Service Worker non accede in alcun modo.
 *
 * Versionamento: incrementare CACHE_NAME ad ogni deploy che modifica un asset
 * precacheato (Sezione 11.1/12 del progetto) — l'activate elimina automaticamente
 * le cache con nome diverso da quello corrente.
 */

const CACHE_NAME = 'autorigon-v1';

/** Asset statici precacheati all'installazione (percorsi relativi alla root del progetto). */
const ASSET_DA_PRECACHARE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './assets/auto-splash.svg',
  './vendor/jspdf/jspdf.umd.min.js',
  './db.js',
  './logica.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSET_DA_PRECACHARE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nomiCache) => Promise.all(
        nomiCache
          .filter((nome) => nome !== CACHE_NAME)
          .map((nome) => caches.delete(nome))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const richiesta = event.request;

  // Mai intercettare metodi diversi da GET, né richieste blob:/data: (download
  // dinamici lato client — backup JSON e PDF generati in memoria — anche se
  // normalmente non passano affatto dal Service Worker).
  if (richiesta.method !== 'GET') return;
  if (richiesta.url.startsWith('blob:') || richiesta.url.startsWith('data:')) return;

  // Cache-first solo per richieste same-origin (asset statici dell'app).
  const url = new URL(richiesta.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(richiesta).then((rispostaCache) => {
      if (rispostaCache) return rispostaCache;

      return fetch(richiesta).then((rispostaRete) => {
        if (rispostaRete && rispostaRete.ok) {
          const copiaRisposta = rispostaRete.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(richiesta, copiaRisposta));
        }
        return rispostaRete;
      });
    })
  );
});
