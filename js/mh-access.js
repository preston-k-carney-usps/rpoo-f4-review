// mh-access.js — Mail Handler access request & approval system
// Allows reviewers to request access to MH employee notes they aren't assigned to.
// Assigned reviewer or leads can approve/deny requests.
(function() {
  'use strict';

  // --- Shared helpers ---
  var MH_ACCESS_PREFIX = 'clerk_obs_mh_access_';

  function getAccessKey(reviewId) { return MH_ACCESS_PREFIX + reviewId; }

  function loadAccess(reviewId) {
    try { return JSON.parse(localStorage.getItem(getAccessKey(reviewId))) || { requests: [], grants: [] }; }
    catch(e) { return { requests: [], grants: [] }; }
  }
  function saveAccess(reviewId, data) {
    localStorage.setItem(getAccessKey(reviewId), JSON.stringify(data));
  }

  // Get current user info
  function getCurrentUser() {
    var session = {};
    try { session = JSON.parse(localStorage.getItem('clerk_obs_session')) || {}; } catch(e) {}
    if (typeof Auth !== 'undefined' && Auth.getUserById) {
      return Auth.getUserById(session.id || session.userId || '') || null;
    }
    return null;
  }

  // Get schedule data for a review+office
  function getScheduleData(reviewId, financeNum) {
    var key = 'clerk_obs_schedule_' + reviewId + (financeNum ? '_' + financeNum : '');
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch(e) { return {}; }
  }

  // Find all MH slots across all offices for a review
  function getMhSlots(reviewId) {
    var rev = null;
    try { rev = (typeof Reviews !== 'undefined') ? Reviews.getById(reviewId) : null; } catch(e) {}
    if (!rev) return [];
    var offices = (rev.offices && rev.offices.length > 0)
      ? rev.offices
      : [{ officeName: rev.officeName || 'Office', financeNum: rev.financeNum || '' }];

    var slots = [];
    offices.forEach(function(office) {
      var fin = office.financeNum || '';
      var sched = getScheduleData(reviewId, fin);
      var schedule = sched.schedule || [];
      var assignedNames = sched.assignedNames || [];
      schedule.forEach(function(slot) {
        if (slot.craft === 'MH' && slot.mhName) {
          // Find the userId for the assigned reviewer
          var assignedUserId = null;
          if (slot.assignedTo) {
            for (var i = 0; i < assignedNames.length; i++) {
              if (assignedNames[i].name === slot.assignedTo && assignedNames[i].userId) {
                assignedUserId = assignedNames[i].userId;
                break;
              }
            }
          }
          slots.push({
            mhName: slot.mhName,
            assignedTo: slot.assignedTo || '',
            assignedUserId: assignedUserId,
            financeNum: fin,
            officeName: office.officeName || ''
          });
        }
      });
    });
    return slots;
  }

  // Check if a user has access to an MH employee (assigned or granted)
  function hasAccess(reviewId, userId, mhName) {
    // Check schedule assignment
    var slots = getMhSlots(reviewId);
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].mhName === mhName && slots[i].assignedUserId === userId) return true;
    }
    // Check granted access
    var data = loadAccess(reviewId);
    for (var j = 0; j < data.grants.length; j++) {
      var g = data.grants[j];
      if (g.userId === userId && g.mhName === mhName && g.status === 'approved') return true;
    }
    return false;
  }

  // Check if user can approve (is lead or is the assigned reviewer for this MH)
  function canApprove(reviewId, userId, mhName) {
    // Check if user is a lead
    var setup = {};
    try { setup = JSON.parse(localStorage.getItem('reviewDaySetup')) || {}; } catch(e) {}
    var role = setup.reviewRole || '';
    if (role === 'lead' || role === 'teamlead') return true;
    // Also check system role
    var user = getCurrentUser();
    if (user && (user.role === 'admin' || user.role === 'teamlead')) return true;
    // Check if assigned reviewer for this MH
    var slots = getMhSlots(reviewId);
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].mhName === mhName && slots[i].assignedUserId === userId) return true;
    }
    return false;
  }

  // Submit an access request
  function submitAccessRequest(reviewId, userId, userName, mhName) {
    var data = loadAccess(reviewId);
    // Check for existing pending request
    for (var i = 0; i < data.requests.length; i++) {
      if (data.requests[i].userId === userId && data.requests[i].mhName === mhName && data.requests[i].status === 'pending') {
        return false; // already pending
      }
    }
    data.requests.push({
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2),
      userId: userId,
      userName: userName,
      mhName: mhName,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    saveAccess(reviewId, data);
    return true;
  }

  // Approve a request
  function approveRequest(reviewId, requestId, approverName) {
    var data = loadAccess(reviewId);
    for (var i = 0; i < data.requests.length; i++) {
      if (data.requests[i].id === requestId) {
        data.requests[i].status = 'approved';
        data.requests[i].resolvedAt = new Date().toISOString();
        data.requests[i].resolvedBy = approverName;
        // Also add to grants for quick lookup
        data.grants.push({
          userId: data.requests[i].userId,
          userName: data.requests[i].userName,
          mhName: data.requests[i].mhName,
          status: 'approved',
          grantedAt: new Date().toISOString(),
          grantedBy: approverName
        });
        break;
      }
    }
    saveAccess(reviewId, data);
  }

  // Deny a request
  function denyRequest(reviewId, requestId, approverName) {
    var data = loadAccess(reviewId);
    for (var i = 0; i < data.requests.length; i++) {
      if (data.requests[i].id === requestId) {
        data.requests[i].status = 'denied';
        data.requests[i].resolvedAt = new Date().toISOString();
        data.requests[i].resolvedBy = approverName;
        break;
      }
    }
    saveAccess(reviewId, data);
  }

  // Revoke access grant
  function revokeGrant(reviewId, userId, mhName) {
    var data = loadAccess(reviewId);
    data.grants = data.grants.filter(function(g) {
      return !(g.userId === userId && g.mhName === mhName);
    });
    saveAccess(reviewId, data);
  }

  // Get pending requests for a specific MH employee
  function getPendingRequests(reviewId, mhName) {
    var data = loadAccess(reviewId);
    return data.requests.filter(function(r) {
      return r.status === 'pending' && (!mhName || r.mhName === mhName);
    });
  }

  // Get all pending requests for the review
  function getAllPendingRequests(reviewId) {
    return getPendingRequests(reviewId, null);
  }

  // Get grants for a user
  function getUserGrants(reviewId, userId) {
    var data = loadAccess(reviewId);
    return data.grants.filter(function(g) { return g.userId === userId && g.status === 'approved'; });
  }

  // Expose as global
  window.MhAccess = {
    loadAccess: loadAccess,
    getMhSlots: getMhSlots,
    hasAccess: hasAccess,
    canApprove: canApprove,
    submitAccessRequest: submitAccessRequest,
    approveRequest: approveRequest,
    denyRequest: denyRequest,
    revokeGrant: revokeGrant,
    getPendingRequests: getPendingRequests,
    getAllPendingRequests: getAllPendingRequests,
    getUserGrants: getUserGrants,
    getCurrentUser: getCurrentUser
  };
})();
