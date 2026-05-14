/**
 * auth-offline.js — No-profile stub.
 *
 * No sessions, no profiles, no login, no role picker.
 * Everyone sees the same lead view. The reviewer name list
 * (clerk_obs_users) is kept for office assignments.
 *
 * Exposes the same Auth.* API surface so existing code keeps working.
 */

var Auth = (function() {
  'use strict';

  var USERS_KEY = 'clerk_obs_users';

  // Static default user — no session storage, always the same
  var DEFAULT_USER = {
    id: 'lead',
    username: 'Lead',
    displayName: 'Lead',
    email: '',
    role: 'admin',
    _realRole: 'admin',
    assignedFins: []
  };

  var ROLES = ['admin', 'teamlead', 'readonly', 'reviewer'];
  var ROLE_LABELS = { admin: 'Review Lead', teamlead: 'Workbook Lead', readonly: 'Read Only', reviewer: 'POD Reviewer' };
  var REVIEW_ROLE_LABELS = { clerk: 'Clerk Reviewer', mailhandler: 'Mail Handler Reviewer', lead: 'Workbook Lead', teamlead: 'Review Lead' };

  function currentUser() { return DEFAULT_USER; }
  function requireAuth() { return DEFAULT_USER; }
  function renderNavbar() {} // no-op — no user info to display
  function renderDebugDrawer() {}
  function login(u, p, cb) { if (cb) cb(DEFAULT_USER); }
  function logout() { window.location.href = 'index.html'; }
  function bootstrap() {}
  function switchRole() {}
  function getRealRole() { return 'admin'; }

  // ---- Permission checks (always lead) ----
  function isAdmin()    { return true; }
  function isReadOnly() { return false; }
  function isReviewer() { return false; }
  function isTeamLead() { return false; }
  function canEdit()    { return true; }
  function canDelete()  { return true; }
  function canCreate()  { return true; }
  function filterVisible(obs) { return obs; }
  function isAssignedOffice() { return true; }

  // ---- Reviewer name list (kept for office assignments) ----
  function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
    catch(e) { return []; }
  }
  function _saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

  function getUserById(id) {
    if (id === 'lead') return DEFAULT_USER;
    var users = getUsers();
    for (var i = 0; i < users.length; i++) { if (users[i].id === id) return users[i]; }
    return null;
  }

  function createUser(data) {
    var users = getUsers();
    var name = (data.displayName || data.username || '').trim();
    if (!name) return { error: 'Name is required' };
    var lname = name.toLowerCase();
    for (var i = 0; i < users.length; i++) {
      if ((users[i].username || '').toLowerCase() === lname) return { error: 'Already exists: ' + name };
    }
    var u = { id: crypto.randomUUID(), username: name, displayName: name, email: data.email || '',
              role: data.role || 'reviewer', assignedFins: data.assignedFins || [], createdAt: new Date().toISOString() };
    users.push(u);
    _saveUsers(users);
    return u;
  }

  function bulkCreate(entries, role) {
    var results = { created: [], errors: [] };
    (entries || []).forEach(function(raw) {
      var name = (typeof raw === 'object') ? (raw.name || '').trim() : (raw || '').trim();
      var email = (typeof raw === 'object') ? (raw.email || '').trim() : '';
      if (!name) return;
      var res = createUser({ displayName: name, email: email, role: role || 'reviewer' });
      if (res.error) results.errors.push(name + ': ' + res.error); else results.created.push(res);
    });
    return results;
  }

  function updateUser(id, data) {
    var users = getUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) {
        if (data.displayName !== undefined) { users[i].displayName = data.displayName; users[i].username = data.displayName; }
        if (data.role !== undefined) users[i].role = data.role;
        if (data.email !== undefined) users[i].email = data.email;
        if (data.assignedFins !== undefined) users[i].assignedFins = data.assignedFins;
        _saveUsers(users);
        return users[i];
      }
    }
    return null;
  }

  function deleteUser(id) {
    _saveUsers(getUsers().filter(function(u) { return u.id !== id; }));
  }

  // ---- Stubs ----
  function hashPassword(pw) { return Promise.resolve(pw); }
  function verifyPassword() { return Promise.resolve(true); }
  function resetPassword() { return null; }
  function getRequests() { return []; }
  function submitRequest() { return null; }
  function resolveRequest() { return null; }
  function findMatchingUser() { return null; }

  // ---- Dark mode ----
  if (localStorage.getItem('clerk_obs_dark') !== '0') {
    document.documentElement.classList.add('dark');
  }

  return {
    bootstrap: bootstrap, currentUser: currentUser, requireAuth: requireAuth,
    login: login, logout: logout,
    renderNavbar: renderNavbar, renderDebugDrawer: renderDebugDrawer,
    switchRole: switchRole, getRealRole: getRealRole,
    isAdmin: isAdmin, isReadOnly: isReadOnly, isReviewer: isReviewer, isTeamLead: isTeamLead,
    canEdit: canEdit, canDelete: canDelete, canCreate: canCreate,
    filterVisible: filterVisible, isAssignedOffice: isAssignedOffice,
    getUsers: getUsers, getUserById: getUserById,
    createUser: createUser, bulkCreate: bulkCreate, updateUser: updateUser, deleteUser: deleteUser,
    hashPassword: hashPassword, verifyPassword: verifyPassword, resetPassword: resetPassword,
    getRequests: getRequests, submitRequest: submitRequest, resolveRequest: resolveRequest,
    findMatchingUser: findMatchingUser,
    ROLES: ROLES, ROLE_LABELS: ROLE_LABELS, REVIEW_ROLE_LABELS: REVIEW_ROLE_LABELS
  };
})();
