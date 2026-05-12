// endofday.js — End of Day review: cross-sheet validation, interactive flag resolution, submit
(function() {
  'use strict';

  var DISMISS_KEY = 'clerk_obs_eod_dismissed';
  var container = document.getElementById('eod-flags-container');
  var emptyEl = document.getElementById('eod-empty');
  var allClearEl = document.getElementById('eod-all-clear');
  var runBtn = document.getElementById('eod-run-check');
  var submitBtn = document.getElementById('eod-submit-btn');
  var statusEl = document.getElementById('eod-status');

  if (!container) return;

  // Scope storage key per review+day+user
  DISMISS_KEY = DISMISS_KEY + (window.appStoragePrefix || '');

  var flags = []; // { id, type, msg, tab, dismissed }
  var dismissed = loadDismissed();

  function loadDismissed() {
    try { return JSON.parse(localStorage.getItem(DISMISS_KEY)) || {}; } catch(e) { return {}; }
  }
  function saveDismissed() {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed));
  }

  // --- Helpers ---
  function getPs3922ObsId() {
    var raw = localStorage.getItem('reviewDaySetup');
    if (raw) {
      try { var s = JSON.parse(raw); return s.reviewId + '_' + (s.dayNumber || '1'); } catch(e) {}
    }
    return 'unsaved';
  }

  // --- Run all validations ---
  function runAllChecks() {
    flags = [];
    var fid = 0;

    // Collect notes rows
    var rows = (typeof window.appCollectRows === 'function') ? window.appCollectRows() : [];
    var isMH = !!window.appIsMH;

    if (isMH) {
      // === Mail Handler Notes Validation ===
      var COMMENT_REQ = { 'NP': true, 'O': true, 'CLK': true };
      // Tasks exempt from work quality requirement (breaks + NP/NW/CLK)
      var MH_QUALITY_EXEMPT = { 'X': true, 'XX': true, 'CB': true, 'NP': true, 'NW': true, 'STBY': true, 'CLK': true };
      rows.forEach(function(r, idx) {
        var rn = idx + 1;
        var entry = 'Entry ' + rn;
        if (!r.beginTime || !r.endTime) push('error', entry + ': Missing start or end time.', 'tab-mh-notes');
        if (!r.task) push('warn', entry + ': No task selected.', 'tab-mh-notes');
        // Comments required for NP, O, CLK
        if (COMMENT_REQ[r.task] && (!r.comments || !r.comments.trim())) {
          push('error', entry + ': Comments required for task "' + r.task + '".', 'tab-mh-notes');
        }
        // Work quality required unless exempt
        if (r.task && !MH_QUALITY_EXEMPT[r.task] && !r.workQuality) {
          push('error', entry + ': Work quality selection required.', 'tab-mh-notes');
        }
        // Work quality validation
        if (r.workQuality && r.workQuality !== 'NO CONCERNS' && !r.timeLost) {
          push('error', entry + ': Time Lost required when quality concern noted.', 'tab-mh-notes');
        }
        if (r.beginTime && r.endTime) {
          var elapsed = Storage.calcElapsed(r.beginTime, r.endTime);
          if (elapsed > 120) push('warn', entry + ': Elapsed time exceeds 2 hours. Please verify.', 'tab-mh-notes');
        }
        // Continuity — gaps are ERRORS, not warnings
        if (idx > 0) {
          var prev = rows[idx - 1];
          if (prev.endTime && r.beginTime && prev.endTime !== r.beginTime) {
            push('error', entry + ': Time gap — begin (' + r.beginTime + ') must match previous end (' + prev.endTime + '). Entries must be continuous.', 'tab-mh-notes');
          }
        }
      });
    } else {
      // === Clerk Notes Validation ===
      // Observed LDCs
      var observedLDCs = {};
      rows.forEach(function(r) { if (r.ldc) observedLDCs[r.ldc] = true; });
      var hasLDC43 = observedLDCs['43L'] || observedLDCs['43F'] || observedLDCs['43A'] || observedLDCs['43P'];
      var hasLDC44 = observedLDCs['44'];
      var hasLDC41 = observedLDCs['41'];

    // === Clerk Notes ===
    var totalClerks = 0;
    rows.forEach(function(r, idx) {
      var rn = idx + 1;
      var entry = 'Entry ' + rn;
      if (!r.beginTime || !r.endTime) push('error', entry + ': Missing start or end time.', 'tab-clerk-notes');
      if (!r.ldc) push('warn', entry + ': No LDC selected.', 'tab-clerk-notes');
      if (!r.opn) push('warn', entry + ': No operation selected.', 'tab-clerk-notes');
      // Work quality required — error, not warn. Exempt: NP, BRK, LUN, CB
      var clerkQualityExempt = { 'NP': true, 'BRK': true, 'LUN': true, 'CB': true };
      if (r.ldc && !clerkQualityExempt[r.ldc] && !r.workQuality) {
        push('error', entry + ': Work quality selection required.', 'tab-clerk-notes');
      }
      if (r.workQuality && r.workQuality !== 'NO CONCERNS' && !r.timeLost && r.ldc !== 'NP')
        push('error', entry + ': Time Lost required when quality concern noted.', 'tab-clerk-notes');
      if (r.workQuality && r.workQuality !== 'NO CONCERNS' && !r.workDescription && r.ldc !== 'NP')
        push('warn', entry + ': Comment recommended for quality concern.', 'tab-clerk-notes');
      var vol = getVolumeFields(r.ldc);
      if (vol.ltrVolInches && !r.ltrVolInches) push('warn', entry + ': Letter volume not entered for LDC ' + r.ldc + '.', 'tab-clerk-notes');
      if (vol.fltVolInches && !r.fltVolInches) push('warn', entry + ': Flat volume not entered for LDC ' + r.ldc + '.', 'tab-clerk-notes');
      if (vol.parcels && !r.parcels) push('warn', entry + ': Parcel count not entered for LDC ' + r.ldc + '.', 'tab-clerk-notes');
      if (r.beginTime && r.endTime) {
        var elapsed = Storage.calcElapsed(r.beginTime, r.endTime);
        var clerks = parseInt(r.totalClerks, 10) || 1;
        totalClerks = Math.max(totalClerks, clerks);
        if (elapsed > 120) push('warn', entry + ': Elapsed time exceeds 2 hours. Please verify.', 'tab-clerk-notes');
      }
    });
    if (totalClerks > 7) push('warn', 'Clerk Notes: Entries with ' + totalClerks + ' clerks — typically 1-7. Please confirm.', 'tab-clerk-notes');

    // === PS 3922 ===
    try {
      var ps3922Raw = localStorage.getItem('clerk_obs_3922');
      if (ps3922Raw) {
        var ps3922All = JSON.parse(ps3922Raw);
        var obsId = getPs3922ObsId();
        var ps = ps3922All[obsId];
        if (ps && ps.zones) {
          // Clean empty zones
          var cleanedZones = [];
          ps.zones.forEach(function(z) {
            var hasData = false;
            (z.rows || []).forEach(function(r) {
              var lr = (r.ltrRecv || []).reduce(function(a, b) { return a + (b || 0); }, 0);
              var fr = (r.fltRecv || []).reduce(function(a, b) { return a + (b || 0); }, 0);
              if (lr || fr || r.ltrMissort || r.fltMissort || r.walledLtrs || r.walledFlts || r.parcels) hasData = true;
            });
            if (hasData || z.dps) cleanedZones.push(z);
          });
          ps.zones = cleanedZones;
          // Clean empty trip rows
          cleanedZones.forEach(function(z) {
            var cleaned = [z.rows[0]];
            for (var ri = 1; ri < z.rows.length; ri++) {
              var r = z.rows[ri];
              var lr = (r.ltrRecv || []).reduce(function(a, b) { return a + (b || 0); }, 0);
              var fr = (r.fltRecv || []).reduce(function(a, b) { return a + (b || 0); }, 0);
              if (lr || fr || r.ltrMissort || r.fltMissort || r.walledLtrs || r.walledFlts || r.parcels) cleaned.push(r);
            }
            z.rows = cleaned;
          });
          ps3922All[obsId] = ps;
          localStorage.setItem('clerk_obs_3922', JSON.stringify(ps3922All));

          cleanedZones.forEach(function(z) {
            z.rows.forEach(function(r, ri) {
              var label = z.zone + ' ' + (ri === 0 ? 'On Hand' : 'Trip ' + ri);
              (r.ltrRecv || []).forEach(function(v, ci) {
                if (v > 150) push('warn', 'PS 3922: ' + label + ' Ltr Recv ' + (ci + 1) + ' is ' + v + '" — please verify.', 'tab-ps3922');
              });
              (r.fltRecv || []).forEach(function(v, ci) {
                if (v > 150) push('warn', 'PS 3922: ' + label + ' Flt Recv ' + (ci + 1) + ' is ' + v + '" — please verify.', 'tab-ps3922');
              });
            });
            if (!z.dps) push('warn', 'PS 3922: Zone "' + z.zone + '" has no PO Box DPS entered.', 'tab-ps3922');
          });
          if ((hasLDC43 || hasLDC44) && cleanedZones.length === 0)
            push('warn', 'PS 3922: LDC 43/44 time observed but no volume recorded. Confirm if another reviewer recorded it.', 'tab-ps3922');
        } else if (hasLDC43 || hasLDC44) {
          push('warn', 'PS 3922: LDC 43/44 time observed but no PS 3922 data exists. Confirm if another reviewer recorded it.', 'tab-ps3922');
        }
      } else if (hasLDC43 || hasLDC44) {
        push('warn', 'PS 3922: LDC 43/44 time observed but no PS 3922 data. Confirm if another reviewer recorded it.', 'tab-ps3922');
      }
    } catch(e) {}

    // === Record Trips ===
    try {
      var tripsRaw = localStorage.getItem('clerk_obs_trips');
      if (tripsRaw) {
        var tripsData = JSON.parse(tripsRaw);
        var cleanedTrips = [];
        tripsData.forEach(function(t) {
          if (t.isOnHand) { cleanedTrips.push(t); return; }
          var hasData = (t.containers && t.containers.length > 0) || t.arrival || t.depart || t.unloadMin || t.source;
          if (hasData) cleanedTrips.push(t);
        });
        localStorage.setItem('clerk_obs_trips', JSON.stringify(cleanedTrips));
        cleanedTrips.forEach(function(t, ti) {
          if (t.isOnHand) return;
          var label = t.source ? t.source + ' Trip' : 'Trip ' + ti;
          if (t.arrival && !t.depart) push('warn', 'Trips: ' + label + ' — arrival recorded but no departure time.', 'tab-trips');
          if (t.depart && !t.arrival) push('warn', 'Trips: ' + label + ' — departure recorded but no arrival time.', 'tab-trips');
          if (!t.unloadMin) push('warn', 'Trips: ' + label + ' — no unload minutes recorded.', 'tab-trips');
        });
      }
    } catch(e) {}

    // === SCF Hub ===
    try {
      var scfRaw = localStorage.getItem('clerk_obs_scf');
      if (scfRaw) {
        var scfData = JSON.parse(scfRaw);
        Object.keys(scfData).forEach(function(k) {
          if (k === 'notes') return;
          var row = scfData[k];
          if (row && row.qty > 0) push('warn', 'SCF Hub: "' + k.replace(/_/g, ' ') + '" has QTY ' + row.qty + ' — please review.', 'tab-scf');
        });
      }
    } catch(e) {}

    // === ADUS/SDUS ===
    try {
      var adusRaw = localStorage.getItem('clerk_obs_adus');
      if (adusRaw) {
        var adusData = JSON.parse(adusRaw);
        if (Array.isArray(adusData)) {
          var cleanedMachines = adusData.filter(function(m) { return m.runs && m.runs.length > 0; });
          if (cleanedMachines.length !== adusData.length)
            localStorage.setItem('clerk_obs_adus', JSON.stringify(cleanedMachines));
        }
      }
      if (hasLDC41) {
        var adusParsed = adusRaw ? JSON.parse(adusRaw) : [];
        var hasRuns = Array.isArray(adusParsed) && adusParsed.some(function(m) { return m.runs && m.runs.length > 0; });
        if (!hasRuns) push('warn', 'ADUS/SDUS: LDC 41 time observed but no machine runs recorded.', 'tab-adus');
      }
    } catch(e) {}

    // === Questionnaire ===
    try {
      var questData = JSON.parse(localStorage.getItem('clerk_obs_questionnaire') || '{}');
      var LDC_Q_MAP = { '41': '41', '42': '42', '43A': '43', '43L': '43', '43F': '43', '43P': '43', '44': '44', '45': '45', '48': '48' };
      var QUEST_COUNTS = { '41': 2, '42': 2, '43': 13, '44': 6, '45': 15, '48': 4 };
      var QUEST_TITLES = { '41': 'LDC 41', '42': 'LDC 42', '43': 'LDC 43', '44': 'LDC 44', '45': 'LDC 45', '48': 'LDC 48' };
      var qGroups = {};
      rows.forEach(function(r) { if (r.ldc && LDC_Q_MAP[r.ldc]) qGroups[LDC_Q_MAP[r.ldc]] = true; });
      Object.keys(qGroups).forEach(function(grp) {
        var count = QUEST_COUNTS[grp] || 0;
        var unanswered = 0;
        for (var qi = 0; qi < count; qi++) {
          var ans = questData[grp + '_' + qi];
          if (!ans || !ans.yn) unanswered++;
        }
        if (unanswered > 0)
          push('warn', 'Questionnaire: ' + unanswered + ' unanswered question(s) for ' + (QUEST_TITLES[grp] || grp) + '.', 'tab-questionnaire');
      });
    } catch(e) {}
    } // end clerk-only checks

    // === Summarization ===
    try {
      var summRaw = localStorage.getItem('clerk_obs_summarization');
      if (summRaw) {
        var summData = JSON.parse(summRaw);
        var cleanedSumm = summData.filter(function(c) { return c.text && c.text.trim(); });
        var emptySumm = summData.length - cleanedSumm.length;
        if (emptySumm > 0) {
          localStorage.setItem('clerk_obs_summarization', JSON.stringify(cleanedSumm));
          push('warn', 'Summarization: Removed ' + emptySumm + ' empty comment(s).', 'tab-summary-comments');
        }
      }
    } catch(e) {}

    render();
  }

  function push(type, msg, tab) {
    var id = type + '_' + flags.length;
    flags.push({ id: id, type: type, msg: msg, tab: tab || '', dismissed: !!dismissed[id] });
  }

  // --- Tab labels for display ---
  var TAB_LABELS = {
    'tab-clerk-notes': 'Clerk Notes',
    'tab-mh-notes': 'Mail Handler Notes',
    'tab-ps3922': 'PS 3922',
    'tab-trips': 'Record Trips',
    'tab-scf': 'SCF Hub',
    'tab-adus': 'ADUS/SDUS',
    'tab-questionnaire': 'Questionnaire',
    'tab-summary-comments': 'Summarization'
  };

  // --- Render flags ---
  function render() {
    container.innerHTML = '';
    emptyEl.hidden = flags.length > 0;
    allClearEl.hidden = true;

    if (flags.length === 0) {
      emptyEl.hidden = false;
      return;
    }

    // Group by tab
    var groups = {};
    var groupOrder = [];
    flags.forEach(function(f) {
      var key = f.tab || 'general';
      if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
      groups[key].push(f);
    });

    var errors = flags.filter(function(f) { return f.type === 'error' && !f.dismissed; });
    var unresolvedWarns = flags.filter(function(f) { return f.type === 'warn' && !f.dismissed; });

    // Summary bar
    var summaryDiv = document.createElement('div');
    summaryDiv.className = 'eod-summary-bar';
    summaryDiv.innerHTML =
      '<span class="eod-count eod-count-error">' + errors.length + ' Error(s)</span>' +
      '<span class="eod-count eod-count-warn">' + unresolvedWarns.length + ' Warning(s)</span>' +
      '<span class="eod-count eod-count-ok">' + flags.filter(function(f) { return f.dismissed; }).length + ' Reviewed</span>';
    container.appendChild(summaryDiv);

    groupOrder.forEach(function(key) {
      var grpFlags = groups[key];
      var section = document.createElement('div');
      section.className = 'eod-group';

      var title = document.createElement('h3');
      title.className = 'eod-group-title';
      title.textContent = TAB_LABELS[key] || 'General';
      section.appendChild(title);

      grpFlags.forEach(function(f) {
        var row = document.createElement('div');
        row.className = 'eod-flag' + (f.dismissed ? ' eod-flag-dismissed' : '') + (f.type === 'error' ? ' eod-flag-error' : ' eod-flag-warn');
        row.innerHTML =
          '<div class="eod-flag-icon">' + (f.type === 'error' ? '&#9888;' : '&#9888;') + '</div>' +
          '<div class="eod-flag-msg">' + f.msg + '</div>' +
          '<div class="eod-flag-actions">' +
            (f.tab ? '<button class="btn btn-outline btn-sm eod-goto" data-fid="' + f.id + '" data-tab="' + f.tab + '" title="Go to issue">&#x2197;</button>' : '') +
            (f.type === 'warn' ? '<button class="btn btn-sm eod-ack ' + (f.dismissed ? 'btn-secondary' : 'btn-primary') + '" data-fid="' + f.id + '">' + (f.dismissed ? 'Undo' : '&#10003; OK') + '</button>' : '') +
          '</div>';
        section.appendChild(row);
      });
      container.appendChild(section);
    });

    // Check if all resolved
    if (errors.length === 0 && unresolvedWarns.length === 0) {
      allClearEl.hidden = false;
      var day = '1';
      try { var s = JSON.parse(localStorage.getItem('reviewDaySetup') || '{}'); day = s.dayNumber || '1'; } catch(e) {}
      submitBtn.textContent = 'Submit Day ' + day;
    }

    bindEvents();
  }

  function bindEvents() {
    // Go-to buttons
    container.querySelectorAll('.eod-goto').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tab = btn.dataset.tab;
        if (!tab) return;
        var tabBtn = document.querySelector('.review-tab[data-tab="' + tab + '"]');
        if (tabBtn) tabBtn.click();
        // Scroll to top of tab content
        setTimeout(function() {
          var panel = document.getElementById(tab);
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      });
    });

    // Acknowledge/undo buttons
    container.querySelectorAll('.eod-ack').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var fid = btn.dataset.fid;
        for (var i = 0; i < flags.length; i++) {
          if (flags[i].id === fid) {
            flags[i].dismissed = !flags[i].dismissed;
            if (flags[i].dismissed) {
              dismissed[fid] = true;
            } else {
              delete dismissed[fid];
            }
            saveDismissed();
            break;
          }
        }
        render();
      });
    });
  }

  // --- Submit ---
  submitBtn.addEventListener('click', function() {
    var errors = flags.filter(function(f) { return f.type === 'error'; });
    if (errors.length > 0) {
      showEodStatus('Fix all errors before submitting.', 'error');
      return;
    }
    var unresolved = flags.filter(function(f) { return !f.dismissed && f.type === 'warn'; });
    if (unresolved.length > 0) {
      showEodStatus('Review all warnings before submitting.', 'error');
      return;
    }

    var setup = (typeof window.appGetSetup === 'function') ? window.appGetSetup() : {};
    var day = setup.dayNumber || '1';

    if (!confirm('You are about to submit Day ' + day + '. This action marks your observation as complete.\n\nAre you sure you want to submit?')) return;

    if (!setup.date) { showEodStatus('No observation date set.', 'error'); return; }

    var rows = (typeof window.appCollectRows === 'function') ? window.appCollectRows() : [];
    var existingObs = (typeof window.appExistingObs === 'function') ? window.appExistingObs() : null;

    if (existingObs) Storage.delete(existingObs.id);

    var entry = Storage.add({
      office: setup.office,
      financeNum: setup.financeNum,
      reviewId: setup.reviewId,
      date: setup.date,
      dayNumber: setup.dayNumber,
      observerName: setup.observerName,
      userId: setup.userId,
      reviewRole: setup.reviewRole,
      status: 'submitted',
      rows: rows,
    });

    if (typeof window.appSetExistingObs === 'function') window.appSetExistingObs(entry);

    // Clear dismissed flags
    dismissed = {};
    saveDismissed();

    showEodStatus('Day ' + (setup.dayNumber || '1') + ' submitted successfully!', 'success');
    container.innerHTML = '';
    emptyEl.hidden = true;
    allClearEl.hidden = true;
  });

  function showEodStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status-msg ' + type;
    statusEl.hidden = false;
    if (type !== 'error') {
      setTimeout(function() { statusEl.hidden = true; }, 5000);
    }
  }

  // --- Run check button ---
  runBtn.addEventListener('click', function() {
    dismissed = {};
    saveDismissed();
    runAllChecks();
  });

  // Auto-run check when switching to the tab
  document.querySelectorAll('.review-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      if (tab.dataset.tab === 'tab-endofday') {
        runAllChecks();
      }
    });
  });
})();
