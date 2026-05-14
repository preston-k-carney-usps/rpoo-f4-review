/**
 * sync.js — Stub (offline mode, no sync).
 * Provides the AppSync API so existing code doesn't break.
 */
window.AppSync = {
  isOnline: function() { return false; },
  pendingCount: function() { return 0; },
  forceSync: function() {},
  forcePush: function() {},
  forcePull: function() {},
  flushWrites: function() {},
  setManualMode: function() {},
  isManualMode: function() { return true; },
  onReady: function(cb) { if (cb) cb(); }
};
