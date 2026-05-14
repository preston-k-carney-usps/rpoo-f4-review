/**
 * auth.js — Offline lead-only auth (replaces old auth system).
 *
 * No passwords, no sync, no user database.
 * Defaults to Review Lead on first run. Toggle in navbar switches
 * between Review Lead (admin) and Workbook Lead (teamlead).
 * POD reviewers get a separate tailored file.
 *
 * Maintains the same public API surface (Auth.*) so all existing code keeps working.
 */

var Auth = (function() {
  'use strict';

  var SESSION_KEY  = 'clerk_obs_session';
  var USERS_KEY    = 'clerk_obs_users';
  var REQUESTS_KEY = 'clerk_obs_requests';

  var ROLES = ['admin', 'teamlead', 'readonly', 'reviewer'];
  var ROLE_LABELS = { admin: 'Review Lead', teamlead: 'Workbook Lead', readonly: 'Read Only', reviewer: 'POD Reviewer' };
  var REVIEW_ROLE_LABELS = { clerk: 'Clerk Reviewer', mailhandler: 'Mail Handler Reviewer', lead: 'Workbook Lead', teamlead: 'Review Lead' };

  // ---- Session ----
  function currentUser() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return null;
  }

  function setSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = 'index.html';
  }

  // ---- Auto-create default session (Review Lead) ----
  function ensureSession() {
    var user = currentUser();
    if (user) return user;
    user = {
      id: 'local-' + crypto.randomUUID(),
      username: 'Lead',
      displayName: 'Lead',
      email: '',
      role: 'admin',
      _realRole: 'admin',
      assignedFins: [],
      createdAt: new Date().toISOString()
    };
    setSession(user);
    var users = getUsers();
    users.push(user);
    _saveUsers(users);
    return user;
  }

  // ---- Auth guard ----
  function requireAuth(allowedRoles) {
    return ensureSession();
  }

  // ---- Stub login (not used in offline mode) ----
  function login(usernameOrEmail, password, callback) {
    if (callback) callback({ error: 'Login not available in offline mode.' });
  }

  // ---- Navbar with role toggle ----
  function renderNavbar() {
    var user = ensureSession();
    var nav = document.querySelector('.navbar');
    if (!nav) return;

    // Remove existing user info
    var existing = document.getElementById('nav-user-info');
    if (existing) existing.remove();

    var info = document.createElement('div');
    info.id = 'nav-user-info';
    info.style.cssText = 'display:flex;align-items:center;gap:0.75rem;font-size:0.85rem;';

    var isAdmin = user.role === 'admin';

    info.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;background:var(--card-bg);' +
        'border:1px solid var(--border);border-radius:20px;padding:3px 4px;">' +
        '<button id="nav-role-review" style="padding:4px 12px;border-radius:16px;border:none;' +
          'font-size:0.78rem;font-weight:600;cursor:pointer;transition:all 0.2s;' +
          (isAdmin
            ? 'background:#4f46e5;color:#fff;'
            : 'background:transparent;color:var(--text-light);') +
          '">Review Lead</button>' +
        '<button id="nav-role-workbook" style="padding:4px 12px;border-radius:16px;border:none;' +
          'font-size:0.78rem;font-weight:600;cursor:pointer;transition:all 0.2s;' +
          (!isAdmin
            ? 'background:#4f46e5;color:#fff;'
            : 'background:transparent;color:var(--text-light);') +
          '">Workbook Lead</button>' +
      '</div>';

    nav.appendChild(info);

    document.getElementById('nav-role-review').addEventListener('click', function() {
      if (user.role === 'admin') return;
      user.role = 'admin';
      user._realRole = 'admin';
      setSession(user);
      window.location.reload();
    });
    document.getElementById('nav-role-workbook').addEventListener('click', function() {
      if (user.role === 'teamlead') return;
      user.role = 'teamlead';
      user._realRole = 'teamlead';
      setSession(user);
      window.location.reload();
    });
  }

  // ---- Debug drawer (no-op in offline mode) ----
  function renderDebugDrawer() {}
  function switchRole() {}
  function getRealRole() { var u = currentUser(); return u ? u.role : ''; }

  // ---- Users CRUD (local storage, for compatibility) ----
  function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
    catch(e) { return []; }
  }

  function _saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function getUserById(id) {
    var users = getUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) return users[i];
    }
    return null;
  }

  function createUser(data) {
    var users = getUsers();
    var name = (data.displayName || data.username || '').trim();
    if (!name) return { error: 'Name is required' };
    // Check duplicate
    var lname = name.toLowerCase();
    for (var i = 0; i < users.length; i++) {
      if ((users[i].username || '').toLowerCase() === lname) {
        return { error: 'User already exists: ' + name };
      }
    }
    var user = {
      id: crypto.randomUUID(),
      username: name,
      displayName: name,
      email: data.email || '',
      role: data.role || 'reviewer',
      assignedFins: data.assignedFins || [],
      password: data.password || '',
      mustChangePassword: false,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    _saveUsers(users);
    return user;
  }

  function bulkCreate(entries, role) {
    var results = { created: [], errors: [] };
    entries.forEach(function(raw) {
      var name = (typeof raw === 'object') ? (raw.name || '').trim() : (raw || '').trim();
      var email = (typeof raw === 'object') ? (raw.email || '').trim() : '';
      if (!name) return;
      var res = createUser({ displayName: name, email: email, role: role || 'reviewer' });
      if (res.error) results.errors.push(name + ': ' + res.error);
      else results.created.push(res);
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
        if (data.password !== undefined) users[i].password = data.password;
        if (data.mustChangePassword !== undefined) users[i].mustChangePassword = data.mustChangePassword;
        _saveUsers(users);
        return users[i];
      }
    }
    return null;
  }

  function deleteUser(id) {
    var users = getUsers().filter(function(u) { return u.id !== id; });
    _saveUsers(users);
  }

  // ---- Permission checks ----
  function isAdmin()    { var u = currentUser(); return u && u.role === 'admin'; }
  function isReadOnly() { var u = currentUser(); return u && u.role === 'readonly'; }
  function isReviewer() { var u = currentUser(); return u && u.role === 'reviewer'; }
  function isTeamLead() { var u = currentUser(); return u && u.role === 'teamlead'; }

  function canEdit() { var u = currentUser(); return u && u.role !== 'readonly'; }
  function canDelete() { var u = currentUser(); return u && (u.role === 'admin' || u.role === 'teamlead'); }
  function canCreate() { return canEdit(); }

  function filterVisible(observations) {
    // Offline mode: everything is visible
    return observations;
  }

  function isAssignedOffice(financeNum) { return true; }

  // ---- Stubs for features not used in offline mode ----
  function hashPassword(pw) { return Promise.resolve(pw); }
  function verifyPassword(pw, hash) { return Promise.resolve(true); }
  function resetPassword() { return null; }
  function getRequests() { return []; }
  function submitRequest() { return null; }
  function resolveRequest() { return null; }
  function findMatchingUser() { return null; }

  // ---- Escape helper ----
  function esc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ---- Dark mode ----
  if (localStorage.getItem('clerk_obs_dark') !== '0') {
    document.documentElement.classList.add('dark');
  }

  function bootstrap() {}

  return {
    bootstrap: bootstrap,
    getUsers: getUsers,
    bulkCreate: bulkCreate,
    createUser: createUser,
    updateUser: updateUser,
    deleteUser: deleteUser,
    getUserById: getUserById,
    login: login,
    logout: logout,
    currentUser: currentUser,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    resetPassword: resetPassword,
    requireAuth: requireAuth,
    isAdmin: isAdmin,
    isReadOnly: isReadOnly,
    isReviewer: isReviewer,
    isTeamLead: isTeamLead,
    canEdit: canEdit,
    canDelete: canDelete,
    canCreate: canCreate,
    filterVisible: filterVisible,
    isAssignedOffice: isAssignedOffice,
    renderNavbar: renderNavbar,
    renderDebugDrawer: renderDebugDrawer,
    switchRole: switchRole,
    getRealRole: getRealRole,
    getRequests: getRequests,
    submitRequest: submitRequest,
    resolveRequest: resolveRequest,
    findMatchingUser: findMatchingUser,
    ROLES: ROLES,
    ROLE_LABELS: ROLE_LABELS,
    REVIEW_ROLE_LABELS: REVIEW_ROLE_LABELS
  };
})();
