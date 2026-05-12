// summarization.js — Summarization Comments with tab-area linking
(function() {
  'use strict';

  var STORAGE_KEY = 'clerk_obs_summarization';
  var listEl = document.getElementById('summ-list');
  var emptyEl = document.getElementById('summ-empty');
  var addBtn = document.getElementById('summ-add-btn');
  var autosaveEl = document.getElementById('summ-autosave-status');

  if (!listEl) return;

  // Scope storage key per review+day+user
  STORAGE_KEY = STORAGE_KEY + (window.appStoragePrefix || '');

  // Linkable areas — value matches data-tab ids
  var AREAS = [
    { value: '',                   label: '-- Link to Area (optional) --' },
    { value: 'tab-clerk-notes',    label: 'Clerk Notes' },
    { value: 'tab-ps3922',         label: 'PS 3922' },
    { value: 'tab-trips',          label: 'Record Trips' },
    { value: 'tab-scf',            label: 'SCF Hub' },
    { value: 'tab-adus',           label: 'ADUS/SDUS' },
    { value: 'tab-questionnaire',  label: 'Questionnaire' }
  ];

  // LDC categories for finer linking when area is Clerk Notes
  var LDC_REFS = [
    { value: '',     label: '-- LDC (optional) --' },
    { value: '41',   label: 'LDC 41 — ADUS/SDUS' },
    { value: '42',   label: 'LDC 42 — BRM/PD/PRS' },
    { value: '43A',  label: 'LDC 43A — Allied Duties' },
    { value: '43L',  label: 'LDC 43L — Manual Flats' },
    { value: '43F',  label: 'LDC 43F — Manual Letters' },
    { value: '43P',  label: 'LDC 43P — Manual Parcels' },
    { value: '44',   label: 'LDC 44 — PO Box Distribution' },
    { value: '45',   label: 'LDC 45 — Retail Window Services' },
    { value: '48',   label: 'LDC 48 — Misc Customer Service' }
  ];

  var comments = []; // { area, ldcRef, entryRef, text }

  // --- Load / Save ---
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) comments = JSON.parse(raw);
    } catch(e) { comments = []; }
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
      if (autosaveEl) autosaveEl.textContent = '\u2713 Saved ' + new Date().toLocaleTimeString();
    }, 300);
  }

  // --- Build select HTML ---
  function areaOptionsHtml(selected) {
    return AREAS.map(function(a) {
      return '<option value="' + a.value + '"' + (a.value === selected ? ' selected' : '') + '>' + a.label + '</option>';
    }).join('');
  }

  function ldcOptionsHtml(selected) {
    return LDC_REFS.map(function(l) {
      return '<option value="' + l.value + '"' + (l.value === selected ? ' selected' : '') + '>' + l.label + '</option>';
    }).join('');
  }

  // Build entry-row references from current clerk notes
  function entryRefOptions(selected) {
    var opts = '<option value="">-- Entry Row (optional) --</option>';
    var cards = document.querySelectorAll('#rows-container .entry-card');
    cards.forEach(function(card, i) {
      var num = i + 1;
      var ldcSel = card.querySelector('[data-field="ldc"]');
      var ldcText = '';
      if (ldcSel && ldcSel.selectedOptions && ldcSel.selectedOptions[0]) {
        ldcText = ldcSel.selectedOptions[0].getAttribute('data-short') || ldcSel.selectedOptions[0].textContent;
      }
      var beginEl = card.querySelector('[data-field="beginTime"]');
      var begin = (beginEl && beginEl.value) ? beginEl.value : '';
      var label = 'Row ' + num;
      if (ldcText) label += ' — ' + ldcText;
      if (begin) label += ' @ ' + begin;
      var val = String(num);
      opts += '<option value="' + val + '"' + (val === selected ? ' selected' : '') + '>' + label + '</option>';
    });
    return opts;
  }

  // --- Render ---
  function render() {
    listEl.innerHTML = '';
    emptyEl.hidden = comments.length > 0;

    comments.forEach(function(c, ci) {
      var card = document.createElement('div');
      card.className = 'summ-card';

      var showLdc = c.area === 'tab-clerk-notes';
      var showEntry = c.area === 'tab-clerk-notes';

      card.innerHTML =
        '<div class="summ-card-header">' +
          '<span class="summ-card-num">' + (ci + 1) + '</span>' +
          '<div class="summ-link-controls">' +
            '<select class="summ-area-select" data-ci="' + ci + '">' + areaOptionsHtml(c.area || '') + '</select>' +
            '<select class="summ-ldc-select' + (showLdc ? '' : ' hidden') + '" data-ci="' + ci + '">' + ldcOptionsHtml(c.ldcRef || '') + '</select>' +
            '<select class="summ-entry-select' + (showEntry ? '' : ' hidden') + '" data-ci="' + ci + '">' + entryRefOptions(c.entryRef || '') + '</select>' +
          '</div>' +
          '<div class="summ-card-actions">' +
            (c.area ? '<button class="btn btn-outline btn-sm summ-goto" data-ci="' + ci + '" title="Go to linked area">&#x2197;</button>' : '') +
            '<button class="btn btn-danger btn-sm summ-del" data-ci="' + ci + '" title="Delete comment">&times;</button>' +
          '</div>' +
        '</div>' +
        '<textarea class="summ-text" data-ci="' + ci + '" placeholder="Write your observation summary..." rows="3">' + (c.text || '') + '</textarea>';

      listEl.appendChild(card);
    });

    bindEvents();
  }

  function bindEvents() {
    // Area select
    listEl.querySelectorAll('.summ-area-select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var ci = parseInt(sel.dataset.ci);
        comments[ci].area = sel.value;
        comments[ci].ldcRef = '';
        comments[ci].entryRef = '';
        save(); render();
      });
    });

    // LDC ref select
    listEl.querySelectorAll('.summ-ldc-select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var ci = parseInt(sel.dataset.ci);
        comments[ci].ldcRef = sel.value;
        save();
      });
    });

    // Entry ref select
    listEl.querySelectorAll('.summ-entry-select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var ci = parseInt(sel.dataset.ci);
        comments[ci].entryRef = sel.value;
        save();
      });
    });

    // Comment text
    listEl.querySelectorAll('.summ-text').forEach(function(ta) {
      ta.addEventListener('input', function() {
        var ci = parseInt(ta.dataset.ci);
        comments[ci].text = ta.value;
        save();
      });
    });

    // Go-to linked area
    listEl.querySelectorAll('.summ-goto').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var ci = parseInt(btn.dataset.ci);
        var c = comments[ci];
        if (!c.area) return;
        // Click the matching tab to navigate
        var tab = document.querySelector('.review-tab[data-tab="' + c.area + '"]');
        if (tab) {
          tab.click();
          // If linking to a specific clerk notes entry row, scroll to it
          if (c.area === 'tab-clerk-notes' && c.entryRef) {
            setTimeout(function() {
              var cards = document.querySelectorAll('#rows-container .entry-card');
              var idx = parseInt(c.entryRef) - 1;
              if (cards[idx]) {
                cards[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                cards[idx].classList.add('summ-highlight');
                setTimeout(function() { cards[idx].classList.remove('summ-highlight'); }, 2000);
              }
            }, 100);
          }
        }
      });
    });

    // Delete
    listEl.querySelectorAll('.summ-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        comments.splice(parseInt(btn.dataset.ci), 1);
        save(); render();
      });
    });
  }

  // --- Add ---
  addBtn.addEventListener('click', function() {
    comments.push({ area: '', ldcRef: '', entryRef: '', text: '' });
    save(); render();
    // Focus the new textarea
    var last = listEl.querySelector('.summ-card:last-child .summ-text');
    if (last) last.focus();
  });

  // --- Re-render on tab switch to refresh entry refs ---
  document.querySelectorAll('.review-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      if (tab.dataset.tab === 'tab-summary-comments') {
        render();
      }
    });
  });

  // --- Init ---
  load();
  render();
})();
