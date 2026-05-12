/**
 * mock-data.js — Debug mock data generators for realistic review scenarios.
 *
 * Adds buttons to the debug drawer for generating:
 *  1. Mock Review — creates a review package with offices, travel days, roster
 *  2. Mock Pre-Review — travel survey, schedules, assignments
 *  3. Mock Review Period — full observation notes (clerk + MH)
 *  4. Mock Post-Review — summarization comments
 *
 * Realistic constraints:
 *  - 2-day review periods per office
 *  - Up to 3 concurrent offices
 *  - Monday travel, next Friday travel, weekends off
 *  - Reviewers can't be shared between offices
 *  - Offices: 1-50 clerks, 1-25 mail handlers
 *  - Drivers: 2-5, rest fly
 */
var MockData = (function() {
  'use strict';

  // --- Helpers ---
  function uuid() { return crypto.randomUUID(); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pickN(arr, n) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a.slice(0, Math.min(n, a.length));
  }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function fmtTime(h, m) { return pad2(h) + ':' + pad2(m); }
  function randTime(minH, maxH) { return fmtTime(randInt(minH, maxH), randInt(0, 3) * 15); }

  var FIRST_NAMES = ['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Christopher','Karen','Charles','Lisa','Daniel','Nancy','Matthew','Betty','Anthony','Margaret','Mark','Sandra','Donald','Ashley','Steven','Kimberly','Paul','Emily','Andrew','Donna','Joshua','Michelle','Kenneth','Carol','Kevin','Amanda','Brian','Dorothy','George','Melissa','Timothy','Deborah','Ronald','Stephanie','Edward','Rebecca','Jason','Sharon','Jeffrey','Laura','Ryan','Cynthia'];
  var LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts'];
  var AIRLINES = ['Delta','United','American','Southwest','JetBlue','Spirit','Frontier','Alaska'];
  var AIRPORTS = ['DFW','LAX','ORD','ATL','DEN','JFK','SFO','SEA','PHX','IAH','MIA','BOS','MSP','DTW','CLT','LAS','MCO','EWR','PHL','BWI'];

  var LDC_CODES = ['41','42','43A','43L','43F','43P','44','45','48'];
  var OPN_CODES = {
    '41': [{opn:'110',desc:'UNLOAD TRUCK'},{opn:'120',desc:'LOAD TRUCK'},{opn:'130',desc:'DOCK TRANSFER'}],
    '42': [{opn:'210',desc:'DISTRIBUTION - MANUAL'},{opn:'220',desc:'DISTRIBUTION - AUTOMATED'},{opn:'230',desc:'THROWBACK'}],
    '43A': [{opn:'231',desc:'BOX SECTION - UP MAIL'},{opn:'232',desc:'BOX SECTION - CALLER SERVICE'},{opn:'233',desc:'BOX SECTION - PARCEL LOCKER'},{opn:'234',desc:'BOX SECTION - GENERAL'}],
    '43L': [{opn:'241',desc:'LETTER CASING'},{opn:'242',desc:'DPS VERIFICATION'}],
    '43F': [{opn:'251',desc:'FLAT CASING'},{opn:'252',desc:'FSS VERIFICATION'}],
    '43P': [{opn:'261',desc:'PARCEL SORTING'},{opn:'262',desc:'PARCEL DELIVERY'}],
    '44': [{opn:'310',desc:'WINDOW SERVICES'},{opn:'320',desc:'RETAIL'}],
    '45': [{opn:'410',desc:'MAIL PROCESSING SUPPORT'},{opn:'420',desc:'ADMIN/CLERICAL'}],
    '48': [{opn:'510',desc:'SPECIAL PURPOSE'},{opn:'520',desc:'OTHER'}]
  };
  var WORK_QUALITY = ['NO CONCERNS','NO CONCERNS','NO CONCERNS','DOUBLE HANDLING','WORKING METHODICALLY','UNNECESSARY'];
  var MH_TASKS = ['B','C-COL','CD','CLK','CR','CW','D','DU','E','HA','LT/ULT','MTE','NP','NW','O','RT','S','SM','STBY','SUE'];
  var MH_MAIL_TYPES = ['','Parcels','Letters','Flats','Mixed'];
  var MH_EQUIP = ['','APC','BMC','Wire Container','Cardboard/Gaylord','Hamper (1046)','Gurney (1033)','U-Cart','Sacks'];
  var CONTAINER_TYPES = ['hamper','gurney','ucart','gpmc','wire','otr','cardboard','sack'];
  var TRIP_SOURCES = ['USPS','AMAZON','FEDEX','UPS','DHL','WAL-MART','TARGET'];

  var CLERK_COMMENTS = [
    'Observed clerk working at steady pace.',
    'Multiple clerks staging at dock area.',
    'No issues noted during this period.',
    'Clerk took break at authorized time.',
    'Parcels being sorted into carrier routes.',
    'Window service steady, 2-3 customers in line.',
    'DPS verification completed without issue.',
    'Flat casing proceeding normally.',
    'Lettermail being cased into route slots.',
    'Box section up-mail being distributed.',
    'Clerks double-handling some parcels unnecessarily.',
    'Good workflow between dock and distribution.',
    'Throwback mail being re-sorted.',
    'Caller service pickups processed efficiently.',
    'Admin duties — updating records.',
    'Parcel locker mail staged for delivery.'
  ];

  var MH_COMMENTS = [
    'Mail handler unloading truck efficiently.',
    'Containers staged properly at dock.',
    'Sweeping operations proceeding smoothly.',
    'Breaking down incoming containers.',
    'Loading outgoing mail onto truck.',
    'Cross-dock transfer completed.',
    'Mail handler on standby — awaiting truck.',
    'Empty equipment being returned.',
    'Parcels being sorted by ZIP range.',
    'Working collaboratively with clerk staff.',
    'Container inventory check completed.',
    'Good pace on sack handling.',
    'Registry seals verified and logged.'
  ];

  var SUMMARY_COMMENTS = [
    'Overall operations running smoothly for this observation period.',
    'Staffing levels appear adequate for current mail volume.',
    'Dock operations could benefit from better staging procedures.',
    'Window service wait times within acceptable range.',
    'Distribution accuracy appears high based on throwback volume.',
    'Parcel volume higher than expected — additional help may be needed.',
    'Mail handler team working efficiently together.',
    'Recommend reviewing break schedule to optimize coverage.',
    'No safety concerns observed during this period.',
    'Equipment condition satisfactory — all APCs and hampers functional.',
    'DPS verification process could be streamlined.',
    'Carrier departure times on schedule.',
    'Good communication between supervisors and craft employees.',
    'Volume tracking consistent with projected estimates.',
    'Building cleanliness and organization satisfactory.'
  ];

  // --- Get random offices from OFFICE_LIST ---
  function getRandomOffices(count) {
    if (typeof OFFICE_LIST === 'undefined') return [];
    var indices = [];
    while (indices.length < count && indices.length < OFFICE_LIST.length) {
      var idx = randInt(0, OFFICE_LIST.length - 1);
      if (indices.indexOf(idx) === -1) indices.push(idx);
    }
    return indices.map(function(i) {
      return { financeNum: OFFICE_LIST[i][0], officeName: OFFICE_LIST[i][1] };
    });
  }

  // --- Generate random people ---
  function genPeople(count) {
    var people = [];
    var used = {};
    for (var i = 0; i < count; i++) {
      var name;
      do { name = pick(LAST_NAMES) + ', ' + pick(FIRST_NAMES); } while (used[name]);
      used[name] = true;
      people.push(name);
    }
    return people;
  }

  // --- Get next Monday from today ---
  function getNextMonday() {
    var d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // =================================================================
  //  1. MOCK REVIEW — Create review package with offices + assignments
  // =================================================================
  function generateMockReview() {
    var user = Auth.currentUser();
    if (!user) { alert('Not logged in.'); return; }

    var numOffices = randInt(2, 4);
    var offices = getRandomOffices(numOffices);
    if (offices.length === 0) { alert('Office list not loaded.'); return; }

    // Schedule: Monday travel, then 2-day pairs, Friday travel
    var monday = getNextMonday();
    var travelStart = fmtDate(monday);
    var reviewDays = [];
    var dayOffset = 1; // Tuesday
    for (var i = 0; i < offices.length; i++) {
      var d1 = addDays(monday, dayOffset);
      var d2 = addDays(monday, dayOffset + 1);
      // Skip weekends
      if (d1.getDay() === 6) { dayOffset += 2; d1 = addDays(monday, dayOffset); d2 = addDays(monday, dayOffset + 1); }
      if (d1.getDay() === 0) { dayOffset += 1; d1 = addDays(monday, dayOffset); d2 = addDays(monday, dayOffset + 1); }
      offices[i].startDate = fmtDate(d1);
      offices[i].endDate = fmtDate(d2);
      reviewDays.push({ office: offices[i], day1: d1, day2: d2 });
      dayOffset += 2;
    }

    // Friday travel day (or next Friday if review spans 2 weeks)
    var lastDay = reviewDays[reviewDays.length - 1].day2;
    var travelEndDate = new Date(lastDay);
    while (travelEndDate.getDay() !== 5) travelEndDate = addDays(travelEndDate, 1);
    var travelEnd = fmtDate(travelEndDate);

    // Assign reviewers from existing users
    var allUsers = Auth.getUsers().filter(function(u) { return u.role !== 'admin'; });
    var reviewerPool = allUsers.length > 3 ? pickN(allUsers, Math.min(allUsers.length, numOffices * 3 + 2)) : allUsers;
    var assignments = [];
    // 1 lead
    if (reviewerPool.length > 0) {
      assignments.push({ userId: reviewerPool[0].id, reviewRole: 'lead' });
    }
    // Assign clerk + MH reviewers per office (non-shared)
    var rIdx = 1;
    for (var o = 0; o < offices.length; o++) {
      if (rIdx < reviewerPool.length) {
        assignments.push({ userId: reviewerPool[rIdx].id, reviewRole: 'clerk' });
        rIdx++;
      }
      if (rIdx < reviewerPool.length) {
        assignments.push({ userId: reviewerPool[rIdx].id, reviewRole: 'mailhandler' });
        rIdx++;
      }
    }

    // Create the review
    var review = {
      id: uuid(),
      name: 'Mock Review — ' + offices.map(function(o) { return o.officeName.split(' ')[0]; }).join('/'),
      offices: offices,
      startDate: travelStart,
      endDate: travelEnd,
      travelStart: travelStart,
      travelEnd: travelEnd,
      assignments: assignments,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      financeNum: offices[0].financeNum,
      officeName: offices[0].officeName
    };

    var reviews = [];
    try { reviews = JSON.parse(localStorage.getItem('clerk_obs_reviews')) || []; } catch(e) {}
    reviews.push(review);
    localStorage.setItem('clerk_obs_reviews', JSON.stringify(reviews));

    // Update assignedFins for assigned users
    assignments.forEach(function(a) {
      var u = Auth.getUserById(a.userId);
      if (!u) return;
      var fins = (u.assignedFins || []).slice();
      offices.forEach(function(o) {
        if (fins.indexOf(o.financeNum) === -1) fins.push(o.financeNum);
      });
      Auth.updateUser(u.id, { assignedFins: fins });
    });

    return review;
  }

  // =================================================================
  //  2. MOCK PRE-REVIEW — Travel survey, schedules
  // =================================================================
  function generateMockPreReview(reviewId) {
    var reviews = [];
    try { reviews = JSON.parse(localStorage.getItem('clerk_obs_reviews')) || []; } catch(e) {}
    var review = null;
    for (var i = 0; i < reviews.length; i++) { if (reviews[i].id === reviewId) { review = reviews[i]; break; } }
    if (!review) { alert('Review not found.'); return; }

    // Travel Survey
    var assignedUsers = review.assignments.map(function(a) {
      var u = Auth.getUserById(a.userId);
      return u ? { name: u.displayName, userId: u.id } : null;
    }).filter(Boolean);

    var numDrivers = Math.min(randInt(2, 5), assignedUsers.length);
    var responses = {};
    assignedUsers.forEach(function(a, idx) {
      var isDriver = idx < numDrivers;
      var resp = {
        phone: '555-' + pad2(randInt(1, 9)) + pad2(randInt(0, 9)) + '-' + randInt(1000, 9999),
        hotelBooked: Math.random() > 0.2,
        submittedAt: new Date().toISOString()
      };
      if (isDriver) {
        resp.mode = 'driving';
      } else {
        resp.mode = 'flying';
        var depAirport = pick(AIRPORTS);
        var arrAirport = pick(AIRPORTS.filter(function(a) { return a !== depAirport; }));
        resp.arrival = {
          date: review.travelStart || review.startDate,
          time: randTime(8, 18),
          airline: pick(AIRLINES),
          flight: pick(AIRLINES).substring(0, 2).toUpperCase() + randInt(100, 9999),
          airport: arrAirport
        };
        resp.departure = {
          date: review.travelEnd || review.endDate,
          time: randTime(6, 16),
          airline: pick(AIRLINES),
          flight: pick(AIRLINES).substring(0, 2).toUpperCase() + randInt(100, 9999),
          airport: arrAirport
        };
      }
      responses[a.userId] = resp;
    });

    var travelData = {
      assignments: assignedUsers,
      responses: responses,
      carpools: [],
      hotelBookingLink: ''
    };
    localStorage.setItem('clerk_obs_travel_survey_' + reviewId, JSON.stringify(travelData));

    // Schedules per office — mock employee names
    review.offices.forEach(function(office) {
      var numClerks = randInt(3, 30);
      var numMH = randInt(1, 15);
      var employees = [];
      var empNames = genPeople(numClerks + numMH);
      for (var e = 0; e < empNames.length; e++) {
        employees.push({
          name: empNames[e],
          craft: e < numClerks ? 'clerk' : 'mailhandler',
          schedule: e % 3 === 0 ? '6:00-14:30' : (e % 3 === 1 ? '14:00-22:30' : '22:00-6:30')
        });
      }
      var schedKey = 'clerk_obs_schedule_' + reviewId + '_' + office.financeNum;
      localStorage.setItem(schedKey, JSON.stringify({
        schedule: employees,
        assignedNames: assignedUsers.slice(0, 3).map(function(a) { return { userId: a.userId, name: a.name, userName: a.name }; })
      }));
    });

    return travelData;
  }

  // =================================================================
  //  3. MOCK REVIEW PERIOD — Full observation notes
  // =================================================================
  function generateMockReviewPeriod(reviewId) {
    var reviews = [];
    try { reviews = JSON.parse(localStorage.getItem('clerk_obs_reviews')) || []; } catch(e) {}
    var review = null;
    for (var i = 0; i < reviews.length; i++) { if (reviews[i].id === reviewId) { review = reviews[i]; break; } }
    if (!review) { alert('Review not found.'); return; }

    var observations = [];
    try { observations = JSON.parse(localStorage.getItem('timeTracker_observations')) || []; } catch(e) {}

    // For each office, generate 2 days of clerk + MH observations
    review.offices.forEach(function(office) {
      // Find assigned clerk and MH reviewers
      var clerkReviewer = null, mhReviewer = null;
      review.assignments.forEach(function(a) {
        if (a.reviewRole === 'clerk' && !clerkReviewer) clerkReviewer = a;
        if (a.reviewRole === 'mailhandler' && !mhReviewer) mhReviewer = a;
      });

      for (var day = 1; day <= 2; day++) {
        var dateStr = day === 1 ? office.startDate : office.endDate;

        // --- Clerk observation ---
        if (clerkReviewer) {
          var clerkUser = Auth.getUserById(clerkReviewer.userId);
          var clerkRows = [];
          var currentHour = 6;
          var currentMin = 0;
          var numEntries = randInt(8, 16);
          for (var r = 0; r < numEntries; r++) {
            var ldc = pick(LDC_CODES);
            var opnList = OPN_CODES[ldc] || OPN_CODES['48'];
            var opnPick = pick(opnList);
            var duration = pick([15, 15, 30, 30, 30, 45, 60]);
            var endMin = currentMin + duration;
            var endHour = currentHour + Math.floor(endMin / 60);
            endMin = endMin % 60;
            if (endHour >= 17) break;

            var totalClerks = randInt(1, 4);
            var row = {
              id: uuid(),
              ldc: ldc,
              opn: opnPick.opn,
              totalClerks: '' + totalClerks,
              beginTime: fmtTime(currentHour, currentMin),
              endTime: fmtTime(endHour, endMin),
              elapsed: duration * totalClerks,
              workDescription: opnPick.desc,
              workQuality: pick(WORK_QUALITY),
              comments: Math.random() > 0.4 ? pick(CLERK_COMMENTS) : ''
            };
            if (ldc === '43L') row.ltrVolInches = randInt(5, 200);
            if (ldc === '43F') row.fltVolInches = randInt(2, 80);
            if (ldc === '43P' || ldc === '41') row.parcels = randInt(10, 500);
            clerkRows.push(row);
            currentHour = endHour;
            currentMin = endMin;
          }

          observations.push({
            id: uuid(),
            office: office.officeName,
            financeNum: office.financeNum,
            reviewId: reviewId,
            date: dateStr,
            dayNumber: '' + day,
            observerName: clerkUser ? clerkUser.displayName : 'Unknown',
            userId: clerkReviewer.userId,
            reviewRole: 'clerk',
            status: 'submitted',
            createdAt: new Date().toISOString(),
            rows: clerkRows
          });

          // Trips data
          var scope = '_' + reviewId + '_' + day + '_' + clerkReviewer.userId;
          var trips = [{ id: Date.now() + Math.random(), isOnHand: true, source: 'ON HAND',
            containers: [{ type: 'hamper', full: randInt(1, 5), threeQ: randInt(0, 2), half: randInt(0, 3), quarter: 0 }],
            arrival: '06:00', depart: '', unloadMin: '' }];
          var numTrips = randInt(2, 5);
          for (var t = 0; t < numTrips; t++) {
            trips.push({
              id: Date.now() + Math.random() + t,
              isOnHand: false,
              source: pick(TRIP_SOURCES),
              containers: [{ type: pick(CONTAINER_TYPES), full: randInt(0, 3), threeQ: randInt(0, 2), half: randInt(0, 2), quarter: randInt(0, 1) }],
              arrival: fmtTime(6 + t * 2 + randInt(0, 1), randInt(0, 3) * 15),
              depart: fmtTime(7 + t * 2 + randInt(0, 1), randInt(0, 3) * 15),
              unloadMin: '' + randInt(10, 45)
            });
          }
          localStorage.setItem('clerk_obs_trips' + scope, JSON.stringify(trips));

          // SCF data
          localStorage.setItem('clerk_obs_scf' + scope, JSON.stringify({
            amCrossDock: { qty: randInt(0, 5), comment: 'AM cross-dock processed' },
            pmCrossDock: { qty: randInt(0, 3), comment: '' },
            amHash: { qty: randInt(0, 8), comment: '' },
            pmHash: { qty: randInt(0, 4), comment: '' },
            pmCarwash: { qty: randInt(0, 2), comment: '' },
            unit: { qty: randInt(0, 3), comment: '' },
            registrySeals: { qty: randInt(0, 2), comment: '' },
            hcrSeals: { qty: randInt(0, 1), comment: '' },
            opNotes: 'Normal operations — no significant issues.'
          }));

          // Questionnaire
          var questionnaire = {};
          ['41','42','43','44','45','General'].forEach(function(ldcGroup) {
            for (var q = 0; q < randInt(2, 5); q++) {
              questionnaire[ldcGroup + '_' + q] = {
                yn: pick(['Y', 'Y', 'Y', 'N', 'N/A']),
                result: pick(['Satisfactory', 'Satisfactory', 'Satisfactory', 'Needs Improvement', 'Unsatisfactory']),
                comments: Math.random() > 0.6 ? pick(CLERK_COMMENTS) : ''
              };
            }
          });
          localStorage.setItem('clerk_obs_questionnaire' + scope, JSON.stringify(questionnaire));
        }

        // --- Mail Handler observation ---
        if (mhReviewer) {
          var mhUser = Auth.getUserById(mhReviewer.userId);
          var mhEmpNames = genPeople(randInt(2, 8));
          // One observation per MH employee (pick first one)
          var mhEmployee = mhEmpNames[0];
          var mhRows = [];
          var mhHour = 6;
          var mhMin = 0;
          var numMhEntries = randInt(6, 12);
          for (var m = 0; m < numMhEntries; m++) {
            var dur = pick([15, 15, 30, 30, 45]);
            var mEndMin = mhMin + dur;
            var mEndHour = mhHour + Math.floor(mEndMin / 60);
            mEndMin = mEndMin % 60;
            if (mEndHour >= 16) break;
            mhRows.push({
              id: uuid(),
              task: pick(MH_TASKS),
              beginTime: fmtTime(mhHour, mhMin),
              endTime: fmtTime(mEndHour, mEndMin),
              elapsed: dur,
              mailType: pick(MH_MAIL_TYPES),
              equipType: pick(MH_EQUIP),
              equipQty: '' + randInt(0, 5),
              workQuality: pick(WORK_QUALITY),
              comments: Math.random() > 0.5 ? pick(MH_COMMENTS) : ''
            });
            mhHour = mEndHour;
            mhMin = mEndMin;
          }

          observations.push({
            id: uuid(),
            office: office.officeName,
            financeNum: office.financeNum,
            reviewId: reviewId,
            date: dateStr,
            dayNumber: '' + day,
            observerName: mhUser ? mhUser.displayName : 'Unknown',
            userId: mhReviewer.userId,
            reviewRole: 'mailhandler',
            status: 'submitted',
            employeeName: mhEmployee,
            createdAt: new Date().toISOString(),
            rows: mhRows
          });
        }
      }
    });

    localStorage.setItem('timeTracker_observations', JSON.stringify(observations));
    return { observationsAdded: observations.length };
  }

  // =================================================================
  //  4. MOCK POST-REVIEW — Summarization comments
  // =================================================================
  function generateMockPostReview(reviewId) {
    var reviews = [];
    try { reviews = JSON.parse(localStorage.getItem('clerk_obs_reviews')) || []; } catch(e) {}
    var review = null;
    for (var i = 0; i < reviews.length; i++) { if (reviews[i].id === reviewId) { review = reviews[i]; break; } }
    if (!review) { alert('Review not found.'); return; }

    // Generate summarization for each office/day/user combo
    var areas = ['tab-clerk-notes', 'tab-ps3922', 'tab-trips', 'tab-scf', 'tab-questionnaire'];
    review.offices.forEach(function(office) {
      review.assignments.forEach(function(a) {
        if (a.reviewRole !== 'clerk' && a.reviewRole !== 'mailhandler') return;
        for (var day = 1; day <= 2; day++) {
          var scope = '_' + reviewId + '_' + day + '_' + a.userId;
          var summaries = [];
          var numComments = randInt(3, 7);
          for (var c = 0; c < numComments; c++) {
            summaries.push({
              area: pick(areas),
              ldcRef: pick(LDC_CODES),
              entryRef: '' + randInt(1, 10),
              text: pick(SUMMARY_COMMENTS)
            });
          }
          localStorage.setItem('clerk_obs_summarization' + scope, JSON.stringify(summaries));
        }
      });
    });

    // Expense confirmations
    var expense = { confirmations: {} };
    review.assignments.forEach(function(a) {
      var u = Auth.getUserById(a.userId);
      if (u) {
        expense.confirmations[a.userId] = {
          confirmedAt: new Date().toISOString(),
          name: u.displayName
        };
      }
    });
    localStorage.setItem('clerk_obs_expense_' + reviewId, JSON.stringify(expense));

    return { status: 'Post-review data generated' };
  }

  // =================================================================
  //  PUBLIC API
  // =================================================================
  return {
    generateReview: generateMockReview,
    generatePreReview: generateMockPreReview,
    generateReviewPeriod: generateMockReviewPeriod,
    generatePostReview: generateMockPostReview,

    // All-in-one: creates review + pre-review + review data + post-review
    generateAll: function() {
      var review = generateMockReview();
      if (!review) return null;
      generateMockPreReview(review.id);
      generateMockReviewPeriod(review.id);
      generateMockPostReview(review.id);
      return review;
    }
  };
})();
