/**
 * ps3922.js — PS Form 3922 Volume Recording Worksheet
 *
 * Dynamic received columns for Letters and Flats.
 * Column layout:
 *   Trip | Ltr Recv 1..N | Ltr Missort | Ltr Total |
 *         Flt Recv 1..N | Flt Missort | Flt Total |
 *         PO Box Walled: Non-DPS Ltrs | Flats |
 *         Parcels Received
 *
 * Piece conversion: 221 letters per 12 in, 115 flats per 12 in
 */

(function() {
  var STORAGE_KEY = 'clerk_obs_3922';
  var LTR_PER_12IN = 221;
  var FLT_PER_12IN = 115;

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch(e) { return {}; }
  }
  function saveAll(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

  function getObsId() {
    var setup = localStorage.getItem('reviewDaySetup');
    if (setup) {
      try { var s = JSON.parse(setup); return s.reviewId + '_' + (s.dayNumber || '1'); }
      catch(e) {}
    }
    return 'unsaved';
  }

  function loadZones() {
    var all = loadAll();
    var obsId = getObsId();
    if (!all[obsId]) all[obsId] = { zones: [] };
    return all[obsId].zones;
  }

  function saveZones(zones) {
    var all = loadAll();
    all[getObsId()] = { zones: zones };
    saveAll(all);
  }

  // --- DOM refs ---
  var zoneTabsEl    = document.getElementById('ps3922-zone-tabs');
  var worksheetEl   = document.getElementById('ps3922-worksheet');
  var emptyEl       = document.getElementById('ps3922-empty');
  var newZoneInput  = document.getElementById('ps3922-new-zone');
  var addZoneBtn    = document.getElementById('ps3922-add-zone-btn');
  var deleteZoneBtn = document.getElementById('ps3922-delete-zone-btn');
  var zoneNameEl    = document.getElementById('ps3922-zone-name');
  var tableContainer= document.getElementById('ps3922-table-container');
  var dpsInput      = document.getElementById('ps3922-dps-input');
  var autosaveEl    = document.getElementById('ps3922-autosave-status');

  if (!zoneTabsEl) return;

  var activeZoneIdx = -1;
  var zones = loadZones();

  // --- Migrate old data format ---
  zones.forEach(function(z) {
    z.mode = 'trips';
    if (z.dps === undefined) z.dps = 0;
    if (z.ltrRecvCols === undefined) z.ltrRecvCols = 1;
    if (z.fltRecvCols === undefined) z.fltRecvCols = 1;
    // Migrate summary mode zones: expand single row to On Hand + Trip 1
    if (z.rows.length < 2) {
      while (z.rows.length < 2) z.rows.push(emptyRow(z.ltrRecvCols || 1, z.fltRecvCols || 1));
    }
    z.rows.forEach(function(r) {
      if (!Array.isArray(r.ltrRecv)) r.ltrRecv = [r.ltrRecv || 0];
      if (!Array.isArray(r.fltRecv)) r.fltRecv = [r.fltRecv || 0];
      if (r.walledParcels !== undefined) { r.parcels = r.walledParcels; delete r.walledParcels; }
      if (r.walledPoBox !== undefined) { delete r.walledPoBox; }
      if (r.parcels === undefined) r.parcels = 0;
      if (r.walledLtrs === undefined) r.walledLtrs = 0;
      if (r.walledFlts === undefined) r.walledFlts = 0;
      while (r.ltrRecv.length < z.ltrRecvCols) r.ltrRecv.push(0);
      while (r.fltRecv.length < z.fltRecvCols) r.fltRecv.push(0);
    });
  });

  function tripLabel(ri) {
    return ri === 0 ? 'On Hand' : 'Trip ' + ri;
  }

  function emptyRow(ltrCols, fltCols) {
    var lr = []; for (var i = 0; i < ltrCols; i++) lr.push(0);
    var fr = []; for (var j = 0; j < fltCols; j++) fr.push(0);
    return { ltrRecv: lr, ltrMissort: 0, fltRecv: fr, fltMissort: 0, walledLtrs: 0, walledFlts: 0, parcels: 0 };
  }

  function defaultRows(ltrCols, fltCols) {
    return [emptyRow(ltrCols, fltCols), emptyRow(ltrCols, fltCols)];
  }

  // --- Autosave helper ---
  var _saveTimeout = null;
  function autosave() {
    clearTimeout(_saveTimeout);
    _saveTimeout = setTimeout(function() {
      saveZones(zones);
      if (autosaveEl) {
        autosaveEl.textContent = '✓ Saved just now';
        setTimeout(function() { autosaveEl.textContent = '✓ All changes auto-saved'; }, 2000);
      }
    }, 300);
  }

  // --- Render zone tabs ---
  function renderTabs() {
    zoneTabsEl.innerHTML = '';
    zones.forEach(function(z, idx) {
      var btn = document.createElement('button');
      btn.className = 'ps3922-zone-tab' + (idx === activeZoneIdx ? ' active' : '');
      btn.textContent = z.zone;
      btn.addEventListener('click', function() { selectZone(idx); });
      zoneTabsEl.appendChild(btn);
    });
    if (zones.length === 0) { worksheetEl.hidden = true; emptyEl.hidden = false; }
  }

  function selectZone(idx) {
    activeZoneIdx = idx;
    renderTabs();
    if (idx < 0 || idx >= zones.length) {
      worksheetEl.hidden = true; emptyEl.hidden = false; return;
    }
    worksheetEl.hidden = false; emptyEl.hidden = true;
    var z = zones[idx];
    zoneNameEl.textContent = z.zone;
    dpsInput.value = z.dps || '';
    renderFullTable(z);
  }

  // --- Build entire table dynamically ---
  function renderFullTable(zone) {
    var lc = zone.ltrRecvCols;
    var fc = zone.fltRecvCols;

    var html = '<table class="ps3922-table">';
    html += '<thead>';

    // Row 1: group headers
    html += '<tr class="ps3922-header-group">';
    html += '<th rowspan="2" class="ps3922-trip-col">Trip</th>';
    html += '<th colspan="' + (lc + 2) + '" class="ps3922-ltr-header">Letters (inches)</th>';
    html += '<th colspan="' + (fc + 2) + '" class="ps3922-flt-header">Flats (inches)</th>';
    html += '<th colspan="3" class="ps3922-walled-header">PO Box</th>';
    html += '</tr>';

    // Row 2: sub-headers
    html += '<tr class="ps3922-header-sub">';
    for (var li = 0; li < lc; li++) {
      var lLabel = lc === 1 ? 'Received' : 'Recv ' + (li + 1);
      var rmBtn = lc > 1 ? ' <button class="ps3922-rm-col-btn" data-type="ltr" data-col="' + li + '" title="Remove column">&times;</button>' : '';
      var addBtn = (li === lc - 1) ? ' <button class="ps3922-add-col-btn" data-type="ltr" title="Add letter received column">+</button>' : '';
      html += '<th class="ps3922-ltr-sub">' + lLabel + rmBtn + addBtn + '</th>';
    }
    html += '<th class="ps3922-ltr-sub">Missort</th>';
    html += '<th class="ps3922-ltr-sub">Total</th>';

    for (var fi = 0; fi < fc; fi++) {
      var fLabel = fc === 1 ? 'Received' : 'Recv ' + (fi + 1);
      var frmBtn = fc > 1 ? ' <button class="ps3922-rm-col-btn" data-type="flt" data-col="' + fi + '" title="Remove column">&times;</button>' : '';
      var fAddBtn = (fi === fc - 1) ? ' <button class="ps3922-add-col-btn" data-type="flt" title="Add flat received column">+</button>' : '';
      html += '<th class="ps3922-flt-sub">' + fLabel + frmBtn + fAddBtn + '</th>';
    }
    html += '<th class="ps3922-flt-sub">Missort</th>';
    html += '<th class="ps3922-flt-sub">Total</th>';

    html += '<th class="ps3922-walled-sub">Non-DPS Ltrs<br><span style="font-size:0.7rem;font-weight:400;">(walled)</span></th>';
    html += '<th class="ps3922-walled-sub">Flats<br><span style="font-size:0.7rem;font-weight:400;">(walled)</span></th>';
    html += '<th class="ps3922-walled-sub ps3922-parcels-sub">Parcels<br><span style="font-size:0.7rem;font-weight:400;">(received)</span></th>';
    html += '</tr></thead>';

    // --- TBODY ---
    html += '<tbody>';
    zone.rows.forEach(function(row, ri) {
      var rowLabel = tripLabel(ri);
      var canRemove = zone.rows.length > 2 && ri >= 2;
      html += '<tr>';
      html += '<td>' + rowLabel + (canRemove ? ' <button class="ps3922-rm-trip-btn" data-ri="' + ri + '" title="Remove trip">&times;</button>' : '') + '</td>';
      for (var a = 0; a < lc; a++) {
        html += '<td><input type="number" min="0" step="any" value="' + (row.ltrRecv[a] || '') + '" data-ri="' + ri + '" data-field="ltrRecv" data-ci="' + a + '"></td>';
      }
      html += '<td><input type="number" min="0" step="any" value="' + (row.ltrMissort || '') + '" data-ri="' + ri + '" data-field="ltrMissort"></td>';
      var ltrSum = row.ltrRecv.reduce(function(s, v) { return s + (v || 0); }, 0) + (row.ltrMissort || 0);
      html += '<td class="ps3922-auto">' + ltrSum + '</td>';

      for (var b = 0; b < fc; b++) {
        html += '<td><input type="number" min="0" step="any" value="' + (row.fltRecv[b] || '') + '" data-ri="' + ri + '" data-field="fltRecv" data-ci="' + b + '"></td>';
      }
      html += '<td><input type="number" min="0" step="any" value="' + (row.fltMissort || '') + '" data-ri="' + ri + '" data-field="fltMissort"></td>';
      var fltSum = row.fltRecv.reduce(function(s, v) { return s + (v || 0); }, 0) + (row.fltMissort || 0);
      html += '<td class="ps3922-auto">' + fltSum + '</td>';

      html += '<td><input type="number" min="0" step="any" value="' + (row.walledLtrs || '') + '" data-ri="' + ri + '" data-field="walledLtrs"></td>';
      html += '<td><input type="number" min="0" step="any" value="' + (row.walledFlts || '') + '" data-ri="' + ri + '" data-field="walledFlts"></td>';
      html += '<td><input type="number" min="0" step="any" value="' + (row.parcels || '') + '" data-ri="' + ri + '" data-field="parcels"></td>';
      html += '</tr>';
    });
    html += '</tbody>';

    // --- TFOOT ---
    html += '<tfoot><tr class="ps3922-totals-row"><td><strong>Totals</strong></td>';
    for (var tl = 0; tl < lc; tl++) {
      html += '<td class="ps3922-total">' + zone.rows.reduce(function(s, r) { return s + (r.ltrRecv[tl] || 0); }, 0) + '</td>';
    }
    var totLM = zone.rows.reduce(function(s, r) { return s + (r.ltrMissort || 0); }, 0);
    var totLR = zone.rows.reduce(function(s, r) { return s + r.ltrRecv.reduce(function(a, v) { return a + (v||0); }, 0); }, 0);
    html += '<td class="ps3922-total">' + totLM + '</td>';
    html += '<td class="ps3922-total">' + (totLR + totLM) + '</td>';

    for (var tf = 0; tf < fc; tf++) {
      html += '<td class="ps3922-total">' + zone.rows.reduce(function(s, r) { return s + (r.fltRecv[tf] || 0); }, 0) + '</td>';
    }
    var totFM = zone.rows.reduce(function(s, r) { return s + (r.fltMissort || 0); }, 0);
    var totFR = zone.rows.reduce(function(s, r) { return s + r.fltRecv.reduce(function(a, v) { return a + (v||0); }, 0); }, 0);
    html += '<td class="ps3922-total">' + totFM + '</td>';
    html += '<td class="ps3922-total">' + (totFR + totFM) + '</td>';

    html += '<td class="ps3922-total">' + zone.rows.reduce(function(s, r) { return s + (r.walledLtrs || 0); }, 0) + '</td>';
    html += '<td class="ps3922-total">' + zone.rows.reduce(function(s, r) { return s + (r.walledFlts || 0); }, 0) + '</td>';
    html += '<td class="ps3922-total">' + zone.rows.reduce(function(s, r) { return s + (r.parcels || 0); }, 0) + '</td>';
    html += '</tr></tfoot></table>';

    html += '<button class="btn btn-secondary btn-sm ps3922-add-trip-btn" style="margin-top:0.5rem;">+ Add Trip</button>';

    tableContainer.innerHTML = html;

    // Piece conversion
    updatePieceConversion(totLR + totLM, totFR + totFM);

    // --- Wire inputs ---
    tableContainer.querySelectorAll('input').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var ri = parseInt(inp.dataset.ri);
        var field = inp.dataset.field;
        var val = parseFloat(inp.value) || 0;
        var row = zones[activeZoneIdx].rows[ri];

        if (field === 'ltrRecv' || field === 'fltRecv') {
          row[field][parseInt(inp.dataset.ci)] = val;
        } else {
          row[field] = val;
        }

        var tr = inp.closest('tr');
        var autoCells = tr.querySelectorAll('.ps3922-auto');
        if (autoCells[0]) autoCells[0].textContent = row.ltrRecv.reduce(function(s, v) { return s + (v||0); }, 0) + (row.ltrMissort || 0);
        if (autoCells[1]) autoCells[1].textContent = row.fltRecv.reduce(function(s, v) { return s + (v||0); }, 0) + (row.fltMissort || 0);

        updateFooterTotals(zones[activeZoneIdx]);
        autosave();
      });
    });

    // --- Add/remove column buttons ---
    tableContainer.querySelectorAll('.ps3922-add-col-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        var type = btn.dataset.type;
        var z = zones[activeZoneIdx];
        if (type === 'ltr') { z.ltrRecvCols++; z.rows.forEach(function(r) { r.ltrRecv.push(0); }); }
        else { z.fltRecvCols++; z.rows.forEach(function(r) { r.fltRecv.push(0); }); }
        renderFullTable(z);
        autosave();
      });
    });

    tableContainer.querySelectorAll('.ps3922-rm-col-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        var type = btn.dataset.type;
        var ci = parseInt(btn.dataset.col);
        var z = zones[activeZoneIdx];
        if (type === 'ltr' && z.ltrRecvCols > 1) {
          z.ltrRecvCols--;
          z.rows.forEach(function(r) { r.ltrRecv.splice(ci, 1); });
        } else if (type === 'flt' && z.fltRecvCols > 1) {
          z.fltRecvCols--;
          z.rows.forEach(function(r) { r.fltRecv.splice(ci, 1); });
        }
        renderFullTable(z);
        autosave();
      });
    });

    // --- Add/remove trip row buttons ---
    var addTripBtn = tableContainer.querySelector('.ps3922-add-trip-btn');
    if (addTripBtn) {
      addTripBtn.addEventListener('click', function(e) {
        e.preventDefault();
        var z = zones[activeZoneIdx];
        z.rows.push(emptyRow(z.ltrRecvCols, z.fltRecvCols));
        renderFullTable(z);
        autosave();
      });
    }

    tableContainer.querySelectorAll('.ps3922-rm-trip-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var ri = parseInt(btn.dataset.ri);
        var z = zones[activeZoneIdx];
        if (z.rows.length > 2 && ri >= 2) {
          z.rows.splice(ri, 1);
          renderFullTable(z);
          autosave();
        }
      });
    });
  }

  function updateFooterTotals(zone) {
    var lc = zone.ltrRecvCols, fc = zone.fltRecvCols;
    var tfoot = tableContainer.querySelector('tfoot');
    if (!tfoot) return;
    var cells = tfoot.querySelectorAll('td');
    var ci = 1;

    for (var tl = 0; tl < lc; tl++) {
      cells[ci++].textContent = zone.rows.reduce(function(s, r) { return s + (r.ltrRecv[tl] || 0); }, 0);
    }
    var totLM = zone.rows.reduce(function(s, r) { return s + (r.ltrMissort || 0); }, 0);
    var totLR = zone.rows.reduce(function(s, r) { return s + r.ltrRecv.reduce(function(a, v) { return a + (v||0); }, 0); }, 0);
    cells[ci++].textContent = totLM;
    cells[ci++].textContent = totLR + totLM;

    for (var tf = 0; tf < fc; tf++) {
      cells[ci++].textContent = zone.rows.reduce(function(s, r) { return s + (r.fltRecv[tf] || 0); }, 0);
    }
    var totFM = zone.rows.reduce(function(s, r) { return s + (r.fltMissort || 0); }, 0);
    var totFR = zone.rows.reduce(function(s, r) { return s + r.fltRecv.reduce(function(a, v) { return a + (v||0); }, 0); }, 0);
    cells[ci++].textContent = totFM;
    cells[ci++].textContent = totFR + totFM;

    cells[ci++].textContent = zone.rows.reduce(function(s, r) { return s + (r.walledLtrs || 0); }, 0);
    cells[ci++].textContent = zone.rows.reduce(function(s, r) { return s + (r.walledFlts || 0); }, 0);
    cells[ci++].textContent = zone.rows.reduce(function(s, r) { return s + (r.parcels || 0); }, 0);

    updatePieceConversion(totLR + totLM, totFR + totFM);
  }

  function updatePieceConversion(totalLtrIn, totalFltIn) {
    document.getElementById('ps3922-conv-ltrs').textContent = Math.round((totalLtrIn / 12) * LTR_PER_12IN).toLocaleString() + ' pcs';
    document.getElementById('ps3922-conv-flts').textContent = Math.round((totalFltIn / 12) * FLT_PER_12IN).toLocaleString() + ' pcs';
  }

  // --- DPS input ---
  dpsInput.addEventListener('input', function() {
    if (activeZoneIdx < 0) return;
    zones[activeZoneIdx].dps = parseInt(dpsInput.value) || 0;
    autosave();
  });

  // --- Add zone ---
  addZoneBtn.addEventListener('click', function() {
    var name = newZoneInput.value.trim().toUpperCase();
    if (!name) { newZoneInput.focus(); return; }
    for (var i = 0; i < zones.length; i++) {
      if (zones[i].zone === name) { selectZone(i); newZoneInput.value = ''; return; }
    }
    zones.push({ zone: name, mode: 'trips', dps: 0, ltrRecvCols: 1, fltRecvCols: 1, rows: defaultRows(1, 1) });
    saveZones(zones);
    newZoneInput.value = '';
    selectZone(zones.length - 1);
  });

  newZoneInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') addZoneBtn.click(); });

  // --- Delete zone ---
  deleteZoneBtn.addEventListener('click', function() {
    if (activeZoneIdx < 0 || !zones[activeZoneIdx]) return;
    if (!confirm('Delete zone "' + zones[activeZoneIdx].zone + '" and all its data?')) return;
    zones.splice(activeZoneIdx, 1);
    saveZones(zones);
    activeZoneIdx = zones.length > 0 ? 0 : -1;
    renderTabs();
    if (activeZoneIdx >= 0) selectZone(activeZoneIdx);
    else { worksheetEl.hidden = true; emptyEl.hidden = false; }
  });

  // --- Piece Conversion Calculator ---
  var calcLtrIn  = document.getElementById('ps3922-calc-ltr-in');
  var calcLtrPcs = document.getElementById('ps3922-calc-ltr-pcs');
  var calcFltIn  = document.getElementById('ps3922-calc-flt-in');
  var calcFltPcs = document.getElementById('ps3922-calc-flt-pcs');

  if (calcLtrIn) {
    calcLtrIn.addEventListener('input', function() {
      var inches = parseFloat(calcLtrIn.value) || 0;
      calcLtrPcs.value = inches ? Math.round((inches / 12) * LTR_PER_12IN) : '';
    });
    calcLtrPcs.addEventListener('input', function() {
      var pcs = parseFloat(calcLtrPcs.value) || 0;
      calcLtrIn.value = pcs ? Math.round((pcs / LTR_PER_12IN) * 12 * 100) / 100 : '';
    });
    calcFltIn.addEventListener('input', function() {
      var inches = parseFloat(calcFltIn.value) || 0;
      calcFltPcs.value = inches ? Math.round((inches / 12) * FLT_PER_12IN) : '';
    });
    calcFltPcs.addEventListener('input', function() {
      var pcs = parseFloat(calcFltPcs.value) || 0;
      calcFltIn.value = pcs ? Math.round((pcs / FLT_PER_12IN) * 12 * 100) / 100 : '';
    });
  }

  // --- Init ---
  renderTabs();
  if (zones.length > 0) selectZone(0);
})();
