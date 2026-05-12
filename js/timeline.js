// timeline.js — End of Day timeline for PODs + Lead rollup timelines
(function() {
  'use strict';

  // --- Shared helpers ---
  function escHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function timeToMin(t) {
    if (!t) return 0;
    var p = t.split(':').map(Number);
    return p[0] * 60 + (p[1] || 0);
  }

  function fmtTime(mins) {
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // --- Build a single timeline track into a container element ---
  // Returns { html, usedLdcs } or null if no data
  function buildTrackHtml(obs, isMH) {
    if (!obs || !obs.rows || obs.rows.length === 0) return null;

    var rows = obs.rows.filter(function(r) { return r.beginTime && r.endTime; });
    if (rows.length === 0) return null;

    var mins = rows.map(function(r) { return [timeToMin(r.beginTime), timeToMin(r.endTime)]; });
    var dayStart = Math.min.apply(null, mins.map(function(m) { return m[0]; }));
    var dayEnd   = Math.max.apply(null, mins.map(function(m) { return m[1]; }));
    var daySpan  = dayEnd - dayStart;
    if (daySpan <= 0) return null;

    // Time axis
    var firstHour = Math.floor(dayStart / 60);
    var lastHour  = Math.ceil(dayEnd / 60);
    var axisHtml = '<div class="timeline-axis">';
    var gridHtml = '';
    for (var h = firstHour; h <= lastHour; h++) {
      var pos = ((h * 60 - dayStart) / daySpan * 100).toFixed(2);
      axisHtml += '<span class="timeline-axis-label" style="left:' + pos + '%">' + fmtTime(h * 60) + '</span>';
      gridHtml += '<div class="timeline-gridline" style="left:' + pos + '%"></div>';
    }
    axisHtml += '</div>';

    var usedLdcs = {};
    var blocksHtml = '<div class="timeline-blocks">' + gridHtml;

    rows.forEach(function(r) {
      var start = timeToMin(r.beginTime);
      var end   = timeToMin(r.endTime);
      var left  = ((start - dayStart) / daySpan * 100).toFixed(2);
      var width = ((end - start) / daySpan * 100).toFixed(2);
      if (parseFloat(width) < 0.5) width = '0.5';

      if (isMH) {
        var tc = MH_TASK_CAT[r.task];
        var cat = tc ? tc.cat : 'work';
        var color = MH_CAT_COLORS[cat];
        var taskLabel = r.task || '?';
        var tooltip = taskLabel + (tc ? ' \u2014 ' + tc.desc : '') + ' (' + (r.beginTime || '') + ' - ' + (r.endTime || '') + ')';
        blocksHtml += '<div class="timeline-block" ' +
          'style="left:' + left + '%;width:' + width + '%;background:' + color + ';" ' +
          'title="' + escHtml(tooltip) + '">' +
          (parseFloat(width) > 4 ? '<span class="timeline-block-label" style="color:#fff;">' + escHtml(taskLabel) + '</span>' : '') +
        '</div>';
      } else {
        var ldcOpt = LDC_OPTIONS.find(function(o) { return o.value === r.ldc; });
        var colorClass = ldcOpt ? ldcOpt.color : '';
        var clerkLabel = ldcOpt ? ldcOpt.short : (r.ldc || '?');
        if (r.ldc) usedLdcs[r.ldc] = { colorClass: colorClass, label: clerkLabel };
        var clerkTooltip = clerkLabel + ' (' + (r.beginTime || '') + ' - ' + (r.endTime || '') + ')';
        if (r.opn) clerkTooltip += '\n' + r.opn;
        blocksHtml += '<div class="timeline-block ' + colorClass + '" ' +
          'style="left:' + left + '%;width:' + width + '%;" ' +
          'title="' + escHtml(clerkTooltip) + '">' +
          (parseFloat(width) > 4 ? '<span class="timeline-block-label">' + escHtml(clerkLabel) + '</span>' : '') +
        '</div>';
      }
    });
    blocksHtml += '</div>';

    return { html: axisHtml + blocksHtml, usedLdcs: usedLdcs };
  }

  // --- Build legend HTML ---
  function buildLegendHtml(isMH, usedLdcs) {
    if (isMH) {
      return '<div class="timeline-legend-items">' +
        Object.keys(MH_CAT_LABELS).map(function(k) {
          return '<span class="timeline-legend-item"><span class="timeline-legend-swatch" style="background:' + MH_CAT_COLORS[k] + '"></span>' + MH_CAT_LABELS[k] + '</span>';
        }).join('') +
      '</div>';
    }
    var ldcKeys = Object.keys(usedLdcs || {});
    if (ldcKeys.length === 0) return '';
    return '<div class="timeline-legend-items">' +
      ldcKeys.map(function(key) {
        var info = usedLdcs[key];
        return '<span class="timeline-legend-item"><span class="timeline-legend-swatch ' + info.colorClass + '"></span>' + escHtml(info.label) + '</span>';
      }).join('') +
    '</div>';
  }

  // =========================================================================
  // 1. END OF DAY — Individual POD timeline
  // =========================================================================
  function renderEodTimeline() {
    var trackEl  = document.getElementById('eod-timeline-track');
    var legendEl = document.getElementById('eod-timeline-legend');
    var section  = document.getElementById('eod-timeline-section');
    if (!trackEl || !legendEl || !section) return;

    // Get current context
    var isMH  = !!window.appIsMH;
    var rows  = (typeof window.appCollectRows === 'function') ? window.appCollectRows() : [];

    if (!rows || rows.length === 0) {
      section.hidden = true;
      return;
    }

    // Build a fake obs object matching what buildTrackHtml expects
    var obs = { rows: rows };
    var result = buildTrackHtml(obs, isMH);

    if (!result) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    trackEl.innerHTML = result.html;
    legendEl.innerHTML = buildLegendHtml(isMH, result.usedLdcs);
  }

  // Hook into EOD tab activation — render timeline when End of Day tab is shown
  document.addEventListener('click', function(e) {
    var tab = e.target.closest('.review-tab');
    if (tab && tab.dataset.tab === 'tab-endofday') {
      setTimeout(renderEodTimeline, 50);
    }
  });

  // Also render when Run Review Check is clicked
  var eodRunBtn = document.getElementById('eod-run-check');
  if (eodRunBtn) {
    eodRunBtn.addEventListener('click', function() {
      setTimeout(renderEodTimeline, 100);
    });
  }

  // =========================================================================
  // 2. LEAD ROLLUP — Overlapping multi-reviewer timelines
  // =========================================================================
  var rollupContainer = document.getElementById('rollup-timeline-container');
  var rollupLegend    = document.getElementById('rollup-timeline-legend');
  var rollupEmpty     = document.getElementById('rollup-empty');
  var rollupCraft     = document.getElementById('rollup-craft-filter');
  var rollupDay       = document.getElementById('rollup-day-filter');
  var rollupReviewer  = document.getElementById('rollup-reviewer-filter');
  var rollupRefresh   = document.getElementById('rollup-refresh-btn');

  if (rollupRefresh) {
    rollupRefresh.addEventListener('click', renderRollup);
  }

  // Populate reviewer dropdown when craft changes
  if (rollupCraft) {
    rollupCraft.addEventListener('change', populateReviewerDropdown);
  }

  function getSetup() {
    try { return JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) { return {}; }
  }

  function populateReviewerDropdown() {
    if (!rollupReviewer) return;
    var setup = getSetup();
    var reviewId = setup.reviewId;
    if (!reviewId) return;

    var craft = rollupCraft ? rollupCraft.value : 'clerk';
    var targetRole = (craft === 'mh') ? 'mailhandler' : 'clerk';

    // Get all observations for this review
    var allObs = Storage.getAll().filter(function(o) {
      return o.reviewId === reviewId && o.reviewRole === targetRole;
    });

    // Unique reviewers
    var seen = {};
    var reviewers = [];
    allObs.forEach(function(o) {
      var uid = o.userId || 'unknown';
      if (!seen[uid]) {
        seen[uid] = true;
        var user = Auth.getUserById(uid);
        reviewers.push({
          id: uid,
          name: user ? user.name : (o.observerName || uid)
        });
      }
    });

    rollupReviewer.innerHTML = '<option value="all">All</option>';
    reviewers.sort(function(a, b) { return a.name.localeCompare(b.name); });
    reviewers.forEach(function(r) {
      var opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      rollupReviewer.appendChild(opt);
    });
  }

  function renderRollup() {
    if (!rollupContainer || !rollupLegend) return;

    var setup    = getSetup();
    var reviewId = setup.reviewId;
    if (!reviewId) {
      rollupContainer.innerHTML = '<p class="empty-state">No active review.</p>';
      if (rollupEmpty) rollupEmpty.hidden = true;
      return;
    }

    var craft      = rollupCraft ? rollupCraft.value : 'clerk';
    var dayNum     = rollupDay ? rollupDay.value : '1';
    var reviewerFilter = rollupReviewer ? rollupReviewer.value : 'all';
    var isMH       = (craft === 'mh');
    var targetRole = isMH ? 'mailhandler' : 'clerk';

    // Get matching observations
    var allObs = Storage.getAll().filter(function(o) {
      return o.reviewId === reviewId &&
             o.reviewRole === targetRole &&
             String(o.dayNumber) === dayNum;
    });

    // Filter by reviewer if specified
    if (reviewerFilter !== 'all') {
      allObs = allObs.filter(function(o) { return o.userId === reviewerFilter; });
    }

    if (allObs.length === 0) {
      rollupContainer.innerHTML = '';
      rollupLegend.innerHTML = '';
      if (rollupEmpty) {
        rollupEmpty.hidden = false;
        rollupEmpty.textContent = 'No observations found for ' + (isMH ? 'Mail Handler' : 'Clerk') + ' Day ' + dayNum + '.';
      }
      return;
    }

    if (rollupEmpty) rollupEmpty.hidden = true;

    // Compute global time range across ALL observations for consistent axis
    var globalStart = Infinity, globalEnd = -Infinity;
    allObs.forEach(function(obs) {
      (obs.rows || []).forEach(function(r) {
        if (r.beginTime && r.endTime) {
          var s = timeToMin(r.beginTime);
          var e = timeToMin(r.endTime);
          if (s < globalStart) globalStart = s;
          if (e > globalEnd) globalEnd = e;
        }
      });
    });

    if (globalStart >= globalEnd) {
      rollupContainer.innerHTML = '<p class="empty-state">No valid time entries.</p>';
      rollupLegend.innerHTML = '';
      return;
    }

    var daySpan = globalEnd - globalStart;

    // Build shared axis
    var firstHour = Math.floor(globalStart / 60);
    var lastHour  = Math.ceil(globalEnd / 60);
    var axisHtml = '<div class="timeline-axis">';
    var gridHtml = '';
    for (var h = firstHour; h <= lastHour; h++) {
      var pos = ((h * 60 - globalStart) / daySpan * 100).toFixed(2);
      axisHtml += '<span class="timeline-axis-label" style="left:' + pos + '%">' + fmtTime(h * 60) + '</span>';
      gridHtml += '<div class="timeline-gridline" style="left:' + pos + '%"></div>';
    }
    axisHtml += '</div>';

    var allUsedLdcs = {};
    var html = '<div class="rollup-timeline-wrap">' + axisHtml;

    // Sort observations by reviewer name
    allObs.sort(function(a, b) {
      var aName = a.observerName || a.userId || '';
      var bName = b.observerName || b.userId || '';
      return aName.localeCompare(bName);
    });

    // One row per observation (reviewer)
    allObs.forEach(function(obs) {
      var user = Auth.getUserById(obs.userId);
      var name = user ? user.name : (obs.observerName || obs.userId || '?');
      var rows = (obs.rows || []).filter(function(r) { return r.beginTime && r.endTime; });
      if (rows.length === 0) return;

      html += '<div class="rollup-row">';
      html += '<div class="rollup-row-label" title="' + escHtml(name) + '">' + escHtml(name) + '</div>';
      html += '<div class="rollup-row-track"><div class="timeline-blocks">' + gridHtml;

      rows.forEach(function(r) {
        var start = timeToMin(r.beginTime);
        var end   = timeToMin(r.endTime);
        var left  = ((start - globalStart) / daySpan * 100).toFixed(2);
        var width = ((end - start) / daySpan * 100).toFixed(2);
        if (parseFloat(width) < 0.5) width = '0.5';

        if (isMH) {
          var tc = MH_TASK_CAT[r.task];
          var cat = tc ? tc.cat : 'work';
          var color = MH_CAT_COLORS[cat];
          var taskLabel = r.task || '?';
          var tooltip = name + ': ' + taskLabel + (tc ? ' \u2014 ' + tc.desc : '') + ' (' + (r.beginTime || '') + ' - ' + (r.endTime || '') + ')';
          html += '<div class="timeline-block" ' +
            'style="left:' + left + '%;width:' + width + '%;background:' + color + ';" ' +
            'title="' + escHtml(tooltip) + '">' +
            (parseFloat(width) > 6 ? '<span class="timeline-block-label" style="color:#fff;">' + escHtml(taskLabel) + '</span>' : '') +
          '</div>';
        } else {
          var ldcOpt = LDC_OPTIONS.find(function(o) { return o.value === r.ldc; });
          var colorClass = ldcOpt ? ldcOpt.color : '';
          var clerkLabel = ldcOpt ? ldcOpt.short : (r.ldc || '?');
          if (r.ldc) allUsedLdcs[r.ldc] = { colorClass: colorClass, label: clerkLabel };
          var clerkTooltip = name + ': ' + clerkLabel + ' (' + (r.beginTime || '') + ' - ' + (r.endTime || '') + ')';
          if (r.opn) clerkTooltip += '\n' + r.opn;
          html += '<div class="timeline-block ' + colorClass + '" ' +
            'style="left:' + left + '%;width:' + width + '%;" ' +
            'title="' + escHtml(clerkTooltip) + '">' +
            (parseFloat(width) > 6 ? '<span class="timeline-block-label">' + escHtml(clerkLabel) + '</span>' : '') +
          '</div>';
        }
      });

      html += '</div></div></div>';
    });

    html += '</div>';
    rollupContainer.innerHTML = html;
    rollupLegend.innerHTML = buildLegendHtml(isMH, allUsedLdcs);
  }

  // Initial populate of reviewer dropdown when panel loads
  if (rollupCraft) {
    // Wait a tick for Storage to be ready
    setTimeout(populateReviewerDropdown, 200);
  }

  // Also refresh when the Timelines sub-tab is clicked
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.wb-sub-tab');
    if (btn && btn.dataset.wbtab === 'wb-panel-timelines') {
      setTimeout(function() {
        populateReviewerDropdown();
        renderRollup();
      }, 100);
    }
  });

})();
