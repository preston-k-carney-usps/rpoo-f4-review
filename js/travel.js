// travel.js — Travel Survey: assignment, reviewer form, rollup, carpool grouping
(function() {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var travelOnlyMode = (params.get('mode') === 'travel');
  var travelReviewParam = params.get('travelReview') || '';

  var setup = {};
  try { setup = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) {}
  var reviewId = travelReviewParam || setup.reviewId || '';
  var reviewRole = setup.reviewRole || '';
  var financeNum = setup.financeNum || '';
  if (!reviewId) return;

  // Travel is review-wide (not per-office)
  var TRAVEL_KEY = 'clerk_obs_travel_survey_' + reviewId;

  // Migrate: if old per-office key exists, merge it into the review-wide key
  if (financeNum) {
    var oldKey = TRAVEL_KEY + '_' + financeNum;
    var oldRaw = localStorage.getItem(oldKey);
    if (oldRaw) {
      try {
        var oldData = JSON.parse(oldRaw);
        var curRaw = localStorage.getItem(TRAVEL_KEY);
        var curData = curRaw ? JSON.parse(curRaw) : { assignments: [], responses: {}, carpools: [] };
        var existingIds = {};
        curData.assignments.forEach(function(a) { existingIds[a.userId] = true; });
        (oldData.assignments || []).forEach(function(a) {
          if (!existingIds[a.userId]) { curData.assignments.push(a); existingIds[a.userId] = true; }
        });
        var oldResp = oldData.responses || {};
        for (var uid in oldResp) {
          if (!curData.responses[uid]) curData.responses[uid] = oldResp[uid];
        }
        localStorage.setItem(TRAVEL_KEY, JSON.stringify(curData));
        localStorage.removeItem(oldKey);
      } catch(e) {}
    }
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function loadData() {
    try { return JSON.parse(localStorage.getItem(TRAVEL_KEY)) || { assignments: [], responses: {}, carpools: [] }; }
    catch(e) { return { assignments: [], responses: {}, carpools: [] }; }
  }
  function saveData(data) {
    localStorage.setItem(TRAVEL_KEY, JSON.stringify(data));
  }

  // Get current user info
  var session = {};
  try { session = JSON.parse(localStorage.getItem('clerk_obs_session')) || {}; } catch(e) {}
  var currentUserId = session.id || '';

  // ============================================================
  //  REVIEWER SIDE — Travel Survey Form
  // ============================================================
  function initReviewerForm() {
    // In travel-only mode (from home page Quick Action), force-show the travel tab
    if (travelOnlyMode) {
      var allTabs = document.querySelectorAll('.review-tab');
      allTabs.forEach(function(t) {
        if (t.dataset.tab === 'tab-travel-survey') { t.hidden = false; t.click(); }
        else { t.style.display = 'none'; }
      });
      // Hide workbook panel and pre-review/review mode buttons
      var wbPanel = document.getElementById('tab-workbook');
      if (wbPanel) wbPanel.style.display = 'none';
      var wbModeBar = document.getElementById('wb-mode-bar');
      if (wbModeBar) wbModeBar.style.display = 'none';
      var podPhaseBar = document.getElementById('pod-phase-bar');
      if (podPhaseBar) podPhaseBar.style.display = 'none';
      var podPostPanel = document.getElementById('pod-post-review');
      if (podPostPanel) podPostPanel.style.display = 'none';
      var obsInfoSec = document.getElementById('obs-info-section');
      if (obsInfoSec) obsInfoSec.style.display = 'none';
      document.querySelectorAll('.wb-mode-btns, .review-mode-toggle').forEach(function(el) {
        if (el) el.style.display = 'none';
      });
    } else {
      // Normal mode: show for everyone (leads/admins can also complete travel survey)
    }

    var data = loadData();
    // Check if current user is assigned to travel survey
    var assigned = data.assignments.some(function(a) { return a.userId === currentUserId; });

    // Also check schedule across all offices — auto-add if on any schedule
    if (!assigned) {
      var schedKeys = [];
      if (financeNum) {
        schedKeys.push('clerk_obs_schedule_' + reviewId + '_' + financeNum);
      }
      schedKeys.push('clerk_obs_schedule_' + reviewId);
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('clerk_obs_schedule_' + reviewId) === 0 && schedKeys.indexOf(k) === -1) {
          schedKeys.push(k);
        }
      }

      for (var si = 0; si < schedKeys.length; si++) {
        if (assigned) break;
        try {
          var schedData = JSON.parse(localStorage.getItem(schedKeys[si])) || {};
          var schedNames = schedData.assignedNames || [];
          var match = schedNames.find(function(sn) { return sn.userId === currentUserId; });
          if (match) {
            data.assignments.push({ name: match.name || match.userName, userId: currentUserId });
            saveData(data);
            assigned = true;
          }
        } catch(e) {}
      }
    }

    if (!assigned) {
      if (!travelOnlyMode) return; // Tab stays hidden in normal mode
      // In travel-only mode show the not-assigned message
      var tabBtn2 = document.querySelector('.review-tab[data-tab="tab-travel-survey"]');
      if (tabBtn2) { tabBtn2.hidden = false; tabBtn2.click(); }
      return;
    }

    // Show the tab button (skip if POD phase bar handles it)
    var hasPodPhaseBar = document.getElementById('pod-phase-bar') && !document.getElementById('pod-phase-bar').hidden;
    var tabBtn = document.querySelector('.review-tab[data-tab="tab-travel-survey"]');
    if (tabBtn && !hasPodPhaseBar) tabBtn.hidden = false;

    var notAssigned = document.getElementById('travel-survey-not-assigned');
    var formDiv = document.getElementById('travel-survey-form');
    var statusSpan = document.getElementById('travel-survey-status');
    if (!formDiv) return;

    if (notAssigned) notAssigned.style.display = 'none';
    formDiv.style.display = '';

    // Show hotel booking link banner if lead provided one
    var hotelBanner = document.getElementById('travel-hotel-link-banner');
    var hotelBannerUrl = document.getElementById('travel-hotel-link-url');
    if (hotelBanner && hotelBannerUrl && data.hotelBookingLink) {
      hotelBannerUrl.href = data.hotelBookingLink;
      hotelBannerUrl.textContent = data.hotelBookingLink;
      hotelBanner.style.display = '';
    }

    var phoneInput = document.getElementById('travel-phone');
    var modeRadios = document.querySelectorAll('input[name="travel-mode"]');
    var drivingInfo = document.getElementById('travel-driving-info');
    var flightDetails = document.getElementById('travel-flight-details');
    var submitBtn = document.getElementById('travel-survey-submit');
    var hotelCheckbox = document.getElementById('travel-hotel-booked');
    var hotelUpdateDiv = document.getElementById('travel-hotel-update');
    var hotelUpdateCheck = document.getElementById('travel-hotel-update-check');
    var hotelUpdateBtn = document.getElementById('travel-hotel-update-btn');
    var hotelUpdateStatus = document.getElementById('travel-hotel-update-status');

    // Auto-fill phone from saved user preference
    var savedPhone = localStorage.getItem('clerk_obs_phone_' + currentUserId) || '';
    if (phoneInput && savedPhone && !phoneInput.value) {
      phoneInput.value = savedPhone;
    }

    // Pre-fill if already submitted
    var existing = data.responses[currentUserId];
    if (existing) {
      if (phoneInput && existing.phone) phoneInput.value = existing.phone;
      modeRadios.forEach(function(r) {
        if (r.value === existing.mode) r.checked = true;
      });
      if (existing.mode === 'driving') {
        drivingInfo.style.display = '';
        flightDetails.style.display = 'none';
      } else if (existing.mode === 'flying') {
        drivingInfo.style.display = 'none';
        flightDetails.style.display = '';
        if (existing.arrival) {
          var ad = document.getElementById('travel-arrive-date');
          var at = document.getElementById('travel-arrive-time');
          var aa = document.getElementById('travel-arrive-airline');
          var af = document.getElementById('travel-arrive-flight');
          var aap = document.getElementById('travel-arrive-airport');
          if (ad) ad.value = existing.arrival.date || '';
          if (at) at.value = existing.arrival.time || '';
          if (aa) aa.value = existing.arrival.airline || '';
          if (af) af.value = existing.arrival.flight || '';
          if (aap) aap.value = existing.arrival.airport || '';
        }
        if (existing.departure) {
          var dd = document.getElementById('travel-depart-date');
          var dt = document.getElementById('travel-depart-time');
          var da = document.getElementById('travel-depart-airline');
          var df = document.getElementById('travel-depart-flight');
          var dap = document.getElementById('travel-depart-airport');
          if (dd) dd.value = existing.departure.date || '';
          if (dt) dt.value = existing.departure.time || '';
          if (da) da.value = existing.departure.airline || '';
          if (df) df.value = existing.departure.flight || '';
          if (dap) dap.value = existing.departure.airport || '';
        }
      }
      if (statusSpan) {
        statusSpan.textContent = 'Previously submitted ' + new Date(existing.submittedAt).toLocaleString();
        statusSpan.style.color = 'var(--success)';
      }
      // Pre-fill hotel checkbox
      if (hotelCheckbox) hotelCheckbox.checked = !!existing.hotelBooked;
      // Show hotel-only update section so they can come back and update
      if (hotelUpdateDiv) {
        hotelUpdateDiv.style.display = '';
        if (hotelUpdateCheck) hotelUpdateCheck.checked = !!existing.hotelBooked;
      }
    }

    // Toggle mode
    modeRadios.forEach(function(r) {
      r.addEventListener('change', function() {
        if (r.value === 'driving') {
          drivingInfo.style.display = '';
          flightDetails.style.display = 'none';
        } else {
          drivingInfo.style.display = 'none';
          flightDetails.style.display = '';
        }
      });
    });

    // Submit
    submitBtn.addEventListener('click', function() {
      var mode = '';
      modeRadios.forEach(function(r) { if (r.checked) mode = r.value; });
      if (!mode) {
        if (statusSpan) { statusSpan.textContent = 'Please select Flying or Driving.'; statusSpan.style.color = 'var(--danger)'; }
        return;
      }

      var phone = phoneInput ? phoneInput.value.trim() : '';
      if (!phone) {
        if (statusSpan) { statusSpan.textContent = 'Please enter your phone number.'; statusSpan.style.color = 'var(--danger)'; }
        return;
      }

      var response = { mode: mode, phone: phone, hotelBooked: !!(hotelCheckbox && hotelCheckbox.checked), submittedAt: new Date().toISOString() };

      // Persist phone for future surveys
      localStorage.setItem('clerk_obs_phone_' + currentUserId, phone);

      if (mode === 'flying') {
        var arrDate = document.getElementById('travel-arrive-date').value;
        var arrTime = document.getElementById('travel-arrive-time').value;
        var arrAirline = document.getElementById('travel-arrive-airline').value.trim();
        var arrFlight = document.getElementById('travel-arrive-flight').value.trim();
        var arrAirport = (document.getElementById('travel-arrive-airport').value || '').trim().toUpperCase();
        var depDate = document.getElementById('travel-depart-date').value;
        var depTime = document.getElementById('travel-depart-time').value;
        var depAirline = document.getElementById('travel-depart-airline').value.trim();
        var depFlight = document.getElementById('travel-depart-flight').value.trim();
        var depAirport = (document.getElementById('travel-depart-airport').value || '').trim().toUpperCase();

        if (!arrDate || !arrTime) {
          if (statusSpan) { statusSpan.textContent = 'Please fill in arrival date and time.'; statusSpan.style.color = 'var(--danger)'; }
          return;
        }
        if (!depDate || !depTime) {
          if (statusSpan) { statusSpan.textContent = 'Please fill in departure date and time.'; statusSpan.style.color = 'var(--danger)'; }
          return;
        }

        response.arrival = { date: arrDate, time: arrTime, airline: arrAirline, flight: arrFlight, airport: arrAirport };
        response.departure = { date: depDate, time: depTime, airline: depAirline, flight: depFlight, airport: depAirport };
      }

      // Save
      var freshData = loadData();
      freshData.responses[currentUserId] = response;
      saveData(freshData);

      if (statusSpan) {
        statusSpan.textContent = '\u2713 Submitted successfully!';
        statusSpan.style.color = 'var(--success)';
      }
      // Show hotel update section after submit
      if (hotelUpdateDiv) {
        hotelUpdateDiv.style.display = '';
        if (hotelUpdateCheck) hotelUpdateCheck.checked = response.hotelBooked;
      }
    });

    // Hotel-only update (can come back later to confirm)
    if (hotelUpdateBtn) {
      hotelUpdateBtn.addEventListener('click', function() {
        var d = loadData();
        if (!d.responses[currentUserId]) return;
        d.responses[currentUserId].hotelBooked = !!(hotelUpdateCheck && hotelUpdateCheck.checked);
        saveData(d);
        if (hotelUpdateStatus) {
          hotelUpdateStatus.textContent = '\u2713 Hotel status updated';
          hotelUpdateStatus.style.color = 'var(--success)';
          setTimeout(function() { hotelUpdateStatus.textContent = ''; }, 2000);
        }
      });
    }
  }

  // ============================================================
  //  TEAM LEAD SIDE — Assignment, Rollup, Carpool
  // ============================================================
  function initTeamLeadPanel() {
    if (reviewRole !== 'teamlead' && reviewRole !== 'lead') return;
    if (travelOnlyMode) return; // Don't show management panel in travel-only mode

    var assignInput = document.getElementById('wb-travel-assign-input');
    var assignResults = document.getElementById('wb-travel-assign-results');
    var importBtn = document.getElementById('wb-travel-import-btn');
    var assignedList = document.getElementById('wb-travel-assigned-list');
    var rollupDiv = document.getElementById('wb-travel-rollup');

    if (!assignInput || !rollupDiv) return;

    // Hotel booking link save/load
    var hotelLinkInput = document.getElementById('wb-travel-hotel-link');
    var hotelLinkSaveBtn = document.getElementById('wb-travel-hotel-link-save');
    var hotelLinkStatus = document.getElementById('wb-travel-hotel-link-status');
    if (hotelLinkInput) {
      var d = loadData();
      if (d.hotelBookingLink) hotelLinkInput.value = d.hotelBookingLink;
    }
    if (hotelLinkSaveBtn) {
      hotelLinkSaveBtn.addEventListener('click', function() {
        var d = loadData();
        var val = (hotelLinkInput.value || '').trim();
        if (val) {
          d.hotelBookingLink = val;
        } else {
          delete d.hotelBookingLink;
        }
        saveData(d);
        if (hotelLinkStatus) {
          hotelLinkStatus.textContent = val ? '✓ Saved' : '✓ Cleared';
          hotelLinkStatus.style.color = 'var(--success)';
          setTimeout(function() { hotelLinkStatus.textContent = ''; }, 2000);
        }
      });
    }

    // Get all Auth users
    var allUsers = [];
    if (typeof Auth !== 'undefined' && Auth.getUsers) {
      allUsers = Auth.getUsers();
    }

    // Import from schedule's assignedNames — scan ALL offices in the review
    if (importBtn) {
      importBtn.addEventListener('click', function() {
        // Get all offices for this review
        var review = (typeof Reviews !== 'undefined' && Reviews.getById) ? Reviews.getById(reviewId) : null;
        var offices = (review && review.offices) ? review.offices : [];
        if (offices.length === 0 && financeNum) offices = [{ financeNum: financeNum, officeName: 'Current Office' }];

        // Collect schedule keys for all offices, track source
        var sources = []; // { key, officeName, names[] }
        offices.forEach(function(o) {
          sources.push({ key: 'clerk_obs_schedule_' + reviewId + '_' + o.financeNum, officeName: o.officeName || o.financeNum });
        });

        // Gather all unique assignedNames across all offices
        var allSchedNames = [];
        var seenIds = {};
        var sourceReport = [];
        sources.forEach(function(src) {
          try {
            var schedData = JSON.parse(localStorage.getItem(src.key)) || {};
            var names = schedData.assignedNames || [];
            var newFromThis = 0;
            names.forEach(function(sn) {
              if (sn.userId && !seenIds[sn.userId]) {
                allSchedNames.push(sn);
                seenIds[sn.userId] = true;
                newFromThis++;
              }
            });
            if (names.length > 0) {
              sourceReport.push(src.officeName + ': ' + names.length + ' reviewer' + (names.length !== 1 ? 's' : '') + ' (' + newFromThis + ' new)');
            }
          } catch(e) {}
        });

        // Also include review leaders (lead + teamlead) as travelers
        var leaderCount = 0;
        if (review && review.assignments) {
          review.assignments.forEach(function(a) {
            if ((a.reviewRole === 'lead' || a.reviewRole === 'teamlead') && a.userId && !seenIds[a.userId]) {
              var u = (typeof Auth !== 'undefined' && Auth.getUserById) ? Auth.getUserById(a.userId) : null;
              var name = u ? (u.displayName || u.username) : ('Leader ' + a.userId);
              allSchedNames.push({ name: name, userId: a.userId });
              seenIds[a.userId] = true;
              leaderCount++;
            }
          });
          if (leaderCount > 0) {
            sourceReport.push('Review Leaders: ' + leaderCount);
          }
        }

        if (allSchedNames.length === 0) {
          alert('No reviewers found in any office schedule. Build schedules and assign names first.');
          return;
        }

        // Filter out already-assigned
        var data = loadData();
        var existingIds = {};
        data.assignments.forEach(function(a) { existingIds[a.userId] = true; });
        var toAdd = allSchedNames.filter(function(sn) { return !existingIds[sn.userId]; });

        if (toAdd.length === 0) {
          alert('All schedule names are already assigned.');
          return;
        }

        // Confirm with source breakdown
        var msg = 'Found ' + allSchedNames.length + ' unique reviewer' + (allSchedNames.length !== 1 ? 's' : '') + ' across ' + sourceReport.length + ' office' + (sourceReport.length !== 1 ? 's' : '') + ':\n\n';
        msg += sourceReport.join('\n');
        msg += '\n\n' + toAdd.length + ' new name' + (toAdd.length !== 1 ? 's' : '') + ' to add:\n';
        msg += toAdd.map(function(sn) { return '  • ' + (sn.name || sn.userName); }).join('\n');
        msg += '\n\nImport these travelers?';

        if (!confirm(msg)) return;

        toAdd.forEach(function(sn) {
          data.assignments.push({ name: sn.name || sn.userName, userId: sn.userId });
        });
        saveData(data);
        renderAssignedList();
        renderRollup();
      });
    }

    function getUnassignedUsers() {
      var data = loadData();
      var assignedIds = {};
      data.assignments.forEach(function(a) { assignedIds[a.userId] = true; });
      return allUsers.filter(function(u) { return !assignedIds[u.id]; });
    }

    function showAutocomplete(query) {
      var available = getUnassignedUsers();
      var q = (query || '').toLowerCase().trim();
      if (!q) { assignResults.innerHTML = ''; assignResults.style.display = 'none'; return; }
      var matches = available.filter(function(u) {
        var name = (u.displayName || u.username || '').toLowerCase();
        var parts = name.split(/[\s,]+/);
        return parts.some(function(p) { return p.indexOf(q) === 0; }) || name.indexOf(q) !== -1;
      });
      if (matches.length === 0) {
        assignResults.innerHTML = '<div class="travel-ac-empty">No matches</div>';
        assignResults.style.display = 'block';
        return;
      }
      var html = '';
      matches.forEach(function(u) {
        html += '<div class="travel-ac-item" data-uid="' + esc(u.id) + '">' + esc(u.displayName || u.username) + '</div>';
      });
      assignResults.innerHTML = html;
      assignResults.style.display = 'block';

      assignResults.querySelectorAll('.travel-ac-item').forEach(function(item) {
        item.addEventListener('mousedown', function(e) {
          e.preventDefault();
          var uid = item.dataset.uid;
          var user = allUsers.find(function(u) { return u.id === uid; });
          if (!user) return;
          var data = loadData();
          data.assignments.push({ name: user.displayName || user.username, userId: uid });
          saveData(data);
          assignInput.value = '';
          assignResults.innerHTML = '';
          assignResults.style.display = 'none';
          renderAssignedList();
          renderRollup();
        });
      });
    }

    assignInput.addEventListener('input', function() { showAutocomplete(assignInput.value); });
    assignInput.addEventListener('focus', function() { if (assignInput.value.trim()) showAutocomplete(assignInput.value); });
    assignInput.addEventListener('blur', function() { assignResults.style.display = 'none'; });

    function renderAssignedList() {
      var data = loadData();
      if (data.assignments.length === 0) {
        assignedList.innerHTML = '<p style="color:var(--text-light);font-size:0.85rem;">No travelers assigned yet.</p>';
        return;
      }
      var html = '<div style="display:flex;flex-wrap:wrap;gap:0.5rem;">';
      data.assignments.forEach(function(a) {
        html += '<span class="info-chip" style="display:inline-flex;align-items:center;gap:0.35rem;">';
        html += esc(a.name);
        html += ' <button class="travel-remove-assign" data-uid="' + esc(a.userId) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1rem;padding:0 2px;" title="Remove">\u00d7</button>';
        html += '</span>';
      });
      html += '</div>';
      assignedList.innerHTML = html;

      assignedList.querySelectorAll('.travel-remove-assign').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var uid = btn.dataset.uid;
          var d = loadData();
          d.assignments = d.assignments.filter(function(a) { return a.userId !== uid; });
          delete d.responses[uid];
          d.carpools = d.carpools.map(function(g) {
            return g.filter(function(id) { return id !== uid; });
          }).filter(function(g) { return g.length > 0; });
          saveData(d);
          renderAssignedList();
          renderRollup();
          renderTravelGroups();
        });
      });
    }

    // Assign button
    // Rollup
    function renderRollup() {
      var data = loadData();
      if (data.assignments.length === 0) {
        rollupDiv.innerHTML = '<p class="empty-state">No travelers assigned to the travel survey.</p>';
        return;
      }

      var html = '<table class="wb-sched-table"><thead><tr>';
      html += '<th>Reviewer</th><th>Phone</th><th>Status</th><th>Mode</th><th>Hotel</th><th>Arrival</th><th>Departure</th>';
      html += '</tr></thead><tbody>';

      data.assignments.forEach(function(a) {
        var resp = data.responses[a.userId];
        html += '<tr>';
        html += '<td>' + esc(a.name) + '</td>';
        html += '<td>' + (resp && resp.phone ? esc(resp.phone) : '\u2014') + '</td>';

        if (!resp) {
          html += '<td><span class="travel-badge travel-badge--pending">Pending</span> ';
          html += '<button class="btn btn-outline btn-sm tl-enter-for" data-uid="' + esc(a.userId) + '" data-name="' + esc(a.name) + '" style="font-size:0.72rem;padding:1px 6px;margin-left:4px;">Enter</button></td>';
          html += '<td>\u2014</td><td>\u2014</td><td>\u2014</td><td>\u2014</td>';
        } else if (resp.mode === 'driving') {
          html += '<td><span class="travel-badge travel-badge--done">Submitted</span></td>';
          html += '<td>\ud83d\ude97 Driving</td>';
          html += '<td>' + (resp.hotelBooked ? '<span style="color:var(--success);">\u2705 Booked</span>' : '<span style="color:var(--warning);">\u23f3 Not yet</span>') + '</td>';
          html += '<td>\u2014</td><td>\u2014</td>';
        } else {
          html += '<td><span class="travel-badge travel-badge--done">Submitted</span></td>';
          html += '<td>\u2708\ufe0f Flying</td>';
          html += '<td>' + (resp.hotelBooked ? '<span style="color:var(--success);">\u2705 Booked</span>' : '<span style="color:var(--warning);">\u23f3 Not yet</span>') + '</td>';
          var arr = resp.arrival || {};
          var dep = resp.departure || {};
          html += '<td style="white-space:nowrap;">';
          if (arr.airport) html += '<strong>' + esc(arr.airport) + '</strong><br>';
          html += formatDate(arr.date) + ' ' + formatTime(arr.time);
          if (arr.airline) html += '<br><span style="font-size:0.8rem;">' + esc(arr.airline) + (arr.flight ? ' #' + esc(arr.flight) : '') + '</span>';
          html += '</td>';
          html += '<td style="white-space:nowrap;">';
          if (dep.airport) html += '<strong>' + esc(dep.airport) + '</strong><br>';
          html += formatDate(dep.date) + ' ' + formatTime(dep.time);
          if (dep.airline) html += '<br><span style="font-size:0.8rem;">' + esc(dep.airline) + (dep.flight ? ' #' + esc(dep.flight) : '') + '</span>';
          html += '</td>';
        }
        html += '</tr>';
      });

      html += '</tbody></table>';

      // Summary counts
      var pending = data.assignments.filter(function(a) { return !data.responses[a.userId]; }).length;
      var done = data.assignments.length - pending;
      html = '<div style="display:flex;gap:1rem;margin-bottom:0.75rem;">' +
        '<span class="info-chip"><strong>' + done + '</strong> Submitted</span>' +
        '<span class="info-chip" style="' + (pending > 0 ? 'background:var(--warning-bg);color:var(--warning);' : '') + '"><strong>' + pending + '</strong> Pending</span>' +
        '</div>' + html;

      rollupDiv.innerHTML = html;

      // Wire "Enter" buttons for team lead to enter info on behalf of pending reviewers
      rollupDiv.querySelectorAll('.tl-enter-for').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var uid = btn.dataset.uid;
          var name = btn.dataset.name;
          showEnterForModal(uid, name);
        });
      });
    }

    function showEnterForModal(uid, name) {
      // Remove any existing modal
      var old = document.getElementById('tl-enter-modal');
      if (old) old.remove();

      var overlay = document.createElement('div');
      overlay.id = 'tl-enter-modal';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';

      var box = document.createElement('div');
      box.style.cssText = 'background:var(--card-bg,#fff);border-radius:8px;padding:1.25rem;max-width:420px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);color:var(--text);';

      box.innerHTML = '<h3 style="margin:0 0 0.75rem;font-size:1rem;">Enter Travel Info for ' + esc(name) + '</h3>'
        + '<label style="font-size:0.82rem;font-weight:600;">Phone</label>'
        + '<input type="tel" id="tl-ef-phone" class="input-field" style="margin-bottom:0.5rem;" placeholder="Phone number">'
        + '<label style="font-size:0.82rem;font-weight:600;">Mode</label>'
        + '<div style="display:flex;gap:1rem;margin-bottom:0.5rem;">'
        + '<label style="cursor:pointer;"><input type="radio" name="tl-ef-mode" value="flying" checked> ✈️ Flying</label>'
        + '<label style="cursor:pointer;"><input type="radio" name="tl-ef-mode" value="driving"> 🚗 Driving</label>'
        + '</div>'
        + '<div id="tl-ef-flight">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;margin-bottom:0.4rem;">'
        + '<div style="grid-column:1/-1;"><label style="font-size:0.78rem;">Arrival Airport</label><input type="text" id="tl-ef-arr-airport" class="input-field" placeholder="e.g. ERI, CLE, PIT" style="text-transform:uppercase;"></div>'
        + '<div><label style="font-size:0.78rem;">Arrival Date</label><input type="date" id="tl-ef-arr-date" class="input-field"></div>'
        + '<div><label style="font-size:0.78rem;">Arrival Time</label><input type="time" id="tl-ef-arr-time" class="input-field"></div>'
        + '<div><label style="font-size:0.78rem;">Airline</label><input type="text" id="tl-ef-arr-airline" class="input-field" placeholder="Optional"></div>'
        + '<div><label style="font-size:0.78rem;">Flight #</label><input type="text" id="tl-ef-arr-flight" class="input-field" placeholder="Optional"></div>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;margin-bottom:0.5rem;">'
        + '<div style="grid-column:1/-1;"><label style="font-size:0.78rem;">Departure Airport</label><input type="text" id="tl-ef-dep-airport" class="input-field" placeholder="e.g. ERI, CLE, PIT" style="text-transform:uppercase;"></div>'
        + '<div><label style="font-size:0.78rem;">Departure Date</label><input type="date" id="tl-ef-dep-date" class="input-field"></div>'
        + '<div><label style="font-size:0.78rem;">Departure Time</label><input type="time" id="tl-ef-dep-time" class="input-field"></div>'
        + '<div><label style="font-size:0.78rem;">Airline</label><input type="text" id="tl-ef-dep-airline" class="input-field" placeholder="Optional"></div>'
        + '<div><label style="font-size:0.78rem;">Flight #</label><input type="text" id="tl-ef-dep-flight" class="input-field" placeholder="Optional"></div>'
        + '</div>'
        + '</div>'
        + '<label style="font-size:0.82rem;font-weight:600;margin-top:0.5rem;display:block;">Hotel</label>'
        + '<label style="cursor:pointer;font-size:0.85rem;"><input type="checkbox" id="tl-ef-hotel"> Hotel has been booked</label>'
        + '<div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.75rem;">'
        + '<button id="tl-ef-cancel" class="btn btn-outline btn-sm">Cancel</button>'
        + '<button id="tl-ef-save" class="btn btn-primary btn-sm">Save</button>'
        + '</div>';

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      // Toggle flight fields
      var flightDiv = document.getElementById('tl-ef-flight');
      document.querySelectorAll('input[name="tl-ef-mode"]').forEach(function(r) {
        r.addEventListener('change', function() {
          flightDiv.style.display = r.value === 'flying' ? '' : 'none';
        });
      });

      // Close
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
      document.getElementById('tl-ef-cancel').addEventListener('click', function() { overlay.remove(); });

      // Save
      document.getElementById('tl-ef-save').addEventListener('click', function() {
        var mode = '';
        document.querySelectorAll('input[name="tl-ef-mode"]').forEach(function(r) { if (r.checked) mode = r.value; });
        var phone = document.getElementById('tl-ef-phone').value.trim();
        if (!phone) { alert('Please enter a phone number.'); return; }

        var response = { mode: mode, phone: phone, hotelBooked: !!(document.getElementById('tl-ef-hotel') && document.getElementById('tl-ef-hotel').checked), submittedAt: new Date().toISOString(), enteredBy: currentUserId };

        if (mode === 'flying') {
          var arrDate = document.getElementById('tl-ef-arr-date').value;
          var arrTime = document.getElementById('tl-ef-arr-time').value;
          if (!arrDate || !arrTime) { alert('Please fill in arrival date and time.'); return; }
          var depDate = document.getElementById('tl-ef-dep-date').value;
          var depTime = document.getElementById('tl-ef-dep-time').value;
          if (!depDate || !depTime) { alert('Please fill in departure date and time.'); return; }
          response.arrival = {
            date: arrDate, time: arrTime,
            airline: document.getElementById('tl-ef-arr-airline').value.trim(),
            flight: document.getElementById('tl-ef-arr-flight').value.trim(),
            airport: (document.getElementById('tl-ef-arr-airport').value || '').trim().toUpperCase()
          };
          response.departure = {
            date: depDate, time: depTime,
            airline: document.getElementById('tl-ef-dep-airline').value.trim(),
            flight: document.getElementById('tl-ef-dep-flight').value.trim(),
            airport: (document.getElementById('tl-ef-dep-airport').value || '').trim().toUpperCase()
          };
        }

        var d = loadData();
        d.responses[uid] = response;
        saveData(d);
        overlay.remove();
        renderRollup();
        renderTravelGroups();
      });
    }

    // Reminder email
    var reminderBtn = document.getElementById('wb-travel-reminder-btn');
    if (reminderBtn) {
      reminderBtn.addEventListener('click', function() {
        var data = loadData();
        var pendingList = data.assignments.filter(function(a) { return !data.responses[a.userId]; });
        if (pendingList.length === 0) {
          alert('All reviewers have submitted their travel survey!');
          return;
        }
        var pendingNames = pendingList.map(function(a) { return a.name; });
        var emails = [];
        pendingList.forEach(function(a) {
          var user = allUsers.find(function(u) { return u.id === a.userId; });
          if (user && user.email) emails.push(user.email);
        });
        var revName = '';
        try { revName = Reviews.getById(reviewId).name || ''; } catch(e) {}
        var subject = 'Reminder: Travel Survey Pending' + (revName ? ' — ' + revName : '');
        var surveyUrl = window.location.origin + window.location.pathname + '?review=' + encodeURIComponent(reviewId) + '&mode=travel';
        var body = 'Hello,\n\nThis is a friendly reminder to complete your Travel Survey for the upcoming Function 4 Review' + (revName ? ' (' + revName + ')' : '') + '.\n\n';
        body += 'The following reviewers have not yet submitted:\n';
        pendingNames.forEach(function(n) { body += '  - ' + n + '\n'; });
        body += '\nPlease click the link below to complete your travel survey:\n' + surveyUrl + '\n\n';
        body += 'Thank you!';
        var mailto = 'mailto:' + emails.join(',') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
        window.open(mailto, '_blank');
      });
    }

    function formatDate(d) {
      if (!d) return '\u2014';
      var parts = d.split('-');
      return parts[1] + '/' + parts[2] + '/' + parts[0];
    }
    function formatTime(t) {
      if (!t) return '';
      var parts = t.split(':');
      var h = parseInt(parts[0], 10);
      var m = parts[1];
      var ampm = h >= 12 ? 'PM' : 'AM';
      if (h > 12) h -= 12;
      if (h === 0) h = 12;
      return h + ':' + m + ' ' + ampm;
    }

    // ============================================================
    //  TRAVEL PLAN — arrival / departure tables with manual groups
    // ============================================================
    var groupsDiv = document.getElementById('wb-travel-groups');
    var autoGroupBtn = document.getElementById('wb-travel-autogroup');

    function getFlyers() {
      var data = loadData();
      var flyers = [];
      data.assignments.forEach(function(a) {
        var r = data.responses[a.userId];
        if (r && r.mode === 'flying') {
          flyers.push({
            userId: a.userId, name: a.name,
            arriveDate: r.arrival ? r.arrival.date : '',
            arriveTime: r.arrival ? r.arrival.time : '',
            arriveAirport: r.arrival ? (r.arrival.airport || '') : '',
            departDate: r.departure ? r.departure.date : '',
            departTime: r.departure ? r.departure.time : '',
            departAirport: r.departure ? (r.departure.airport || '') : ''
          });
        }
      });
      return flyers;
    }

    function getDrivers() {
      var data = loadData();
      var drivers = [];
      data.assignments.forEach(function(a) {
        var r = data.responses[a.userId];
        if (r && r.mode === 'driving') {
          drivers.push({ userId: a.userId, name: a.name, phone: r.phone || '' });
        }
      });
      return drivers;
    }

    function renderTravelGroups() {
      if (!groupsDiv) return;
      var data = loadData();
      var flyers = getFlyers();
      var drivers = getDrivers();
      // Migrate old "uber" → "uber-1"
      var migrated = false;
      ['pickupPlan', 'dropoffPlan'].forEach(function(key) {
        if (data[key]) {
          Object.keys(data[key]).forEach(function(uid) {
            if (data[key][uid] === 'uber') { data[key][uid] = 'uber-1'; migrated = true; }
          });
        }
      });
      if (migrated) saveData(data);
      // pickupPlan/dropoffPlan: { flyerUserId: groupKey }
      // groupKey format: driverId, driverId-trip-2, "uber-1", "uber-2", etc.
      var pickup = data.pickupPlan || {};
      var dropoff = data.dropoffPlan || {};

      if (flyers.length === 0) {
        groupsDiv.innerHTML = '<p class="empty-state">No flight responses yet.</p>';
        return;
      }

      var groupColors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16'];
      var groupBgs = ['rgba(59,130,246,0.13)','rgba(16,185,129,0.13)','rgba(245,158,11,0.13)','rgba(239,68,68,0.13)','rgba(139,92,246,0.13)','rgba(236,72,153,0.13)','rgba(20,184,166,0.13)','rgba(249,115,22,0.13)','rgba(6,182,212,0.13)','rgba(132,204,22,0.13)'];

      // Collect existing group keys per plan direction
      function getGroupKeys(plan) {
        var keys = {};
        Object.keys(plan).forEach(function(uid) { if (plan[uid]) keys[plan[uid]] = true; });
        return Object.keys(keys);
      }

      // Build dropdown options with numbered uber pools and drivers
      function buildOpts(plan, selectedVal) {
        var existingKeys = getGroupKeys(plan);
        var uberNums = [];
        var driverNums = {};
        existingKeys.forEach(function(k) {
          if (k.indexOf('uber-') === 0) uberNums.push(parseInt(k.split('-')[1], 10));
          else {
            // driver key like "userId" or "userId-2"
            var parts = k.split('-trip-');
            var did = parts[0];
            var trip = parts.length > 1 ? parseInt(parts[1], 10) : 1;
            if (!driverNums[did]) driverNums[did] = [];
            driverNums[did].push(trip);
          }
        });

        var h = '<option value="">—</option>';

        // Driver options (existing trips + new trip)
        drivers.forEach(function(d) {
          var trips = driverNums[d.userId] || [];
          if (trips.length === 0) {
            // Single option
            h += '<option value="' + esc(d.userId) + '"' + (selectedVal === d.userId ? ' selected' : '') + '>🚗 ' + esc(d.name) + '</option>';
          } else {
            // Show existing trips
            trips.sort();
            trips.forEach(function(t) {
              var key = t === 1 ? d.userId : d.userId + '-trip-' + t;
              h += '<option value="' + esc(key) + '"' + (selectedVal === key ? ' selected' : '') + '>🚗 ' + esc(d.name) + (trips.length > 1 || t > 1 ? ' #' + t : '') + '</option>';
            });
            // + new trip
            var nextTrip = Math.max.apply(null, trips) + 1;
            var newKey = d.userId + '-trip-' + nextTrip;
            h += '<option value="' + esc(newKey) + '"' + (selectedVal === newKey ? ' selected' : '') + '>🚗 + ' + esc(d.name) + ' #' + nextTrip + '</option>';
          }
        });

        // Uber pools (existing + new)
        uberNums.sort(function(a, b) { return a - b; });
        uberNums.forEach(function(n) {
          var key = 'uber-' + n;
          h += '<option value="' + key + '"' + (selectedVal === key ? ' selected' : '') + '>🚕 Uber Pool ' + n + '</option>';
        });
        var nextUber = uberNums.length > 0 ? Math.max.apply(null, uberNums) + 1 : 1;
        h += '<option value="uber-' + nextUber + '">🚕 + New Uber Pool</option>';

        return h;
      }

      // Assign a color index per group key (each unique key gets own color)
      function buildColorMap(plan) {
        var map = {};
        var idx = 0;
        Object.keys(plan).forEach(function(uid) {
          var k = plan[uid];
          if (k && map[k] === undefined) { map[k] = idx++; }
        });
        return map;
      }

      // Get earliest time ms in a group
      function getEarliestMs(groupKey, plan, sortedFlyers, dateKey, timeKey) {
        var members = sortedFlyers.filter(function(f) { return plan[f.userId] === groupKey; });
        if (members.length === 0) return 0;
        var times = members.map(function(f) {
          return new Date((f[dateKey] || '2000-01-01') + 'T' + (f[timeKey] || '00:00')).getTime();
        });
        return Math.min.apply(null, times);
      }

      function fmtMs(ms) {
        var d = new Date(ms);
        var h = d.getHours(); var m = d.getMinutes();
        var ampm = h >= 12 ? 'PM' : 'AM';
        if (h > 12) h -= 12; if (h === 0) h = 12;
        return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
      }

      function msToTimeInput(ms) {
        var d = new Date(ms);
        var h = d.getHours(); var m = d.getMinutes();
        var ampm = h >= 12 ? 'PM' : 'AM';
        if (h > 12) h -= 12; if (h === 0) h = 12;
        return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
      }

      // Parse flexible time input → "H:MM AM/PM" or '' if invalid
      function parseTimeStr(str) {
        if (!str) return '';
        str = str.trim().toUpperCase().replace(/\s+/g, ' ');
        var ampm = '';
        if (str.indexOf('AM') !== -1 || str.indexOf('A') !== -1 && str.match(/[AP]$/)) ampm = 'AM';
        if (str.indexOf('PM') !== -1 || str.indexOf('P') !== -1 && str.match(/[AP]$/)) ampm = 'PM';
        // Strip AM/PM text
        var nums = str.replace(/[APM.\s]/g, '');
        var h, m;
        if (nums.indexOf(':') !== -1) {
          var parts = nums.split(':');
          h = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) || 0;
        } else if (nums.length <= 2) {
          h = parseInt(nums, 10); m = 0;
        } else if (nums.length === 3) {
          h = parseInt(nums[0], 10); m = parseInt(nums.substring(1), 10);
        } else {
          h = parseInt(nums.substring(0, 2), 10); m = parseInt(nums.substring(2), 10);
        }
        if (isNaN(h) || h < 0 || h > 23 || isNaN(m) || m < 0 || m > 59) return '';
        // If no AM/PM specified, guess based on hour
        if (!ampm) {
          if (h === 12) ampm = 'PM';
          else if (h > 12) { h -= 12; ampm = 'PM'; }
          else if (h === 0) { h = 12; ampm = 'AM'; }
          else ampm = h >= 7 ? 'AM' : 'PM'; // assume daytime
        } else {
          if (h > 12) h -= 12;
          if (h === 0) h = 12;
        }
        return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
      }

      // Default buffer (stored in data)
      var bufferMin = data.pickupBuffer || 20;

      // Count members in a group
      function groupSize(groupKey, plan) {
        var count = 0;
        Object.keys(plan).forEach(function(uid) { if (plan[uid] === groupKey) count++; });
        return count;
      }

      // --- Arrivals ---
      var arrFlyers = flyers.slice().sort(function(a, b) {
        var aApt = (a.arriveAirport || '').toUpperCase();
        var bApt = (b.arriveAirport || '').toUpperCase();
        if (aApt !== bApt) return aApt.localeCompare(bApt);
        var aK = (a.arriveDate || '') + (a.arriveTime || '');
        var bK = (b.arriveDate || '') + (b.arriveTime || '');
        return aK.localeCompare(bK);
      });
      var arrColorMap = buildColorMap(pickup);
      var pickupTimes = data.pickupTimes || {};

      // Pre-calculate pickup time per group
      var arrKeys = getGroupKeys(pickup);
      var arrGroupTime = {};
      arrKeys.forEach(function(k) {
        var earliestMs = getEarliestMs(k, pickup, arrFlyers, 'arriveDate', 'arriveTime');
        var recommendedMs = earliestMs + bufferMin * 60 * 1000;
        arrGroupTime[k] = pickupTimes[k] || msToTimeInput(recommendedMs);
      });

      var html = '<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">';
      html += '<h4 style="margin:0;font-size:0.92rem;">✈️ Arrivals</h4>';
      html += '<label style="font-size:0.78rem;color:var(--text-light);display:flex;align-items:center;gap:4px;">Buffer: <input type="number" id="tp-buffer" class="input-field" value="' + bufferMin + '" min="0" max="120" style="width:50px;font-size:0.78rem;padding:2px 4px;"> min</label>';
      html += '</div>';
      html += '<table class="wb-sched-table" style="font-size:0.82rem;table-layout:auto;"><thead><tr>';
      html += '<th>Airport</th><th>Arrival</th><th>Flyer</th><th>Pickup</th><th>Pickup At</th>';
      html += '</tr></thead><tbody>';
      var shownArrGroup = {};
      arrFlyers.forEach(function(f) {
        var val = pickup[f.userId] || '';
        var ci = val ? arrColorMap[val] : undefined;
        var hasColor = ci !== undefined;
        var color = hasColor ? groupColors[ci % groupColors.length] : '';
        var bg = hasColor ? groupBgs[ci % groupBgs.length] : '';
        html += '<tr style="' + (color ? 'border-left:4px solid ' + color + ';background:' + bg + ';' : '') + '">';
        html += '<td><strong>' + esc(f.arriveAirport || '—') + '</strong></td>';
        html += '<td style="white-space:nowrap;">' + formatDate(f.arriveDate) + ' ' + formatTime(f.arriveTime) + '</td>';
        html += '<td>' + esc(f.name) + '</td>';
        html += '<td><select class="input-field tp-pickup" data-uid="' + f.userId + '" style="font-size:0.8rem;padding:2px 4px;">' + buildOpts(pickup, val) + '</select></td>';
        if (val && !shownArrGroup[val]) {
          var size = groupSize(val, pickup);
          html += '<td rowspan="' + size + '" style="vertical-align:middle;text-align:center;">';
          html += '<input type="text" class="input-field tp-pickup-time" data-group="' + esc(val) + '" value="' + (arrGroupTime[val] || '') + '" placeholder="e.g. 9:30 AM" style="font-size:0.8rem;padding:2px 4px;width:100px;">';
          html += '</td>';
          shownArrGroup[val] = true;
        } else if (!val) {
          html += '<td style="color:var(--text-light);text-align:center;">—</td>';
        }
        html += '</tr>';
      });
      html += '</tbody></table>';

      // --- Departures ---
      var depFlyers = flyers.slice().sort(function(a, b) {
        var aApt = (a.departAirport || '').toUpperCase();
        var bApt = (b.departAirport || '').toUpperCase();
        if (aApt !== bApt) return aApt.localeCompare(bApt);
        var aK = (a.departDate || '') + (a.departTime || '');
        var bK = (b.departDate || '') + (b.departTime || '');
        return aK.localeCompare(bK);
      });
      var depColorMap = buildColorMap(dropoff);
      var dropoffTimes = data.dropoffTimes || {};

      var depKeys = getGroupKeys(dropoff);
      var depGroupTime = {};
      depKeys.forEach(function(k) {
        var earliestMs = getEarliestMs(k, dropoff, depFlyers, 'departDate', 'departTime');
        var leaveMs = earliestMs - 120 * 60 * 1000;
        depGroupTime[k] = dropoffTimes[k] || msToTimeInput(leaveMs);
      });

      html += '<h4 style="margin:1.25rem 0 0.4rem;font-size:0.92rem;">✈️ Departures</h4>';
      html += '<table class="wb-sched-table" style="font-size:0.82rem;table-layout:auto;"><thead><tr>';
      html += '<th>Airport</th><th>Departure</th><th>Flyer</th><th>Dropoff</th><th>Leave By</th>';
      html += '</tr></thead><tbody>';
      var shownDepGroup = {};
      depFlyers.forEach(function(f) {
        var val = dropoff[f.userId] || '';
        var ci = val ? depColorMap[val] : undefined;
        var hasColor = ci !== undefined;
        var color = hasColor ? groupColors[ci % groupColors.length] : '';
        var bg = hasColor ? groupBgs[ci % groupBgs.length] : '';
        html += '<tr style="' + (color ? 'border-left:4px solid ' + color + ';background:' + bg + ';' : '') + '">';
        html += '<td><strong>' + esc(f.departAirport || '—') + '</strong></td>';
        html += '<td style="white-space:nowrap;">' + formatDate(f.departDate) + ' ' + formatTime(f.departTime) + '</td>';
        html += '<td>' + esc(f.name) + '</td>';
        html += '<td><select class="input-field tp-dropoff" data-uid="' + f.userId + '" style="font-size:0.8rem;padding:2px 4px;">' + buildOpts(dropoff, val) + '</select></td>';
        if (val && !shownDepGroup[val]) {
          var size = groupSize(val, dropoff);
          html += '<td rowspan="' + size + '" style="vertical-align:middle;text-align:center;">';
          html += '<input type="text" class="input-field tp-dropoff-time" data-group="' + esc(val) + '" value="' + (depGroupTime[val] || '') + '" placeholder="e.g. 2:00 PM" style="font-size:0.8rem;padding:2px 4px;width:100px;">';
          html += '</td>';
          shownDepGroup[val] = true;
        } else if (!val) {
          html += '<td style="color:var(--text-light);text-align:center;">—</td>';
        }
        html += '</tr>';
      });
      html += '</tbody></table>';

      if (drivers.length === 0 && flyers.length > 0) {
        html += '<p style="font-size:0.82rem;color:var(--warning);margin-top:0.5rem;">⚠ No drivers yet. Drivers appear once someone submits "Driving".</p>';
      }

      groupsDiv.innerHTML = html;

      // Wire pickup selects
      groupsDiv.querySelectorAll('.tp-pickup').forEach(function(sel) {
        sel.addEventListener('change', function() {
          var d = loadData();
          if (!d.pickupPlan) d.pickupPlan = {};
          if (sel.value) {
            // Enforce max 3 per group
            var count = groupSize(sel.value, d.pickupPlan);
            if (count >= 3) { alert('Max 3 per group.'); renderTravelGroups(); return; }
          }
          d.pickupPlan[sel.dataset.uid] = sel.value;
          saveData(d);
          renderTravelGroups();
        });
      });

      // Wire dropoff selects
      groupsDiv.querySelectorAll('.tp-dropoff').forEach(function(sel) {
        sel.addEventListener('change', function() {
          var d = loadData();
          if (!d.dropoffPlan) d.dropoffPlan = {};
          if (sel.value) {
            var count = groupSize(sel.value, d.dropoffPlan);
            if (count >= 3) { alert('Max 3 per group.'); renderTravelGroups(); return; }
          }
          d.dropoffPlan[sel.dataset.uid] = sel.value;
          saveData(d);
          renderTravelGroups();
        });
      });

      // Wire buffer input
      var bufferInput = document.getElementById('tp-buffer');
      if (bufferInput) {
        bufferInput.addEventListener('change', function() {
          var d = loadData();
          d.pickupBuffer = parseInt(bufferInput.value, 10) || 20;
          // Clear per-group overrides so they recalculate with new buffer
          d.pickupTimes = {};
          saveData(d);
          renderTravelGroups();
        });
      }

      // Wire per-group pickup time inputs (normalize on blur)
      groupsDiv.querySelectorAll('.tp-pickup-time').forEach(function(inp) {
        inp.addEventListener('blur', function() {
          var normalized = parseTimeStr(inp.value);
          inp.value = normalized;
          var d = loadData();
          if (!d.pickupTimes) d.pickupTimes = {};
          d.pickupTimes[inp.dataset.group] = normalized;
          saveData(d);
        });
      });

      // Wire per-group dropoff (leave-by) time inputs (normalize on blur)
      groupsDiv.querySelectorAll('.tp-dropoff-time').forEach(function(inp) {
        inp.addEventListener('blur', function() {
          var normalized = parseTimeStr(inp.value);
          inp.value = normalized;
          var d = loadData();
          if (!d.dropoffTimes) d.dropoffTimes = {};
          d.dropoffTimes[inp.dataset.group] = normalized;
          saveData(d);
        });
      });
    }

    // Auto-assign: cluster by time (45-min, max 3), drivers get largest clusters, rest = numbered Uber Pools
    if (autoGroupBtn) autoGroupBtn.addEventListener('click', function() {
      var data = loadData();
      var flyers = getFlyers();
      var drivers = getDrivers();

      // Check if all assigned users have submitted their survey
      var notSubmitted = [];
      (data.assignments || []).forEach(function(a) {
        var r = data.responses[a.userId];
        if (!r || !r.mode) notSubmitted.push(a.name);
      });
      if (notSubmitted.length > 0) {
        var proceed = confirm('⚠️ ' + notSubmitted.length + ' reviewer(s) have NOT submitted their travel survey:\n\n• ' + notSubmitted.join('\n• ') + '\n\nDo you want to auto-group anyway?');
        if (!proceed) return;
      }

      if (flyers.length === 0) { alert('No flight responses yet.'); return; }

      function buildPlan(flyerList, dateKey, timeKey, airportKey) {
        // Group by airport first, then cluster by time within each airport
        var byAirport = {};
        flyerList.forEach(function(f) {
          var apt = (f[airportKey] || '').toUpperCase() || '_NONE_';
          if (!byAirport[apt]) byAirport[apt] = [];
          byAirport[apt].push(f);
        });

        var allBuckets = [];
        Object.keys(byAirport).forEach(function(apt) {
          var sorted = byAirport[apt].slice().sort(function(a, b) {
            return ((a[dateKey] || '') + (a[timeKey] || '')).localeCompare((b[dateKey] || '') + (b[timeKey] || ''));
          });
          function getMs(f) {
            return new Date((f[dateKey] || '2000-01-01') + 'T' + (f[timeKey] || '00:00')).getTime();
          }
          // Cluster within same airport: ≤45 min apart, max 3 per group
          var cur = [];
          sorted.forEach(function(f) {
            if (!cur.length) { cur.push(f); return; }
            if (Math.abs(getMs(f) - getMs(cur[0])) <= 45 * 60 * 1000 && cur.length < 3) {
              cur.push(f);
            } else { allBuckets.push(cur); cur = [f]; }
          });
          if (cur.length) allBuckets.push(cur);
        });

        // Sort largest-first so drivers grab biggest groups
        allBuckets.sort(function(a, b) { return b.length - a.length; });

        var plan = {};
        var driverUsage = {};
        drivers.forEach(function(d) { driverUsage[d.userId] = 0; });
        var uberNum = 1;

        allBuckets.forEach(function(bucket) {
          var assignedKey = '';
          if (drivers.length > 0) {
            var best = null;
            drivers.forEach(function(d) {
              if (!best || (driverUsage[d.userId] || 0) < (driverUsage[best.userId] || 0)) best = d;
            });
            var totalBuckets = allBuckets.length;
            if (!((driverUsage[best.userId] || 0) > 0 && bucket.length === 1 && totalBuckets > drivers.length)) {
              var tripNum = (driverUsage[best.userId] || 0) + 1;
              assignedKey = tripNum === 1 ? best.userId : best.userId + '-trip-' + tripNum;
              driverUsage[best.userId] = tripNum;
            }
          }
          if (!assignedKey) {
            assignedKey = 'uber-' + uberNum;
            uberNum++;
          }
          bucket.forEach(function(f) { plan[f.userId] = assignedKey; });
        });
        return plan;
      }

      var pickupPlan = buildPlan(flyers, 'arriveDate', 'arriveTime', 'arriveAirport');
      var dropoffPlan = buildPlan(flyers, 'departDate', 'departTime', 'departAirport');

      var data = loadData();
      data.pickupPlan = pickupPlan;
      data.dropoffPlan = dropoffPlan;
      delete data.travelGroups;
      delete data.arrivalGroups;
      delete data.departureGroups;
      saveData(data);
      renderTravelGroups();
    });

    // Initial render
    renderAssignedList();
    renderRollup();
    renderTravelGroups();
  }

  // ============================================================
  //  INIT
  // ============================================================
  initReviewerForm();
  initTeamLeadPanel();
})();
