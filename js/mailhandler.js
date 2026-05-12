/**
 * mailhandler.js — Mail Handler Notes tab logic.
 * Activated when the user's review role is 'mailhandler'.
 * Tracks minute-by-minute observations of a specific employee.
 */

(function() {
  'use strict';

  // Task Key — each task has an LDC and category for summary roll-ups
  // Categories: 'work' (productive), 'break' (break/lunch), 'np' (non-productive), 'cc' (cross craft)
  // Continuous work = consecutive work + break entries; NP and actual breaks interrupt it
  var MH_TASKS = [
    { code: 'B',      desc: 'Breaking Down Mail',                 ldc: '43A', cat: 'work' },
    { code: 'C-COL',  desc: 'Culling Mail: Carrier Collections',  ldc: '48',  cat: 'work' },
    { code: 'CD',     desc: 'Cross Dock Operation',               ldc: '43A', cat: 'work' },
    { code: 'CLK',    desc: 'Clerk Functions (Cross Craft)',       ldc: 'CC',  cat: 'cc' },
    { code: 'CR',     desc: 'Putting Mail in Carrier Route Order', ldc: '43A', cat: 'work' },
    { code: 'CW',     desc: 'Car Wash Operation in PM',           ldc: '48',  cat: 'work' },
    { code: 'D',      desc: 'Dispatching Mail',                   ldc: '48',  cat: 'work' },
    { code: '99',     desc: 'Accept - Scan 99 Placards',          ldc: '43A', cat: 'work' },
    { code: 'DU',     desc: 'Dumping Sacks/Dumper',               ldc: '43A', cat: 'work' },
    { code: 'E',      desc: 'Elevator',                           ldc: '43A', cat: 'work' },
    { code: 'HA',     desc: 'Hashing Mail for Downstream',        ldc: '43A', cat: 'work' },
    { code: 'LT/ULT', desc: 'Load Truck & Unload Truck',          ldc: '43A', cat: 'work' },
    { code: 'MTE',    desc: 'Empty Equipment Collection',         ldc: '43A', cat: 'work' },
    { code: 'NP',     desc: 'Non-productive Time',                ldc: 'NP',  cat: 'np' },
    { code: 'NW',     desc: 'No Work Available',                  ldc: 'NP',  cat: 'np' },
    { code: 'O',      desc: 'Misc. Activity - Describe in Comments', ldc: '48', cat: 'work' },
    { code: 'RT',     desc: 'Retrieve Mail: Col. Box/Retail',     ldc: '48',  cat: 'work' },
    { code: 'S',      desc: 'Spreading Mail',                     ldc: '43A', cat: 'work' },
    { code: 'SM',     desc: 'Staging Mail',                       ldc: '43A', cat: 'work' },
    { code: 'STBY',   desc: 'Standby Time',                       ldc: 'NP',  cat: 'np' },
    { code: 'SUE',    desc: 'Setting Up Equipment',               ldc: '43A', cat: 'work' },
    { code: 'CB',     desc: 'Comfort Break',                      ldc: 'BRK', cat: 'break' },
    { code: 'X',      desc: 'Break',                              ldc: 'BRK', cat: 'break' },
    { code: 'XX',     desc: 'Lunch',                              ldc: 'BRK', cat: 'break' }
  ];

  // Quick lookups
  var MH_TASK_MAP = {};
  MH_TASKS.forEach(function(t) { MH_TASK_MAP[t.code] = t; });

  // LDC code → CSS color class mapping
  var MH_LDC_COLOR = {
    '43A': 'ldc-43a',
    '48':  'ldc-48',
    'NP':  'ldc-np',
    'BRK': 'ldc-brk',
    'CC':  'ldc-cc'
  };

  function applyMhCardColor(card, taskCode) {
    card.className = card.className.replace(/\bldc-\S+/g, '').trim();
    var task = MH_TASK_MAP[taskCode];
    if (task && MH_LDC_COLOR[task.ldc]) {
      card.classList.add(MH_LDC_COLOR[task.ldc]);
    }
  }

  var MH_MAIL_TYPES = ['', 'Parcels', 'Letters', 'Flats', 'Mixed'];
  var MH_EQUIP_TYPES = ['', 'APC', 'BMC', 'Wire Container', 'Cardboard/Gaylord', 'Hamper (1046)', 'Gurney (1033)', 'U-Cart', 'Sacks'];

  // Build task dropdown HTML — show full in dropdown, abbreviation once selected
  var taskOptionsHtml = '<option value="">-- Select Task --</option>' +
    MH_TASKS.map(function(t) {
      return '<option value="' + t.code + '" data-short="' + t.code + '">' + t.code + ' — ' + t.desc + '</option>';
    }).join('');

  // Mail type dropdown
  var mailTypeHtml = '<option value="">-- Mail Type --</option>' +
    MH_MAIL_TYPES.filter(function(m) { return m; }).map(function(m) {
      return '<option value="' + m + '">' + m + '</option>';
    }).join('');

  // Equipment type dropdown
  var equipTypeHtml = '<option value="">-- Equipment --</option>' +
    MH_EQUIP_TYPES.filter(function(e) { return e; }).map(function(e) {
      return '<option value="' + e + '">' + e + '</option>';
    }).join('');

  // Equipment quantity dropdown (1-10)
  var equipQtyHtml = '<option value="">Qty</option>';
  for (var q = 1; q <= 10; q++) {
    equipQtyHtml += '<option value="' + q + '">' + q + '</option>';
  }

  // Work quality / performance dropdown (same as clerk)
  var MH_QUALITY_OPTIONS = [
    { value: '', label: '-- Select --' },
    { value: 'NO CONCERNS', label: 'NO CONCERNS' },
    { value: 'DOUBLE HANDLING', label: 'DOUBLE HANDLING' },
    { value: 'WORKING METHODICALLY', label: 'WORKING METHODICALLY' },
    { value: 'UNNECESSARY', label: 'UNNECESSARY' }
  ];
  var qualityHtml = MH_QUALITY_OPTIONS.map(function(o) {
    return '<option value="' + o.value + '">' + o.label + '</option>';
  }).join('');

  // Tasks that require comments
  var COMMENT_REQUIRED_TASKS = { 'NP': true, 'O': true, 'CLK': true };

  var container = document.getElementById('mh-rows-container');
  var noRowsMsg = document.getElementById('mh-no-rows-msg');
  if (!container) return;

  // Create inline add-row button
  var addRowWrap = document.createElement('div');
  addRowWrap.className = 'inline-add-row';
  addRowWrap.id = 'mh-inline-add-row';
  addRowWrap.innerHTML = '<button id="mh-add-row-btn" class="btn btn-primary">+ Add Row</button>';
  addRowWrap.style.display = 'none'; // hidden until MH mode activates
  container.parentNode.insertBefore(addRowWrap, container.nextSibling);

  var addRowBtn = document.getElementById('mh-add-row-btn');
  var rowCounter = 0;
  var autosaveEl = document.getElementById('mh-autosave-status');

  /** Task dropdown: show abbreviation when closed, full when open */
  function initTaskTruncation(sel) {
    function showShort() {
      for (var i = 0; i < sel.options.length; i++) {
        var o = sel.options[i];
        if (o.dataset.short) o.textContent = o.dataset.short;
      }
    }
    function showFull() {
      for (var i = 0; i < sel.options.length; i++) {
        var o = sel.options[i];
        var match = MH_TASKS.find(function(t) { return t.code === o.value; });
        if (match) o.textContent = match.code + ' \u2014 ' + match.desc;
      }
    }
    sel.addEventListener('focus', showFull);
    sel.addEventListener('mousedown', showFull);
    sel.addEventListener('change', showShort);
    sel.addEventListener('blur', showShort);
    showShort();
  }

  /** Current time as HH:MM */
  function currentTimeStr() {
    var now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' +
           String(now.getMinutes()).padStart(2, '0');
  }

  function addMinutes(timeStr, mins) {
    var parts = timeStr.split(':');
    var total = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + mins;
    if (total >= 24 * 60) total -= 24 * 60;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' +
           String(total % 60).padStart(2, '0');
  }

  addRowBtn.addEventListener('click', function() {
    mhAddRow();
    var cards = container.querySelectorAll('.mh-entry-card');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function mhAddRow(prefill) {
    prefill = prefill || {};
    rowCounter++;
    noRowsMsg.hidden = true;

    // Continuous time: default begin = previous row's end time
    var defaultBegin = prefill.beginTime || '';
    var defaultEnd = prefill.endTime || '';
    if (!defaultBegin) {
      var prevCards = container.querySelectorAll('.mh-entry-card');
      if (prevCards.length > 0) {
        var lastCard = prevCards[prevCards.length - 1];
        var lastEnd = lastCard.querySelector('[data-field="endTime"]');
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

    var card = document.createElement('div');
    card.className = 'entry-card mh-entry-card';
    card.dataset.row = rowCounter;

    card.innerHTML =
      '<div class="mh-row-time">' +
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
        '<div class="entry-field">' +
          '<label>Task</label>' +
          '<select class="cell-input mh-task-select" data-field="task">' + taskOptionsHtml + '</select>' +
        '</div>' +
        '<div class="entry-field">' +
          '<label>Mail Type</label>' +
          '<select class="cell-input" data-field="mailType">' + mailTypeHtml + '</select>' +
        '</div>' +
        '<div class="entry-field">' +
          '<label>Equipment Type</label>' +
          '<select class="cell-input" data-field="equipType">' + equipTypeHtml + '</select>' +
        '</div>' +
        '<div class="entry-field entry-field-xs">' +
          '<label>Equip Qty</label>' +
          '<select class="cell-input" data-field="equipQty">' + equipQtyHtml + '</select>' +
        '</div>' +
        '<div class="entry-field entry-field-quality">' +
          '<label>Work Quality</label>' +
          '<select class="cell-input mh-quality-select" data-field="workQuality">' + qualityHtml + '</select>' +
        '</div>' +
        '<div class="entry-field entry-field-sm mh-time-lost-field" style="display:none;">' +
          '<label>Time Lost (min)</label>' +
          '<input type="number" class="cell-input mh-time-lost-input" placeholder="min" min="0" data-field="timeLost">' +
        '</div>' +
        '<button class="btn btn-danger btn-sm remove-row-btn" title="Remove entry">X</button>' +
      '</div>' +
      '<div class="mh-row-notes">' +
        '<label>Comments <span class="mh-comment-req" style="display:none;color:#dc2626;font-weight:600;">(Required)</span></label>' +
        '<textarea class="cell-input desc-input" rows="1" placeholder="Describe task or performance observation..." data-field="comments"></textarea>' +
      '</div>';

    container.appendChild(card);

    var beginInput = card.querySelector('.begin-input');
    var endInput = card.querySelector('.end-input');
    var elapsedDisp = card.querySelector('.elapsed-display');
    var taskSelect = card.querySelector('.mh-task-select');
    var qualitySelect = card.querySelector('.mh-quality-select');
    var timeLostField = card.querySelector('.mh-time-lost-field');
    var timeLostInput = card.querySelector('.mh-time-lost-input');
    var commentReqLabel = card.querySelector('.mh-comment-req');

    function getElapsedMins() {
      if (!beginInput.value || !endInput.value) return 0;
      return Storage.calcElapsed(beginInput.value, endInput.value);
    }

    function updateElapsed() {
      var mins = getElapsedMins();
      if (mins) {
        elapsedDisp.textContent = Storage.formatElapsed(mins);
      } else {
        elapsedDisp.textContent = '--';
      }
      if (timeLostInput) timeLostInput.max = mins || '';
    }

    // Task change — show/hide comment required indicator + apply color
    taskSelect.addEventListener('change', function() {
      var req = COMMENT_REQUIRED_TASKS[taskSelect.value];
      if (commentReqLabel) commentReqLabel.style.display = req ? '' : 'none';
      applyMhCardColor(card, taskSelect.value);
    });

    // Work quality change — show/hide time lost
    qualitySelect.addEventListener('change', function() {
      var val = qualitySelect.value;
      if (val && val !== 'NO CONCERNS') {
        timeLostField.style.display = '';
        timeLostInput.max = getElapsedMins() || '';
      } else {
        timeLostField.style.display = 'none';
        timeLostInput.value = '';
      }
    });

    timeLostInput.addEventListener('change', function() {
      var maxMins = getElapsedMins();
      var val = parseInt(timeLostInput.value, 10);
      if (val > maxMins) timeLostInput.value = maxMins;
      if (val < 0) timeLostInput.value = 0;
    });

    // --- Live validation highlighting ---
    function validateCard() {
      card.classList.remove('mh-card-error', 'mh-card-warn');
      var hasError = false;
      var hasWarn = false;

      // Gap check — compare to previous card
      var prevCard = card.previousElementSibling;
      if (prevCard && prevCard.classList.contains('mh-entry-card')) {
        var prevEnd = prevCard.querySelector('[data-field="endTime"]');
        if (prevEnd && prevEnd.value && beginInput.value && prevEnd.value !== beginInput.value) {
          hasError = true;
        }
      }

      // Also validate next card's gap when this card's end time changes
      var nextCard = card.nextElementSibling;
      if (nextCard && nextCard.classList.contains('mh-entry-card')) {
        var nextValidate = nextCard._mhValidate;
        if (nextValidate) setTimeout(nextValidate, 0);
      }

      // Missing task
      if (!taskSelect.value) hasWarn = true;

      // Work quality required unless exempt (breaks, NP, NW, STBY, CLK)
      var MH_QUALITY_EXEMPT = { 'X': true, 'XX': true, 'CB': true, 'NP': true, 'NW': true, 'STBY': true, 'CLK': true };
      if (taskSelect.value && !MH_QUALITY_EXEMPT[taskSelect.value] && !qualitySelect.value) {
        hasError = true;
      }

      // Comments required for NP/O/CLK
      var commentsEl = card.querySelector('[data-field="comments"]');
      if (COMMENT_REQUIRED_TASKS[taskSelect.value] && (!commentsEl.value || !commentsEl.value.trim())) {
        hasError = true;
      }

      // Quality concern without time lost
      if (qualitySelect.value && qualitySelect.value !== 'NO CONCERNS' && !timeLostInput.value) {
        hasWarn = true;
      }

      if (hasError) card.classList.add('mh-card-error');
      else if (hasWarn) card.classList.add('mh-card-warn');
    }

    // Store reference for cross-card validation
    card._mhValidate = validateCard;

    // Wire up live validation on all relevant fields
    beginInput.addEventListener('change', validateCard);
    endInput.addEventListener('change', validateCard);
    taskSelect.addEventListener('change', validateCard);
    qualitySelect.addEventListener('change', validateCard);
    timeLostInput.addEventListener('change', validateCard);
    card.querySelector('[data-field="comments"]').addEventListener('input', validateCard);

    // Run initial validation after a tick (prefill may not be applied yet)
    setTimeout(validateCard, 50);

    beginInput.addEventListener('change', function() {
      if (beginInput.value && (!endInput.value || endInput.value <= beginInput.value)) {
        endInput.value = addMinutes(beginInput.value, 1);
      }
      updateElapsed();
      // Update next row's begin time to keep continuity
      var nextCard = card.nextElementSibling;
      if (nextCard && nextCard.classList.contains('mh-entry-card')) {
        // don't auto-chain — user may adjust manually
      }
    });

    endInput.addEventListener('change', function() {
      updateElapsed();
      // Auto-set next row's begin time for continuity
      var nextCard = card.nextElementSibling;
      if (nextCard && nextCard.classList.contains('mh-entry-card')) {
        var nextBegin = nextCard.querySelector('[data-field="beginTime"]');
        if (nextBegin && !nextBegin.value) nextBegin.value = endInput.value;
      }
    });

    card.querySelector('.remove-row-btn').addEventListener('click', function() {
      if (!confirm('Remove this entry?')) return;
      card.remove();
      mhRenumber();
      if (container.querySelectorAll('.mh-entry-card').length === 0) {
        noRowsMsg.hidden = false;
        rowCounter = 0;
      }
    });

    initTaskTruncation(taskSelect);
    if (defaultBegin && defaultEnd) updateElapsed();

    // Prefill
    if (prefill.task) {
      taskSelect.value = prefill.task;
      // Show comment required indicator if needed
      if (COMMENT_REQUIRED_TASKS[prefill.task] && commentReqLabel) commentReqLabel.style.display = '';
      applyMhCardColor(card, prefill.task);
    }
    if (prefill.mailType) card.querySelector('[data-field="mailType"]').value = prefill.mailType;
    if (prefill.equipType) card.querySelector('[data-field="equipType"]').value = prefill.equipType;
    if (prefill.equipQty) card.querySelector('[data-field="equipQty"]').value = prefill.equipQty;
    if (prefill.workQuality) {
      qualitySelect.value = prefill.workQuality;
      if (prefill.workQuality && prefill.workQuality !== 'NO CONCERNS') {
        timeLostField.style.display = '';
      }
    }
    if (prefill.timeLost) timeLostInput.value = prefill.timeLost;
    if (prefill.comments) card.querySelector('[data-field="comments"]').value = prefill.comments;
    // Show abbreviation after prefill
    if (prefill.task) {
      for (var i = 0; i < taskSelect.options.length; i++) {
        var o = taskSelect.options[i];
        if (o.dataset.short) o.textContent = o.dataset.short;
      }
    }

    taskSelect.focus();
  }

  function mhRenumber() {
    rowCounter = 0;
    container.querySelectorAll('.mh-entry-card').forEach(function(card) {
      rowCounter++;
      card.dataset.row = rowCounter;
      card.querySelector('.entry-num').textContent = rowCounter;
    });
  }

  /** Collect all MH rows as data objects */
  function mhCollectRows() {
    var rows = [];
    container.querySelectorAll('.mh-entry-card').forEach(function(card) {
      var row = {};
      card.querySelectorAll('[data-field]').forEach(function(el) {
        row[el.dataset.field] = el.value.trim();
      });
      rows.push(row);
    });
    return rows;
  }

  // Auto-save
  var _mhAutoTimer = null;
  function mhAutoSave() {
    clearTimeout(_mhAutoTimer);
    _mhAutoTimer = setTimeout(function() {
      if (container.querySelectorAll('.mh-entry-card').length === 0) return;
      if (typeof window.appMhSave === 'function') window.appMhSave(mhCollectRows());
    }, 500);
  }

  container.addEventListener('input', mhAutoSave);
  container.addEventListener('change', mhAutoSave);

  // Expose
  window.mhAddRow = mhAddRow;
  window.mhCollectRows = mhCollectRows;
  window.mhAddRowBtn = addRowBtn;
  window.mhContainer = container;
  window.mhNoRowsMsg = noRowsMsg;
  window.mhAutosaveEl = autosaveEl;
  window.MH_TASK_MAP = MH_TASK_MAP;
})();
