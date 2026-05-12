/**
 * schedule.js — Review Scheduling, Calendar, Travel
 *
 * Pre-Review tabs for team leads and workbook leads:
 *  - Schedule: Parse TACS begin times, flag MH/Clerk, assign reviewers (70% clerk, 1:1 MH)
 *  - Calendar: Review lifecycle milestones (union notification, data review, exit conference)
 *  - Travel: Hotel-to-office estimates (public transit, walking, uber)
 */
(function() {
  'use strict';

  var setup = {};
  try { setup = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) {}
  var isLead = (setup.reviewRole === 'lead' || setup.reviewRole === 'teamlead');
  if (!setup.reviewId) return;

  var reviewId = setup.reviewId || '';
  var financeNum = setup.financeNum || '';
  var SCHED_KEY = 'clerk_obs_schedule_' + reviewId + (financeNum ? '_' + financeNum : '');

  // Get leadership assignments for this review (to exclude from reviewer list)
  var reviewLeaderIds = {};
  var reviewLeaders = [];
  (function() {
    if (!reviewId || typeof Reviews === 'undefined') return;
    var rev = Reviews.getById(reviewId);
    if (!rev || !rev.assignments) return;
    rev.assignments.forEach(function(a) {
      if (a.reviewRole === 'lead' || a.reviewRole === 'teamlead') {
        reviewLeaderIds[a.userId] = a.reviewRole;
        var u = Auth.getUserById(a.userId);
        reviewLeaders.push({
          userId: a.userId,
          name: u ? u.displayName : '(unknown)',
          role: a.reviewRole
        });
      }
    });
  })();

  // Hide role-restricted tabs for non-leads
  if (setup.reviewRole !== 'teamlead' && setup.reviewRole !== 'lead') {
    document.querySelectorAll('.wb-sub-tab[data-role="teamlead"]').forEach(function(tab) {
      tab.style.display = 'none';
    });
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function loadSched() {
    try { return JSON.parse(localStorage.getItem(SCHED_KEY)) || {}; } catch(e) { return {}; }
  }
  function saveSched(data) {
    localStorage.setItem(SCHED_KEY, JSON.stringify(data));
  }

  /** Convert hundredths time (e.g. 6.49) to HH:MM */
  function hundredthsToTime(h) {
    var hrs = Math.floor(h);
    var mins = Math.round((h - hrs) * 60);
    return String(hrs).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
  }

  /** Convert hundredths to 12h format */
  function hundredthsTo12h(h) {
    // Normalize into 0–24 range (handles negatives like -0.17 → 23.83)
    h = ((h % 24) + 24) % 24;
    var hrs = Math.floor(h);
    var mins = Math.round((h - hrs) * 60);
    if (mins === 60) { hrs++; mins = 0; }
    var ampm = hrs >= 12 ? 'PM' : 'AM';
    var h12 = hrs % 12 || 12;
    return h12 + ':' + String(mins).padStart(2, '0') + ' ' + ampm;
  }

  /** Format arrive time with "(prev. day)" tag for overnight shifts */
  function formatArriveTime(t) {
    var normalized = ((t % 24) + 24) % 24;
    var timeStr = hundredthsTo12h(t);
    if (normalized >= 18) {
      timeStr += ' <span style="font-size:0.65rem;color:#d97706;font-weight:600;">(prev. day)</span>';
    }
    return timeStr;
  }

  /** Plain-text version for emails/text export */
  function formatArriveTimeText(t) {
    var normalized = ((t % 24) + 24) % 24;
    var timeStr = hundredthsTo12h(t);
    if (normalized >= 18) timeStr += ' (prev. day)';
    return timeStr;
  }

  // ===================== SCHEDULE =====================

  var schedOutputDiv = document.getElementById('wb-sched-output');
  var schedGenerateBtn = document.getElementById('wb-sched-generate');
  var schedAddRowBtn = document.getElementById('wb-sched-add-row');
  var btToggleWrap = document.getElementById('wb-sched-bt-toggle-wrap');
  var btToggle = document.getElementById('wb-sched-bt-toggle');

  var schedSlots = [];
  var schedEmps = [];
  var mhSkipped = [];
  var mhTacsWorkDows = {};
  var hasTacsData = false;

  function parseStartTime(val) {
    if (!val) return null;
    var n = parseInt(String(val).replace(/\D/g, ''), 10);
    if (isNaN(n)) return null;
    var hrs = Math.floor(n / 100);
    var mins = n % 100;
    return hrs + mins / 60;
  }

  function arrive10Before(bt) {
    return round5(bt - 10 / 60);
  }

  /** Round a decimal-hour time to the nearest 5-minute increment */
  function round5(t) {
    var totalMin = Math.round(t * 60);
    totalMin = Math.round(totalMin / 5) * 5;
    return totalMin / 60;
  }

  /** Format date as YYYY-MM-DD in local timezone (avoids UTC shift from toISOString) */
  function localDateISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** Get the current office's start/end dates (falls back to review root) */
  function getOfficeDates() {
    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    if (!rev) return { startDate: '', endDate: '', officeName: '' };
    if (rev.offices && rev.offices.length > 0 && financeNum) {
      for (var i = 0; i < rev.offices.length; i++) {
        if (rev.offices[i].financeNum === financeNum) {
          return {
            startDate: rev.offices[i].startDate || rev.startDate || '',
            endDate: rev.offices[i].endDate || rev.endDate || '',
            officeName: rev.offices[i].officeName || ''
          };
        }
      }
    }
    return { startDate: rev.startDate || '', endDate: rev.endDate || '', officeName: rev.officeName || '' };
  }

  /** Update the current office's dates */
  function updateOfficeDates(startDate, endDate) {
    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    if (!rev) return;
    if (rev.offices && rev.offices.length > 0 && financeNum) {
      var offices = rev.offices.slice();
      for (var i = 0; i < offices.length; i++) {
        if (offices[i].financeNum === financeNum) {
          if (startDate !== undefined) offices[i].startDate = startDate;
          if (endDate !== undefined) offices[i].endDate = endDate;
          Reviews.update(reviewId, { offices: offices });
          return;
        }
      }
    }
    // Fallback: update root
    var data = {};
    if (startDate !== undefined) data.startDate = startDate;
    if (endDate !== undefined) data.endDate = endDate;
    Reviews.update(reviewId, data);
  }

  function generateSchedule() {
    var WB_KEY = 'clerk_obs_workbook_' + reviewId + (financeNum ? '_' + financeNum : '');
    var wbData = {};
    try { wbData = JSON.parse(localStorage.getItem(WB_KEY)) || {}; } catch(e) {}
    var roster = wbData.roster || [];
    var clockRingPatterns = wbData.clockRingPatterns || {}; // "LAST, FIRST" → { dow: minutes }
    var hasClockRings = Object.keys(clockRingPatterns).length > 0;
    var useActualBt = hasClockRings && btToggle && btToggle.checked;

    // Load TACS data to check which days MH employees actually worked
    var mhTacs = wbData.mhTacs || {};
    mhTacsWorkDows = {}; // "LAST, FIRST" → Set-like { dow: true } of days actually worked
    if (mhTacs.employees) {
      Object.keys(mhTacs.employees).forEach(function(legKey) {
        var emp = mhTacs.employees[legKey];
        var name = emp.name || legKey.split('|').pop();
        if (!mhTacsWorkDows[name]) mhTacsWorkDows[name] = {};
        var days = emp.days || {};
        Object.keys(days).forEach(function(dn) {
          var d = days[dn];
          if (d._date && d.BT !== undefined) {
            var dt = new Date(d._date + 'T00:00:00');
            mhTacsWorkDows[name][dt.getDay()] = true;
          }
        });
      });
    }
    hasTacsData = Object.keys(mhTacsWorkDows).length > 0;

    // Show or hide the Bid/Actual toggle based on clock ring data
    if (btToggleWrap) btToggleWrap.style.display = hasClockRings ? 'flex' : 'none';

    if (roster.length === 0) {
      schedOutputDiv.innerHTML = '<p class="empty-state">No roster found. Upload the Office Schedule first.</p>';
      return;
    }

    // Compute review-day DOWs early so "Actual BT" mode can filter by them
    var officeDates = getOfficeDates();
    var reviewDowSet = {};
    if (officeDates.startDate && officeDates.endDate) {
      var _ds = new Date(officeDates.startDate + 'T00:00:00');
      var _de = new Date(officeDates.endDate + 'T00:00:00');
      var _c = new Date(_ds);
      while (_c <= _de) {
        var _dow = _c.getDay();
        if (_dow !== 0 && _dow !== 6) reviewDowSet[_dow] = true;
        _c.setDate(_c.getDate() + 1);
      }
    }
    var hasReviewDows = Object.keys(reviewDowSet).length > 0;

    var MH_DA_CODES = [120, 320, 820, 420];
    schedEmps = [];
    roster.forEach(function(r) {
      var bt = parseStartTime(r.start);
      var craft = 'Clerk';
      var da = parseInt(r.daCode, 10);
      if (MH_DA_CODES.indexOf(da) !== -1) craft = 'MH';
      var empName = r.last + ', ' + r.first;

      // Look up clock ring day-of-week patterns (stored in minutes, convert to decimal hours)
      var btByDow = null;
      if (hasClockRings && clockRingPatterns[empName]) {
        btByDow = {};
        var pat = clockRingPatterns[empName];
        Object.keys(pat).forEach(function(d) {
          btByDow[d] = pat[d] / 60; // minutes → decimal hours
        });
      }

      // If "Actual BT" mode, override beginTime with earliest clock ring BT
      // across only the DOWs that fall within the review dates
      var effectiveBt = bt;
      if (useActualBt && btByDow) {
        var earliest = null;
        Object.keys(btByDow).forEach(function(d) {
          // Only consider DOWs that are actual review days
          if (hasReviewDows && !reviewDowSet[d]) return;
          var v = btByDow[d];
          if (earliest === null || v < earliest) earliest = v;
        });
        if (earliest !== null) effectiveBt = earliest;
      }

      schedEmps.push({
        name: empName,
        beginTime: effectiveBt,
        endTime: effectiveBt !== null ? effectiveBt + 8.5 : null,
        craft: craft,
        daysOff: (r.daysOff || '').trim(),
        btByDow: btByDow, // null if no clock ring data
        scheduledBt: bt, // original roster BT for reference
        usingActualBt: useActualBt && btByDow && effectiveBt !== bt
      });
    });

    var clerks = schedEmps.filter(function(e) { return e.craft === 'Clerk' && e.beginTime !== null; });
    var mhs = schedEmps.filter(function(e) { return e.craft === 'MH' && e.beginTime !== null; });

    clerks.sort(function(a, b) { return a.beginTime - b.beginTime; });
    mhs.sort(function(a, b) { return a.beginTime - b.beginTime; });

    // Compute review days early so we can factor days off into staffing
    var officeDates = getOfficeDates();
    var reviewDays = [];
    if (officeDates.startDate && officeDates.endDate) {
      var ds = new Date(officeDates.startDate + 'T00:00:00');
      var de = new Date(officeDates.endDate + 'T00:00:00');
      var cur = new Date(ds);
      while (cur <= de) {
        var dow = cur.getDay();
        if (dow !== 0 && dow !== 6) reviewDays.push({ date: new Date(cur), dow: dow });
        cur.setDate(cur.getDate() + 1);
      }
    }
    var dayAbbrs = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    schedSlots = [];
    mhSkipped = []; // MH employees excluded because too many off days

    // MH: 1:1, reviewer label includes the employee name + their days off
    // Skip MH employees who have 2+ review days off (can't be meaningfully reviewed)
    mhs.forEach(function(emp) {
      if (reviewDays.length > 0 && emp.daysOff) {
        var offDows = parseDaysOff(emp.daysOff);
        var offReviewDays = reviewDays.filter(function(rd) {
          return offDows.indexOf(rd.dow) !== -1;
        });
        if (offReviewDays.length >= 2) {
          // Check TACS: do they actually work any of those off days?
          var worksOffDays = false;
          if (hasTacsData && mhTacsWorkDows[emp.name]) {
            var tacsWorked = mhTacsWorkDows[emp.name];
            offReviewDays.forEach(function(rd) {
              if (tacsWorked[rd.dow]) worksOffDays = true;
            });
          }
          if (!worksOffDays) {
            mhSkipped.push({
              name: emp.name,
              offDays: offReviewDays.map(function(rd) {
                return dayAbbrs[rd.dow] + ' ' + (rd.date.getMonth()+1) + '/' + rd.date.getDate();
              })
            });
            return; // skip this MH
          }
        }
      }
      schedSlots.push({
        craft: 'MH',
        arriveTime: arrive10Before(emp.beginTime),
        empStartTime: emp.beginTime,
        mhName: emp.name,
        mhDaysOff: emp.daysOff
      });
    });

    // Clerk-to-reviewer staffing table (USPS standard)
    // Index = number of working clerks, value = number of clerk reviewers needed
    var CLERK_REV_TABLE = [0,1,1,1,2,3,4,4,5,5,6,7,7,8,8,9,10,11,11,12,12,13,13,14,15,15,16,17,17,18,19,19,20,21,22];
    function clerkToReviewers(n) {
      if (n <= 0) return 0;
      if (n < CLERK_REV_TABLE.length) return CLERK_REV_TABLE[n];
      // Extrapolate for very large offices (~0.625 ratio)
      return Math.round(n * 0.625);
    }

    // Find max clerks working on any single review day
    var maxClerksWorking = clerks.length; // fallback if no review dates set
    if (reviewDays.length > 0) {
      maxClerksWorking = 0;
      reviewDays.forEach(function(rd) {
        var working = 0;
        clerks.forEach(function(c) {
          var offDows = parseDaysOff(c.daysOff);
          if (offDows.indexOf(rd.dow) === -1) working++;
        });
        if (working > maxClerksWorking) maxClerksWorking = working;
      });
    }

    // Clerks: use staffing table, clustered by start time, merged into travel groups
    if (clerks.length > 0 && maxClerksWorking > 0) {
      var neededSlots = clerkToReviewers(maxClerksWorking);

      // Step 1: Group clerks into time clusters (within 30 min of each other)
      var clusters = [[clerks[0]]];
      for (var ci = 1; ci < clerks.length; ci++) {
        var lastCluster = clusters[clusters.length - 1];
        if (clerks[ci].beginTime - lastCluster[0].beginTime <= 0.5) {
          lastCluster.push(clerks[ci]);
        } else {
          clusters.push([clerks[ci]]);
        }
      }

      // Step 2: Distribute neededSlots across clusters — AM-heavy
      // Earlier clusters get proportionally more coverage
      var clerkArrivals = [];
      if (clusters.length === 1) {
        for (var r = 0; r < neededSlots; r++) {
          clerkArrivals.push({
            arriveTime: arrive10Before(clusters[0][0].beginTime),
            empStartTime: clusters[0][0].beginTime
          });
        }
      } else {
        // Weight earlier clusters higher: weight = 2 for earliest, linearly down to 1 for latest
        var allocated = [];
        var totalWeight = 0;
        clusters.forEach(function(cl, idx) {
          var posRatio = idx / (clusters.length - 1); // 0 = earliest, 1 = latest
          var weight = cl.length * (2 - posRatio); // early gets 2x, late gets 1x
          allocated.push(weight);
          totalWeight += weight;
        });
        // Convert weights to slot counts
        var totalAllocated = 0;
        allocated = allocated.map(function(w) {
          var s = Math.round(neededSlots * w / totalWeight);
          totalAllocated += s;
          return s;
        });
        // Ensure first cluster always gets at least 1
        if (allocated[0] < 1) { totalAllocated += (1 - allocated[0]); allocated[0] = 1; }
        // Adjust over: trim from latest clusters first
        var ci = allocated.length - 1;
        while (totalAllocated > neededSlots && ci >= 0) {
          var min = ci === 0 ? 1 : 0;
          if (allocated[ci] > min) { allocated[ci]--; totalAllocated--; }
          else ci--;
        }
        // Adjust under: add to earliest clusters first
        ci = 0;
        while (totalAllocated < neededSlots && ci < allocated.length) {
          allocated[ci]++;
          totalAllocated++;
          // Move to next cluster only after early ones are well-staffed
          if (allocated[ci] >= Math.ceil(clusters[ci].length * 0.8)) ci++;
        }

        clusters.forEach(function(cl, idx) {
          for (var r = 0; r < allocated[idx]; r++) {
            clerkArrivals.push({
              arriveTime: arrive10Before(cl[0].beginTime),
              empStartTime: cl[0].beginTime
            });
          }
        });
      }

      // Step 3: Merge adjacent arrivals into travel groups
      var travelGroups = [{ items: [clerkArrivals[0]] }];
      for (var ti = 1; ti < clerkArrivals.length; ti++) {
        var lg = travelGroups[travelGroups.length - 1];
        var gapFromFirst = clerkArrivals[ti].arriveTime - lg.items[0].arriveTime;
        if (gapFromFirst <= 1.5 && lg.items.length < 4) {
          lg.items.push(clerkArrivals[ti]);
        } else {
          travelGroups.push({ items: [clerkArrivals[ti]] });
        }
      }

      // Step 4: Create slots
      travelGroups.forEach(function(grp) {
        var groupArriveTime = grp.items[0].arriveTime;
        grp.items.forEach(function(item) {
          schedSlots.push({
            craft: 'Clerk',
            arriveTime: groupArriveTime,
            empStartTime: item.empStartTime
          });
        });
      });

      // Step 5: Ensure full clerk coverage — every hour that clerks work
      // must have at least one clerk reviewer on shift.
      // First, find the full span of clerk working hours.
      var SHIFT_LEN = 8.5;
      var firstClerkStart = Math.min.apply(null, clerks.map(function(c) { return c.beginTime; }));
      var lastClerkEnd = Math.max.apply(null, clerks.map(function(c) { return c.endTime; }));

      // Build a timeline of clerk-covered hours in 30-min increments
      var clerkReviewSlots = schedSlots.filter(function(s) { return s.craft === 'Clerk'; });

      // Keep adding reviewers until all clerk hours are covered
      var safetyLimit = 20; // don't add more than 20 extra
      var added = 0;
      while (added < safetyLimit) {
        // Find first uncovered 30-min slot where clerks are working
        var gap = null;
        for (var t = firstClerkStart; t < lastClerkEnd; t += 0.5) {
          // Count clerks working at time t
          var clerksAt = 0;
          clerks.forEach(function(c) {
            if (c.beginTime <= t && c.endTime > t) clerksAt++;
          });
          if (clerksAt === 0) continue; // no clerks at this time, no reviewer needed

          // Check if any clerk reviewer covers this time
          var covered = false;
          clerkReviewSlots.forEach(function(rs) {
            if (rs.arriveTime <= t && rs.arriveTime + SHIFT_LEN > t) covered = true;
          });
          if (!covered) { gap = t; break; }
        }
        if (gap === null) break; // all covered

        // Find the end of the uncovered span
        var gapEnd = gap;
        for (var gt = gap; gt < lastClerkEnd; gt += 0.5) {
          var coveredHere = false;
          clerkReviewSlots.forEach(function(rs) {
            if (rs.arriveTime <= gt && rs.arriveTime + SHIFT_LEN > gt) coveredHere = true;
          });
          if (coveredHere) break;
          gapEnd = gt + 0.5;
        }

        // Place a new reviewer to cover the gap, centering their 8.5h shift
        var gapMid = (gap + gapEnd) / 2;
        var newArrival = round5(gapMid - SHIFT_LEN / 2);
        // Clamp so their shift doesn't start before clerks need them
        newArrival = Math.max(newArrival, round5(gap - 0.5));
        // Clamp so they don't end way past last clerk
        newArrival = Math.min(newArrival, round5(lastClerkEnd - SHIFT_LEN));

        var newSlot = {
          craft: 'Clerk',
          arriveTime: newArrival,
          empStartTime: round5(newArrival + 10 / 60),
          isAutoAdded: true
        };
        schedSlots.push(newSlot);
        clerkReviewSlots.push(newSlot);
        added++;
      }
    }

    schedSlots.sort(function(a, b) { return a.arriveTime - b.arriveTime; });

    // --- Per-day auto-skips for lighter days ---
    var clerkSlotCount = schedSlots.filter(function(s) { return s.craft === 'Clerk'; }).length;
    var autoSkips = {};

    if (reviewDays.length > 0 && clerkSlotCount > 0) {
      // Count clerks working each review day
      var perDayClerks = reviewDays.map(function(rd) {
        var working = 0;
        clerks.forEach(function(c) {
          var offDows = parseDaysOff(c.daysOff);
          if (offDows.indexOf(rd.dow) === -1) working++;
        });
        return { date: rd.date, dow: rd.dow, working: working };
      });

      // Find the heaviest day
      var maxWorking = 0;
      perDayClerks.forEach(function(pd) {
        if (pd.working > maxWorking) maxWorking = pd.working;
      });

      // For lighter days, auto-skip excess clerk reviewer slots
      var clerkSlotIndices = [];
      schedSlots.forEach(function(s, i) {
        if (s.craft === 'Clerk') clerkSlotIndices.push(i);
      });

      perDayClerks.forEach(function(pd) {
        // Use staffing table for this day's working clerk count
        var needed = clerkToReviewers(pd.working);
        if (needed < clerkSlotCount) {
          // Skip the last (clerkSlotCount - needed) clerk slots on this day
          for (var si = needed; si < clerkSlotIndices.length; si++) {
            var slotIdx = clerkSlotIndices[si];
            var dateISO = localDateISO(pd.date);
            autoSkips['slot_' + slotIdx + '_' + dateISO] = true;
          }
        }
      });
    }

    // --- MH: auto-skip on days their employee is off ---
    // But if TACS shows they actually work that day, keep them and flag it
    if (reviewDays.length > 0) {
      schedSlots.forEach(function(s, si) {
        if (s.craft !== 'MH' || !s.mhDaysOff) return;
        var offDows = parseDaysOff(s.mhDaysOff);
        if (offDows.length === 0) return;

        var tacsWorked = (hasTacsData && s.mhName && mhTacsWorkDows[s.mhName]) ? mhTacsWorkDows[s.mhName] : {};

        // Find which review days overlap their off days
        var offReviewDays = reviewDays.filter(function(rd) {
          return offDows.indexOf(rd.dow) !== -1;
        });
        var onReviewDays = reviewDays.filter(function(rd) {
          return offDows.indexOf(rd.dow) === -1;
        });

        // Track off days where TACS shows they actually work
        var worksOffDayFlags = [];

        if (onReviewDays.length > 0) {
          offReviewDays.forEach(function(rd) {
            if (tacsWorked[rd.dow]) {
              // TACS shows they work this "off" day — keep scheduled, flag it
              worksOffDayFlags.push(dayAbbrs[rd.dow] + ' ' + (rd.date.getMonth()+1) + '/' + rd.date.getDate());
            } else {
              autoSkips['slot_' + si + '_' + localDateISO(rd.date)] = true;
            }
          });
        } else if (offReviewDays.length > 1) {
          // All days are off — check TACS for each
          offReviewDays.forEach(function(rd, oi) {
            if (tacsWorked[rd.dow]) {
              worksOffDayFlags.push(dayAbbrs[rd.dow] + ' ' + (rd.date.getMonth()+1) + '/' + rd.date.getDate());
            } else if (oi > 0) {
              // Keep first off day only if no TACS match found
              autoSkips['slot_' + si + '_' + localDateISO(rd.date)] = true;
            }
          });
        }

        if (worksOffDayFlags.length > 0) {
          s.mhWorksOffDay = worksOffDayFlags;
        }
      });
    }

    // All are reviewers — MH slots get employee name in label + off-day flag
    var revNum = 1;
    schedSlots.forEach(function(s) {
      if (s.mhName) {
        s.label = 'Reviewer ' + revNum + ' \u2014 ' + s.mhName;
        // Flag MH off days that overlap review days
        if (s.mhDaysOff && reviewDays.length > 0) {
          var offDows = parseDaysOff(s.mhDaysOff);
          var offOnReview = [];
          reviewDays.forEach(function(rd) {
            if (offDows.indexOf(rd.dow) !== -1) {
              offOnReview.push(dayAbbrs[rd.dow] + ' ' + (rd.date.getMonth() + 1) + '/' + rd.date.getDate());
            }
          });
          if (offOnReview.length > 0) {
            s.mhOffFlag = offOnReview;
          }
        }
      } else {
        s.label = 'Reviewer ' + revNum;
      }
      revNum++;
    });

    // Relief reviewer(s): add 1 relief when 4+ clerk reviewers span 6+ hours,
    // add a 2nd relief when 8+ clerk reviewers for better break coverage
    var clerkRevSlots = schedSlots.filter(function(s) { return s.craft === 'Clerk'; });
    if (clerkRevSlots.length >= 4) {
      var earliest = clerkRevSlots[0].arriveTime;
      var latest = clerkRevSlots[clerkRevSlots.length - 1].arriveTime;
      if (latest - earliest >= 6) {
        var reliefTime = round5(earliest + 4);
        schedSlots.push({
          label: 'Reviewer ' + revNum + ' (Relief)',
          craft: 'Relief',
          arriveTime: reliefTime,
          isRelief: true
        });
        revNum++;

        // Second relief for larger teams — arrives offset from first relief
        if (clerkRevSlots.length >= 8) {
          var midPoint = round5(earliest + (latest - earliest) / 2);
          var relief2Time = midPoint !== reliefTime ? midPoint : round5(reliefTime + 2);
          schedSlots.push({
            label: 'Reviewer ' + revNum + ' (Relief)',
            craft: 'Relief',
            arriveTime: relief2Time,
            isRelief: true
          });
        }
      }
    }

    // Save auto-generated day skips before full save (saveScheduleData reads from storage)
    var preData = loadSched();
    preData.daySkips = autoSkips;
    saveSched(preData);

    renderSchedule();
    saveScheduleData();
  }

  /** Build break/lunch windows for clerk reviewers AND relief reviewer(s).
   *  Each reviewer gets: break1 (10 min), lunch (60 min), break2 (10 min).
   *  Evenly spaced across 8.5h shift (~2h work between each break.
   *  Lunches staggered so at most N overlap (N = relief count, min 1).
   *  Returns array of {slotIdx, label, windows:[{start,end,type}], isRelief?} */
  function computeBreaks() {
    var clerkSlots = [];
    var reliefSlots = [];
    schedSlots.forEach(function(s, idx) {
      if (s.craft === 'MH') return;
      if (s.isRelief) { reliefSlots.push({ idx: idx, label: s.label, arriveTime: s.arriveTime }); return; }
      clerkSlots.push({ idx: idx, label: s.label, arriveTime: s.arriveTime });
    });
    if (clerkSlots.length === 0) return [];

    var SHIFT = 8.5;
    var BRK = 10 / 60; // 10 min
    var LUNCH = 60 / 60; // 60 min (1 hour)
    var MIN_EDGE = 1;    // at least 1 hour from start/end of shift

    // Minimum 1h gap between each break/lunch. Gaps are non-negotiable.
    // Hard rule: 1 hour minimum between break end → next break start
    var MIN_GAP = 1;

    // How many reviewers can be on lunch at the same time (= relief count, min 1)
    var maxSimul = Math.max(1, reliefSlots.length);

    // Calculate lunch window for staggering:
    // Earliest lunch: 2h (break1) + 10min (break1 dur) + 1h (gap) = 3h10m into shift
    // Latest lunch: must allow 1h gap + 10min break2 before shift end
    //   lunch + 1h(lunch) + 1h(gap) + 10min(brk2) <= 8.5h  →  lunch <= 6h20m into shift
    var LUNCH_WINDOW_START = 2 + BRK + MIN_GAP;   // 3.167h into shift
    var LUNCH_WINDOW_END = SHIFT - LUNCH - MIN_GAP - BRK; // 6.333h into shift
    var LUNCH_WINDOW = LUNCH_WINDOW_END - LUNCH_WINDOW_START; // ~3.17h

    // Number of stagger groups
    var numGroups = Math.ceil(clerkSlots.length / maxSimul);
    // Spacing between groups — spread evenly across the window
    var groupSpacing = numGroups > 1 ? LUNCH_WINDOW / (numGroups - 1) : 0;
    // Cap spacing so groups don't bunch up — at least 15 min apart
    groupSpacing = Math.max(groupSpacing, 15 / 60);

    function computeReviewerBreaks(shiftStart, groupIdx) {
      var shiftEnd = shiftStart + SHIFT;

      // Break 1: 2h into shift
      var brk1 = round5(shiftStart + 2);

      // Lunch: placed within the safe window, staggered by group
      var lunchPos = LUNCH_WINDOW_START + groupIdx * groupSpacing;
      // Clamp to window
      lunchPos = Math.min(lunchPos, LUNCH_WINDOW_END);
      var lunch = round5(shiftStart + lunchPos);

      // Break 2: 1h after lunch ends
      var brk2 = round5(lunch + LUNCH + MIN_GAP);

      return [
        { start: brk1, end: round5(brk1 + BRK), type: 'break' },
        { start: lunch, end: round5(lunch + LUNCH), type: 'lunch' },
        { start: brk2, end: round5(brk2 + BRK), type: 'break' }
      ];
    }

    // Sort clerk reviewers by arrival time for staggering
    var sorted = clerkSlots.slice().sort(function(a, b) { return a.arriveTime - b.arriveTime; });

    var result = [];
    sorted.forEach(function(cs, i) {
      var groupIdx = Math.floor(i / maxSimul);

      result.push({
        slotIdx: cs.idx,
        label: cs.label,
        isRelief: false,
        windows: computeReviewerBreaks(cs.arriveTime, groupIdx)
      });
    });

    // Relief reviewers' own breaks — mid-window, no stagger
    reliefSlots.forEach(function(rs) {
      result.push({
        slotIdx: rs.idx,
        label: rs.label,
        isRelief: true,
        windows: computeReviewerBreaks(rs.arriveTime, 0)
      });
    });

    return result;
  }

  function buildReliefSchedule() {
    var breakData = computeBreaks();
    if (breakData.length === 0) return '';

    var clerkBreaks = breakData.filter(function(b) { return !b.isRelief; });
    var reliefBreaks = breakData.filter(function(b) { return b.isRelief; });

    var html = '<div style="margin-top:0.75rem;"><h4 style="font-size:0.82rem;margin:0 0 0.3rem;">Relief Coverage Schedule</h4>';
    html += '<table class="wb-tacs-table"><thead><tr><th>Reviewer</th><th>Break 1 (10 min)</th><th>Lunch (60 min)</th><th>Break 2 (10 min)</th></tr></thead><tbody>';
    clerkBreaks.forEach(function(b) {
      html += '<tr><td>' + esc(b.label) + '</td>';
      b.windows.forEach(function(w) {
        html += '<td>' + hundredthsTo12h(w.start) + ' – ' + hundredthsTo12h(w.end) + '</td>';
      });
      html += '</tr>';
    });
    if (reliefBreaks.length > 0) {
      reliefBreaks.forEach(function(b) {
        html += '<tr style="border-top:2px solid var(--border);"><td>' + esc(b.label) + ' <em>(own)</em></td>';
        b.windows.forEach(function(w) {
          html += '<td>' + hundredthsTo12h(w.start) + ' – ' + hundredthsTo12h(w.end) + '</td>';
        });
        html += '</tr>';
      });
    }
    html += '</tbody></table>';
    html += '<p style="font-size:0.72rem;color:var(--text-light);margin-top:0.2rem;">MH reviewers mirror their employee\'s schedule and do not need relief coverage.</p>';
    html += '</div>';
    return html;
  }

  /** Parse daysOff string into day-of-week numbers (0=Sun..6=Sat).
   *  Handles formats: "SUNMON", "Sun/Wed", "Sat Wed", "SUN MON", "SunMon" */
  function parseDaysOff(str) {
    if (!str) return [];
    var dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    var result = [];
    // First try splitting on separators
    var parts = str.split(/[\/,\s&]+/).filter(function(p) { return p.length > 0; });
    // If only 1 part and it's 6+ chars, it's concatenated like "SUNMON"
    if (parts.length === 1 && parts[0].length >= 6) {
      var raw = parts[0];
      for (var i = 0; i + 2 < raw.length; i += 3) {
        var chunk = raw.slice(i, i + 3).toLowerCase();
        if (dayMap[chunk] !== undefined) result.push(dayMap[chunk]);
      }
    } else {
      parts.forEach(function(p) {
        var key = p.trim().toLowerCase().slice(0, 3);
        if (dayMap[key] !== undefined) result.push(dayMap[key]);
      });
    }
    return result;
  }

  /** Build a days-off awareness section showing which employees are off on which review days.
   *  Especially important for MH reviewers who have nothing to do when their employee is off. */
  function buildDaysOffSection() {
    var officeDates = getOfficeDates();
    if (!officeDates.startDate || !officeDates.endDate) return '';

    var start = new Date(officeDates.startDate + 'T00:00:00');
    var end = new Date(officeDates.endDate + 'T00:00:00');

    // Build list of review days (weekdays only)
    var reviewDays = [];
    var d = new Date(start);
    while (d <= end) {
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) { // skip weekends
        reviewDays.push({ date: new Date(d), dow: dow });
      }
      d.setDate(d.getDate() + 1);
    }
    if (reviewDays.length === 0) return '';

    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Check each employee's days off against review days
    var empsWithOff = [];
    schedEmps.forEach(function(emp) {
      var offDows = parseDaysOff(emp.daysOff);
      if (offDows.length === 0) return;
      var offDates = [];
      reviewDays.forEach(function(rd) {
        if (offDows.indexOf(rd.dow) !== -1) {
          offDates.push(rd);
        }
      });
      if (offDates.length > 0) {
        empsWithOff.push({ name: emp.name, craft: emp.craft, daysOff: emp.daysOff, offDates: offDates });
      }
    });

    // Per-day staffing breakdown (always show if we have review days + clerks)
    var clerkTotal = schedEmps.filter(function(e) { return e.craft === 'Clerk' && e.beginTime !== null; }).length;
    var mhTotal = schedEmps.filter(function(e) { return e.craft === 'MH' && e.beginTime !== null; }).length;
    var currentClerkSlots = schedSlots.filter(function(s) { return s.craft === 'Clerk'; }).length;
    var currentMhSlots = schedSlots.filter(function(s) { return s.craft === 'MH'; }).length;

    if (clerkTotal === 0 && mhTotal === 0) return '';

    var html = '<div style="margin-top:0.75rem;">';
    html += '<h4 style="font-size:0.82rem;margin:0 0 0.3rem;">Daily Staffing Breakdown</h4>';
    // Load daySkips to compute per-day adjusted reviewer counts
    var schedData = loadSched();
    var daySkips = schedData.daySkips || {};

    html += '<table class="wb-tacs-table"><thead><tr><th>Day</th><th>Date</th>';
    html += '<th>Clerks Working</th><th>Clerks Off</th><th>Clerk Reviewers</th>';
    html += '<th>MH Working</th><th>MH Off</th><th>MH Reviewers</th>';
    html += '</tr></thead><tbody>';
    reviewDays.forEach(function(rd) {
      var clerkOffNames = [];
      schedEmps.forEach(function(emp) {
        if (emp.craft !== 'Clerk' || emp.beginTime === null) return;
        var offDows = parseDaysOff(emp.daysOff);
        if (offDows.indexOf(rd.dow) !== -1) clerkOffNames.push(emp.name);
      });
      var mhOffNames = [];
      schedEmps.forEach(function(emp) {
        if (emp.craft !== 'MH' || emp.beginTime === null) return;
        var offDows = parseDaysOff(emp.daysOff);
        if (offDows.indexOf(rd.dow) !== -1) mhOffNames.push(emp.name);
      });
      var clerksWorking = clerkTotal - clerkOffNames.length;
      var mhsWorking = mhTotal - mhOffNames.length;
      var dateStr = (rd.date.getMonth() + 1) + '/' + rd.date.getDate();

      // Last name only for clerks off
      var clerkLastNames = clerkOffNames.map(function(n) { return n.split(',')[0].trim(); });
      var clerkOffCell = clerkOffNames.length > 0
        ? '<span style="color:#dc2626;font-weight:600;">' + clerkOffNames.length + '</span> <span style="font-size:0.7rem;color:#64748b;">(' + clerkLastNames.map(function(n) { return esc(n); }).join(', ') + ')</span>'
        : '0';
      var mhOffCell = mhOffNames.length > 0
        ? '<span style="color:#dc2626;font-weight:600;">' + mhOffNames.length + '</span> <span style="font-size:0.7rem;color:#64748b;">(' + mhOffNames.map(function(n) { return esc(n); }).join(', ') + ')</span>'
        : '0';

      // Count per-day adjusted reviewer slots (subtract skipped ones)
      var dateISO = localDateISO(rd.date);
      var dayClerkReviewers = 0;
      var dayMhReviewers = 0;
      schedSlots.forEach(function(s, si) {
        var skipKey = (s.assignedTo || ('slot_' + si)) + '_' + dateISO;
        if (daySkips[skipKey]) return;
        if (s.craft === 'Clerk') dayClerkReviewers++;
        if (s.craft === 'MH') dayMhReviewers++;
      });

      var clerkWarn = dayClerkReviewers > clerksWorking ? ' <span style="color:#f59e0b;font-size:0.7rem;" title="More reviewers than clerks working">\u26A0</span>' : '';
      var mhWarn = mhOffNames.length > 0 ? ' <span style="color:#f59e0b;font-size:0.7rem;" title="MH reviewer will have no observation work">\u26A0</span>' : '';

      html += '<tr><td>' + dayNames[rd.dow] + '</td><td>' + dateStr + '</td>';
      html += '<td>' + clerksWorking + '</td><td>' + clerkOffCell + '</td><td>' + dayClerkReviewers + clerkWarn + '</td>';
      html += '<td>' + mhsWorking + '</td><td>' + mhOffCell + '</td><td>' + dayMhReviewers + mhWarn + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    html += '</div>';
    return html;
  }

  /** Format minutes since midnight to 12h display (same as workbook) */
  function formatMinutesTo12h(m) {
    if (m === null || m === undefined) return '\u2014';
    var h = Math.floor(m / 60);
    var mm = m % 60;
    var ampm = h >= 12 ? 'PM' : 'AM';
    var hr = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    return hr + ':' + String(mm).padStart(2, '0') + ' ' + ampm;
  }

  /** Show clock ring BT deviations with employee cards — uses saved data from workbook */
  function buildClockRingSection() {
    var wbKey = 'clerk_obs_workbook_' + reviewId + (financeNum ? '_' + financeNum : '');
    var wbRaw = localStorage.getItem(wbKey);
    if (!wbRaw) return '';
    var wbData;
    try { wbData = JSON.parse(wbRaw); } catch(e) { return ''; }

    var summary = wbData.clockRingSummary;
    if (!summary || Object.keys(summary).length === 0) return '';

    var crRange = '';
    if (wbData.clockRingDateRange) {
      var fmtD = function(iso) { var dt = new Date(iso); return (dt.getMonth()+1)+'/'+dt.getDate()+'/'+dt.getFullYear(); };
      crRange = fmtD(wbData.clockRingDateRange.from) + ' \u2013 ' + fmtD(wbData.clockRingDateRange.to);
    }

    // Build employee list from summary
    var devEmps = [];
    var okEmps = [];
    Object.keys(summary).forEach(function(key) {
      var emp = summary[key];
      if (!emp || !emp.details) return;
      // Look up craft from schedEmps
      var craft = '';
      schedEmps.forEach(function(se) {
        if (se.name && se.name.toUpperCase() === (emp.name || '').toUpperCase()) craft = se.craft || '';
      });
      var obj = {
        name: emp.name,
        craft: craft,
        scheduled: emp.scheduled,
        devCount: emp.devDays || 0,
        total: emp.totalDays || emp.details.length,
        details: emp.details
      };
      if (obj.devCount > 0) devEmps.push(obj);
      else okEmps.push(obj);
    });
    devEmps.sort(function(a, b) { return b.devCount - a.devCount; });
    okEmps.sort(function(a, b) { return a.name.localeCompare(b.name); });
    var allEmps = devEmps.concat(okEmps);
    if (allEmps.length === 0) return '';

    var html = '<div style="margin-top:1rem;">';
    html += '<h4 style="font-size:0.82rem;margin:0 0 0.3rem;">\ud83d\udd50 Clock Ring Tour Deviations</h4>';
    html += '<p style="font-size:0.78rem;color:var(--text-light);margin-bottom:0.5rem;">Actual Begin Tour vs Bid Start from clock ring data' + (crRange ? ' <strong>(' + crRange + ')</strong>' : '') + '. Deviations \u226515 min flagged.</p>';

    if (devEmps.length === 0) {
      html += '<p style="color:var(--success);font-size:0.85rem;">\u2705 All ' + allEmps.length + ' employees clocking in within \u00b115 min of bid time.</p>';
    } else {
      html += '<p style="font-size:0.82rem;margin-bottom:0.5rem;"><strong style="color:#d97706;">' + devEmps.length + '</strong> employee' + (devEmps.length > 1 ? 's' : '') + ' with deviations &nbsp;\u00b7&nbsp; <span style="color:var(--text-light);">' + okEmps.length + ' within tolerance</span></p>';
    }

    // Employee cards
    html += '<div class="wb-cr-cards">';
    allEmps.forEach(function(emp) {
      var hasDev = emp.devCount > 0;
      var borderColor = hasDev ? (emp.devCount >= 5 ? '#ef4444' : '#d97706') : '#374151';
      var bgColor = hasDev ? 'rgba(255,165,0,0.04)' : 'transparent';
      var badge = hasDev
        ? '<span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:8px;font-size:0.68rem;font-weight:600;">' + emp.devCount + '/' + emp.total + ' deviated</span>'
        : '<span style="background:#d1fae5;color:#065f46;padding:1px 6px;border-radius:8px;font-size:0.68rem;">\u2705 ' + emp.total + ' days OK</span>';

      html += '<details style="margin-bottom:0.3rem;border:1px solid ' + borderColor + ';border-radius:6px;background:' + bgColor + ';">';
      html += '<summary style="cursor:pointer;padding:0.4rem 0.6rem;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;font-size:0.78rem;">';
      html += '<span><strong>' + esc(emp.name) + '</strong>';
      html += ' <span style="color:var(--text-light);font-size:0.72rem;">' + esc(emp.craft) + '</span>';
      html += ' \u2014 Scheduled: <strong>' + formatMinutesTo12h(emp.scheduled) + '</strong></span>';
      html += badge;
      html += '</summary>';

      // Detail table — matches workbook format exactly
      html += '<div style="padding:0.3rem 0.6rem 0.5rem;overflow-x:auto;">';
      html += '<table class="wb-tacs-table" style="font-size:0.75rem;width:100%;">';
      html += '<thead><tr><th>Date</th><th>Actual BT</th><th>Scheduled BT</th><th>Diff (min)</th><th>Flag</th></tr></thead>';
      html += '<tbody>';

      emp.details.forEach(function(row) {
        var diffStr = row.diff !== null && row.diff !== undefined ? (row.diff > 0 ? '+' : '') + row.diff : '\u2014';
        var absDiff = row.diff !== null ? Math.abs(row.diff) : 0;
        var rowBg = row.isDev ? 'background:rgba(255,165,0,0.08);' : '';
        var diffStyle = row.isDev ? 'color:var(--warning,#d97706);font-weight:600;' : '';

        html += '<tr style="' + rowBg + '">';
        html += '<td>' + esc(row.dateStr || '') + '</td>';
        html += '<td>' + formatMinutesTo12h(row.actualBt) + '</td>';
        html += '<td>' + formatMinutesTo12h(row.scheduledBt) + '</td>';
        html += '<td style="' + diffStyle + '">' + diffStr + '</td>';
        html += '<td>' + (row.isDev ? '\u26a0\ufe0f' : '\u2705') + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
      html += '</details>';
    });
    html += '</div>';

    html += '</div>';
    return html;
  }

  /** Build Daily Trips section — groups reviewers by arrival time with Drive In / Uber options */
  function buildDailyTrips() {
    if (schedSlots.length === 0) return '';

    var data = loadSched();
    var dailyTrips = data.dailyTrips || {};

    // Group slots by arriveTime
    var groups = {};
    var groupOrder = [];
    schedSlots.forEach(function(s, si) {
      var key = String(s.arriveTime);
      if (!groups[key]) {
        groups[key] = [];
        groupOrder.push(key);
      }
      var name = s.assignedTo || s.label;
      groups[key].push({ name: name, craft: s.craft, label: s.label });
    });

    var html = '<div style="margin-top:1rem;">';
    html += '<h4 style="font-size:0.85rem;margin:0 0 0.4rem;color:var(--text);">Daily Trips to Office</h4>';
    html += '<table class="wb-tacs-table"><thead><tr>';
    html += '<th>Depart Time</th><th>Reviewers</th><th>Transport</th>';
    html += '</tr></thead><tbody>';

    groupOrder.forEach(function(key) {
      var grp = groups[key];
      var arriveTime = parseFloat(key);
      var names = grp.map(function(g) {
        return esc(g.name);
      });
      var mode = dailyTrips[key] || 'drive';
      var driveChecked = mode === 'drive' ? ' checked' : '';
      var uberChecked = mode === 'uber' ? ' checked' : '';
      var groupName = 'wb-trip-' + key.replace('.', '_');

      html += '<tr>';
      html += '<td style="font-weight:600;font-size:0.8rem;white-space:nowrap;">' + formatArriveTime(arriveTime) + '</td>';
      html += '<td style="font-size:0.78rem;">' + names.join(', ') + ' <span style="font-size:0.65rem;color:var(--text-light);">(' + grp.length + ')</span></td>';
      html += '<td style="white-space:nowrap;">';
      html += '<label style="font-size:0.75rem;cursor:pointer;margin-right:8px;">' +
        '<input type="radio" class="wb-trip-mode" name="' + groupName + '" value="drive" data-key="' + esc(key) + '"' + driveChecked + '> 🚗 Drive In</label>';
      html += '<label style="font-size:0.75rem;cursor:pointer;">' +
        '<input type="radio" class="wb-trip-mode" name="' + groupName + '" value="uber" data-key="' + esc(key) + '"' + uberChecked + '> 🚕 Uber</label>';
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  /** Build email-friendly Daily Trips card for the schedule email */
  /** Build the Daily Trips email card — grouped by office, with transport mode */
  function buildDailyTripsEmailCard() {
    var allSlots = loadAllOfficeSchedules();
    // Merge dailyTrips transport modes from ALL office schedules
    var dailyTrips = {};
    tripReviews.forEach(function(rid) {
      var rev = null;
      try { rev = Reviews.getById(rid); } catch(e) {}
      if (!rev) return;
      var offices = (rev.offices && rev.offices.length > 0) ? rev.offices : [{ financeNum: '' }];
      offices.forEach(function(o) {
        var fin = o.financeNum || '';
        var key = 'clerk_obs_schedule_' + rid + (fin ? '_' + fin : '');
        var d = {};
        try { d = JSON.parse(localStorage.getItem(key)) || {}; } catch(e) {}
        var dt = d.dailyTrips || {};
        Object.keys(dt).forEach(function(k) { if (!dailyTrips[k]) dailyTrips[k] = dt[k]; });
      });
    });
    var currentSlots = (loadSched().schedule || []);

    // Build office groups: { officeName: { arriveTime: [names] } }
    var officeGroups = {};
    var officeOrder = [];

    // From allSlots (assigned reviewers across offices)
    allSlots.forEach(function(s) {
      var oName = s.officeName || 'TBD';
      if (!officeGroups[oName]) { officeGroups[oName] = {}; officeOrder.push(oName); }
      var key = String(s.arriveTime);
      if (!officeGroups[oName][key]) officeGroups[oName][key] = [];
      officeGroups[oName][key].push({ name: s.name, craft: s.craft });
    });

    // If no allSlots, fall back to current schedule's slots
    if (allSlots.length === 0) {
      var officeDates = getOfficeDates();
      var oName = officeDates.officeName || 'Office';
      if (!officeGroups[oName]) { officeGroups[oName] = {}; officeOrder.push(oName); }
      currentSlots.forEach(function(s) {
        var name = s.assignedTo || s.label;
        var key = String(s.arriveTime);
        if (!officeGroups[oName][key]) officeGroups[oName][key] = [];
        officeGroups[oName][key].push({ name: name, craft: s.craft || 'Clerk' });
      });
    }

    if (officeOrder.length === 0) return '<p class="empty-state">No schedule data available.</p>';

    var h = '';

    officeOrder.forEach(function(oName) {
      var timeGroups = officeGroups[oName];
      var timeKeys = Object.keys(timeGroups).sort(function(a, b) { return parseFloat(a) - parseFloat(b); });
      if (timeKeys.length === 0) return;

      h += '<div style="max-width:680px;margin:10px auto;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;background:#fff;">';

      // Header
      h += '<div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:8px 12px;">';
      h += '<div style="font-size:14px;font-weight:700;color:#fff;">🚗 Daily Trips — ' + esc(oName) + '</div>';
      h += '</div>';

      // Coordination callout — only show when multiple reviewers
      var totalReviewers = 0;
      timeKeys.forEach(function(k) { totalReviewers += timeGroups[k].length; });
      if (totalReviewers > 1) {
        h += '<div style="padding:6px 12px;background:#fef3c7;border-bottom:2px solid #f59e0b;display:flex;align-items:center;gap:6px;">';
        h += '<span style="font-size:14px;">⚠️</span>';
        h += '<span style="font-size:11px;font-weight:700;color:#78350f;">Coordinate with your group to arrive at the office by your designated Arrive By time.</span>';
        h += '</div>';
      }

      // Table
      h += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
      h += '<thead><tr style="background:#f1f5f9;">';
      h += '<th style="text-align:left;padding:4px 10px;font-size:10px;font-weight:600;color:#64748b;border-bottom:2px solid #e2e8f0;">ARRIVE BY</th>';
      h += '<th style="text-align:left;padding:4px 10px;font-size:10px;font-weight:600;color:#64748b;border-bottom:2px solid #e2e8f0;">REVIEWERS</th>';
      h += '<th style="text-align:center;padding:4px 10px;font-size:10px;font-weight:600;color:#64748b;border-bottom:2px solid #e2e8f0;">TRANSPORT</th>';
      h += '</tr></thead><tbody>';

      timeKeys.forEach(function(key, idx) {
        var grp = timeGroups[key];
        var arriveTime = parseFloat(key);
        var mode = dailyTrips[key] || 'drive';
        var modeLabel = mode === 'uber' ? '🚕 Uber' : '🚗 Drive';
        var modeBg = mode === 'uber' ? '#fef3c7' : '#ecfdf5';
        var modeColor = mode === 'uber' ? '#92400e' : '#065f46';
        var bg = idx % 2 === 0 ? '#fff' : '#f8fafc';

        var names = grp.map(function(g) {
          return '<span style="display:inline-block;padding:1px 6px;margin:1px 2px;border-radius:10px;background:#e0e7ff;color:#3730a3;font-size:10px;font-weight:500;white-space:nowrap;">' + esc(g.name) + '</span>';
        });

        h += '<tr style="background:' + bg + ';border-bottom:1px solid #e2e8f0;">';
        h += '<td style="padding:4px 10px;font-weight:600;white-space:nowrap;color:#1e293b;vertical-align:middle;">' + formatArriveTime(arriveTime) + '</td>';
        h += '<td style="padding:3px 6px;color:#1e293b;">' + names.join(' ') + '</td>';
        h += '<td style="padding:4px 10px;text-align:center;"><span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;background:' + modeBg + ';color:' + modeColor + ';">' + modeLabel + '</span></td>';
        h += '</tr>';
      });

      h += '</tbody></table>';

      h += '</div>';
    });

    return h;
  }

  /** Build plain-text Daily Trips section */
  function buildPlainTextDailyTrips() {
    if (schedSlots.length === 0) return '';

    var data = loadSched();
    var dailyTrips = data.dailyTrips || {};

    var groups = {};
    var groupOrder = [];
    schedSlots.forEach(function(s) {
      var key = String(s.arriveTime);
      if (!groups[key]) {
        groups[key] = [];
        groupOrder.push(key);
      }
      var name = s.assignedTo || s.label;
      groups[key].push({ name: name, craft: s.craft });
    });
    if (groupOrder.length === 0) return '';

    var lines = [];
    lines.push('═══ DAILY TRIPS TO OFFICE ═══');
    lines.push('');
    groupOrder.forEach(function(key) {
      var grp = groups[key];
      var arriveTime = parseFloat(key);
      var mode = dailyTrips[key] || 'drive';
      var modeLabel = mode === 'uber' ? 'Uber' : 'Drive In';
      var names = grp.map(function(g) {
        return g.name;
      });
      lines.push(formatArriveTimeText(arriveTime) + '  (' + modeLabel + ')');
      lines.push('  ' + names.join(', '));
      lines.push('');
    });
    return lines.join('\n');
  }

  /** Sort key: treat prev-day arrivals (6 PM+) as earliest */
  function timelineSortKey(t) {
    var normalized = ((t % 24) + 24) % 24;
    return normalized >= 18 ? normalized - 24 : normalized;
  }

  /** Build a per-day adjustment grid: toggle reviewer slots on/off for each review day */
  function buildTimeline() {
    var validEmps = schedEmps.filter(function(e) { return e.beginTime !== null; });
    if (validEmps.length === 0 && schedSlots.length === 0) return '';

    var totalRows = schedSlots.length + validEmps.length;
    var compact = totalRows > 20;

    // Compute time range
    var times = [];
    validEmps.forEach(function(e) { times.push(e.beginTime, e.endTime); });
    schedSlots.forEach(function(s) { times.push(s.arriveTime, s.arriveTime + 8.5); });
    var minTime = Math.floor(Math.min.apply(null, times));
    var maxTime = Math.ceil(Math.max.apply(null, times)) + 1;
    var range = maxTime - minTime;

    function pct(t) { return ((t - minTime) / range * 100).toFixed(2); }
    function wpct(dur) { return (dur / range * 100).toFixed(2); }

    var breakData = computeBreaks();
    // Index breaks by slot idx for quick lookup
    var breakMap = {};
    breakData.forEach(function(b) { breakMap[b.slotIdx] = b.windows; });

    // Compute review days for day toggle
    var officeDates = getOfficeDates();
    var tlReviewDays = [];
    var dayAbbrs = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (officeDates.startDate && officeDates.endDate) {
      var _ds2 = new Date(officeDates.startDate + 'T00:00:00');
      var _de2 = new Date(officeDates.endDate + 'T00:00:00');
      var _c2 = new Date(_ds2);
      while (_c2 <= _de2) {
        var _dow2 = _c2.getDay();
        if (_dow2 !== 0 && _dow2 !== 6) {
          tlReviewDays.push({ dow: _dow2, label: dayAbbrs[_dow2] + ' ' + (_c2.getMonth() + 1) + '/' + _c2.getDate(), dateStr: localDateISO(_c2) });
        }
        _c2.setDate(_c2.getDate() + 1);
      }
    }

    var html = '<div class="wb-sched-timeline' + (compact ? ' wb-timeline-compact' : '') + '">';

    // Header with sort/filter controls (OUTSIDE scroll container so always visible)
    html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin:0.75rem 0 0.25rem;">';
    html += '<h4 style="font-size:0.82rem;margin:0;">Coverage Timeline</h4>';
    html += '<div style="display:flex;gap:0.6rem;align-items:center;font-size:0.75rem;flex-wrap:wrap;">';

    // Day toggle
    if (tlReviewDays.length > 1) {
      html += '<label style="color:#ccc;font-weight:600;">Day:</label>';
      html += '<select id="wb-timeline-day" style="font-size:0.75rem;padding:3px 8px;border:1px solid #555;border-radius:4px;background:#1e293b;color:#e2e8f0;cursor:pointer;">';
      html += '<option value="all" selected>Combined</option>';
      tlReviewDays.forEach(function(rd, i) {
        html += '<option value="' + rd.dow + '">Day ' + (i + 1) + ' — ' + rd.label + '</option>';
      });
      html += '</select>';
    }

    html += '<label style="color:#ccc;font-weight:600;">Sort:</label>';
    html += '<select id="wb-timeline-sort" style="font-size:0.75rem;padding:3px 8px;border:1px solid #555;border-radius:4px;background:#1e293b;color:#e2e8f0;cursor:pointer;">';
    html += '<option value="time" selected>Start Time</option>';
    html += '<option value="name">Name</option>';
    html += '<option value="craft">Craft</option>';
    html += '</select>';
    html += '<label style="color:#ccc;font-weight:600;margin-left:0.5rem;">Show:</label>';
    html += '<select id="wb-timeline-filter" style="font-size:0.75rem;padding:3px 8px;border:1px solid #555;border-radius:4px;background:#1e293b;color:#e2e8f0;cursor:pointer;">';
    html += '<option value="all" selected>All</option>';
    html += '<option value="clerk">Clerks Only</option>';
    html += '<option value="mh">MH Only</option>';
    html += '<option value="reviewer">Reviewers Only</option>';
    html += '<option value="employee">Employees Only</option>';
    html += '</select>';
    html += '</div></div>';

    // Legend (outside scroll container so always visible)
    html += '<div class="wb-timeline-legend">' +
      '<span class="wb-legend-item"><span class="wb-legend-swatch wb-bar-clerk"></span>Clerk</span>' +
      '<span class="wb-legend-item"><span class="wb-legend-swatch wb-bar-mh"></span>Mail Handler</span>' +
      '<span class="wb-legend-item"><span class="wb-legend-swatch wb-bar-reviewer"></span>Reviewer</span>' +
      '<span class="wb-legend-item"><span class="wb-legend-swatch wb-bar-relief"></span>Relief</span>' +
      '<span class="wb-legend-item"><span class="wb-legend-swatch wb-bar-break"></span>Break/Lunch</span>' +
      '</div>';

    // Day filter info banner (hidden initially, shown when a specific day is selected)
    html += '<div id="wb-timeline-day-info" style="display:none;font-size:0.75rem;color:#94a3b8;background:#1e293b;border:1px solid #334155;border-radius:4px;padding:4px 10px;margin-bottom:4px;"></div>';

    // Scrollable inner container for the actual chart
    var innerStyle = range > 14 ? ' style="overflow-x:auto;"' : '';
    var chartStyle = range > 14 ? ' style="min-width:' + Math.max(900, range * 55) + 'px;"' : '';
    html += '<div' + innerStyle + '><div' + chartStyle + '>';

    // Time axis — use larger step when range is wide to avoid label overlap
    var tickStep = range > 16 ? 2 : 1;
    html += '<div class="wb-timeline-axis">';
    for (var h = Math.ceil(minTime); h <= Math.floor(maxTime); h += tickStep) {
      html += '<span class="wb-timeline-tick" style="left:' + pct(h) + '%;">' + hundredthsTo12h(h) + '</span>';
    }
    html += '</div>';

    // Build sorted index arrays for reviewers and employees
    var revIndices = [];
    schedSlots.forEach(function(s, idx) { revIndices.push(idx); });
    revIndices.sort(function(a, b) {
      return timelineSortKey(schedSlots[a].arriveTime) - timelineSortKey(schedSlots[b].arriveTime);
    });

    var sortedEmps = validEmps.slice().sort(function(a, b) {
      return timelineSortKey(a.beginTime) - timelineSortKey(b.beginTime);
    });

    // Render reviewer row helper
    function renderRevRow(s, idx) {
      var shiftLen = 8.5;
      var endEst = s.arriveTime + shiftLen;
      var barClass = s.isRelief ? 'wb-bar-relief' : (s.craft === 'MH' ? 'wb-bar-mh' : 'wb-bar-reviewer');
      var brkWindows = breakMap[idx] || [];

      // Compute off-DOWs for MH reviewers
      var revOffDows = '';
      if (s.craft === 'MH' && s.mhDaysOff) {
        var _offD = parseDaysOff(s.mhDaysOff);
        revOffDows = _offD.join(',');
      }

      var rowHtml = '<div class="wb-timeline-row" data-tl-type="reviewer" data-tl-craft="' + s.craft + '" data-tl-time="' + s.arriveTime + '" data-tl-name="' + esc(s.label) + '" data-tl-off-dows="' + revOffDows + '">' +
        '<span class="wb-timeline-row-label">' + esc(s.label) + '</span>' +
        '<div class="wb-timeline-bar-bg">';

      if (brkWindows.length > 0) {
        var segments = [];
        var cursor = s.arriveTime;
        brkWindows.forEach(function(w) {
          if (w.start > cursor) segments.push({ start: cursor, end: w.start, type: 'work' });
          segments.push({ start: w.start, end: w.end, type: w.type });
          cursor = w.end;
        });
        if (cursor < endEst) segments.push({ start: cursor, end: endEst, type: 'work' });
        segments.forEach(function(seg) {
          var cls = seg.type === 'work' ? barClass : 'wb-bar-break';
          rowHtml += '<div class="wb-timeline-bar ' + cls + '" style="left:' + pct(seg.start) + '%;width:' + wpct(seg.end - seg.start) + '%;"></div>';
        });
      } else {
        rowHtml += '<div class="wb-timeline-bar ' + barClass + '" style="left:' + pct(s.arriveTime) + '%;width:' + wpct(endEst - s.arriveTime) + '%;"></div>';
      }
      return rowHtml + '</div></div>';
    }

    // Vertical gridlines container wrapping sections
    html += '<div style="position:relative;">';
    // Gridlines (behind bars, aligned with axis ticks)
    html += '<div class="wb-timeline-gridlines" style="left:160px;right:0;">';
    for (var gh = Math.ceil(minTime); gh <= Math.floor(maxTime); gh += tickStep) {
      html += '<div class="wb-timeline-gridline" style="left:' + pct(gh) + '%;"></div>';
    }
    html += '</div>';

    // === REVIEWERS ===
    html += '<div class="wb-timeline-section" id="wb-tl-reviewers">';
    html += '<div class="wb-timeline-section-hdr">Reviewers</div>';
    revIndices.forEach(function(idx) {
      html += renderRevRow(schedSlots[idx], idx);
    });
    html += '</div>';

    // === EMPLOYEES ===
    html += '<div class="wb-timeline-section" id="wb-tl-employees">';
    html += '<div class="wb-timeline-section-hdr">Employees</div>';
    sortedEmps.forEach(function(emp) {
      var barClass = emp.craft === 'MH' ? 'wb-bar-mh' : 'wb-bar-clerk';
      var empOffDows = '';
      if (emp.daysOff) {
        var _empOff = parseDaysOff(emp.daysOff);
        empOffDows = _empOff.join(',');
      }
      html += '<div class="wb-timeline-row" data-tl-type="employee" data-tl-craft="' + emp.craft + '" data-tl-time="' + emp.beginTime + '" data-tl-name="' + esc(emp.name) + '" data-tl-off-dows="' + empOffDows + '">' +
        '<span class="wb-timeline-row-label">' + esc(emp.name) + '</span>' +
        '<div class="wb-timeline-bar-bg">' +
        '<div class="wb-timeline-bar ' + barClass + '" style="left:' + pct(emp.beginTime) + '%;width:' + wpct(emp.endTime - emp.beginTime) + '%;"></div>' +
        '</div></div>';
    });
    html += '</div>';
    html += '</div>'; // close relative gridlines wrapper

    html += '</div>'; // close chart-width div
    html += '</div>'; // close scroll container
    html += '</div>'; // close .wb-sched-timeline
    return html;
  }

  /** Recalculate slot labels (Reviewer N, MH name, Relief tag, off-day flags) */
  function refreshLabels() {
    var officeDates = getOfficeDates();
    var reviewDays = [];
    if (officeDates.startDate && officeDates.endDate) {
      var ds = new Date(officeDates.startDate + 'T00:00:00');
      var de = new Date(officeDates.endDate + 'T00:00:00');
      var cur = new Date(ds);
      while (cur <= de) {
        var dow = cur.getDay();
        if (dow !== 0 && dow !== 6) reviewDays.push({ date: new Date(cur), dow: dow });
        cur.setDate(cur.getDate() + 1);
      }
    }
    var dayAbbrs = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var revNum = 1;
    schedSlots.forEach(function(s) {
      s.mhOffFlag = null;
      s.mhWorksOffDay = null;
      if (s.craft === 'MH' && s.mhName) {
        s.label = 'Reviewer ' + revNum + ' \u2014 ' + s.mhName;
        if (s.mhDaysOff && reviewDays.length > 0) {
          var offDows = parseDaysOff(s.mhDaysOff);
          var offOnReview = [];
          var worksOffFlags = [];
          var tacsWorked = (hasTacsData && mhTacsWorkDows[s.mhName]) ? mhTacsWorkDows[s.mhName] : {};
          reviewDays.forEach(function(rd) {
            if (offDows.indexOf(rd.dow) !== -1) {
              var dayLabel = dayAbbrs[rd.dow] + ' ' + (rd.date.getMonth() + 1) + '/' + rd.date.getDate();
              offOnReview.push(dayLabel);
              if (tacsWorked[rd.dow]) worksOffFlags.push(dayLabel);
            }
          });
          if (offOnReview.length > 0) s.mhOffFlag = offOnReview;
          if (worksOffFlags.length > 0) s.mhWorksOffDay = worksOffFlags;
        }
      } else if (s.craft === 'Relief') {
        s.label = 'Reviewer ' + revNum + ' (Relief)';
      } else {
        s.label = 'Reviewer ' + revNum;
      }
      revNum++;
    });
  }

  function renderSchedule() {
    if (!schedOutputDiv) return;
    if (schedSlots.length === 0) {
      schedOutputDiv.innerHTML = '<p class="empty-state">Click "Build Schedule" to generate recommendations from roster.</p>';
      return;
    }

    // Refresh labels before rendering
    refreshLabels();

    // Review date quick-edit (office-level dates)
    var dateEditHtml = '';
    var officeDatesForEdit = getOfficeDates();
    var officeLbl = officeDatesForEdit.officeName ? ' (' + esc(officeDatesForEdit.officeName) + ')' : '';

    // Get overall review period to constrain date pickers
    var revForDates = null;
    try { revForDates = Reviews.getById(reviewId); } catch(e) {}
    var reviewMin = (revForDates && revForDates.startDate) ? revForDates.startDate : '';
    var reviewMax = (revForDates && revForDates.endDate) ? revForDates.endDate : '';
    var minAttr = reviewMin ? ' min="' + reviewMin + '"' : '';
    var maxAttr = reviewMax ? ' max="' + reviewMax + '"' : '';
    var rangeHint = (reviewMin && reviewMax) ? ' <span style="font-size:0.72rem;color:var(--text-light,#64748b);">(Review period: ' + reviewMin + ' to ' + reviewMax + ')</span>' : '';

    dateEditHtml = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:0.5rem;font-size:0.8rem;flex-wrap:wrap;">' +
      '<label style="font-weight:600;color:var(--text,#1e3a5f);">Review Dates' + officeLbl + ':</label>' +
      '<input type="date" id="wb-sched-start-date" value="' + officeDatesForEdit.startDate + '"' + minAttr + maxAttr + ' style="padding:2px 6px;border:1px solid var(--border,#cbd5e1);border-radius:4px;font-size:0.78rem;background:var(--bg,#fff);color:var(--text,#1e3a5f);">' +
      '<span style="color:var(--text-light,#64748b);">to</span>' +
      '<input type="date" id="wb-sched-end-date" value="' + officeDatesForEdit.endDate + '"' + minAttr + maxAttr + ' style="padding:2px 6px;border:1px solid var(--border,#cbd5e1);border-radius:4px;font-size:0.78rem;background:var(--bg,#fff);color:var(--text,#1e3a5f);">' +
      rangeHint +
      '</div>';

    // Info bar
    var validEmps = schedEmps.filter(function(e) { return e.beginTime !== null; });
    var anyActualBt = schedEmps.some(function(e) { return !!e.usingActualBt; });
    var infoHtml = '';
    if (validEmps.length > 0) {
      var firstStart = Math.min.apply(null, validEmps.map(function(e) { return e.beginTime; }));
      var lastEnd = Math.max.apply(null, validEmps.map(function(e) { return e.endTime; }));
      infoHtml = '<div class="wb-sched-info">' +
        '<span>First employee starts: <strong>' + hundredthsTo12h(firstStart) + '</strong></span>' +
        '<span>Last employee scheduled off: <strong>' + hundredthsTo12h(lastEnd) + '</strong></span>' +
        (anyActualBt ? '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:4px;font-weight:600;font-size:0.78rem;">📍 Using Actual Clock Ring BTs</span>' : '<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:4px;font-size:0.78rem;">Using Bid Start Time</span>') +
        '</div>';
    }

    // Build break map for inline display
    var breakData = computeBreaks();
    var breakByIdx = {};
    breakData.forEach(function(b) { breakByIdx[b.slotIdx] = b.windows; });
    var hasBreaks = breakData.length > 0;

    // Table
    var html = dateEditHtml + infoHtml;

    // Show skipped MH employees banner
    if (mhSkipped.length > 0) {
      html += '<div style="padding:0.5rem 0.75rem;background:rgba(217,119,6,0.08);border:1px solid #f59e0b;border-radius:6px;margin-bottom:0.5rem;font-size:0.82rem;">';
      html += '<strong style="color:#92400e;">\u26a0\ufe0f ' + mhSkipped.length + ' Mail Handler' + (mhSkipped.length > 1 ? 's' : '') + ' excluded</strong> (2+ review days off, not reviewable):';
      html += '<ul style="margin:0.25rem 0 0 1.2rem;padding:0;font-size:0.78rem;">';
      mhSkipped.forEach(function(ms) {
        html += '<li>' + esc(ms.name) + ' — off ' + ms.offDays.join(', ') + '</li>';
      });
      html += '</ul></div>';
    }

    html += '<table class="wb-tacs-table wb-sched-table"><thead><tr>' +
      '<th>Reviewer</th><th>Craft</th><th>Arrive By</th>';
    if (hasBreaks) {
      html += '<th>Break 1 <span style="font-weight:400;font-size:0.6rem;color:var(--text-light);">(sug.)</span></th><th>Lunch <span style="font-weight:400;font-size:0.6rem;color:var(--text-light);">(sug.)</span></th><th>Break 2 <span style="font-weight:400;font-size:0.6rem;color:var(--text-light);">(sug.)</span></th>';
    }
    html += '<th style="width:30px;"></th></tr></thead><tbody>';

    // Sort slots by arrive time (prev-day arrivals first)
    var sortedIndices = schedSlots.map(function(s, i) { return i; });
    sortedIndices.sort(function(a, b) {
      return timelineSortKey(schedSlots[a].arriveTime) - timelineSortKey(schedSlots[b].arriveTime);
    });

    sortedIndices.forEach(function(i) {
      var s = schedSlots[i];
      var brks = breakByIdx[i] || [];
      var labelDisplay = s.label;
      if (s.assignedTo) labelDisplay += ' — ' + s.assignedTo;
      var mhOffHtml = '';
      if (s.mhWorksOffDay && s.mhWorksOffDay.length > 0) {
        mhOffHtml += '<div style="font-size:0.7rem;color:#d97706;font-weight:600;margin-top:2px;">\ud83d\udcc5 Works per TACS: ' + s.mhWorksOffDay.join(', ') + '</div>';
      }
      // Show remaining actual off days (ones NOT worked per TACS)
      if (s.mhOffFlag && s.mhOffFlag.length > 0) {
        var realOffDays = s.mhOffFlag;
        if (s.mhWorksOffDay) {
          realOffDays = s.mhOffFlag.filter(function(d) { return s.mhWorksOffDay.indexOf(d) === -1; });
        }
        if (realOffDays.length > 0) {
          mhOffHtml += '<div style="font-size:0.7rem;color:#dc2626;font-weight:600;margin-top:2px;">\u26A0 Off: ' + realOffDays.join(', ') + '</div>';
        }
      }
      html += '<tr>' +
        '<td class="wb-sched-label">' + esc(labelDisplay) + mhOffHtml + '</td>' +
        '<td><select class="wb-sched-type-sel" data-idx="' + i + '">' +
          '<option value="Clerk"' + (s.craft === 'Clerk' ? ' selected' : '') + '>Clerk</option>' +
          '<option value="MH"' + (s.craft === 'MH' ? ' selected' : '') + '>MH</option>' +
          '<option value="Relief"' + (s.craft === 'Relief' ? ' selected' : '') + '>Relief</option>' +
        '</select></td>' +
        '<td style="white-space:nowrap;">' +
          '<span class="wb-time-adj">' +
            '<button class="wb-time-dec-hr btn btn-sm" data-idx="' + i + '" title="−1 hour">−1h</button>' +
            '<button class="wb-time-dec btn btn-sm" data-idx="' + i + '" title="−5 min">−5</button>' +
          '</span>' +
          '<span class="wb-time-display" style="font-size:0.78rem;font-weight:600;display:inline-block;min-width:68px;text-align:center;">' + formatArriveTime(s.arriveTime) + '</span>' +
          '<span class="wb-time-adj">' +
            '<button class="wb-time-inc btn btn-sm" data-idx="' + i + '" title="+5 min">+5</button>' +
            '<button class="wb-time-inc-hr btn btn-sm" data-idx="' + i + '" title="+1 hour">+1h</button>' +
          '</span>' +
        '</td>';
      if (hasBreaks) {
        if (brks.length >= 3) {
          var suffix = s.isRelief ? ' <em class="wb-sched-own">(own)</em>' : '';
          html += '<td><span class="wb-sched-brk-text">' + hundredthsTo12h(brks[0].start) + ' – ' + hundredthsTo12h(brks[0].end) + suffix + '</span></td>';
          html += '<td><span class="wb-sched-brk-text">' + hundredthsTo12h(brks[1].start) + ' – ' + hundredthsTo12h(brks[1].end) + suffix + '</span></td>';
          html += '<td><span class="wb-sched-brk-text">' + hundredthsTo12h(brks[2].start) + ' – ' + hundredthsTo12h(brks[2].end) + suffix + '</span></td>';
        } else if (s.craft === 'MH') {
          html += '<td class="wb-sched-brk wb-sched-brk-na" colspan="3">Mirrors employee schedule</td>';
        } else {
          html += '<td><span class="wb-sched-brk-text">—</span></td>';
          html += '<td><span class="wb-sched-brk-text">—</span></td>';
          html += '<td><span class="wb-sched-brk-text">—</span></td>';
        }
      }
      html += '<td><button class="wb-sched-del-btn" data-idx="' + i + '">✕</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';

    // Timeline (right below the schedule table)
    try { html += buildTimeline(); } catch(e) { console.error('Timeline error:', e); }

    // Days off awareness
    try { html += buildDaysOffSection(); } catch(e) { console.error('Days off section error:', e); }

    // Clock ring BT adjustments (per day-of-week)
    html += buildClockRingSection();

    schedOutputDiv.innerHTML = html;

    // Wire timeline sort/filter controls
    (function() {
      var sortSel = document.getElementById('wb-timeline-sort');
      var filterSel = document.getElementById('wb-timeline-filter');
      var daySel = document.getElementById('wb-timeline-day');
      var dayInfo = document.getElementById('wb-timeline-day-info');
      if (!sortSel && !filterSel && !daySel) return;

      function applyTimelineControls() {
        var sortBy = sortSel ? sortSel.value : 'time';
        var filterBy = filterSel ? filterSel.value : 'all';
        var dayFilter = daySel ? daySel.value : 'all';
        var revSection = document.getElementById('wb-tl-reviewers');
        var empSection = document.getElementById('wb-tl-employees');
        if (!revSection || !empSection) return;

        // Update day info banner
        if (dayInfo) {
          if (dayFilter !== 'all' && daySel) {
            var selOpt = daySel.options[daySel.selectedIndex];
            dayInfo.style.display = '';
            dayInfo.textContent = 'Showing only employees and reviewers scheduled on ' + selOpt.textContent + '. Off-day employees are hidden.';
          } else {
            dayInfo.style.display = 'none';
          }
        }

        // Show/hide sections based on filter
        revSection.style.display = (filterBy === 'employee') ? 'none' : '';
        empSection.style.display = (filterBy === 'reviewer') ? 'none' : '';

        // Filter rows
        [revSection, empSection].forEach(function(section) {
          var rows = section.querySelectorAll('.wb-timeline-row');
          rows.forEach(function(row) {
            var craft = row.dataset.tlCraft || '';
            var type = row.dataset.tlType || '';
            var offDows = row.dataset.tlOffDows || '';
            var show = true;

            // Craft/type filter
            if (filterBy === 'clerk') show = craft === 'Clerk';
            else if (filterBy === 'mh') show = craft === 'MH';
            else if (filterBy === 'reviewer') show = type === 'reviewer';
            else if (filterBy === 'employee') show = type === 'employee';

            // Day filter — hide rows whose off-dows include the selected day
            if (show && dayFilter !== 'all' && offDows) {
              var offArr = offDows.split(',');
              if (offArr.indexOf(dayFilter) !== -1) show = false;
            }

            row.style.display = show ? '' : 'none';
          });
        });

        // Update section counts
        [revSection, empSection].forEach(function(section) {
          var hdr = section.querySelector('.wb-timeline-section-hdr');
          if (!hdr) return;
          var rows = section.querySelectorAll('.wb-timeline-row');
          var visible = 0;
          rows.forEach(function(r) { if (r.style.display !== 'none') visible++; });
          var label = section.id === 'wb-tl-reviewers' ? 'Reviewers' : 'Employees';
          hdr.textContent = label + ' (' + visible + ')';
        });

        // Sort rows within each section
        [revSection, empSection].forEach(function(section) {
          var rows = Array.prototype.slice.call(section.querySelectorAll('.wb-timeline-row'));
          var hdr = section.querySelector('.wb-timeline-section-hdr');
          rows.sort(function(a, b) {
            if (sortBy === 'name') {
              return (a.dataset.tlName || '').localeCompare(b.dataset.tlName || '');
            } else if (sortBy === 'craft') {
              var ca = a.dataset.tlCraft || '', cb = b.dataset.tlCraft || '';
              if (ca !== cb) return ca.localeCompare(cb);
              return timelineSortKey(parseFloat(a.dataset.tlTime)) - timelineSortKey(parseFloat(b.dataset.tlTime));
            } else {
              return timelineSortKey(parseFloat(a.dataset.tlTime)) - timelineSortKey(parseFloat(b.dataset.tlTime));
            }
          });
          rows.forEach(function(row) { section.appendChild(row); });
        });
      }

      if (sortSel) sortSel.addEventListener('change', applyTimelineControls);
      if (filterSel) filterSel.addEventListener('change', applyTimelineControls);
      if (daySel) daySel.addEventListener('change', applyTimelineControls);

      // Run once to set initial counts
      applyTimelineControls();
    })();

    // Bind review date quick-edit
    var startDateInput = document.getElementById('wb-sched-start-date');
    var endDateInput = document.getElementById('wb-sched-end-date');
    if (startDateInput) {
      startDateInput.addEventListener('change', function() {
        var val = startDateInput.value;
        // Clamp to overall review period
        if (reviewMin && val < reviewMin) { val = reviewMin; startDateInput.value = val; }
        if (reviewMax && val > reviewMax) { val = reviewMax; startDateInput.value = val; }
        // Start can't be after end
        if (endDateInput && endDateInput.value && val > endDateInput.value) {
          endDateInput.value = val;
          updateOfficeDates(val, val);
        } else {
          updateOfficeDates(val, undefined);
        }
        renderSchedule();
      });
    }
    if (endDateInput) {
      endDateInput.addEventListener('change', function() {
        var val = endDateInput.value;
        // Clamp to overall review period
        if (reviewMin && val < reviewMin) { val = reviewMin; endDateInput.value = val; }
        if (reviewMax && val > reviewMax) { val = reviewMax; endDateInput.value = val; }
        // End can't be before start
        if (startDateInput && startDateInput.value && val < startDateInput.value) {
          startDateInput.value = val;
          updateOfficeDates(val, val);
        } else {
          updateOfficeDates(undefined, val);
        }
        renderSchedule();
      });
    }

    // Bind edits
    schedOutputDiv.querySelectorAll('.wb-sched-type-sel').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var idx = parseInt(sel.dataset.idx, 10);
        var slot = schedSlots[idx];
        var oldCraft = slot.craft;
        var newCraft = sel.value;

        if (newCraft === 'MH' && oldCraft !== 'MH') {
          // Build list of available MH employees not already assigned
          var usedMhNames = {};
          schedSlots.forEach(function(s, si) {
            if (si !== idx && s.craft === 'MH' && s.mhName) usedMhNames[s.mhName] = true;
          });
          var availMh = schedEmps.filter(function(e) {
            return e.craft === 'MH' && e.beginTime !== null && !usedMhNames[e.name];
          });

          if (availMh.length === 0) {
            alert('No available Mail Handlers on roster to assign.');
            sel.value = oldCraft;
            return;
          }

          // Show picker inline next to the select
          var picker = document.createElement('div');
          picker.style.cssText = 'position:absolute;z-index:999;background:var(--card-bg,#fff);border:1px solid var(--border,#cbd5e1);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:6px 0;min-width:220px;';
          picker.innerHTML = '<div style="padding:4px 10px;font-size:0.72rem;color:var(--text-light,#64748b);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Select Mail Handler</div>';

          availMh.forEach(function(mh) {
            var opt = document.createElement('div');
            opt.style.cssText = 'padding:6px 10px;font-size:0.82rem;cursor:pointer;';
            opt.textContent = mh.name + ' (BT: ' + hundredthsTo12h(mh.beginTime) + ')';
            opt.addEventListener('mouseenter', function() { opt.style.background = 'var(--hover-bg,#f1f5f9)'; });
            opt.addEventListener('mouseleave', function() { opt.style.background = ''; });
            opt.addEventListener('click', function() {
              slot.craft = 'MH';
              slot.isRelief = false;
              slot.mhName = mh.name;
              slot.mhDaysOff = mh.daysOff || '';
              slot.arriveTime = arrive10Before(mh.beginTime);
              slot.empStartTime = mh.beginTime;
              saveScheduleData();
              picker.remove();
              renderSchedule();
            });
            picker.appendChild(opt);
          });

          // Cancel option
          var cancel = document.createElement('div');
          cancel.style.cssText = 'padding:6px 10px;font-size:0.78rem;cursor:pointer;color:#dc2626;border-top:1px solid var(--border,#e2e8f0);margin-top:4px;';
          cancel.textContent = 'Cancel';
          cancel.addEventListener('click', function() {
            sel.value = oldCraft;
            picker.remove();
          });
          picker.appendChild(cancel);

          // Position relative to the select element
          var cell = sel.closest('td');
          cell.style.position = 'relative';
          picker.style.top = sel.offsetHeight + 'px';
          picker.style.left = '0';
          cell.appendChild(picker);

          // Close on outside click
          setTimeout(function() {
            document.addEventListener('click', function closePicker(e) {
              if (!picker.contains(e.target) && e.target !== sel) {
                sel.value = oldCraft;
                picker.remove();
                document.removeEventListener('click', closePicker);
              }
            });
          }, 0);

          return; // Don't apply change yet — wait for picker selection
        }

        // Non-MH changes
        slot.craft = newCraft;
        if (oldCraft === 'MH') {
          slot.mhName = '';
          slot.mhDaysOff = '';
          slot.mhOffFlag = null;
          slot.mhWorksOffDay = null;
        }
        if (newCraft === 'Relief') {
          slot.isRelief = true;
        } else {
          slot.isRelief = false;
        }

        saveScheduleData();
        renderSchedule();
      });
    });

    function adjustTime(idx, delta) {
      var t = schedSlots[idx].arriveTime + delta;
      if (t < 0) t += 24;
      if (t >= 24) t -= 24;
      schedSlots[idx].arriveTime = round5(t);
      saveScheduleData();
      renderSchedule();
    }
    schedOutputDiv.querySelectorAll('.wb-time-dec').forEach(function(btn) {
      btn.addEventListener('click', function() {
        adjustTime(parseInt(btn.dataset.idx, 10), -5 / 60);
      });
    });
    schedOutputDiv.querySelectorAll('.wb-time-inc').forEach(function(btn) {
      btn.addEventListener('click', function() {
        adjustTime(parseInt(btn.dataset.idx, 10), 5 / 60);
      });
    });
    schedOutputDiv.querySelectorAll('.wb-time-dec-hr').forEach(function(btn) {
      btn.addEventListener('click', function() {
        adjustTime(parseInt(btn.dataset.idx, 10), -1);
      });
    });
    schedOutputDiv.querySelectorAll('.wb-time-inc-hr').forEach(function(btn) {
      btn.addEventListener('click', function() {
        adjustTime(parseInt(btn.dataset.idx, 10), 1);
      });
    });
    schedOutputDiv.querySelectorAll('.wb-sched-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        schedSlots.splice(parseInt(btn.dataset.idx, 10), 1);
        renderSchedule();
        saveScheduleData();
      });
    });

    // Show assign section when schedule is rendered
    if (assignSection) assignSection.style.display = '';
  }

  function addReviewerRow() {
    var lastTime = schedSlots.length > 0 ? schedSlots[schedSlots.length - 1].arriveTime : 6;
    var num = schedSlots.length + 1;
    schedSlots.push({
      label: 'Reviewer ' + num,
      craft: 'Clerk',
      arriveTime: lastTime + 1
    });
    renderSchedule();
    saveScheduleData();
  }

  function saveScheduleData() {
    var data = loadSched();
    data.schedule = schedSlots;
    data.employees = schedEmps;
    saveSched(data);
  }

  if (schedGenerateBtn) {
    schedGenerateBtn.addEventListener('click', generateSchedule);
  }
  if (btToggle) {
    btToggle.addEventListener('change', function() {
      // Re-run schedule build when toggle changes
      generateSchedule();
    });
  }
  if (schedAddRowBtn) {
    schedAddRowBtn.addEventListener('click', addReviewerRow);
  }

  // Reset button — clears all schedule data and UI
  var schedResetBtn = document.getElementById('wb-sched-reset');
  if (schedResetBtn) {
    schedResetBtn.addEventListener('click', function() {
      if (!confirm('Reset the entire schedule? This cannot be undone.')) return;
      localStorage.removeItem(SCHED_KEY);
      schedSlots = [];
      schedEmps = [];
      assignedNames = [];
      if (schedOutputDiv) schedOutputDiv.innerHTML = '';
      if (assignOutput) assignOutput.innerHTML = '';
      if (assignTagsDiv) assignTagsDiv.innerHTML = '';
      if (assignSearchInput) assignSearchInput.value = '';
      if (assignSection) assignSection.style.display = 'none';
      var shareO = document.getElementById('wb-card-review');
      if (shareO) shareO.innerHTML = '';
      var shareO2 = document.getElementById('wb-card-trips');
      if (shareO2) shareO2.innerHTML = '';
      var shareO3 = document.getElementById('wb-card-airport');
      if (shareO3) shareO3.innerHTML = '';
      ['review','trips','airport'].forEach(function(t) {
        ['to','cc','msg'].forEach(function(f) {
          var el = document.getElementById('wb-email-' + t + '-' + f);
          if (el) el.value = '';
        });
      });
    });
  }

  // Restore saved schedule
  var savedSchedData = loadSched();
  if (savedSchedData.schedule && savedSchedData.schedule.length > 0) {
    schedSlots = savedSchedData.schedule;
    schedEmps = savedSchedData.employees || [];
    try { renderSchedule(); } catch(e) { console.error('Schedule restore error:', e); }
  }

  // ===================== ASSIGN REVIEWERS =====================

  var assignSection = document.getElementById('wb-sched-assign');
  var assignSearchInput = document.getElementById('wb-assign-search');
  var assignSearchResults = document.getElementById('wb-assign-search-results');
  var assignAddBtn = document.getElementById('wb-assign-add-btn');
  var assignCreateWrap = document.getElementById('wb-assign-create-wrap');
  var assignOutput = document.getElementById('wb-assign-output');
  var assignTagsDiv = document.getElementById('wb-assign-tags');
  var assignedNames = []; // [{name, hasAccount, userId?}]

  var _assignSelectedUserId = '';
  var _assignSelectedName = '';

  function showAssignSection() {
    // Assign section is now its own tab panel — always visible when tab is active
    // Just trigger rendering of assignments if schedule exists
    if (schedSlots.length > 0) {
      renderAssignments();
    }
  }

  // --- Type-ahead search ---
  // Build a set of reviewer user IDs/names that are busy on overlapping dates
  // Checks ALL reviews and ALL offices for schedule conflicts with the current office
  var _busyReviewerCache = null;
  function getBusyReviewers() {
    if (_busyReviewerCache) return _busyReviewerCache;
    var busy = { byId: {}, byName: {} }; // userId → conflictInfo, name → conflictInfo
    var curDates = getOfficeDates();
    if (!curDates.startDate || !curDates.endDate) { _busyReviewerCache = busy; return busy; }
    var curStart = new Date(curDates.startDate + 'T00:00:00');
    var curEnd = new Date(curDates.endDate + 'T23:59:59');

    var allReviews = [];
    try { allReviews = Reviews.getAll(); } catch(e) {}

    allReviews.forEach(function(rev) {
      if (!rev.offices) return;
      rev.offices.forEach(function(o) {
        // Skip the current office
        if (rev.id === reviewId && o.financeNum === financeNum) return;
        if (!o.startDate || !o.endDate) return;
        var oStart = new Date(o.startDate + 'T00:00:00');
        var oEnd = new Date(o.endDate + 'T23:59:59');
        // Check date overlap
        if (!(curStart <= oEnd && oStart <= curEnd)) return; // no overlap

        // Load that office's schedule to find assigned reviewers
        var schedKey = 'clerk_obs_schedule_' + rev.id + '_' + o.financeNum;
        try {
          var otherData = JSON.parse(localStorage.getItem(schedKey)) || {};
          if (otherData.assignedNames && otherData.assignedNames.length > 0) {
            var conflictLabel = o.officeName + ' (' + o.startDate + '–' + o.endDate + ')';
            otherData.assignedNames.forEach(function(a) {
              if (a.userId) busy.byId[a.userId] = conflictLabel;
              busy.byName[a.name.toLowerCase()] = conflictLabel;
            });
          }
        } catch(e) {}
      });
    });
    _busyReviewerCache = busy;
    return busy;
  }

  // Invalidate cache when assignments change
  function invalidateBusyCache() { _busyReviewerCache = null; }

  if (assignSearchInput) {
    // Build set of already-assigned user IDs and names for filtering
    function getAssignedSet() {
      var byId = {};
      var byName = {};
      assignedNames.forEach(function(a) {
        if (a.userId) byId[a.userId] = true;
        byName[a.name.toLowerCase()] = true;
      });
      return { byId: byId, byName: byName };
    }

    function runAssignSearch() {
      var q = assignSearchInput.value.trim().toLowerCase();
      _assignSelectedUserId = '';
      _assignSelectedName = '';
      var users = Auth.getUsers();
      var assigned = getAssignedSet();
      var busy = getBusyReviewers();
      var qWords = q.split(/\s+/).filter(function(w) { return w.length > 0; });
      var matches = users.filter(function(u) {
        if (reviewLeaderIds[u.id]) return false; // exclude leads/teamleads
        if (assigned.byId[u.id]) return false;   // exclude already assigned
        var name = (u.displayName || '').toLowerCase();
        var email = (u.email || '').toLowerCase();
        // If no query, show all available; otherwise filter by every word
        if (qWords.length === 0) return true;
        return qWords.every(function(w) {
          return name.indexOf(w) !== -1 || email.indexOf(w) !== -1;
        });
      }).slice(0, 20);

      var html = '';
      if (matches.length === 0) {
        html = '<div class="user-search-create" id="wb-assign-create-opt">&#10010; Create new account for &ldquo;' + esc(assignSearchInput.value.trim()) + '&rdquo;</div>';
      } else {
        html = matches.map(function(u) {
          var conflict = busy.byId[u.id] || busy.byName[u.displayName.toLowerCase()] || '';
          if (conflict) {
            return '<div class="user-search-item user-search-item--busy" title="Already assigned at ' + esc(conflict) + '">' +
              esc(u.displayName) + '<em style="color:var(--danger);">⚠ ' + esc(conflict) + '</em></div>';
          }
          return '<div class="user-search-item" data-uid="' + u.id + '" data-name="' + esc(u.displayName) + '">' +
            esc(u.displayName) + '<em>' + esc(u.email || '') + '</em></div>';
        }).join('');
        html += '<div class="user-search-create" id="wb-assign-create-opt">&#10010; Create new account...</div>';
      }
      assignSearchResults.innerHTML = html;
      assignSearchResults.hidden = false;

      // Bind result clicks — immediately add the person (no extra "Add" click needed)
      assignSearchResults.querySelectorAll('.user-search-item').forEach(function(item) {
        item.addEventListener('click', function() {
          _assignSelectedUserId = item.dataset.uid;
          _assignSelectedName = item.dataset.name;
          addSelectedReviewer();
          assignSearchInput.value = '';
          assignSearchInput.focus();
        });
      });
      var createOpt = document.getElementById('wb-assign-create-opt');
      if (createOpt) {
        createOpt.addEventListener('click', function() {
          assignSearchResults.hidden = true;
          if (assignCreateWrap) {
            assignCreateWrap.hidden = false;
            // Pre-fill last name from search text
            var lastInput = document.getElementById('wb-assign-new-last');
            if (lastInput) lastInput.value = assignSearchInput.value.trim();
            // Focus first name field
            var firstInput = document.getElementById('wb-assign-new-first');
            if (firstInput) firstInput.focus();
          }
        });
      }
    }

    assignSearchInput.addEventListener('input', runAssignSearch);
    assignSearchInput.addEventListener('focus', runAssignSearch);
    window._wbAssignSearch = runAssignSearch;

    // Keyboard: Enter selects the first result, Escape closes dropdown
    assignSearchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var first = assignSearchResults.querySelector('.user-search-item');
        if (first) {
          _assignSelectedUserId = first.dataset.uid;
          _assignSelectedName = first.dataset.name;
          addSelectedReviewer();
          assignSearchInput.value = '';
          assignSearchResults.hidden = true;
        }
      } else if (e.key === 'Escape') {
        assignSearchResults.hidden = true;
      }
    });

    // Close results on click outside
    document.addEventListener('click', function(e) {
      if (!assignSearchInput.contains(e.target) && !assignSearchResults.contains(e.target)) {
        assignSearchResults.hidden = true;
      }
    });
  }

  // --- Add button: add selected user to assignedNames ---
  if (assignAddBtn) {
    assignAddBtn.addEventListener('click', function() {
      addSelectedReviewer();
    });
  }

  function addSelectedReviewer() {
    if (!_assignSelectedUserId && !_assignSelectedName) return;
    // Block leads/teamleads from being added as reviewers
    if (_assignSelectedUserId && reviewLeaderIds[_assignSelectedUserId]) {
      alert('This person is already assigned as a Workbook Lead or Review Lead on this review.');
      return;
    }
    // Block reviewers already assigned to an overlapping office/review
    var busy = getBusyReviewers();
    var busyConflict = (_assignSelectedUserId && busy.byId[_assignSelectedUserId]) ||
                       busy.byName[(_assignSelectedName || '').toLowerCase()];
    if (busyConflict) {
      alert(_assignSelectedName + ' is already assigned as a reviewer at ' + busyConflict + ' which overlaps with this office\'s dates.');
      return;
    }
    var name = _assignSelectedName;
    // Check for duplicates
    for (var i = 0; i < assignedNames.length; i++) {
      if (assignedNames[i].name === name) return;
    }
    var user = _assignSelectedUserId ? Auth.getUserById(_assignSelectedUserId) : null;
    assignedNames.push({
      name: name,
      hasAccount: !!user,
      userId: user ? user.id : null,
      userName: user ? user.displayName : null
    });
    assignSearchInput.value = '';
    _assignSelectedUserId = '';
    _assignSelectedName = '';
    saveAssignedNames();
    renderAssignTags();
    renderAssignments();

  }

  // --- Create new account & add ---
  var newCreateBtn = document.getElementById('wb-assign-new-create-btn');
  if (newCreateBtn) {
    newCreateBtn.addEventListener('click', function() {
      var firstInput = document.getElementById('wb-assign-new-first');
      var lastInput = document.getElementById('wb-assign-new-last');
      var emailInput = document.getElementById('wb-assign-new-email');
      var first = firstInput ? firstInput.value.trim() : '';
      var last = lastInput ? lastInput.value.trim() : '';
      var email = emailInput ? emailInput.value.trim() : '';
      if (!first || !last) { alert('Please enter both first and last name.'); return; }
      // Standardize: "LAST, FIRST" with proper casing
      function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
      var displayName = titleCase(last) + ', ' + titleCase(first);
      var pw = (last + ',' + first).toLowerCase().replace(/\s+/g, '');
      var result = Auth.createUser({ displayName: displayName, email: email, password: pw, role: 'reviewer', mustChangePassword: true });
      if (result.error) { alert(result.error); return; }
      // Add to list
      for (var i = 0; i < assignedNames.length; i++) {
        if (assignedNames[i].name === result.displayName) return;
      }
      assignedNames.push({
        name: result.displayName,
        hasAccount: true,
        userId: result.id,
        userName: result.displayName
      });
      if (assignCreateWrap) assignCreateWrap.hidden = true;
      if (firstInput) firstInput.value = '';
      if (lastInput) lastInput.value = '';
      if (emailInput) emailInput.value = '';
      if (assignSearchInput) assignSearchInput.value = '';
      saveAssignedNames();
      renderAssignTags();
      renderAssignments();
    });
  }

  function saveAssignedNames() {
    var data = loadSched();
    data.assignedNames = assignedNames;
    saveSched(data);
    invalidateBusyCache();
  }

  // --- Render tags for assigned reviewers (with remove × buttons) ---
  function renderAssignTags() {
    if (!assignTagsDiv) return;
    var html = '';
    if (assignedNames.length === 0) {
      assignTagsDiv.innerHTML = '';
      return;
    }
    html += assignedNames.map(function(a, idx) {
      var icon = a.hasAccount ? '✓' : '⚠';
      return '<span class="fin-tag">' + icon + ' ' + esc(a.name) +
        ' <button class="fin-tag-x" data-idx="' + idx + '">&times;</button></span>';
    }).join('');
    assignTagsDiv.innerHTML = html;
    assignTagsDiv.querySelectorAll('.fin-tag-x').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.idx, 10);
        // Also clear from any schedule slot that had this person
        var removed = assignedNames[idx];
        schedSlots.forEach(function(s) {
          if (s.assignedTo === removed.name) s.assignedTo = '';
        });
        assignedNames.splice(idx, 1);
        saveAssignedNames();
        saveScheduleData();
        renderAssignTags();
        renderAssignments();

        renderSchedule();
      });
    });
  }

  function renderAssignments() {
    if (!assignOutput || assignedNames.length === 0) {
      if (assignOutput) assignOutput.innerHTML = '';
      return;
    }

    var html = '';

    // Assignment dropdowns on schedule rows
    if (schedSlots.length > 0) {
      html += '<div style="display:flex;align-items:center;gap:0.75rem;margin:0.6rem 0 0.2rem;">';
      html += '<h4 style="font-size:0.82rem;margin:0;">Assign to Schedule</h4>';
      if (assignedNames.length > 0) {
        html += '<button id="wb-auto-assign-btn" class="btn btn-outline btn-sm" style="font-size:0.72rem;">🎲 Auto Assign</button>';
      }
      html += '</div>';
      html += '<table class="wb-tacs-table" style="max-width:500px;"><thead><tr><th>Slot</th><th style="width:70px;">Arrive</th><th>Assigned To</th></tr></thead><tbody>';
      schedSlots.forEach(function(s, i) {
        var taken = {};
        schedSlots.forEach(function(other, j) {
          if (j !== i && other.assignedTo) taken[other.assignedTo] = true;
        });
        var timeStr = s.arriveTime != null ? formatArriveTime(s.arriveTime) : '—';
        html += '<tr><td style="font-size:0.75rem;white-space:nowrap;">' + esc(s.label) + '</td>';
        html += '<td style="font-size:0.75rem;color:var(--text-light);white-space:nowrap;">' + timeStr + '</td>';
        html += '<td><select class="wb-assign-sel wb-sched-type-sel" data-idx="' + i + '">';
        html += '<option value="">— Select —</option>';
        assignedNames.forEach(function(a) {
          if (taken[a.name]) return;
          var sel = (s.assignedTo === a.name) ? ' selected' : '';
          var warn = a.hasAccount ? '' : ' ⚠';
          html += '<option value="' + esc(a.name) + '"' + sel + '>' + esc(a.name) + warn + '</option>';
        });
        html += '</select></td></tr>';
      });
      html += '</tbody></table>';
    }

    // Daily Trips section
    html += buildDailyTrips();

    assignOutput.innerHTML = html;

    // Bind assignment dropdowns
    assignOutput.querySelectorAll('.wb-assign-sel').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var idx = parseInt(sel.dataset.idx, 10);
        var newName = sel.value;
        var oldKey = 'slot_' + idx;

        // Migrate daySkips from slot_X key to assignedTo name
        var data = loadSched();
        if (data.daySkips && newName) {
          var keys = Object.keys(data.daySkips);
          keys.forEach(function(k) {
            if (k.indexOf(oldKey + '_') === 0) {
              var datePart = k.slice(oldKey.length + 1);
              data.daySkips[newName + '_' + datePart] = true;
              delete data.daySkips[k];
            }
          });
          saveSched(data);
        }

        schedSlots[idx].assignedTo = newName;
        saveScheduleData();
        // Re-render main schedule to reflect assignment
        renderSchedule();
        // Re-render assignment dropdowns to update available names
        renderAssignments();
      });
    });

    // Auto Assign button — randomly distribute reviewers across slots
    var autoAssignBtn = document.getElementById('wb-auto-assign-btn');
    if (autoAssignBtn) {
      autoAssignBtn.addEventListener('click', function() {
        var slots = schedSlots.length;
        var reviewers = assignedNames.length;
        if (reviewers > slots) {
          alert('You have ' + reviewers + ' reviewers but only ' + slots + ' schedule slots. ' + (reviewers - slots) + ' reviewer(s) will not be assigned.');
        }
        // Shuffle assignedNames randomly (Fisher-Yates)
        var pool = assignedNames.slice();
        for (var i = pool.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
        }
        // Clear all existing assignments
        schedSlots.forEach(function(s) { s.assignedTo = ''; });
        // Assign from the shuffled pool
        var poolIdx = 0;
        schedSlots.forEach(function(s) {
          if (poolIdx < pool.length) {
            s.assignedTo = pool[poolIdx].name;
            poolIdx++;
          }
        });
        saveScheduleData();
        renderSchedule();
        renderAssignments();
      });
    }

    // Bind daily trip mode radio buttons
    assignOutput.querySelectorAll('.wb-trip-mode').forEach(function(radio) {
      radio.addEventListener('change', function() {
        var data = loadSched();
        if (!data.dailyTrips) data.dailyTrips = {};
        data.dailyTrips[radio.dataset.key] = radio.value;
        saveSched(data);
      });
    });
  }

  // Restore saved assignments
  if (savedSchedData.assignedNames && savedSchedData.assignedNames.length > 0) {
    assignedNames = savedSchedData.assignedNames;
    renderAssignTags();
    renderAssignments();

  }

  // --- Import reviewers from other offices (if dates don't overlap) ---
  /** Auto-assign imported reviewers to schedule slots by closest arrive time.
   *  Uses the source office schedule to find each reviewer's previous arrive time,
   *  then greedily assigns them to the closest unassigned slot. */
  function autoAssignReviewers(srcFinanceNum) {
    if (schedSlots.length === 0 || assignedNames.length === 0) return;

    // Load source office schedule to get previous arrive times
    var prevSlots = [];
    if (srcFinanceNum) {
      var srcKey = 'clerk_obs_schedule_' + reviewId + '_' + srcFinanceNum;
      try {
        var srcData = JSON.parse(localStorage.getItem(srcKey)) || {};
        prevSlots = srcData.schedule || [];
      } catch(e) {}
    }

    // Build map: reviewer name → previous arrive time
    var prevTimeByName = {};
    prevSlots.forEach(function(s) {
      if (s.assignedTo && s.arriveTime != null) {
        prevTimeByName[s.assignedTo] = s.arriveTime;
      }
    });

    // Build list of reviewers to assign, sorted by those with known times first
    var toAssign = assignedNames.map(function(a) {
      return { name: a.name, prevTime: prevTimeByName[a.name] };
    });
    // Those with known previous times get assigned first
    toAssign.sort(function(a, b) {
      if (a.prevTime != null && b.prevTime == null) return -1;
      if (a.prevTime == null && b.prevTime != null) return 1;
      return 0;
    });

    var usedSlots = {};
    toAssign.forEach(function(rev) {
      // Find closest unassigned slot
      var bestIdx = -1;
      var bestDist = Infinity;
      schedSlots.forEach(function(s, i) {
        if (usedSlots[i] || s.assignedTo) return;
        var dist;
        if (rev.prevTime != null) {
          dist = Math.abs(s.arriveTime - rev.prevTime);
        } else {
          // No previous time — assign to first available slot
          dist = i;
        }
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      });
      if (bestIdx >= 0) {
        schedSlots[bestIdx].assignedTo = rev.name;
        usedSlots[bestIdx] = true;
      }
    });

    saveScheduleData();
    renderSchedule();
    renderAssignments();
  }

  function checkImportableReviewers() {
    if (assignedNames.length > 0) return; // already has reviewers, skip
    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    if (!rev || !rev.offices || rev.offices.length < 2) return;

    // Find current office dates
    var currentOffice = null;
    for (var i = 0; i < rev.offices.length; i++) {
      if (rev.offices[i].financeNum === financeNum) { currentOffice = rev.offices[i]; break; }
    }
    var curStart = currentOffice && currentOffice.startDate ? new Date(currentOffice.startDate + 'T00:00:00') : null;
    var curEnd = currentOffice && currentOffice.endDate ? new Date(currentOffice.endDate + 'T23:59:59') : null;

    // Check other offices — only import from offices whose dates don't overlap
    var importable = [];
    rev.offices.forEach(function(o) {
      if (o.financeNum === financeNum) return;
      var oStart = o.startDate ? new Date(o.startDate + 'T00:00:00') : null;
      var oEnd = o.endDate ? new Date(o.endDate + 'T23:59:59') : null;
      // Overlap check: two ranges overlap if start1 <= end2 AND start2 <= end1
      if (curStart && curEnd && oStart && oEnd) {
        if (curStart <= oEnd && oStart <= curEnd) return; // dates overlap — skip
      }
      var otherKey = 'clerk_obs_schedule_' + reviewId + '_' + o.financeNum;
      try {
        var otherData = JSON.parse(localStorage.getItem(otherKey)) || {};
        if (otherData.assignedNames && otherData.assignedNames.length > 0) {
          importable.push({ office: o, names: otherData.assignedNames });
        }
      } catch(e) {}
    });

    if (importable.length === 0) return;

    // Show import option in the assign section
    var importHtml = '<div id="wb-assign-import" style="margin-bottom:0.75rem;padding:0.6rem;border:1px solid var(--accent);border-radius:var(--radius);background:var(--card-bg);">';
    importable.forEach(function(imp) {
      var nameList = imp.names.map(function(a) { return esc(a.name); }).join(', ');
      importHtml += '<p style="font-size:0.82rem;margin:0 0 0.4rem;">Reviewers from <strong>' + esc(imp.office.officeName) +
        '</strong> (' + esc(imp.office.startDate) + ' – ' + esc(imp.office.endDate) + ') are available:</p>' +
        '<p style="font-size:0.78rem;color:var(--text-light);margin:0 0 0.4rem;">' + nameList + '</p>' +
        '<button class="btn btn-primary btn-sm wb-import-reviewers-btn" data-fin="' + esc(imp.office.financeNum) + '">Import Reviewers</button>';
    });
    importHtml += '</div>';

    if (assignTagsDiv) {
      assignTagsDiv.insertAdjacentHTML('beforebegin', importHtml);
    }

    document.querySelectorAll('.wb-import-reviewers-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var srcFin = btn.dataset.fin;
        var src = importable.filter(function(imp) { return imp.office.financeNum === srcFin; })[0];
        if (!src) return;
        // Import — re-validate accounts
        var users = Auth.getUsers();
        src.names.forEach(function(a) {
          // Skip duplicates
          for (var j = 0; j < assignedNames.length; j++) {
            if (assignedNames[j].name === a.name) return;
          }
          // Re-check account status
          var match = null;
          for (var k = 0; k < users.length; k++) {
            if (users[k].id === a.userId) { match = users[k]; break; }
          }
          assignedNames.push({
            name: a.name,
            hasAccount: !!match,
            userId: match ? match.id : a.userId,
            userName: match ? match.displayName : a.userName
          });
        });
        saveAssignedNames();
        renderAssignTags();
        renderAssignments();

        // Auto-assign to closest schedule slots based on previous arrive times
        autoAssignReviewers(srcFin);

        // Remove the import banner
        var importDiv = document.getElementById('wb-assign-import');
        if (importDiv) importDiv.remove();
      });
    });
  }
  checkImportableReviewers();

  // Show assign section if schedule exists
  showAssignSection();

  // ===================== SHARE SCHEDULE =====================

  var shareSection = document.getElementById('wb-panel-email');
  var shareTypeSelect = document.getElementById('wb-share-type');

  // Three email sections
  var emailSections = {
    review: {
      wrap: document.getElementById('wb-email-review'),
      card: document.getElementById('wb-card-review'),
      to: document.getElementById('wb-email-review-to'),
      cc: document.getElementById('wb-email-review-cc'),
      msg: document.getElementById('wb-email-review-msg'),
      send: document.getElementById('wb-email-review-send'),
      subjectSuffix: 'Schedule',
      savedKey: 'emailReview'
    },
    trips: {
      wrap: document.getElementById('wb-email-trips'),
      card: document.getElementById('wb-card-trips'),
      to: document.getElementById('wb-email-trips-to'),
      cc: document.getElementById('wb-email-trips-cc'),
      msg: document.getElementById('wb-email-trips-msg'),
      send: document.getElementById('wb-email-trips-send'),
      subjectSuffix: 'Daily Trips',
      savedKey: 'emailTrips'
    },
    airport: {
      wrap: document.getElementById('wb-email-airport'),
      card: document.getElementById('wb-card-airport'),
      to: document.getElementById('wb-email-airport-to'),
      cc: document.getElementById('wb-email-airport-cc'),
      msg: document.getElementById('wb-email-airport-msg'),
      send: document.getElementById('wb-email-airport-send'),
      subjectSuffix: 'Airport Schedule',
      savedKey: 'emailAirport'
    }
  };

  var linkReviewsDiv = document.getElementById('wb-link-reviews');

  // Trip: array of linked review IDs (current review is always first)
  var tripReviews = [];

  function loadTrip() {
    var data = loadSched();
    tripReviews = [reviewId];
    if (data.linkedReviews && data.linkedReviews.length > 0) {
      data.linkedReviews.forEach(function(rid) {
        if (rid !== reviewId && tripReviews.indexOf(rid) === -1) tripReviews.push(rid);
      });
    }
  }
  function saveTrip() {
    var data = loadSched();
    data.linkedReviews = tripReviews.filter(function(r) { return r !== reviewId; });
    saveSched(data);
  }

  /** Build the full trip schedule: array of { date, type, office, reviewId, travelDir } */
  function buildTripDays() {
    var segments = [];
    var overallStart = null;
    var overallEnd = null;

    tripReviews.forEach(function(rid) {
      var rev = null;
      try { rev = Reviews.getById(rid); } catch(e) {}
      if (!rev) return;

      if (rev.startDate) {
        var rs = new Date(rev.startDate + 'T00:00:00');
        if (!overallStart || rs < overallStart) overallStart = rs;
      }
      if (rev.endDate) {
        var re = new Date(rev.endDate + 'T00:00:00');
        if (!overallEnd || re > overallEnd) overallEnd = re;
      }

      var offices = (rev.offices && rev.offices.length > 0) ? rev.offices : [];
      if (offices.length === 0 && rev.startDate && rev.endDate) {
        segments.push({
          reviewId: rid,
          office: rev.officeName || 'TBD',
          fin: rev.financeNum || '',
          start: new Date(rev.startDate + 'T00:00:00'),
          end: new Date(rev.endDate + 'T00:00:00')
        });
      } else {
        offices.forEach(function(o) {
          if (!o.startDate || !o.endDate) return;
          segments.push({
            reviewId: rid,
            office: o.officeName || 'TBD',
            fin: o.financeNum || '',
            start: new Date(o.startDate + 'T00:00:00'),
            end: new Date(o.endDate + 'T00:00:00')
          });
        });
      }
    });

    segments.sort(function(a, b) { return a.start - b.start; });

    var days = [];

    // Review start date = travel arrive, review end date = travel depart
    // (the overall review period includes travel on first & last day)
    var arriveStr = overallStart ? overallStart.toDateString() : '';
    var departStr = overallEnd ? overallEnd.toDateString() : '';

    // Travel arrive day
    if (overallStart) {
      days.push({ date: new Date(overallStart), type: 'travel', travelDir: 'arrive', office: '', label: 'Travel', reviewId: null });
    }

    // Review days from each segment (skip days that are the travel arrive/depart dates)
    segments.forEach(function(seg) {
      var d = new Date(seg.start);
      var dayNum = 1;
      while (d <= seg.end) {
        var dStr = d.toDateString();
        // Skip weekends and skip the overall travel arrive/depart days
        if (d.getDay() !== 0 && d.getDay() !== 6 && dStr !== arriveStr && dStr !== departStr) {
          days.push({ date: new Date(d), type: 'review', office: seg.office, fin: seg.fin, label: seg.office, reviewId: seg.reviewId, dayNum: dayNum });
          dayNum++;
        }
        d.setDate(d.getDate() + 1);
      }
    });

    // Travel depart day
    if (overallEnd && departStr !== arriveStr) {
      days.push({ date: new Date(overallEnd), type: 'travel', travelDir: 'depart', office: '', label: 'Travel', reviewId: null });
    }

    return days;
  }

  function formatDateCol(d) {
    var dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    return dayNames[d.getDay()] + '<br>' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function formatDateColPlain(d) {
    var dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    return dayNames[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function formatDateRange(days) {
    if (days.length === 0) return '';
    var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var first = days[0].date, last = days[days.length - 1].date;
    if (first.getMonth() === last.getMonth()) {
      return monthNames[first.getMonth()] + ' ' + first.getDate() + ' – ' + last.getDate() + ', ' + first.getFullYear();
    }
    return monthNames[first.getMonth()] + ' ' + first.getDate() + ' – ' + monthNames[last.getMonth()] + ' ' + last.getDate() + ', ' + first.getFullYear();
  }

  function getSlotAssignment(slot) {
    if (slot.craft === 'MH' && slot.mhName) return slot.mhName;
    if (slot.craft === 'Relief') return 'Break/Lunch Relief';
    return 'Clerk Observations';
  }

  function getSlotRole(slot) {
    if (slot.craft === 'MH') return 'MH Reviewer';
    if (slot.craft === 'Relief') return 'Relief';
    return 'Clerk Reviewer';
  }

  /** Get leadership (workbook leads / team leads) from review assignments + Auth */
  function getLeadership() {
    var leaders = [];
    var users = [];
    try { users = Auth.getUsers(); } catch(e) {}

    // Check all trip reviews for lead/teamlead roles
    tripReviews.forEach(function(rid) {
      var rev = null;
      try { rev = Reviews.getById(rid); } catch(e) {}
      if (!rev || !rev.assignments) return;

      // Get offices for this review
      var revOffices = (rev.offices && rev.offices.length > 0) ? rev.offices :
        (rev.officeName ? [{ officeName: rev.officeName, financeNum: rev.financeNum || '', startDate: rev.startDate, endDate: rev.endDate }] : []);

      rev.assignments.forEach(function(a) {
        if (a.reviewRole === 'lead' || a.reviewRole === 'teamlead') {
          // Find user display name
          var user = null;
          for (var i = 0; i < users.length; i++) {
            if (users[i].id === a.userId) { user = users[i]; break; }
          }
          var name = user ? (user.displayName || user.username) : a.userId;
          var role = a.reviewRole === 'teamlead' ? 'Review Lead' : 'Workbook Lead';
          // Find or create leader entry
          var existing = null;
          for (var j = 0; j < leaders.length; j++) {
            if (leaders[j].name === name && leaders[j].role === role) { existing = leaders[j]; break; }
          }
          if (!existing) {
            existing = { name: name, role: role, offices: [] };
            leaders.push(existing);
          }
          // Add offices from this review to the leader
          revOffices.forEach(function(ro) {
            var alreadyHas = existing.offices.some(function(o) { return o.officeName === ro.officeName; });
            if (!alreadyHas) {
              existing.offices.push({
                officeName: ro.officeName || 'TBD',
                officeStart: ro.startDate ? new Date(ro.startDate + 'T00:00:00') : null,
                officeEnd: ro.endDate ? new Date(ro.endDate + 'T00:00:00') : null
              });
            }
          });
        }
      });
    });

    // Also check Auth users with role 'lead' or 'teamlead' who are in assignedNames
    if (leaders.length === 0) {
      // Fallback: check users with matching roles
      users.forEach(function(u) {
        if (u.role === 'teamlead' || u.role === 'lead') {
          var inAssigned = assignedNames.some(function(a) { return a.userId === u.id; });
          if (inAssigned) {
            var role = u.role === 'teamlead' ? 'Review Lead' : 'Workbook Lead';
            leaders.push({ name: u.displayName || u.username, role: role, offices: [] });
          }
        }
      });
    }

    // Sort: Review Lead first, then Workbook Lead
    leaders.sort(function(a, b) {
      if (a.role === b.role) return a.name.localeCompare(b.name);
      return a.role === 'Review Lead' ? -1 : 1;
    });

    return leaders;
  }

  /** Load travel plan data for the current review */
  function loadTravelPlan() {
    var key = 'clerk_obs_travel_survey_' + reviewId;
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch(e) { return {}; }
  }

  /** Get per-reviewer travel group info: { reviewerName: { pickupGroup, pickupTime, dropoffGroup, dropoffTime } } */
  function getReviewerTravelMap(travelData) {
    var map = {};
    if (!travelData) return map;
    var responses = travelData.responses || {};
    var assignments = travelData.assignments || [];
    var pickupPlan = travelData.pickupPlan || {};
    var dropoffPlan = travelData.dropoffPlan || {};
    var pickupTimes = travelData.pickupTimes || {};
    var dropoffTimes = travelData.dropoffTimes || {};

    // Build uid→name from assignments
    var uidToName = {};
    assignments.forEach(function(a) { uidToName[a.userId] = a.name; });

    Object.keys(responses).forEach(function(uid) {
      var resp = responses[uid];
      if (!resp) return;
      var name = uidToName[uid] || uid;
      var pGk = pickupPlan[uid] || '';
      var dGk = dropoffPlan[uid] || '';
      var entry = {
        mode: resp.mode || '',
        pickupGroup: pGk ? (pGk.indexOf('uber') === 0 ? 'Uber' : 'Driver') : '',
        pickupTime: pGk ? (pickupTimes[pGk] || '') : '',
        dropoffGroup: dGk ? (dGk.indexOf('uber') === 0 ? 'Uber' : 'Driver') : '',
        dropoffTime: dGk ? (dropoffTimes[dGk] || '') : '',
        arriveDate: '',
        arriveTime: '',
        departDate: '',
        departTime: ''
      };
      if (resp.arrival) {
        entry.arriveDate = resp.arrival.date || '';
        entry.arriveTime = resp.arrival.time || '';
      }
      if (resp.departure) {
        entry.departDate = resp.departure.date || '';
        entry.departTime = resp.departure.time || '';
      }
      map[name] = entry;
    });
    return map;
  }

  /** Load schedule slots from ALL offices across all trip reviews */
  function loadAllOfficeSchedules() {
    var allSlots = []; // { name, craft, mhName, mhDaysOff, arriveTime, officeName, officeFin, officeStart, officeEnd }
    var seen = {}; // track unique reviewer+office combos

    tripReviews.forEach(function(rid) {
      var rev = null;
      try { rev = Reviews.getById(rid); } catch(e) {}
      if (!rev) return;

      var offices = (rev.offices && rev.offices.length > 0) ? rev.offices : [];
      if (offices.length === 0) {
        offices = [{ officeName: rev.officeName || 'TBD', financeNum: rev.financeNum || '', startDate: rev.startDate, endDate: rev.endDate }];
      }

      offices.forEach(function(o) {
        var fin = o.financeNum || '';
        var key = 'clerk_obs_schedule_' + rid + (fin ? '_' + fin : '');
        var data = {};
        try { data = JSON.parse(localStorage.getItem(key)) || {}; } catch(e) {}
        var slots = data.schedule || [];
        slots.forEach(function(s) {
          if (!s.assignedTo) return;
          var comboKey = s.assignedTo + '|' + (o.officeName || '');
          if (seen[comboKey]) return;
          seen[comboKey] = true;
          allSlots.push({
            name: s.assignedTo,
            craft: s.craft || 'Clerk',
            mhName: s.mhName || '',
            mhDaysOff: s.mhDaysOff || '',
            arriveTime: s.arriveTime,
            officeName: o.officeName || 'TBD',
            officeFin: fin,
            officeStart: o.startDate ? new Date(o.startDate + 'T00:00:00') : null,
            officeEnd: o.endDate ? new Date(o.endDate + 'T00:00:00') : null
          });
        });
      });
    });

    return allSlots;
  }

  /** Build unified reviewer list from all offices */
  function buildReviewerRoster(allSlots) {
    var reviewerMap = {}; // name → { name, craft, mhName, mhDaysOff, offices: [{ officeName, arriveTime, officeStart, officeEnd, craft }] }
    allSlots.forEach(function(s) {
      if (!reviewerMap[s.name]) {
        reviewerMap[s.name] = {
          name: s.name,
          craft: s.craft,
          mhName: s.mhName,
          mhDaysOff: s.mhDaysOff,
          offices: []
        };
      }
      reviewerMap[s.name].offices.push({
        officeName: s.officeName,
        arriveTime: s.arriveTime,
        officeStart: s.officeStart,
        officeEnd: s.officeEnd,
        craft: s.craft || 'Clerk',
        mhName: s.mhName || ''
      });
    });

    var roster = [];
    Object.keys(reviewerMap).forEach(function(name) { roster.push(reviewerMap[name]); });
    // Sort: MH first, then by first office start
    roster.sort(function(a, b) {
      if (a.craft === 'MH' && b.craft !== 'MH') return -1;
      if (b.craft === 'MH' && a.craft !== 'MH') return 1;
      var aStart = a.offices[0] && a.offices[0].officeStart ? a.offices[0].officeStart.getTime() : 0;
      var bStart = b.offices[0] && b.offices[0].officeStart ? b.offices[0].officeStart.getTime() : 0;
      return aStart - bStart || (a.offices[0] ? a.offices[0].arriveTime : 0) - (b.offices[0] ? b.offices[0].arriveTime : 0);
    });
    return roster;
  }

  /** Check if a reviewer is at a specific office on a given date */
  function getReviewerDayInfo(reviewer, tripDay) {
    for (var i = 0; i < reviewer.offices.length; i++) {
      var ro = reviewer.offices[i];
      if (ro.officeName === tripDay.office && ro.officeStart && ro.officeEnd) {
        if (tripDay.date >= ro.officeStart && tripDay.date <= ro.officeEnd) {
          return { active: true, arriveTime: ro.arriveTime, officeName: ro.officeName, craft: ro.craft || 'Clerk', mhName: ro.mhName || '' };
        }
      }
    }
    return { active: false };
  }

  /** Check if a reviewer is at ANY office on a given date (regardless of column office) */
  function getReviewerDateMatch(reviewer, date) {
    for (var i = 0; i < reviewer.offices.length; i++) {
      var ro = reviewer.offices[i];
      if (ro.officeStart && ro.officeEnd && date >= ro.officeStart && date <= ro.officeEnd) {
        return { active: true, arriveTime: ro.arriveTime, officeName: ro.officeName, craft: ro.craft || 'Clerk', mhName: ro.mhName || '' };
      }
    }
    return { active: false };
  }

  /** Get the earliest office start and latest office end for a reviewer */
  function getReviewerDateRange(reviewer) {
    var earliest = null, latest = null;
    reviewer.offices.forEach(function(o) {
      if (o.officeStart && (!earliest || o.officeStart < earliest)) earliest = o.officeStart;
      if (o.officeEnd && (!latest || o.officeEnd > latest)) latest = o.officeEnd;
    });
    return { start: earliest, end: latest };
  }

  /** Get a reviewer's travel day — matches the overall review start (arrive) and end (depart) dates */
  function getReviewerTravelDate(rev, travelMap, direction) {
    // Travel days are the review start/end dates themselves
    // Find the overall review period from tripReviews
    var travelDate = null;
    tripReviews.forEach(function(rid) {
      var r = null;
      try { r = Reviews.getById(rid); } catch(e) {}
      if (!r) return;
      if (direction === 'arrive' && r.startDate) {
        var d = new Date(r.startDate + 'T00:00:00');
        if (!travelDate || d < travelDate) travelDate = d;
      } else if (direction === 'depart' && r.endDate) {
        var d = new Date(r.endDate + 'T00:00:00');
        if (!travelDate || d > travelDate) travelDate = d;
      }
    });
    return travelDate;
  }

  /** Split tripDays into weekly chunks (Mon-Fri groupings) */
  function splitIntoWeeks(tripDays) {
    if (tripDays.length === 0) return [];

    // Build a map of existing trip days by date string
    var dayMap = {};
    tripDays.forEach(function(td) { dayMap[td.date.toDateString()] = td; });

    // Find the Sunday of the first day's week and Saturday of the last day's week
    var first = new Date(tripDays[0].date);
    var last = new Date(tripDays[tripDays.length - 1].date);
    var weekStart = new Date(first);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // back to Sunday
    var weekEnd = new Date(last);
    weekEnd.setDate(weekEnd.getDate() + (6 - weekEnd.getDay())); // forward to Saturday

    // Build full weeks Sun-Sat
    var weeks = [];
    var currentWeek = [];
    var d = new Date(weekStart);
    while (d <= weekEnd) {
      var existing = dayMap[d.toDateString()];
      if (existing) {
        currentWeek.push(existing);
      } else {
        currentWeek.push({ date: new Date(d), type: 'empty', office: '', label: '—', reviewId: null });
      }
      if (d.getDay() === 6) { // Saturday = end of week
        weeks.push(currentWeek);
        currentWeek = [];
      }
      d.setDate(d.getDate() + 1);
    }
    if (currentWeek.length > 0) weeks.push(currentWeek);
    return weeks;
  }

  function buildScheduleCard() {
    var tripDays = buildTripDays();
    var allSlots = loadAllOfficeSchedules();
    var roster = buildReviewerRoster(allSlots);
    if (roster.length === 0) return '';

    var leaders = getLeadership();
    var travelData = loadTravelPlan();
    var travelMap = getReviewerTravelMap(travelData);

    // Get all unique offices
    var offices = [];
    tripReviews.forEach(function(rid) {
      var rev = null;
      try { rev = Reviews.getById(rid); } catch(e) {}
      if (rev) {
        var revOffices = (rev.offices && rev.offices.length > 0) ? rev.offices : (rev.officeName ? [{ officeName: rev.officeName, financeNum: rev.financeNum || '' }] : []);
        revOffices.forEach(function(ro) {
          var exists = offices.some(function(o) { return o.name === ro.officeName; });
          if (!exists) offices.push({ name: ro.officeName, fin: ro.financeNum || '' });
        });
      }
    });
    var officeStr = offices.map(function(o) { return o.name + (o.fin ? ' (FIN ' + o.fin + ')' : ''); }).join('  •  ');

    // Get review name for card title
    var reviewName = '';
    try { reviewName = Reviews.getById(tripReviews[0]).name || ''; } catch(e) {}

    // Load day-by-day adjustments (daySkips)
    var schedData = loadSched();
    var daySkips = schedData.daySkips || {};

    // Split into weeks (full Sun-Sat view)
    var weeks = splitIntoWeeks(tripDays);
    var multiWeek = weeks.length > 1;
    var result = '';

    weeks.forEach(function(weekDays, weekIdx) {
      result += buildWeekCard(weekDays, weekIdx, multiWeek, roster, leaders, travelMap, offices, officeStr, tripDays, reviewName, daySkips);
    });

    return result;
  }

  /** Build one week's schedule card — split by craft group */
  function buildWeekCard(weekDays, weekIdx, multiWeek, roster, leaders, travelMap, offices, officeStr, allTripDays, reviewName, daySkips) {
    // Split roster into craft groups
    var clerkRelief = roster.filter(function(r) { return r.craft !== 'MH'; });
    var mhOnly = roster.filter(function(r) { return r.craft === 'MH'; });

    var h = '';
    // Clerk & Relief card (includes leadership)
    if (clerkRelief.length > 0 || leaders.length > 0) {
      h += buildCraftCard(weekDays, weekIdx, multiWeek, clerkRelief, leaders, travelMap, offices, reviewName, 'Clerk & Relief Reviewers', '#1e3a5f', '#2563eb');
    }
    // MH card
    if (mhOnly.length > 0) {
      h += buildCraftCard(weekDays, weekIdx, multiWeek, mhOnly, [], travelMap, offices, reviewName, 'MH Reviewers', '#78350f', '#f59e0b');
    }
    return h;
  }

  function buildCraftCard(weekDays, weekIdx, multiWeek, craftRoster, leaders, travelMap, offices, reviewName, groupLabel, gradStart, gradEnd) {
    // Build office color map for multi-office reviews — bold, distinct colors
    var officeColors = {};
    var colorPalette = [
      { bg: '#dbeafe', text: '#1e3a8a', label: '#1e40af', border: '#3b82f6' },  // bold blue
      { bg: '#fde68a', text: '#78350f', label: '#92400e', border: '#f59e0b' },  // bold amber/yellow
      { bg: '#bbf7d0', text: '#14532d', label: '#15803d', border: '#22c55e' },  // bold green
      { bg: '#fbcfe8', text: '#831843', label: '#be185d', border: '#ec4899' },  // bold pink
      { bg: '#c4b5fd', text: '#4c1d95', label: '#6d28d9', border: '#8b5cf6' },  // bold purple
    ];
    offices.forEach(function(o, i) {
      officeColors[o.name] = colorPalette[i % colorPalette.length];
    });
    var h = '';
    h += '<div style="background:#fff;border-radius:6px;border:1px solid #d1d5db;overflow:hidden;max-width:800px;font-family:Segoe UI,Arial,sans-serif;color:#1e293b;margin-top:10px;">';

    // Header banner
    h += '<div style="background:linear-gradient(135deg,' + gradStart + ' 0%,' + gradEnd + ' 100%);padding:8px 12px;">';
    var title = reviewName || 'Clerk Observation Review';
    if (multiWeek) title += ' — Week ' + (weekIdx + 1);
    h += '<div style="font-size:13px;font-weight:700;color:#fff;">' + esc(title) + '</div>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;">';
    h += '<span style="font-size:10px;color:rgba(255,255,255,0.85);">' + formatDateRange(weekDays) + '</span>';
    h += '<span style="font-size:9px;font-weight:600;color:rgba(255,255,255,0.95);background:rgba(255,255,255,0.15);padding:1px 6px;border-radius:3px;">' + esc(groupLabel) + '</span>';
    h += '</div>';
    if (leaders.length > 0) {
      h += '<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.2);display:flex;gap:12px;flex-wrap:wrap;">';
      leaders.forEach(function(l) {
        h += '<div style="font-size:9px;color:rgba(255,255,255,0.9);">';
        h += '<span style="opacity:0.7;text-transform:uppercase;letter-spacing:0.5px;font-size:8px;">' + esc(l.role) + ':</span> ';
        h += '<span style="font-weight:600;">' + esc(l.name) + '</span></div>';
      });
      h += '</div>';
    }
    h += '</div>';

    // Schedule table
    h += '<div style="padding:4px 8px 4px;overflow-x:auto;">';
    h += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';

    // Header row
    h += '<thead><tr style="border-bottom:2px solid ' + gradEnd + ';">';
    h += '<th style="text-align:left;padding:3px 4px;font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;">Reviewer</th>';
    weekDays.forEach(function(td) {
      var headerBg = td.type === 'travel' ? '#fef3c7' : (td.type === 'empty' ? '#f8fafc' : '#eff6ff');
      var borderColor = td.type === 'travel' ? '#f59e0b' : (td.type === 'empty' ? '#e2e8f0' : gradEnd);
      h += '<th style="text-align:center;padding:2px 1px;font-weight:700;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#64748b;min-width:52px;background:' + headerBg + ';border-bottom:2px solid ' + borderColor + ';">' + formatDateCol(td.date) + '</th>';
    });
    h += '</tr>';
    h += '</thead><tbody>';

    // Reviewer rows — sort by earliest arrive time (prev-day first)
    var sortedRoster = craftRoster.slice().sort(function(a, b) {
      var aTime = a.arriveTime != null ? timelineSortKey(parseFloat(a.arriveTime)) : 99;
      var bTime = b.arriveTime != null ? timelineSortKey(parseFloat(b.arriveTime)) : 99;
      return aTime - bTime;
    });
    var rowCount = 0;
    sortedRoster.forEach(function(rev) {
      var revArriveDate = getReviewerTravelDate(rev, travelMap, 'arrive');
      var revDepartDate = getReviewerTravelDate(rev, travelMap, 'depart');

      // Check if this reviewer has any activity this week
      var hasActivity = false;
      weekDays.forEach(function(td) {
        var dateStr = td.date.toDateString();
        if (revArriveDate && dateStr === revArriveDate.toDateString()) hasActivity = true;
        if (revDepartDate && dateStr === revDepartDate.toDateString()) hasActivity = true;
        var match = getReviewerDateMatch(rev, td.date);
        if (match.active) hasActivity = true;
      });
      if (!hasActivity) return;

      var bg = rowCount % 2 === 0 ? '#f8fafc' : '#ffffff';
      rowCount++;

      // Build name cell with craft badge inline
      var craftColor = rev.craft === 'MH' ? '#f59e0b' : rev.craft === 'Relief' ? '#8b5cf6' : '#2563eb';
      var craftAbbr = rev.craft === 'MH' ? 'MH' : rev.craft === 'Relief' ? 'Relief' : 'CLK';
      var nameHtml = '<span style="font-weight:600;font-size:10px;">' + esc(rev.name) + '</span>';
      nameHtml += ' <span style="display:inline-block;padding:0 3px;border-radius:3px;font-size:7px;font-weight:700;color:#fff;background:' + craftColor + ';vertical-align:middle;">' + craftAbbr + '</span>';

      h += '<tr style="background:' + bg + ';border-bottom:1px solid #eee;">';
      h += '<td style="padding:2px 4px;white-space:nowrap;line-height:1.2;">' + nameHtml + '</td>';

      weekDays.forEach(function(td) {
        var dateStr = td.date.toDateString();
        var match = getReviewerDateMatch(rev, td.date);
        if (match.active) {
            var cellBg, timeColor;
            if (offices.length > 1 && officeColors[match.officeName]) {
              var oc = officeColors[match.officeName];
              cellBg = oc.bg;
              timeColor = oc.text;
            } else {
              cellBg = match.craft === 'MH' ? '#fffbeb' : match.craft === 'Relief' ? '#f5f3ff' : '#eff6ff';
              timeColor = match.craft === 'MH' ? '#92400e' : match.craft === 'Relief' ? '#6d28d9' : '#1e3a5f';
            }
            var cellContent = '<span style="font-weight:700;font-size:10px;color:' + timeColor + ';">' + formatArriveTime(match.arriveTime) + '</span>';
            if (match.craft === 'MH' && match.mhName) {
              cellContent += '<span style="display:block;font-size:7px;color:#92400e;font-weight:600;line-height:1.1;">' + esc(match.mhName) + '</span>';
            }
            h += '<td style="text-align:center;padding:1px 1px;vertical-align:middle;background:' + cellBg + ';">' + cellContent + '</td>';
        }
        else if ((revArriveDate && dateStr === revArriveDate.toDateString()) || (revDepartDate && dateStr === revDepartDate.toDateString())) {
          var isArr = revArriveDate && dateStr === revArriveDate.toDateString();
          h += '<td style="text-align:center;padding:1px;vertical-align:middle;background:#fffbeb;"><span style="font-size:8px;font-weight:600;color:#92400e;">' + (isArr ? '→Arr' : 'Dep→') + '</span></td>';
        }
        else {
          h += '<td style="text-align:center;padding:1px;color:#d1d5db;">—</td>';
        }
      });
      h += '</tr>';
    });

    h += '</tbody></table></div>';

    // Footer with office color legend if multi-office
    if (offices.length > 1) {
      h += '<div style="padding:4px 8px 5px;border-top:1px solid #e2e8f0;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">';
      h += '<span style="font-size:8px;color:#94a3b8;font-weight:600;">Offices:</span>';
      offices.forEach(function(o) {
        var oc = officeColors[o.name] || colorPalette[0];
        h += '<span style="display:inline-flex;align-items:center;gap:3px;font-size:8px;"><span style="display:inline-block;width:12px;height:10px;border-radius:2px;background:' + oc.bg + ';border:2px solid ' + oc.border + ';"></span><span style="color:' + oc.text + ';font-weight:700;">' + esc(o.name) + '</span></span>';
      });
      h += '</div>';
    }
    h += '<div style="padding:3px 8px 4px;' + (offices.length <= 1 ? 'border-top:1px solid #e2e8f0;' : '') + 'font-size:8px;color:#94a3b8;">Report to assigned office at designated arrival time. — = Not at office this day.</div>';

    h += '</div>';
    return h;
  }

  /** Build pickup/dropoff travel schedule card */
  function buildTravelCard(travelData, travelMap, roster) {
    if (!travelData || !travelData.responses) return '';
    var assignments = travelData.assignments || [];
    var responses = travelData.responses || {};
    var pickupPlan = travelData.pickupPlan || {};
    var dropoffPlan = travelData.dropoffPlan || {};
    var pickupTimes = travelData.pickupTimes || {};
    var dropoffTimes = travelData.dropoffTimes || {};
    var bufferMin = travelData.pickupBuffer || 20;

    // Build flyers and drivers lists
    var flyers = [];
    var drivers = [];
    assignments.forEach(function(a) {
      var r = responses[a.userId];
      if (!r) return;
      if (r.mode === 'flying') {
        flyers.push({
          name: a.name, userId: a.userId,
          arriveDate: r.arrival ? r.arrival.date : '',
          arriveTime: r.arrival ? r.arrival.time : '',
          arriveAirline: r.arrival ? (r.arrival.airline || '') : '',
          arriveFlight: r.arrival ? (r.arrival.flight || '') : '',
          departDate: r.departure ? r.departure.date : '',
          departTime: r.departure ? r.departure.time : '',
          departAirline: r.departure ? (r.departure.airline || '') : '',
          departFlight: r.departure ? (r.departure.flight || '') : ''
        });
      } else if (r.mode === 'driving') {
        drivers.push({ name: a.name, userId: a.userId, phone: r.phone || '' });
      }
    });

    if (flyers.length === 0) return '';

    // Build uid→driver name map
    var driverMap = {};
    drivers.forEach(function(d) { driverMap[d.userId] = d.name; });

    // Collect unique group keys and assign colors
    var groupColors = {};
    var colorPalette = [
      { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },  // blue
      { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },  // pink
      { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },  // green
      { bg: '#ede9fe', text: '#5b21b6', border: '#c4b5fd' },  // purple
      { bg: '#ffedd5', text: '#9a3412', border: '#fdba74' },  // orange
      { bg: '#e0f2fe', text: '#075985', border: '#7dd3fc' },  // sky
      { bg: '#fef9c3', text: '#854d0e', border: '#fde047' }   // yellow
    ];
    var uberColor = { bg: '#f3f4f6', text: '#374151', border: '#9ca3af' }; // gray for uber
    var colorIdx = 0;

    // Auto-group Uber riders by similar flight times (within 90 min window)
    // Arrivals: group by arrival time → share a pickup time
    // Departures: group by departure time → share a leave-by time
    var uberArrGroups = []; // array of { gks: [], anchorMs: number }
    var uberDepGroups = [];
    var uberArrGkMap = {}; // original uber gk → merged group index
    var uberDepGkMap = {};

    // Collect uber arrival flyers with their group keys and times
    var uberArrFlyers = [];
    flyers.forEach(function(f) {
      var gk = pickupPlan[f.userId] || '';
      if (gk.indexOf('uber') === 0 && f.arriveTime) {
        uberArrFlyers.push({ userId: f.userId, gk: gk, ms: timeToMs(f.arriveTime) });
      }
    });
    uberArrFlyers.sort(function(a, b) { return a.ms - b.ms; });
    uberArrFlyers.forEach(function(uf) {
      var placed = false;
      for (var g = 0; g < uberArrGroups.length; g++) {
        if (Math.abs(uf.ms - uberArrGroups[g].anchorMs) <= 90 * 60000) {
          uberArrGroups[g].gks.push(uf.gk);
          uberArrGkMap[uf.gk] = g;
          placed = true;
          break;
        }
      }
      if (!placed) {
        uberArrGkMap[uf.gk] = uberArrGroups.length;
        uberArrGroups.push({ gks: [uf.gk], anchorMs: uf.ms });
      }
    });

    // Collect uber departure flyers
    var uberDepFlyers = [];
    flyers.forEach(function(f) {
      var gk = dropoffPlan[f.userId] || '';
      if (gk.indexOf('uber') === 0 && f.departTime) {
        uberDepFlyers.push({ userId: f.userId, gk: gk, ms: timeToMs(f.departTime) });
      }
    });
    uberDepFlyers.sort(function(a, b) { return a.ms - b.ms; });
    uberDepFlyers.forEach(function(uf) {
      var placed = false;
      for (var g = 0; g < uberDepGroups.length; g++) {
        if (Math.abs(uf.ms - uberDepGroups[g].anchorMs) <= 90 * 60000) {
          uberDepGroups[g].gks.push(uf.gk);
          uberDepGkMap[uf.gk] = g;
          placed = true;
          break;
        }
      }
      if (!placed) {
        uberDepGkMap[uf.gk] = uberDepGroups.length;
        uberDepGroups.push({ gks: [uf.gk], anchorMs: uf.ms });
      }
    });

    // Build a palette for uber sub-groups (distinct from driver palette to avoid confusion)
    var uberPalette = [
      { bg: '#fef3c7', text: '#92400e', border: '#fbbf24' },  // amber
      { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },  // indigo
      { bg: '#fae8ff', text: '#86198f', border: '#e879f9' },  // fuchsia
      { bg: '#ccfbf1', text: '#115e59', border: '#5eead4' },  // teal
      { bg: '#fef9c3', text: '#854d0e', border: '#fde047' },  // yellow
      { bg: '#f1f5f9', text: '#334155', border: '#94a3b8' },  // slate
      { bg: '#ffe4e6', text: '#9f1239', border: '#fda4af' }   // rose
    ];

    // Assign colors: map each uber group key to its sub-group's color
    // Use different starting offsets for arrivals vs departures to avoid collision
    var uberArrColorMap = {}; // gk → color
    uberArrGroups.forEach(function(grp, gi) {
      var c = uberPalette[gi % uberPalette.length];
      grp.gks.forEach(function(gk) { uberArrColorMap[gk] = c; });
    });
    var uberDepColorMap = {};
    uberDepGroups.forEach(function(grp, gi) {
      // Offset by number of arrival groups to avoid same color
      var offset = uberArrGroups.length;
      var c = uberPalette[(gi + offset) % uberPalette.length];
      grp.gks.forEach(function(gk) { uberDepColorMap[gk] = c; });
    });

    var allGks = {};
    Object.keys(pickupPlan).forEach(function(uid) { allGks[pickupPlan[uid]] = true; });
    Object.keys(dropoffPlan).forEach(function(uid) { allGks[dropoffPlan[uid]] = true; });
    Object.keys(allGks).forEach(function(gk) {
      if (gk.indexOf('uber') === 0) {
        // Use uber sub-group color if available, otherwise default gray
        groupColors[gk] = uberArrColorMap[gk] || uberDepColorMap[gk] || uberColor;
      } else {
        groupColors[gk] = colorPalette[colorIdx % colorPalette.length];
        colorIdx++;
      }
    });

    // Resolve group key to label (driver name or Uber)
    function groupLabel(gk) {
      if (!gk) return '—';
      if (gk.indexOf('uber') === 0) return 'Uber';
      var driverId = gk.split('-trip-')[0];
      return driverMap[driverId] || 'Driver';
    }

    function groupStyle(gk, colorOverride) {
      var c = colorOverride || groupColors[gk] || { bg: '#f9fafb', text: '#374151', border: '#d1d5db' };
      return 'display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:' + c.bg + ';color:' + c.text + ';border:1px solid ' + c.border + ';';
    }

    // Parse time string to ms since midnight
    function timeToMs(timeStr) {
      if (!timeStr) return 0;
      var parts = timeStr.split(':');
      return (parseInt(parts[0], 10) || 0) * 3600000 + (parseInt(parts[1], 10) || 0) * 60000;
    }

    // Format ms since midnight to H:MM AM/PM
    function msToTime12(ms) {
      var totalMin = Math.round(ms / 60000);
      var hh = Math.floor(totalMin / 60) % 24;
      var mm = totalMin % 60;
      var ampm = hh >= 12 ? 'PM' : 'AM';
      if (hh > 12) hh -= 12;
      if (hh === 0) hh = 12;
      return hh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
    }

    function fmt12(timeStr) {
      if (!timeStr) return '';
      var parts = timeStr.split(':');
      var hh = parseInt(parts[0], 10);
      var mm = parts[1] || '00';
      var ampm = hh >= 12 ? 'PM' : 'AM';
      if (hh > 12) hh -= 12;
      if (hh === 0) hh = 12;
      return hh + ':' + mm + ' ' + ampm;
    }

    function fmtDate(ds) {
      if (!ds) return '';
      var d = new Date(ds + 'T00:00:00');
      var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return dayNames[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
    }

    // Get all uber group keys in the same arrival sub-group
    function getUberArrPeers(gk) {
      if (gk.indexOf('uber') !== 0) return [gk];
      var gi = uberArrGkMap[gk];
      if (gi === undefined) return [gk];
      return uberArrGroups[gi].gks;
    }
    // Get all uber group keys in the same departure sub-group
    function getUberDepPeers(gk) {
      if (gk.indexOf('uber') !== 0) return [gk];
      var gi = uberDepGkMap[gk];
      if (gi === undefined) return [gk];
      return uberDepGroups[gi].gks;
    }

    // Compute pickup time per group: earliest arrival in group + buffer
    function computeGroupPickupTime(gk) {
      if (pickupTimes[gk]) return pickupTimes[gk];
      var peers = getUberArrPeers(gk);
      var earliestMs = Infinity;
      flyers.forEach(function(f) {
        if (peers.indexOf(pickupPlan[f.userId]) !== -1 && f.arriveTime) {
          var ms = timeToMs(f.arriveTime);
          if (ms < earliestMs) earliestMs = ms;
        }
      });
      if (earliestMs === Infinity) return '';
      return msToTime12(earliestMs + bufferMin * 60000);
    }

    // Compute dropoff time per group: earliest departure in group - 2 hours
    function computeGroupDropoffTime(gk) {
      if (dropoffTimes[gk]) return dropoffTimes[gk];
      var peers = getUberDepPeers(gk);
      var earliestMs = Infinity;
      flyers.forEach(function(f) {
        if (peers.indexOf(dropoffPlan[f.userId]) !== -1 && f.departTime) {
          var ms = timeToMs(f.departTime);
          if (ms < earliestMs) earliestMs = ms;
        }
      });
      if (earliestMs === Infinity) return '';
      return msToTime12(earliestMs - 120 * 60000);
    }

    var h = '';
    h += '<div style="background:#fff;border-radius:8px;border:1px solid #d1d5db;overflow:hidden;max-width:900px;font-family:Segoe UI,Arial,sans-serif;color:#1e293b;margin-top:16px;">';

    // Header
    h += '<div style="background:linear-gradient(135deg,#92400e 0%,#f59e0b 100%);padding:16px 24px;">';
    h += '<div style="font-size:16px;font-weight:700;color:#fff;">Travel Schedule</div>';
    h += '</div>';

    // Hotel booking link (if provided)
    var hotelLink = travelData.hotelBookingLink || '';
    if (hotelLink) {
      h += '<div style="padding:10px 16px;background:#fffbeb;border-bottom:1px solid #fde68a;font-size:13px;">';
      h += '\ud83c\udfe8 <strong>Hotel Booking:</strong> <a href="' + esc(hotelLink) + '" target="_blank" style="color:#92400e;word-break:break-all;">' + esc(hotelLink) + '</a>';
      h += '</div>';
    }

    h += '<div style="padding:12px 16px 8px;overflow-x:auto;">';

    // --- Arrivals / Pickups ---
    var arrFlyers = flyers.filter(function(f) { return f.arriveDate; }).sort(function(a, b) {
      return (a.arriveDate + a.arriveTime).localeCompare(b.arriveDate + b.arriveTime);
    });

    if (arrFlyers.length > 0) {
      h += '<h4 style="margin:0 0 6px;font-size:13px;color:#1e293b;">✈️ Arrivals / Pickups</h4>';
      h += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px;">';
      h += '<thead><tr style="border-bottom:2px solid #f59e0b;background:#fffbeb;">';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Reviewer</th>';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Date</th>';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Flight</th>';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Arrives</th>';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Pickup By</th>';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Pickup At</th>';
      h += '</tr></thead><tbody>';
      arrFlyers.forEach(function(f, i) {
        var pGk = pickupPlan[f.userId] || '';
        var rowC = pGk ? (uberArrColorMap[pGk] || groupColors[pGk] || null) : null;
        var bg = rowC ? rowC.bg : (i % 2 === 0 ? '#ffffff' : '#fefce8');
        var pTime = pGk ? computeGroupPickupTime(pGk) : '';
        var flightStr = f.arriveAirline ? (f.arriveAirline + (f.arriveFlight ? ' #' + f.arriveFlight : '')) : (f.arriveFlight || '—');
        h += '<tr style="background:' + bg + ';border-bottom:1px solid #e2e8f0;">';
        h += '<td style="padding:6px 8px;font-weight:600;">' + esc(f.name) + '</td>';
        h += '<td style="padding:6px 8px;white-space:nowrap;">' + fmtDate(f.arriveDate) + '</td>';
        h += '<td style="padding:6px 8px;">' + esc(flightStr) + '</td>';
        h += '<td style="padding:6px 8px;font-weight:600;">' + fmt12(f.arriveTime) + '</td>';
        h += '<td style="padding:6px 8px;">' + (pGk ? '<span style="' + groupStyle(pGk, rowC) + '">' + esc(groupLabel(pGk)) + '</span>' : '—') + '</td>';
        h += '<td style="padding:6px 8px;font-weight:600;">' + (pTime ? esc(pTime) : '—') + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    }

    // --- Departures / Dropoffs ---
    var depFlyers = flyers.filter(function(f) { return f.departDate; }).sort(function(a, b) {
      return (a.departDate + a.departTime).localeCompare(b.departDate + b.departTime);
    });

    if (depFlyers.length > 0) {
      h += '<h4 style="margin:0 0 6px;font-size:13px;color:#1e293b;">✈️ Departures / Dropoffs</h4>';
      h += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px;">';
      h += '<thead><tr style="border-bottom:2px solid #f59e0b;background:#fffbeb;">';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Reviewer</th>';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Date</th>';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Flight</th>';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Departs</th>';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Dropoff By</th>';
      h += '<th style="text-align:left;padding:6px 8px;font-size:10px;color:#92400e;">Leave By</th>';
      h += '</tr></thead><tbody>';
      depFlyers.forEach(function(f, i) {
        var dGk = dropoffPlan[f.userId] || '';
        var rowC = dGk ? (uberDepColorMap[dGk] || groupColors[dGk] || null) : null;
        var bg = rowC ? rowC.bg : (i % 2 === 0 ? '#ffffff' : '#fefce8');
        var dTime = dGk ? computeGroupDropoffTime(dGk) : '';
        var flightStr = f.departAirline ? (f.departAirline + (f.departFlight ? ' #' + f.departFlight : '')) : (f.departFlight || '—');
        h += '<tr style="background:' + bg + ';border-bottom:1px solid #e2e8f0;">';
        h += '<td style="padding:6px 8px;font-weight:600;">' + esc(f.name) + '</td>';
        h += '<td style="padding:6px 8px;white-space:nowrap;">' + fmtDate(f.departDate) + '</td>';
        h += '<td style="padding:6px 8px;">' + esc(flightStr) + '</td>';
        h += '<td style="padding:6px 8px;font-weight:600;">' + fmt12(f.departTime) + '</td>';
        h += '<td style="padding:6px 8px;">' + (dGk ? '<span style="' + groupStyle(dGk, rowC) + '">' + esc(groupLabel(dGk)) + '</span>' : '—') + '</td>';
        h += '<td style="padding:6px 8px;font-weight:600;">' + (dTime ? esc(dTime) : '—') + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    }

    h += '</div>';

    // Footer
    h += '<div style="padding:8px 16px 12px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;">';
    h += 'Pickup times include ' + bufferMin + '-min buffer. "Leave By" accounts for 2-hour airport lead time.';
    h += '</div>';

    h += '</div>';
    return h;
  }

  function buildPlainTextSchedule() {
    var tripDays = buildTripDays();
    var allSlots = loadAllOfficeSchedules();
    var roster = buildReviewerRoster(allSlots);
    var leaders = getLeadership();
    var travelData = loadTravelPlan();
    var travelMap = getReviewerTravelMap(travelData);
    var schedData = loadSched();
    var daySkips = schedData.daySkips || {};

    var offices = [];
    tripReviews.forEach(function(rid) {
      var rev = null;
      try { rev = Reviews.getById(rid); } catch(e) {}
      if (rev) {
        var revOffices = (rev.offices && rev.offices.length > 0) ? rev.offices : (rev.officeName ? [{ officeName: rev.officeName, financeNum: rev.financeNum || '' }] : []);
        revOffices.forEach(function(ro) {
          var exists = offices.some(function(o) { return o.name === ro.officeName; });
          if (!exists) offices.push({ name: ro.officeName, fin: ro.financeNum || '' });
        });
      }
    });

    var lines = [];
    lines.push('CLERK OBSERVATION REVIEW SCHEDULE');
    lines.push('');
    offices.forEach(function(o) {
      lines.push('Office: ' + o.name + (o.fin ? ' (FIN ' + o.fin + ')' : ''));
    });
    if (tripDays.length > 0) lines.push('Dates:  ' + formatDateRange(tripDays));
    if (leaders.length > 0) {
      lines.push('');
      leaders.forEach(function(l) { lines.push(l.role + ': ' + l.name); });
    }
    lines.push('');

    // Split into weeks (full Sun-Sat view)
    var weeks = splitIntoWeeks(tripDays);
    var multiWeek = weeks.length > 1;

    weeks.forEach(function(weekDays, weekIdx) {
      if (multiWeek) {
        lines.push('═══ WEEK ' + (weekIdx + 1) + ' (' + formatDateRange(weekDays) + ') ═══');
        lines.push('');
      }

      var dayCols = weekDays.map(function(td) { return formatDateColPlain(td.date); });
      var hdr = padRight('Reviewer', 30);
      dayCols.forEach(function(dc) { hdr += padRight(dc, 14); });
      lines.push(hdr);
      lines.push(Array(hdr.length + 1).join('─'));

      roster.forEach(function(rev) {
        var displayName = rev.name;
        var mhOffDows = [];
        if (rev.craft === 'MH' && rev.mhDaysOff) mhOffDows = parseDaysOff(rev.mhDaysOff);
        var revArriveDate = getReviewerTravelDate(rev, travelMap, 'arrive');
        var revDepartDate = getReviewerTravelDate(rev, travelMap, 'depart');

        // Check if reviewer has any activity this week
        var hasActivity = false;
        weekDays.forEach(function(td) {
          var dateStr = td.date.toDateString();
          if (revArriveDate && dateStr === revArriveDate.toDateString()) hasActivity = true;
          if (revDepartDate && dateStr === revDepartDate.toDateString()) hasActivity = true;
          var match = getReviewerDateMatch(rev, td.date);
          if (match.active) hasActivity = true;
        });
        if (!hasActivity) return;

        var row = padRight(displayName, 30);
        weekDays.forEach(function(td) {
          var dateStr = td.date.toDateString();

          // Priority 1: office assignment
          var match = getReviewerDateMatch(rev, td.date);
          if (match.active) {
              var roleTag = match.craft === 'MH' ? '[MH]' : match.craft === 'Relief' ? '[R]' : '[CR]';
              var cell = roleTag;
              if (match.craft === 'MH' && match.mhName) cell += ' ' + match.mhName;
              cell += ' ' + formatArriveTimeText(match.arriveTime);
              if (offices.length > 1) cell = match.officeName + ' ' + cell;
              row += padRight(cell, 14);
          }
          // Priority 2: travel day
          else if ((revArriveDate && dateStr === revArriveDate.toDateString()) || (revDepartDate && dateStr === revDepartDate.toDateString())) {
            row += padRight('Travel', 14);
          }
          // Priority 3: not assigned
          else {
            row += padRight('—', 14);
          }
        });
        lines.push(row);
      });

      if (leaders.length > 0) {
        lines.push('');
        leaders.forEach(function(l) {
          var row = padRight(l.name, 30);
          weekDays.forEach(function(td) {
            if (td.type === 'travel') {
              row += padRight('Travel', 14);
            } else {
              var atOffice = false;
              if (l.offices.length === 0) {
                atOffice = true;
              } else {
                for (var oi = 0; oi < l.offices.length; oi++) {
                  var lo = l.offices[oi];
                  if (lo.officeStart && lo.officeEnd && td.date >= lo.officeStart && td.date <= lo.officeEnd) {
                    atOffice = true;
                    break;
                  }
                }
              }
              row += padRight(atOffice ? '[' + l.role + '] On-Site' : '—', 14);
            }
          });
          lines.push(row);
        });
      }

      lines.push('');
    });

    lines.push('Report to your assigned office at the designated arrival time each day.');
    lines.push('— = Not at this office');

    // Add plain-text travel card
    var travelText = buildPlainTextTravelCard(travelData, travelMap);
    if (travelText) {
      lines.push('');
      lines.push(travelText);
    }

    // Add plain-text daily trips
    var tripsText = buildPlainTextDailyTrips();
    if (tripsText) {
      lines.push('');
      lines.push(tripsText);
    }

    return lines.join('\n');
  }

  /** Plain text version of pickup/dropoff schedule */
  function buildPlainTextTravelCard(travelData, travelMap) {
    if (!travelData || !travelData.responses) return '';
    var assignments = travelData.assignments || [];
    var responses = travelData.responses || {};
    var pickupPlan = travelData.pickupPlan || {};
    var dropoffPlan = travelData.dropoffPlan || {};
    var pickupTimes = travelData.pickupTimes || {};
    var dropoffTimes = travelData.dropoffTimes || {};
    var bufferMin = travelData.pickupBuffer || 20;

    var flyers = [];
    var drivers = [];
    assignments.forEach(function(a) {
      var r = responses[a.userId];
      if (!r) return;
      if (r.mode === 'flying') {
        flyers.push({
          name: a.name, userId: a.userId,
          arriveDate: r.arrival ? r.arrival.date : '',
          arriveTime: r.arrival ? r.arrival.time : '',
          arriveAirline: r.arrival ? (r.arrival.airline || '') : '',
          arriveFlight: r.arrival ? (r.arrival.flight || '') : '',
          departDate: r.departure ? r.departure.date : '',
          departTime: r.departure ? r.departure.time : '',
          departAirline: r.departure ? (r.departure.airline || '') : '',
          departFlight: r.departure ? (r.departure.flight || '') : ''
        });
      } else if (r.mode === 'driving') {
        drivers.push({ name: a.name, userId: a.userId, phone: r.phone || '' });
      }
    });

    if (flyers.length === 0) return '';

    var driverMap = {};
    drivers.forEach(function(d) { driverMap[d.userId] = d.name; });
    function groupLabel(gk) {
      if (!gk) return '—';
      if (gk.indexOf('uber') === 0) return 'Uber';
      var driverId = gk.split('-trip-')[0];
      return driverMap[driverId] || 'Driver';
    }
    function timeToMs(timeStr) {
      if (!timeStr) return 0;
      var parts = timeStr.split(':');
      return (parseInt(parts[0], 10) || 0) * 3600000 + (parseInt(parts[1], 10) || 0) * 60000;
    }
    function msToTime12(ms) {
      var totalMin = Math.round(ms / 60000);
      var hh = Math.floor(totalMin / 60) % 24;
      var mm = totalMin % 60;
      var ampm = hh >= 12 ? 'PM' : 'AM';
      if (hh > 12) hh -= 12;
      if (hh === 0) hh = 12;
      return hh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
    }
    function computePickupTime(gk) {
      if (pickupTimes[gk]) return pickupTimes[gk];
      var earliest = Infinity;
      flyers.forEach(function(f) {
        if (pickupPlan[f.userId] === gk && f.arriveTime) {
          var ms = timeToMs(f.arriveTime);
          if (ms < earliest) earliest = ms;
        }
      });
      return earliest === Infinity ? '' : msToTime12(earliest + bufferMin * 60000);
    }
    function computeDropoffTime(gk) {
      if (dropoffTimes[gk]) return dropoffTimes[gk];
      var earliest = Infinity;
      flyers.forEach(function(f) {
        if (dropoffPlan[f.userId] === gk && f.departTime) {
          var ms = timeToMs(f.departTime);
          if (ms < earliest) earliest = ms;
        }
      });
      return earliest === Infinity ? '' : msToTime12(earliest - 120 * 60000);
    }
    function fmt12(timeStr) {
      if (!timeStr) return '';
      var parts = timeStr.split(':');
      var hh = parseInt(parts[0], 10);
      var mm = parts[1] || '00';
      var ampm = hh >= 12 ? 'PM' : 'AM';
      if (hh > 12) hh -= 12;
      if (hh === 0) hh = 12;
      return hh + ':' + mm + ' ' + ampm;
    }
    function fmtDate(ds) {
      if (!ds) return '';
      var d = new Date(ds + 'T00:00:00');
      var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return dayNames[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
    }

    var lines = [];
    lines.push('═══ TRAVEL SCHEDULE ═══');
    var hotelLink = travelData.hotelBookingLink || '';
    if (hotelLink) {
      lines.push('🏨 Hotel Booking: ' + hotelLink);
    }
    lines.push('');

    var arrFlyers = flyers.filter(function(f) { return f.arriveDate; }).sort(function(a, b) {
      return (a.arriveDate + a.arriveTime).localeCompare(b.arriveDate + b.arriveTime);
    });
    if (arrFlyers.length > 0) {
      lines.push('ARRIVALS / PICKUPS');
      var aHdr = padRight('Reviewer', 22) + padRight('Date', 14) + padRight('Flight', 14) + padRight('Arrives', 12) + padRight('Pickup By', 14) + 'Pickup At';
      lines.push(aHdr);
      lines.push(Array(aHdr.length + 1).join('─'));
      arrFlyers.forEach(function(f) {
        var pGk = pickupPlan[f.userId] || '';
        var pTime = pGk ? computePickupTime(pGk) : '';
        var flight = f.arriveAirline ? (f.arriveAirline + (f.arriveFlight ? ' #' + f.arriveFlight : '')) : (f.arriveFlight || '—');
        var row = padRight(f.name, 22) + padRight(fmtDate(f.arriveDate), 14) + padRight(flight, 14) + padRight(fmt12(f.arriveTime), 12) + padRight(groupLabel(pGk), 14) + (pTime || '—');
        lines.push(row);
      });
      lines.push('');
    }

    var depFlyers = flyers.filter(function(f) { return f.departDate; }).sort(function(a, b) {
      return (a.departDate + a.departTime).localeCompare(b.departDate + b.departTime);
    });
    if (depFlyers.length > 0) {
      lines.push('DEPARTURES / DROPOFFS');
      var dHdr = padRight('Reviewer', 22) + padRight('Date', 14) + padRight('Flight', 14) + padRight('Departs', 12) + padRight('Dropoff By', 14) + 'Leave By';
      lines.push(dHdr);
      lines.push(Array(dHdr.length + 1).join('─'));
      depFlyers.forEach(function(f) {
        var dGk = dropoffPlan[f.userId] || '';
        var dTime = dGk ? computeDropoffTime(dGk) : '';
        var flight = f.departAirline ? (f.departAirline + (f.departFlight ? ' #' + f.departFlight : '')) : (f.departFlight || '—');
        var row = padRight(f.name, 22) + padRight(fmtDate(f.departDate), 14) + padRight(flight, 14) + padRight(fmt12(f.departTime), 12) + padRight(groupLabel(dGk), 14) + (dTime || '—');
        lines.push(row);
      });
    }

    return lines.join('\n');
  }

  function padRight(str, len) {
    str = str || '';
    while (str.length < len) str += ' ';
    return str.substring(0, Math.max(len, str.length));
  }

  /** Render linked reviews picker */
  function renderLinkedReviews() {
    if (!linkReviewsDiv) return;
    var allReviews = [];
    try { allReviews = Reviews.getAll(); } catch(e) {}
    var available = allReviews.filter(function(r) { return tripReviews.indexOf(r.id) === -1; });

    var html = '';
    // Show linked reviews
    tripReviews.forEach(function(rid, idx) {
      if (idx === 0) return; // skip current (always included)
      var rev = null;
      try { rev = Reviews.getById(rid); } catch(e) {}
      var label = rev ? ((rev.name || rev.officeName || 'Review') + ' (' + rev.startDate + ' – ' + rev.endDate + ')') : rid;
      html += '<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.25rem;">';
      html += '<span style="font-size:0.78rem;">' + esc(label) + '</span>';
      html += '<button class="wb-link-remove btn btn-danger btn-sm" data-rid="' + esc(rid) + '" style="font-size:0.65rem;padding:0.1rem 0.3rem;">✕</button>';
      html += '</div>';
    });

    // Dropdown to add
    if (available.length > 0) {
      html += '<div style="display:flex;align-items:center;gap:0.4rem;margin-top:0.3rem;">';
      html += '<select id="wb-link-select" class="wb-sched-type-sel" style="font-size:0.78rem;flex:1;max-width:360px;">';
      html += '<option value="">— Select a review to add —</option>';
      available.forEach(function(r) {
        var label = (r.name || r.officeName || 'Review') + ' (' + r.startDate + ' – ' + r.endDate + ')';
        html += '<option value="' + esc(r.id) + '">' + esc(label) + '</option>';
      });
      html += '</select>';
      html += '<button id="wb-link-add-confirm" class="btn btn-primary btn-sm" style="font-size:0.72rem;">Add</button>';
      html += '</div>';
    } else if (tripReviews.length <= 1) {
      html += '<span style="font-size:0.75rem;color:var(--text-light);">No other reviews available to link.</span>';
    }

    linkReviewsDiv.innerHTML = html;

    // Bind remove buttons
    linkReviewsDiv.querySelectorAll('.wb-link-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var rid = btn.dataset.rid;
        tripReviews = tripReviews.filter(function(r) { return r !== rid; });
        saveTrip();
        renderLinkedReviews();
        renderShareSection();
      });
    });

    // Bind add button
    var addConfirmBtn = document.getElementById('wb-link-add-confirm');
    var linkSelect = document.getElementById('wb-link-select');
    if (addConfirmBtn && linkSelect) {
      addConfirmBtn.addEventListener('click', function() {
        var selectedId = linkSelect.value;
        if (!selectedId) return;
        tripReviews.push(selectedId);
        saveTrip();
        renderLinkedReviews();
        renderShareSection();
      });
    }
  }

  function renderShareSection() {
    var allSlots = loadAllOfficeSchedules();
    var emptyMsg = '<p class="empty-state">No reviewers assigned yet. Build a schedule and assign reviewers first.</p>';

    var viewType = shareTypeSelect ? shareTypeSelect.value : 'review';

    // Show/hide sections
    Object.keys(emailSections).forEach(function(k) {
      if (emailSections[k].wrap) emailSections[k].wrap.style.display = (k === viewType) ? '' : 'none';
    });

    if (allSlots.length === 0) {
      Object.keys(emailSections).forEach(function(k) {
        if (emailSections[k].card) emailSections[k].card.innerHTML = emptyMsg;
      });
      return;
    }

    // Render the active card
    var sec = emailSections[viewType];
    if (!sec || !sec.card) return;

    if (viewType === 'trips') {
      sec.card.innerHTML = buildDailyTripsEmailCard();
    } else if (viewType === 'airport') {
      var travelData = loadTravelPlan();
      var travelMap = getReviewerTravelMap(travelData);
      var roster = buildReviewerRoster(allSlots);
      var cardHtml = buildTravelCard(travelData, travelMap, roster);
      sec.card.innerHTML = cardHtml || '<p class="empty-state">No travel survey data yet. Complete the travel survey first.</p>';
    } else {
      sec.card.innerHTML = buildScheduleCard();
    }

    // Auto-populate TO (reviewers) and CC (leadership) for active section
    var data = loadSched();
    var saved = data[sec.savedKey] || {};

    if (saved.to && sec.to) {
      sec.to.value = saved.to;
    } else if (sec.to && !sec.to.value) {
      // Gather reviewer emails from ALL offices, not just the current one
      var reviewerEmails = [];
      var rev2 = null;
      try { rev2 = Reviews.getById(reviewId); } catch(e) {}
      var allOffices = (rev2 && rev2.offices && rev2.offices.length > 0) ? rev2.offices : [];
      allOffices.forEach(function(ofc) {
        var f = ofc.financeNum || '';
        var sk = 'clerk_obs_schedule_' + reviewId + (f ? '_' + f : '');
        try {
          var sd = JSON.parse(localStorage.getItem(sk)) || {};
          (sd.assignedNames || []).forEach(function(a) {
            if (a.userId) {
              var u = Auth.getUserById(a.userId);
              if (u && u.email && reviewerEmails.indexOf(u.email) === -1) reviewerEmails.push(u.email);
            }
          });
        } catch(e) {}
      });
      // Also include current office assignedNames in case it's not in offices array
      assignedNames.forEach(function(a) {
        if (a.userId) {
          var u = Auth.getUserById(a.userId);
          if (u && u.email && reviewerEmails.indexOf(u.email) === -1) reviewerEmails.push(u.email);
        }
      });
      if (reviewerEmails.length > 0) sec.to.value = reviewerEmails.join('; ');
    }

    if (saved.cc && sec.cc) {
      sec.cc.value = saved.cc;
    } else if (sec.cc && !sec.cc.value) {
      var leaderEmails = [];
      reviewLeaders.forEach(function(l) {
        var u = Auth.getUserById(l.userId);
        if (u && u.email && leaderEmails.indexOf(u.email) === -1) leaderEmails.push(u.email);
      });
      if (leaderEmails.length > 0) sec.cc.value = leaderEmails.join('; ');
    }

    if (saved.msg && sec.msg) sec.msg.value = saved.msg;
  }

  // Schedule type dropdown — toggle sections
  if (shareTypeSelect) {
    shareTypeSelect.addEventListener('change', function() {
      renderShareSection();
    });
  }

  // Save & send for each email section
  Object.keys(emailSections).forEach(function(key) {
    var sec = emailSections[key];

    // Save on change
    ['to', 'cc', 'msg'].forEach(function(field) {
      if (sec[field]) {
        sec[field].addEventListener('change', function() {
          var data = loadSched();
          if (!data[sec.savedKey]) data[sec.savedKey] = {};
          data[sec.savedKey][field] = sec[field].value.trim();
          saveSched(data);
        });
      }
    });

    // Send button
    if (sec.send) {
      sec.send.addEventListener('click', function() {
        var toVal = (sec.to ? sec.to.value : '').trim();
        if (!toVal) { alert('Enter at least one email address in the To field.'); return; }
        var toList = toVal.replace(/[;,\s]+/g, '; ').trim();
        var ccVal = (sec.cc ? sec.cc.value : '').trim();
        var ccList = ccVal ? ccVal.replace(/[;,\s]+/g, '; ').trim() : '';

        var revName = '';
        try { revName = Reviews.getById(tripReviews[0]).name || ''; } catch(e) {}

        var subject = 'Function 4 Review ' + sec.subjectSuffix + (revName ? ' \u2014 ' + revName : '');

        var body = '';
        if (sec.msg && sec.msg.value.trim()) {
          body = sec.msg.value.trim();
        } else {
          var typeLabel = key === 'trips' ? 'daily transportation groups' : (key === 'airport' ? 'airport pickup/dropoff schedule' : 'schedule');
          body = 'Good day, team!\n\nBelow is the ' + typeLabel + ' for the upcoming Function 4 Review' + (revName ? ' (' + revName + ')' : '') + '. Please review your assignment and arrival times.\n\n[Paste screenshot here]\n\nYou can also view the full schedule anytime by opening your review in the app and clicking the "Schedules" tab.\n\nIf you have any questions, please reach out.';
        }

        var mailto = 'mailto:' + encodeURIComponent(toList) +
          '?subject=' + encodeURIComponent(subject) +
          '&body=' + encodeURIComponent(body);
        if (ccList) mailto += '&cc=' + encodeURIComponent(ccList);
        window.open(mailto, '_blank');
      });
    }
  });

  // Initialize trip and share section
  loadTrip();
  renderLinkedReviews();

  // Re-render share when assignments change
  var origRenderAssign = renderAssignments;
  renderAssignments = function() {
    origRenderAssign();
    renderShareSection();
  };

  // Initial render
  try { renderShareSection(); } catch(e) { console.error('Share section error:', e); }

  // ===================== CALENDAR / INFORMATION =====================

  var calContainer = document.getElementById('wb-calendar-container');
  var calMilestones = document.getElementById('wb-calendar-milestones');

  function renderCalendar() {
    if (!calContainer || !reviewId) return;
    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    if (!rev) {
      calContainer.innerHTML = '<p class="empty-state">No review data found.</p>';
      return;
    }

    var offices = rev.offices || [];

    // Derive start/end from offices if root dates missing
    var start, end;
    if (rev.startDate) {
      start = new Date(rev.startDate + 'T00:00:00');
      end = new Date((rev.endDate || rev.startDate) + 'T00:00:00');
    } else if (offices.length > 0) {
      var allStarts0 = offices.filter(function(o) { return o.startDate; }).map(function(o) { return new Date(o.startDate + 'T00:00:00'); });
      var allEnds0 = offices.filter(function(o) { return o.endDate; }).map(function(o) { return new Date(o.endDate + 'T00:00:00'); });
      if (allStarts0.length === 0) {
        calContainer.innerHTML = '<p class="empty-state">No review dates found. Set office dates first.</p>';
        return;
      }
      start = new Date(Math.min.apply(null, allStarts0));
      end = new Date(Math.max.apply(null, allEnds0));
    } else {
      calContainer.innerHTML = '<p class="empty-state">No review dates found.</p>';
      return;
    }
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    // Union notification deadline: exactly 2 weeks before first office start
    var allStarts = offices.filter(function(o) { return o.startDate; }).map(function(o) { return new Date(o.startDate + 'T00:00:00'); });
    var earliestStart = allStarts.length > 0 ? new Date(Math.min.apply(null, allStarts)) : start;
    var unionDeadline = new Date(earliestStart);
    unionDeadline.setDate(unionDeadline.getDate() - 14);

    // Exit conference target: 1 week after last office end
    var allEnds = offices.filter(function(o) { return o.endDate; }).map(function(o) { return new Date(o.endDate + 'T00:00:00'); });
    var latestEnd = allEnds.length > 0 ? new Date(Math.max.apply(null, allEnds)) : end;
    var exitTarget = new Date(latestEnd);
    exitTarget.setDate(exitTarget.getDate() + 7);

    // Travel days: day before first onsite review, day after last onsite review
    var travelTo = new Date(earliestStart);
    travelTo.setDate(travelTo.getDate() - 1);
    var travelFrom = new Date(latestEnd);
    travelFrom.setDate(travelFrom.getDate() + 1);

    function fmt(d) {
      return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
    }
    function daysUntilStr(d) {
      var diff = Math.ceil((d - today) / 86400000);
      if (diff < 0) return '<span style="color:var(--text-light);">' + Math.abs(diff) + 'd ago</span>';
      if (diff === 0) return '<strong style="color:var(--accent);">Today</strong>';
      return diff + 'd';
    }
    function rangeDaysUntil(s, e) {
      if (today > e) {
        var ago = Math.ceil((today - e) / 86400000);
        return '<span style="color:var(--text-light);">' + ago + 'd ago</span>';
      }
      if (today >= s && today <= e) return '<strong style="color:var(--accent);">Now</strong>';
      var diff = Math.ceil((s - today) / 86400000);
      return diff + 'd';
    }

    // Build schedule table
    var html = '<table class="wb-tacs-table"><thead><tr>' +
      '<th></th><th>Event</th><th>Date</th><th>Days Until</th>' +
      '</tr></thead><tbody>';

    // Union notification deadline
    html += '<tr><td style="text-align:center;">📋</td>' +
      '<td>Union Notification Deadline</td>' +
      '<td>' + fmt(unionDeadline) + '</td>' +
      '<td style="text-align:center;">' + daysUntilStr(unionDeadline) + '</td></tr>';

    // Travel to
    html += '<tr><td style="text-align:center;">✈️</td>' +
      '<td>Travel to Review</td>' +
      '<td>' + fmt(travelTo) + '</td>' +
      '<td style="text-align:center;">' + daysUntilStr(travelTo) + '</td></tr>';

    // Per-office review blocks
    offices.forEach(function(o) {
      var os = new Date(o.startDate + 'T00:00:00');
      var oe = new Date(o.endDate + 'T00:00:00');
      html += '<tr><td style="text-align:center;">🔍</td>' +
        '<td>Review — ' + esc(o.officeName) + '</td>' +
        '<td>' + fmt(os) + ' – ' + fmt(oe) + '</td>' +
        '<td style="text-align:center;">' + rangeDaysUntil(os, oe) + '</td></tr>';
    });

    // Travel from
    html += '<tr><td style="text-align:center;">✈️</td>' +
      '<td>Travel Home</td>' +
      '<td>' + fmt(travelFrom) + '</td>' +
      '<td style="text-align:center;">' + daysUntilStr(travelFrom) + '</td></tr>';

    // Exit conference target
    html += '<tr><td style="text-align:center;">🤝</td>' +
      '<td>Exit Conference <em style="font-size:0.72rem;color:var(--text-light);">(target)</em></td>' +
      '<td>' + fmt(exitTarget) + '</td>' +
      '<td style="text-align:center;">' + daysUntilStr(exitTarget) + '</td></tr>';

    html += '</tbody></table>';

    // --- Mini month calendar ---
    var officeRanges = offices.map(function(o) {
      return { start: new Date(o.startDate + 'T00:00:00'), end: new Date(o.endDate + 'T00:00:00'), name: o.officeName };
    });
    var travelSet = {};
    travelSet[travelTo.toDateString()] = true;
    travelSet[travelFrom.toDateString()] = true;

    var calStart = new Date(unionDeadline);
    calStart.setDate(1);
    var calEnd = new Date(exitTarget);
    calEnd.setMonth(calEnd.getMonth() + 1, 0);

    var monthsHtml = '';
    var cursor = new Date(calStart);
    while (cursor <= calEnd) {
      var year = cursor.getFullYear();
      var month = cursor.getMonth();
      var monthName = cursor.toLocaleString('default', { month: 'long', year: 'numeric' });
      monthsHtml += '<div class="wb-cal-month"><h4>' + monthName + '</h4>';
      monthsHtml += '<div class="wb-cal-grid">';
      monthsHtml += '<div class="wb-cal-hdr">Su</div><div class="wb-cal-hdr">Mo</div><div class="wb-cal-hdr">Tu</div><div class="wb-cal-hdr">We</div><div class="wb-cal-hdr">Th</div><div class="wb-cal-hdr">Fr</div><div class="wb-cal-hdr">Sa</div>';

      var firstDay = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();

      for (var b = 0; b < firstDay; b++) monthsHtml += '<div class="wb-cal-day wb-cal-empty"></div>';

      for (var d = 1; d <= daysInMonth; d++) {
        var thisDate = new Date(year, month, d);
        var classes = 'wb-cal-day';
        if (thisDate.getTime() === today.getTime()) classes += ' wb-cal-today';
        if (thisDate.getTime() === unionDeadline.getTime()) classes += ' wb-cal-union';
        if (thisDate.getTime() === exitTarget.getTime()) classes += ' wb-cal-exit';
        if (travelSet[thisDate.toDateString()]) classes += ' wb-cal-travel';
        for (var ri = 0; ri < officeRanges.length; ri++) {
          if (thisDate >= officeRanges[ri].start && thisDate <= officeRanges[ri].end) {
            classes += ' wb-cal-review';
            break;
          }
        }
        monthsHtml += '<div class="' + classes + '">' + d + '</div>';
      }

      monthsHtml += '</div></div>';
      cursor.setMonth(cursor.getMonth() + 1);
    }

    calContainer.innerHTML = '<div class="wb-cal-months">' + monthsHtml + '</div>' +
      '<div class="wb-cal-legend">' +
        '<span class="wb-cal-leg-item"><span class="wb-cal-leg-swatch wb-cal-union"></span> Union Deadline</span>' +
        '<span class="wb-cal-leg-item"><span class="wb-cal-leg-swatch wb-cal-travel"></span> Travel</span>' +
        '<span class="wb-cal-leg-item"><span class="wb-cal-leg-swatch wb-cal-review"></span> Review Days</span>' +
        '<span class="wb-cal-leg-item"><span class="wb-cal-leg-swatch wb-cal-exit"></span> Exit Conference</span>' +
      '</div>';
    calMilestones.innerHTML = html;
  }

  // ===================== DOCUMENT UPLOADS (PER-OFFICE, IndexedDB) =====================

  var docContainer = document.getElementById('wb-doc-container');
  var addTypeBtn = document.getElementById('wb-doc-add-type');

  // Default doc types + user-added custom types
  var DEFAULT_DOC_CONFIGS = [
    { id: 'apwu-lmou', label: 'APWU LMOU' },
    { id: 'npmhu-lmou', label: 'NPMHU LMOU' },
    { id: 'ri399', label: 'RI-399' },
    { id: 'union-letter', label: 'Union Notification Letter' }
  ];

  var CUSTOM_TYPES_KEY = 'clerk_obs_doc_types_' + reviewId;

  function loadCustomTypes() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_TYPES_KEY)) || []; } catch(e) { return []; }
  }
  function saveCustomTypes(arr) {
    localStorage.setItem(CUSTOM_TYPES_KEY, JSON.stringify(arr));
  }
  function getAllDocConfigs() {
    return DEFAULT_DOC_CONFIGS.concat(loadCustomTypes());
  }

  var viewerSection = document.getElementById('wb-doc-viewer-section');
  var viewerTitle = document.getElementById('wb-doc-viewer-title');
  var viewerFrame = document.getElementById('wb-doc-viewer-frame');
  var viewerClose = document.getElementById('wb-doc-viewer-close');

  if (viewerClose) {
    viewerClose.addEventListener('click', function() {
      viewerSection.hidden = true;
      viewerFrame.src = '';
    });
  }

  // Get all review offices
  var _docOffices = [];
  (function() {
    var rev = null;
    try { rev = Reviews.getById(reviewId); } catch(e) {}
    if (!rev) return;
    _docOffices = (rev.offices && rev.offices.length > 0) ? rev.offices : [{ officeName: rev.officeName || 'Office', financeNum: rev.financeNum || '' }];
  })();

  // --- IndexedDB for doc file blobs ---
  var DOC_DB_NAME = 'clerk_obs_documents';
  var DOC_DB_VERSION = 1;
  var DOC_STORE = 'files';

  function openDocDB(cb) {
    var req = indexedDB.open(DOC_DB_NAME, DOC_DB_VERSION);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        db.createObjectStore(DOC_STORE);
      }
    };
    req.onsuccess = function(e) { cb(null, e.target.result); };
    req.onerror = function(e) { cb(e.target.error); };
  }

  function saveDocBlob(key, blob, cb) {
    openDocDB(function(err, db) {
      if (err) return cb && cb(err);
      var tx = db.transaction(DOC_STORE, 'readwrite');
      tx.objectStore(DOC_STORE).put(blob, key);
      tx.oncomplete = function() { cb && cb(null); };
      tx.onerror = function(e) { cb && cb(e.target.error); };
    });
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

  function deleteDocBlob(key, cb) {
    openDocDB(function(err, db) {
      if (err) return cb && cb(err);
      var tx = db.transaction(DOC_STORE, 'readwrite');
      tx.objectStore(DOC_STORE).delete(key);
      tx.oncomplete = function() { cb && cb(null); };
      tx.onerror = function(e) { cb && cb(e.target.error); };
    });
  }

  function docBlobKey(fin, docId) {
    return 'doc_' + reviewId + '_' + fin + '_' + docId;
  }

  // Metadata (filenames only) stays in localStorage — tiny
  function getDocMetaKey(fin) {
    return 'clerk_obs_docmeta_' + reviewId + '_' + fin;
  }
  function loadDocMeta(fin) {
    try { return JSON.parse(localStorage.getItem(getDocMetaKey(fin))) || {}; } catch(e) { return {}; }
  }
  function saveDocMeta(fin, data) {
    localStorage.setItem(getDocMetaKey(fin), JSON.stringify(data));
  }

  // Migrate old base64 data out of localStorage (one-time cleanup)
  (function migrateOldDocs() {
    _docOffices.forEach(function(office) {
      var fin = office.financeNum || '';
      var oldKey = 'clerk_obs_docs_' + reviewId + '_' + fin;
      var oldData;
      try { oldData = JSON.parse(localStorage.getItem(oldKey)); } catch(e) {}
      if (!oldData) return;

      // Move any base64 data to IndexedDB, keep names in new meta
      var meta = loadDocMeta(fin);
      var configs = getAllDocConfigs();
      var migrated = 0;
      configs.forEach(function(cfg) {
        var nameKey = cfg.id + '_name';
        var dataKey = cfg.id + '_data';
        if (oldData[nameKey] && oldData[dataKey]) {
          meta[cfg.id] = { name: oldData[nameKey], uploadedAt: new Date().toISOString() };
          // Convert base64 dataURL to blob and store in IndexedDB
          try {
            var parts = oldData[dataKey].split(',');
            var mime = parts[0].match(/:(.*?);/)[1];
            var raw = atob(parts[1]);
            var arr = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
            var blob = new Blob([arr], { type: mime });
            saveDocBlob(docBlobKey(fin, cfg.id), blob);
            migrated++;
          } catch(e) { console.warn('Migration error for', cfg.id, e); }
        } else if (oldData[nameKey]) {
          meta[cfg.id] = { name: oldData[nameKey] };
        }
      });
      if (Object.keys(meta).length > 0) saveDocMeta(fin, meta);
      localStorage.removeItem(oldKey);
      if (migrated > 0) console.log('Migrated', migrated, 'docs for FIN', fin, 'from localStorage to IndexedDB');
    });
    // Also remove the shared key if it exists
    var sharedKey = 'clerk_obs_docs_' + reviewId;
    if (localStorage.getItem(sharedKey)) localStorage.removeItem(sharedKey);
  })();

  function renderAllOfficeDocs() {
    if (!docContainer || _docOffices.length === 0) return;
    var configs = getAllDocConfigs();

    var html = '';
    _docOffices.forEach(function(office, oi) {
      var fin = office.financeNum || '';
      var meta = loadDocMeta(fin);
      var oName = office.officeName || ('FIN ' + fin);
      var dateRange = '';
      if (office.startDate && office.endDate) dateRange = ' <span style="color:var(--text-light);font-size:0.75rem;">(' + office.startDate + ' \u2013 ' + office.endDate + ')</span>';

      html += '<div class="wb-doc-office-block" data-fin="' + esc(fin) + '" style="margin-bottom:1.25rem;' + (oi > 0 ? 'padding-top:1rem;border-top:1px solid var(--border);' : '') + '">';
      html += '<h3 style="font-size:0.88rem;margin:0 0 0.5rem;">' + esc(oName) + dateRange + '</h3>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0.75rem;">';

      configs.forEach(function(cfg) {
        var docMeta = meta[cfg.id];
        var hasDoc = !!(docMeta && docMeta.name);
        var isCustom = !DEFAULT_DOC_CONFIGS.some(function(d) { return d.id === cfg.id; });

        html += '<div class="wb-doc-card" style="padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card-bg);">';
        html += '<h4 style="font-size:0.8rem;margin:0 0 0.3rem;">' + esc(cfg.label);
        if (isCustom) html += ' <span style="font-size:0.65rem;color:var(--text-light);">(custom)</span>';
        html += '</h4>';

        if (hasDoc) {
          html += '<div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">';
          html += '<span style="color:var(--success);font-size:0.76rem;">\u2713 ' + esc(docMeta.name) + '</span>';
          html += '<button class="btn btn-outline btn-sm wb-doc-view-btn" data-fin="' + esc(fin) + '" data-doc="' + cfg.id + '" style="font-size:0.68rem;padding:0.1rem 0.4rem;">View</button>';
          html += '<button class="btn btn-outline btn-sm wb-doc-dl-btn" data-fin="' + esc(fin) + '" data-doc="' + cfg.id + '" data-name="' + esc(docMeta.name) + '" style="font-size:0.68rem;padding:0.1rem 0.4rem;">⬇</button>';
          html += '<button class="btn btn-danger btn-sm wb-doc-del-btn" data-fin="' + esc(fin) + '" data-doc="' + cfg.id + '" style="font-size:0.68rem;padding:0.1rem 0.4rem;">Remove</button>';
          html += '</div>';
        } else {
          html += '<div class="wb-doc-upload-row" style="display:flex;align-items:center;gap:0.4rem;">';
          html += '<label class="btn btn-outline btn-sm" style="font-size:0.72rem;padding:0.15rem 0.5rem;cursor:pointer;">Choose File';
          html += '<input type="file" class="wb-doc-file-input" data-fin="' + esc(fin) + '" data-doc-id="' + cfg.id + '" accept=".pdf,.doc,.docx,.xlsx,.xlsb,.xls,.csv,.png,.jpg,.jpeg,.gif" style="display:none;">';
          html += '</label>';
          html += '<span class="wb-doc-chosen-name" style="font-size:0.72rem;color:var(--text-light);">No file chosen</span>';
          html += '</div>';
        }
        html += '</div>';
      });

      html += '</div></div>';
    });

    docContainer.innerHTML = html;
    wireDocEvents();
  }

  function wireDocEvents() {
    if (!docContainer) return;

    // File inputs
    docContainer.querySelectorAll('.wb-doc-file-input').forEach(function(inp) {
      inp.addEventListener('change', function() {
        var file = inp.files[0];
        if (!file) return;
        var docId = inp.dataset.docId;
        var srcFin = inp.dataset.fin;

        // Show chosen filename
        var nameSpan = inp.parentElement.parentElement.querySelector('.wb-doc-chosen-name');
        if (nameSpan) nameSpan.textContent = file.name;

        // Save blob to IndexedDB
        saveDocBlob(docBlobKey(srcFin, docId), file, function(err) {
          if (err) { alert('Error saving file: ' + err.message); return; }

          // Save metadata
          var meta = loadDocMeta(srcFin);
          meta[docId] = { name: file.name, size: file.size, uploadedAt: new Date().toISOString() };
          saveDocMeta(srcFin, meta);

          // Offer to apply to other offices
          if (_docOffices.length > 1) {
            var otherOffices = _docOffices.filter(function(o) { return (o.financeNum || '') !== srcFin; });
            if (otherOffices.length > 0 && confirm('Apply "' + file.name + '" to other offices too?')) {
              var pending = otherOffices.length;
              otherOffices.forEach(function(o) {
                var oFin = o.financeNum || '';
                var oName = o.officeName || ('FIN ' + oFin);
                if (confirm('Also apply to ' + oName + '?')) {
                  saveDocBlob(docBlobKey(oFin, docId), file, function() {
                    var oMeta = loadDocMeta(oFin);
                    oMeta[docId] = { name: file.name, size: file.size, uploadedAt: new Date().toISOString() };
                    saveDocMeta(oFin, oMeta);
                    pending--;
                    if (pending <= 0) renderAllOfficeDocs();
                  });
                } else {
                  pending--;
                  if (pending <= 0) renderAllOfficeDocs();
                }
              });
            } else {
              renderAllOfficeDocs();
            }
          } else {
            renderAllOfficeDocs();
          }
        });
      });
    });

    // View buttons — open blob in new tab
    docContainer.querySelectorAll('.wb-doc-view-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var docId = btn.dataset.doc;
        var fin = btn.dataset.fin;
        loadDocBlob(docBlobKey(fin, docId), function(err, blob) {
          if (err || !blob) { alert('File not found. It may have been cleared.'); return; }
          var url = URL.createObjectURL(blob);
          window.open(url, '_blank');
        });
      });
    });

    // Download buttons
    docContainer.querySelectorAll('.wb-doc-dl-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var docId = btn.dataset.doc;
        var fin = btn.dataset.fin;
        var name = btn.dataset.name || 'document';
        loadDocBlob(docBlobKey(fin, docId), function(err, blob) {
          if (err || !blob) { alert('File not found.'); return; }
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
        });
      });
    });

    // Delete buttons
    docContainer.querySelectorAll('.wb-doc-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var docId = btn.dataset.doc;
        var fin = btn.dataset.fin;
        var configs = getAllDocConfigs();
        var label = configs.find(function(c) { return c.id === docId; });
        if (!confirm('Remove ' + (label ? label.label : docId) + '?')) return;

        deleteDocBlob(docBlobKey(fin, docId), function() {
          var meta = loadDocMeta(fin);
          delete meta[docId];
          saveDocMeta(fin, meta);
          renderAllOfficeDocs();
        });
      });
    });
  }

  // Add custom document type
  if (addTypeBtn) {
    addTypeBtn.addEventListener('click', function() {
      var label = prompt('Enter document type name:');
      if (!label || !label.trim()) return;
      label = label.trim();
      var id = 'custom-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      var customs = loadCustomTypes();
      if (customs.some(function(c) { return c.id === id; }) || DEFAULT_DOC_CONFIGS.some(function(c) { return c.id === id; })) {
        alert('A document type with that name already exists.');
        return;
      }
      customs.push({ id: id, label: label });
      saveCustomTypes(customs);
      renderAllOfficeDocs();
    });
  }

  try { renderAllOfficeDocs(); } catch(e) { console.error('Doc cards error:', e); }

  // ===================== TRAVEL =====================

  var travelHotel = document.getElementById('wb-travel-hotel');
  var travelOffice = document.getElementById('wb-travel-office');
  var travelEstBtn = document.getElementById('wb-travel-estimate');
  var travelResults = document.getElementById('wb-travel-results');

  function estimateTravel() {
    var hotel = travelHotel ? travelHotel.value.trim() : '';
    var office = travelOffice ? travelOffice.value.trim() : '';
    if (!hotel || !office) {
      travelResults.innerHTML = '<p class="empty-state">Enter both hotel and office addresses.</p>';
      return;
    }

    // Save addresses
    var data = loadSched();
    data.travelHotel = hotel;
    data.travelOffice = office;
    saveSched(data);

    // Use Google Maps Directions API (or estimate if no API key)
    // For now, provide estimated calculations and a link to Google Maps
    var mapsUrl = 'https://www.google.com/maps/dir/' + encodeURIComponent(hotel) + '/' + encodeURIComponent(office);

    var html = '<div class="wb-travel-estimates">';
    html += '<h4 style="margin:0.5rem 0;font-size:0.88rem;">Travel Estimates: Hotel → Office</h4>';
    html += '<table class="wb-tacs-table">';
    html += '<thead><tr><th>Mode</th><th>Est. Time</th><th>Est. Cost</th><th>Notes</th></tr></thead>';
    html += '<tbody>';
    html += '<tr><td>🚶 Walking</td><td><input type="text" class="wb-travel-est-input" id="wb-travel-walk-time" placeholder="e.g. 25 min"></td><td>Free</td><td>Weather-dependent</td></tr>';
    html += '<tr><td>🚌 Public Transit</td><td><input type="text" class="wb-travel-est-input" id="wb-travel-transit-time" placeholder="e.g. 35 min"></td><td><input type="text" class="wb-travel-est-input" id="wb-travel-transit-cost" placeholder="$2.90"></td><td>Check local schedules</td></tr>';
    html += '<tr><td>🚕 Uber / Taxi</td><td><input type="text" class="wb-travel-est-input" id="wb-travel-uber-time" placeholder="e.g. 15 min"></td><td><input type="text" class="wb-travel-est-input" id="wb-travel-uber-cost" placeholder="$12-18"></td><td>Price varies by time</td></tr>';
    html += '</tbody></table>';
    html += '<div style="margin-top:0.5rem;">';
    html += '<a href="' + mapsUrl + '" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size:0.78rem;">Open in Google Maps ↗</a>';
    html += '</div></div>';

    // Return trip
    var mapsUrlReturn = 'https://www.google.com/maps/dir/' + encodeURIComponent(office) + '/' + encodeURIComponent(hotel);
    html += '<div class="wb-travel-estimates" style="margin-top:1rem;">';
    html += '<h4 style="margin:0.5rem 0;font-size:0.88rem;">Return: Office → Hotel</h4>';
    html += '<p style="font-size:0.78rem;color:var(--text-light);">Same estimates apply in reverse. ';
    html += '<a href="' + mapsUrlReturn + '" target="_blank" rel="noopener" style="font-size:0.78rem;">Open return route in Maps ↗</a></p>';
    html += '</div>';

    travelResults.innerHTML = html;

    // Restore saved estimates
    if (data.travelEstimates) {
      var est = data.travelEstimates;
      ['wb-travel-walk-time', 'wb-travel-transit-time', 'wb-travel-transit-cost', 'wb-travel-uber-time', 'wb-travel-uber-cost'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el && est[id]) el.value = est[id];
      });
    }

    // Bind save on travel estimate inputs
    travelResults.querySelectorAll('.wb-travel-est-input').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var d = loadSched();
        if (!d.travelEstimates) d.travelEstimates = {};
        d.travelEstimates[inp.id] = inp.value;
        saveSched(d);
      });
    });
  }

  if (travelEstBtn) {
    travelEstBtn.addEventListener('click', estimateTravel);
  }



  // ===================== INIT =====================

  // Render calendar on tab switch
  document.querySelectorAll('.wb-sub-tab').forEach(function(st) {
    st.addEventListener('click', function() {
      if (st.dataset.wbtab === 'wb-panel-calendar') { try { renderCalendar(); } catch(e) { console.error('Calendar render error:', e); } }
    });
  });

  // Initial calendar render if Information tab is active
  var activeCalTab = document.querySelector('.wb-sub-tab--active[data-wbtab="wb-panel-calendar"]');
  var calPanel = document.getElementById('wb-panel-calendar');
  if (activeCalTab || (calPanel && calPanel.classList.contains('wb-sub-panel--active'))) {
    try { renderCalendar(); } catch(e) { console.error('Calendar render error:', e); }
  }

  // Restore saved data
  var savedSched = loadSched();
  if (savedSched.travelHotel && travelHotel) travelHotel.value = savedSched.travelHotel;
  if (savedSched.travelOffice && travelOffice) travelOffice.value = savedSched.travelOffice;

  // Expose card builders for schedule viewer tab
  window.ScheduleCards = {
    reviewCard: function() { return buildScheduleCard(); },
    tripsCard: function() { return buildDailyTripsEmailCard(); },
    airportCard: function() {
      var td = loadTravelPlan();
      var tm = getReviewerTravelMap(td);
      var allSlots = loadAllOfficeSchedules();
      var roster = buildReviewerRoster(allSlots);
      return buildTravelCard(td, tm, roster);
    }
  };

})();
