/**
 * storage.js — Shared localStorage helpers.
 *
 * Each saved record is a "day" of a review period:
 * {
 *   id, office, financeNum, date, dayNumber, observerName,
 *   rows: [{ id, ldc, opn, totalClerks, beginTime, endTime,
 *            elapsed, workDescription, ltrVolInches, fltVolInches, parcels }],
 *   createdAt
 * }
 */

const STORAGE_KEY = 'timeTracker_observations';

// ---------- LDC & OPN definitions ----------
const LDC_OPTIONS = [
  { value: '41',     label: 'LDC 41 — ADUS/SDUS',              short: 'LDC 41',     color: 'ldc-41' },
  { value: '42',     label: 'LDC 42 — BRM/PD/PRS',              short: 'LDC 42',     color: 'ldc-42' },
  { value: '43A',    label: 'LDC 43A — Allied Duties',           short: 'LDC 43A',    color: 'ldc-43a' },
  { value: '43L',    label: 'LDC 43L — Manual Flats',            short: 'LDC 43L',    color: 'ldc-43l' },
  { value: '43F',    label: 'LDC 43F — Manual Letters',          short: 'LDC 43F',    color: 'ldc-43f' },
  { value: '43P',    label: 'LDC 43P — Manual Parcels',          short: 'LDC 43P',    color: 'ldc-43p' },
  { value: '44',     label: 'LDC 44 — PO Box Distribution',      short: 'LDC 44',     color: 'ldc-44' },
  { value: '45',     label: 'LDC 45 — Retail Window Services',   short: 'LDC 45',     color: 'ldc-45' },
  { value: '48',     label: 'LDC 48 — Misc Customer Service',    short: 'LDC 48',     color: 'ldc-48' },
  { value: 'NP',     label: 'NP — Non-Productive',               short: 'NP',         color: 'ldc-np' },
  { value: 'BRK',    label: 'Break',                             short: 'Break',      color: 'ldc-brk' },
  { value: 'LUN',    label: 'Lunch',                             short: 'Lunch',      color: 'ldc-lun' },
  { value: 'CB',     label: 'Comfort Break',                     short: 'Comfort Brk',color: 'ldc-cb' },
  { value: 'CC',     label: 'Cross Craft',                       short: 'Cross Craft', color: 'ldc-cc' },
];

// OPN options per LDC. Key = LDC value, array of { opn, desc }.
const OPN_BY_LDC = {
  '41': [
    { opn: '315', desc: 'ADUS MON-SAT' },
    { opn: '317', desc: 'ADUS SUN AMAZON' },
    { opn: '905', desc: 'SDUS MON-SAT' },
    { opn: '910', desc: 'SDUS SUN AMAZON' },
  ],
  '42': [
    { opn: '637', desc: 'BUSINESS REPLY MAIL' },
    { opn: '637', desc: 'POSTAGE DUE' },
    { opn: '637', desc: 'PARCEL RETURN SERVICE' },
    { opn: '637', desc: 'MERCHANDISE RETURN SERVICE' },
  ],
  '43A': [
    { opn: '241', desc: 'UNLOAD TRUCK' },
    { opn: '241', desc: 'SPREAD NLM' },
    { opn: '241', desc: 'SPREAD PRESORT BUNDLE' },
    { opn: '241', desc: 'SPREAD OTHER' },
    { opn: '241', desc: 'DPS RACKING' },
    { opn: '241', desc: 'DUMPING SACKS' },
    { opn: '241', desc: 'EQUIPMENT STAGING' },
    { opn: '241', desc: 'WORKING MTE' },
    { opn: '241', desc: 'OTHER 43A' },
  ],
  '43L': [
    { opn: '161', desc: 'MANUAL LTR DISTRIBUTION' },
  ],
  '43F': [
    { opn: '172', desc: 'MANUAL FLT DISTRIBUTION' },
  ],
  '43P': [
    { opn: '790', desc: 'MANUAL PARCEL DISTRIBUTION' },
    { opn: '770', desc: 'SUN ONLY - PARCEL DISTRIBUTION' },
  ],
  '44': [
    { opn: '769', desc: 'WALLING PO BOX DPS' },
    { opn: '769', desc: 'WALLING MANUAL LTRS' },
    { opn: '769', desc: 'WALLING MANUAL FLTS' },
    { opn: '769', desc: 'WALLING MISC' },
  ],
  '45': [
    { opn: '355', desc: 'WINDOW SERVICES' },
    { opn: '355', desc: 'AUX/SOFT TIME WINDOW SERVICES' },
    { opn: '352', desc: 'LOBBY ASSISTANT' },
  ],
  '48': [
    { opn: '742', desc: 'REGISTRY CAGE' },
    { opn: '742', desc: 'ACCOUNTABLE CART' },
    { opn: '742', desc: 'PARS/CFS PREP' },
    { opn: '742', desc: 'RFS' },
    { opn: '742', desc: 'PO BOX MAINT' },
    { opn: '742', desc: 'PREMIUM FWD SVC' },
    { opn: '742', desc: 'OPEN & CLS UNIT/SUPPLIES & SVCS' },
    { opn: '742', desc: 'UBBM' },
    { opn: '742', desc: 'COLLECTIONS (LOBBY/COLL BOXES)' },
    { opn: '742', desc: 'CALLER SERVICE / FIRM HOLDOUTS' },
    { opn: '742', desc: 'F4 BMEU' },
    { opn: '742', desc: 'CLERK INDIVIDUAL CLOSEOUT' },
    { opn: '742', desc: 'VERIFY DEPOSIT/TRANSMITTALS' },
    { opn: '742', desc: 'DISPATCH/DISPATCH PREP' },
    { opn: '742', desc: 'SSK/RDS MAINT' },
    { opn: '742', desc: 'ANSWERING PHONE' },
    { opn: '742', desc: 'MISC' },
    { opn: '558', desc: 'LEAD CLERK DUTIES - MISC' },
    { opn: '558', desc: 'TACS ENTRIES' },
    { opn: '621', desc: 'F4 TRAVEL BETWEEN SITES' },
    { opn: '228', desc: 'F4 EXPRESS DELIVERY' },
    { opn: '353', desc: 'STANDBY' },
    { opn: '784', desc: 'F4 TRAINING' },
  ],
  'NP': [
    { opn: '000', desc: 'ON PERSONAL PHONE' },
    { opn: '000', desc: 'CONVERSATION NON-WORK' },
    { opn: '000', desc: 'LOOKING FOR WORK' },
    { opn: '000', desc: 'IDLE/WAITING' },
    { opn: '000', desc: 'CLOCK IN GOES TO LOCKER ROOM' },
    { opn: '000', desc: 'NOT ON BREAK ABSENT FROM WORKROOM FLOOR' },
    { opn: '000', desc: 'OTHER NP TIME' },
  ],
  'BRK': [
    { opn: '001', desc: 'BREAK' },
  ],
  'LUN': [
    { opn: '002', desc: 'LUNCH' },
  ],
  'CB': [
    { opn: '003', desc: 'COMFORT BREAK' },
  ],
  'CC': [
    { opn: '990', desc: 'MAIL HANDLER' },
    { opn: '991', desc: 'MAINTENANCE' },
    { opn: '992', desc: 'DELIVERY' },
    { opn: '993', desc: 'EAS' },
  ],
};

