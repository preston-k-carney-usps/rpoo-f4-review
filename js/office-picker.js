/**
 * office-picker.js — Reusable office selector component.
 * Requires offices.js (OFFICE_LIST) to be loaded first.
 *
 * Usage:
 *   OfficePicker.init(containerId, { onSelect: function(office) { ... } })
 *   OfficePicker.getValue(containerId) → { fin, office, lead, area, district }
 *   OfficePicker.setValue(containerId, officeName)
 */
var OfficePicker = (function() {

  // Build lookup indexes once
  var _areas = [];
  var _byArea = {};      // area → [{fin,office,lead,area,district}]
  var _byFin = {};       // fin → {fin,office,lead,area,district}
  var _indexed = false;

  function buildIndex() {
    if (_indexed) return;
    var areaSet = {};
    for (var i = 0; i < OFFICE_LIST.length; i++) {
      var e = OFFICE_LIST[i];
      var rec = { fin: e[0], office: e[1], lead: e[2], area: e[3], district: e[4] };
      _byFin[rec.fin] = rec;
      if (!areaSet[rec.area]) {
        areaSet[rec.area] = true;
        _areas.push(rec.area);
      }
      if (!_byArea[rec.area]) _byArea[rec.area] = [];
      _byArea[rec.area].push(rec);
    }
    _areas.sort();
    _indexed = true;
  }

  function getDistricts(area) {
    var set = {}, list = [];
    (_byArea[area] || []).forEach(function(r) {
      if (!set[r.district]) { set[r.district] = true; list.push(r.district); }
    });
    return list.sort();
  }

  function getLeads(area, district) {
    var set = {}, list = [];
    (_byArea[area] || []).forEach(function(r) {
      if (r.district === district && !set[r.lead]) { set[r.lead] = true; list.push(r.lead); }
    });
    return list.sort();
  }

  function getOffices(area, district, lead) {
    return (_byArea[area] || []).filter(function(r) {
      return r.district === district && r.lead === lead;
    }).sort(function(a, b) { return a.office < b.office ? -1 : 1; });
  }

  // --- Per-instance state ---
  var instances = {};

  function init(containerId, opts) {
    buildIndex();
    opts = opts || {};
    var container = document.getElementById(containerId);
    if (!container) return;

    // Render HTML
    container.innerHTML =
      '<div class="office-picker">' +
        '<div class="op-fin-row">' +
          '<label>Finance #</label>' +
          '<input type="text" class="op-fin" placeholder="Type finance number..." maxlength="6">' +
        '</div>' +
        '<div class="op-divider"><span>or browse</span></div>' +
        '<div class="op-dropdowns">' +
          '<div class="op-field"><label>Area</label><select class="op-area"><option value="">— Select Area —</option></select></div>' +
          '<div class="op-field"><label>District</label><select class="op-district" disabled><option value="">— Select District —</option></select></div>' +
          '<div class="op-field"><label>Lead Office</label><select class="op-lead" disabled><option value="">— Select Lead Office —</option></select></div>' +
          '<div class="op-field"><label>Office</label><select class="op-office" disabled><option value="">— Select Office —</option></select></div>' +
        '</div>' +
        '<div class="op-selected" hidden>' +
          '<span class="op-selected-label"></span>' +
          '<button type="button" class="op-clear">✕</button>' +
        '</div>' +
      '</div>';

    var finInput   = container.querySelector('.op-fin');
    var areaSel    = container.querySelector('.op-area');
    var distSel    = container.querySelector('.op-district');
    var leadSel    = container.querySelector('.op-lead');
    var officeSel  = container.querySelector('.op-office');
    var selectedEl = container.querySelector('.op-selected');
    var selectedLbl= container.querySelector('.op-selected-label');
    var clearBtn   = container.querySelector('.op-clear');

    var inst = { selected: null, onSelect: opts.onSelect || function() {} };
    instances[containerId] = inst;

    // Populate areas
    _areas.forEach(function(a) {
      var o = document.createElement('option');
      o.value = a; o.textContent = a;
      areaSel.appendChild(o);
    });

    // Finance # instant lookup
    finInput.addEventListener('input', function() {
      var val = finInput.value.trim();
      if (val.length >= 3) {
        var rec = _byFin[val];
        if (rec) {
          selectOffice(rec);
          return;
        }
      }
      // No exact match yet — clear if previously set by fin
    });

    // Area change
    areaSel.addEventListener('change', function() {
      distSel.innerHTML = '<option value="">— Select District —</option>';
      leadSel.innerHTML = '<option value="">— Select Lead Office —</option>';
      officeSel.innerHTML = '<option value="">— Select Office —</option>';
      distSel.disabled = true;
      leadSel.disabled = true;
      officeSel.disabled = true;
      if (!areaSel.value) return;
      var dists = getDistricts(areaSel.value);
      dists.forEach(function(d) {
        var o = document.createElement('option');
        o.value = d; o.textContent = d;
        distSel.appendChild(o);
      });
      distSel.disabled = false;
    });

    // District change
    distSel.addEventListener('change', function() {
      leadSel.innerHTML = '<option value="">— Select Lead Office —</option>';
      officeSel.innerHTML = '<option value="">— Select Office —</option>';
      leadSel.disabled = true;
      officeSel.disabled = true;
      if (!distSel.value) return;
      var leads = getLeads(areaSel.value, distSel.value);
      leads.forEach(function(l) {
        var o = document.createElement('option');
        o.value = l; o.textContent = l;
        leadSel.appendChild(o);
      });
      leadSel.disabled = false;
    });

    // Lead change
    leadSel.addEventListener('change', function() {
      officeSel.innerHTML = '<option value="">— Select Office —</option>';
      officeSel.disabled = true;
      if (!leadSel.value) return;
      var offices = getOffices(areaSel.value, distSel.value, leadSel.value);
      offices.forEach(function(r) {
        var o = document.createElement('option');
        o.value = r.fin; o.textContent = r.office + ' (' + r.fin + ')';
        officeSel.appendChild(o);
      });
      officeSel.disabled = false;
    });

    // Office selected from dropdown
    officeSel.addEventListener('change', function() {
      if (!officeSel.value) return;
      var rec = _byFin[officeSel.value];
      if (rec) selectOffice(rec);
    });

    // Clear selection
    clearBtn.addEventListener('click', function() {
      inst.selected = null;
      selectedEl.hidden = true;
      finInput.value = '';
      areaSel.value = '';
      areaSel.dispatchEvent(new Event('change'));
      finInput.focus();
      inst.onSelect(null);
    });

    function selectOffice(rec) {
      inst.selected = rec;
      selectedLbl.textContent = rec.office + ' — Fin# ' + rec.fin;
      selectedEl.hidden = false;

      // Sync dropdowns
      areaSel.value = rec.area;
      areaSel.dispatchEvent(new Event('change'));
      setTimeout(function() {
        distSel.value = rec.district;
        distSel.dispatchEvent(new Event('change'));
        setTimeout(function() {
          leadSel.value = rec.lead;
          leadSel.dispatchEvent(new Event('change'));
          setTimeout(function() {
            officeSel.value = rec.fin;
          }, 0);
        }, 0);
      }, 0);

      finInput.value = rec.fin;
      inst.onSelect(rec);
    }

    // Expose selectOffice for setValue
    inst._selectOffice = selectOffice;
    inst._finInput = finInput;
  }

  function getValue(containerId) {
    var inst = instances[containerId];
    return inst ? inst.selected : null;
  }

  function setValue(containerId, officeName) {
    buildIndex();
    var inst = instances[containerId];
    if (!inst) return;
    // Find by office name (case-insensitive)
    var upper = officeName.toUpperCase();
    for (var i = 0; i < OFFICE_LIST.length; i++) {
      if (OFFICE_LIST[i][1].toUpperCase() === upper) {
        inst._selectOffice({ fin: OFFICE_LIST[i][0], office: OFFICE_LIST[i][1], lead: OFFICE_LIST[i][2], area: OFFICE_LIST[i][3], district: OFFICE_LIST[i][4] });
        return;
      }
    }
    // If not found in directory, just set the fin input as-is
    inst._finInput.value = '';
  }

  function setByFin(containerId, fin) {
    buildIndex();
    var inst = instances[containerId];
    if (!inst) return;
    var rec = _byFin[fin];
    if (rec) inst._selectOffice(rec);
  }

  return { init: init, getValue: getValue, setValue: setValue, setByFin: setByFin };
})();
