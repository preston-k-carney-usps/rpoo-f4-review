// workbook-review.js — Post-review workbook upload, preview & review tracker (lead only)
// Uses IndexedDB for file storage (no size limits) + SheetJS for Excel rendering
(function() {
  'use strict';

  var setup = {};
  try { setup = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) {}
  var reviewId = setup.reviewId || '';
  var reviewRole = setup.reviewRole || '';
  if (!reviewId) return;

  var isLead = (reviewRole === 'lead' || reviewRole === 'teamlead');

  var uploadSection = document.getElementById('wbr-upload-section');
  if (!isLead) {
    if (uploadSection) uploadSection.style.display = 'none';
    return;
  }

  // --- localStorage for metadata only (tiny) ---
  var WBR_KEY = 'clerk_obs_wbr_' + reviewId;

  var session = {};
  try { session = JSON.parse(localStorage.getItem('clerk_obs_session')) || {}; } catch(e) {}
  var currentUserName = '';
  if (typeof Auth !== 'undefined' && Auth.getUserById) {
    var u = Auth.getUserById(session.id || '');
    if (u) currentUserName = u.displayName || u.username || '';
  }

  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(WBR_KEY)) || {}; }
    catch(e) { return {}; }
  }
  function saveMeta(data) {
    localStorage.setItem(WBR_KEY, JSON.stringify(data));
  }

  // --- IndexedDB for file blobs ---
  var DB_NAME = 'clerk_obs_workbooks';
  var DB_VERSION = 1;
  var STORE_NAME = 'files';

  function openDB(cb) {
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = function(e) { cb(null, e.target.result); };
    req.onerror = function(e) { cb(e.target.error); };
  }

  function saveFile(key, blob, cb) {
    openDB(function(err, db) {
      if (err) return cb && cb(err);
      var tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, key);
      tx.oncomplete = function() { cb && cb(null); };
      tx.onerror = function(e) { cb && cb(e.target.error); };
    });
  }

  function loadFile(key, cb) {
    openDB(function(err, db) {
      if (err) return cb(err);
      var tx = db.transaction(STORE_NAME, 'readonly');
      var req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = function() { cb(null, req.result || null); };
      req.onerror = function(e) { cb(e.target.error); };
    });
  }

  var fileStoreKey = 'wbr_' + reviewId;

  // --- Format helpers ---
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // --- Elements ---
  var noFile = document.getElementById('wbr-no-file');
  var dropzone = document.getElementById('wbr-dropzone');
  var fileInput = document.getElementById('wbr-file-input');
  var uploadProgress = document.getElementById('wbr-upload-progress');
  var progressBar = document.getElementById('wbr-progress-bar');
  var progressText = document.getElementById('wbr-progress-text');
  var fileInfo = document.getElementById('wbr-file-info');
  var fileName = document.getElementById('wbr-file-name');
  var fileDate = document.getElementById('wbr-file-date');
  var fileSize = document.getElementById('wbr-file-size');
  var downloadBtn = document.getElementById('wbr-download-btn');
  var replaceBtn = document.getElementById('wbr-replace-btn');
  var submitStatus = document.getElementById('wbr-submit-status');
  var stepSubmitted = document.getElementById('wbr-step-submitted');
  var stepReviewed = document.getElementById('wbr-step-reviewed');
  var stepFinal = document.getElementById('wbr-step-final');
  var statusMsg = document.getElementById('wbr-status-msg');
  var returnNote = document.getElementById('wbr-return-note');
  var returnReason = document.getElementById('wbr-return-reason');
  var markReviewedBtn = document.getElementById('wbr-mark-reviewed');
  var approveBtn = document.getElementById('wbr-approve-btn');
  var returnBtn = document.getElementById('wbr-return-btn');
  var leadActions = document.getElementById('wbr-lead-actions');
  var resetBtn = document.getElementById('wbr-reset-btn');

  // --- Render file state ---
  function renderFileState() {
    var meta = loadMeta();
    if (meta.fileName) {
      if (noFile) noFile.style.display = 'none';
      if (fileInfo) fileInfo.style.display = '';
      if (fileName) fileName.textContent = meta.fileName;
      if (fileDate) fileDate.textContent = 'Uploaded ' + new Date(meta.uploadedAt).toLocaleString();
      if (fileSize) fileSize.textContent = meta.fileSize ? formatSize(meta.fileSize) : '';
    } else {
      if (noFile) noFile.style.display = '';
      if (fileInfo) fileInfo.style.display = 'none';
    }
  }

  // --- File upload handler ---
  function handleFile(file) {
    if (!file) return;
    var validExts = ['.xlsx', '.xlsb', '.xls', '.csv'];
    var ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (validExts.indexOf(ext) === -1) {
      alert('Unsupported file type. Please upload .xlsx, .xlsb, .xls, or .csv');
      return;
    }

    // Show progress
    if (uploadProgress) uploadProgress.style.display = '';
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = 'Reading file…';

    // Animate progress while reading
    var pct = 0;
    var interval = setInterval(function() {
      pct = Math.min(pct + Math.random() * 15, 90);
      if (progressBar) progressBar.style.width = pct + '%';
    }, 150);

    // Store blob in IndexedDB
    saveFile(fileStoreKey, file, function(err) {
      clearInterval(interval);
      if (err) {
        alert('Error saving file: ' + err.message);
        if (uploadProgress) uploadProgress.style.display = 'none';
        return;
      }

      if (progressBar) progressBar.style.width = '100%';
      if (progressText) progressText.textContent = 'Saved ✓';

      // Save metadata to localStorage (tiny)
      var meta = loadMeta();
      meta.fileName = file.name;
      meta.fileSize = file.size;
      meta.uploadedAt = new Date().toISOString();
      meta.uploadedBy = currentUserName;
      if (!meta.status || meta.status === 'returned') meta.status = 'uploaded';
      saveMeta(meta);

      setTimeout(function() {
        if (uploadProgress) uploadProgress.style.display = 'none';
        renderFileState();
        renderTracker();
        if (submitStatus) {
          submitStatus.textContent = '✓ File uploaded';
          submitStatus.style.color = 'var(--success)';
          setTimeout(function() { submitStatus.textContent = ''; }, 2500);
        }
      }, 400);
    });
  }

  // --- Drag & drop ---
  if (dropzone) {
    dropzone.addEventListener('click', function() { if (fileInput) fileInput.click(); });
    dropzone.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--primary)';
      dropzone.style.background = 'var(--bg-light)';
    });
    dropzone.addEventListener('dragleave', function(e) {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border)';
      dropzone.style.background = '';
    });
    dropzone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border)';
      dropzone.style.background = '';
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) handleFile(files[0]);
    });
  }
  if (fileInput) {
    fileInput.addEventListener('change', function() {
      if (fileInput.files && fileInput.files.length) handleFile(fileInput.files[0]);
      fileInput.value = '';
    });
  }

  // --- Download ---
  if (downloadBtn) {
    downloadBtn.addEventListener('click', function() {
      var meta = loadMeta();
      loadFile(fileStoreKey, function(err, blob) {
        if (err || !blob) { alert('File not found. It may have been cleared.'); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = meta.fileName || 'workbook.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
      });
    });
  }

  // --- Replace file ---
  if (replaceBtn) {
    replaceBtn.addEventListener('click', function() {
      if (noFile) noFile.style.display = '';
      if (fileInfo) fileInfo.style.display = 'none';
      if (fileInput) fileInput.click();
    });
  }

  // --- Status Tracker ---
  function renderTracker() {
    var meta = loadMeta();
    var status = meta.status || '';

    [stepSubmitted, stepReviewed, stepFinal].forEach(function(s) {
      if (s) s.className = 'wbr-step';
    });
    if (returnNote) returnNote.style.display = 'none';
    if (statusMsg) statusMsg.textContent = '';
    if (markReviewedBtn) markReviewedBtn.style.display = 'none';
    if (approveBtn) approveBtn.style.display = 'none';
    if (returnBtn) returnBtn.style.display = 'none';
    if (resetBtn) resetBtn.style.display = 'none';
    if (leadActions) leadActions.style.display = 'none';

    if (!meta.fileName) {
      if (stepSubmitted) stepSubmitted.classList.add('wbr-step--active');
      if (statusMsg) {
        statusMsg.textContent = 'Upload the workbook file above to begin.';
        statusMsg.style.color = 'var(--text-light)';
      }
      return;
    }

    if (!status || status === 'uploaded') {
      if (stepSubmitted) stepSubmitted.classList.add('wbr-step--done');
      if (stepReviewed) stepReviewed.classList.add('wbr-step--active');
      if (statusMsg) {
        statusMsg.textContent = 'Workbook uploaded — review it above, then mark as reviewed.';
        statusMsg.style.color = 'var(--primary)';
      }
      if (leadActions) leadActions.style.display = 'flex';
      if (markReviewedBtn) markReviewedBtn.style.display = '';
      if (resetBtn) resetBtn.style.display = '';
    } else if (status === 'reviewed') {
      if (stepSubmitted) stepSubmitted.classList.add('wbr-step--done');
      if (stepReviewed) stepReviewed.classList.add('wbr-step--done');
      if (stepFinal) stepFinal.classList.add('wbr-step--active');
      if (statusMsg) {
        statusMsg.textContent = 'Reviewed — approve or send back for revision.';
        statusMsg.style.color = 'var(--primary)';
      }
      if (leadActions) leadActions.style.display = 'flex';
      if (approveBtn) approveBtn.style.display = '';
      if (returnBtn) returnBtn.style.display = '';
      if (resetBtn) resetBtn.style.display = '';
    } else if (status === 'returned') {
      if (stepSubmitted) stepSubmitted.classList.add('wbr-step--done');
      if (stepReviewed) stepReviewed.classList.add('wbr-step--returned');
      if (statusMsg) {
        statusMsg.textContent = 'Returned for revision — upload the corrected workbook.';
        statusMsg.style.color = '#ef4444';
      }
      if (returnNote && meta.returnReason) {
        returnNote.style.display = '';
        if (returnReason) returnReason.textContent = meta.returnReason;
      }
      if (leadActions) leadActions.style.display = 'flex';
      if (markReviewedBtn) markReviewedBtn.style.display = '';
      if (resetBtn) resetBtn.style.display = '';
    } else if (status === 'approved') {
      if (stepSubmitted) stepSubmitted.classList.add('wbr-step--done');
      if (stepReviewed) stepReviewed.classList.add('wbr-step--done');
      if (stepFinal) stepFinal.classList.add('wbr-step--done');
      if (statusMsg) {
        statusMsg.textContent = 'Approved ✓';
        statusMsg.style.color = '#22c55e';
      }
      if (leadActions) leadActions.style.display = 'flex';
      if (resetBtn) resetBtn.style.display = '';
    }
  }

  // --- Lead action buttons ---
  if (markReviewedBtn) {
    markReviewedBtn.addEventListener('click', function() {
      var meta = loadMeta();
      meta.status = 'reviewed';
      meta.reviewedAt = new Date().toISOString();
      meta.reviewedBy = currentUserName;
      delete meta.returnReason;
      saveMeta(meta);
      renderTracker();
    });
  }
  if (approveBtn) {
    approveBtn.addEventListener('click', function() {
      var meta = loadMeta();
      meta.status = 'approved';
      meta.approvedAt = new Date().toISOString();
      meta.approvedBy = currentUserName;
      delete meta.returnReason;
      saveMeta(meta);
      renderTracker();
    });
  }
  if (returnBtn) {
    returnBtn.addEventListener('click', function() {
      var reason = prompt('Reason for sending back (optional):');
      if (reason === null) return;
      var meta = loadMeta();
      meta.status = 'returned';
      meta.returnReason = reason || '';
      meta.returnedAt = new Date().toISOString();
      meta.returnedBy = currentUserName;
      saveMeta(meta);
      renderTracker();
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      var meta = loadMeta();
      var choice = meta.status === 'uploaded'
        ? confirm('Clear the uploaded workbook and reset everything?\n\nThis will delete the file and all review status.')
        : confirm('Reset review status?\n\nChoose OK to reset status back to \"Uploaded\" (keeps the file).\n\nTo also delete the file, cancel and use Replace File.');
      if (!choice) return;

      if (meta.status === 'uploaded' || !meta.fileName) {
        // Full reset — clear file + metadata
        openDB(function(err, db) {
          if (!err) {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(fileStoreKey);
          }
        });
        localStorage.removeItem(WBR_KEY);
        renderFileState();
        renderTracker();
      } else {
        // Status-only reset — keep file, set back to uploaded
        meta.status = 'uploaded';
        delete meta.reviewedAt;
        delete meta.reviewedBy;
        delete meta.approvedAt;
        delete meta.approvedBy;
        delete meta.returnReason;
        delete meta.returnedAt;
        delete meta.returnedBy;
        saveMeta(meta);
        renderTracker();
      }
    });
  }

  // --- Initial render ---
  renderFileState();
  renderTracker();

  // Refresh on panel activation
  var panel = document.getElementById('wb-panel-workbook-review');
  if (panel) {
    new MutationObserver(function() {
      if (panel.classList.contains('wb-sub-panel--active')) {
        renderFileState();
        renderTracker();
      }
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }
})();
