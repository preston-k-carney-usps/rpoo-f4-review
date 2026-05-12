// questionnaire.js — Observation Questionnaire (LDC-filtered)
(function() {
  'use strict';

  var STORAGE_KEY = 'clerk_obs_questionnaire';
  var container = document.getElementById('questionnaire-sections');
  var emptyEl = document.getElementById('questionnaire-empty');
  var autosaveEl = document.getElementById('quest-autosave-status');

  if (!container) return;

  // --- Question bank grouped by LDC ---
  var QUESTIONS = {
    '41': {
      title: 'LDC 41 — ADUS/SDUS',
      items: [
        'Is the ADUS/SDUS operated with no more than 4 employees? (except where authorized)',
        'Are employees performing each duty of the ADUS/SDUS properly and efficiently according to the SWIs for each duty? (1 Stager, 2 Facers, 1 Sweeper)'
      ]
    },
    '42': {
      title: 'LDC 42 — BRM/PD/PRS',
      items: [
        'Are clerks processing workload at inappropriate times when employees should be redirected to assist other operations to meet goals and targets. (i.e. DUT, Box Up, WTIL, PM Parcel Dist, etc)',
        'Is the unit processing BRM Mail 6 days a week as required?'
      ]
    },
    '43': {
      title: 'LDC 43 — Distribution',
      items: [
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
      ]
    },
    '44': {
      title: 'LDC 44 — PO Box Distribution',
      items: [
        'Is PO Box mail strategically placed in each area of the box section to maximize efficiency and eliminate clerks moving/walking unnecessarily?',
        'Is management engaged with clerks during PO box distribution, providing instruction/direction for prioritization of work in an effort to ensure Box Up Time is achieved timely?',
        'Are clerks delaying box up, not meeting PO box productivity expectations and slowing the distribution of box mail by engaging in unnecessary conversation? (quantify time and specify employees)',
        'If equipped, are all parcel lockers in working order with locks and utilized daily?',
        'Is the unit utilizing PS Form 3922 correctly by recording unit distribution mail on the left and PO box distribution mail on the right?',
        'Does the unit convert circular sets or other non addressed mail being boxed to linear measurements (active boxes divided by 227-letters or 115-flats times 12") as box distributed letters or flats?'
      ]
    },
    '45': {
      title: 'LDC 45 — Retail Window Services',
      items: [
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
      ]
    },
    '48': {
      title: 'LDC 48 — Misc Customer Service',
      items: [
        'Are clerks losing time by collecting mail too frequently from collection drops outside of normal scheduled collection times?',
        'Does the unit have an adequate setup for PARS / FPARS / CFS / RFS mail and is it dispatched daily?',
        'Are clerks wasting time while distributing accountable items to carriers by engaging in excessive talking, etc.?',
        'Are clerks forced to spend time culling/separating mail returned by carriers and collectors prior to dispatching to the plant due the carriers failing to make their separations as required?'
      ]
    },
    'General': {
      title: 'General Observations',
      items: [
        'Are FDB facility times correct according to all actual times of the facility (unit times, retail hours, Dutch door, Box up, DUT etc.)?',
        'If this is an SCF, Tier1 Hub or Tier 2 Hub, who has mail processing or cross dock operation for downstream (Child) offices, is it set up in CSV as a Hub site with child offices properly assigned in the CSV Hub Editor?',
        'If this is a Hub Site, is unit properly credited with all items associated with that Tier (child offices, pouches, hashing, etc.)',
        'Do employees store personal belongings such as purses, Ice chests, and large bags in their locker prior to begin tour and reporting for duty in the work area? This includes the workroom floor, retail areas, and offices.',
        'Do clerks clock-in (BT) and/or return from lunch and engage in productive work, without delay of personal time?',
        'Do Lead Clerks schedule breaks preventing all clerks from taking breaks at the same time?',
        'Is the unit properly utilizing the Informed Visibility F4 Employee Scheduler (IVES-F4), scheduling to earned hours and posting the schedule weekly?',
        'Are COAs with FIM Barcodes collected by the carriers or taken in by clerks placed directly into the mail stream and not isolated for submission to CFS?'
      ]
    }
  };

  // LDC values from entries that map to question groups
  var LDC_MAP = {
    '41': '41',
    '42': '42',
    '43A': '43', '43L': '43', '43F': '43', '43P': '43',
    '44': '44',
    '45': '45',
    '48': '48'
  };

  // Scope storage key per review+day+user
  STORAGE_KEY = STORAGE_KEY + (window.appStoragePrefix || '');

  var answers = {}; // { questionKey: { yn, result, comments } }

  // --- Load / Save ---
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) answers = JSON.parse(raw);
    } catch(e) { answers = {}; }
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
      if (autosaveEl) autosaveEl.textContent = '\u2713 Saved ' + new Date().toLocaleTimeString();
    }, 300);
  }

  // --- Detect observed LDCs from Clerk Notes entries ---
  function getObservedLDCs() {
    var observed = new Set();
    var cards = document.querySelectorAll('#rows-container .entry-card');
    cards.forEach(function(card) {
      var sel = card.querySelector('[data-field="ldc"]');
      if (sel && sel.value) {
        var group = LDC_MAP[sel.value];
        if (group) observed.add(group);
      }
    });
    return observed;
  }

  // --- Render ---
  function render() {
    var observed = getObservedLDCs();
    container.innerHTML = '';

    // Determine which sections to show
    var sectionsToShow = [];
    var user = Auth.currentUser ? Auth.currentUser() : null;
    var isLead = user && (user.role === 'admin' || user.role === 'teamlead');

    Object.keys(QUESTIONS).forEach(function(key) {
      if (key === 'General') {
        if (isLead) sectionsToShow.push(key);
      } else if (observed.has(key)) {
        sectionsToShow.push(key);
      }
    });

    emptyEl.hidden = sectionsToShow.length > 0;
    if (sectionsToShow.length === 0) return;

    var qNum = 0;
    sectionsToShow.forEach(function(key) {
      var section = QUESTIONS[key];
      var sectionDiv = document.createElement('div');
      sectionDiv.className = 'quest-section';
      sectionDiv.innerHTML = '<h3 class="quest-section-title">' + section.title + '</h3>';

      section.items.forEach(function(question, qi) {
        qNum++;
        var qKey = key + '_' + qi;
        var ans = answers[qKey] || {};
        var row = document.createElement('div');
        row.className = 'quest-row';
        row.innerHTML =
          '<div class="quest-num">' + qNum + '</div>' +
          '<div class="quest-body">' +
            '<p class="quest-text">' + question + '</p>' +
            '<div class="quest-controls">' +
              '<div class="quest-yn">' +
                '<label class="quest-radio"><input type="radio" name="q_' + qKey + '" value="Y"' + (ans.yn === 'Y' ? ' checked' : '') + '> Y</label>' +
                '<label class="quest-radio"><input type="radio" name="q_' + qKey + '" value="N"' + (ans.yn === 'N' ? ' checked' : '') + '> N</label>' +
                '<label class="quest-radio"><input type="radio" name="q_' + qKey + '" value="N/A"' + (ans.yn === 'N/A' ? ' checked' : '') + '> N/A</label>' +
              '</div>' +
              '<select class="quest-result" data-qkey="' + qKey + '">' +
                '<option value="">-- Result --</option>' +
                '<option value="Satisfactory"' + (ans.result === 'Satisfactory' ? ' selected' : '') + '>Satisfactory</option>' +
                '<option value="Needs Improvement"' + (ans.result === 'Needs Improvement' ? ' selected' : '') + '>Needs Improvement</option>' +
                '<option value="Unsatisfactory"' + (ans.result === 'Unsatisfactory' ? ' selected' : '') + '>Unsatisfactory</option>' +
              '</select>' +
            '</div>' +
            '<textarea class="quest-comments" data-qkey="' + qKey + '" placeholder="Observation comments..." rows="2">' + (ans.comments || '') + '</textarea>' +
          '</div>';
        sectionDiv.appendChild(row);
      });
      container.appendChild(sectionDiv);
    });

    bindEvents();
  }

  function bindEvents() {
    // Y/N radios
    container.querySelectorAll('input[type="radio"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        var name = radio.name.replace('q_', '');
        if (!answers[name]) answers[name] = {};
        answers[name].yn = radio.value;
        save();
      });
    });
    // Result selects
    container.querySelectorAll('.quest-result').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var key = sel.dataset.qkey;
        if (!answers[key]) answers[key] = {};
        answers[key].result = sel.value;
        save();
      });
    });
    // Comments
    container.querySelectorAll('.quest-comments').forEach(function(ta) {
      ta.addEventListener('input', function() {
        var key = ta.dataset.qkey;
        if (!answers[key]) answers[key] = {};
        answers[key].comments = ta.value;
        save();
      });
    });
  }

  // --- Re-render when switching to questionnaire tab ---
  document.querySelectorAll('.review-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      if (tab.dataset.tab === 'tab-questionnaire') {
        render();
      }
    });
  });

  // --- Init ---
  load();
  render();
})();
