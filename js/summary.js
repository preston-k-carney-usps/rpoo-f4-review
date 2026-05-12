/**
 * summary.js — Summary page.
 * Shows reviews filtered by year, defaults to latest review.
 */

// --- MH Task → LDC / Category map (mirrors mailhandler.js MH_TASKS) ---
var MH_TASK_CAT = {
  B:       { ldc: '43A', cat: 'work',  desc: 'Breaking Down Mail' },
  'C-COL': { ldc: '48',  cat: 'work',  desc: 'Culling Mail: Carrier Collections' },
  CD:      { ldc: '43A', cat: 'work',  desc: 'Cross Dock Operation' },
  CLK:     { ldc: 'CC',  cat: 'cc',    desc: 'Clerk Functions (Cross Craft)' },
  CR:      { ldc: '43A', cat: 'work',  desc: 'Putting Mail in Carrier Route Order' },
  CW:      { ldc: '48',  cat: 'work',  desc: 'Car Wash Operation in PM' },
  D:       { ldc: '48',  cat: 'work',  desc: 'Dispatching Mail' },
  '99':    { ldc: '43A', cat: 'work',  desc: 'Accept - Scan 99 Placards' },
  DU:      { ldc: '43A', cat: 'work',  desc: 'Dumping Sacks/Dumper' },
  E:       { ldc: '43A', cat: 'work',  desc: 'Elevator' },
  HA:      { ldc: '43A', cat: 'work',  desc: 'Hashing Mail for Downstream' },
  'LT/ULT':{ ldc: '43A', cat: 'work',  desc: 'Load Truck & Unload Truck' },
  MTE:     { ldc: '43A', cat: 'work',  desc: 'Empty Equipment Collection' },
  NP:      { ldc: 'NP',  cat: 'np',    desc: 'Non-productive Time' },
  NW:      { ldc: 'NP',  cat: 'np',    desc: 'No Work Available' },
  O:       { ldc: '48',  cat: 'work',  desc: 'Misc. Activity - Describe in Comments' },
  RT:      { ldc: '48',  cat: 'work',  desc: 'Retrieve Mail: Col. Box/Retail' },
  S:       { ldc: '43A', cat: 'work',  desc: 'Spreading Mail' },
  SM:      { ldc: '43A', cat: 'work',  desc: 'Staging Mail' },
  STBY:    { ldc: 'NP',  cat: 'np',    desc: 'Standby Time' },
  SUE:     { ldc: '43A', cat: 'work',  desc: 'Setting Up Equipment' },
  CB:      { ldc: 'BRK', cat: 'break', desc: 'Comfort Break' },
  X:       { ldc: 'BRK', cat: 'break', desc: 'Break' },
  XX:      { ldc: 'BRK', cat: 'break', desc: 'Lunch' },
};

var MH_CAT_COLORS = {
  work:  '#3b82f6',
  break: '#f59e0b',
  np:    '#ef4444',
  cc:    '#8b5cf6'
};

var MH_CAT_LABELS = {
  work:  'Work (43A/48)',
  break: 'Break Time',
  np:    'Non-productive',
  cc:    'Cross Craft'
};

