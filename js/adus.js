// adus.js — ADUS / SDUS Throughput logic (multi-machine)
(function() {
  'use strict';

  var STORAGE_KEY = 'clerk_obs_adus';
  var MAX_MACHINES = 2;
  var machines = []; // array of { zip, type, runs: [...] }
  var activeIdx = -1;

  // --- DOM refs ---
  var tabsContainer = document.getElementById('adus-machine-tabs');
  var newZipInput = document.getElementById('adus-new-zip');
  var newTypeSelect = document.getElementById('adus-new-type');
  var addMachineBtn = document.getElementById('adus-add-machine-btn');
  var worksheet = document.getElementById('adus-worksheet');
  var noMachinesEl = document.getElementById('adus-no-machines');
  var machineZipEl = document.getElementById('adus-machine-zip');
  var deleteMachineBtn = document.getElementById('adus-delete-machine-btn');
  var tbody = document.getElementById('adus-table-body');
  var emptyEl = document.getElementById('adus-empty');
  var addRunBtn = document.getElementById('adus-add-run');
  var autosaveEl = document.getElementById('adus-autosave-status');

  if (!tabsContainer) return;

  // Scope storage key per review+day+user
  STORAGE_KEY = STORAGE_KEY + (window.appStoragePrefix || '');

  // --- Load / Save ---
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0 && !parsed[0].zip) {
          machines = [{ zip: 'Machine 1', type: 'ADUS', runs: parsed }];
        } else if (Array.isArray(parsed)) {
          machines = parsed;
          machines.forEach(function(m) { if (!m.type) m.type = 'ADUS'; });
        }
      }
    } catch (e) { machines = []; }
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(machines));
      if (autosaveEl) autosaveEl.textContent = '\u2713 Saved ' + new Date().toLocaleTimeString();
    }, 300);
  }

  // --- Machine tabs ---
  function renderTabs() {
    tabsContainer.innerHTML = '';
    noMachinesEl.hidden = machines.length > 0;
    worksheet.hidden = machines.length === 0 || activeIdx < 0;

    // Hide add controls when at max
    var addBar = addMachineBtn.parentElement;
    addBar.style.display = machines.length >= MAX_MACHINES ? 'none' : '';

    machines.forEach(function(m, mi) {
      var btn = document.createElement('button');
      btn.className = 'ps3922-zone-tab' + (mi === activeIdx ? ' active' : '');
      btn.textContent = m.type + ' — ' + m.zip;
      btn.addEventListener('click', function() { selectMachine(mi); });
      tabsContainer.appendChild(btn);
    });
  }

  function selectMachine(mi) {
    activeIdx = mi;
    renderTabs();
    renderWorksheet();
  }

  addMachineBtn.addEventListener('click', function() {
    if (machines.length >= MAX_MACHINES) return;
    var zip = (newZipInput.value || '').trim();
    var type = newTypeSelect.value;
    if (!zip) return;
    var exists = machines.some(function(m) { return m.zip === zip; });
    if (exists) { newZipInput.value = ''; return; }
    machines.push({ zip: zip, type: type, runs: [] });
    newZipInput.value = '';
    activeIdx = machines.length - 1;
    save(); renderTabs(); renderWorksheet();
  });

  deleteMachineBtn.addEventListener('click', function() {
    if (activeIdx < 0) return;
    machines.splice(activeIdx, 1);
    activeIdx = machines.length > 0 ? Math.min(activeIdx, machines.length - 1) : -1;
    save(); renderTabs(); renderWorksheet();
  });

  function renderWorksheet() {
    if (activeIdx < 0 || !machines[activeIdx]) { worksheet.hidden = true; return; }
    worksheet.hidden = false;
    machineZipEl.textContent = machines[activeIdx].type + ' — ' + machines[activeIdx].zip;
    renderRuns();
  }

  // --- Calculations ---
  function timeDiffMinutes(start, end) {
    if (!start || !end) return 0;
    var s = start.split(':'), e = end.split(':');
    var sMin = parseInt(s[0]) * 60 + parseInt(s[1]);
    var eMin = parseInt(e[0]) * 60 + parseInt(e[1]);
    var diff = eMin - sMin;
    if (diff < 0) diff += 1440;
    return diff;
  }
  function fmtDuration(mins) {
    if (!mins) return '0:00';
    return Math.floor(mins / 60) + ':' + String(mins % 60).padStart(2, '0');
  }
  function fmtPct(num, denom) { return denom ? (num / denom * 100).toFixed(2) + '%' : '\u2014'; }
  function fmtHours(mins) { return (mins / 60).toFixed(2); }
  function fmtThroughput(pieces, mins) { return mins ? Math.round(pieces / (mins / 60)).toLocaleString() : '\u2014'; }

  // --- Render runs ---
  function renderRuns() {
    var runs = machines[activeIdx].runs;
    tbody.innerHTML = '';
    emptyEl.hidden = runs.length > 0;

    runs.forEach(function(run, ri) {
      var dur = timeDiffMinutes(run.startTime, run.endTime);
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input type="time" class="adus-input adus-start" data-ri="' + ri + '" value="' + (run.startTime || '') + '"></td>' +
        '<td><input type="time" class="adus-input adus-end" data-ri="' + ri + '" value="' + (run.endTime || '') + '"></td>' +
        '<td class="adus-calc" data-ri="' + ri + '" data-calc="duration">' + fmtDuration(dur) + '</td>' +
        '<td><input type="number" class="adus-input adus-pieces" data-ri="' + ri + '" min="0" value="' + (run.pieces || '') + '"></td>' +
        '<td class="adus-calc" data-ri="' + ri + '" data-calc="throughput">' + fmtThroughput(run.pieces || 0, dur) + '</td>' +
        '<td><input type="number" class="adus-input adus-rejects" data-ri="' + ri + '" min="0" value="' + (run.rejects || '') + '"></td>' +
        '<td><input type="number" class="adus-input adus-noreads" data-ri="' + ri + '" min="0" value="' + (run.noReads || '') + '"></td>' +
        '<td><input type="number" class="adus-input adus-nobarcode" data-ri="' + ri + '" min="0" value="' + (run.noBarcode || '') + '"></td>' +
        '<td class="adus-calc" data-ri="' + ri + '" data-calc="rejectPct">' + fmtPct(run.rejects || 0, run.pieces) + '</td>' +
        '<td class="adus-calc" data-ri="' + ri + '" data-calc="noReadPct">' + fmtPct(run.noReads || 0, run.pieces) + '</td>' +
        '<td class="adus-calc" data-ri="' + ri + '" data-calc="noBarcodePct">' + fmtPct(run.noBarcode || 0, run.pieces) + '</td>' +
        '<td class="adus-calc" data-ri="' + ri + '" data-calc="runHrs">' + fmtHours(dur) + '</td>' +
        '<td><button class="btn btn-danger btn-sm adus-del" data-ri="' + ri + '" title="Remove">&times;</button></td>';
      tbody.appendChild(tr);
    });
    bindEvents();
  }

  function updateRowCalcs(ri) {
    var run = machines[activeIdx].runs[ri];
    var dur = timeDiffMinutes(run.startTime, run.endTime);
    var cell = function(n) { return tbody.querySelector('[data-ri="' + ri + '"][data-calc="' + n + '"]'); };
    var c;
    if ((c = cell('duration'))) c.textContent = fmtDuration(dur);
    if ((c = cell('throughput'))) c.textContent = fmtThroughput(run.pieces || 0, dur);
    if ((c = cell('rejectPct'))) c.textContent = fmtPct(run.rejects || 0, run.pieces);
    if ((c = cell('noReadPct'))) c.textContent = fmtPct(run.noReads || 0, run.pieces);
    if ((c = cell('noBarcodePct'))) c.textContent = fmtPct(run.noBarcode || 0, run.pieces);
    if ((c = cell('runHrs'))) c.textContent = fmtHours(dur);
  }

  function bindEvents() {
    var runs = machines[activeIdx].runs;
    var fields = [
      { cls: '.adus-start', key: 'startTime', parse: false },
      { cls: '.adus-end', key: 'endTime', parse: false },
      { cls: '.adus-pieces', key: 'pieces', parse: true },
      { cls: '.adus-rejects', key: 'rejects', parse: true },
      { cls: '.adus-noreads', key: 'noReads', parse: true },
      { cls: '.adus-nobarcode', key: 'noBarcode', parse: true }
    ];
    fields.forEach(function(f) {
      tbody.querySelectorAll(f.cls).forEach(function(inp) {
        inp.addEventListener('input', function() {
          var ri = parseInt(inp.dataset.ri);
          runs[ri][f.key] = f.parse ? (parseInt(inp.value) || 0) : inp.value;
          save(); updateRowCalcs(ri);
        });
      });
    });
    tbody.querySelectorAll('.adus-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        runs.splice(parseInt(btn.dataset.ri), 1);
        save(); renderRuns();
      });
    });
  }

  addRunBtn.addEventListener('click', function() {
    if (activeIdx < 0) return;
    machines[activeIdx].runs.push({ startTime: '', endTime: '', pieces: 0, rejects: 0, noReads: 0, noBarcode: 0 });
    save(); renderRuns();
  });

  // --- Init ---
  load();
  if (machines.length > 0) activeIdx = 0;
  renderTabs();
  if (activeIdx >= 0) renderWorksheet();
})();

