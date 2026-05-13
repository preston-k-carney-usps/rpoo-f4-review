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
  var _syncReady = false;
  var _readyCbs = [];

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
  var _singleKeyMode = false; // after 422, send one key at a time

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
      // Try to come online before giving up
      checkConnection(function(isOnline) {
        if (isOnline) {
          flushPending(); // retry now that we're online
        } else {
          updateStatusUI('offline', keys.length + ' changes queued');
        }
      });
      return;
    }

    updateStatusUI('syncing', 'Syncing ' + keys.length + ' changes...');

    // Build gist PATCH payload
    var files = {};
    var hasContent = false;
    keys.forEach(function(key) {
      var val = pending[key];
      if (val === null || val === '' || val === undefined) {
        // Deletes/empty values — don't send to gist (causes 422 if file doesn't exist)
        // Just remove from pending queue silently
      } else {
        // Safety: don't push users if array is suspiciously small (prevents overwrite)
        if (key === 'clerk_obs_users') {
          try {
            var arr = JSON.parse(val);
            if (Array.isArray(arr) && arr.length < 10) {
              console.warn('[Sync] Refusing to push clerk_obs_users with only ' + arr.length + ' users (possible data loss)');
              return;
            }
          } catch(e) {}
        }
        // Cap file size at 500KB to prevent Gist truncation issues
        var valStr = String(val);
        if (valStr.length > 500000) {
          console.warn('[Sync] Skipping oversized file (' + (valStr.length / 1024).toFixed(0) + 'KB): ' + key);
          // Remove from pending so it doesn't keep retrying
          var cp = getPendingWrites(); delete cp[key]; savePendingWrites(cp);
          return;
        }
        files[keyToFile(key)] = { content: valStr };
        hasContent = true;
      }
    });

    // Remove null/empty keys from pending immediately
    var cleanPending = getPendingWrites();
    keys.forEach(function(k) {
      var v = cleanPending[k];
      if (v === null || v === '' || v === undefined) {
        delete cleanPending[k];
      }
    });
    savePendingWrites(cleanPending);

    // If only deletes, nothing to send
    if (!hasContent) {
      updateStatusUI('online', 'Synced');
      return;
    }

    // Rebuild keys to only include content keys
    keys = Object.keys(files).map(function(f) { return fileToKey(f); });

    // In single-key mode (after a 422), send only the first key
    if (_singleKeyMode && keys.length > 1) {
      var oneKey = keys[0];
      var oneFiles = {};
      oneFiles[keyToFile(oneKey)] = files[keyToFile(oneKey)];
      files = oneFiles;
      keys = [oneKey];
    }

    var payload = JSON.stringify({ files: files });

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
        if (_singleKeyMode && getPendingCount() > 0) {
          // More keys to flush in single-key mode
          setTimeout(flushPending, 300);
        } else {
          _singleKeyMode = false;
        }
        updateStatusUI('online', 'Synced');
      } else if (x.status === 422 && keys.length > 1) {
        // 422 with multiple keys — switch to single-key mode and retry
        console.warn('[Sync] 422 with batch of ' + keys.length + ' — switching to single-key mode');
        _singleKeyMode = true;
        setTimeout(flushPending, 1000);
      } else if (x.status === 422 && keys.length === 1) {
        // Single key still fails — this specific key is the problem, skip it
        console.warn('[Sync] 422 for key "' + keys[0] + '" — skipping. Response:', x.responseText);
        var current = getPendingWrites();
        delete current[keys[0]];
        savePendingWrites(current);
        _singleKeyMode = true; // continue single-key for remaining
        updateStatusUI('online', 'Synced (1 skipped)');
        if (getPendingCount() > 0) setTimeout(flushPending, 500);
        else _singleKeyMode = false;
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
    x.send(payload);
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
              var fileObj = files[filename];
              // Skip truncated files — GitHub returns empty content for large Gists
              if (fileObj.truncated) {
                console.warn('[Sync] Skipping truncated file:', filename);
                return;
              }
              var gistVal = fileObj.content;
              var localVal = _get(key);
              if (localVal === gistVal) return; // no change

              // Merge arrays by id to prevent data loss
              if (localVal && gistVal) {
                try {
                  var localArr = JSON.parse(localVal);
                  var gistArr = JSON.parse(gistVal);
                  if (Array.isArray(localArr) && Array.isArray(gistArr)) {
                    var gistIds = {};
                    gistArr.forEach(function(item) { if (item && item.id) gistIds[item.id] = true; });
                    var merged = gistArr.slice();
                    localArr.forEach(function(item) {
                      if (item && item.id && !gistIds[item.id]) merged.push(item);
                    });
                    if (merged.length > gistArr.length) {
                      var mergedStr = JSON.stringify(merged);
                      _set(key, mergedStr);
                      queueWrite(key, mergedStr);
                      return;
                    }
                  }
                } catch(e) {}
              }
              _set(key, gistVal);
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
            // Pull gist data — merge arrays, overwrite scalars
            fileKeys.forEach(function(filename) {
              var key = fileToKey(filename);
              if (isShared(key) && !pending[key]) {
                var gistVal = files[filename].content;
                var localVal = _get(key);

                // For array-based keys, merge by id to prevent data loss
                if (localVal && gistVal) {
                  try {
                    var localArr = JSON.parse(localVal);
                    var gistArr = JSON.parse(gistVal);
                    if (Array.isArray(localArr) && Array.isArray(gistArr)) {
                      // Merge: gist items + local items not in gist (by id)
                      var gistIds = {};
                      gistArr.forEach(function(item) { if (item && item.id) gistIds[item.id] = true; });
                      var merged = gistArr.slice();
                      localArr.forEach(function(item) {
                        if (item && item.id && !gistIds[item.id]) {
                          merged.push(item);
                        }
                      });
                      if (merged.length > gistArr.length) {
                        // Local had items gist didn't — save merged and queue sync
                        var mergedStr = JSON.stringify(merged);
                        _set(key, mergedStr);
                        queueWrite(key, mergedStr);
                        return; // skip the normal set
                      }
                    }
                  } catch(e) { /* not JSON arrays — fall through to normal overwrite */ }
                }
                _set(key, gistVal);
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
    _syncReady = true;
    _readyCbs.forEach(function(cb) { try { cb(); } catch(e) { console.error(e); } });
    _readyCbs = [];
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
    var keys = Object.keys(pending);
    if (keys.length === 0) return;
    try {
      var files = {};
      var hasContent = false;
      keys.forEach(function(key) {
        var val = pending[key];
        if (val !== null && val !== '' && val !== undefined) {
          files[keyToFile(key)] = { content: String(val) };
          hasContent = true;
        }
      });
      if (!hasContent) { savePendingWrites({}); return; }
      var x = new XMLHttpRequest();
      x.open('PATCH', GIST_API, false); // synchronous
      x.setRequestHeader('Authorization', 'token ' + TOKEN);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify({ files: files }));
      if (x.status === 200) savePendingWrites({});
    } catch(e) {
      // Pending writes stay in localStorage - will sync next time
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

  // === Force push: bypass online check, always attempt ===
  function forcePushNow() {
    if (!SYNC_ENABLED) return;
    var pending = getPendingWrites();
    var keys = Object.keys(pending);
    if (keys.length === 0) return;

    var files = {};
    var hasContent = false;
    keys.forEach(function(key) {
      var val = pending[key];
      if (val !== null && val !== '' && val !== undefined) {
        files[keyToFile(key)] = { content: String(val) };
        hasContent = true;
      }
    });
    if (!hasContent) return;

    var x = new XMLHttpRequest();
    x.open('PATCH', GIST_API, true);
    x.setRequestHeader('Authorization', 'token ' + TOKEN);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 15000;
    x.onload = function() {
      if (x.status === 200) {
        online = true;
        var current = getPendingWrites();
        keys.forEach(function(k) { if (current[k] === pending[k]) delete current[k]; });
        savePendingWrites(current);
      }
    };
    x.send(JSON.stringify({ files: files }));
  }

  // === Public API ===
  window.AppSync = {
    isOnline: function() { return online; },
    pendingCount: getPendingCount,
    forceSync: backgroundSync,
    forcePush: forcePushNow,
    forcePull: pullFromGist,
    flushWrites: flushPending,
    onReady: function(cb) {
      if (_syncReady) cb();
      else _readyCbs.push(cb);
    }
  };
})();