document.addEventListener('DOMContentLoaded', function() {
  var authUser = Auth.requireAuth();
  if (!authUser) return;
  Auth.renderNavbar();

  // --- Elements ---
  var filterYear     = document.getElementById('filter-year');
  var filterStatus   = document.getElementById('filter-status');
  var dashView       = document.getElementById('dash-view');
  var dashEmpty      = document.getElementById('dash-empty');
  var dashGrid       = document.getElementById('dash-grid');
  var aggStats       = document.getElementById('agg-stats');
  var reviewView     = document.getElementById('review-view');
  var backBtn        = document.getElementById('back-btn');
  var reviewTitle    = document.getElementById('review-title');
  var reviewSubtitle = document.getElementById('review-subtitle');
  var totalTimeObsEl = document.getElementById('total-time-observed');
  var totalEntriesEl = document.getElementById('total-entries');
  var totalNpTimeEl  = document.getElementById('total-np-time');
  var totalNpInstEl  = document.getElementById('total-np-instances');
  var totalTimeLostEl= document.getElementById('total-time-lost');
  var totalWordsEl   = document.getElementById('total-words');
  var topLdcEl       = document.getElementById('top-ldc');
  var ldcBars        = document.getElementById('ldc-bars');
  var timelineDay1   = document.getElementById('timeline-day1');
  var timelineDay2   = document.getElementById('timeline-day2');
  var timelineTrack1 = document.getElementById('timeline-track-1');
  var timelineTrack2 = document.getElementById('timeline-track-2');
  var timelineLegend = document.getElementById('timeline-legend');
  var day1Section    = document.getElementById('day1-section');
  var day1Title      = document.getElementById('day1-title');
  var day1Content    = document.getElementById('day1-content');
  var day2Section    = document.getElementById('day2-section');
  var day2Title      = document.getElementById('day2-title');
  var day2Content    = document.getElementById('day2-content');

  // MH-specific elements
  var clerkStatsSection = document.getElementById('clerk-stats-section');
  var mhStatsSection = document.getElementById('mh-stats-section');
  var mhTotalObsEl  = document.getElementById('mh-total-observed');
  var mhTotalEntEl  = document.getElementById('mh-total-entries');
  var mhWorkloadEl  = document.getElementById('mh-workload');
  var mhNpTimeEl    = document.getElementById('mh-np-time');
  var mhBreakTimeEl = document.getElementById('mh-break-time');
  var mhCcTimeEl    = document.getElementById('mh-cc-time');
  var mhTimeLostEl  = document.getElementById('mh-time-lost');
  var mhContinuousEl= document.getElementById('mh-continuous');
  var cwTrack1      = document.getElementById('cw-track-1');
  var cwTrack2      = document.getElementById('cw-track-2');
  var cwLabel1      = document.getElementById('cw-label-1');
  var cwLabel2      = document.getElementById('cw-label-2');
  var timelineDesc  = document.getElementById('timeline-desc');
  var mhDayStats1   = document.getElementById('mh-day-stats-1');
  var mhDayStats2   = document.getElementById('mh-day-stats-2');

  // --- Build finance# lookup ---
  var byFin = {};
  for (var i = 0; i < OFFICE_LIST.length; i++) {
    var e = OFFICE_LIST[i];
    byFin[e[0]] = { fin: e[0], office: e[1], area: e[3], district: e[4] };
  }

  // --- Load all observations visible to user ---
  function getVisibleObs() {
    var obs = Auth.filterVisible(Storage.hydrate(Storage.getAll()));
    if (typeof Reviews !== 'undefined' && Reviews.getAll) {
      var reviewIds = {};
      Reviews.getAll().forEach(function(r) { reviewIds[r.id] = true; });
      obs = obs.filter(function(o) { return !o.reviewId || reviewIds[o.reviewId]; });
    }
    return obs;
  }

  // --- Group observations by reviewId ---
  function groupByReview(observations) {
    var map = {};
    observations.forEach(function(obs) {
      var key = obs.reviewId || obs.office || 'unknown';
      if (!map[key]) map[key] = [];
      map[key].push(obs);
    });
    return map;
  }

  // --- Compute review status ---
  function getRevStatus(rev, obsForReview) {
    var now = Date.now();
    var endMs = rev.endDate ? new Date(rev.endDate + 'T23:59:59').getTime() : 0;
    var isPast = endMs > 0 && now > endMs + 7 * 24 * 60 * 60 * 1000;
    if (!obsForReview || obsForReview.length === 0) return 'not-started';
    var d1 = obsForReview.some(function(o) { return o.dayNumber === '1'; });
    var d2 = obsForReview.some(function(o) { return o.dayNumber === '2'; });
    if ((d1 && d2) || (isPast && (d1 || d2))) return 'complete';
    return 'in-progress';
  }

  // --- Time formatter ---
  function fmtTime(totalMinutes) {
    var h = Math.floor(totalMinutes / 60);
    var m = Math.round(totalMinutes % 60);
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }

  // --- Populate year filter ---
  function initYears() {
    var allRevs = Reviews.getAll();
    var yearSet = {};
    allRevs.forEach(function(r) {
      var yr = (r.startDate || r.createdAt || '').slice(0, 4);
      if (yr && yr.length === 4) yearSet[yr] = true;
    });
    var years = Object.keys(yearSet).sort().reverse();
    var currentYear = new Date().getFullYear().toString();
    if (years.length === 0) years = [currentYear];

    filterYear.innerHTML = '';
    years.forEach(function(yr) {
      var opt = document.createElement('option');
      opt.value = yr; opt.textContent = yr;
      filterYear.appendChild(opt);
    });
    if (years.indexOf(currentYear) >= 0) filterYear.value = currentYear;
  }

  // --- Main dashboard refresh ---
  function refreshDashboard() {
    reviewView.hidden = true;
    dashView.hidden = false;

    var yearVal = filterYear.value;
    var statusVal = filterStatus.value;
    var allRevs = Reviews.getAll();
    var allObs = getVisibleObs();
    var obsByReview = groupByReview(allObs);

    // Filter reviews by year
    var revs = allRevs.filter(function(r) {
      var yr = (r.startDate || r.createdAt || '').slice(0, 4);
      return yr === yearVal;
    });

    // Build per-review data
    var cards = revs.map(function(rev) {
      var obs = obsByReview[rev.id] || [];
      var status = getRevStatus(rev, obs);
      var totalEntries = obs.reduce(function(s, o) { return s + (o.rows ? o.rows.length : 0); }, 0);
      var totalMin = 0, npMin = 0;
      obs.forEach(function(o) {
        if (o.rows) o.rows.forEach(function(r) {
          totalMin += r.elapsed || 0;
          if (r.ldc === 'NP') npMin += r.elapsed || 0;
        });
      });
      return { rev: rev, obs: obs, status: status, totalEntries: totalEntries, totalMin: totalMin, npMin: npMin };
    });

    // Filter by status
    if (statusVal !== 'all') {
      cards = cards.filter(function(c) { return c.status === statusVal; });
    }

    // Sort: in-progress first, then not-started, then complete; within each, by start date desc
    var statusOrder = { 'in-progress': 0, 'not-started': 1, 'complete': 2 };
    cards.sort(function(a, b) {
      var so = (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
      if (so !== 0) return so;
      return (b.rev.startDate || '') > (a.rev.startDate || '') ? 1 : -1;
    });

    if (cards.length === 0) {
      dashEmpty.hidden = false;
      dashGrid.innerHTML = '';
      aggStats.hidden = true;
      return;
    }
    dashEmpty.hidden = true;

    // --- Aggregate stats ---
    var aggTotal = cards.length;
    var aggComplete = cards.filter(function(c) { return c.status === 'complete'; }).length;
    var aggInProgress = cards.filter(function(c) { return c.status === 'in-progress'; }).length;
    var aggNotStarted = cards.filter(function(c) { return c.status === 'not-started'; }).length;
    var aggEntries = cards.reduce(function(s, c) { return s + c.totalEntries; }, 0);
    var aggMin = cards.reduce(function(s, c) { return s + c.totalMin; }, 0);

    aggStats.innerHTML =
      '<div class="stat-box"><span class="stat-value">' + aggTotal + '</span><span class="stat-label">Total Reviews</span></div>' +
      '<div class="stat-box"><span class="stat-value" style="color:#22c55e">' + aggComplete + '</span><span class="stat-label">Complete</span></div>' +
      '<div class="stat-box"><span class="stat-value" style="color:#f59e0b">' + aggInProgress + '</span><span class="stat-label">In Progress</span></div>' +
      '<div class="stat-box"><span class="stat-value" style="color:#94a3b8">' + aggNotStarted + '</span><span class="stat-label">Not Started</span></div>' +
      '<div class="stat-box"><span class="stat-value">' + aggEntries + '</span><span class="stat-label">Total Entries</span></div>' +
      '<div class="stat-box"><span class="stat-value">' + fmtTime(aggMin) + '</span><span class="stat-label">Time Observed</span></div>';
    aggStats.hidden = false;

    // --- Build cards ---
    var roleLabels = { clerk: 'Clerk', mailhandler: 'Mail Handler', lead: 'Workbook Lead', teamlead: 'Review Lead' };
    var statusLabels = { 'complete': 'Complete', 'in-progress': 'In Progress', 'not-started': 'Not Started' };
    var statusClass = { 'complete': 'complete', 'in-progress': 'progress', 'not-started': 'not-started' };

    dashGrid.innerHTML = cards.map(function(c, idx) {
      var rev = c.rev;
      var offices = rev.offices || [];
      var officeNames = offices.map(function(o) { return escHtml(o.officeName); }).join(', ') || '—';
      var dateRange = formatDate(rev.startDate);
      if (rev.endDate && rev.endDate !== rev.startDate) dateRange += ' – ' + formatDate(rev.endDate);

      // Team tags
      var teamHtml = '';
      if (rev.assignments && rev.assignments.length > 0) {
        teamHtml = rev.assignments.map(function(a) {
          var u = Auth.getUserById(a.userId);
          var name = u ? u.displayName : '(unknown)';
          var tagClass = (a.reviewRole === 'lead' || a.reviewRole === 'teamlead') ? ' drv-team-tag--' + a.reviewRole : '';
          return '<span class="drv-team-tag' + tagClass + '">' + escHtml(name) + ' · ' + (roleLabels[a.reviewRole] || a.reviewRole) + '</span>';
        }).join('');
      }

      return '<div class="drv-card" data-idx="' + idx + '">' +
        '<div class="drv-header">' +
          '<span class="drv-title">' + escHtml(rev.name || 'Unnamed Review') + '</span>' +
          '<span class="drv-status drv-status--' + statusClass[c.status] + '">' + statusLabels[c.status] + '</span>' +
        '</div>' +
        '<div class="drv-meta">' +
          '<span>📅 ' + dateRange + '</span>' +
          '<span>📍 ' + officeNames + '</span>' +
        '</div>' +
        '<div class="drv-stats">' +
          '<div class="drv-stat"><span class="drv-stat-val">' + c.totalEntries + '</span><span class="drv-stat-label">Entries</span></div>' +
          '<div class="drv-stat"><span class="drv-stat-val">' + fmtTime(c.totalMin) + '</span><span class="drv-stat-label">Observed</span></div>' +
          '<div class="drv-stat"><span class="drv-stat-val">' + fmtTime(c.npMin) + '</span><span class="drv-stat-label">NP Time</span></div>' +
          '<div class="drv-stat"><span class="drv-stat-val">' + (offices.length || 0) + '</span><span class="drv-stat-label">Offices</span></div>' +
        '</div>' +
        (teamHtml ? '<div class="drv-team">' + teamHtml + '</div>' : '') +
      '</div>';
    }).join('');

    // Store cards data for click
    dashGrid._cards = cards;

    dashGrid.querySelectorAll('.drv-card').forEach(function(el) {
      el.addEventListener('click', function() {
        var c = dashGrid._cards[parseInt(el.dataset.idx)];
        if (c) openReviewDetail(c);
      });
    });
  }

  // --- Open review detail (per-office breakdown) ---
  function openReviewDetail(cardData) {
    var rev = cardData.rev;
    var obs = cardData.obs;
    // Group observations by office within this review
    var officeMap = {};
    obs.forEach(function(o) {
      var key = o.financeNum || o.office || 'unknown';
      if (!officeMap[key]) officeMap[key] = { obs: [], office: o.office || '', financeNum: o.financeNum || '' };
      officeMap[key].obs.push(o);
    });
    var officeGroups = Object.values(officeMap);

    // If single office, go straight to detail
    if (officeGroups.length <= 1) {
      var group = officeGroups[0] || { obs: obs, office: rev.officeName || (rev.offices && rev.offices[0] ? rev.offices[0].officeName : ''), financeNum: rev.financeNum || (rev.offices && rev.offices[0] ? rev.offices[0].financeNum : ''), reviewStartDate: rev.startDate, reviewEndDate: rev.endDate, reviewId: rev.id };
      group.reviewStartDate = rev.startDate;
      group.reviewEndDate = rev.endDate;
      group.reviewId = rev.id;
      dashView.hidden = true;
      showReview(group, rev.name);
      return;
    }

    // Multiple offices — show office picker within the review detail
    dashView.hidden = true;
    reviewView.hidden = false;
    reviewTitle.textContent = rev.name || 'Review';
    var dateRange = formatDate(rev.startDate);
    if (rev.endDate && rev.endDate !== rev.startDate) dateRange += ' – ' + formatDate(rev.endDate);
    reviewSubtitle.textContent = dateRange;

    // Hide stats sections until an office is picked
    clerkStatsSection.hidden = true;
    mhStatsSection.hidden = true;
    document.getElementById('timeline-section').hidden = true;
    day1Section.hidden = true;
    day2Section.hidden = true;
    document.querySelector('#review-view section:last-of-type').hidden = true; // LDC bars
    ldcBars.innerHTML = '';

    // Build an office picker list at the top of the detail view
    var pickerHtml = '<section class="card" id="rv-office-picker"><h3 style="font-size:0.95rem;margin-bottom:0.5rem;">Select an Office</h3><div class="office-list">';
    officeGroups.forEach(function(g, i) {
      var totalRows = g.obs.reduce(function(s, o) { return s + (o.rows ? o.rows.length : 0); }, 0);
      var finLabel = g.financeNum ? ' (' + escHtml(g.financeNum) + ')' : '';
      pickerHtml += '<button class="office-card" data-oidx="' + i + '">' +
        '<div class="office-card-name">' + escHtml(g.office) + finLabel + '</div>' +
        '<div class="office-card-details"><span>' + totalRows + ' entries</span></div>' +
      '</button>';
    });
    pickerHtml += '</div></section>';

    // Insert picker before the stats sections
    var existingPicker = document.getElementById('rv-office-picker');
    if (existingPicker) existingPicker.remove();
    clerkStatsSection.insertAdjacentHTML('beforebegin', pickerHtml);

    document.querySelectorAll('#rv-office-picker .office-card').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var g = officeGroups[parseInt(btn.dataset.oidx)];
        if (g) {
          g.reviewStartDate = rev.startDate;
          g.reviewEndDate = rev.endDate;
          g.reviewId = rev.id;
          var picker = document.getElementById('rv-office-picker');
          if (picker) picker.remove();
          showReviewInner(g, rev.name);
        }
      });
    });
  }

  filterYear.addEventListener('change', refreshDashboard);
  filterStatus.addEventListener('change', refreshDashboard);

  // --- Back ---
  backBtn.addEventListener('click', function() {
    reviewView.hidden = true;
    dashView.hidden = false;
    var existingPicker = document.getElementById('rv-office-picker');
    if (existingPicker) existingPicker.remove();
  });

  // --- Show Review Detail (single office group) ---
  function showReview(group, revName) {
    dashView.hidden = true;
    reviewView.hidden = false;
    showReviewInner(group, revName);
  }

  function showReviewInner(group, revName) {
    reviewView.hidden = false;

    // Ensure all detail sections are visible (may have been hidden by multi-office picker)
    var tlSec = document.getElementById('timeline-section');
    if (tlSec) tlSec.hidden = false;
    var ldcSec = ldcBars.closest('section');
    if (ldcSec) ldcSec.hidden = false;

    var officeObs = group.obs.slice();
    officeObs.sort(function(a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (parseInt(a.dayNumber) || 0) - (parseInt(b.dayNumber) || 0);
    });

    var day1Obs = officeObs.filter(function(o) { return o.dayNumber === '1'; });
    var day2Obs = officeObs.filter(function(o) { return o.dayNumber === '2'; });
    if (day1Obs.length === 0 && day2Obs.length === 0) {
      if (officeObs.length >= 1) day1Obs = [officeObs[0]];
      if (officeObs.length >= 2) day2Obs = [officeObs[1]];
    }

    var dates = officeObs.map(function(o) { return o.date; }).filter(Boolean).sort();
    var finLabel = group.financeNum ? ' (' + group.financeNum + ')' : '';
    reviewTitle.textContent = (revName ? revName + ' — ' : '') + group.office + finLabel;
    if (group.reviewStartDate) {
      var detailDateRange = formatDate(group.reviewStartDate);
      if (group.reviewEndDate && group.reviewEndDate !== group.reviewStartDate) {
        detailDateRange += ' \u2013 ' + formatDate(group.reviewEndDate);
      }
      reviewSubtitle.textContent = detailDateRange;
    } else {
      reviewSubtitle.textContent = dates.length > 0
        ? formatDate(dates[0]) + (dates.length > 1 && dates[0] !== dates[dates.length - 1] ? ' \u2013 ' + formatDate(dates[dates.length - 1]) : '')
        : '';
    }

    var allRows = officeObs.flatMap(function(o) { return o.rows || []; });

    // Detect craft by observation role AND row data for reliability
    function isMhObs(o) {
      if (o.reviewRole === 'mailhandler') return true;
      // Fallback: if rows have 'task' field (MH format) and no 'ldc' field
      if (o.rows && o.rows.length > 0 && o.rows[0].task && !o.rows[0].ldc) return true;
      return false;
    }

    // Separate observations by craft
    var mhObs = officeObs.filter(function(o) { return isMhObs(o); });
    var clerkObs = officeObs.filter(function(o) { return !isMhObs(o); });
    var mhRows = mhObs.flatMap(function(o) { return o.rows || []; });
    var clerkRows = clerkObs.flatMap(function(o) { return o.rows || []; });
    var isMH = mhRows.length > 0;
    var isClerk = clerkRows.length > 0;

    // --- Clerk Stats ---
    if (isClerk && clerkRows.length > 0) {
      clerkStatsSection.hidden = false;

      var totalMins = clerkRows.reduce(function(s, r) { return s + (r.elapsed || 0); }, 0);
      var th = Math.floor(totalMins / 60);
      var tm = totalMins % 60;
      totalTimeObsEl.textContent = th > 0 ? (th + 'h ' + tm + 'm') : (tm + 'm');
      totalEntriesEl.textContent = clerkRows.length;

      var npRows = clerkRows.filter(function(r) { return r.ldc === 'NP'; });
      var npMins = npRows.reduce(function(s, r) { return s + (r.elapsed || 0); }, 0);
      var nph = Math.floor(npMins / 60);
      var npm = npMins % 60;
      totalNpTimeEl.textContent = nph > 0 ? (nph + 'h ' + npm + 'm') : (npm + 'm');
      totalNpInstEl.textContent = npRows.length;

      var totalLost = clerkRows.reduce(function(s, r) { return s + (parseInt(r.timeLost) || 0); }, 0);
      totalTimeLostEl.textContent = totalLost;

      var totalWords = clerkRows.reduce(function(s, r) {
        var desc = (r.workDescription || '').trim();
        if (!desc) return s;
        return s + desc.split(/\s+/).length;
      }, 0);
      totalWordsEl.textContent = totalWords;

      var ldcMap = {};
      clerkRows.forEach(function(r) {
        var ldc = r.ldc || 'Unknown';
        ldcMap[ldc] = (ldcMap[ldc] || 0) + (r.elapsed || 0);
      });
      var sortedLdcs = Object.entries(ldcMap).sort(function(a, b) { return b[1] - a[1]; });
      topLdcEl.textContent = sortedLdcs.length ? sortedLdcs[0][0] : '\u2014';
    } else {
      clerkStatsSection.hidden = true;
    }

    // --- MH Stats ---
    if (isMH && mhRows.length > 0) {
      mhStatsSection.hidden = false;

      var mhTotalObserved = 0, mhTotalWork = 0, mhTotalNP = 0, mhTotalBreak = 0, mhTotalCC = 0;
      mhRows.forEach(function(r) {
        var mins = r.elapsed || 0;
        mhTotalObserved += mins;
        var tc = MH_TASK_CAT[r.task];
        var cat = tc ? tc.cat : 'work';
        if (cat === 'work') mhTotalWork += mins;
        else if (cat === 'np') mhTotalNP += mins;
        else if (cat === 'break') mhTotalBreak += mins;
        else if (cat === 'cc') mhTotalCC += mins;
      });

      var mhWorkload = mhTotalObserved - mhTotalBreak - mhTotalNP;
      if (mhWorkload < 0) mhWorkload = 0;

      var mhLongest = calcContinuousWork(mhRows);

      mhTotalObsEl.textContent  = Storage.formatElapsed(mhTotalObserved);
      mhTotalEntEl.textContent  = mhRows.length;
      mhWorkloadEl.textContent  = Storage.formatElapsed(mhWorkload);
      mhNpTimeEl.textContent    = Storage.formatElapsed(mhTotalNP);
      mhBreakTimeEl.textContent = Storage.formatElapsed(mhTotalBreak);
      mhCcTimeEl.textContent    = Storage.formatElapsed(mhTotalCC);
      mhContinuousEl.textContent= Storage.formatElapsed(mhLongest);

      var mhTotalLost = mhRows.reduce(function(s, r) { return s + (parseInt(r.timeLost) || 0); }, 0);
      mhTimeLostEl.textContent = mhTotalLost;
    } else {
      mhStatsSection.hidden = true;
    }

    // --- Hours by LDC bar chart ---
    var ldcMap = {};
    if (isMH && mhRows.length > 0) {
      mhRows.forEach(function(r) {
        var tc = MH_TASK_CAT[r.task];
        var ldc = tc ? tc.ldc : 'Unknown';
        ldcMap[ldc] = (ldcMap[ldc] || 0) + (r.elapsed || 0);
      });
      timelineDesc.textContent = 'Each block represents a task entry, colored by category. Green bar shows continuous work stretches.';
    } else if (clerkRows.length > 0) {
      clerkRows.forEach(function(r) {
        var ldc = r.ldc || 'Unknown';
        ldcMap[ldc] = (ldcMap[ldc] || 0) + (r.elapsed || 0);
      });
      timelineDesc.textContent = 'Each block represents an observation entry, colored by LDC. Width = duration.';
    }
    var sortedLdcs = Object.entries(ldcMap).sort(function(a, b) { return b[1] - a[1]; });
    var maxMins = sortedLdcs.length ? sortedLdcs[0][1] : 1;
    ldcBars.innerHTML = sortedLdcs.length
      ? sortedLdcs.map(function(entry) {
          return '<div class="bar-row">' +
            '<span class="bar-label">' + escHtml(Storage.ldcLabel(entry[0])) + '</span>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + (entry[1] / maxMins * 100).toFixed(1) + '%"></div></div>' +
            '<span class="bar-value">' + (entry[1] / 60).toFixed(1) + 'h</span>' +
          '</div>';
        }).join('')
      : '<p class="empty-state">No data.</p>';

    // --- Timeline ---
    renderTimeline(day1Obs, day2Obs, isMH);

    // Helper: combine multiple observations into one merged obs for display
    function mergeObs(obsArr) {
      if (obsArr.length === 0) return null;
      if (obsArr.length === 1) return obsArr[0];
      var merged = {
        office: obsArr[0].office,
        financeNum: obsArr[0].financeNum,
        reviewId: obsArr[0].reviewId,
        date: obsArr[0].date,
        dayNumber: obsArr[0].dayNumber,
        observerName: obsArr.map(function(o) { return o.observerName || ''; }).filter(Boolean).join(', '),
        status: obsArr.some(function(o) { return o.status === 'draft'; }) ? 'draft' : 'submitted',
        rows: []
      };
      obsArr.forEach(function(o) { merged.rows = merged.rows.concat(o.rows || []); });
      return merged;
    }

    // Helper: render a day section with combined + individual set dropdowns
    function renderDaySection(dayObs, daySection, dayTitle, dayContent, dayLabel) {
      if (dayObs.length === 0) { daySection.hidden = true; return; }
      daySection.hidden = false;
      var d = dayObs[0];
      dayTitle.textContent = dayLabel + ' \u2014 ' + formatDate(d.date);

      // Separate clerk sets from other obs
      var clerkObs = dayObs.filter(function(o) { return o.reviewRole !== 'mailhandler'; });
      var mhObsDay = dayObs.filter(function(o) { return o.reviewRole === 'mailhandler'; });

      var html = '';
      if (isMH) {
        html = renderMhDayEntries(d);
      } else if (clerkObs.length <= 1) {
        html = renderDayEntries(d);
      } else {
        // Multiple clerk sets — show combined overview + individual dropdowns
        var combined = mergeObs(clerkObs);
        html += '<div style="margin-bottom:0.5rem;font-size:0.82rem;color:var(--text-light);font-weight:600;">' +
          '\uD83D\uDCCB Combined Overview (' + clerkObs.length + ' sets, ' + combined.rows.length + ' total entries)</div>';
        html += renderDayEntries(combined);

        // Individual set accordions
        html += '<div style="margin-top:1rem;">';
        html += '<div style="font-size:0.82rem;font-weight:600;color:var(--text-light);margin-bottom:0.4rem;">Individual Sets</div>';
        clerkObs.forEach(function(setObs, si) {
          var setLabel = setObs.setLabel || ('Set ' + (si + 1));
          var setRows = setObs.rows ? setObs.rows.length : 0;
          var setMins = (setObs.rows || []).reduce(function(s, r) { return s + (r.elapsed || 0); }, 0);
          var statusBadge = setObs.status === 'draft'
            ? '<span style="color:var(--danger);font-weight:600;font-size:0.72rem;">DRAFT</span>'
            : '<span style="color:var(--success);font-weight:600;font-size:0.72rem;">\u2713</span>';
          html += '<details style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:0.35rem;">';
          html += '<summary style="cursor:pointer;padding:0.4rem 0.65rem;font-size:0.82rem;background:var(--bg-light);border-radius:var(--radius);">' +
            '<strong>' + escHtml(setLabel) + '</strong>' +
            ' \u2014 ' + setRows + ' entries \u00B7 ' + Storage.formatElapsed(setMins) +
            ' ' + statusBadge +
            (setObs.observerName ? ' \u00B7 ' + escHtml(setObs.observerName) : '') +
            '</summary>';
          html += '<div style="padding:0.5rem 0.65rem;">' + renderDayEntries(setObs) + '</div>';
          html += '</details>';
        });
        html += '</div>';
      }
      dayContent.innerHTML = html;

      var del = daySection.querySelector('.day-delete-btn');
      if (del) {
        del.hidden = !Auth.canDelete(d);
        del.onclick = function() {
          if (confirm('Delete ' + dayLabel + ' data for ' + group.office + '?')) {
            dayObs.forEach(function(o) { Storage.delete(o.id); });
            refreshList();
          }
        };
      }
    }

    renderDaySection(day1Obs, day1Section, day1Title, day1Content, 'Day 1');
    renderDaySection(day2Obs, day2Section, day2Title, day2Content, 'Day 2');

    // Hide Hours by LDC for clerk if MH, vice versa not needed
    // (both use same ldcBars element, already populated above)

    if (day1Obs.length === 0 && day2Obs.length === 0) {
      refreshList();
    }
  }

  // --- Render entries table for one day ---
  function renderDayEntries(obs) {
    if (!obs.rows || obs.rows.length === 0) {
      return '<p class="empty-state">No entries for this day.</p>';
    }

    var dayMins = obs.rows.reduce(function(s, r) { return s + (r.elapsed || 0); }, 0);
    var dayLost = obs.rows.reduce(function(s, r) { return s + (parseInt(r.timeLost) || 0); }, 0);

    var html = '<div class="day-meta">' +
      (obs.observerName ? '<span><strong>Observer:</strong> ' + escHtml(obs.observerName) + '</span>' : '') +
      '<span><strong>Entries:</strong> ' + obs.rows.length + '</span>' +
      '<span><strong>Total:</strong> ' + Storage.formatElapsed(dayMins) + '</span>' +
      (dayLost > 0 ? '<span><strong>Time Lost:</strong> ' + dayLost + ' min</span>' : '') +
      (obs.status === 'draft' ? '<span style="color:var(--danger);font-weight:600;">DRAFT</span>' : '') +
    '</div>';

    html += '<div class="table-wrap"><table class="summary-table"><thead><tr>' +
      '<th>LDC</th><th>OPN</th><th>Clerks</th><th>Begin</th><th>End</th>' +
      '<th>Elapsed</th><th>Work Quality</th><th>Time Lost</th><th>Description</th>' +
      '<th>Ltr Vol</th><th>Flt Vol</th><th>Parcels</th>' +
    '</tr></thead><tbody>';

    obs.rows.forEach(function(r) {
      var ldcOpt = LDC_OPTIONS.find(function(o) { return o.value === r.ldc; });
      var colorClass = ldcOpt ? ldcOpt.color : '';
      html += '<tr class="' + colorClass + '">' +
        '<td>' + escHtml(ldcOpt ? ldcOpt.short : (r.ldc || '\u2014')) + '</td>' +
        '<td>' + escHtml(r.opn || '\u2014') + '</td>' +
        '<td>' + (r.totalClerks || '\u2014') + '</td>' +
        '<td>' + (r.beginTime || '\u2014') + '</td>' +
        '<td>' + (r.endTime || '\u2014') + '</td>' +
        '<td>' + Storage.formatElapsed(r.elapsed) + '</td>' +
        '<td>' + escHtml(r.workQuality || '\u2014') + '</td>' +
        '<td>' + (r.timeLost ? r.timeLost + ' min' : '\u2014') + '</td>' +
        '<td>' + escHtml(r.workDescription || '\u2014') + '</td>' +
        '<td>' + (r.ltrVolInches || '\u2014') + '</td>' +
        '<td>' + (r.fltVolInches || '\u2014') + '</td>' +
        '<td>' + (r.parcels || '\u2014') + '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  // --- Render per-day MH stats inside timeline ---
  function renderMhDayStats(obs, el) {
    if (!obs || !obs.rows || obs.rows.length === 0) return;
    var dayMins = obs.rows.reduce(function(s, r) { return s + (r.elapsed || 0); }, 0);
    var dayNP = 0, dayBreak = 0;
    obs.rows.forEach(function(r) {
      var tc = MH_TASK_CAT[r.task];
      var cat = tc ? tc.cat : 'work';
      if (cat === 'np') dayNP += (r.elapsed || 0);
      else if (cat === 'break') dayBreak += (r.elapsed || 0);
    });
    var dayWorkload = dayMins - dayNP - dayBreak;
    if (dayWorkload < 0) dayWorkload = 0;
    var dayCW = calcContinuousWork(obs.rows);
    el.innerHTML =
      '<span><strong>Workload:</strong> ' + Storage.formatElapsed(dayWorkload) + '</span>' +
      '<span class="mh-day-np"><strong>NP:</strong> ' + Storage.formatElapsed(dayNP) + '</span>' +
      '<span class="mh-day-cw"><strong>Continuous Work:</strong> ' + Storage.formatElapsed(dayCW) + '</span>' +
      '<span><strong>Observed:</strong> ' + Storage.formatElapsed(dayMins) + '</span>';
    el.hidden = false;
  }

  // --- Render MH entries table for one day ---
  function renderMhDayEntries(obs) {
    if (!obs.rows || obs.rows.length === 0) {
      return '<p class="empty-state">No entries for this day.</p>';
    }

    var dayMins = obs.rows.reduce(function(s, r) { return s + (r.elapsed || 0); }, 0);
    var dayLost = obs.rows.reduce(function(s, r) { return s + (parseInt(r.timeLost) || 0); }, 0);

    var html = '<div class="day-meta">' +
      (obs.observerName ? '<span><strong>Observer:</strong> ' + escHtml(obs.observerName) + '</span>' : '') +
      (obs.employeeName ? '<span><strong>Employee:</strong> ' + escHtml(obs.employeeName) + '</span>' : '') +
      '<span><strong>Entries:</strong> ' + obs.rows.length + '</span>' +
      '<span><strong>Total:</strong> ' + Storage.formatElapsed(dayMins) + '</span>' +
      (dayLost > 0 ? '<span><strong>Time Lost:</strong> ' + dayLost + ' min</span>' : '') +
      (obs.status === 'draft' ? '<span style="color:var(--danger);font-weight:600;">DRAFT</span>' : '') +
    '</div>';

    html += '<div class="table-wrap"><table class="summary-table"><thead><tr>' +
      '<th>Task</th><th>LDC</th><th>Begin</th><th>End</th>' +
      '<th>Elapsed</th><th>Mail Type</th><th>Equip</th><th>Qty</th>' +
      '<th>Work Quality</th><th>Time Lost</th><th>Comments</th>' +
    '</tr></thead><tbody>';

    obs.rows.forEach(function(r) {
      var tc = MH_TASK_CAT[r.task];
      var catClass = tc ? 'mh-cat-' + tc.cat : '';
      var ldcLabel = tc ? tc.ldc : '\u2014';
      var taskLabel = tc ? r.task + ' \u2014 ' + tc.desc : (r.task || '\u2014');
      html += '<tr class="' + catClass + '">' +
        '<td>' + escHtml(taskLabel) + '</td>' +
        '<td>' + escHtml(ldcLabel) + '</td>' +
        '<td>' + (r.beginTime || '\u2014') + '</td>' +
        '<td>' + (r.endTime || '\u2014') + '</td>' +
        '<td>' + Storage.formatElapsed(r.elapsed) + '</td>' +
        '<td>' + escHtml(r.mailType || '\u2014') + '</td>' +
        '<td>' + escHtml(r.equipType || '\u2014') + '</td>' +
        '<td>' + (r.equipQty || '\u2014') + '</td>' +
        '<td>' + escHtml(r.workQuality || '\u2014') + '</td>' +
        '<td>' + (r.timeLost ? r.timeLost + ' min' : '\u2014') + '</td>' +
        '<td>' + escHtml(r.comments || '\u2014') + '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  // --- Continuous work calculation ---
  function calcContinuousWork(rows) {
    var longest = 0;
    var current = 0;

    rows.forEach(function(r) {
      if (!r.beginTime || !r.endTime) return;
      var mins = r.elapsed || Storage.calcElapsed(r.beginTime, r.endTime);
      var tc = MH_TASK_CAT[r.task];
      var cat = tc ? tc.cat : 'work';

      // Work, cross craft, and comfort breaks (CB) continue the streak
      var continues = (cat === 'work' || cat === 'cc' || r.task === 'CB');

      if (continues) {
        current += mins;
      } else {
        if (current > longest) longest = current;
        current = 0;
      }
    });
    if (current > longest) longest = current;
    return longest;
  }

  // --- Calculate continuous work streaks for timeline ---
  function getContinuousStreaks(rows) {
    var streaks = [];
    var streakStart = -1;
    var currentMins = 0;

    rows.forEach(function(r, idx) {
      if (!r.beginTime || !r.endTime) return;
      var mins = r.elapsed || Storage.calcElapsed(r.beginTime, r.endTime);
      var tc = MH_TASK_CAT[r.task];
      var cat = tc ? tc.cat : 'work';
      var continues = (cat === 'work' || cat === 'cc' || r.task === 'CB');

      if (continues) {
        if (streakStart === -1) streakStart = idx;
        currentMins += mins;
      } else {
        if (currentMins > 0) {
          streaks.push({ startIdx: streakStart, endIdx: idx - 1, mins: currentMins });
        }
        currentMins = 0;
        streakStart = -1;
      }
    });
    if (currentMins > 0) {
      streaks.push({ startIdx: streakStart, endIdx: rows.length - 1, mins: currentMins });
    }
    return streaks;
  }

  // --- Render Timeline ---
  function renderTimeline(day1Obs, day2Obs, isMH) {
    timelineDay1.hidden = true;
    timelineDay2.hidden = true;
    timelineTrack1.innerHTML = '';
    timelineTrack2.innerHTML = '';
    cwTrack1.innerHTML = '';
    cwTrack2.innerHTML = '';
    cwTrack1.hidden = true;
    cwTrack2.hidden = true;
    cwLabel1.hidden = true;
    cwLabel2.hidden = true;

    var usedLdcs = {};

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

    function buildTrack(obs, trackEl, cwTrackEl, cwLabelEl) {
      if (!obs || !obs.rows || obs.rows.length === 0) return false;

      var rows = obs.rows.filter(function(r) { return r.beginTime && r.endTime; });
      if (rows.length === 0) return false;

      var allStarts = rows.map(function(r) { return timeToMin(r.beginTime); });
      var allEnds = rows.map(function(r) { return timeToMin(r.endTime); });
      var dayStart = Math.min.apply(null, allStarts);
      var dayEnd = Math.max.apply(null, allEnds);
      if (dayEnd <= dayStart) dayEnd = dayStart + 1;
      var daySpan = dayEnd - dayStart;

      // Time axis labels — military time
      var axisHtml = '<div class="timeline-axis">';
      var firstHour = Math.ceil(dayStart / 60);
      var lastHour = Math.floor(dayEnd / 60);
      for (var h = firstHour; h <= lastHour; h++) {
        var pct = ((h * 60 - dayStart) / daySpan * 100);
        if (pct >= 0 && pct <= 100) {
          var label = String(h).padStart(2, '0') + ':00';
          axisHtml += '<span class="timeline-hour" style="left:' + pct.toFixed(1) + '%">' + label + '</span>';
        }
      }
      axisHtml += '</div>';

      // Gridlines
      var gridHtml = '';
      for (var gh = firstHour; gh <= lastHour; gh++) {
        var gPct = ((gh * 60 - dayStart) / daySpan * 100);
        if (gPct > 0 && gPct < 100) {
          gridHtml += '<div class="timeline-gridline" style="left:' + gPct.toFixed(1) + '%"></div>';
        }
      }

      // Build observation blocks
      var blocksHtml = '<div class="timeline-blocks">' + gridHtml;
      rows.forEach(function(r) {
        var start = timeToMin(r.beginTime);
        var end = timeToMin(r.endTime);
        var left = ((start - dayStart) / daySpan * 100).toFixed(2);
        var width = ((end - start) / daySpan * 100).toFixed(2);
        if (parseFloat(width) < 0.5) width = '0.5';

        if (isMH) {
          // MH: color by category
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
          // Clerk: color by LDC
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

      trackEl.innerHTML = axisHtml + blocksHtml;

      // MH: build continuous work bar
      if (isMH && cwTrackEl) {
        var streaks = getContinuousStreaks(obs.rows);
        if (streaks.length > 0) {
          var cwBlocksHtml = '<div class="timeline-blocks">' + gridHtml;
          streaks.forEach(function(st) {
            var startRow = obs.rows[st.startIdx];
            var endRow = obs.rows[st.endIdx];
            if (!startRow || !endRow || !startRow.beginTime || !endRow.endTime) return;
            var sStart = timeToMin(startRow.beginTime);
            var sEnd = timeToMin(endRow.endTime);
            var left = ((sStart - dayStart) / daySpan * 100).toFixed(2);
            var width = ((sEnd - sStart) / daySpan * 100).toFixed(2);
            cwBlocksHtml += '<div class="timeline-block mh-cw-block" ' +
              'style="left:' + left + '%;width:' + width + '%;" ' +
              'title="Continuous work: ' + Storage.formatElapsed(st.mins) + ' (' + fmtTime(sStart) + ' - ' + fmtTime(sEnd) + ')">' +
              (parseFloat(width) > 6 ? '<span class="timeline-block-label" style="color:#fff;">' + Storage.formatElapsed(st.mins) + '</span>' : '') +
            '</div>';
          });
          cwBlocksHtml += '</div>';
          cwTrackEl.innerHTML = cwBlocksHtml;
          cwTrackEl.hidden = false;
          if (cwLabelEl) cwLabelEl.hidden = false;
        }
      }

      return true;
    }

    // Reset day stats
    mhDayStats1.hidden = true;
    mhDayStats1.innerHTML = '';
    mhDayStats2.hidden = true;
    mhDayStats2.innerHTML = '';

    if (day1Obs.length > 0 && buildTrack(day1Obs[0], timelineTrack1, cwTrack1, cwLabel1)) {
      timelineDay1.hidden = false;
      if (isMH) renderMhDayStats(day1Obs[0], mhDayStats1);
    }
    if (day2Obs.length > 0 && buildTrack(day2Obs[0], timelineTrack2, cwTrack2, cwLabel2)) {
      timelineDay2.hidden = false;
      if (isMH) renderMhDayStats(day2Obs[0], mhDayStats2);
    }

    // Legend
    if (isMH) {
      // MH legend by category + continuous work
      timelineLegend.innerHTML = '<div class="timeline-legend-items">' +
        Object.keys(MH_CAT_LABELS).map(function(k) {
          return '<span class="timeline-legend-item"><span class="timeline-legend-swatch" style="background:' + MH_CAT_COLORS[k] + '"></span>' + MH_CAT_LABELS[k] + '</span>';
        }).join('') +
        '<span class="timeline-legend-item"><span class="timeline-legend-swatch mh-cw-block"></span>Continuous Work</span>' +
      '</div>';
    } else {
      var ldcKeys = Object.keys(usedLdcs);
      if (ldcKeys.length > 0) {
        timelineLegend.innerHTML = '<div class="timeline-legend-items">' +
          ldcKeys.map(function(key) {
            var info = usedLdcs[key];
            return '<span class="timeline-legend-item"><span class="timeline-legend-swatch ' + info.colorClass + '"></span>' + escHtml(info.label) + '</span>';
          }).join('') +
        '</div>';
      } else {
        timelineLegend.innerHTML = '';
      }
    }
  }

  // --- Helpers ---
  function formatDate(dateStr) {
    if (!dateStr) return '\u2014';
    var parts = dateStr.split('-');
    return parts[1] + '/' + parts[2] + '/' + parts[0];
  }

  function escHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Init ---
  initYears();
  refreshDashboard();
});
