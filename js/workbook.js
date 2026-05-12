/**
 * workbook.js — Workbook Lead Dashboard
 *
 * Handles:
 *  - Reviewer submission status rollup
 *  - Clerk TACS paste-and-parse
 *  - Mail Handler TACS paste-and-parse
 *  - DUT / POBUT input with autosave
 *  - CSAW Hours input with autosave
 */
(function() {
  'use strict';

  // --- Guard: only run for lead role ---
  var setup = {};
  try { setup = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) {}
  if (setup.reviewRole !== 'lead' && setup.reviewRole !== 'teamlead') return;

  var reviewId = setup.reviewId || '';
  var financeNum = setup.financeNum || '';
  var WB_KEY = 'clerk_obs_workbook_' + reviewId + (financeNum ? '_' + financeNum : '');

  // ---------- Helpers ----------

  /** Convert TACS hundredths time to HH:MM string */
  function hundredthsToTime(h) {
    var hrs = Math.floor(h);
    var mins = Math.round((h - hrs) * 60);
    return String(hrs).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
  }

  /** Convert Excel serial date to YYYY-MM-DD */
  function excelDateToISO(serial) {
    // Excel epoch: 1899-12-30
    var epoch = new Date(1899, 11, 30);
    var d = new Date(epoch.getTime() + serial * 86400000);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ---------- Load / Save ----------

  function loadData() {
    try { return JSON.parse(localStorage.getItem(WB_KEY)) || {}; } catch(e) { return {}; }
  }
  function saveData(data) {
    localStorage.setItem(WB_KEY, JSON.stringify(data));
  }

  // ---------- Reviewer Status ----------

  var statusContainer = document.getElementById('wb-reviewer-status');
  var statusEmpty = document.getElementById('wb-reviewer-empty');
  var refreshBtn = document.getElementById('wb-refresh-status');

  function loadReviewerStatus() {
    if (!reviewId || !statusContainer) return;
    var rev = Reviews.getById(reviewId);
    if (!rev) { statusContainer.innerHTML = '<p class="empty-state">Review not found.</p>'; return; }

    var allObs = Storage.getAll();
    var reviewObs = allObs.filter(function(o) {
      return o.reviewId === reviewId || (Reviews.hasOffice(rev, o.financeNum) && o.date >= rev.startDate && o.date <= rev.endDate);
    });

    var html = '<table class="wb-status-table"><thead><tr>' +
      '<th>Reviewer</th><th>Role</th><th>Day 1</th><th>Day 2</th><th>Errors</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    var assignments = rev.assignments || [];
    if (assignments.length === 0) {
      statusContainer.innerHTML = '<p class="empty-state">No reviewers assigned.</p>';
      if (statusEmpty) statusEmpty.hidden = true;
      return;
    }

    assignments.forEach(function(a) {
      var user = Auth.getUserById(a.userId);
      var name = user ? (user.displayName || user.username) : a.userId;
      var role = a.reviewRole || '—';
      var roleLabel = { clerk: 'Clerk', mailhandler: 'Mail Handler', lead: 'Workbook Lead', teamlead: 'Review Lead' };

      var userObs = reviewObs.filter(function(o) { return o.userId === a.userId; });

      // Leadership (lead/teamlead) only shown if they have observations
      var isLeadership = (role === 'lead' || role === 'teamlead');
      if (isLeadership && userObs.length === 0) return;

      var d1 = userObs.filter(function(o) { return o.dayNumber === '1'; });
      var d2 = userObs.filter(function(o) { return o.dayNumber === '2'; });

      function dayCell(dayObs, dayNum) {
        var clickAttr = ' class="wb-status-link" data-uid="' + esc(a.userId) + '" data-day="' + dayNum + '" data-role="' + esc(a.reviewRole || '') + '" data-name="' + esc(name) + '"';
        // Leadership with no obs for this day = N/A (optional)
        if (isLeadership && dayObs.length === 0) return '<span class="wb-status-none" style="opacity:0.5;">Optional</span>';
        if (dayObs.length === 0) return '<span' + clickAttr + ' style="cursor:pointer;text-decoration:underline dotted;color:var(--text-light);">Not Started</span>';
        var obs = dayObs[0];
        if (obs.status === 'submitted') return '<span' + clickAttr + ' style="cursor:pointer;text-decoration:underline dotted;"><span class="wb-status-submitted">✓ Submitted</span></span>';
        return '<span' + clickAttr + ' style="cursor:pointer;text-decoration:underline dotted;"><span class="wb-status-draft">⏳ Draft</span></span>';
      }

      // Count rows with errors (missing quality on non-exempt)
      var errorCount = 0;
      userObs.forEach(function(obs) {
        if (!obs.rows) return;
        obs.rows.forEach(function(r) {
          if (!r.workQuality && r.ldc && r.beginTime) errorCount++;
        });
      });

      // Build action buttons
      var actions = '';
      var isMH = (a.reviewRole === 'mailhandler');
      if (!isLeadership) {
        if (d1.length > 0) {
          actions += '<a class="btn btn-outline btn-xs wb-status-link" data-uid="' + esc(a.userId) + '" data-day="1" data-role="' + esc(a.reviewRole || '') + '" data-name="' + esc(name) + '" style="cursor:pointer;margin-right:4px;font-size:0.72rem;">D1</a>';
        }
        if (d2.length > 0) {
          actions += '<a class="btn btn-outline btn-xs wb-status-link" data-uid="' + esc(a.userId) + '" data-day="2" data-role="' + esc(a.reviewRole || '') + '" data-name="' + esc(name) + '" style="cursor:pointer;font-size:0.72rem;">D2</a>';
        }
        if (d1.length === 0 && d2.length === 0) actions = '<span style="color:var(--text-light);">—</span>';
      } else {
        actions = '<span style="color:var(--text-light);">—</span>';
      }

      html += '<tr>' +
        '<td>' + esc(name) + '</td>' +
        '<td><span class="wb-role-badge wb-role-' + (a.reviewRole || 'none') + '">' + esc(roleLabel[role] || role) + '</span></td>' +
        '<td>' + dayCell(d1, '1') + '</td>' +
        '<td>' + dayCell(d2, '2') + '</td>' +
        '<td>' + (errorCount > 0 ? '<span class="wb-error-count">' + errorCount + '</span>' : '—') + '</td>' +
        '<td>' + actions + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    statusContainer.innerHTML = html;
    if (statusEmpty) statusEmpty.hidden = true;

    // Bind click handlers for status links
    statusContainer.querySelectorAll('.wb-status-link').forEach(function(link) {
      link.addEventListener('click', function() {
        var uid = link.dataset.uid;
        var day = link.dataset.day;
        var role = link.dataset.role;
        var name = link.dataset.name;
        launchReviewerView(uid, day, role, name);
      });
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadReviewerStatus);
  }

  // ---------- Review Notes (Lead Day 1 / Day 2) ----------

  var myNotesOfficeEl = document.getElementById('wb-mynotes-office');
  var myNotesStatusEl = document.getElementById('wb-mynotes-status');
  var myNotesDay1Btn = document.getElementById('wb-mynotes-day1');
  var myNotesDay2Btn = document.getElementById('wb-mynotes-day2');

  function refreshMyNotes() {
    if (!myNotesOfficeEl) return;
    var currentSetup = {};
    try { currentSetup = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) {}
    var office = currentSetup.office || '';
    var fin = currentSetup.financeNum || '';
    myNotesOfficeEl.textContent = office ? office + (fin ? ' (' + fin + ')' : '') : '— select an office above —';

    // Check existing observations for this user
    var allObs = [];
    try { allObs = JSON.parse(localStorage.getItem('timeTracker_observations')) || []; } catch(e) {}
    var sess = {};
    try { sess = JSON.parse(localStorage.getItem('clerk_obs_session')) || {}; } catch(e) {}
    var userId = sess.userId || '';

    var d1 = allObs.filter(function(o) { return o.reviewId === reviewId && o.userId === userId && String(o.dayNumber) === '1'; });
    var d2 = allObs.filter(function(o) { return o.reviewId === reviewId && o.userId === userId && String(o.dayNumber) === '2'; });

    var html = '';
    if (d1.length > 0) {
      var obs1 = d1[0];
      var s1 = obs1.status === 'submitted' ? '<span style="color:#16a34a;font-weight:600;">✓ Submitted</span>' : '<span style="color:#d97706;font-weight:600;">⏳ Draft</span>';
      html += '<div style="font-size:0.85rem;margin-bottom:0.35rem;">Day 1: ' + s1 + ' · ' + (obs1.rows ? obs1.rows.length : 0) + ' entries</div>';
      if (myNotesDay1Btn) { myNotesDay1Btn.textContent = 'Edit Day 1'; myNotesDay1Btn.className = 'btn btn-outline btn-sm'; }
    } else {
      html += '<div style="font-size:0.85rem;margin-bottom:0.35rem;color:var(--text-light);">Day 1: Not started</div>';
      if (myNotesDay1Btn) { myNotesDay1Btn.textContent = 'Start Day 1'; myNotesDay1Btn.className = 'btn btn-primary btn-sm'; }
    }
    if (d2.length > 0) {
      var obs2 = d2[0];
      var s2 = obs2.status === 'submitted' ? '<span style="color:#16a34a;font-weight:600;">✓ Submitted</span>' : '<span style="color:#d97706;font-weight:600;">⏳ Draft</span>';
      html += '<div style="font-size:0.85rem;">Day 2: ' + s2 + ' · ' + (obs2.rows ? obs2.rows.length : 0) + ' entries</div>';
      if (myNotesDay2Btn) { myNotesDay2Btn.textContent = 'Edit Day 2'; myNotesDay2Btn.className = 'btn btn-outline btn-sm'; }
    } else {
      html += '<div style="font-size:0.85rem;color:var(--text-light);">Day 2: Not started</div>';
      if (myNotesDay2Btn) { myNotesDay2Btn.textContent = 'Start Day 2'; myNotesDay2Btn.className = 'btn btn-outline btn-sm'; }
    }
    if (myNotesStatusEl) myNotesStatusEl.innerHTML = html;

    // --- Clerk Notes by Reviewer ---
    var clerkListEl = document.getElementById('wb-mynotes-clerk-list');
    var clerkEmptyEl = document.getElementById('wb-mynotes-clerk-empty');
    if (clerkListEl) {
      var clerkObs = allObs.filter(function(o) {
        return o.reviewId === reviewId && (o.reviewRole === 'clerk' || (!o.reviewRole && !o.employeeName));
      });
      // Group by reviewer (userId)
      var byReviewer = {};
      clerkObs.forEach(function(o) {
        var key = o.userId || o.observerName || 'unknown';
        if (!byReviewer[key]) byReviewer[key] = { name: o.observerName || key, obs: [] };
        byReviewer[key].obs.push(o);
      });
      var reviewerKeys = Object.keys(byReviewer).sort(function(a, b) {
        return byReviewer[a].name.localeCompare(byReviewer[b].name);
      });

      if (reviewerKeys.length === 0) {
        clerkListEl.innerHTML = '';
        if (clerkEmptyEl) clerkEmptyEl.hidden = false;
      } else {
        if (clerkEmptyEl) clerkEmptyEl.hidden = true;
        var clHtml = '<div style="display:flex;flex-direction:column;gap:0.4rem;">';
        reviewerKeys.forEach(function(key) {
          var reviewer = byReviewer[key];
          var obs = reviewer.obs;
          var d1r = obs.filter(function(o) { return String(o.dayNumber) === '1'; });
          var d2r = obs.filter(function(o) { return String(o.dayNumber) === '2'; });
          var totalRows = 0;
          obs.forEach(function(o) { totalRows += (o.rows ? o.rows.length : 0); });
          var isMe = (key === userId);

          function clerkDayInfo(dayObs, dayLabel) {
            if (dayObs.length === 0) return '<span style="color:var(--text-light);">' + dayLabel + ': —</span>';
            var o = dayObs[0];
            var rc = o.rows ? o.rows.length : 0;
            if (o.status === 'submitted') return '<span style="color:#16a34a;font-weight:600;">' + dayLabel + ': ✓ ' + rc + ' entries</span>';
            return '<span style="color:#d97706;font-weight:600;">' + dayLabel + ': ⏳ ' + rc + ' entries</span>';
          }

          // Determine office for this reviewer
          var obsOffice = obs[0].office || '';

          clHtml += '<div class="wb-clerk-reviewer-card" data-reviewer-id="' + esc(key) + '" style="display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);cursor:pointer;transition:all 0.15s;">';
          clHtml += '<div style="width:2rem;height:2rem;border-radius:50%;background:' + (isMe ? '#dbeafe' : '#f3f4f6') + ';display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;color:' + (isMe ? '#1d4ed8' : 'var(--text-light)') + ';flex-shrink:0;">' + esc(reviewer.name.charAt(0).toUpperCase()) + '</div>';
          clHtml += '<div style="flex:1;min-width:0;">';
          clHtml += '<div style="font-weight:700;font-size:0.88rem;">' + esc(reviewer.name) + (isMe ? ' <span style="font-size:0.72rem;color:#1d4ed8;font-weight:600;">(You)</span>' : '') + '</div>';
          clHtml += '<div style="font-size:0.78rem;color:var(--text-light);">' + (obsOffice ? esc(obsOffice) + ' · ' : '') + totalRows + ' total entries</div>';
          clHtml += '</div>';
          clHtml += '<div style="display:flex;flex-direction:column;gap:0.15rem;flex-shrink:0;font-size:0.78rem;text-align:right;">';
          clHtml += clerkDayInfo(d1r, 'D1');
          clHtml += clerkDayInfo(d2r, 'D2');
          clHtml += '</div>';
          clHtml += '</div>';
        });
        clHtml += '</div>';
        clerkListEl.innerHTML = clHtml;

        // Click to view — read-only preview in a modal-like overlay
        clerkListEl.querySelectorAll('.wb-clerk-reviewer-card').forEach(function(card) {
          card.addEventListener('click', function() {
            var rId = card.dataset.reviewerId;
            var reviewer = byReviewer[rId];
            if (!reviewer) return;
            showClerkNotesPreview(reviewer.name, reviewer.obs);
          });
          card.addEventListener('mouseenter', function() { card.style.borderColor = '#4f46e5'; card.style.background = 'rgba(79,70,229,0.04)'; });
          card.addEventListener('mouseleave', function() { card.style.borderColor = ''; card.style.background = ''; });
        });
      }
    }

    // --- MH Notes by Employee ---
    var mhListEl = document.getElementById('wb-mynotes-mh-list');
    var mhEmptyEl = document.getElementById('wb-mynotes-mh-empty');
    var mhSection = document.getElementById('wb-mynotes-mh-section');
    var mhSelect = document.getElementById('wb-mynotes-mh-select');
    var mhGoBtn = document.getElementById('wb-mynotes-mh-go');

    // Get MH employees from roster
    var MH_DA = [120, 320, 820, 420];
    var currentFin = (currentSetup.financeNum || financeNum || '');
    var wbKey2 = 'clerk_obs_workbook_' + reviewId + (currentFin ? '_' + currentFin : '');
    var wbData2 = {};
    try { wbData2 = JSON.parse(localStorage.getItem(wbKey2)) || {}; } catch(e) {}
    var roster = wbData2.roster || [];
    var rosterMhNames = [];
    roster.forEach(function(emp) {
      var da = parseInt(emp.daCode, 10);
      if (MH_DA.indexOf(da) !== -1) {
        var name = ((emp.first || '') + ' ' + (emp.last || '')).trim();
        if (name && rosterMhNames.indexOf(name) === -1) rosterMhNames.push(name);
      }
    });
    rosterMhNames.sort();

    // Hide entire MH section if no MHs in roster
    if (mhSection) {
      mhSection.style.display = rosterMhNames.length > 0 ? '' : 'none';
    }

    // Get current user + MH slots for access checks
    var _mhUser = (typeof MhAccess !== 'undefined') ? MhAccess.getCurrentUser() : null;
    var _mhUserId = _mhUser ? _mhUser.id : '';
    var _mhUserName = _mhUser ? (_mhUser.displayName || _mhUser.username || '') : '';
    var _mhSlots = (typeof MhAccess !== 'undefined') ? MhAccess.getMhSlots(reviewId) : [];
    var _isLeadRole = (currentSetup.reviewRole === 'lead' || currentSetup.reviewRole === 'teamlead');
    var _isSystemLead = _mhUser && (_mhUser.role === 'admin' || _mhUser.role === 'teamlead');
    var _canManageAccess = _isLeadRole || _isSystemLead;

    // Build assignment lookup: mhName -> assignedTo display name
    var _mhAssignMap = {};
    _mhSlots.forEach(function(s) { _mhAssignMap[s.mhName] = s.assignedTo || ''; });

    if (mhListEl && rosterMhNames.length > 0) {
      var mhObs = allObs.filter(function(o) {
        return o.reviewId === reviewId && o.reviewRole === 'mailhandler' && o.employeeName;
      });
      // Group by employee name
      var byEmp = {};
      mhObs.forEach(function(o) {
        var name = o.employeeName.trim();
        if (!byEmp[name]) byEmp[name] = [];
        byEmp[name].push(o);
      });
      var startedNames = Object.keys(byEmp).sort();

      // Populate dropdown with MHs that have NO observations yet
      if (mhSelect) {
        mhSelect.innerHTML = '<option value="">— Start new MH —</option>';
        var unstartedCount = 0;
        rosterMhNames.forEach(function(name) {
          if (!byEmp[name]) {
            mhSelect.innerHTML += '<option value="' + esc(name) + '">' + esc(name) + '</option>';
            unstartedCount++;
          }
        });
        mhSelect.disabled = (unstartedCount === 0);
        if (unstartedCount === 0) {
          mhSelect.innerHTML = '<option value="">All MHs started</option>';
        }
      }
      if (mhGoBtn && mhSelect) {
        mhGoBtn.disabled = true;
        mhSelect.onchange = function() { mhGoBtn.disabled = !mhSelect.value; };
        mhGoBtn.onclick = function() {
          if (!mhSelect.value) return;
          var day = prompt('Which day for ' + mhSelect.value + '? Enter 1 or 2:', '1');
          if (day !== '1' && day !== '2') return;
          launchMhDay(mhSelect.value, parseInt(day));
        };
      }

      // --- Pending MH Access Requests (for leads) ---
      var pendingReqs = (typeof MhAccess !== 'undefined') ? MhAccess.getAllPendingRequests(reviewId) : [];
      if (_canManageAccess && pendingReqs.length > 0) {
        var reqHtml = '<div style="margin-bottom:0.75rem;padding:0.65rem 0.75rem;background:#fef3c7;border:1px solid #fcd34d;border-radius:var(--radius);">';
        reqHtml += '<div style="font-weight:700;font-size:0.82rem;margin-bottom:0.35rem;">🔔 Pending MH Access Requests (' + pendingReqs.length + ')</div>';
        pendingReqs.forEach(function(req) {
          reqHtml += '<div class="mh-access-req-row" style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;border-bottom:1px solid #fde68a;flex-wrap:wrap;">';
          reqHtml += '<span style="font-size:0.8rem;flex:1;min-width:0;"><strong>' + esc(req.userName) + '</strong> → ' + esc(req.mhName) + '</span>';
          reqHtml += '<button class="btn btn-sm mh-req-approve" data-req-id="' + req.id + '" style="background:#22c55e;color:#fff;border:none;font-size:0.68rem;padding:0.15rem 0.5rem;">✓ Approve</button>';
          reqHtml += '<button class="btn btn-sm mh-req-deny" data-req-id="' + req.id + '" style="background:#ef4444;color:#fff;border:none;font-size:0.68rem;padding:0.15rem 0.5rem;">✕ Deny</button>';
          reqHtml += '</div>';
        });
        reqHtml += '</div>';
        mhListEl.insertAdjacentHTML('beforebegin', reqHtml);

        // Wire approve/deny buttons
        var parentSection = mhListEl.parentElement;
        if (parentSection) {
          parentSection.querySelectorAll('.mh-req-approve').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              MhAccess.approveRequest(reviewId, btn.dataset.reqId, _mhUserName);
              refreshMyNotes();
            });
          });
          parentSection.querySelectorAll('.mh-req-deny').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              MhAccess.denyRequest(reviewId, btn.dataset.reqId, _mhUserName);
              refreshMyNotes();
            });
          });
        }
      }

      if (startedNames.length === 0) {
        mhListEl.innerHTML = '';
        if (mhEmptyEl) mhEmptyEl.hidden = false;
      } else {
        if (mhEmptyEl) mhEmptyEl.hidden = true;
        var mhHtml = '<div style="display:flex;flex-direction:column;gap:0.4rem;">';
        startedNames.forEach(function(name) {
          var obs = byEmp[name];
          var d1obs = obs.filter(function(o) { return String(o.dayNumber) === '1'; });
          var d2obs = obs.filter(function(o) { return String(o.dayNumber) === '2'; });
          var rowCount = 0;
          obs.forEach(function(o) { rowCount += (o.rows ? o.rows.length : 0); });
          var observers = {};
          obs.forEach(function(o) { if (o.observerName) observers[o.observerName] = true; });
          var obsList = Object.keys(observers).join(', ');
          var assigned = _mhAssignMap[name] || '';

          function dayBadge(dayObs) {
            if (dayObs.length === 0) return '<span style="color:var(--text-light);font-size:0.78rem;">—</span>';
            var o = dayObs[0];
            if (o.status === 'submitted') return '<span style="color:#16a34a;font-size:0.78rem;font-weight:600;">✓</span>';
            return '<span style="color:#d97706;font-size:0.78rem;font-weight:600;">⏳</span>';
          }

          // Check access for non-leads
          var userHasAccess = _canManageAccess || (typeof MhAccess !== 'undefined' && MhAccess.hasAccess(reviewId, _mhUserId, name));
          var hasPendingReq = false;
          if (!userHasAccess && typeof MhAccess !== 'undefined') {
            var pReqs = MhAccess.getPendingRequests(reviewId, name);
            hasPendingReq = pReqs.some(function(r) { return r.userId === _mhUserId; });
          }

          mhHtml += '<div class="mh-emp-card" data-mh-emp="' + esc(name) + '" data-has-access="' + (userHasAccess ? '1' : '0') + '" style="display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);' + (userHasAccess ? 'cursor:pointer;' : '') + 'transition:all 0.15s;">';
          mhHtml += '<div style="flex:1;min-width:0;">';
          mhHtml += '<div style="font-weight:700;font-size:0.88rem;">' + esc(name) + '</div>';
          mhHtml += '<div style="font-size:0.78rem;color:var(--text-light);">' + rowCount + ' entries · By: ' + esc(obsList) + '</div>';
          if (assigned) {
            mhHtml += '<div style="font-size:0.72rem;color:var(--text-light);margin-top:2px;">Assigned: <strong>' + esc(assigned) + '</strong></div>';
          }
          mhHtml += '</div>';

          // Right side: day badges + request button
          mhHtml += '<div style="display:flex;gap:0.6rem;align-items:center;flex-shrink:0;">';
          if (!userHasAccess && !hasPendingReq) {
            mhHtml += '<button class="btn btn-outline btn-sm mh-request-access-btn" data-mh-name="' + esc(name) + '" style="font-size:0.68rem;padding:0.15rem 0.5rem;color:#7c3aed;border-color:#7c3aed;" title="Request access to follow this MH">Request</button>';
          } else if (hasPendingReq) {
            mhHtml += '<span style="font-size:0.68rem;color:#d97706;font-weight:600;">⏳ Pending</span>';
          }
          mhHtml += '<div style="text-align:center;"><div style="font-size:0.65rem;color:var(--text-light);font-weight:600;">D1</div>' + dayBadge(d1obs) + '</div>';
          mhHtml += '<div style="text-align:center;"><div style="font-size:0.65rem;color:var(--text-light);font-weight:600;">D2</div>' + dayBadge(d2obs) + '</div>';
          mhHtml += '</div>';
          mhHtml += '</div>';
        });
        mhHtml += '</div>';
        mhListEl.innerHTML = mhHtml;

        // Click handlers — only for users with access
        mhListEl.querySelectorAll('[data-mh-emp]').forEach(function(card) {
          if (card.dataset.hasAccess === '1') {
            card.addEventListener('click', function() {
              var empName = card.dataset.mhEmp;
              var day = prompt('Open MH notes for ' + empName + '\n\nEnter day number (1 or 2):', '1');
              if (day !== '1' && day !== '2') return;
              launchMhDay(empName, parseInt(day));
            });
            card.addEventListener('mouseenter', function() { card.style.borderColor = '#7c3aed'; card.style.background = 'rgba(124,58,237,0.04)'; });
            card.addEventListener('mouseleave', function() { card.style.borderColor = ''; card.style.background = ''; });
          }
        });

        // Request Access buttons
        mhListEl.querySelectorAll('.mh-request-access-btn').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var mhName = btn.dataset.mhName;
            if (!confirm('Request access to follow ' + mhName + '?')) return;
            var ok = MhAccess.submitAccessRequest(reviewId, _mhUserId, _mhUserName, mhName);
            if (ok) {
              btn.outerHTML = '<span style="font-size:0.68rem;color:#d97706;font-weight:600;">⏳ Pending</span>';
            } else {
              alert('You already have a pending request for this MH.');
            }
          });
        });
      }
    }
  }
  function showClerkNotesPreview(reviewerName, observations) {
    // Remove existing overlay if any
    var existing = document.getElementById('wb-notes-preview-overlay');
    if (existing) existing.remove();

    // Sort by day number
    var sorted = observations.slice().sort(function(a, b) {
      return (parseInt(a.dayNumber) || 0) - (parseInt(b.dayNumber) || 0);
    });

    var overlay = document.createElement('div');
    overlay.id = 'wb-notes-preview-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:var(--card-bg);border-radius:12px;width:95%;max-width:700px;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.25);';

    // Header
    var header = '<div style="padding:1rem 1.25rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--card-bg);z-index:1;border-radius:12px 12px 0 0;">';
    header += '<h3 style="margin:0;font-size:1rem;">📝 ' + esc(reviewerName) + '\'s Clerk Notes</h3>';
    header += '<button id="wb-notes-preview-close" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-light);padding:0 0.2rem;line-height:1;">&times;</button>';
    header += '</div>';

    var body = '<div style="padding:1rem 1.25rem;">';

    sorted.forEach(function(obs) {
      var dayLabel = 'Day ' + (obs.dayNumber || '?');
      var statusBadge = obs.status === 'submitted'
        ? '<span style="background:#dcfce7;color:#166534;padding:0.15rem 0.5rem;border-radius:4px;font-size:0.72rem;font-weight:600;">✓ Submitted</span>'
        : '<span style="background:#fef3c7;color:#92400e;padding:0.15rem 0.5rem;border-radius:4px;font-size:0.72rem;font-weight:600;">⏳ Draft</span>';
      var rows = obs.rows || [];

      body += '<div style="margin-bottom:1.25rem;">';
      body += '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">';
      body += '<span style="font-weight:700;font-size:0.95rem;">' + esc(dayLabel) + '</span> ' + statusBadge;
      body += '<span style="font-size:0.78rem;color:var(--text-light);margin-left:auto;">' + (obs.office || '') + ' · ' + (obs.date || '') + '</span>';
      body += '</div>';

      if (rows.length === 0) {
        body += '<div style="color:var(--text-light);font-size:0.85rem;font-style:italic;">No entries recorded.</div>';
      } else {
        body += '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;">';
        body += '<thead><tr style="background:var(--bg-light);border-bottom:2px solid var(--border);">';
        body += '<th style="padding:0.4rem 0.5rem;text-align:left;font-weight:700;">Time</th>';
        body += '<th style="padding:0.4rem 0.5rem;text-align:left;font-weight:700;">LDC</th>';
        body += '<th style="padding:0.4rem 0.5rem;text-align:left;font-weight:700;">OPN</th>';
        body += '<th style="padding:0.4rem 0.5rem;text-align:center;font-weight:700;">Clerks</th>';
        body += '<th style="padding:0.4rem 0.5rem;text-align:left;font-weight:700;">Quality</th>';
        body += '<th style="padding:0.4rem 0.5rem;text-align:left;font-weight:700;">Description</th>';
        body += '</tr></thead><tbody>';

        rows.forEach(function(r, idx) {
          var bg = idx % 2 === 0 ? 'transparent' : 'var(--bg-light)';
          var time = (r.beginTime || '') + (r.endTime ? ' – ' + r.endTime : '');
          var qualColor = (!r.workQuality || r.workQuality === 'NO CONCERNS') ? 'inherit' : '#dc2626';
          body += '<tr style="background:' + bg + ';border-bottom:1px solid var(--border);">';
          body += '<td style="padding:0.35rem 0.5rem;white-space:nowrap;">' + esc(time) + '</td>';
          body += '<td style="padding:0.35rem 0.5rem;">' + esc(r.ldc || '') + '</td>';
          body += '<td style="padding:0.35rem 0.5rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(r.opn || '') + '">' + esc(r.opn || '') + '</td>';
          body += '<td style="padding:0.35rem 0.5rem;text-align:center;">' + esc(r.totalClerks || '') + '</td>';
          body += '<td style="padding:0.35rem 0.5rem;color:' + qualColor + ';">' + esc(r.workQuality || '') + '</td>';
          body += '<td style="padding:0.35rem 0.5rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(r.workDescription || '') + '">' + esc(r.workDescription || '') + '</td>';
          body += '</tr>';
        });
        body += '</tbody></table>';
        body += '<div style="font-size:0.75rem;color:var(--text-light);margin-top:0.35rem;">' + rows.length + ' entries</div>';
      }
      body += '</div>';
    });

    if (sorted.length === 0) {
      body += '<div style="color:var(--text-light);text-align:center;padding:1rem;">No observations recorded.</div>';
    }

    body += '</div>';
    modal.innerHTML = header + body;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close handlers
    document.getElementById('wb-notes-preview-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  function launchReviewerView(targetUserId, dayNum, role, reviewerName) {
    var currentSetup = {};
    try { currentSetup = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) {}

    // Find the reviewer's observation to get office/finance info
    var allObs = Storage.getAll();
    var targetObs = allObs.filter(function(o) {
      return o.reviewId === reviewId && o.userId === targetUserId && String(o.dayNumber) === String(dayNum);
    });
    var obs = targetObs.length > 0 ? targetObs[0] : null;

    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}

    var office = obs ? (obs.office || '') : (currentSetup.office || '');
    var fin = obs ? (obs.financeNum || '') : (currentSetup.financeNum || '');
    var obsDate = obs ? (obs.date || '') : (currentSetup.date || '');

    // If no date from obs, compute from review start + day offset
    if (!obsDate && rev) {
      var firstOff = (rev.offices && rev.offices.length > 0) ? rev.offices[0] : null;
      var baseDate = (firstOff && firstOff.startDate) ? firstOff.startDate : (rev.startDate || '');
      if (baseDate) {
        var dd = new Date(baseDate + 'T00:00:00');
        var dayOff = (parseInt(dayNum, 10) || 1) - 1;
        if (dayOff > 0) dd.setDate(dd.getDate() + dayOff);
        obsDate = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
      }
    }

    var isMH = (role === 'mailhandler');
    var setupObj = {
      reviewId: reviewId,
      office: office,
      financeNum: fin,
      date: obsDate,
      dayNumber: String(dayNum),
      observerName: reviewerName || '',
      reviewRole: isMH ? 'mailhandler' : 'clerk',
      isLeadUser: true,
      viewingUserId: targetUserId,
      viewingUserName: reviewerName
    };
    if (isMH && obs && obs.employeeName) setupObj.employeeName = obs.employeeName;

    localStorage.setItem('reviewDaySetup', JSON.stringify(setupObj));
    window.location.href = 'review.html?rid=' + encodeURIComponent(reviewId) + '&day=' + dayNum;
  }

  function launchDay(dayNum) {
    var currentSetup = {};
    try { currentSetup = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) {}
    var sess = {};
    try { sess = JSON.parse(localStorage.getItem('clerk_obs_session')) || {}; } catch(e) {}
    var user = {};
    try { user = Auth.getUserById(sess.userId) || {}; } catch(e) {}

    if (!currentSetup.office && !currentSetup.financeNum) {
      alert('Please select an office at the top before starting notes.');
      return;
    }

    // Get the office dates from the review
    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    var officeDate = currentSetup.date || '';
    if (rev && rev.offices) {
      for (var i = 0; i < rev.offices.length; i++) {
        if (rev.offices[i].financeNum === currentSetup.financeNum) {
          officeDate = rev.offices[i].startDate || rev.startDate || officeDate;
          break;
        }
      }
    }

    var setupObj = {
      reviewId: reviewId,
      office: currentSetup.office || '',
      financeNum: currentSetup.financeNum || '',
      date: officeDate,
      dayNumber: String(dayNum),
      observerName: user.displayName || user.username || currentSetup.observerName || '',
      reviewRole: 'clerk',
      isLeadUser: true
    };
    localStorage.setItem('reviewDaySetup', JSON.stringify(setupObj));
    window.location.href = 'review.html?rid=' + encodeURIComponent(reviewId) + '&day=' + dayNum;
  }

  function launchMhDay(empName, dayNum) {
    var currentSetup = {};
    try { currentSetup = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) {}
    var sess = {};
    try { sess = JSON.parse(localStorage.getItem('clerk_obs_session')) || {}; } catch(e) {}
    var user = {};
    try { user = Auth.getUserById(sess.userId) || {}; } catch(e) {}

    if (!currentSetup.office && !currentSetup.financeNum) {
      alert('Please select an office at the top before opening MH notes.');
      return;
    }

    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    var officeDate = currentSetup.date || '';
    if (rev && rev.offices) {
      for (var i = 0; i < rev.offices.length; i++) {
        if (rev.offices[i].financeNum === currentSetup.financeNum) {
          officeDate = rev.offices[i].startDate || rev.startDate || officeDate;
          break;
        }
      }
    }

    var setupObj = {
      reviewId: reviewId,
      office: currentSetup.office || '',
      financeNum: currentSetup.financeNum || '',
      date: officeDate,
      dayNumber: String(dayNum),
      observerName: user.displayName || user.username || currentSetup.observerName || '',
      reviewRole: 'mailhandler',
      employeeName: empName,
      isLeadUser: true
    };
    localStorage.setItem('reviewDaySetup', JSON.stringify(setupObj));
    window.location.href = 'review.html?rid=' + encodeURIComponent(reviewId) + '&day=' + dayNum;
  }

  if (myNotesDay1Btn) myNotesDay1Btn.addEventListener('click', function() { launchDay(1); });
  if (myNotesDay2Btn) myNotesDay2Btn.addEventListener('click', function() { launchDay(2); });

  // Refresh on panel activation
  var myNotesPanel = document.getElementById('wb-panel-mynotes');
  if (myNotesPanel) {
    new MutationObserver(function() {
      if (myNotesPanel.classList.contains('wb-sub-panel--active')) refreshMyNotes();
    }).observe(myNotesPanel, { attributes: true, attributeFilter: ['class'] });
  }

  // ---------- Combined TACS CSV Parser ----------

  var tacsCsvInput = document.getElementById('wb-tacs-csv');
  var tacsClearBtn = document.getElementById('wb-tacs-clear');
  var tacsOutput = document.getElementById('wb-tacs-output');

  function parseTacsCsv(text) {
    var lines = text.trim().split(/\r?\n/);
    var entries = [];
    var delim = (lines[0] && lines[0].indexOf('\t') !== -1) ? '\t' : ',';
    var VALID_RINGS = { BT: true, OL: true, IL: true, ET: true };

    for (var i = 0; i < lines.length; i++) {
      var parts = splitCsvLine(lines[i], delim);
      // Same column layout as clock ring CSV:
      // Col B (1) = Finance Number, Col C (2) = Office Name
      // Col E (4) = EIN, Col F (5) = Last Name, Col G (6) = First Initial
      // Col T (19) = Ring Type, Col U (20) = Date, Col V (21) = Time (decimal hours)
      if (parts.length < 22) continue;

      var ringType = (parts[19] || '').trim().toUpperCase();
      if (!VALID_RINGS[ringType]) continue;

      var ein = (parts[4] || '').trim().replace(/\D/g, '');
      if (ein.length > 0 && ein.length < 8) ein = ein.padStart(8, '0');
      var lastName = (parts[5] || '').trim().toUpperCase();
      var firstInit = (parts[6] || '').trim().toUpperCase().charAt(0);
      var timeVal = (parts[21] || '').trim();
      var dateStr = (parts[20] || '').trim();

      if (!lastName || /^(last|name|employee)/i.test(lastName)) continue;
      if (!timeVal || !dateStr) continue;

      var time = parseFloat(timeVal);
      if (isNaN(time)) continue;

      var parsedDate = parseClockDate(dateStr);
      if (!parsedDate) continue;

      entries.push({
        finance: (parts[1] || '').trim().replace(/\D/g, ''),
        officeName: (parts[2] || '').trim(),
        ein: ein,
        lastName: lastName,
        firstInit: firstInit,
        ring: ringType,
        time: time,
        date: parsedDate,
        dateStr: dateStr
      });
    }
    return entries;
  }

  function analyzeTacs(text, skipSave) {
    if (!tacsOutput) return;

    var entries = parseTacsCsv(text);
    if (entries.length === 0) {
      tacsOutput.innerHTML = '<p class="empty-state">No valid TACS data found. Make sure the CSV has columns F (Last Name), T (Ring Type: BT/OL/IL/ET), U (Date), V (Time).</p>';
      return;
    }

    // Save raw CSV for persistence across office switches
    if (!skipSave) {
      try { localStorage.setItem('clerk_obs_tacs_csv_' + reviewId, text); } catch(e) {}
    }

    // Get review offices
    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    var reviewOffices = (rev && rev.offices && rev.offices.length > 0) ? rev.offices : [];

    // Group entries by finance number
    var byFinance = {};
    entries.forEach(function(e) {
      var fin = e.finance || 'unknown';
      if (!byFinance[fin]) byFinance[fin] = { officeName: e.officeName, entries: [] };
      byFinance[fin].entries.push(e);
    });

    var reviewFinSet = {};
    reviewOffices.forEach(function(o) {
      var fin = (o.financeNum || '').replace(/\D/g, '');
      if (fin) reviewFinSet[fin] = o.officeName || fin;
    });

    var csvFinKeys = Object.keys(byFinance);
    var extraOffices = csvFinKeys.filter(function(f) { return f !== 'unknown' && !reviewFinSet[f]; });
    var missingOffices = Object.keys(reviewFinSet).filter(function(f) { return !byFinance[f]; });

    var MH_DA_CODES = [120, 320, 820, 420];
    var currentFin = financeNum.replace(/\D/g, '');
    var savedCount = 0;

    // Helper: analyze and save TACS for one office
    function analyzeForOffice(fin, officeEntries) {
      var oFinRaw = fin;
      reviewOffices.forEach(function(o) {
        if ((o.financeNum || '').replace(/\D/g, '') === fin) oFinRaw = o.financeNum;
      });
      var oKey = 'clerk_obs_workbook_' + reviewId + (oFinRaw ? '_' + oFinRaw : '');
      var oData = {};
      try { oData = JSON.parse(localStorage.getItem(oKey)) || {}; } catch(e) {}
      var roster = oData.roster || [];

      var rosterMap = {};
      roster.forEach(function(emp) {
        var key = emp.last.toUpperCase() + '_' + (emp.first || '').charAt(0).toUpperCase();
        var da = parseInt(emp.daCode, 10);
        var craft = (MH_DA_CODES.indexOf(da) !== -1) ? 'MH' : 'Clerk';
        rosterMap[key] = { emp: emp, craft: craft };
      });

      var empData = {};
      officeEntries.forEach(function(e) {
        var key = e.lastName + '_' + e.firstInit;
        if (!empData[key]) {
          var rosterEntry = rosterMap[key];
          empData[key] = {
            lastName: e.lastName, firstInit: e.firstInit, ein: e.ein,
            craft: rosterEntry ? rosterEntry.craft : 'Unknown',
            onRoster: !!rosterEntry,
            rosterName: rosterEntry ? (rosterEntry.emp.last + ', ' + rosterEntry.emp.first) : (e.lastName + ', ' + e.firstInit),
            dates: {}
          };
        }
        var dKey = e.date.toISOString().slice(0, 10);
        if (!empData[key].dates[dKey]) {
          empData[key].dates[dKey] = { dateObj: e.date, dateStr: e.dateStr };
        }
        empData[key].dates[dKey][e.ring] = e.time;
      });

      var empKeys = Object.keys(empData);
      var allDates = {};
      officeEntries.forEach(function(e) {
        allDates[e.date.toISOString().slice(0, 10)] = e.date;
      });
      var dateKeys = Object.keys(allDates).sort();

      // Save to workbook
      oData.clerkTacs = { employees: {}, dayMap: {}, dateNums: [] };
      oData.mhTacs = { employees: {}, dayMap: {}, dateNums: [] };

      empKeys.forEach(function(key) {
        var emp = empData[key];
        var legacyEmp = { name: emp.rosterName, ein: emp.ein, days: {} };
        var dks = dateKeys.filter(function(dk) { return !!emp.dates[dk]; });
        dks.forEach(function(dk, di) {
          var dd = emp.dates[dk];
          var dayNum = di + 1;
          legacyEmp.days[dayNum] = {};
          if (dd.BT !== undefined) legacyEmp.days[dayNum].BT = dd.BT;
          if (dd.OL !== undefined) legacyEmp.days[dayNum].OL = dd.OL;
          if (dd.IL !== undefined) legacyEmp.days[dayNum].IL = dd.IL;
          if (dd.ET !== undefined) legacyEmp.days[dayNum].ET = dd.ET;
          legacyEmp.days[dayNum]._date = dk;
        });
        var legKey = emp.ein ? (emp.ein + '|' + emp.rosterName) : emp.rosterName;
        if (emp.craft === 'MH') {
          oData.mhTacs.employees[legKey] = legacyEmp;
        } else {
          oData.clerkTacs.employees[legKey] = legacyEmp;
        }
      });

      localStorage.setItem(oKey, JSON.stringify(oData));
      savedCount++;

      return { empData: empData, empKeys: empKeys, dateKeys: dateKeys, rosterMap: rosterMap, entries: officeEntries };
    }

    // Process all review offices
    Object.keys(reviewFinSet).forEach(function(fin) {
      if (!byFinance[fin]) return;
      analyzeForOffice(fin, byFinance[fin].entries);
    });

    // Fallback: process current office if not in reviewFinSet
    if (currentFin && !reviewFinSet[currentFin] && byFinance[currentFin]) {
      analyzeForOffice(currentFin, byFinance[currentFin].entries);
    }

    // --- Render for current office ---
    var currentEntries = byFinance[currentFin] ? byFinance[currentFin].entries : entries;
    var data = loadData();
    var roster = data.roster || [];

    var rosterMap = {};
    roster.forEach(function(emp) {
      var key = emp.last.toUpperCase() + '_' + (emp.first || '').charAt(0).toUpperCase();
      var da = parseInt(emp.daCode, 10);
      var craft = (MH_DA_CODES.indexOf(da) !== -1) ? 'MH' : 'Clerk';
      rosterMap[key] = { emp: emp, craft: craft };
    });

    var empData = {};
    currentEntries.forEach(function(e) {
      var key = e.lastName + '_' + e.firstInit;
      if (!empData[key]) {
        var rosterEntry = rosterMap[key];
        empData[key] = {
          lastName: e.lastName, firstInit: e.firstInit, ein: e.ein,
          craft: rosterEntry ? rosterEntry.craft : 'Unknown',
          onRoster: !!rosterEntry,
          rosterName: rosterEntry ? (rosterEntry.emp.last + ', ' + rosterEntry.emp.first) : (e.lastName + ', ' + e.firstInit),
          dates: {}
        };
      }
      var dKey = e.date.toISOString().slice(0, 10);
      if (!empData[key].dates[dKey]) {
        empData[key].dates[dKey] = { dateObj: e.date, dateStr: e.dateStr };
      }
      empData[key].dates[dKey][e.ring] = e.time;
    });

    var craftOrder = { Clerk: 0, MH: 1, Unknown: 2 };
    var empKeys = Object.keys(empData).sort(function(a, b) {
      var ca = craftOrder[empData[a].craft] || 2;
      var cb = craftOrder[empData[b].craft] || 2;
      if (ca !== cb) return ca - cb;
      return a.localeCompare(b);
    });

    var allDates = {};
    currentEntries.forEach(function(e) {
      allDates[e.date.toISOString().slice(0, 10)] = e.date;
    });
    var dateKeys = Object.keys(allDates).sort();
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    var clerkCount = 0, mhCount = 0, unknownCount = 0;
    var unknownList = [];
    empKeys.forEach(function(k) {
      var emp = empData[k];
      if (emp.craft === 'Clerk') clerkCount++;
      else if (emp.craft === 'MH') mhCount++;
      else { unknownCount++; unknownList.push(emp.rosterName); }
    });

    var html = '';

    // Office notifications
    if (extraOffices.length > 0) {
      html += '<div style="padding:0.5rem 0.75rem;background:rgba(217,119,6,0.08);border:1px solid #f59e0b;border-radius:6px;margin-bottom:0.4rem;font-size:0.82rem;">';
      html += '<strong style="color:#92400e;">\u26a0\ufe0f TACS data contains offices not in this review:</strong> ';
      html += extraOffices.map(function(f) {
        return esc((byFinance[f].officeName || f) + ' (' + f + ')') + ' <span style="color:var(--text-light);">(' + byFinance[f].entries.length + ' entries)</span>';
      }).join(', ');
      html += '</div>';
    }
    if (missingOffices.length > 0) {
      html += '<div style="padding:0.5rem 0.75rem;background:rgba(220,38,38,0.06);border:1px solid #fca5a5;border-radius:6px;margin-bottom:0.4rem;font-size:0.82rem;">';
      html += '<strong style="color:#dc2626;">\u274c Review offices not found in TACS data:</strong> ';
      html += missingOffices.map(function(f) { return esc(reviewFinSet[f] + ' (' + f + ')'); }).join(', ');
      html += '</div>';
    }
    if (savedCount > 1) {
      html += '<div style="padding:0.5rem 0.75rem;background:rgba(22,163,74,0.06);border:1px solid #86efac;border-radius:6px;margin-bottom:0.75rem;font-size:0.82rem;">';
      html += '<strong style="color:#166534;">\u2705 TACS data saved for ' + savedCount + ' offices.</strong> Showing current office below.';
      html += '</div>';
    }

    html += '<div style="display:flex;gap:1rem;margin-bottom:0.75rem;flex-wrap:wrap;">';
    html += '<span class="info-chip"><strong>' + currentEntries.length + '</strong> Clock Rings</span>';
    html += '<span class="info-chip"><strong>' + empKeys.length + '</strong> Employees</span>';
    html += '<span class="info-chip"><strong>' + clerkCount + '</strong> Clerks</span>';
    html += '<span class="info-chip"><strong>' + mhCount + '</strong> Mail Handlers</span>';
    html += '<span class="info-chip"><strong>' + dateKeys.length + '</strong> Days</span>';
    if (unknownCount > 0) {
      html += '<span class="info-chip" style="background:var(--danger-bg,#fee2e2);color:var(--danger,#dc2626);"><strong>' + unknownCount + '</strong> Not on Roster</span>';
    }
    html += '</div>';

    if (unknownCount > 0) {
      html += '<details style="margin-bottom:0.75rem;border:1px solid var(--danger,#dc2626);border-radius:6px;padding:0.5rem;background:rgba(220,38,38,0.05);">';
      html += '<summary style="cursor:pointer;font-size:0.85rem;font-weight:600;color:var(--danger,#dc2626);">\u26a0\ufe0f ' + unknownCount + ' employee' + (unknownCount > 1 ? 's' : '') + ' found in TACS but NOT on the Office Schedule roster</summary>';
      html += '<div style="padding:0.4rem 0.6rem;font-size:0.82rem;columns:3;">';
      unknownList.forEach(function(n) { html += '<div>' + esc(n) + '</div>'; });
      html += '</div></details>';
    }

    ['Clerk', 'MH', 'Unknown'].forEach(function(craft) {
      var craftEmps = empKeys.filter(function(k) { return empData[k].craft === craft; });
      if (craftEmps.length === 0) return;

      var craftLabel = craft === 'MH' ? 'Mail Handlers' : (craft === 'Clerk' ? 'Clerks' : 'Not on Roster');
      var craftStyle = craft === 'Unknown' ? 'color:var(--danger);' : '';
      html += '<h3 style="font-size:0.92rem;margin:0.75rem 0 0.3rem;' + craftStyle + '">' + craftLabel + ' (' + craftEmps.length + ')</h3>';
      html += '<table class="wb-tacs-table"><thead><tr><th>Name</th>';
      if (craft !== 'MH') html += '<th>EIN</th>';
      html += '<th>Day</th><th>Date</th><th>BT</th><th>OL</th><th>IL</th><th>ET</th><th>Lunch</th><th>Work</th></tr></thead><tbody>';

      craftEmps.forEach(function(key) {
        var emp = empData[key];
        var empDateKeys = dateKeys.filter(function(dk) { return !!emp.dates[dk]; });
        var rowSpan = empDateKeys.length;
        var first = true;

        empDateKeys.forEach(function(dk) {
          var dd = emp.dates[dk];
          var bt = dd.BT, ol = dd.OL, il = dd.IL, et = dd.ET;
          var lunch = '';
          var work = '';
          if (ol !== undefined && il !== undefined) {
            lunch = (il - ol).toFixed(2) + 'h';
          }
          if (bt !== undefined && et !== undefined) {
            var lunchDeduct = (ol !== undefined && il !== undefined) ? (il - ol) : 0;
            work = (et - bt - lunchDeduct).toFixed(2) + 'h';
          }
          var dow = dd.dateObj ? dayNames[dd.dateObj.getDay()] : '';
          var dateLabel = dd.dateObj ? (dd.dateObj.getMonth() + 1) + '/' + dd.dateObj.getDate() : dd.dateStr;

          html += '<tr' + (first ? ' class="wb-tacs-group-start"' : '') + '>';
          if (first) {
            var nameDisp = emp.rosterName;
            if (!emp.onRoster) nameDisp += ' <span style="color:var(--danger);font-size:0.7rem;">\u26a0 NOT ON ROSTER</span>';
            html += '<td rowspan="' + rowSpan + '" class="wb-tacs-name">' + nameDisp + '</td>';
            if (craft !== 'MH') html += '<td rowspan="' + rowSpan + '" class="wb-tacs-ein-cell">' + esc(emp.ein) + '</td>';
            first = false;
          }
          html += '<td>' + dow + '</td>' +
            '<td>' + esc(dateLabel) + '</td>' +
            '<td>' + (bt !== undefined ? hundredthsToTime(bt) : '\u2014') + '</td>' +
            '<td>' + (ol !== undefined ? hundredthsToTime(ol) : '\u2014') + '</td>' +
            '<td>' + (il !== undefined ? hundredthsToTime(il) : '\u2014') + '</td>' +
            '<td>' + (et !== undefined ? hundredthsToTime(et) : '\u2014') + '</td>' +
            '<td>' + (lunch || '\u2014') + '</td>' +
            '<td><strong>' + (work || '\u2014') + '</strong></td>' +
            '</tr>';
        });
      });

      html += '</tbody></table>';
    });

    tacsOutput.innerHTML = html;
  }

  if (tacsCsvInput) {
    tacsCsvInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        analyzeTacs(ev.target.result);
      };
      reader.readAsText(file);
      tacsCsvInput.value = '';
    });
  }
  if (tacsClearBtn) {
    tacsClearBtn.addEventListener('click', function() {
      if (tacsOutput) tacsOutput.innerHTML = '';
      var data = loadData();
      delete data.clerkTacs;
      delete data.mhTacs;
      saveData(data);
    });
  }

  // ---------- DUT / POBUT Autosave ----------

  var dutFields = ['wb-dut-d1', 'wb-dut-d2', 'wb-pobut-d1', 'wb-pobut-d2'];

  function loadDut() {
    var data = loadData();
    var dut = data.dut || {};
    dutFields.forEach(function(id) {
      var el = document.getElementById(id);
      if (el && dut[id] !== undefined) el.value = dut[id];
    });
  }

  function saveDut() {
    var data = loadData();
    var dut = {};
    dutFields.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) dut[id] = el.value;
    });
    data.dut = dut;
    saveData(data);
  }

  dutFields.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', saveDut);
  });

  // ---------- CSAW Hours Autosave ----------

  function loadCsaw() {
    var data = loadData();
    var csaw = data.csaw || {};
    document.querySelectorAll('.wb-csaw-input').forEach(function(input) {
      var key = input.dataset.day + '_' + input.dataset.ldc;
      if (csaw[key] !== undefined) input.value = csaw[key];
    });
  }

  function saveCsaw() {
    var data = loadData();
    var csaw = {};
    document.querySelectorAll('.wb-csaw-input').forEach(function(input) {
      var key = input.dataset.day + '_' + input.dataset.ldc;
      csaw[key] = input.value;
    });
    data.csaw = csaw;
    saveData(data);
  }

  document.querySelectorAll('.wb-csaw-input').forEach(function(input) {
    input.addEventListener('input', saveCsaw);
  });

  // ---------- Workbook Lead Questionnaire (all questions, no LDC filter) ----------

  var wbQuestContainer = document.getElementById('wb-questionnaire-sections');
  var WB_QUEST_KEY = 'clerk_obs_wb_questionnaire_' + reviewId;

  // Full question bank (same as questionnaire.js)
  var WB_QUESTIONS = {
    '41': { title: 'LDC 41 — ADUS/SDUS', items: [
      'Is the ADUS/SDUS operated with no more than 4 employees? (except where authorized)',
      'Are employees performing each duty of the ADUS/SDUS properly and efficiently according to the SWIs for each duty? (1 Stager, 2 Facers, 1 Sweeper)'
    ]},
    '42': { title: 'LDC 42 — BRM/PD/PRS', items: [
      'Are clerks processing workload at inappropriate times when employees should be redirected to assist other operations to meet goals and targets. (i.e. DUT, Box Up, WTIL, PM Parcel Dist, etc)',
      'Is the unit processing BRM Mail 6 days a week as required?'
    ]},
    '43': { title: 'LDC 43 — Distribution', items: [
      'If the unit receives DDU drop shipment parcels the day prior, are they being distributed that afternoon rather than waiting until the next morning?',
      'Is management engaged with clerks during distribution providing instruction/direction for prioritization of work in an effort to ensure DUT is achieved on time?',
      'Prior to distribution, is management overseeing the process to ensure clerks are properly recording mail volume on PS Form 3922 as well as using a measuring device?',
      'Is rolling stock utilized properly when spreading presorted bundles, NLM tubs, or other mail types in a manner to make it most efficient, avoiding excessive walking/trips to the same drop locations, etc.?',
      'Are clerks wasting time by moving flats unnecessarily from one container to another for the purpose of measuring or consolidation?',
      'Prior to letter distribution, do the clerks load the ledge full or with all available working letter mail to avoid excess movement?',
      'Do the clerks waste time by engaging in excessive conversation or unauthorized movement during distribution? (quantify time wasted in observation comments)',
      'Where available, are clerks utilizing all advanced scanning equipment (DSS/PASS) during parcel distribution vs. all crowding around one piece of equipment?',
      'Is time wasted re-arranging or organizing hampers before distribution can begin caused by the floor not striped, numbered, or carriers not returning equipment to designated space? (quantify wasted time in observation comments)',
      'Is time wasted when trucks arrive by excessive clerks leaving distribution operations, waiting idle for containers to be unloaded off the truck? (quantify wasted time in observation comments)',
      'Is the unit taking improper volume credit for manual distribution by measuring DPS, segregated NLM, Presort Flat Bundles, Accountable Mail, Firm/Caller mail requiring no further handling, or EOR automated volumes?',
      'If the unit has a secondary distribution set up for the box section, is set up warranted only where box section separations can\'t be added to the primary distribution case(s) instead?',
      'When mail is being measured for distribution, do the employees compress trays and measure mail in each tub (not stacks) and utilize a measuring device as required?'
    ]},
    '44': { title: 'LDC 44 — PO Box Distribution', items: [
      'Is PO Box mail strategically placed in each area of the box section to maximize efficiency and eliminate clerks moving/walking unnecessarily?',
      'Is management engaged with clerks during PO box distribution, providing instruction/direction for prioritization of work in an effort to ensure Box Up Time is achieved timely?',
      'Are clerks delaying box up, not meeting PO box productivity expectations and slowing the distribution of box mail by engaging in unnecessary conversation? (quantify time and specify employees)',
      'If equipped, are all parcel lockers in working order with locks and utilized daily?',
      'Is the unit utilizing PS Form 3922 correctly by recording unit distribution mail on the left and PO box distribution mail on the right?',
      'Does the unit convert circular sets or other non addressed mail being boxed to linear measurements (active boxes divided by 227-letters or 115-flats times 12") as box distributed letters or flats?'
    ]},
    '45': { title: 'LDC 45 — Retail Window Services', items: [
      'Are clerk workstations neat, clean, and well stocked presenting a positive image and reducing the possibility of WTIL by unnecessarily leaving the window for supplies?',
      'Is the Ready Post, EPS and special services forms fully stocked?',
      'Does the supervisor use the SSRD for prior day review of performance for clerk engagement?',
      'When customers have not prepared for their transactions, do clerks ask them to step aside to prepare to avoid extending the visit by standing idle at the window while customers prepare?',
      'Are clerks standing idle, engaging in unnecessary conversation at the window between customers or are multiple clerks staying at the window when the customer to clerk ratio doesn\'t warrant additional help?',
      'Does the unit have a bell, buzzer or radio to call for assistance when the customer to clerk ratio requires assistance and is it used?',
      'Are Ancillary duties maintained and performed by window clerks (i.e. 2nd Notices, replenishing lobby forms and mailing supplies, etc) between customers or during times of slower window traffic as required?',
      'If possible, are the left notice items such as parcels or accountable mail in close proximity to the window area to prevent clerks from spending excessive amounts of time away from the window?',
      'Are window clerks losing time searching for left notice items due to employees failing to properly complete the PS Form 3849? Form must be legible and filled in completely to reduce time for the SSA\'s retrieving mail.',
      'Are the SSA\'s lunches and breaks taken according to customer flow? (not at set times and not overlapping)',
      'If the unit has a lead clerk are they working the window, performing administrative duties, providing guidance, performing TACS duties and instructions to the other clerks?',
      'Is the office losing time during the open and close out process for each SSA\'s taking more than 5 minutes for set up; and more than 5 minutes to close-out?',
      'Does the final deposit take more than 30 mins from the time the window closes to consolidate and finalize?',
      'Are passports processed timely according WOS time earned? Observe passport transactions as clerks are processing.',
      'If applicable, is the Lobby Assistant scheduled during peak times and directing customers to the SSK as well as providing usage instructions in an effort to reduce WTIL and improve the customer experience?'
    ]},
    '48': { title: 'LDC 48 — Misc Customer Service', items: [
      'Are clerks losing time by collecting mail too frequently from collection drops outside of normal scheduled collection times?',
      'Does the unit have an adequate setup for PARS / FPARS / CFS / RFS mail and is it dispatched daily?',
      'Are clerks wasting time while distributing accountable items to carriers by engaging in excessive talking, etc.?',
      'Are clerks forced to spend time culling/separating mail returned by carriers and collectors prior to dispatching to the plant due the carriers failing to make their separations as required?'
    ]},
    'General': { title: 'General Observations', items: [
      'Are FDB facility times correct according to all actual times of the facility (unit times, retail hours, Dutch door, Box up, DUT etc.)?',
      'If this is an SCF, Tier1 Hub or Tier 2 Hub, who has mail processing or cross dock operation for downstream (Child) offices, is it set up in CSV as a Hub site with child offices properly assigned in the CSV Hub Editor?',
      'If this is a Hub Site, is unit properly credited with all items associated with that Tier (child offices, pouches, hashing, etc.)',
      'Do employees store personal belongings such as purses, Ice chests, and large bags in their locker prior to begin tour and reporting for duty in the work area? This includes the workroom floor, retail areas, and offices.',
      'Do clerks clock-in (BT) and/or return from lunch and engage in productive work, without delay of personal time?',
      'Do Lead Clerks schedule breaks preventing all clerks from taking breaks at the same time?',
      'Is the unit properly utilizing the Informed Visibility F4 Employee Scheduler (IVES-F4), scheduling to earned hours and posting the schedule weekly?',
      'Are COAs with FIM Barcodes collected by the carriers or taken in by clerks placed directly into the mail stream and not isolated for submission to CFS?'
    ]}
  };

  var wbQuestAnswers = {};

  function loadWbQuest() {
    try { var raw = localStorage.getItem(WB_QUEST_KEY); if (raw) wbQuestAnswers = JSON.parse(raw); } catch(e) {}
  }

  var wbQuestSaveTimer = null;
  function saveWbQuest() {
    clearTimeout(wbQuestSaveTimer);
    wbQuestSaveTimer = setTimeout(function() {
      localStorage.setItem(WB_QUEST_KEY, JSON.stringify(wbQuestAnswers));
    }, 300);
  }

  function renderWbQuestionnaire() {
    if (!wbQuestContainer) return;
    wbQuestContainer.innerHTML = '';
    var qNum = 0;

    Object.keys(WB_QUESTIONS).forEach(function(key) {
      var section = WB_QUESTIONS[key];
      var sDiv = document.createElement('div');
      sDiv.className = 'quest-section';
      sDiv.innerHTML = '<h3 class="quest-section-title">' + section.title + '</h3>';

      section.items.forEach(function(question, qi) {
        qNum++;
        var qKey = key + '_' + qi;
        var ans = wbQuestAnswers[qKey] || {};
        var row = document.createElement('div');
        row.className = 'quest-row';
        row.innerHTML =
          '<div class="quest-num">' + qNum + '</div>' +
          '<div class="quest-body">' +
            '<p class="quest-text">' + question + '</p>' +
            '<div class="quest-controls">' +
              '<div class="quest-yn">' +
                '<label class="quest-radio"><input type="radio" name="wbq_' + qKey + '" value="Y"' + (ans.yn === 'Y' ? ' checked' : '') + '> Y</label>' +
                '<label class="quest-radio"><input type="radio" name="wbq_' + qKey + '" value="N"' + (ans.yn === 'N' ? ' checked' : '') + '> N</label>' +
                '<label class="quest-radio"><input type="radio" name="wbq_' + qKey + '" value="N/A"' + (ans.yn === 'N/A' ? ' checked' : '') + '> N/A</label>' +
              '</div>' +
              '<select class="quest-result" data-wbqkey="' + qKey + '">' +
                '<option value="">-- Result --</option>' +
                '<option value="Satisfactory"' + (ans.result === 'Satisfactory' ? ' selected' : '') + '>Satisfactory</option>' +
                '<option value="Needs Improvement"' + (ans.result === 'Needs Improvement' ? ' selected' : '') + '>Needs Improvement</option>' +
                '<option value="Unsatisfactory"' + (ans.result === 'Unsatisfactory' ? ' selected' : '') + '>Unsatisfactory</option>' +
              '</select>' +
            '</div>' +
            '<textarea class="quest-comments" data-wbqkey="' + qKey + '" placeholder="Observation comments..." rows="2">' + (ans.comments || '') + '</textarea>' +
          '</div>';
        sDiv.appendChild(row);
      });
      wbQuestContainer.appendChild(sDiv);
    });

    // Bind events
    wbQuestContainer.querySelectorAll('input[type="radio"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        var name = radio.name.replace('wbq_', '');
        if (!wbQuestAnswers[name]) wbQuestAnswers[name] = {};
        wbQuestAnswers[name].yn = radio.value;
        saveWbQuest();
      });
    });
    wbQuestContainer.querySelectorAll('.quest-result').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var key = sel.dataset.wbqkey;
        if (!wbQuestAnswers[key]) wbQuestAnswers[key] = {};
        wbQuestAnswers[key].result = sel.value;
        saveWbQuest();
      });
    });
    wbQuestContainer.querySelectorAll('.quest-comments').forEach(function(ta) {
      ta.addEventListener('input', function() {
        var key = ta.dataset.wbqkey;
        if (!wbQuestAnswers[key]) wbQuestAnswers[key] = {};
        wbQuestAnswers[key].comments = ta.value;
        saveWbQuest();
      });
    });
  }

  // Re-render when switching to questionnaire sub-tab
  document.querySelectorAll('.wb-sub-tab').forEach(function(st) {
    st.addEventListener('click', function() {
      if (st.dataset.wbtab === 'wb-panel-questionnaire') renderWbQuestionnaire();
    });
  });

  // ---------- Employee Roster Parser ----------

  var rosterInput = document.getElementById('wb-roster-input');
  var rosterParseBtn = document.getElementById('wb-roster-parse');
  var rosterClearBtn = document.getElementById('wb-roster-clear');
  var rosterOutput = document.getElementById('wb-roster-output');

  function parseRoster(raw) {
    var lines = raw.trim().split('\n');
    var employees = [];

    lines.forEach(function(line) {
      var parts = line.trim().split(/\t/);
      // Also support multiple-space delimited if no tabs found
      if (parts.length < 8) parts = line.trim().split(/\s{2,}/);
      if (parts.length < 8) return;

      // Columns: 0-Finance, 1-Office, 2-Last, 3-First, 4-MI, 5-EMP ID, 6-Job ID,
      //   7-Job Title, 8-EMP Level, 9-D/A Code, 10-FUN, 11-LDC, 12-HCES ORG,
      //   13-Start, 14-Days Off, 15-OCC, 16-Sen Date, 17-Sen Num
      var emp = {
        finance: (parts[0] || '').trim(),
        office: (parts[1] || '').trim(),
        last: (parts[2] || '').trim(),
        first: (parts[3] || '').trim(),
        mi: (parts[4] || '').trim(),
        empId: (parts[5] || '').trim().replace(/\D/g, '').padStart(8, '0'),
        jobId: (parts[6] || '').trim(),
        jobTitle: (parts[7] || '').trim(),
        level: (parts[8] || '').trim(),
        daCode: (parts[9] || '').trim(),
        fun: (parts[10] || '').trim(),
        ldc: (parts[11] || '').trim(),
        hcesOrg: (parts[12] || '').trim(),
        start: (parts[13] || '').trim(),
        daysOff: (parts[14] || '').trim(),
        occ: (parts[15] || '').trim(),
        senDate: (parts[16] || '').trim(),
        senNum: (parts[17] || '').trim()
      };

      // Skip header rows
      if (/^finance/i.test(emp.finance) || /^last/i.test(emp.last)) return;
      // Skip empty employee IDs
      if (!emp.empId) return;

      employees.push(emp);
    });

    return employees;
  }

  function renderRoster(employees) {
    if (employees.length === 0) {
      rosterOutput.innerHTML = '<p class="empty-state">No valid roster data found. Check the format.</p>';
      return;
    }

    // --- Office matching ---
    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    var reviewOffices = (rev && rev.offices && rev.offices.length > 0) ? rev.offices : [];

    // Group CSV employees by finance number
    var byFinance = {};
    employees.forEach(function(emp) {
      var fin = emp.finance.replace(/\D/g, '');
      if (!byFinance[fin]) byFinance[fin] = { office: emp.office, emps: [] };
      byFinance[fin].emps.push(emp);
    });

    // Build sets for matching
    var reviewFinSet = {};
    reviewOffices.forEach(function(o) {
      var fin = (o.financeNum || '').replace(/\D/g, '');
      if (fin) reviewFinSet[fin] = o.officeName || fin;
    });

    var csvFinKeys = Object.keys(byFinance);

    // Offices in CSV not in the review
    var extraOffices = csvFinKeys.filter(function(f) { return !reviewFinSet[f]; });

    // Review offices missing from CSV — only warn if they also have no saved roster
    var missingOffices = Object.keys(reviewFinSet).filter(function(f) {
      if (byFinance[f]) return false; // present in this upload
      // Check if this office already has a saved roster
      var oFinRaw = f;
      reviewOffices.forEach(function(o) {
        if ((o.financeNum || '').replace(/\D/g, '') === f) oFinRaw = o.financeNum;
      });
      var oKey = 'clerk_obs_workbook_' + reviewId + '_' + oFinRaw;
      try {
        var oData = JSON.parse(localStorage.getItem(oKey)) || {};
        if (oData.roster && oData.roster.length > 0) return false; // already has data
      } catch(e) {}
      return true;
    });

    // Build notification banner
    var noticeHtml = '';
    if (extraOffices.length > 0 || missingOffices.length > 0) {
      noticeHtml += '<div style="margin-bottom:0.75rem;">';
      if (extraOffices.length > 0) {
        noticeHtml += '<div style="padding:0.5rem 0.75rem;background:rgba(217,119,6,0.08);border:1px solid #f59e0b;border-radius:6px;margin-bottom:0.4rem;font-size:0.82rem;">';
        noticeHtml += '<strong style="color:#92400e;">⚠️ CSV contains offices not in this review:</strong> ';
        noticeHtml += extraOffices.map(function(f) {
          var label = byFinance[f].office ? byFinance[f].office + ' (' + f + ')' : f;
          return esc(label) + ' <span style="color:var(--text-light);">(' + byFinance[f].emps.length + ' employees)</span>';
        }).join(', ');
        noticeHtml += '<div style="font-size:0.75rem;color:#92400e;margin-top:3px;">These employees were not loaded.</div>';
        noticeHtml += '</div>';
      }
      if (missingOffices.length > 0) {
        noticeHtml += '<div style="padding:0.5rem 0.75rem;background:rgba(220,38,38,0.06);border:1px solid #fca5a5;border-radius:6px;font-size:0.82rem;">';
        noticeHtml += '<strong style="color:#dc2626;">❌ Review offices not found in CSV:</strong> ';
        noticeHtml += missingOffices.map(function(f) { return esc(reviewFinSet[f] + ' (' + f + ')'); }).join(', ');
        noticeHtml += '<div style="font-size:0.75rem;color:#dc2626;margin-top:3px;">Upload a CSV that includes these offices, or upload separately for each office.</div>';
        noticeHtml += '</div>';
      }
      noticeHtml += '</div>';
    }

    // Filter to only current office if we have a financeNum, otherwise keep review-matched offices
    var filteredEmployees;
    var currentFin = financeNum.replace(/\D/g, '');
    if (currentFin && byFinance[currentFin]) {
      filteredEmployees = byFinance[currentFin].emps;
    } else if (reviewOffices.length > 0) {
      // Keep only employees whose finance matches any review office
      filteredEmployees = employees.filter(function(emp) {
        return reviewFinSet[emp.finance.replace(/\D/g, '')];
      });
    } else {
      filteredEmployees = employees;
    }

    // If multi-office CSV and we have review offices, also save other offices' data to their workbook keys
    if (reviewOffices.length > 0) {
      reviewOffices.forEach(function(o) {
        var oFin = (o.financeNum || '').replace(/\D/g, '');
        if (!oFin || oFin === currentFin) return; // skip current office (saved below)
        if (!byFinance[oFin]) return; // no data for this office in CSV
        var oKey = 'clerk_obs_workbook_' + reviewId + '_' + o.financeNum;
        var oData = {};
        try { oData = JSON.parse(localStorage.getItem(oKey)) || {}; } catch(e) {}
        oData.roster = byFinance[oFin].emps;
        localStorage.setItem(oKey, JSON.stringify(oData));
      });
    }

    // Count how many offices were saved
    var savedOfficeCount = 0;
    if (reviewOffices.length > 0) {
      reviewOffices.forEach(function(o) {
        var oFin = (o.financeNum || '').replace(/\D/g, '');
        if (byFinance[oFin]) savedOfficeCount++;
      });
    }

    var html = noticeHtml;

    if (savedOfficeCount > 1) {
      html += '<div style="padding:0.5rem 0.75rem;background:rgba(22,163,74,0.06);border:1px solid #86efac;border-radius:6px;margin-bottom:0.75rem;font-size:0.82rem;">';
      html += '<strong style="color:#166534;">✅ Roster loaded for ' + savedOfficeCount + ' offices.</strong> ';
      html += 'Showing current office below. Switch offices to see their data.';
      html += '</div>';
    }

    html += '<table class="wb-tacs-table wb-roster-table"><thead><tr>' +
      '<th>Last</th><th>First</th><th>MI</th><th>EMP ID</th><th>Job Title</th><th>LDC</th><th>D/A</th><th>Level</th><th>Start</th><th>Days Off</th><th>Sen Date</th>' +
      '</tr></thead><tbody>';

    filteredEmployees.forEach(function(emp) {
      html += '<tr>' +
        '<td class="wb-tacs-name">' + esc(emp.last) + '</td>' +
        '<td>' + esc(emp.first) + '</td>' +
        '<td>' + esc(emp.mi) + '</td>' +
        '<td>' + esc(emp.empId) + '</td>' +
        '<td>' + esc(emp.jobTitle) + '</td>' +
        '<td>' + esc(emp.ldc) + '</td>' +
        '<td>' + esc(emp.daCode) + '</td>' +
        '<td>' + esc(emp.level) + '</td>' +
        '<td>' + esc(emp.start) + '</td>' +
        '<td>' + esc(emp.daysOff) + '</td>' +
        '<td>' + esc(emp.senDate) + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    html += '<p style="font-size:0.75rem;color:var(--text-light);margin-top:0.4rem;">' + filteredEmployees.length + ' employees loaded' + (currentFin ? ' for office ' + currentFin : '') + '</p>';
    rosterOutput.innerHTML = html;

    // Save current office roster
    var data = loadData();
    data.roster = filteredEmployees;
    saveData(data);
  }

  if (rosterParseBtn) {
    rosterParseBtn.addEventListener('click', function() {
      var raw = rosterInput.value.trim();
      if (!raw) return;
      var employees = parseRoster(raw);
      renderRoster(employees);
    });
  }
  if (rosterClearBtn) {
    rosterClearBtn.addEventListener('click', function() {
      rosterInput.value = '';
      rosterOutput.innerHTML = '';
      var data = loadData();
      delete data.roster;
      saveData(data);
    });
  }

  // ---------- Roster Upload (XLS/XLSX/CSV) ----------
  var rosterCsvInput = document.getElementById('wb-roster-csv');
  if (rosterCsvInput) {
    rosterCsvInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var isExcel = /\.(xls|xlsx)$/i.test(file.name);
      if (isExcel && typeof XLSX === 'undefined') {
        alert('Excel parsing library not loaded. Please check your internet connection and reload.');
        rosterCsvInput.value = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function(ev) {
        var text;
        if (isExcel) {
          var data = new Uint8Array(ev.target.result);
          var wb = XLSX.read(data, { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          text = XLSX.utils.sheet_to_csv(ws);
        } else {
          text = ev.target.result;
        }
        var employees = parseRosterCsv(text);
        renderRoster(employees);
        rosterCsvInput.value = '';
      };
      if (isExcel) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    });
  }

  function parseRosterCsv(text) {
    var lines = text.trim().split(/\r?\n/);
    var employees = [];
    // Detect delimiter: if first line has tabs use tab, else comma
    var delim = (lines[0] && lines[0].indexOf('\t') !== -1) ? '\t' : ',';

    // Auto-detect column positions from header row
    var colMap = null;
    var headerNames = {
      'finance': 'finance', 'office': 'office', 'last': 'last', 'first': 'first',
      'mi': 'mi', 'emp id': 'empId', 'job id': 'jobId', 'job title': 'jobTitle',
      'emp level': 'level', 'd/a': 'daCode', 'func': 'fun', 'ldc': 'ldc',
      'hces org id': 'hcesOrg', 'start': 'start', 'days off': 'daysOff',
      'occ code': 'occ', 'sen date': 'senDate', 'sen #': 'senNum'
    };

    for (var i = 0; i < lines.length; i++) {
      var parts = splitCsvLine(lines[i], delim);

      // Try to detect header row
      if (!colMap) {
        var lowerParts = parts.map(function(p) { return (p || '').trim().toLowerCase(); });
        if (lowerParts.indexOf('finance') !== -1 && lowerParts.indexOf('last') !== -1) {
          colMap = {};
          for (var h = 0; h < lowerParts.length; h++) {
            var key = lowerParts[h];
            if (headerNames[key]) colMap[headerNames[key]] = h;
          }
          continue; // skip header row
        }
      }

      // If no header found yet, use default positions (first non-empty column = finance)
      if (!colMap) {
        // Check if first column is empty (XLS export has blank col A)
        var offset = 0;
        for (var o = 0; o < parts.length; o++) {
          if ((parts[o] || '').trim() !== '') { offset = o; break; }
        }
        if (parts.length < 8 + offset) continue;
        colMap = {
          finance: offset, office: offset+1, last: offset+2, first: offset+3,
          mi: offset+4, empId: offset+5, jobId: offset+6, jobTitle: offset+7,
          level: offset+8, daCode: offset+9, fun: offset+10, ldc: offset+11,
          hcesOrg: offset+12, start: offset+13, daysOff: offset+14,
          occ: offset+15, senDate: offset+16, senNum: offset+17
        };
        // If this first data row looks like a header, detect and skip
        var firstVal = (parts[offset] || '').trim().toLowerCase();
        if (firstVal === 'finance') {
          var lp = parts.map(function(p) { return (p || '').trim().toLowerCase(); });
          colMap = {};
          for (var hh = 0; hh < lp.length; hh++) {
            if (headerNames[lp[hh]]) colMap[headerNames[lp[hh]]] = hh;
          }
          continue;
        }
      }

      if (parts.length < 8) continue;

      var emp = {
        finance: (parts[colMap.finance] || '').trim(),
        office: (parts[colMap.office] || '').trim(),
        last: (parts[colMap.last] || '').trim(),
        first: (parts[colMap.first] || '').trim(),
        mi: (parts[colMap.mi] || '').trim(),
        empId: (parts[colMap.empId] || '').trim().replace(/\D/g, '').padStart(8, '0'),
        jobId: (parts[colMap.jobId] || '').trim(),
        jobTitle: (parts[colMap.jobTitle] || '').trim(),
        level: (parts[colMap.level] || '').trim(),
        daCode: (parts[colMap.daCode] || '').trim(),
        fun: (parts[colMap.fun] || '').trim(),
        ldc: (parts[colMap.ldc] || '').trim(),
        hcesOrg: (parts[colMap.hcesOrg] || '').trim(),
        start: (parts[colMap.start] || '').trim(),
        daysOff: (parts[colMap.daysOff] || '').trim(),
        occ: (parts[colMap.occ] || '').trim(),
        senDate: (parts[colMap.senDate] || '').trim(),
        senNum: (parts[colMap.senNum] || '').trim()
      };

      // Skip header rows that slipped through
      if (/^finance/i.test(emp.finance) || /^last/i.test(emp.last)) continue;
      if (!emp.empId || emp.empId === '00000000') continue;

      employees.push(emp);
    }
    return employees;
  }

  // Handle CSV fields that may be quoted with commas inside
  function splitCsvLine(line, delim) {
    if (delim === '\t') return line.split('\t');
    var result = [];
    var current = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  // ---------- Clock Ring CSV Analysis ----------
  var clockCsvInput = document.getElementById('wb-clockring-csv');
  var clockOutput = document.getElementById('wb-clockring-output');

  if (clockCsvInput) {
    clockCsvInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        var text = ev.target.result;
        analyzeClockRings(text);
        // Discard file
        clockCsvInput.value = '';
      };
      reader.readAsText(file);
    });
  }

  function parseClockRingCsv(text) {
    var lines = text.trim().split(/\r?\n/);
    var entries = [];
    var delim = (lines[0] && lines[0].indexOf('\t') !== -1) ? '\t' : ',';

    for (var i = 0; i < lines.length; i++) {
      var parts = splitCsvLine(lines[i], delim);
      // Column B (1) = Finance Number, Column C (2) = Office Name
      // Column F (5) = Last Name, Column G (6) = First Initial
      // Column T (19) = Ring Type (must be "BT")
      // Column U (20) = Date (d-mmm-yy)
      // Column V (21) = BT time in decimal hours (7.5 = 7:30 AM)
      if (parts.length < 22) continue;

      var ringType = (parts[19] || '').trim().toUpperCase();
      if (ringType !== 'BT') continue; // Only BT rows

      var lastName = (parts[5] || '').trim();
      var firstInit = (parts[6] || '').trim();
      var btVal = (parts[21] || '').trim();
      var dateStr = (parts[20] || '').trim();

      // Skip header rows or empty
      if (!lastName || /^(last|name|employee)/i.test(lastName)) continue;
      if (!btVal || !dateStr) continue;

      // Convert decimal hours to minutes (7.5 → 450, i.e. 7:30 AM)
      var btMinutes = parseDecimalHours(btVal);
      if (btMinutes === null) continue;

      var parsedDate = parseClockDate(dateStr);
      if (!parsedDate) continue;

      entries.push({
        finance: (parts[1] || '').trim().replace(/\D/g, ''),
        officeName: (parts[2] || '').trim(),
        lastName: lastName.toUpperCase(),
        firstInit: firstInit.toUpperCase().charAt(0),
        bt: btMinutes,
        btRaw: btVal,
        date: parsedDate,
        dateStr: dateStr
      });
    }
    return entries;
  }

  // Convert decimal hours to minutes since midnight
  // 7.5 → 7h 30m → 450 min (7:30 AM)
  // 16.75 → 16h 45m → 1005 min (4:45 PM)
  function parseDecimalHours(val) {
    if (!val) return null;
    var num = parseFloat(val);
    if (isNaN(num)) return null;
    var hours = Math.floor(num);
    var fraction = num - hours;
    var minutes = Math.round(fraction * 60);
    return hours * 60 + minutes;
  }

  // Parse date: "d-mmm-yy", "mm/dd/yyyy", "yyyy-mm-dd", etc.
  function parseClockDate(val) {
    if (!val) return null;
    val = val.trim();
    // d-mmm-yy (e.g. "5-Apr-26", "12-Mar-26")
    var dmy = val.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2,4})$/);
    if (dmy) {
      var months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
      var mon = months[dmy[2].toLowerCase()];
      if (mon === undefined) return null;
      var yr = parseInt(dmy[3], 10);
      if (yr < 100) yr += 2000;
      return new Date(yr, mon, parseInt(dmy[1], 10));
    }
    // Fallback: try native parse
    var d = new Date(val);
    if (!isNaN(d.getTime())) return d;
    return null;
  }

  // Parse roster start time to minutes since midnight
  // Handles: decimal hours (7.5 = 7:30), "08:00", "0800", "800"
  function parseRosterStartMinutes(startStr) {
    if (!startStr) return null;
    startStr = startStr.toString().trim();
    if (!startStr) return null;
    // HH:MM format
    if (startStr.indexOf(':') !== -1) {
      var tp = startStr.split(':');
      var h = parseInt(tp[0], 10);
      var m = parseInt(tp[1], 10);
      if (isNaN(h) || isNaN(m)) return null;
      return h * 60 + m;
    }
    // Decimal hours (7.5 → 7:30, 16.75 → 16:45)
    if (startStr.indexOf('.') !== -1) {
      return parseDecimalHours(startStr);
    }
    // Military integer (800 → 8:00, 1630 → 16:30)
    var num = parseInt(startStr, 10);
    if (isNaN(num)) return null;
    if (num >= 0 && num <= 2359) {
      return Math.floor(num / 100) * 60 + (num % 100);
    }
    return null;
  }

  function formatMinutes(m) {
    if (m === null || m === undefined) return '—';
    var h = Math.floor(m / 60);
    var mm = m % 60;
    var ampm = h >= 12 ? 'PM' : 'AM';
    var hr = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    return hr + ':' + String(mm).padStart(2, '0') + ' ' + ampm;
  }

  function analyzeClockRings(text, skipSave) {
    if (!clockOutput) return;

    var clockEntries = parseClockRingCsv(text);
    if (clockEntries.length === 0) {
      clockOutput.innerHTML = '<p class="empty-state">No valid clock ring data found. Check the CSV format.</p>';
      return;
    }

    // Save raw CSV for persistence across office switches
    if (!skipSave) {
      try { localStorage.setItem('clerk_obs_clockring_csv_' + reviewId, text); } catch(e) {}
    }

    // Get review offices
    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    var reviewOffices = (rev && rev.offices && rev.offices.length > 0) ? rev.offices : [];

    // Group clock entries by finance number
    var byFinance = {};
    clockEntries.forEach(function(ce) {
      var fin = ce.finance || 'unknown';
      if (!byFinance[fin]) byFinance[fin] = { officeName: ce.officeName, entries: [] };
      byFinance[fin].entries.push(ce);
    });

    // Build review finance set
    var reviewFinSet = {};
    reviewOffices.forEach(function(o) {
      var fin = (o.financeNum || '').replace(/\D/g, '');
      if (fin) reviewFinSet[fin] = o.officeName || fin;
    });

    var csvFinKeys = Object.keys(byFinance);
    var extraOffices = csvFinKeys.filter(function(f) { return f !== 'unknown' && !reviewFinSet[f]; });
    var missingOffices = Object.keys(reviewFinSet).filter(function(f) { return !byFinance[f]; });

    // --- Process each review office ---
    var currentFin = financeNum.replace(/\D/g, '');
    var officeResults = {};
    var savedCount = 0;

    function analyzeForOffice(fin, entries) {
      var oFinRaw = fin;
      reviewOffices.forEach(function(o) {
        if ((o.financeNum || '').replace(/\D/g, '') === fin) oFinRaw = o.financeNum;
      });
      var oKey = 'clerk_obs_workbook_' + reviewId + (oFinRaw ? '_' + oFinRaw : '');
      var oData = {};
      try { oData = JSON.parse(localStorage.getItem(oKey)) || {}; } catch(e) {}
      var roster = oData.roster || [];

      if (roster.length === 0) return null;

      var rosterMap = {};
      roster.forEach(function(emp) {
        var key = emp.last.toUpperCase() + '_' + (emp.first || '').charAt(0).toUpperCase();
        var startMin = parseRosterStartMinutes(emp.start);
        rosterMap[key] = { startMin: startMin, emp: emp };
      });

      var empDays = {};
      entries.forEach(function(ce) {
        var key = ce.lastName + '_' + ce.firstInit;
        if (!empDays[key]) empDays[key] = [];
        empDays[key].push(ce);
      });

      var THRESHOLD = 15;
      var deviations = [];
      var summaryByEmp = {};

      Object.keys(empDays).forEach(function(key) {
        var rosterEntry = rosterMap[key];
        if (!rosterEntry) return;
        var emp = rosterEntry.emp;
        var scheduledMin = rosterEntry.startMin;
        var empName = emp.last + ', ' + emp.first;
        var devCount = 0;
        var detailRows = [];
        var eEntries = empDays[key];

        eEntries.forEach(function(ce) {
          var diff = (scheduledMin !== null) ? ce.bt - scheduledMin : null;
          var isDev = diff !== null && (Math.abs(diff) >= THRESHOLD);
          if (isDev) devCount++;
          detailRows.push({
            date: ce.date, dateStr: ce.dateStr,
            actualBt: ce.bt, actualBtRaw: ce.btRaw,
            scheduledBt: scheduledMin, diff: diff, isDev: isDev
          });
        });

        summaryByEmp[key] = {
          name: empName, scheduled: scheduledMin,
          totalDays: eEntries.length, devDays: devCount,
          details: detailRows.sort(function(a, b) { return a.date - b.date; })
        };

        if (devCount > 0) {
          deviations.push({ key: key, name: empName, scheduled: scheduledMin, devCount: devCount, totalDays: eEntries.length });
        }
      });

      var dowPatterns = {};
      Object.keys(empDays).forEach(function(key) {
        var rosterEntry = rosterMap[key];
        if (!rosterEntry) return;
        var emp = rosterEntry.emp;
        var empName = emp.last + ', ' + emp.first;
        var byDow = {};
        empDays[key].forEach(function(ce) {
          var dow = ce.date.getDay();
          if (!byDow[dow]) byDow[dow] = [];
          byDow[dow].push(ce.bt);
        });
        var pattern = {};
        Object.keys(byDow).forEach(function(d) {
          var times = byDow[d].map(function(t) { return Math.round(t / 5) * 5; });
          var freq = {};
          var maxCount = 0, modeVal = times[0];
          times.forEach(function(t) {
            freq[t] = (freq[t] || 0) + 1;
            if (freq[t] > maxCount) { maxCount = freq[t]; modeVal = t; }
          });
          pattern[d] = modeVal;
        });
        dowPatterns[empName] = pattern;
      });

      var minDate = null, maxDate = null;
      entries.forEach(function(ce) {
        if (!minDate || ce.date < minDate) minDate = ce.date;
        if (!maxDate || ce.date > maxDate) maxDate = ce.date;
      });

      oData.clockRingPatterns = dowPatterns;
      oData.clockRingSummary = summaryByEmp;
      if (minDate && maxDate) {
        oData.clockRingDateRange = { from: minDate.toISOString(), to: maxDate.toISOString() };
      }
      localStorage.setItem(oKey, JSON.stringify(oData));
      savedCount++;

      return {
        rosterMap: rosterMap, empDays: empDays,
        summaryByEmp: summaryByEmp, deviations: deviations,
        dowPatterns: dowPatterns, minDate: minDate, maxDate: maxDate,
        totalEntries: entries.length,
        matchedKeys: Object.keys(empDays).filter(function(k) { return !!rosterMap[k]; }),
        unmatchedKeys: Object.keys(empDays).filter(function(k) { return !rosterMap[k]; })
      };
    }

    // Process all review offices
    Object.keys(reviewFinSet).forEach(function(fin) {
      if (!byFinance[fin]) return;
      officeResults[fin] = analyzeForOffice(fin, byFinance[fin].entries);
    });

    // Fallback: process current office if not in reviewFinSet
    if (currentFin && !officeResults[currentFin] && byFinance[currentFin]) {
      officeResults[currentFin] = analyzeForOffice(currentFin, byFinance[currentFin].entries);
    }

    // --- Render for current office ---
    var result = officeResults[currentFin];
    var html = '';

    // Office notifications
    if (extraOffices.length > 0) {
      html += '<div style="padding:0.5rem 0.75rem;background:rgba(217,119,6,0.08);border:1px solid #f59e0b;border-radius:6px;margin-bottom:0.4rem;font-size:0.82rem;">';
      html += '<strong style="color:#92400e;">\u26a0\ufe0f Clock ring data contains offices not in this review:</strong> ';
      html += extraOffices.map(function(f) {
        return esc((byFinance[f].officeName || f) + ' (' + f + ')') + ' <span style="color:var(--text-light);">(' + byFinance[f].entries.length + ' entries)</span>';
      }).join(', ');
      html += '</div>';
    }
    if (missingOffices.length > 0) {
      html += '<div style="padding:0.5rem 0.75rem;background:rgba(220,38,38,0.06);border:1px solid #fca5a5;border-radius:6px;margin-bottom:0.4rem;font-size:0.82rem;">';
      html += '<strong style="color:#dc2626;">\u274c Review offices not found in clock ring data:</strong> ';
      html += missingOffices.map(function(f) { return esc(reviewFinSet[f] + ' (' + f + ')'); }).join(', ');
      html += '</div>';
    }

    if (savedCount > 1) {
      html += '<div style="padding:0.5rem 0.75rem;background:rgba(22,163,74,0.06);border:1px solid #86efac;border-radius:6px;margin-bottom:0.75rem;font-size:0.82rem;">';
      html += '<strong style="color:#166534;">\u2705 Clock ring analysis saved for ' + savedCount + ' offices.</strong> Showing current office below.';
      html += '</div>';
    }

    if (!result) {
      var data = loadData();
      var roster = data.roster || [];
      if (roster.length === 0) {
        html += '<p class="empty-state" style="color:var(--danger);">Please upload the Office Schedule first (above), then upload clock rings.</p>';
      } else {
        html += '<p class="empty-state">No clock ring data matched this office (' + esc(currentFin) + '). The data may belong to other offices.</p>';
      }
      clockOutput.innerHTML = html;
      return;
    }

    var devEmps = result.deviations.length;
    var dateRangeStr = '';
    if (result.minDate && result.maxDate) {
      var fmt = function(d) { return (d.getMonth()+1)+'/'+d.getDate()+'/'+d.getFullYear(); };
      dateRangeStr = fmt(result.minDate) + ' \u2013 ' + fmt(result.maxDate);
    }

    // Calculate weeks of data
    var weeksOfData = 0;
    if (result.minDate && result.maxDate) {
      var diffMs = result.maxDate.getTime() - result.minDate.getTime();
      weeksOfData = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000) * 10) / 10;
    }

    html += '<div style="display:flex;gap:1rem;margin-bottom:0.75rem;flex-wrap:wrap;">';
    html += '<span class="info-chip"><strong>' + result.totalEntries + '</strong> Clock Rings</span>';
    html += '<span class="info-chip"><strong>' + result.matchedKeys.length + '</strong> Employees Matched</span>';
    html += '<span class="info-chip" style="' + (devEmps > 0 ? 'background:var(--warning-bg);color:var(--warning);' : '') + '"><strong>' + devEmps + '</strong> With Deviations</span>';
    if (dateRangeStr) {
      var weeksColor = weeksOfData > 8 ? 'background:rgba(220,38,38,0.1);color:#dc2626;' : 'background:var(--info-bg,#e0f2fe);color:var(--info,#0369a1);';
      html += '<span class="info-chip" style="' + weeksColor + '">\ud83d\udcc5 ' + dateRangeStr + ' (' + weeksOfData + ' weeks)</span>';
    }
    if (weeksOfData > 8) {
      html += '<div style="width:100%;padding:0.35rem 0.6rem;background:rgba(220,38,38,0.06);border:1px solid #fca5a5;border-radius:4px;font-size:0.78rem;color:#dc2626;font-weight:600;">\u26a0\ufe0f Data spans ' + weeksOfData + ' weeks \u2014 8 weeks max is recommended for accurate analysis.</div>';
    }
    html += '</div>';

    if (result.unmatchedKeys.length > 0) {
      // Load validated employees from localStorage
      var VALIDATED_KEY = 'clerk_obs_clockring_validated_' + reviewId + '_' + currentFin;
      var validatedEmps = {};
      try { validatedEmps = JSON.parse(localStorage.getItem(VALIDATED_KEY)) || {}; } catch(e) {}

      var unvalidatedCount = result.unmatchedKeys.filter(function(k) { return !validatedEmps[k]; }).length;

      html += '<div style="margin-bottom:0.75rem;padding:0.6rem 0.75rem;background:rgba(220,38,38,0.06);border:1.5px solid #fca5a5;border-radius:6px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">';
      html += '<span style="font-size:0.88rem;font-weight:700;color:#dc2626;">\u26a0\ufe0f ' + result.unmatchedKeys.length + ' employee(s) showing time but NOT on WebCOINS roster</span>';
      if (unvalidatedCount > 0) {
        html += '<span style="background:#dc2626;color:#fff;padding:0.15rem 0.45rem;border-radius:10px;font-size:0.72rem;font-weight:600;">' + unvalidatedCount + ' need validation</span>';
      } else {
        html += '<span style="background:#16a34a;color:#fff;padding:0.15rem 0.45rem;border-radius:10px;font-size:0.72rem;font-weight:600;">\u2713 All validated</span>';
      }
      html += '</div>';
      html += '<p style="font-size:0.78rem;color:#991b1b;margin:0 0 0.5rem;">These employees have TACS clock ring entries but were not found in the WebCOINS roster. Please validate whether each is a Function 4 employee working in this office. Validated employees will be included in the schedule.</p>';
      html += '<div id="clockring-unmatched-list" style="display:flex;flex-direction:column;gap:0.3rem;">';
      result.unmatchedKeys.forEach(function(k) {
        var empStatus = validatedEmps[k] ? validatedEmps[k].status : null;
        var displayName = k.replace('_', ', ');
        var bgColor = empStatus === 'f4' ? 'rgba(22,163,74,0.04)' : empStatus === 'not-f4' ? 'rgba(220,38,38,0.04)' : 'var(--bg-light)';
        html += '<div class="clockring-unmatched-row" data-key="' + esc(k) + '" style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:' + bgColor + ';font-size:0.82rem;">';
        html += '<span style="flex:1;font-weight:600;' + (empStatus === 'not-f4' ? 'text-decoration:line-through;color:#9ca3af;' : '') + '">' + esc(displayName) + '</span>';
        if (empStatus === 'f4') {
          html += '<span style="color:#16a34a;font-weight:600;font-size:0.78rem;">\u2713 Validated as F4</span>';
          html += '<button class="btn btn-outline btn-sm clockring-unvalidate-btn" data-key="' + esc(k) + '" style="font-size:0.68rem;padding:0.1rem 0.35rem;color:#6b7280;">Undo</button>';
        } else if (empStatus === 'not-f4') {
          html += '<span style="color:#dc2626;font-weight:600;font-size:0.78rem;">\u2717 Excluded (Not F4)</span>';
          html += '<button class="btn btn-outline btn-sm clockring-unvalidate-btn" data-key="' + esc(k) + '" style="font-size:0.68rem;padding:0.1rem 0.35rem;color:#6b7280;">Undo</button>';
        } else {
          html += '<button class="btn btn-sm clockring-validate-btn" data-key="' + esc(k) + '" style="font-size:0.72rem;padding:0.2rem 0.5rem;background:#16a34a;color:#fff;border:none;">\u2713 Validate as F4</button>';
          html += '<button class="btn btn-outline btn-sm clockring-exclude-btn" data-key="' + esc(k) + '" style="font-size:0.72rem;padding:0.2rem 0.5rem;color:#dc2626;border-color:#dc2626;">\u2717 Not F4</button>';
        }
        html += '</div>';
      });
      html += '</div></div>';
    }

    if (devEmps === 0) {
      html += '<p style="color:var(--success);font-weight:600;">\u2705 No deviations found \u2014 all employees within \u00b115 minutes of scheduled BT.</p>';
    } else {
      html += '<h3 style="font-size:0.95rem;margin-bottom:0.5rem;">\u26a0\ufe0f Employees with BT Deviations (\u00b115 min)</h3>';
      html += '<table class="wb-tacs-table"><thead><tr>';
      html += '<th>Employee</th><th>Scheduled BT</th><th>Days w/ Deviation</th><th>Total Days</th><th></th>';
      html += '</tr></thead><tbody>';

      result.deviations.sort(function(a, b) { return b.devCount - a.devCount; });
      result.deviations.forEach(function(d) {
        html += '<tr>';
        html += '<td class="wb-tacs-name">' + esc(d.name) + '</td>';
        html += '<td>' + formatMinutes(d.scheduled) + '</td>';
        html += '<td style="color:var(--warning);font-weight:600;">' + d.devCount + '</td>';
        html += '<td>' + d.totalDays + '</td>';
        html += '<td><button class="btn btn-outline btn-sm clockring-detail" data-key="' + esc(d.key) + '" style="font-size:0.72rem;padding:1px 6px;">Details</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div id="clockring-detail-view" style="margin-top:0.75rem;"></div>';
    clockOutput.innerHTML = html;

    // Wire detail buttons
    var summaryByEmp = result.summaryByEmp;
    clockOutput.querySelectorAll('.clockring-detail').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var key = btn.dataset.key;
        var emp = summaryByEmp[key];
        if (!emp) return;
        var detailDiv = document.getElementById('clockring-detail-view');
        if (!detailDiv) return;

        var dhtml = '<h4 style="font-size:0.9rem;margin-bottom:0.4rem;">' + esc(emp.name) + ' \u2014 Scheduled: ' + formatMinutes(emp.scheduled) + '</h4>';
        dhtml += '<table class="wb-tacs-table"><thead><tr>';
        dhtml += '<th>Date</th><th>Actual BT</th><th>Scheduled BT</th><th>Diff (min)</th><th>Flag</th>';
        dhtml += '</tr></thead><tbody>';

        emp.details.forEach(function(row) {
          var diffStr = row.diff !== null ? (row.diff > 0 ? '+' : '') + row.diff : '\u2014';
          var rowStyle = row.isDev ? 'background:rgba(255,165,0,0.1);' : '';
          dhtml += '<tr style="' + rowStyle + '">';
          dhtml += '<td>' + esc(row.dateStr) + '</td>';
          dhtml += '<td>' + formatMinutes(row.actualBt) + '</td>';
          dhtml += '<td>' + formatMinutes(row.scheduledBt) + '</td>';
          dhtml += '<td style="' + (row.isDev ? 'color:var(--warning);font-weight:600;' : '') + '">' + diffStr + '</td>';
          dhtml += '<td>' + (row.isDev ? '\u26a0\ufe0f' : '\u2705') + '</td>';
          dhtml += '</tr>';
        });

        dhtml += '</tbody></table>';
        detailDiv.innerHTML = dhtml;
      });
    });

    // Wire validate/exclude/undo buttons for unmatched employees
    var VALIDATED_KEY = 'clerk_obs_clockring_validated_' + reviewId + '_' + currentFin;
    clockOutput.querySelectorAll('.clockring-validate-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var key = btn.dataset.key;
        var validated = {};
        try { validated = JSON.parse(localStorage.getItem(VALIDATED_KEY)) || {}; } catch(e) {}
        validated[key] = { status: 'f4', validatedAt: new Date().toISOString() };
        localStorage.setItem(VALIDATED_KEY, JSON.stringify(validated));
        // Re-run analysis to refresh display
        var savedCsv = localStorage.getItem('clerk_obs_clockring_csv_' + reviewId);
        if (savedCsv) analyzeClockRings(savedCsv, true);
      });
    });
    clockOutput.querySelectorAll('.clockring-exclude-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var key = btn.dataset.key;
        var validated = {};
        try { validated = JSON.parse(localStorage.getItem(VALIDATED_KEY)) || {}; } catch(e) {}
        validated[key] = { status: 'not-f4', validatedAt: new Date().toISOString() };
        localStorage.setItem(VALIDATED_KEY, JSON.stringify(validated));
        var savedCsv = localStorage.getItem('clerk_obs_clockring_csv_' + reviewId);
        if (savedCsv) analyzeClockRings(savedCsv, true);
      });
    });
    clockOutput.querySelectorAll('.clockring-unvalidate-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var key = btn.dataset.key;
        var validated = {};
        try { validated = JSON.parse(localStorage.getItem(VALIDATED_KEY)) || {}; } catch(e) {}
        delete validated[key];
        localStorage.setItem(VALIDATED_KEY, JSON.stringify(validated));
        var savedCsv = localStorage.getItem('clerk_obs_clockring_csv_' + reviewId);
        if (savedCsv) analyzeClockRings(savedCsv, true);
      });
    });
  }

  // ---------- Init ----------

  // Load saved data on page load
  loadDut();
  loadCsaw();
  loadWbQuest();

  // Auto-load reviewer status
  loadReviewerStatus();

  // Restore saved data on page load
  var saved = loadData();
  if (saved.roster && rosterOutput) {
    renderRoster(saved.roster);
  }

  // Restore TACS from saved CSV
  var savedTacsCsv = null;
  try { savedTacsCsv = localStorage.getItem('clerk_obs_tacs_csv_' + reviewId); } catch(e) {}
  if (savedTacsCsv && tacsOutput) {
    analyzeTacs(savedTacsCsv, true);
  }

  // Restore clock rings from saved CSV
  var savedClockCsv = null;
  try { savedClockCsv = localStorage.getItem('clerk_obs_clockring_csv_' + reviewId); } catch(e) {}
  if (savedClockCsv && clockOutput) {
    analyzeClockRings(savedClockCsv, true);
  }

  // Render questionnaire
  renderWbQuestionnaire();

  // ---------- Finalize Pre-Review Checklist ----------

  var finalizeOutput = document.getElementById('wb-finalize-output');
  var finalizeBtn = document.getElementById('wb-finalize-refresh');

  function runChecklist() {
    if (!finalizeOutput) return;

    try {

    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    if (!rev) {
      finalizeOutput.innerHTML = '<p class="empty-state">Review not found (ID: ' + esc(reviewId) + ').</p>';
      return;
    }

    var offices = (rev.offices && rev.offices.length > 0) ? rev.offices : [];
    var items = []; // { status: 'pass'|'fail'|'warn', label, detail, link: { tab, phase } }

    // --- Overall Review Checks ---
    // Dates make sense
    if (!rev.startDate || !rev.endDate) {
      items.push({ status: 'fail', label: 'Review dates not set', detail: 'Set the overall review start and end dates.', link: null });
    } else if (rev.startDate > rev.endDate) {
      items.push({ status: 'fail', label: 'Review start date is after end date', detail: rev.startDate + ' > ' + rev.endDate, link: null });
    } else {
      items.push({ status: 'pass', label: 'Review dates set', detail: rev.startDate + ' to ' + rev.endDate, link: null });
    }

    // No offices defined
    if (offices.length === 0) {
      items.push({ status: 'fail', label: 'No offices configured', detail: 'Add at least one office to the review.', link: null });
    }

    // Travel survey check
    var travelKey = 'clerk_obs_travel_survey_' + reviewId;
    var travelData = null;
    try { travelData = JSON.parse(localStorage.getItem(travelKey)); } catch(e) {}
    var travelAssignments = (travelData && travelData.assignments) ? travelData.assignments : [];
    var travelResponses = (travelData && travelData.responses) ? travelData.responses : {};

    // --- Per-Office Checks ---
    // Clock ring analysis — pass if ANY office has it (cross-office data carries over)
    var anyClockRing = false;
    offices.forEach(function(oc) {
      var f2 = oc.financeNum || '';
      var k2 = 'clerk_obs_workbook_' + reviewId + (f2 ? '_' + f2 : '');
      try {
        var d2 = JSON.parse(localStorage.getItem(k2)) || {};
        if (d2.clockRingPatterns && Object.keys(d2.clockRingPatterns).length > 0) anyClockRing = true;
      } catch(e) {}
    });

    offices.forEach(function(o) {
      var oLabel = o.officeName || o.financeNum || 'Office';
      var fin = o.financeNum || '';
      var wbKey = 'clerk_obs_workbook_' + reviewId + (fin ? '_' + fin : '');
      var schedKey = 'clerk_obs_schedule_' + reviewId + (fin ? '_' + fin : '');
      var wbData = {};
      var schedData = {};
      try { wbData = JSON.parse(localStorage.getItem(wbKey)) || {}; } catch(e) {}
      try { schedData = JSON.parse(localStorage.getItem(schedKey)) || {}; } catch(e) {}

      // 1. Roster
      var roster = wbData.roster || [];
      if (roster.length === 0) {
        items.push({ status: 'fail', label: oLabel + ': No Office Schedule uploaded', detail: 'Upload the roster (.xls) for this office.', link: { tab: 'wb-panel-roster', phase: 'pre-review', fin: fin } });
      } else {
        items.push({ status: 'pass', label: oLabel + ': Office Schedule loaded (' + roster.length + ' employees)', detail: '', link: { tab: 'wb-panel-roster', phase: 'pre-review', fin: fin } });
      }

      // 2. Clock ring analysis — pass if this office or any other has it
      var clockPatterns = wbData.clockRingPatterns || {};
      if (Object.keys(clockPatterns).length > 0) {
        var rangeStr = '';
        if (wbData.clockRingDateRange) {
          var fmt = function(iso) { var dt = new Date(iso); return (dt.getMonth()+1)+'/'+dt.getDate()+'/'+dt.getFullYear(); };
          rangeStr = ' (' + fmt(wbData.clockRingDateRange.from) + ' – ' + fmt(wbData.clockRingDateRange.to) + ')';
        }
        items.push({ status: 'pass', label: oLabel + ': Clock ring analysis complete' + rangeStr, detail: Object.keys(clockPatterns).length + ' employee patterns', link: { tab: 'wb-panel-roster', phase: 'pre-review', fin: fin } });
      } else if (anyClockRing) {
        items.push({ status: 'pass', label: oLabel + ': Clock ring data available (from linked office)', detail: 'TACS data captured from another office upload.', link: { tab: 'wb-panel-roster', phase: 'pre-review', fin: fin } });
      } else {
        items.push({ status: 'warn', label: oLabel + ': No clock ring analysis', detail: 'Upload TACS clock ring CSV to detect BT deviations.', link: { tab: 'wb-panel-roster', phase: 'pre-review', fin: fin } });
      }

      // 3. Schedule built
      var schedule = schedData.schedule || [];
      if (schedule.length === 0) {
        items.push({ status: 'fail', label: oLabel + ': No schedule built', detail: 'Build a review schedule for this office.', link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
      } else {
        items.push({ status: 'pass', label: oLabel + ': Schedule built (' + schedule.length + ' slots)', detail: '', link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
      }

      // 4. Office dates
      if (!o.startDate || !o.endDate) {
        items.push({ status: 'fail', label: oLabel + ': Office review dates not set', detail: 'Set start and end dates on the schedule tab.', link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
      } else if (o.startDate > o.endDate) {
        items.push({ status: 'fail', label: oLabel + ': Office start date after end date', detail: o.startDate + ' > ' + o.endDate, link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
      } else if (rev.startDate && o.startDate < rev.startDate) {
        items.push({ status: 'fail', label: oLabel + ': Office start before review start', detail: o.startDate + ' is before review start ' + rev.startDate, link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
      } else if (rev.endDate && o.endDate > rev.endDate) {
        items.push({ status: 'fail', label: oLabel + ': Office end after review end', detail: o.endDate + ' is after review end ' + rev.endDate, link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
      } else {
        items.push({ status: 'pass', label: oLabel + ': Office dates valid', detail: o.startDate + ' to ' + o.endDate, link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
      }

      // 5. Reviewers assigned
      var assignedNames = schedData.assignedNames || [];
      if (assignedNames.length === 0) {
        items.push({ status: 'fail', label: oLabel + ': No reviewers assigned', detail: 'Assign reviewers to schedule slots.', link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
      } else {
        var unassignedSlots = schedule.filter(function(s) { return !s.assignedTo; });
        if (unassignedSlots.length > 0) {
          items.push({ status: 'warn', label: oLabel + ': ' + unassignedSlots.length + ' slot(s) without assigned reviewer', detail: assignedNames.length + ' reviewers added, but ' + unassignedSlots.length + ' slots unassigned.', link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
        } else {
          items.push({ status: 'pass', label: oLabel + ': All ' + schedule.length + ' slots assigned', detail: assignedNames.length + ' reviewers', link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
        }
      }

      // 6. Daily trips / transport plan
      var dailyTrips = schedData.dailyTrips || {};
      if (schedule.length > 0 && Object.keys(dailyTrips).length === 0) {
        items.push({ status: 'warn', label: oLabel + ': No transport modes set', detail: 'Set Drive In / Uber for each departure group.', link: { tab: 'wb-panel-schedule', phase: 'pre-review', fin: fin } });
      }
    });

    // --- Cross-Office Checks ---

    // Reviewers assigned but not on travel survey
    if (travelAssignments.length === 0) {
      items.push({ status: 'warn', label: 'Travel survey: No travelers added', detail: 'Add team members to the travel survey.', link: { tab: 'wb-panel-travel', phase: 'pre-review' } });
    } else {
      // Check each assigned reviewer across all offices appears in travel survey
      var allAssigned = {};
      offices.forEach(function(o) {
        var fin = o.financeNum || '';
        var schedKey = 'clerk_obs_schedule_' + reviewId + (fin ? '_' + fin : '');
        try {
          var sd = JSON.parse(localStorage.getItem(schedKey)) || {};
          (sd.assignedNames || []).forEach(function(a) { allAssigned[a.name] = true; });
        } catch(e) {}
      });

      var travelNames = {};
      travelAssignments.forEach(function(a) { travelNames[a.name] = true; });

      var missingFromTravel = Object.keys(allAssigned).filter(function(n) { return !travelNames[n]; });
      if (missingFromTravel.length > 0) {
        items.push({ status: 'fail', label: missingFromTravel.length + ' reviewer(s) assigned but not on travel survey', detail: missingFromTravel.join(', '), link: { tab: 'wb-panel-travel', phase: 'pre-review' } });
      }

      // Check for missing travel survey responses
      var noResponse = travelAssignments.filter(function(a) { return !travelResponses[a.userId]; });
      if (noResponse.length > 0) {
        items.push({ status: 'warn', label: noResponse.length + ' traveler(s) haven\'t submitted travel survey', detail: noResponse.map(function(a) { return a.name; }).join(', '), link: { tab: 'wb-panel-travel', phase: 'pre-review' } });
      } else if (travelAssignments.length > 0) {
        items.push({ status: 'pass', label: 'All ' + travelAssignments.length + ' travelers have submitted travel survey', detail: '', link: { tab: 'wb-panel-travel', phase: 'pre-review' } });
      }
    }

    // --- Render ---
    var failCount = items.filter(function(i) { return i.status === 'fail'; }).length;
    var warnCount = items.filter(function(i) { return i.status === 'warn'; }).length;
    var passCount = items.filter(function(i) { return i.status === 'pass'; }).length;

    var html = '<div style="display:flex;gap:1rem;margin-bottom:0.75rem;flex-wrap:wrap;">';
    if (failCount > 0) html += '<span class="info-chip" style="background:#fee2e2;color:#dc2626;"><strong>' + failCount + '</strong> Errors</span>';
    if (warnCount > 0) html += '<span class="info-chip" style="background:#fef3c7;color:#92400e;"><strong>' + warnCount + '</strong> Warnings</span>';
    html += '<span class="info-chip" style="background:#dcfce7;color:#166534;"><strong>' + passCount + '</strong> Passed</span>';
    html += '</div>';

    if (failCount === 0 && warnCount === 0) {
      html += '<div style="padding:1rem;background:#dcfce7;border-radius:8px;border:1px solid #86efac;text-align:center;font-weight:600;color:#166534;font-size:1rem;">✅ All pre-review checks passed! Ready to begin.</div>';
    }

    // Mark pre-review phase button as done when no failures
    var preReviewBtn = document.querySelector('.wb-phase-btn[data-phase="pre-review"]');
    if (preReviewBtn) {
      if (failCount === 0) {
        preReviewBtn.classList.add('wb-phase-btn--done');
        var numSpan = preReviewBtn.querySelector('.wb-phase-num');
        if (numSpan) numSpan.textContent = '✓';
      } else {
        preReviewBtn.classList.remove('wb-phase-btn--done');
        var numSpan2 = preReviewBtn.querySelector('.wb-phase-num');
        if (numSpan2) numSpan2.textContent = '1';
      }
    }

    var icons = { fail: '❌', warn: '⚠️', pass: '✅' };
    var colors = { fail: '#dc2626', warn: '#d97706', pass: '#16a34a' };
    var bgs = { fail: 'rgba(220,38,38,0.06)', warn: 'rgba(217,119,6,0.06)', pass: 'rgba(22,163,74,0.04)' };

    // Show fails first, then warns, then passes
    var sortOrder = { fail: 0, warn: 1, pass: 2 };
    items.sort(function(a, b) { return sortOrder[a.status] - sortOrder[b.status]; });

    items.forEach(function(item) {
      var clickAttr = '';
      var cursorStyle = 'default';
      if (item.link) {
        clickAttr = ' data-link-tab="' + esc(item.link.tab) + '" data-link-phase="' + esc(item.link.phase) + '"';
        if (item.link.fin) clickAttr += ' data-link-fin="' + esc(item.link.fin) + '"';
        cursorStyle = 'pointer';
      }
      html += '<div class="wb-checklist-item" style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.5rem 0.6rem;margin-bottom:0.3rem;border-radius:6px;background:' + bgs[item.status] + ';border-left:3px solid ' + colors[item.status] + ';cursor:' + cursorStyle + ';"' + clickAttr + '>';
      html += '<span style="flex-shrink:0;font-size:0.9rem;">' + icons[item.status] + '</span>';
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-weight:600;font-size:0.85rem;color:' + colors[item.status] + ';">' + esc(item.label) + '</div>';
      if (item.detail) html += '<div style="font-size:0.78rem;color:var(--text-light);margin-top:1px;">' + esc(item.detail) + '</div>';
      if (item.link) html += '<div style="font-size:0.72rem;color:#2563eb;margin-top:2px;">Click to go →</div>';
      html += '</div></div>';
    });

    finalizeOutput.innerHTML = html;

    // Wire click-to-navigate
    finalizeOutput.querySelectorAll('.wb-checklist-item[data-link-tab]').forEach(function(el) {
      el.addEventListener('click', function() {
        var targetTab = el.dataset.linkTab;
        var targetPhase = el.dataset.linkPhase;
        var targetFin = el.dataset.linkFin;

        // Switch office if needed
        if (targetFin && targetFin !== financeNum) {
          var setup2 = {};
          try { setup2 = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e2) {}
          // Find the office name for this fin
          var targetOffice = '';
          offices.forEach(function(o2) {
            if (o2.financeNum === targetFin) targetOffice = o2.officeName || '';
          });
          setup2.financeNum = targetFin;
          setup2.office = targetOffice;
          localStorage.setItem('reviewDaySetup', JSON.stringify(setup2));
          window.location.reload();
          return;
        }

        // Switch phase
        if (targetPhase) {
          document.querySelectorAll('.wb-phase-btn').forEach(function(b) { b.classList.remove('wb-phase-btn--active'); });
          var phaseBtn = document.querySelector('.wb-phase-btn[data-phase="' + targetPhase + '"]');
          if (phaseBtn) {
            phaseBtn.classList.add('wb-phase-btn--active');
            phaseBtn.click();
          }
        }

        // Switch sub-tab
        setTimeout(function() {
          var tabBtn = document.querySelector('.wb-sub-tab[data-wbtab="' + targetTab + '"]');
          if (tabBtn) tabBtn.click();
        }, 100);
      });
    });

    } catch(err) {
      finalizeOutput.innerHTML = '<p class="empty-state" style="color:#dc2626;">Checklist error: ' + esc(err.message) + '</p>';
    }
  }

  if (finalizeBtn) {
    finalizeBtn.addEventListener('click', runChecklist);
  }

  // Auto-run checklist when the Finalize tab is shown
  document.querySelectorAll('.wb-sub-tab').forEach(function(st) {
    st.addEventListener('click', function() {
      if (st.dataset.wbtab === 'wb-panel-finalize') {
        setTimeout(runChecklist, 50);
      }
    });
  });

})();
