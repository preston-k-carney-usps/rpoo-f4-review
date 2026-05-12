/**
 * sync.js - Offline-first localStorage sync via GitHub Gist
 *
 * How it works:
 * - All data lives in localStorage FIRST (instant, always available)
 * - When online, changes sync to a shared GitHub Gist
 * - When offline, app keeps working from localStorage
 * - Pending writes are persisted and flush when connection returns
 *
 * LOCAL-ONLY keys (per device, never synced):
 *   clerk_obs_session, clerk_obs_dark, clerk_obs_prefs, reviewDaySetup
 *
 * Requires gh-config.js loaded BEFORE this script:
 *   window.GH_CONFIG = { gistId: '...', token: '...' }
 */
(function() {
  'use strict';

  // === Skip entirely in file:// mode ===
  if (window.location.protocol === 'file:') return;

  // === GitHub Gist configuration ===
  var cfg = window.GH_CONFIG || {};
  var GIST_ID = cfg.gistId || '';
  var TOKEN = cfg.token || '';
  var GIST_API = 'https://api.github.com/gists/' + GIST_ID;

  // If no config, run in local-only mode (no sync)
  var SYNC_ENABLED = !!(GIST_ID && TOKEN);
  if (!SYNC_ENABLED) {
    console.warn('[Sync] No GitHub config found. Running in local-only mode.');
  }

  // === Local-only keys ===
  var LOCAL_KEYS = {
    clerk_obs_session: true,
    clerk_obs_dark: true,
    clerk_obs_prefs: true,
    reviewDaySetup: true,
    _sync_pending: true,
    _sync_status: true,
    _gh_gist_id: true,
    _gh_token: true
  };

  function isShared(key) {
    if (!key || LOCAL_KEYS[key]) return false;
    if (key.indexOf('clerk_obs_') === 0) return true;
    if (key === 'timeTracker_observations') return true;
    return false;
  }

  // Sanitize localStorage key to valid gist filename
  function keyToFile(key) { return key + '.json'; }
  function fileToKey(filename) {
    return filename.replace(/\.json$/, '');
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
    if (!SYNC_ENABLED) { if (callback) callback(false); return; }
    // Lightweight check - hit GitHub API root
    var x = new XMLHttpRequest();
    x.open('GET', 'https://api.github.com/rate_limit', true);
    x.setRequestHeader('Authorization', 'token ' + TOKEN);
    x.timeout = 5000;
    x.onload = function() { online = (x.status === 200); if (callback) callback(online); };
    x.onerror = function() { online = false; if (callback) callback(false); };
    x.ontimeout = function() { online = false; if (callback) callback(false); };
    x.send();
  }

  // === Persistent write queue ===
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
    if (!SYNC_ENABLED) return;
    var pending = getPendingWrites();
    pending[key] = value; // null means delete
    savePendingWrites(pending);
    scheduleFlush();
  }

  // === Flush pending writes to Gist ===
  var flushTimer = null;
  var FLUSH_DELAY = 500;

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushPending, FLUSH_DELAY);
  }

  function flushPending() {
    flushTimer = null;
    if (!SYNC_ENABLED) return;
    var pending = getPendingWrites();
    var keys = Object.keys(pending);
    if (keys.length === 0) return;

    if (!online) {
      updateStatusUI('offline', keys.length + ' changes queued');
      return;
    }

    updateStatusUI('syncing', 'Syncing ' + keys.length + ' changes...');

    // Build gist PATCH payload
    var files = {};
    keys.forEach(function(key) {
      var val = pending[key];
      if (val === null) {
        // Delete file from gist
        files[keyToFile(key)] = null;
      } else {
        files[keyToFile(key)] = { content: val };
      }
    });

    var x = new XMLHttpRequest();
    x.open('PATCH', GIST_API, true);
    x.setRequestHeader('Authorization', 'token ' + TOKEN);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 15000;
    x.onload = function() {
      if (x.status === 200) {
        var current = getPendingWrites();
        keys.forEach(function(k) {
          if (current[k] === pending[k]) delete current[k];
        });
        savePendingWrites(current);
        updateStatusUI('online', 'Synced');
      } else {
        online = false;
        updateStatusUI('offline', 'Sync failed (HTTP ' + x.status + ') - will retry');
      }
    };
    x.onerror = function() {
      online = false;
      updateStatusUI('offline', keys.length + ' changes queued');
    };
    x.ontimeout = function() {
      online = false;
      updateStatusUI('offline', keys.length + ' changes queued');
    };
    x.send(JSON.stringify({ files: files }));
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
    // Note: gist data remains as backup; next device will pull it
  };

  // === Pull from Gist ===
  function pullFromGist(callback) {
    if (!SYNC_ENABLED || syncInProgress) { if (callback) callback(false); return; }
    syncInProgress = true;

    var x = new XMLHttpRequest();
    x.open('GET', GIST_API, true);
    x.setRequestHeader('Authorization', 'token ' + TOKEN);
    x.timeout = 10000;
    x.onload = function() {
      syncInProgress = false;
      if (x.status === 200) {
        online = true;
        try {
          var gist = JSON.parse(x.responseText);
          var files = gist.files || {};
          var pending = getPendingWrites();

          Object.keys(files).forEach(function(filename) {
            var key = fileToKey(filename);
            if (key === '_init') return; // skip init file
            if (isShared(key) && !pending[key]) {
              var val = files[filename].content;
              var current = _get(key);
              if (current !== val) {
                _set(key, val);
              }
            }
          });
          updateStatusUI('online', 'Synced');
        } catch(e) {
          console.error('[Sync] Parse error:', e);
        }
        if (callback) callback(true);
      } else {
        online = false;
        if (callback) callback(false);
      }
    };
    x.onerror = function() {
      syncInProgress = false;
      online = false;
      updateStatusUI('offline', getPendingCount() > 0 ? getPendingCount() + ' changes queued' : 'Cannot reach GitHub');
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

  // === Initial sync ===
  function initialSync() {
    if (!SYNC_ENABLED) {
      hideOverlay();
      return;
    }

    var x = new XMLHttpRequest();
    x.open('GET', GIST_API, true);
    x.setRequestHeader('Authorization', 'token ' + TOKEN);
    x.timeout = 8000;
    x.onload = function() {
      if (x.status === 200) {
        online = true;
        try {
          var gist = JSON.parse(x.responseText);
          var files = gist.files || {};
          var fileKeys = Object.keys(files).filter(function(f) { return f !== '_init.json'; });
          var pending = getPendingWrites();

          if (fileKeys.length === 0 && getPendingCount() === 0) {
            // Gist empty + no pending = seed gist with local data
            seedGist();
          } else {
            // Pull gist data (skip keys with pending local writes)
            fileKeys.forEach(function(filename) {
              var key = fileToKey(filename);
              if (isShared(key) && !pending[key]) {
                var val = files[filename].content;
                _set(key, val);
              }
            });
          }
        } catch(e) {
          console.error('[Sync] Initial parse error:', e);
        }

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

  function seedGist() {
    var files = {};
    var found = false;
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (isShared(key)) {
        files[keyToFile(key)] = { content: _get(key) };
        found = true;
      }
    }
    if (!found) return;
    try {
      var x = new XMLHttpRequest();
      x.open('PATCH', GIST_API, true);
      x.setRequestHeader('Authorization', 'token ' + TOKEN);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify({ files: files }));
    } catch(e) {}
  }

  // === Background sync loop ===
  var SYNC_INTERVAL = 10000; // 10 seconds (be kind to GitHub API limits)

  function backgroundSync() {
    if (!SYNC_ENABLED) return;
    var pending = getPendingWrites();
    if (Object.keys(pending).length > 0) {
      flushPending();
    }
    pullFromGist();
  }

  // === Reconnection detection ===
  var reconnectTimer = null;
  function startReconnectLoop() {
    if (reconnectTimer || !SYNC_ENABLED) return;
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
          updateStatusUI('syncing', 'Reconnected - syncing...');
          flushPending();
          setTimeout(function() { pullFromGist(); }, 1000);
        }
      });
    }, 5000);
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
      // Stay hidden for normal syncs, only show briefly on reconnect
      bar.style.transform = 'translateY(100%)';
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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    createStatusUI();
    initialSync();
    if (SYNC_ENABLED) {
      setInterval(backgroundSync, SYNC_INTERVAL);
    }
  }

  // Flush on page unload
  window.addEventListener('beforeunload', function() {
    if (!SYNC_ENABLED) return;
    var pending = getPendingWrites();
    if (Object.keys(pending).length > 0) {
      try {
        var x = new XMLHttpRequest();
        x.open('PATCH', GIST_API, false); // synchronous
        x.setRequestHeader('Authorization', 'token ' + TOKEN);
        x.setRequestHeader('Content-Type', 'application/json');
        var files = {};
        Object.keys(pending).forEach(function(key) {
          var val = pending[key];
          files[keyToFile(key)] = val === null ? null : { content: val };
        });
        x.send(JSON.stringify({ files: files }));
        if (x.status === 200) savePendingWrites({});
      } catch(e) {
        // Pending writes stay in localStorage - will sync next time
      }
    }
  });

  // Network status events
  window.addEventListener('online', function() {
    if (!SYNC_ENABLED) return;
    checkConnection(function(isOnline) {
      if (isOnline) {
        updateStatusUI('syncing', 'Reconnected - syncing...');
        flushPending();
        setTimeout(pullFromGist, 500);
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
    forcePull: pullFromGist,
    flushWrites: flushPending
  };
})();
