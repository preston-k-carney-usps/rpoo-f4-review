// expense.js — Post-Review Expense Report Confirmation
(function() {
  'use strict';



  var setup = {};
  try { setup = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) {}
  var reviewId = setup.reviewId || '';
  var reviewRole = setup.reviewRole || '';

  if (!reviewId) { log('EXIT: no reviewId'); return; }

  var currentUserId = '';
  try {
    if (typeof Auth !== 'undefined' && Auth.currentUser) {
      var u = Auth.currentUser();
      if (u) currentUserId = u.id;
    }
  } catch(e) {}

  if (!currentUserId) { log('EXIT: no userId'); return; }

  var EXPENSE_KEY = 'clerk_obs_expense_' + reviewId;
  var TRAVEL_KEY = 'clerk_obs_travel_survey_' + reviewId;

  function loadData() {
    try {
      var raw = localStorage.getItem(EXPENSE_KEY);
      return raw ? JSON.parse(raw) : { confirmations: {} };
    } catch(e) { return { confirmations: {} }; }
  }

  function saveData(data) {
    try { localStorage.setItem(EXPENSE_KEY, JSON.stringify(data)); } catch(e) {}
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // Get review info (for deadline dates + review name)
  var rev = null;
  try {
    if (typeof Reviews !== 'undefined' && Reviews.getById) {
      rev = Reviews.getById(reviewId);
    }
  } catch(e) {}

  // Get travel survey assignments — these are the people who traveled
  var travelData = { assignments: [], responses: {} };
  try {
    var tRaw = localStorage.getItem(TRAVEL_KEY);
    if (tRaw) travelData = JSON.parse(tRaw);
  } catch(e) {}

  var travelers = travelData.assignments || [];

  // Get all Auth users for email + name lookup
  var allUsers = [];
  try {
    if (typeof Auth !== 'undefined' && Auth.getUsers) {
      allUsers = Auth.getUsers();
    }
  } catch(e) {}



  // Calculate the latest end date across all offices → 1 week after = deadline
  function getDeadlineDate() {
    try {
      if (!rev) return null;
      var latestEnd = null;
      if (rev.offices && rev.offices.length > 0) {
        rev.offices.forEach(function(o) {
          if (o.endDate) {
            var d = new Date(o.endDate + 'T00:00:00');
            if (!latestEnd || d > latestEnd) latestEnd = d;
          }
        });
      }
      if (!latestEnd && rev.endDate) {
        latestEnd = new Date(rev.endDate + 'T00:00:00');
      }
      if (!latestEnd) return null;
      var deadline = new Date(latestEnd);
      deadline.setDate(deadline.getDate() + 7);
      return deadline;
    } catch(e) { return null; }
  }

  function formatDeadline(d) {
    if (!d) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  var isLead = (reviewRole === 'lead' || reviewRole === 'teamlead');
  var deadline = getDeadlineDate();

  // Show deadline in header
  var deadlineEl = document.getElementById('expense-deadline');
  if (deadlineEl && deadline) {
    deadlineEl.textContent = 'Deadline: ' + formatDeadline(deadline);
  }

  // --- TEAM LEAD ROLLUP ---
  var leadSection = document.getElementById('expense-lead-section');
  var leadSummary = document.getElementById('expense-lead-summary');
  var rollupDiv = document.getElementById('expense-rollup');

  if (isLead && leadSection) {
    leadSection.style.display = '';
    renderLeadRollup();
  }

  function renderLeadRollup() {
    if (!rollupDiv) return;

    if (travelers.length === 0) {
      rollupDiv.innerHTML = '<p style="color:var(--text-light);font-size:0.85rem;">No travelers assigned. Set up the Travel Survey first.</p>';
      if (leadSummary) leadSummary.innerHTML = '';
      return;
    }

    var d = loadData();
    var confirmed = 0;
    var total = travelers.length;

    var html = '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;">';
    travelers.forEach(function(a) {
      var name = a.name || a.userId;
      try {
        if (typeof Auth !== 'undefined' && Auth.getUserById) {
          var user = Auth.getUserById(a.userId);
          if (user) name = user.displayName || name;
        }
      } catch(e) {}

      var conf = d.confirmations[a.userId];
      if (conf) confirmed++;

      var tResp = travelData.responses[a.userId];
      var modeIcon = tResp ? (tResp.mode === 'flying' ? '✈️' : '🚗') : '';

      var chipBg = conf ? '#dcfce7' : '#fef3c7';
      var chipColor = conf ? '#166534' : '#92400e';
      var chipBorder = conf ? '#86efac' : '#fde68a';
      var statusIcon = conf ? '✅' : '⏳';
      var confDate = conf ? new Date(conf.confirmedAt).toLocaleDateString() : '';
      var confBy = conf && conf.confirmedBy ? ' (by ' + esc(conf.confirmedBy) + ')' : '';

      html += '<div style="display:inline-flex;align-items:center;gap:0.35rem;padding:0.3rem 0.6rem 0.3rem 0.5rem;';
      html += 'background:' + chipBg + ';border:1px solid ' + chipBorder + ';border-radius:6px;font-size:0.82rem;color:' + chipColor + ';">';
      html += modeIcon + ' <strong>' + esc(name) + '</strong> ' + statusIcon;
      if (confDate) html += ' <span style="font-size:0.72rem;opacity:0.8;">' + confDate + confBy + '</span>';

      // Lead toggle button
      if (conf) {
        html += ' <button class="expense-lead-toggle" data-uid="' + esc(a.userId) + '" data-action="uncheck" title="Mark as pending" style="background:none;border:none;cursor:pointer;font-size:0.85rem;padding:0 2px;color:#991b1b;">✕</button>';
      } else {
        html += ' <button class="expense-lead-toggle" data-uid="' + esc(a.userId) + '" data-action="check" title="Mark as confirmed" style="background:none;border:none;cursor:pointer;font-size:0.85rem;padding:0 2px;color:#166534;">✓</button>';
      }

      html += '</div>';
    });
    html += '</div>';

    rollupDiv.innerHTML = html;

    // Summary
    var pending = total - confirmed;
    if (leadSummary) {
      var s = '';
      s += '<span style="color:#22c55e;font-weight:600;">✅ ' + confirmed + ' Confirmed</span>';
      if (pending > 0) s += '<span style="color:#d97706;font-weight:600;">⏳ ' + pending + ' Pending</span>';
      leadSummary.innerHTML = s;
    }

    // Bind toggle buttons
    rollupDiv.querySelectorAll('.expense-lead-toggle').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var uid = btn.dataset.uid;
        var action = btn.dataset.action;
        var dd = loadData();
        if (action === 'check') {
          // Find reviewer name
          var rName = '';
          try {
            var usr = Auth.getUserById(uid);
            if (usr) rName = usr.displayName || usr.username || '';
          } catch(e) {}
          dd.confirmations[uid] = {
            confirmedAt: new Date().toISOString(),
            name: rName,
            confirmedBy: setup.observerName || 'Review Lead'
          };
        } else {
          delete dd.confirmations[uid];
        }
        saveData(dd);
        renderLeadRollup();
      });
    });
  }

  // --- REMINDER EMAIL ---
  var reminderBtn = document.getElementById('expense-reminder-btn');
  if (reminderBtn && isLead) {
    reminderBtn.addEventListener('click', function() {
      var d = loadData();
      var pendingList = travelers.filter(function(a) { return !d.confirmations[a.userId]; });

      if (pendingList.length === 0) {
        alert('All team members have confirmed their expense reports!');
        return;
      }

      var pendingNames = [];
      var emails = [];
      pendingList.forEach(function(a) {
        var name = a.name || a.userId;
        var user = allUsers.find(function(u) { return u.id === a.userId; });
        if (user) {
          name = user.displayName;
          if (user.email) emails.push(user.email);
        }
        pendingNames.push(name);
      });

      var revName = (rev && rev.name) ? rev.name : '';
      var deadlineStr = deadline ? formatDeadline(deadline) : 'as soon as possible';

      var subject = 'Reminder: Expense Report Pending' + (revName ? ' \u2014 ' + revName : '');

      var body = 'Hello,\n\n';
      body += 'This is a friendly reminder to submit your expense report for the Function 4 Review' + (revName ? ' (' + revName + ')' : '') + '.\n\n';
      body += 'Expense reports must be submitted no later than 1 week after returning from the trip.\n';
      body += 'Deadline: ' + deadlineStr + '\n\n';
      body += 'The following team members have not yet confirmed:\n';
      pendingNames.forEach(function(n) { body += '  - ' + n + '\n'; });
      body += '\nOnce you have submitted your expense report, please log in and confirm it in the Post-Review tab.\n\n';
      body += 'Thank you!';

      var mailto = 'mailto:' + emails.join(',') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      window.open(mailto, '_blank');
    });
  }

  // --- POD / SELF CONFIRMATION ---
  var checkbox = document.getElementById('expense-submitted-check');
  var confirmBtn = document.getElementById('expense-confirm-btn');
  var statusSpan = document.getElementById('expense-confirm-status');

  if (!confirmBtn) return;

  var data = loadData();
  var existing = data.confirmations[currentUserId];
  if (existing) {
    if (checkbox) checkbox.checked = true;
    if (statusSpan) {
      statusSpan.textContent = '\u2713 Confirmed on ' + new Date(existing.confirmedAt).toLocaleString();
      statusSpan.style.color = 'var(--success)';
    }
  }

  confirmBtn.addEventListener('click', function() {
    if (!checkbox || !checkbox.checked) {
      if (statusSpan) { statusSpan.textContent = 'Please check the box to confirm.'; statusSpan.style.color = 'var(--danger)'; }
      return;
    }
    var d = loadData();
    d.confirmations[currentUserId] = {
      confirmedAt: new Date().toISOString(),
      name: setup.observerName || ''
    };
    saveData(d);
    if (statusSpan) {
      statusSpan.textContent = '\u2713 Confirmed!';
      statusSpan.style.color = 'var(--success)';
    }
    if (isLead) renderLeadRollup();
  });

})();
