/**
 * sync.js - Offline-first localStorage sync
 *
 * How it works:
 * - All data lives in localStorage FIRST (instant, always available)
 * - When server is reachable, changes sync in background
 * - When server is down (computer off), app keeps working
 * - Pending writes are persisted and flush when connection returns
 * - Service Worker caches the app itself for offline loading
 *
 * LOCAL-ONLY keys (per device, never synced):
 *   clerk_obs_session, clerk_obs_dark, clerk_obs_prefs, reviewDaySetup
 */
(function() {
  'use strict';

  // === Skip entirely in file:// mode ===
  if (window.location.protocol === 'file:') return;

  // === Register Service Worker ===
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function(e) {
      console.warn('[SW] Registration failed:', e);
    });
  }

  var API = '/api/store';

  // === Local-only keys ===
  var LOCAL_KEYS = {
    clerk_obs_session: true,
    clerk_obs_dark: true,
    clerk_obs_prefs: true,
    reviewDaySetup: true,
    _sync_pending: true,
    _sync_status: true
  };

  function isShared(key) {
    if (!key || LOCAL_KEYS[key]) return false;
    if (key.indexOf('clerk_obs_') === 0) return true;
    if (key === 'timeTracker_observations') return true;
    return false;
  }

  // === Original localStorage methods ===
  var _set = localStorage.setItem.bind(localStorage);
  var _get = localStorage.getItem.bind(localStorage);
  var _del = localStorage.removeItem.bind(localStorage);
  var _clr = localStorage.clear.bind(localStorage);

  // === Connection state ===
  var online = false;
  var syncInProgress = false;

  function checkConnection(callback) {
    var x = new XMLHttpRequest();
    x.open('HEAD', API, true);
    x.timeout = 3000;
    x.onload = function() { online = true; if (callback) callback(true); };
    x.onerror = function() { online = false; if (callback) callback(false); };
    x.ontimeout = function() { online = false; if (callback) callback(false); };
    x.send();
  }

  // === Persistent write queue ===
  // Writes are stored in localStorage under _sync_pending so they survive
  // page refreshes, browser closes, and device restarts.
  function getPendingWrites() {
    try {
      var raw = _get('_sync_pending');
      return raw ? JSON.parse(raw) : {};
    } catch(e) { return {}; }
  }

  function savePendingWrites(queue) {
    _set('_sync_pending', JSON.stringify(queue));
  }

  function queueWrite(key, value) {
    var pending = getPendingWrites();
    pending[key] = value; // null means delete
    savePendingWrites(pending);
    scheduleFlush();
  }

  // === Flush pending writes to server ===
  var flushTimer = null;
  var FLUSH_DELAY = 500; // ms debounce

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushPending, FLUSH_DELAY);
  }

  function flushPending() {
    flushTimer = null;
    var pending = getPendingWrites();
    var keys = Object.keys(pending);
    if (keys.length === 0) return;

    if (!online) {
      updateStatusUI('offline', keys.length + ' changes queued');
      return;
    }

    updateStatusUI('syncing', 'Syncing ' + keys.length + ' changes...');

    var x = new XMLHttpRequest();
    x.open('POST', API + '/bulk', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function() {
      if (x.status === 200) {
        // Remove flushed keys from pending queue
        var current = getPendingWrites();
        keys.forEach(function(k) {
          // Only remove if the value hasn't changed since we sent it
          if (current[k] === pending[k]) delete current[k];
        });
        savePendingWrites(current);
        updateStatusUI('online', 'Synced');
      } else {
        online = false;
        updateStatusUI('offline', 'Sync failed - will retry');
      }
    };
    x.onerror = function() {
      online = false;
      updateStatusUI('offline', keys.length + ' changes queued');
    };
    x.send(JSON.stringify(pending));
  }

  // === Override localStorage ===
  localStorage.setItem = function(key, value) {
    _set(key, value);
    if (isShared(key)) {
      queueWrite(key, value);
    }
  };

  localStorage.removeItem = function(key) {
    _del(key);
    if (isShared(key)) {
      queueWrite(key, null);
    }
  };

  localStorage.clear = function() {
    _clr();
    if (online) {
      try { var x = new XMLHttpRequest(); x.open('POST', API + '/clear', true); x.send(); } catch(e) {}
    }
  };

  // === Pull from server ===
  function pullFromServer(callback) {
    if (syncInProgress) return;
    syncInProgress = true;

    var x = new XMLHttpRequest();
    x.open('GET', API, true);
    x.timeout = 8000;
    x.onload = function() {
      syncInProgress = false;
      if (x.status === 200) {
        online = true;
        try {
          var store = JSON.parse(x.responseText);
          var keys = Object.keys(store);
          var pending = getPendingWrites();

          keys.forEach(function(key) {
            if (isShared(key) && !pending[key]) {
              // Only update if we don't have a pending write for this key
              var val = store[key];
              if (typeof val !== 'string') val = JSON.stringify(val);
              var current = _get(key);
              if (current !== val) {
                _set(key, val);
              }
            }
          });
          updateStatusUI('online', 'Synced');
        } catch(e) {}
        if (callback) callback(true);
      } else {
        if (callback) callback(false);
      }
    };
    x.onerror = function() {
      syncInProgress = false;
      online = false;
      updateStatusUI('offline', getPendingCount() > 0 ? getPendingCount() + ' changes queued' : 'Server unavailable');
      if (callback) callback(false);
    };
    x.ontimeout = function() {
      syncInProgress = false;
      online = false;
      if (callback) callback(false);
    };
    x.send();
  }

  function getPendingCount() {
    return Object.keys(getPendingWrites()).length;
  }

  // === Initial sync (non-blocking) ===
  function initialSync() {
    var x = new XMLHttpRequest();
    x.open('GET', API, true);
    x.timeout = 5000;
    x.onload = function() {
      if (x.status === 200) {
        online = true;
        try {
          var store = JSON.parse(x.responseText);
          var keys = Object.keys(store);
          var pending = getPendingWrites();

          if (keys.length === 0 && getPendingCount() === 0) {
            // Server empty + no pending = seed server with local data
            seedServer();
          } else {
            // Pull server data (skip keys with pending local writes)
            keys.forEach(function(key) {
              if (isShared(key) && !pending[key]) {
                var val = store[key];
                if (typeof val !== 'string') val = JSON.stringify(val);
                _set(key, val);
              }
            });
          }
        } catch(e) {}

        // Flush any pending writes
        if (getPendingCount() > 0) flushPending();
        updateStatusUI('online', 'Synced');
      }
      hideOverlay();
    };
    x.onerror = function() {
      online = false;
      updateStatusUI('offline', getPendingCount() > 0 ? getPendingCount() + ' queued' : 'Working offline');
      hideOverlay();
    };
    x.ontimeout = function() {
      online = false;
      updateStatusUI('offline', 'Working offline');
      hideOverlay();
    };
    x.send();
  }

  function seedServer() {
    var batch = {};
    var found = false;
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (isShared(key)) { batch[key] = _get(key); found = true; }
    }
    if (!found) return;
    try {
      var x = new XMLHttpRequest();
      x.open('POST', API + '/bulk', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify(batch));
    } catch(e) {}
  }

  // === Background sync loop ===
  var SYNC_INTERVAL = 8000;

  function backgroundSync() {
    // First try to flush pending writes
    var pending = getPendingWrites();
    if (Object.keys(pending).length > 0) {
      flushPending();
    }
    // Then pull latest from server
    pullFromServer();
  }

  // === Reconnection detection ===
  // If we go offline, check more frequently for reconnection
  var reconnectTimer = null;
  function startReconnectLoop() {
    if (reconnectTimer) return;
    reconnectTimer = setInterval(function() {
      if (online) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
        return;
      }
      checkConnection(function(isOnline) {
        if (isOnline) {
          clearInterval(reconnectTimer);
          reconnectTimer = null;
          // Reconnected! Flush pending and pull
          updateStatusUI('syncing', 'Reconnected - syncing...');
          flushPending();
          setTimeout(function() { pullFromServer(); }, 1000);
        }
      });
    }, 5000); // Check every 5 seconds when offline
  }

  // === Status UI ===
  function createStatusUI() {
    var bar = document.createElement('div');
    bar.id = 'sync-bar';
    bar.setAttribute('style',
      'position:fixed;bottom:0;left:0;right:0;z-index:99998;' +
      'padding:4px 12px;font-size:0.75rem;font-family:system-ui,sans-serif;' +
      'display:flex;align-items:center;gap:6px;' +
      'transition:transform 0.3s,background 0.3s;transform:translateY(100%);'
    );
    bar.innerHTML = '<span id="sync-dot" style="width:8px;height:8px;border-radius:50%;"></span>' +
                    '<span id="sync-msg"></span>' +
                    '<span id="sync-pending" style="margin-left:auto;opacity:0.7;"></span>';
    document.body.appendChild(bar);
  }

  function updateStatusUI(state, msg) {
    var bar = document.getElementById('sync-bar');
    if (!bar) return;
    var dot = document.getElementById('sync-dot');
    var msgEl = document.getElementById('sync-msg');
    var pendingEl = document.getElementById('sync-pending');

    var count = getPendingCount();
    pendingEl.textContent = count > 0 ? count + ' pending' : '';

    msgEl.textContent = msg || '';

    if (state === 'online') {
      bar.style.background = '#065f46';
      bar.style.color = '#d1fae5';
      dot.style.background = '#34d399';
      // Auto-hide after 3 seconds when synced
      bar.style.transform = 'translateY(0)';
      setTimeout(function() {
        if (online && getPendingCount() === 0) bar.style.transform = 'translateY(100%)';
      }, 3000);
    } else if (state === 'offline') {
      bar.style.background = '#7c2d12';
      bar.style.color = '#fed7aa';
      dot.style.background = '#fb923c';
      bar.style.transform = 'translateY(0)';
      startReconnectLoop();
    } else if (state === 'syncing') {
      bar.style.background = '#1e3a5f';
      bar.style.color = '#bfdbfe';
      dot.style.background = '#60a5fa';
      bar.style.transform = 'translateY(0)';
    }
  }

  // === Loading overlay ===
  var overlay = document.createElement('div');
  overlay.id = 'sync-loading-overlay';
  overlay.setAttribute('style',
    'position:fixed;inset:0;z-index:99999;' +
    'background:#0f172a;display:flex;align-items:center;justify-content:center;' +
    'flex-direction:column;transition:opacity 0.4s;'
  );
  overlay.innerHTML =
    '<div style="font-size:1.3rem;color:#e2e8f0;font-weight:700;">RPOO Function 4 Review Program</div>' +
    '<div style="font-size:0.9rem;color:#94a3b8;margin-top:0.75rem;">Loading...</div>' +
    '<div style="margin-top:1.5rem;width:40px;height:40px;border:3px solid #334155;border-top-color:#6366f1;border-radius:50%;animation:sync-spin 0.8s linear infinite;"></div>' +
    '<style>@keyframes sync-spin{to{transform:rotate(360deg)}}</style>';
  document.documentElement.appendChild(overlay);

  function hideOverlay() {
    var ov = document.getElementById('sync-loading-overlay');
    if (ov) {
      ov.style.opacity = '0';
      setTimeout(function() { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 400);
    }
  }

  // === Boot sequence ===
  // DOM ready - create status bar, start sync
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    createStatusUI();
    initialSync();
    setInterval(backgroundSync, SYNC_INTERVAL);
  }

  // Flush on page unload
  window.addEventListener('beforeunload', function() {
    var pending = getPendingWrites();
    if (Object.keys(pending).length > 0) {
      // Synchronous flush attempt
      try {
        var x = new XMLHttpRequest();
        x.open('POST', API + '/bulk', false);
        x.setRequestHeader('Content-Type', 'application/json');
        x.send(JSON.stringify(pending));
        if (x.status === 200) savePendingWrites({});
      } catch(e) {
        // Pending writes stay in localStorage - will sync next time
      }
    }
  });

  // Network status events
  window.addEventListener('online', function() {
    checkConnection(function(isOnline) {
      if (isOnline) {
        updateStatusUI('syncing', 'Reconnected - syncing...');
        flushPending();
        setTimeout(pullFromServer, 500);
      }
    });
  });

  window.addEventListener('offline', function() {
    online = false;
    updateStatusUI('offline', 'No connection - changes saved locally');
  });

  // === Public API ===
  window.AppSync = {
    isOnline: function() { return online; },
    pendingCount: getPendingCount,
    forceSync: backgroundSync,
    forcePush: flushPending,
    forcePull: pullFromServer,
    flushWrites: flushPending
  };
})();