// ---------- Volume rules per LDC ----------
// Returns which volume fields are enabled for a given LDC.
function getVolumeFields(ldc) {
  const code = (ldc || '').trim();
  return {
    ltrVolInches: code === '43L',
    fltVolInches: code === '43F',
    parcels:      code === '43P' || code === '41',
  };
}

const Storage = {
  getAll: function() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); }
    catch(e) { return []; }
  },

  /**
   * Overlay current review data onto observations so edits made
   * by admins (dates, office name, finance#) are always reflected.
   */
  hydrate: function(observations) {
    if (typeof Reviews === 'undefined') return observations;
    var reviewCache = {};
    var allRevs = Reviews.getAll();
    allRevs.forEach(function(r) { reviewCache[r.id] = r; });
    return observations.map(function(obs) {
      if (!obs.reviewId) return obs;
      var rev = reviewCache[obs.reviewId];
      if (!rev) return obs;
      return Object.assign({}, obs, {
        office: rev.officeName || obs.office,
        financeNum: rev.financeNum || obs.financeNum,
        reviewStartDate: rev.startDate || '',
        reviewEndDate: rev.endDate || ''
      });
    });
  },

  _saveAll: function(observations) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(observations));
  },

  add: function(observation) {
    var all = this.getAll();
    var self = this;
    var entry = Object.assign({}, observation, {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    entry.rows = (entry.rows || []).map(function(row) {
      return Object.assign({}, row, {
        id: crypto.randomUUID(),
        elapsed: self.calcElapsed(row.beginTime, row.endTime) * (parseInt(row.totalClerks, 10) || 1),
      });
    });
    all.unshift(entry);
    this._saveAll(all);
    return entry;
  },

  delete: function(id) {
    this._saveAll(this.getAll().filter(function(o) { return o.id !== id; }));
  },

  /** Minutes between two HH:MM strings. */
  calcElapsed: function(start, end) {
    if (!start || !end) return 0;
    var sp = start.split(':').map(Number);
    var ep = end.split(':').map(Number);
    var mins = (ep[0] * 60 + ep[1]) - (sp[0] * 60 + sp[1]);
    if (mins < 0) mins += 24 * 60;
    return mins;
  },

  formatElapsed: function(mins) {
    if (!mins) return '\u2014';
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    if (h === 0) return m + 'm';
    if (m === 0) return h + 'h';
    return h + 'h ' + m + 'm';
  },

  /** Get the LDC label for display. */
  ldcLabel: function(code) {
    var opt = LDC_OPTIONS.find(function(o) { return o.value === code; });
    return opt ? opt.label : code || '\u2014';
  },
};
