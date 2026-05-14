// Service Worker - Offline-first caching for RPOO Function 4 Review Program
var CACHE_NAME = 'rpoo-f4-v1';

var ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/review.html',
  '/admin.html',
  '/setup.html',
  '/settings.html',
  '/summary.html',
  '/help.html',
  '/seed.html',
  '/seed-travel.html',
  '/css/style.css',
  '/js/sync.js',
  '/js/offices.js',
  '/js/office-picker.js',
  '/js/auth.js',
  '/js/reviews.js',
  '/js/storage.js',
  '/js/app.js',
  '/js/mh-access.js',
  '/js/mailhandler.js',
  '/js/ps3922.js',
  '/js/trips.js',
  '/js/adus.js',
  '/js/questionnaire.js',
  '/js/summarization.js',
  '/js/endofday.js',
  '/js/timeline.js',
  '/js/workbook.js',
  '/js/workbook-review.js',
  '/js/schedule.js',
  '/js/scheduleViewer.js',
  '/js/travel.js',
  '/js/expense.js',
  '/js/summary.js',
  '/Offices.xlsx'
];

// Install: cache all assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch: network-first for API, cache-first for assets
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // API requests: network only (sync.js handles offline queueing)
  if (url.pathname.indexOf('/api/') === 0) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(JSON.stringify({error: 'offline'}), {
          status: 503,
          headers: {'Content-Type': 'application/json'}
        });
      })
    );
    return;
  }

  // Static assets: cache-first, fallback to network, update cache
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) {
        // Return cache immediately, but also update in background
        fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, response);
            });
          }
        }).catch(function() {});
        return cached;
      }
      // Not cached yet, try network
      return fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // If it's a navigation, return index
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('', {status: 503});
      });
    })
  );
});
