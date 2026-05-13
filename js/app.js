/**
 * app.js - Logic for the time-entry page (review.html).
 * Reads setup data from localStorage, provides editable info bar,
 * manages entry cards, EOD validation, and submission tracking.
 */

document.addEventListener('DOMContentLoaded', function() {
  // Auth guard
  var authUser = Auth.requireAuth(['admin', 'teamlead', 'reviewer']);
  if (!authUser) return;
  Auth.renderNavbar();

  // POD reviewers: manual sync mode — data saves locally, only pushes on End of Day submit
  if (authUser.role === 'reviewer' && window.AppSync && AppSync.setManualMode) {
    AppSync.setManualMode(true);
  }

  const container  = document.getElementById('rows-container');
  const noRowsMsg  = document.getElementById('no-rows-msg');

  // Create inline add-row button
  var addRowWrap = document.createElement('div');
  addRowWrap.className = 'inline-add-row';
  addRowWrap.id = 'inline-add-row';
  addRowWrap.innerHTML = '<button id="add-row-btn" class="btn btn-primary">+ Add Row</button>';
  container.parentNode.insertBefore(addRowWrap, container.nextSibling);
  const addRowBtn = document.getElementById('add-row-btn');

  // --- Info bar elements ---
  const officeInput    = document.getElementById('office');
  const dateInput      = document.getElementById('obs-date');
  const dayNumInput    = document.getElementById('day-number');
  const observerInput  = document.getElementById('observer-name');
  const dispOffice     = document.getElementById('disp-office');
  const dispDate       = document.getElementById('disp-date');
  const dispDay        = document.getElementById('disp-day');
  const dispObserver   = document.getElementById('disp-observer');
  const dispRole       = document.getElementById('disp-role');
  const infoDisplay    = document.getElementById('obs-info-display');
  const infoEdit       = document.getElementById('obs-info-edit');
  const toggleInfoBtn  = document.getElementById('toggle-info-btn');
  const doneEditBtn    = document.getElementById('done-edit-btn');

  let rowCounter = 0;

  // --- Load setup data from localStorage + URL params ---
  var setupRaw = localStorage.getItem('reviewDaySetup');
  var setup = {};
  if (setupRaw) {
    try { setup = JSON.parse(setupRaw); } catch(e) {}
  }

  // Check URL params as fallback/override (more reliable than localStorage alone)
  var urlParams = new URLSearchParams(window.location.search);
  var urlRid = urlParams.get('rid');
  var urlDay = urlParams.get('day');
  if (urlRid) {
    // URL params present — use them, and rebuild setup from review data if needed
    setup.reviewId = urlRid;
    if (urlDay) setup.dayNumber = urlDay;

    // If localStorage setup is incomplete, rebuild from Reviews data
    if (!setup.office || !setup.financeNum) {
      var rev = (typeof Reviews !== 'undefined' && Reviews.getById) ? Reviews.getById(urlRid) : null;
      if (rev) {
        var firstOff = (rev.offices && rev.offices.length > 0) ? rev.offices[0] : null;
        setup.office = firstOff ? firstOff.officeName : (rev.officeName || '');
        setup.financeNum = firstOff ? firstOff.financeNum : (rev.financeNum || '');
        // Compute observation date from start date + day offset
        var baseDate = (firstOff && firstOff.startDate) ? firstOff.startDate : (rev.startDate || '');
        if (baseDate && setup.dayNumber) {
          var dd = new Date(baseDate + 'T00:00:00');
          var dayOff = (parseInt(setup.dayNumber, 10) || 1) - 1;
          if (dayOff > 0) dd.setDate(dd.getDate() + dayOff);
          setup.date = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
        } else {
          setup.date = baseDate || setup.date;
        }
        // Find user's role in this review (teamlead trumps lead)
        if (!setup.reviewRole && rev.assignments) {
          var foundRole = '';
          for (var ai = 0; ai < rev.assignments.length; ai++) {
            if (rev.assignments[ai].userId === authUser.id) {
              var r = rev.assignments[ai].reviewRole;
              if (r === 'teamlead') { foundRole = r; break; }
              if (!foundRole) foundRole = r;
            }
          }
          if (foundRole) setup.reviewRole = foundRole;
        }
      }
    } else {
      // Even if setup looks complete, refresh date from current review data
      var rev2 = (typeof Reviews !== 'undefined' && Reviews.getById) ? Reviews.getById(urlRid) : null;
      if (rev2) {
        var off2 = null;
        if (rev2.offices) {
          for (var oi = 0; oi < rev2.offices.length; oi++) {
            if (rev2.offices[oi].financeNum === setup.financeNum) { off2 = rev2.offices[oi]; break; }
          }
        }
        var freshDate = (off2 && off2.startDate) ? off2.startDate : rev2.startDate;
        if (freshDate && setup.dayNumber) {
          var dd2 = new Date(freshDate + 'T00:00:00');
          var dayOff2 = (parseInt(setup.dayNumber, 10) || 1) - 1;
          if (dayOff2 > 0) dd2.setDate(dd2.getDate() + dayOff2);
          setup.date = dd2.getFullYear() + '-' + String(dd2.getMonth() + 1).padStart(2, '0') + '-' + String(dd2.getDate()).padStart(2, '0');
        } else if (freshDate) {
          setup.date = freshDate;
        }
      }
    }
    if (!setup.observerName) setup.observerName = authUser.displayName || '';
    // Persist rebuilt setup
    localStorage.setItem('reviewDaySetup', JSON.stringify(setup));
  }

  // If still no setup data, try to recover from user's most recent draft
  if (!setup.reviewId) {
    var recoveryObs = Storage.hydrate(Storage.getAll());
    var latestDraft = null;
    for (var ri = 0; ri < recoveryObs.length; ri++) {
      var ro = recoveryObs[ri];
      if (ro.userId === authUser.id && ro.status === 'draft') {
        if (!latestDraft || ro.createdAt > latestDraft.createdAt) {
          latestDraft = ro;
        }
      }
    }
    if (latestDraft) {
      setup = {
        reviewId: latestDraft.reviewId || '',
        office: latestDraft.office || '',
        financeNum: latestDraft.financeNum || '',
        date: latestDraft.date || '',
        dayNumber: latestDraft.dayNumber || '1',
        observerName: latestDraft.observerName || '',
        reviewRole: latestDraft.reviewRole || ''
      };
      localStorage.setItem('reviewDaySetup', JSON.stringify(setup));
    }
  }

  officeInput.value   = setup.office || '';
  dateInput.value     = setup.date || new Date().toISOString().slice(0, 10);
  dayNumInput.value   = setup.dayNumber || '';
  observerInput.value = setup.observerName || authUser.displayName || '';

  var reviewRole = setup.reviewRole || '';
  var reviewId = setup.reviewId || '';
  var financeNum = setup.financeNum || '';
  var roleBadge = { clerk: 'Clerk', mailhandler: 'Mail Handler', lead: 'Workbook Lead', teamlead: 'Review Lead' };

  // --- Mail Handler mode detection ---
  var isMH = (reviewRole === 'mailhandler');
  var employeeInput = document.getElementById('employee-name');
  var dispEmployee = document.getElementById('disp-employee');

  // Show/hide MH-specific elements
  document.querySelectorAll('.mh-only').forEach(function(el) { el.hidden = !isMH; });

  if (isMH) {
    // Hide clerk-only tabs, show MH tab
    var clerkTab = document.querySelector('.review-tab[data-tab="tab-clerk-notes"]');
    var mhTab = document.querySelector('.review-tab[data-tab="tab-mh-notes"]');
    var adusTab = document.querySelector('.review-tab[data-tab="tab-adus"]');
    var questTab = document.querySelector('.review-tab[data-tab="tab-questionnaire"]');
    if (clerkTab) clerkTab.hidden = true;
    if (mhTab) { mhTab.hidden = false; mhTab.classList.add('active'); }
    if (adusTab) adusTab.hidden = true;
    if (questTab) questTab.hidden = true;
    // Switch active panel
    var clerkPanel = document.getElementById('tab-clerk-notes');
    var mhPanel = document.getElementById('tab-mh-notes');
    if (clerkPanel) clerkPanel.classList.remove('active');
    if (mhPanel) mhPanel.classList.add('active');
    // Hide clerk inline add-row
    var clerkAddRow = document.getElementById('inline-add-row');
    if (clerkAddRow) clerkAddRow.style.display = 'none';
    // Show MH inline add-row
    var mhAddRowWrap = document.getElementById('mh-inline-add-row');
    if (mhAddRowWrap) mhAddRowWrap.style.display = '';
    // Load employee name
    if (employeeInput) employeeInput.value = setup.employeeName || '';
    if (dispEmployee) dispEmployee.textContent = setup.employeeName || '\u2014';
  }

  // --- Workbook Lead mode ---
  var isLead = (reviewRole === 'lead' || reviewRole === 'teamlead');
  var isLeadUser = isLead || (setup.isLeadUser === true);
  var _urlMode = new URLSearchParams(window.location.search).get('mode');
  var isWorkbookMode = isLead && (_urlMode !== 'notes');
  var isLeadNotesMode = (isLeadUser && !isLead) || (isLead && _urlMode === 'notes');

  // --- Office Switcher for multi-office reviews ---
  var currentRev = (typeof Reviews !== 'undefined' && Reviews.getById) ? Reviews.getById(reviewId) : null;

  if (isLeadUser) {
    // Hide the observation info bar for leads in manage mode
    var obsInfoSection = document.getElementById('obs-info-section');
    if (obsInfoSection && !isLeadNotesMode) obsInfoSection.hidden = true;

    // Hide POD phase bar for leads (day toggle stays visible)
    var _podPhaseBar = document.getElementById('pod-phase-bar');
    if (_podPhaseBar) _podPhaseBar.hidden = true;

    // Show the title bar with review name (no date) + office buttons inline
    var wbModeBar = document.getElementById('wb-mode-bar');
    if (wbModeBar) {
      wbModeBar.hidden = false;
      var titleEl = document.getElementById('wb-review-title');
      if (titleEl && currentRev) {
        titleEl.textContent = currentRev.name || currentRev.officeName || 'Review';
      }

      // Show overall review date pickers for team leads
      var revDatesWrap = document.getElementById('wb-review-dates');
      var revStartInput = document.getElementById('wb-rev-start');
      var revEndInput = document.getElementById('wb-rev-end');
      if (revDatesWrap && revStartInput && revEndInput && currentRev) {
        revDatesWrap.style.display = 'flex';
        revStartInput.value = currentRev.startDate || '';
        revEndInput.value = currentRev.endDate || '';

        revStartInput.addEventListener('change', function() {
          var val = revStartInput.value;
          if (revEndInput.value && val > revEndInput.value) {
            revEndInput.value = val;
            Reviews.update(currentRev.id, { startDate: val, endDate: val });
          } else {
            Reviews.update(currentRev.id, { startDate: val });
          }
          // Refresh office buttons to reflect new range
          window.location.reload();
        });
        revEndInput.addEventListener('change', function() {
          var val = revEndInput.value;
          if (revStartInput.value && val < revStartInput.value) {
            revStartInput.value = val;
            Reviews.update(currentRev.id, { startDate: val, endDate: val });
          } else {
            Reviews.update(currentRev.id, { endDate: val });
          }
          window.location.reload();
        });
      }

      // Build office buttons with dates + assignment status
      var officeBtns = document.getElementById('wb-office-btns');
      if (officeBtns && currentRev && currentRev.offices && currentRev.offices.length > 0) {
        officeBtns.innerHTML = '';
        var isLead = (authUser.role === 'admin' || authUser.role === 'teamlead');
        currentRev.offices.forEach(function(o) {
          var btn = document.createElement('button');
          btn.className = 'wb-mode-btn';
          // Format dates compactly
          var dateStr = '';
          if (o.startDate && o.endDate) {
            var s = new Date(o.startDate + 'T00:00:00');
            var e = new Date(o.endDate + 'T00:00:00');
            dateStr = ' (' + (s.getMonth()+1) + '/' + s.getDate() + ' – ' + (e.getMonth()+1) + '/' + e.getDate() + ')';
          }

          // Check assignment completeness for leads
          if (isLead) {
            var fin = o.financeNum || '';
            var schedKey = 'clerk_obs_schedule_' + currentRev.id + (fin ? '_' + fin : '');
            var schedData = {};
            try { schedData = JSON.parse(localStorage.getItem(schedKey)) || {}; } catch(e2) {}
            var schedule = schedData.schedule || [];
            var assignedNames = schedData.assignedNames || [];
            var hasDates = !!(o.startDate && o.endDate);
            var allAssigned = schedule.length > 0 && assignedNames.length > 0 &&
              schedule.every(function(slot) { return !!slot.assignedTo; });
            if (hasDates && allAssigned) {
              btn.classList.add('wb-mode-btn--complete');
            } else {
              btn.classList.add('wb-mode-btn--incomplete');
            }
          }

          btn.textContent = o.officeName + dateStr;
          // Add status indicator icon for leads
          if (isLead && btn.classList.contains('wb-mode-btn--complete')) {
            btn.innerHTML = '&#10003; ' + btn.textContent;
          } else if (isLead && btn.classList.contains('wb-mode-btn--incomplete')) {
            btn.innerHTML = '&#9888; ' + btn.textContent;
          }
          btn.dataset.fin = o.financeNum;
          btn.dataset.office = o.officeName;
          if (o.financeNum === financeNum || o.officeName === setup.office) btn.classList.add('wb-mode-btn--active');
          btn.addEventListener('click', function() {
            // Update setup data with office-specific date
            setup.office = o.officeName;
            setup.financeNum = o.financeNum;
            setup.date = o.startDate || setup.date;
            localStorage.setItem('reviewDaySetup', JSON.stringify(setup));
            // Reload page with same params to pick up new office
            var params = new URLSearchParams(window.location.search);
            window.location.href = 'review.html?' + params.toString();
          });
          officeBtns.appendChild(btn);
        });
        // Fallback: if no button is active, activate the first one
        if (!officeBtns.querySelector('.wb-mode-btn--active') && officeBtns.firstChild) {
          officeBtns.firstChild.classList.add('wb-mode-btn--active');
        }
      }
    }

    // Always hide the questionnaire from the main tabs (it lives in workbook sub-tabs)
    var mainQuestTab = document.querySelector('.review-tab[data-tab="tab-questionnaire"]');
    if (mainQuestTab) mainQuestTab.hidden = true;

    // The workbook panel (no tab button — controlled by mode bar)
    var wbPanel = document.getElementById('tab-workbook');

    // Collect all main reviewer tabs
    var reviewerTabs = document.querySelectorAll('.review-tab');

    function enterWorkbookMode() {
      // Deactivate all main tabs and panels
      document.querySelectorAll('.review-tab').forEach(function(t) { t.classList.remove('active'); t.hidden = true; });
      document.querySelectorAll('.review-tab-panel').forEach(function(p) { p.classList.remove('active'); });
      // Show workbook panel (no tab button needed)
      if (wbPanel) wbPanel.classList.add('active');
      // Show WORKBOOK phase bar only (not POD phase bar)
      document.querySelectorAll('.wb-phase-bar').forEach(function(el) {
        if (el.id === 'pod-phase-bar') { el.hidden = true; }
        else { el.hidden = false; }
      });
      var activePhase = document.querySelector('.wb-phase-btn--active');
      document.querySelectorAll('.wb-phase-tabs').forEach(function(el) {
        el.style.display = (activePhase && el.dataset.phase === activePhase.dataset.phase) ? '' : 'none';
      });
      // Hide obs info bar and day toggle in manage mode
      var obsInfoSection = document.getElementById('obs-info-section');
      if (obsInfoSection) obsInfoSection.hidden = true;
      var dayToggle = document.getElementById('pod-day-toggle');
      if (dayToggle) dayToggle.hidden = true;
      // Update toggle
      var manageBtn = document.getElementById('wb-mode-manage');
      var notesBtn = document.getElementById('wb-mode-notes');
      if (manageBtn) manageBtn.classList.add('wb-lead-toggle--active');
      if (notesBtn) notesBtn.classList.remove('wb-lead-toggle--active');
    }

    function enterNotesMode() {
      // Hide workbook panel
      if (wbPanel) wbPanel.classList.remove('active');
      // Hide phase bar and ALL phase sub-tab bars
      document.querySelectorAll('.wb-phase-bar').forEach(function(el) { el.hidden = true; });
      document.querySelectorAll('.wb-phase-tabs').forEach(function(el) { el.style.display = 'none'; });
      // Hide all workbook sub-panels
      document.querySelectorAll('.wb-sub-panel').forEach(function(el) { el.classList.remove('wb-sub-panel--active'); });
      // Show reviewer tabs
      var tabsToShow = ['tab-clerk-notes', 'tab-ps3922', 'tab-trips', 'tab-scf', 'tab-adus', 'tab-summary-comments', 'tab-schedules', 'tab-endofday'];
      document.querySelectorAll('.review-tab').forEach(function(t) {
        if (tabsToShow.indexOf(t.dataset.tab) !== -1) {
          t.hidden = false;
        } else {
          t.hidden = true;
        }
      });
      // Activate clerk notes by default
      document.querySelectorAll('.review-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.review-tab-panel').forEach(function(p) { p.classList.remove('active'); });
      var clerkTab = document.querySelector('.review-tab[data-tab="tab-clerk-notes"]');
      if (clerkTab) {
        clerkTab.classList.add('active');
        clerkTab.click();
      }
      // Show the obs info bar
      var obsInfoSection = document.getElementById('obs-info-section');
      if (obsInfoSection) obsInfoSection.hidden = false;
      // Show Day 1 / Day 2 toggle for lead notes mode
      var leadDayToggle = document.getElementById('pod-day-toggle');
      if (leadDayToggle) {
        leadDayToggle.hidden = false;
        var leadDayBtns = leadDayToggle.querySelectorAll('.pod-day-btn');
        var currentDay = setup.dayNumber || '1';
        leadDayBtns.forEach(function(b) {
          b.classList.toggle('wb-lead-toggle--active', b.dataset.day === currentDay);
        });
        leadDayBtns.forEach(function(btn) {
          btn.onclick = function() {
            var newDay = btn.dataset.day;
            leadDayBtns.forEach(function(b) { b.classList.remove('wb-lead-toggle--active'); });
            btn.classList.add('wb-lead-toggle--active');
            setup.dayNumber = newDay;
            if (dayNumInput) dayNumInput.value = newDay;
            localStorage.setItem('reviewDaySetup', JSON.stringify(setup));
            window.location.href = 'review.html?rid=' + encodeURIComponent(reviewId) + '&day=' + encodeURIComponent(newDay) + '&mode=notes';
          };
        });
      }
      // Update toggle
      var manageBtn = document.getElementById('wb-mode-manage');
      var notesBtn = document.getElementById('wb-mode-notes');
      if (manageBtn) manageBtn.classList.remove('wb-lead-toggle--active');
      if (notesBtn) notesBtn.classList.add('wb-lead-toggle--active');
    }

    // Mode button handler
    var wbModeWorkbook = document.getElementById('wb-mode-workbook');
    if (wbModeWorkbook) wbModeWorkbook.addEventListener('click', function() {
      enterWorkbookMode();
    });

    // Lead mode toggle handlers
    var wbModeManage = document.getElementById('wb-mode-manage');
    var wbModeNotes = document.getElementById('wb-mode-notes');
    if (wbModeManage) wbModeManage.addEventListener('click', function() {
      // Navigate back to workbook manage mode — preserve actual role
      var origRole = 'lead';
      if (currentRev && currentRev.assignments) {
        for (var ri = 0; ri < currentRev.assignments.length; ri++) {
          var a = currentRev.assignments[ri];
          if (a.userId === authUser.id) {
            if (a.reviewRole === 'teamlead') { origRole = 'teamlead'; break; }
            if (a.reviewRole === 'lead' && origRole !== 'teamlead') origRole = 'lead';
          }
        }
      }
      if (authUser.role === 'teamlead' && origRole === 'lead') origRole = 'teamlead';
      setup.reviewRole = origRole;
      delete setup.isLeadUser;
      localStorage.setItem('reviewDaySetup', JSON.stringify(setup));
      var params = new URLSearchParams(window.location.search);
      params.set('mode', 'workbook');
      window.location.href = 'review.html?' + params.toString();
    });
    if (wbModeNotes) wbModeNotes.addEventListener('click', function() {
      var params = new URLSearchParams(window.location.search);
      params.set('mode', 'notes');
      window.location.href = 'review.html?' + params.toString();
    });

    // Phase toggle (Pre-Review / Review) inside workbook
    var phaseBtns = document.querySelectorAll('.wb-phase-btn');
    var phaseTabBars = document.querySelectorAll('.wb-phase-tabs');
    var subPanels = document.querySelectorAll('.wb-sub-panel');

    phaseBtns.forEach(function(pb) {
      pb.addEventListener('click', function() {
        var phase = pb.dataset.phase;
        phaseBtns.forEach(function(b) { b.classList.remove('wb-phase-btn--active'); });
        pb.classList.add('wb-phase-btn--active');

        // Show matching tab bar, hide others
        phaseTabBars.forEach(function(bar) {
          bar.style.display = bar.dataset.phase === phase ? '' : 'none';
        });

        // Activate first sub-tab of active phase
        var activeBar = document.querySelector('.wb-phase-tabs[data-phase="' + phase + '"]');
        if (activeBar) {
          var firstBtn = activeBar.querySelector('.wb-sub-tab');
          if (firstBtn) {
            document.querySelectorAll('.wb-sub-tab').forEach(function(t) { t.classList.remove('wb-sub-tab--active'); });
            subPanels.forEach(function(p) { p.classList.remove('wb-sub-panel--active'); });
            firstBtn.classList.add('wb-sub-tab--active');
            var panel = document.getElementById(firstBtn.dataset.wbtab);
            if (panel) panel.classList.add('wb-sub-panel--active');
          }
        }
      });
    });

    // Sub-tab switching inside workbook
    var subTabs = document.querySelectorAll('.wb-sub-tab');
    subTabs.forEach(function(st) {
      st.addEventListener('click', function() {
        subTabs.forEach(function(t) { t.classList.remove('wb-sub-tab--active'); });
        subPanels.forEach(function(p) { p.classList.remove('wb-sub-panel--active'); });
        st.classList.add('wb-sub-tab--active');
        var panel = document.getElementById(st.dataset.wbtab);
        if (panel) panel.classList.add('wb-sub-panel--active');
      });
    });

    if (isLeadNotesMode) {
      // Lead launched a day — show notes mode with toggle
      enterNotesMode();
    } else if (isWorkbookMode) {
      enterWorkbookMode();
    }
  }

  // --- POD Phase Tabs (non-lead reviewers) ---
  if (!isLeadUser && reviewId) {
    var podPhaseBar = document.getElementById('pod-phase-bar');
    var podPhaseBtns = document.querySelectorAll('.pod-phase-btn');
    var reviewTabs = document.querySelector('.review-tabs');
    var travelTab = document.querySelector('.review-tab[data-tab="tab-travel-survey"]');
    var travelPanel = document.getElementById('tab-travel-survey');
    var podPostPanel = document.getElementById('pod-post-review');
    var allReviewTabs = document.querySelectorAll('.review-tab');
    var allTabPanels = document.querySelectorAll('.review-tab-panel');
    var podDayToggle = document.getElementById('pod-day-toggle');

    // --- Day 1 / Day 2 toggle ---
    if (podDayToggle) {
      podDayToggle.hidden = false;
      var podDayBtns = podDayToggle.querySelectorAll('.pod-day-btn');
      var currentDay = setup.dayNumber || '1';
      // Set initial active state
      podDayBtns.forEach(function(b) {
        b.classList.toggle('wb-lead-toggle--active', b.dataset.day === currentDay);
      });
      podDayBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          var newDay = btn.dataset.day;
          podDayBtns.forEach(function(b) { b.classList.remove('wb-lead-toggle--active'); });
          btn.classList.add('wb-lead-toggle--active');
          setup.dayNumber = newDay;
          if (dayNumInput) dayNumInput.value = newDay;
          localStorage.setItem('reviewDaySetup', JSON.stringify(setup));
          window.location.href = 'review.html?rid=' + encodeURIComponent(reviewId) + '&day=' + encodeURIComponent(newDay);
        });
      });
    }

    if (podPhaseBar) {
      podPhaseBar.hidden = false;

      // POD expense confirmation logic
      var POD_EXP_KEY = 'clerk_obs_expense_' + reviewId;
      var podExpCheck = document.getElementById('pod-expense-check');
      var podExpConfirm = document.getElementById('pod-expense-confirm');
      var podExpStatus = document.getElementById('pod-expense-status');
      var podExpDeadline = document.getElementById('pod-expense-deadline');

      // Show deadline if review has end date
      if (podExpDeadline && currentRev && currentRev.endDate) {
        var expEnd = new Date(currentRev.endDate + 'T23:59:59');
        expEnd.setDate(expEnd.getDate() + 5);
        podExpDeadline.textContent = 'Due by ' + (expEnd.getMonth()+1) + '/' + expEnd.getDate() + '/' + expEnd.getFullYear();
      }

      // Load saved POD expense status
      (function loadPodExpense() {
        try {
          var data = JSON.parse(localStorage.getItem(POD_EXP_KEY)) || {};
          if (data[authUser.id]) {
            if (podExpCheck) podExpCheck.checked = true;
            if (podExpCheck) podExpCheck.disabled = true;
            if (podExpConfirm) podExpConfirm.disabled = true;
            if (podExpStatus) { podExpStatus.textContent = '✓ Confirmed'; podExpStatus.style.color = 'var(--success)'; }
          }
        } catch(e) {}
      })();

      if (podExpConfirm) podExpConfirm.addEventListener('click', function() {
        if (!podExpCheck || !podExpCheck.checked) return;
        try {
          var data = JSON.parse(localStorage.getItem(POD_EXP_KEY)) || {};
          data[authUser.id] = { confirmedAt: new Date().toISOString(), name: authUser.displayName || '' };
          localStorage.setItem(POD_EXP_KEY, JSON.stringify(data));
          podExpCheck.disabled = true;
          podExpConfirm.disabled = true;
          if (podExpStatus) { podExpStatus.textContent = '✓ Confirmed'; podExpStatus.style.color = 'var(--success)'; }
        } catch(e) {}
      });

      function podSwitchPhase(phase) {
        podPhaseBtns.forEach(function(b) { b.classList.remove('wb-phase-btn--active'); });
        document.querySelector('.pod-phase-btn[data-pod-phase="' + phase + '"]').classList.add('wb-phase-btn--active');

        if (phase === 'pod-pre') {
          // Show Travel Survey + Schedules + Documents tabs only
          if (reviewTabs) reviewTabs.style.display = '';
          allTabPanels.forEach(function(p) { p.classList.remove('active'); });
          if (podPostPanel) podPostPanel.hidden = true;
          allReviewTabs.forEach(function(t) { t.style.display = 'none'; });
          if (travelTab) { travelTab.hidden = false; travelTab.style.display = ''; travelTab.click(); }
          var schedTab = document.querySelector('.review-tab[data-tab="tab-schedules"]');
          if (schedTab) { schedTab.style.display = ''; }
          var docsTabPre = document.querySelector('.review-tab[data-tab="tab-documents"]');
          if (docsTabPre) { docsTabPre.style.display = ''; docsTabPre.hidden = false; }
        } else if (phase === 'pod-review') {
          // Show normal review tabs (no travel, no schedules) + documents
          if (reviewTabs) reviewTabs.style.display = '';
          if (podPostPanel) podPostPanel.hidden = true;
          allReviewTabs.forEach(function(t) { t.style.display = ''; });
          // Hide travel tab and schedules tab in review phase
          if (travelTab) { travelTab.hidden = true; travelTab.style.display = 'none'; }
          var schedTabR = document.querySelector('.review-tab[data-tab="tab-schedules"]');
          if (schedTabR) { schedTabR.style.display = 'none'; }
          // Keep documents tab visible
          var docsTabRev = document.querySelector('.review-tab[data-tab="tab-documents"]');
          if (docsTabRev) { docsTabRev.style.display = ''; docsTabRev.hidden = false; }
          // Click the first visible tab
          var firstTab = reviewTabs ? reviewTabs.querySelector('.review-tab:not([hidden]):not([style*=\"display: none\"])') : null;
          if (firstTab) firstTab.click();
        } else if (phase === 'pod-post') {
          // Show expense panel only
          if (reviewTabs) reviewTabs.style.display = 'none';
          allTabPanels.forEach(function(p) { p.classList.remove('active'); });
          if (podPostPanel) podPostPanel.hidden = false;
        }
      }

      podPhaseBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          podSwitchPhase(btn.dataset.podPhase);
        });
      });

      // Default to Review phase
      podSwitchPhase('pod-review');
    }
  }

  // --- MH Access Panel for mailhandler reviewers ---
  if (isMH && typeof MhAccess !== 'undefined') {
    var mhAccessPanel = document.getElementById('mh-access-panel');
    var mhAccessBody = document.getElementById('mh-access-body');
    var mhAccessList = document.getElementById('mh-access-list');
    var mhAccessBadge = document.getElementById('mh-access-badge');
    var mhAccessToggle = document.getElementById('mh-access-toggle');

    if (mhAccessPanel && mhAccessList) {
      mhAccessPanel.hidden = false;

      // Toggle expand/collapse
      if (mhAccessToggle) {
        mhAccessToggle.addEventListener('click', function() {
          var showing = mhAccessBody.style.display !== 'none';
          mhAccessBody.style.display = showing ? 'none' : '';
        });
      }

      function renderMhAccessPanel() {
        var slots = MhAccess.getMhSlots(reviewId);
        var currentEmp = (setup.employeeName || '').trim();
        var accessData = MhAccess.loadAccess(reviewId);
        var pendingCount = 0;

        // Check for incoming requests on MY assigned MH (I can approve those)
        var myAssignedMhs = [];
        slots.forEach(function(s) {
          if (s.assignedUserId === authUser.id) myAssignedMhs.push(s.mhName);
        });

        var html = '';

        // Show incoming requests for my assigned MH(s)
        var incomingReqs = accessData.requests.filter(function(r) {
          return r.status === 'pending' && myAssignedMhs.indexOf(r.mhName) >= 0;
        });
        if (incomingReqs.length > 0) {
          html += '<div style="margin-bottom:0.75rem;padding:0.5rem 0.65rem;background:#fef3c7;border:1px solid #fcd34d;border-radius:var(--radius);">';
          html += '<div style="font-weight:700;font-size:0.8rem;margin-bottom:0.3rem;">🔔 Incoming Requests</div>';
          incomingReqs.forEach(function(req) {
            html += '<div style="display:flex;align-items:center;gap:0.4rem;padding:0.25rem 0;flex-wrap:wrap;">';
            html += '<span style="font-size:0.78rem;flex:1;"><strong>' + _esc(req.userName) + '</strong> wants access to <strong>' + _esc(req.mhName) + '</strong></span>';
            html += '<button class="btn btn-sm mh-panel-approve" data-req-id="' + req.id + '" style="background:#22c55e;color:#fff;border:none;font-size:0.68rem;padding:0.12rem 0.4rem;">✓ Approve</button>';
            html += '<button class="btn btn-sm mh-panel-deny" data-req-id="' + req.id + '" style="background:#ef4444;color:#fff;border:none;font-size:0.68rem;padding:0.12rem 0.4rem;">✕ Deny</button>';
            html += '</div>';
          });
          html += '</div>';
          pendingCount += incomingReqs.length;
        }

        // Show other MH employees I can request access to
        var otherMhs = slots.filter(function(s) {
          return s.mhName !== currentEmp && !MhAccess.hasAccess(reviewId, authUser.id, s.mhName);
        });

        if (otherMhs.length > 0) {
          html += '<div style="font-weight:600;font-size:0.82rem;margin-bottom:0.3rem;">Other MH Employees</div>';
          otherMhs.forEach(function(s) {
            var myPending = accessData.requests.some(function(r) {
              return r.userId === authUser.id && r.mhName === s.mhName && r.status === 'pending';
            });
            html += '<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;border-bottom:1px solid var(--border);">';
            html += '<div style="flex:1;min-width:0;">';
            html += '<div style="font-weight:600;font-size:0.82rem;">' + _esc(s.mhName) + '</div>';
            if (s.assignedTo) html += '<div style="font-size:0.72rem;color:var(--text-light);">Assigned: ' + _esc(s.assignedTo) + '</div>';
            html += '</div>';
            if (myPending) {
              html += '<span style="font-size:0.72rem;color:#d97706;font-weight:600;">⏳ Pending</span>';
            } else {
              html += '<button class="btn btn-outline btn-sm mh-panel-request" data-mh-name="' + _esc(s.mhName) + '" style="font-size:0.68rem;padding:0.12rem 0.45rem;color:#7c3aed;border-color:#7c3aed;">Request Access</button>';
            }
            html += '</div>';
          });
        }

        // Show my approved grants
        var myGrants = MhAccess.getUserGrants(reviewId, authUser.id);
        if (myGrants.length > 0) {
          html += '<div style="font-weight:600;font-size:0.82rem;margin:0.5rem 0 0.3rem;">✓ Granted Access</div>';
          myGrants.forEach(function(g) {
            html += '<div style="display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0;">';
            html += '<span style="font-size:0.8rem;color:var(--success);flex:1;">✓ ' + _esc(g.mhName) + '</span>';
            html += '<button class="btn btn-outline btn-sm mh-panel-open" data-mh-name="' + _esc(g.mhName) + '" style="font-size:0.68rem;padding:0.12rem 0.45rem;">Open Notes</button>';
            html += '</div>';
          });
        }

        if (!html) {
          html = '<p style="font-size:0.78rem;color:var(--text-light);">No other MH employees available.</p>';
        }

        mhAccessList.innerHTML = html;

        // Show badge for pending actions
        if (mhAccessBadge) {
          if (pendingCount > 0) {
            mhAccessBadge.textContent = pendingCount + ' pending';
            mhAccessBadge.style.display = '';
          } else {
            mhAccessBadge.style.display = 'none';
          }
        }

        // Wire buttons
        mhAccessList.querySelectorAll('.mh-panel-approve').forEach(function(btn) {
          btn.addEventListener('click', function() {
            MhAccess.approveRequest(reviewId, btn.dataset.reqId, authUser.displayName || authUser.username || '');
            renderMhAccessPanel();
          });
        });
        mhAccessList.querySelectorAll('.mh-panel-deny').forEach(function(btn) {
          btn.addEventListener('click', function() {
            MhAccess.denyRequest(reviewId, btn.dataset.reqId, authUser.displayName || authUser.username || '');
            renderMhAccessPanel();
          });
        });
        mhAccessList.querySelectorAll('.mh-panel-request').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var mhName = btn.dataset.mhName;
            if (!confirm('Request access to follow ' + mhName + '?')) return;
            MhAccess.submitAccessRequest(reviewId, authUser.id, authUser.displayName || authUser.username || '', mhName);
            renderMhAccessPanel();
          });
        });
        mhAccessList.querySelectorAll('.mh-panel-open').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var mhName = btn.dataset.mhName;
            // Navigate to that MH's notes
            var s = JSON.parse(JSON.stringify(setup));
            s.employeeName = mhName;
            s.reviewRole = 'mailhandler';
            localStorage.setItem('reviewDaySetup', JSON.stringify(s));
            window.location.reload();
          });
        });
      }

      function _esc(str) {
        var d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
      }

      renderMhAccessPanel();
    }
  }

  // --- Scoped storage prefix for tab data ---
  window.appStoragePrefix = '';
  if (reviewId && setup.dayNumber) {
    var prefixUserId = (setup.viewingUserId && setup.isLeadUser) ? setup.viewingUserId : authUser.id;
    window.appStoragePrefix = '_' + reviewId + '_' + setup.dayNumber + '_' + prefixUserId;

    // One-time migration: copy unscoped tab data to scoped keys
    var tabBaseKeys = [
      'clerk_obs_trips', 'clerk_obs_trips_mailflow', 'clerk_obs_scf',
      'clerk_obs_adus', 'clerk_obs_questionnaire', 'clerk_obs_summarization',
      'clerk_obs_eod_dismissed'
    ];
    tabBaseKeys.forEach(function(key) {
      var scopedKey = key + window.appStoragePrefix;
      if (!localStorage.getItem(scopedKey)) {
        var raw = localStorage.getItem(key);
        if (raw) {
          localStorage.setItem(scopedKey, raw);
          localStorage.removeItem(key);
        }
      }
    });
  }

  // --- Check for existing submission ---
  // When a lead is viewing another reviewer's data, use their userId for lookups
  var effectiveUserId = (setup.viewingUserId && setup.isLeadUser) ? setup.viewingUserId : authUser.id;
  var isViewingOther = (effectiveUserId !== authUser.id);

  // Find ALL clerk observations for this user/review/day (multiple sets)
  var allClerkSets = [];
  var activeSetIndex = parseInt(urlParams.get('set') || '0', 10) || 0;
  var existingObs = null;
  if (reviewId && setup.dayNumber) {
    var allObs = Storage.hydrate(Storage.getAll());
    var targetDay = String(setup.dayNumber);

    // Collect all clerk observations for this user/review/day
    for (var ei = 0; ei < allObs.length; ei++) {
      var _o = allObs[ei];
      if (_o.reviewId === reviewId &&
          String(_o.dayNumber) === targetDay &&
          _o.userId === effectiveUserId &&
          _o.reviewRole !== 'mailhandler') {
        allClerkSets.push(_o);
      }
    }
    // Sort by setIndex (missing = 0)
    allClerkSets.sort(function(a, b) { return (a.setIndex || 0) - (b.setIndex || 0); });

    // Pick the active set
    if (allClerkSets.length > 0) {
      if (activeSetIndex < allClerkSets.length) {
        existingObs = allClerkSets[activeSetIndex];
      } else {
        existingObs = allClerkSets[0];
        activeSetIndex = 0;
      }
    }

    // Primary match: exact reviewId + dayNumber + userId (fallback for MH)
    if (!existingObs) {
      for (var ei2 = 0; ei2 < allObs.length; ei2++) {
        if (allObs[ei2].reviewId === reviewId &&
            String(allObs[ei2].dayNumber) === targetDay &&
            allObs[ei2].userId === effectiveUserId) {
          existingObs = allObs[ei2];
          break;
        }
      }
    }
    // Fallback: match user's drafts with same reviewId but missing/wrong dayNumber
    if (!existingObs && !isViewingOther) {
      for (var fi = 0; fi < allObs.length; fi++) {
        var o = allObs[fi];
        if (o.userId === authUser.id && o.status === 'draft' && o.reviewId === reviewId) {
          if (!o.dayNumber || o.dayNumber === '' || String(o.dayNumber) === targetDay) {
            existingObs = o;
            // Patch the draft with correct dayNumber so future lookups work
            Storage.delete(o.id);
            existingObs = Storage.add({
              office: o.office || setup.office,
              financeNum: o.financeNum || financeNum,
              reviewId: reviewId,
              date: o.date || setup.date,
              dayNumber: targetDay,
              observerName: o.observerName || setup.observerName,
              userId: authUser.id,
              reviewRole: o.reviewRole || reviewRole,
              status: o.status,
              rows: o.rows || [],
            });
            break;
          }
        }
      }
    }
    // Last resort: match any user draft with same office/finance (pre-scoping legacy)
    if (!existingObs && !isViewingOther) {
      for (var li = 0; li < allObs.length; li++) {
        var lo = allObs[li];
        if (lo.userId === authUser.id && lo.status === 'draft' && !lo.reviewId) {
          if (lo.financeNum === financeNum || lo.office === setup.office) {
            existingObs = lo;
            Storage.delete(lo.id);
            existingObs = Storage.add({
              office: lo.office || setup.office,
              financeNum: lo.financeNum || financeNum,
              reviewId: reviewId,
              date: lo.date || setup.date,
              dayNumber: targetDay,
              observerName: lo.observerName || setup.observerName,
              userId: authUser.id,
              reviewRole: lo.reviewRole || reviewRole,
              status: 'draft',
              rows: lo.rows || [],
            });
            break;
          }
        }
      }
    }

    // MH continuity: if no existing obs found for this user+employee,
    // look for latest obs by ANY reviewer for the same employee name
    // and pre-populate rows so the new reviewer continues where the last left off
    if (!existingObs && isMH && setup.employeeName && !isViewingOther) {
      var empName = setup.employeeName.trim();
      var latestMhObs = null;
      for (var mi = 0; mi < allObs.length; mi++) {
        var mo = allObs[mi];
        if (mo.reviewId === reviewId && mo.reviewRole === 'mailhandler' &&
            mo.employeeName && mo.employeeName.trim() === empName &&
            mo.rows && mo.rows.length > 0) {
          if (!latestMhObs || (mo.createdAt || '') > (latestMhObs.createdAt || '')) {
            latestMhObs = mo;
          }
        }
      }
      if (latestMhObs) {
        // Create a new draft for this user, copying the rows from the previous reviewer
        existingObs = Storage.add({
          office: latestMhObs.office || setup.office,
          financeNum: latestMhObs.financeNum || financeNum,
          reviewId: reviewId,
          date: latestMhObs.date || setup.date,
          dayNumber: latestMhObs.dayNumber || targetDay,
          observerName: setup.observerName || authUser.displayName || '',
          userId: authUser.id,
          reviewRole: 'mailhandler',
          employeeName: empName,
          status: 'draft',
          rows: latestMhObs.rows.slice() // copy rows
        });
      }
    }
  }

  function refreshDisplay() {
    dispOffice.textContent   = officeInput.value || '\u2014';
    dispDate.textContent     = formatDateShort(dateInput.value);
    dispDay.textContent      = dayNumInput.value || '\u2014';
    dispObserver.textContent = observerInput.value || '\u2014';
    dispRole.textContent     = roleBadge[reviewRole] || reviewRole || '\u2014';
    if (isMH && dispEmployee) dispEmployee.textContent = (employeeInput && employeeInput.value) || '\u2014';
    var setupData = {
      reviewId: reviewId,
      office: officeInput.value.trim(),
      financeNum: financeNum,
      date: dateInput.value,
      dayNumber: dayNumInput.value.trim(),
      observerName: observerInput.value.trim(),
      reviewRole: reviewRole
    };
    if (isMH && employeeInput) setupData.employeeName = employeeInput.value.trim();
    // Preserve lead viewing state
    if (isViewingOther) {
      setupData.viewingUserId = setup.viewingUserId;
      setupData.viewingUserName = setup.viewingUserName;
      setupData.isLeadUser = true;
    }
    localStorage.setItem('reviewDaySetup', JSON.stringify(setupData));
  }
  refreshDisplay();

  // Show banner when lead is viewing another reviewer's data
  if (isViewingOther && setup.viewingUserName) {
    var viewBanner = document.createElement('div');
    viewBanner.id = 'viewing-as-banner';
    viewBanner.style.cssText = 'background:#fef3c7;color:#92400e;padding:0.5rem 1rem;border-radius:6px;margin-bottom:0.75rem;display:flex;align-items:center;justify-content:space-between;font-size:0.88rem;font-weight:600;';
    viewBanner.innerHTML = '<span>👁️ Viewing ' + (setup.viewingUserName || 'reviewer') + '\'s notes (Lead Edit Mode)</span>' +
      '<a id="viewing-back-btn" class="btn btn-outline btn-sm" style="cursor:pointer;font-size:0.78rem;">← Back to Workbook</a>';
    var obsSection = document.getElementById('obs-info-section');
    if (obsSection && obsSection.parentNode) {
      obsSection.parentNode.insertBefore(viewBanner, obsSection);
    }
    document.addEventListener('click', function(e) {
      if (e.target && e.target.id === 'viewing-back-btn') {
        // Clear viewingUserId and go back to workbook
        var s = {};
        try { s = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(ex) {}
        delete s.viewingUserId;
        delete s.viewingUserName;
        s.reviewRole = 'lead';
        s.isLeadUser = true;
        localStorage.setItem('reviewDaySetup', JSON.stringify(s));
        window.location.href = 'review.html?rid=' + encodeURIComponent(reviewId) + '&day=1&mode=workbook';
      }
    });
  }

  // PODs cannot edit the date or day number
  if (!isLead && !isLeadUser) {
    if (dateInput) dateInput.readOnly = true;
    if (dateInput) dateInput.style.opacity = '0.6';
    if (dayNumInput) dayNumInput.readOnly = true;
    if (dayNumInput) dayNumInput.style.opacity = '0.6';
  }

  // --- Toggle edit/display ---
  toggleInfoBtn.addEventListener('click', () => {
    var editing = infoEdit.hidden;
    infoEdit.hidden = !editing;
    infoDisplay.hidden = editing;
    toggleInfoBtn.textContent = editing ? 'Done' : 'Edit';
    if (!editing) refreshDisplay();
  });
  if (doneEditBtn) {
    doneEditBtn.addEventListener('click', () => {
      infoEdit.hidden = true;
      infoDisplay.hidden = false;
      toggleInfoBtn.textContent = 'Edit';
      refreshDisplay();
    });
  }

  function formatDateShort(dateStr) {
    if (!dateStr) return '\u2014';
    var parts = dateStr.split('-');
    return parts[1] + '/' + parts[2] + '/' + parts[0];
  }

  /** Get current local time as HH:MM string. */
  function currentTimeStr() {
    var now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' +
           String(now.getMinutes()).padStart(2, '0');
  }

  // Build LDC <option> HTML
  const ldcOptionsHtml = '<option value="">-- Select LDC --</option>' +
    LDC_OPTIONS.map(o => '<option value="' + o.value + '" data-short="' + o.short + '">' + o.label + '</option>').join('');

  // Clerks dropdown HTML (1-10, default 1)
  var clerksOptionsHtml = '';
  for (var ci = 1; ci <= 10; ci++) {
    clerksOptionsHtml += '<option value="' + ci + '"' + (ci === 1 ? ' selected' : '') + '>' + ci + '</option>';
  }

  // Work quality options
  const QUALITY_OPTIONS = [
    { value: '', label: '-- Select --' },
    { value: 'NO CONCERNS', label: 'NO CONCERNS' },
    { value: 'DOUBLE HANDLING', label: 'DOUBLE HANDLING' },
    { value: 'WORKING METHODICALLY', label: 'WORKING METHODICALLY' },
    { value: 'UNNECESSARY', label: 'UNNECESSARY' },
  ];
  const qualityOptionsHtml = QUALITY_OPTIONS.map(o =>
    '<option value="' + o.value + '">' + o.label + '</option>'
  ).join('');

  /** Show short label when closed, full when opened. */
  function initLdcTruncation(sel) {
    function showShort() {
      for (const o of sel.options) {
        if (o.dataset.short) o.textContent = o.dataset.short;
      }
    }
    function showFull() {
      for (const o of sel.options) {
        const match = LDC_OPTIONS.find(l => l.value === o.value);
        if (match) o.textContent = match.label;
      }
    }
    sel.addEventListener('focus', showFull);
    sel.addEventListener('mousedown', showFull);
    sel.addEventListener('change', showShort);
    sel.addEventListener('blur', showShort);
    showShort();
  }

  /** Build OPN options for an LDC. */
  function buildOpnOptions(ldcValue) {
    const items = OPN_BY_LDC[ldcValue];
    if (!items || items.length === 0) return '<option value="">--</option>';
    if (items.length === 1) {
      return '<option value="' + items[0].opn + ' -- ' + items[0].desc + '" selected>' + items[0].opn + ' -- ' + items[0].desc + '</option>';
    }
    return '<option value="">-- Select OPN --</option>' +
      items.map(i => '<option value="' + i.opn + ' -- ' + i.desc + '">' + i.opn + ' -- ' + i.desc + '</option>').join('');
  }

  /** Apply LDC color class to an entry card. */
  function applyCardColor(card, ldcValue) {
    card.className = card.className.replace(/\bldc-\S+/g, '').trim();
    const opt = LDC_OPTIONS.find(o => o.value === ldcValue);
    if (opt && opt.color) card.classList.add(opt.color);
  }

  // ---------- Add Row ----------
  addRowBtn.addEventListener('click', () => {
    addRow();
    var cards = container.querySelectorAll('.entry-card');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function addRow(prefill) {
    prefill = prefill || {};
    rowCounter++;
    noRowsMsg.hidden = true;

    var defaultBegin = prefill.beginTime || '';
    var defaultEnd = prefill.endTime || '';
    if (!defaultBegin) {
      const prevCards = container.querySelectorAll('.entry-card');
      if (prevCards.length > 0) {
        const lastCard = prevCards[prevCards.length - 1];
        const lastEnd = lastCard.querySelector('[data-field="endTime"]');
        if (lastEnd && lastEnd.value) {
          defaultBegin = lastEnd.value;
          defaultEnd = addMinutes(lastEnd.value, 1);
        }
      }
    }
    if (!defaultBegin) {
      defaultBegin = currentTimeStr();
      defaultEnd = addMinutes(defaultBegin, 1);
    }

    const card = document.createElement('div');
    card.className = 'entry-card';
    card.dataset.row = rowCounter;

    card.innerHTML =
      '<div class="entry-top-row">' +
        '<span class="entry-num">' + rowCounter + '</span>' +
        '<div class="entry-field">' +
          '<label>Begin Time</label>' +
          '<input type="time" class="cell-input begin-input" data-field="beginTime" value="' + defaultBegin + '">' +
        '</div>' +
        '<div class="entry-field">' +
          '<label>End Time</label>' +
          '<input type="time" class="cell-input end-input" data-field="endTime" value="' + defaultEnd + '">' +
        '</div>' +
        '<div class="entry-field entry-field-sm">' +
          '<label>Elapsed</label>' +
          '<span class="elapsed-display">--</span>' +
        '</div>' +
        '<div class="entry-field entry-field-xs">' +
          '<label>Clerks</label>' +
          '<select class="cell-input clerks-select" data-field="totalClerks">' + clerksOptionsHtml + '</select>' +
        '</div>' +
        '<div class="entry-field">' +
          '<label>LDC</label>' +
          '<select class="cell-input ldc-select" data-field="ldc">' + ldcOptionsHtml + '</select>' +
        '</div>' +
        '<div class="entry-field entry-field-opn">' +
          '<label>OPN</label>' +
          '<select class="cell-input opn-select" data-field="opn"><option value="">--</option></select>' +
        '</div>' +
        '<div class="entry-field entry-field-quality">' +
          '<label>Work Quality</label>' +
          '<select class="cell-input quality-select" data-field="workQuality">' + qualityOptionsHtml + '</select>' +
        '</div>' +
        '<div class="entry-field entry-field-sm time-lost-field" style="display:none;">' +
          '<label>Time Lost (min)</label>' +
          '<input type="number" class="cell-input time-lost-input" placeholder="min" min="0" data-field="timeLost">' +
        '</div>' +
        '<div class="vol-inline-fields"></div>' +
        '<button class="btn btn-danger btn-sm remove-row-btn" title="Remove entry">X</button>' +
      '</div>' +
      '<div class="entry-bottom-row">' +
        '<div class="entry-field entry-field-full">' +
          '<label>Work Description / Notes</label>' +
          '<textarea class="cell-input desc-input" rows="2" placeholder="Describe the work observed..." data-field="workDescription"></textarea>' +
        '</div>' +
      '</div>';

    container.appendChild(card);

    const ldcSelect     = card.querySelector('.ldc-select');
    const opnSelect     = card.querySelector('.opn-select');
    const clerksSelect  = card.querySelector('.clerks-select');
    const beginInput    = card.querySelector('.begin-input');
    const endInput      = card.querySelector('.end-input');
    const elapsedDisp   = card.querySelector('.elapsed-display');
    const qualitySelect = card.querySelector('.quality-select');
    const timeLostField = card.querySelector('.time-lost-field');
    const timeLostInput = card.querySelector('.time-lost-input');
    const volInline     = card.querySelector('.vol-inline-fields');

    function getElapsedMins() {
      if (!beginInput.value || !endInput.value) return 0;
      return Storage.calcElapsed(beginInput.value, endInput.value);
    }
    function getClerks() {
      return parseInt(clerksSelect.value, 10) || 1;
    }
    function getTotalElapsed() {
      return getElapsedMins() * getClerks();
    }
    function updateElapsed() {
      var rawMins = getElapsedMins();
      var clerks = getClerks();
      var totalMins = rawMins * clerks;
      if (totalMins) {
        var label = Storage.formatElapsed(totalMins);
        if (clerks > 1) label += ' (' + clerks + 'x)';
        elapsedDisp.textContent = label;
      } else {
        elapsedDisp.textContent = '--';
      }
      if (timeLostInput) timeLostInput.max = totalMins || '';
    }

    beginInput.addEventListener('change', () => {
      if (beginInput.value) {
        if (!endInput.value || endInput.value <= beginInput.value) {
          endInput.value = addMinutes(beginInput.value, 1);
        }
      }
      updateElapsed();
    });
    endInput.addEventListener('change', updateElapsed);
    clerksSelect.addEventListener('change', updateElapsed);
    if (defaultBegin && defaultEnd) updateElapsed();

    ldcSelect.addEventListener('change', () => {
      opnSelect.innerHTML = buildOpnOptions(ldcSelect.value);
      applyCardColor(card, ldcSelect.value);

      // NP = all time is lost, hide quality/time lost fields
      if (ldcSelect.value === 'NP') {
        qualitySelect.value = '';
        timeLostField.style.display = 'none';
        timeLostInput.value = '';
        qualitySelect.closest('.entry-field').style.display = 'none';
      } else {
        qualitySelect.closest('.entry-field').style.display = '';
      }

      var vol = getVolumeFields(ldcSelect.value);
      volInline.innerHTML = '';
      if (vol.ltrVolInches) {
        volInline.innerHTML += '<div class="entry-field entry-field-sm"><label>Ltr Vol</label><input type="number" class="cell-input" placeholder="0" min="0" data-field="ltrVolInches"></div>';
      }
      if (vol.fltVolInches) {
        volInline.innerHTML += '<div class="entry-field entry-field-sm"><label>Flt Vol</label><input type="number" class="cell-input" placeholder="0" min="0" data-field="fltVolInches"></div>';
      }
      if (vol.parcels) {
        volInline.innerHTML += '<div class="entry-field entry-field-sm"><label>Parcels</label><input type="number" class="cell-input" placeholder="0" min="0" data-field="parcels"></div>';
      }
    });

    qualitySelect.addEventListener('change', () => {
      var val = qualitySelect.value;
      // Never show time lost for NP
      if (ldcSelect.value === 'NP') {
        timeLostField.style.display = 'none';
        timeLostInput.value = '';
        return;
      }
      if (val && val !== 'NO CONCERNS') {
        timeLostField.style.display = '';
        timeLostInput.max = getTotalElapsed() || '';
      } else {
        timeLostField.style.display = 'none';
        timeLostInput.value = '';
      }
    });

    timeLostInput.addEventListener('change', () => {
      var maxMins = getTotalElapsed();
      var val = parseInt(timeLostInput.value, 10);
      if (val > maxMins) timeLostInput.value = maxMins;
      if (val < 0) timeLostInput.value = 0;
    });

    card.querySelector('.remove-row-btn').addEventListener('click', () => {
      if (!confirm('Are you sure you want to delete this entry?')) return;
      card.remove();
      renumberRows();
      if (container.children.length === 0) {
        noRowsMsg.hidden = false;
        rowCounter = 0;
      }
    });

    ldcSelect.focus();
    initLdcTruncation(ldcSelect);

    // Pre-fill from existing data
    if (prefill.ldc) {
      ldcSelect.value = prefill.ldc;
      ldcSelect.dispatchEvent(new Event('change'));
      if (prefill.opn) setTimeout(function() { opnSelect.value = prefill.opn; }, 0);
    }
    if (prefill.totalClerks) clerksSelect.value = prefill.totalClerks;
    if (prefill.workQuality) {
      qualitySelect.value = prefill.workQuality;
      qualitySelect.dispatchEvent(new Event('change'));
    }
    if (prefill.timeLost) timeLostInput.value = prefill.timeLost;
    if (prefill.workDescription) card.querySelector('[data-field="workDescription"]').value = prefill.workDescription;
    // Volume fields
    setTimeout(function() {
      if (prefill.ltrVolInches) { var el = card.querySelector('[data-field="ltrVolInches"]'); if (el) el.value = prefill.ltrVolInches; }
      if (prefill.fltVolInches) { var el = card.querySelector('[data-field="fltVolInches"]'); if (el) el.value = prefill.fltVolInches; }
      if (prefill.parcels) { var el = card.querySelector('[data-field="parcels"]'); if (el) el.value = prefill.parcels; }
    }, 10);
    updateElapsed();
  }

  function addMinutes(timeStr, mins) {
    var parts = timeStr.split(':');
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var total = h * 60 + m + mins;
    if (total >= 24 * 60) total -= 24 * 60;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' +
           String(total % 60).padStart(2, '0');
  }

  function renumberRows() {
    rowCounter = 0;
    container.querySelectorAll('.entry-card').forEach(function(card) {
      rowCounter++;
      card.dataset.row = rowCounter;
      card.querySelector('.entry-num').textContent = rowCounter;
    });
  }

  // ---------- Save ----------
  var clerkAutosaveEl = document.getElementById('clerk-autosave-status');

  function collectRows() {
    var rows = [];
    var cards = container.querySelectorAll('.entry-card');
    for (var ci = 0; ci < cards.length; ci++) {
      var card = cards[ci];
      var row = {};
      card.querySelectorAll('[data-field]').forEach(function(el) {
        row[el.dataset.field] = el.value.trim();
      });
      rows.push(row);
    }
    return rows;
  }

  // --- Auto-save as draft on every change ---
  var _autosaveTimer = null;
  function autoSaveDraft() {
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(function() {
      var rows = isMH
        ? (typeof window.mhCollectRows === 'function' ? window.mhCollectRows() : [])
        : collectRows();
      if (rows.length === 0 && !isMH && container.querySelectorAll('.entry-card').length === 0) return;
      if (rows.length === 0 && isMH && document.querySelectorAll('.mh-entry-card').length === 0) return;
      if (existingObs) Storage.delete(existingObs.id);
      var entry = Storage.add({
        office: officeInput.value.trim(),
        financeNum: financeNum,
        reviewId: reviewId,
        date: dateInput.value,
        dayNumber: dayNumInput.value.trim(),
        observerName: observerInput.value.trim(),
        userId: authUser.id,
        reviewRole: reviewRole,
        employeeName: isMH && employeeInput ? employeeInput.value.trim() : undefined,
        status: 'draft',
        rows: rows,
        setIndex: (!isMH && activeSetIndex > 0) ? activeSetIndex : undefined,
        setLabel: (!isMH && existingObs && existingObs.setLabel) ? existingObs.setLabel : undefined,
      });
      existingObs = entry;
      var statusEl = isMH ? (window.mhAutosaveEl || clerkAutosaveEl) : clerkAutosaveEl;
      if (statusEl) statusEl.textContent = '\u2713 Saved ' + new Date().toLocaleTimeString();
    }, 500);
  }

  // MH auto-save hook
  window.appMhSave = function(rows) {
    autoSaveDraft();
  };

  // Listen for changes on the entire entries container
  container.addEventListener('input', autoSaveDraft);
  container.addEventListener('change', autoSaveDraft);

  // Expose collectRows globally for End of Day validation
  window.appCollectRows = function() {
    if (isMH && typeof window.mhCollectRows === 'function') return window.mhCollectRows();
    return collectRows();
  };
  window.appIsMH = isMH;
  window.appExistingObs = function() { return existingObs; };
  window.appSetExistingObs = function(e) { existingObs = e; };
  window.appGetSetup = function() {
    var s = {
      office: officeInput.value.trim(),
      financeNum: financeNum,
      reviewId: reviewId,
      date: dateInput.value,
      dayNumber: dayNumInput.value.trim(),
      observerName: observerInput.value.trim(),
      userId: authUser.id,
      reviewRole: reviewRole
    };
    if (isMH && employeeInput) s.employeeName = employeeInput.value.trim();
    return s;
  };
  window.appActiveSetIndex = activeSetIndex;
  window.appAllClerkSets = allClerkSets;

  // --- Clerk Notes Set Switcher ---
  if (!isMH && reviewId) {
    var clerkSetsBar = document.getElementById('clerk-sets-bar');
    var clerkSetTabs = document.getElementById('clerk-set-tabs');
    var clerkAddSetBtn = document.getElementById('clerk-add-set-btn');

    function renderClerkSetTabs() {
      if (!clerkSetTabs) return;
      // Always show at least Set 1; hide bar if only 1 set and no rows
      var numSets = Math.max(allClerkSets.length, 1);
      if (numSets <= 1 && clerkSetsBar) clerkSetsBar.style.display = 'none';
      else if (clerkSetsBar) clerkSetsBar.style.display = '';

      var html = '';
      for (var i = 0; i < numSets; i++) {
        var isActive = (i === activeSetIndex);
        var label = 'Set ' + (i + 1);
        if (allClerkSets[i] && allClerkSets[i].setLabel) label = allClerkSets[i].setLabel;
        html += '<button class="clerk-set-tab wb-lead-toggle' + (isActive ? ' wb-lead-toggle--active' : '') + '" data-set="' + i + '" style="padding:0.25rem 0.6rem;font-size:0.78rem;">' + label + '</button>';
      }
      clerkSetTabs.innerHTML = html;

      // Wire click handlers
      clerkSetTabs.querySelectorAll('.clerk-set-tab').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var newSet = parseInt(btn.dataset.set, 10);
          if (newSet === activeSetIndex) return;
          // Save current rows first
          autoSaveDraft();
          // Navigate to the new set
          var params = new URLSearchParams(window.location.search);
          params.set('set', newSet);
          window.location.href = 'review.html?' + params.toString();
        });
      });
    }

    if (clerkAddSetBtn) {
      clerkAddSetBtn.addEventListener('click', function() {
        // Save current rows first
        autoSaveDraft();
        // Create a new observation for the new set
        var newSetIdx = allClerkSets.length;
        var label = prompt('Label for this set (optional, e.g. "Dock Area", "Window"):');
        var newObs = Storage.add({
          office: officeInput.value.trim(),
          financeNum: financeNum,
          reviewId: reviewId,
          date: dateInput.value,
          dayNumber: dayNumInput.value.trim(),
          observerName: observerInput.value.trim(),
          userId: authUser.id,
          reviewRole: reviewRole,
          status: 'draft',
          rows: [],
          setIndex: newSetIdx,
          setLabel: (label && label.trim()) ? label.trim() : ''
        });
        allClerkSets.push(newObs);
        // Navigate to the new set
        var params = new URLSearchParams(window.location.search);
        params.set('set', newSetIdx);
        window.location.href = 'review.html?' + params.toString();
      });
    }

    renderClerkSetTabs();

    // Show the bar if there are multiple sets (always show Add button)
    if (clerkSetsBar && allClerkSets.length >= 1) {
      clerkSetsBar.style.display = '';
    }
  }

  // --- POD Shared Documents Tab ---
  if (!isMH && reviewId && !isWorkbookMode) {
    var podDocsContainer = document.getElementById('pod-docs-container');
    var podDocsEmpty = document.getElementById('pod-docs-empty');
    var docsTab = document.querySelector('.review-tab[data-tab="tab-documents"]');

    // Show documents tab for PODs if they have a review
    if (docsTab && !isLead) docsTab.hidden = false;

    // IndexedDB reader (mirrors schedule.js doc storage)
    var DOC_DB_NAME = 'clerk_obs_documents';
    var DOC_DB_VERSION = 1;
    var DOC_STORE = 'files';
    function openDocDB(cb) {
      var req = indexedDB.open(DOC_DB_NAME, DOC_DB_VERSION);
      req.onupgradeneeded = function(e) { var db = e.target.result; if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE); };
      req.onsuccess = function(e) { cb(null, e.target.result); };
      req.onerror = function(e) { cb(e.target.error); };
    }
    function loadDocBlob(key, cb) {
      openDocDB(function(err, db) {
        if (err) return cb(err);
        var tx = db.transaction(DOC_STORE, 'readonly');
        var req = tx.objectStore(DOC_STORE).get(key);
        req.onsuccess = function() { cb(null, req.result || null); };
        req.onerror = function(e) { cb(e.target.error); };
      });
    }
    function docBlobKey(fin, docId) { return 'doc_' + reviewId + '_' + fin + '_' + docId; }
    function loadDocMeta(fin) {
      try { return JSON.parse(localStorage.getItem('clerk_obs_docmeta_' + reviewId + '_' + fin)) || {}; } catch(e) { return {}; }
    }

    var DEFAULT_DOC_CONFIGS = [
      { id: 'apwu-lmou', label: 'APWU LMOU' },
      { id: 'npmhu-lmou', label: 'NPMHU LMOU' },
      { id: 'ri399', label: 'RI-399' },
      { id: 'union-letter', label: 'Union Notification Letter' }
    ];
    function loadCustomTypes() {
      try { return JSON.parse(localStorage.getItem('clerk_obs_doc_types_' + reviewId)) || []; } catch(e) { return []; }
    }
    function getAllDocConfigs() { return DEFAULT_DOC_CONFIGS.concat(loadCustomTypes()); }

    function renderPodDocs() {
      if (!podDocsContainer) return;
      var rev = currentRev;
      if (!rev) return;
      var offices = (rev.offices && rev.offices.length > 0) ? rev.offices : [{ officeName: rev.officeName || 'Office', financeNum: rev.financeNum || '' }];
      var configs = getAllDocConfigs();
      var hasAny = false;
      var html = '';

      offices.forEach(function(office, oi) {
        var fin = office.financeNum || '';
        var meta = loadDocMeta(fin);
        var oName = office.officeName || ('FIN ' + fin);
        var officeDocs = [];

        configs.forEach(function(cfg) {
          if (meta[cfg.id] && meta[cfg.id].name) {
            officeDocs.push({ cfg: cfg, meta: meta[cfg.id], fin: fin });
          }
        });

        if (officeDocs.length === 0) return;
        hasAny = true;

        html += '<div style="' + (oi > 0 ? 'margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border);' : '') + '">';
        html += '<h3 style="font-size:0.88rem;margin:0 0 0.5rem;">' + oName + '</h3>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0.5rem;">';

        officeDocs.forEach(function(doc) {
          html += '<div style="padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card-bg);">';
          html += '<div style="font-weight:600;font-size:0.82rem;margin-bottom:0.25rem;">' + doc.cfg.label + '</div>';
          html += '<div style="font-size:0.76rem;color:var(--text-light);margin-bottom:0.35rem;">' + doc.meta.name + '</div>';
          html += '<div style="display:flex;gap:0.3rem;">';
          html += '<button class="btn btn-outline btn-sm pod-doc-view" data-fin="' + fin + '" data-doc="' + doc.cfg.id + '" style="font-size:0.72rem;padding:0.15rem 0.45rem;">👁 View</button>';
          html += '<button class="btn btn-outline btn-sm pod-doc-dl" data-fin="' + fin + '" data-doc="' + doc.cfg.id + '" data-name="' + doc.meta.name + '" style="font-size:0.72rem;padding:0.15rem 0.45rem;">⬇ Download</button>';
          html += '</div></div>';
        });

        html += '</div></div>';
      });

      podDocsContainer.innerHTML = html;
      if (podDocsEmpty) podDocsEmpty.hidden = hasAny;

      // Wire view/download buttons
      podDocsContainer.querySelectorAll('.pod-doc-view').forEach(function(btn) {
        btn.addEventListener('click', function() {
          loadDocBlob(docBlobKey(btn.dataset.fin, btn.dataset.doc), function(err, blob) {
            if (err || !blob) { alert('File not found. The review lead may not have uploaded it yet.'); return; }
            var url = URL.createObjectURL(blob);
            window.open(url, '_blank');
          });
        });
      });
      podDocsContainer.querySelectorAll('.pod-doc-dl').forEach(function(btn) {
        btn.addEventListener('click', function() {
          loadDocBlob(docBlobKey(btn.dataset.fin, btn.dataset.doc), function(err, blob) {
            if (err || !blob) { alert('File not found.'); return; }
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = btn.dataset.name || 'document';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
          });
        });
      });
    }

    // Render on tab activation
    var docTabBtn = document.querySelector('.review-tab[data-tab="tab-documents"]');
    if (docTabBtn) {
      docTabBtn.addEventListener('click', function() { renderPodDocs(); });
    }
    // Initial render if tab is visible
    if (podDocsContainer) renderPodDocs();
  }

  // Only add initial row if no existing submission was loaded
  if (isMH) {
    // Mail Handler mode — load into MH tab
    if (existingObs && existingObs.rows && existingObs.rows.length > 0) {
      existingObs.rows.forEach(function(row) {
        if (typeof window.mhAddRow === 'function') window.mhAddRow(row);
      });
    } else {
      if (typeof window.mhAddRow === 'function') window.mhAddRow();
    }
  } else {
    // Clerk mode
    if (existingObs && existingObs.rows && existingObs.rows.length > 0) {
      existingObs.rows.forEach(function(row) {
        addRow(row);
      });
    } else {
      addRow();
    }
  }
});
