// trips.js — Record Trips & SCF Hub logic
(function() {
  'use strict';

  var STORAGE_KEY = 'clerk_obs_trips';
  var MAILFLOW_KEY = 'clerk_obs_trips_mailflow';
  var SCF_KEY = 'clerk_obs_scf';

  var CONTAINER_TYPES = [
    { id: 'hamper', label: 'Hamper' },
    { id: 'gurney', label: 'Gurney' },
    { id: 'ucart', label: 'U-Cart' },
    { id: 'gpmc', label: 'GPMC (APC)' },
    { id: 'wire', label: 'Wire Container' },
    { id: 'otr', label: 'OTR/BMC' },
    { id: 'cardboard', label: 'Cardboard/Gaylord' },
    { id: 'sack', label: 'Sack' },
    { id: 'pallet', label: 'Pallet' }
  ];

  var TRIP_SOURCES = ['AMAZON', 'USPS', 'FEDEX', 'UPS', 'DHL', 'WAL-MART', 'TARGET'];

  // --- State ---
  var trips = [];  // array of trip objects
  var mailflowNotes = []; // array of { trip, container, qty, comment }

  // --- DOM refs ---
  var cardsContainer = document.getElementById('trips-cards-container');
  var tripsEmpty = document.getElementById('trips-empty');
  var addTripBtn = document.getElementById('trips-add-btn');
  var autosaveEl = document.getElementById('trips-autosave-status');
  var mailflowContainer = document.getElementById('mailflow-notes-container');
  var mailflowEmpty = document.getElementById('mailflow-empty');
  var mailflowAddBtn = document.getElementById('mailflow-add-btn');

  if (!cardsContainer) return; // Not on the review page

  // Scope storage keys per review+day+user
  STORAGE_KEY = STORAGE_KEY + (window.appStoragePrefix || '');
  MAILFLOW_KEY = MAILFLOW_KEY + (window.appStoragePrefix || '');
  SCF_KEY = SCF_KEY + (window.appStoragePrefix || '');

  // --- Load ---
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) trips = JSON.parse(raw);
    } catch (e) { trips = []; }

    try {
      var raw2 = localStorage.getItem(MAILFLOW_KEY);
      if (raw2) mailflowNotes = JSON.parse(raw2);
    } catch (e) { mailflowNotes = []; }

    // Always ensure On Hand exists
    if (trips.length === 0) {
      trips.push(createTrip(true));
    }
  }

  // --- Save ---
  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
      localStorage.setItem(MAILFLOW_KEY, JSON.stringify(mailflowNotes));
      if (autosaveEl) autosaveEl.textContent = '✓ Saved ' + new Date().toLocaleTimeString();
    }, 300);
  }

  // --- Create trip object ---
  function createTrip(isOnHand) {
    return {
      id: Date.now() + Math.random(),
      isOnHand: !!isOnHand,
      source: isOnHand ? 'ON HAND' : '',
      containers: [],  // array of { type, full, threeQ, half, quarter }
      arrival: '',
      depart: '',
      unloadMin: ''
    };
  }

  // --- Render all trip cards ---
  function render() {
    cardsContainer.innerHTML = '';
    tripsEmpty.hidden = trips.length > 0;

    trips.forEach(function(trip, ti) {
      var card = document.createElement('div');
      card.className = 'trips-card card';
      card.innerHTML = buildTripCard(trip, ti);
      cardsContainer.appendChild(card);
      bindTripCard(card, trip, ti);
    });
  }

  function tripLabel(ti) {
    if (ti === 0) return 'On Hand';
    return 'Trip ' + ti;
  }

  function buildTripCard(trip, ti) {
    var isOnHand = trip.isOnHand;
    var html = '';

    // Header
    html += '<div class="trips-card-header">';
    html += '<h3 class="trips-card-title">' + tripLabel(ti) + '</h3>';
    html += '<div class="trips-card-actions">';
    if (!isOnHand) {
      html += '<button class="btn btn-danger btn-sm trips-delete-card" data-ti="' + ti + '">Delete</button>';
    }
    html += '</div></div>';

    // Trip Source (not for On Hand)
    if (!isOnHand) {
      html += '<div class="trips-meta-row">';
      html += '<div class="trips-meta-field">';
      html += '<label>Trip Source</label>';
      html += '<select class="trips-source" data-ti="' + ti + '">';
      html += '<option value="">— Select —</option>';
      TRIP_SOURCES.forEach(function(s) {
        html += '<option value="' + s + '"' + (trip.source === s ? ' selected' : '') + '>' + s + '</option>';
      });
      html += '</select></div>';
      html += '<div class="trips-meta-field">';
      html += '<label>Arrival Time</label>';
      html += '<input type="time" class="trips-arrival" data-ti="' + ti + '" value="' + (trip.arrival || '') + '">';
      html += '</div>';
      html += '<div class="trips-meta-field">';
      html += '<label>Depart Time</label>';
      html += '<input type="time" class="trips-depart" data-ti="' + ti + '" value="' + (trip.depart || '') + '">';
      html += '</div>';
      html += '<div class="trips-meta-field">';
      html += '<label>Unload Time (min)</label>';
      html += '<input type="number" class="trips-unload-min" data-ti="' + ti + '" min="0" placeholder="min" value="' + (trip.unloadMin || '') + '">';
      html += '</div>';
      html += '</div>';
    }

    // Container selector
    html += '<div class="trips-container-add" data-ti="' + ti + '">';
    html += '<select class="trips-container-select">';
    html += '<option value="">+ Add Container Type...</option>';
    CONTAINER_TYPES.forEach(function(ct) {
      // Exclude already added
      var exists = trip.containers.some(function(c) { return c.type === ct.id; });
      if (!exists) html += '<option value="' + ct.id + '">' + ct.label + '</option>';
    });
    html += '</select></div>';

    // Container tally table
    if (trip.containers.length > 0) {
      html += '<table class="trips-table">';
      html += '<thead><tr><th>Container</th><th>Full</th><th>3/4</th><th>1/2</th><th>1/4</th><th></th></tr></thead>';
      html += '<tbody>';
      trip.containers.forEach(function(c, ci) {
        var ctLabel = CONTAINER_TYPES.find(function(t) { return t.id === c.type; });
        html += '<tr>';
        html += '<td class="trips-cont-name">' + (ctLabel ? ctLabel.label : c.type) + '</td>';
        ['full', 'threeQ', 'half', 'quarter'].forEach(function(field) {
          html += '<td><div class="tally-cell">';
          html += '<button class="tally-btn tally-minus" data-ti="' + ti + '" data-ci="' + ci + '" data-field="' + field + '">−</button>';
          html += '<span class="tally-val" data-ti="' + ti + '" data-ci="' + ci + '" data-field="' + field + '">' + (c[field] || 0) + '</span>';
          html += '<button class="tally-btn tally-plus" data-ti="' + ti + '" data-ci="' + ci + '" data-field="' + field + '">+</button>';
          html += '</div></td>';
        });
        html += '<td><button class="btn btn-danger btn-sm trips-remove-cont" data-ti="' + ti + '" data-ci="' + ci + '" title="Remove">&times;</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    return html;
  }

  function calcUnload(trip) {
    // kept for reference but unload is now manual
    return trip.unloadMin ? trip.unloadMin + ' min' : '—';
  }

  // --- Bind events for a trip card ---
  function bindTripCard(card, trip, ti) {
    // Delete trip
    var delBtn = card.querySelector('.trips-delete-card');
    if (delBtn) {
      delBtn.addEventListener('click', function() {
        trips.splice(ti, 1);
        save(); render();
      });
    }

    // Source dropdown
    var sourceSelect = card.querySelector('.trips-source');
    if (sourceSelect) {
      sourceSelect.addEventListener('change', function() {
        trip.source = this.value; save();
      });
    }

    // Arrival/Depart/Unload
    var arrivalInput = card.querySelector('.trips-arrival');
    var departInput = card.querySelector('.trips-depart');
    var unloadInput = card.querySelector('.trips-unload-min');
    if (arrivalInput) {
      arrivalInput.addEventListener('input', function() {
        trip.arrival = this.value; save();
      });
    }
    if (departInput) {
      departInput.addEventListener('input', function() {
        trip.depart = this.value; save();
      });
    }
    if (unloadInput) {
      unloadInput.addEventListener('input', function() {
        trip.unloadMin = parseInt(this.value) || ''; save();
      });
    }

    // Container add
    var addSelect = card.querySelector('.trips-container-select');
    if (addSelect) {
      addSelect.addEventListener('change', function() {
        if (!this.value) return;
        trip.containers.push({ type: this.value, full: 0, threeQ: 0, half: 0, quarter: 0 });
        save(); render();
      });
    }

    // Container remove
    card.querySelectorAll('.trips-remove-cont').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var ci = parseInt(btn.dataset.ci);
        trip.containers.splice(ci, 1);
        save(); render();
      });
    });

    // Tally +/- buttons
    card.querySelectorAll('.tally-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var ci = parseInt(btn.dataset.ci);
        var field = btn.dataset.field;
        var delta = btn.classList.contains('tally-plus') ? 1 : -1;
        var val = (trip.containers[ci][field] || 0) + delta;
        if (val < 0) val = 0;
        trip.containers[ci][field] = val;
        // Update the displayed value without full re-render
        var span = card.querySelector('.tally-val[data-ci="' + ci + '"][data-field="' + field + '"]');
        if (span) span.textContent = val;
        save();
      });
    });
  }

  // --- Add Trip ---
  addTripBtn.addEventListener('click', function() {
    trips.push(createTrip(false));
    save(); render();
  });

  // ===== Mail Flow Notes =====
  function renderMailflow() {
    mailflowContainer.innerHTML = '';
    mailflowEmpty.hidden = mailflowNotes.length > 0;

    mailflowNotes.forEach(function(note, ni) {
      var row = document.createElement('div');
      row.className = 'mailflow-row';
      row.innerHTML =
        '<select class="mailflow-trip" data-ni="' + ni + '">' +
          tripOptions(note.trip) +
        '</select>' +
        '<input type="text" class="mailflow-container" data-ni="' + ni + '" placeholder="Container" value="' + esc(note.container) + '">' +
        '<input type="number" class="mailflow-qty" data-ni="' + ni + '" placeholder="QTY" min="0" value="' + (note.qty || '') + '">' +
        '<input type="text" class="mailflow-comment" data-ni="' + ni + '" placeholder="Description / Comments" value="' + esc(note.comment) + '">' +
        '<button class="btn btn-danger btn-sm mailflow-delete" data-ni="' + ni + '" title="Remove">&times;</button>';
      mailflowContainer.appendChild(row);
    });

    // Bind events
    mailflowContainer.querySelectorAll('.mailflow-trip').forEach(function(sel) {
      sel.addEventListener('change', function() {
        mailflowNotes[parseInt(sel.dataset.ni)].trip = sel.value; save();
      });
    });
    mailflowContainer.querySelectorAll('.mailflow-container').forEach(function(inp) {
      inp.addEventListener('input', function() {
        mailflowNotes[parseInt(inp.dataset.ni)].container = inp.value; save();
      });
    });
    mailflowContainer.querySelectorAll('.mailflow-qty').forEach(function(inp) {
      inp.addEventListener('input', function() {
        mailflowNotes[parseInt(inp.dataset.ni)].qty = parseInt(inp.value) || 0; save();
      });
    });
    mailflowContainer.querySelectorAll('.mailflow-comment').forEach(function(inp) {
      inp.addEventListener('input', function() {
        mailflowNotes[parseInt(inp.dataset.ni)].comment = inp.value; save();
      });
    });
    mailflowContainer.querySelectorAll('.mailflow-delete').forEach(function(btn) {
      btn.addEventListener('click', function() {
        mailflowNotes.splice(parseInt(btn.dataset.ni), 1);
        save(); renderMailflow();
      });
    });
  }

  function tripOptions(selected) {
    var html = '<option value="">— Trip —</option>';
    trips.forEach(function(t, ti) {
      var label = tripLabel(ti);
      html += '<option value="' + label + '"' + (selected === label ? ' selected' : '') + '>' + label + '</option>';
    });
    return html;
  }

  mailflowAddBtn.addEventListener('click', function() {
    mailflowNotes.push({ trip: '', container: '', qty: 0, comment: '' });
    save(); renderMailflow();
  });

  // ===== SCF Hub =====
  var SCF_KEYS = ['amCrossDock','pmCrossDock','amHash','pmHash','pmCarwash','unit','registrySeals','hcrSeals'];
  var scfData = {};
  SCF_KEYS.forEach(function(k) { scfData[k] = { qty: 0, comment: '' }; });
  scfData.opNotes = '';
  // Migrate old keys
  function migrateSCFKey(oldKey, newKey) {
    if (scfData[oldKey] && !scfData[newKey]) { scfData[newKey] = scfData[oldKey]; delete scfData[oldKey]; }
  }

  var scfAutosave = document.getElementById('scf-autosave-status');
  var scfOpNotes = document.getElementById('scf-op-notes');

  function loadSCF() {
    try {
      var raw = localStorage.getItem(SCF_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        // Merge loaded data into defaults
        SCF_KEYS.forEach(function(k) {
          if (parsed[k]) scfData[k] = parsed[k];
        });
        if (parsed.opNotes) scfData.opNotes = parsed.opNotes;
        // Migrate old crossDock/hash to AM versions if they exist
        if (parsed.crossDock && !parsed.amCrossDock) scfData.amCrossDock = parsed.crossDock;
        if (parsed.hash && !parsed.amHash) scfData.amHash = parsed.hash;
      }
    } catch (e) {}
  }

  function saveSCF() {
    clearTimeout(saveSCF._t);
    saveSCF._t = setTimeout(function() {
      localStorage.setItem(SCF_KEY, JSON.stringify(scfData));
      if (scfAutosave) scfAutosave.textContent = '✓ Saved ' + new Date().toLocaleTimeString();
    }, 300);
  }

  function initSCF() {
    if (!scfOpNotes) return;
    loadSCF();

    // Populate +/- qty values and comments
    document.querySelectorAll('.scf-val').forEach(function(span) {
      var key = span.dataset.key;
      if (scfData[key]) span.textContent = scfData[key].qty || 0;
    });

    // +/- buttons
    document.querySelectorAll('.scf-plus, .scf-minus').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var key = btn.dataset.key;
        if (!scfData[key]) scfData[key] = { qty: 0, comment: '' };
        var delta = btn.classList.contains('scf-plus') ? 1 : -1;
        var val = (scfData[key].qty || 0) + delta;
        if (val < 0) val = 0;
        scfData[key].qty = val;
        var span = document.querySelector('.scf-val[data-key="' + key + '"]');
        if (span) span.textContent = val;
        saveSCF();
      });
    });

    document.querySelectorAll('.scf-comment').forEach(function(inp) {
      var key = inp.dataset.key;
      if (scfData[key]) inp.value = scfData[key].comment || '';
      inp.addEventListener('input', function() {
        if (!scfData[key]) scfData[key] = { qty: 0, comment: '' };
        scfData[key].comment = inp.value;
        saveSCF();
      });
    });

    scfOpNotes.value = scfData.opNotes || '';
    scfOpNotes.addEventListener('input', function() {
      scfData.opNotes = scfOpNotes.value;
      saveSCF();
    });
  }

  // --- Utility ---
  function esc(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // --- Init ---
  load();
  render();
  renderMailflow();
  initSCF();
})();
