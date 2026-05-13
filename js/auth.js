/**
 * auth.js — Role-based access control.
 *
 * Access Levels (system-wide):
 *   admin    — Full access. Edit/delete all notes. Manage users/reviews.
 *   teamlead — Create/edit review schedules, travel surveys, assigned offices.
 *   readonly — View all notes + dashboard for assigned offices. No editing.
 *   reviewer — View/edit OWN notes from assigned reviews. Auto-lock after 7 days.
 *
 * Review Roles (per-review, non-transferable):
 *   clerk        — Clerk observation sheet
 *   mailhandler  — Mail handler observation sheet
 *   lead         — Workbook lead: compiled view + all reviewer access
 *
 * Data stored in localStorage:
 *   clerk_obs_users    — Array of user objects
 *   clerk_obs_session  — Current logged-in user
 *   clerk_obs_requests — Access/role requests
 */

var Auth = (function() {
  var USERS_KEY    = 'clerk_obs_users';
  var SESSION_KEY  = 'clerk_obs_session';
  var REQUESTS_KEY = 'clerk_obs_requests';
  var ROLES = ['admin', 'teamlead', 'readonly', 'reviewer'];

  // --- Bootstrap: create default admin on first run ---
  function bootstrap() {
    var users = getUsers();
    var now = new Date().toISOString();

    if (users.length === 0) {
      // First run: no default account. Show setup prompt.
      // Admin must set up via the app's first-run wizard.
      return;
    }
  }

  // --- Users CRUD ---
  function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
    catch(e) { return []; }
  }

  function _saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function createUser(data) {
    var users = getUsers();
    var name = (data.displayName || data.username || '').trim();
    // Check duplicate by name (case-insensitive)
    for (var i = 0; i < users.length; i++) {
      if (users[i].username.toLowerCase() === name.toLowerCase()) {
        return { error: 'User "' + name + '" already exists.' };
      }
    }
    var user = {
      id: crypto.randomUUID(),
      username: name,
      password: data.password || '', // caller must pre-hash
      displayName: name,
      email: data.email || '',
      role: data.role || 'reviewer',
      assignedFins: data.assignedFins || [],
      mustChangePassword: data.mustChangePassword !== false,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    _saveUsers(users);
    return user;
  }

  /** Bulk create users from an array of {name, email} objects or plain strings. Returns { created: [], errors: [] } */
  function bulkCreate(entries, role) {
    var results = { created: [], errors: [] };
    entries.forEach(function(raw) {
      var name, email;
      if (typeof raw === 'object') { name = (raw.name || '').trim(); email = (raw.email || '').trim(); }
      else { name = (raw || '').trim(); email = ''; }
      if (!name) return;
      var pw = name.toLowerCase().replace(/\s+/g, '');
      var res = createUser({ displayName: name, email: email, password: pw, role: role || 'reviewer', mustChangePassword: true });
      if (res.error) results.errors.push(name + ': ' + res.error);
      else results.created.push(res);
    });
    return results;
  }

  function updateUser(id, data) {
    var users = getUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) {
        if (data.displayName !== undefined) {
          users[i].displayName = data.displayName;
          users[i].username = data.displayName; // keep in sync
        }
        if (data.password !== undefined && data.password !== '') {
          users[i].password = data.password; // caller must pre-hash
          if (data.mustChangePassword === undefined) users[i].mustChangePassword = false;
        }
        if (data.mustChangePassword !== undefined) users[i].mustChangePassword = data.mustChangePassword;
        if (data.role !== undefined) users[i].role = data.role;
        if (data.email !== undefined) users[i].email = data.email;
        if (data.assignedFins !== undefined) users[i].assignedFins = data.assignedFins;
        _saveUsers(users);
        // Update session if editing self
        var session = currentUser();
        if (session && session.id === id) setSession(users[i]);
        return users[i];
      }
    }
    return null;
  }

  function deleteUser(id) {
    var users = getUsers().filter(function(u) { return u.id !== id; });
    _saveUsers(users);
  }

  function getUserById(id) {
    var users = getUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) return users[i];
    }
    return null;
  }

  // --- Session ---
  function setSession(user) {
    var session = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email || '',
      role: user.role,
      assignedFins: user.assignedFins || [],
      mustChangePassword: !!user.mustChangePassword
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function currentUser() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
    catch(e) { return null; }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = 'login.html';
  }

  // --- Password hashing (SHA-256) ---
  function hashPassword(pw) {
    var enc = new TextEncoder().encode(pw);
    return crypto.subtle.digest('SHA-256', enc).then(function(buf) {
      var arr = Array.from(new Uint8Array(buf));
      return arr.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  function isHashed(pw) {
    return typeof pw === 'string' && pw.length === 64 && /^[0-9a-f]{64}$/.test(pw);
  }

  // --- Login (async — returns Promise) ---
  function login(email, password) {
    var users = getUsers();
    var match = null;
    var loginLower = email.toLowerCase();
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (!u) continue;
      // Match by email (primary) or username (fallback for legacy)
      if ((u.email && u.email.toLowerCase() === loginLower) ||
          (u.username && u.username.toLowerCase() === loginLower)) {
        match = u;
        break;
      }
    }
    if (!match) return Promise.resolve(null);

    // Account must be activated (not mustChangePassword) to login
    if (match.mustChangePassword) return Promise.resolve({ error: 'pending' });

    if (isHashed(match.password)) {
      return hashPassword(password).then(function(h) {
        if (h === match.password) { setSession(match); return match; }
        return null;
      });
    }
    // Legacy plain-text fallback — upgrade to hash on successful login
    if (match.password === password) {
      return hashPassword(password).then(function(h) {
        match.password = h;
        _saveUsers(users);
        setSession(match);
        return match;
      });
    }
    return Promise.resolve(null);
  }

  // --- Verify a password against stored hash (async) ---
  function verifyPassword(userId, pw) {
    var user = getUserById(userId);
    if (!user) return Promise.resolve(false);
    if (isHashed(user.password)) {
      return hashPassword(pw).then(function(h) { return h === user.password; });
    }
    return Promise.resolve(user.password === pw);
  }

  // --- Admin: reset password (sets mustChangePassword) ---
  function resetPassword(userId) {
    var tempPw = 'changeme';
    return hashPassword(tempPw).then(function(h) {
      updateUser(userId, { password: h, mustChangePassword: true });
      return tempPw;
    });
  }

  // --- Match account request to existing seeded user ---
  function findMatchingUser(firstName, lastName, email) {
    var users = getUsers();
    var emailLower = (email || '').toLowerCase();
    var nameLower = (lastName + ', ' + firstName).toLowerCase();
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      // Match by email first
      if (emailLower && u.email && u.email.toLowerCase() === emailLower) return u;
      // Then match by display name (Last, First format)
      if (u.displayName && u.displayName.toLowerCase() === nameLower) return u;
      // Partial name match (last name + first name substring)
      if (u.displayName && u.displayName.toLowerCase().indexOf(lastName.toLowerCase()) === 0 &&
          u.displayName.toLowerCase().indexOf(firstName.toLowerCase()) > 0) return u;
    }
    return null;
  }

  // --- Authorization checks ---
  function requireAuth(allowedRoles) {
    bootstrap();
    var user = currentUser();
    if (!user) {
      window.location.href = 'login.html';
      return null;
    }
    if (allowedRoles && allowedRoles.indexOf(user.role) === -1) {
      window.location.href = 'index.html';
      return null;
    }
    return user;
  }

  function isAdmin()    { var u = currentUser(); return u && u.role === 'admin'; }
  function isReadOnly() { var u = currentUser(); return u && u.role === 'readonly'; }
  function isReviewer() { var u = currentUser(); return u && u.role === 'reviewer'; }
  function isTeamLead() { var u = currentUser(); return u && u.role === 'teamlead'; }

  /** Can the current user edit a given observation? */
  function canEdit(obs) {
    var user = currentUser();
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'teamlead') return true;
    if (user.role === 'readonly') return false;
    if (user.role === 'reviewer') {
      // Can only edit OWN notes
      if (obs.userId !== user.id) return false;
      // Check review date window: 1 week before start to 1 week after end
      if (obs.reviewId) {
        var rev = Reviews.getById(obs.reviewId);
        if (rev) {
          var now = new Date();
          var start = new Date(rev.startDate + 'T00:00:00');
          var end = new Date(rev.endDate + 'T23:59:59');
          var windowStart = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
          var windowEnd = new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000);
          if (now < windowStart || now > windowEnd) return false;
          return true;
        }
      }
      // Fallback for legacy data without reviewId: allow within 7 days of creation
      if (obs.createdAt) {
        var created = new Date(obs.createdAt);
        var now2 = new Date();
        var diffDays = (now2 - created) / (1000 * 60 * 60 * 24);
        if (diffDays > 7) return false;
      }
      return true;
    }
    return false;
  }

  /** Can the current user delete a given observation? */
  function canDelete(obs) {
    var user = currentUser();
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'teamlead') return true;
    // Only admin/teamlead can delete
    return false;
  }

  /** Can the current user create new observations? */
  function canCreate() {
    var user = currentUser();
    if (!user) return false;
    return user.role === 'admin' || user.role === 'teamlead' || user.role === 'reviewer';
  }

  /** Filter observations for current user's visibility */
  function filterVisible(observations) {
    var user = currentUser();
    if (!user) return [];
    if (user.role === 'admin' || user.role === 'readonly' || user.role === 'teamlead') return observations;
    if (user.role === 'reviewer') {
      // Only own notes
      return observations.filter(function(o) { return o.userId === user.id; });
    }
    return [];
  }

  /** Check if a finance number is assigned to the current user */
  function isAssignedOffice(financeNum) {
    var user = currentUser();
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'teamlead') return true;
    if (user.role === 'reviewer') {
      return user.assignedFins.indexOf(financeNum) >= 0;
    }
    if (user.role === 'readonly') {
      return user.assignedFins.indexOf(financeNum) >= 0;
    }
    return false;
  }

  /** Render the navbar user badge + logout */
  function renderNavbar() {
    var user = currentUser();
    if (!user) return;
    var nav = document.querySelector('.nav-links');
    if (!nav) return;

    // Add admin link for admins & teamleads — insert before Table of Contents
    if (user.role === 'admin' || user.role === 'teamlead') {
      var adminLink = document.createElement('a');
      adminLink.href = 'admin.html';
      adminLink.textContent = 'Manage Reviews';
      if (window.location.pathname.indexOf('admin') >= 0) adminLink.className = 'active';
      var tocLink = nav.querySelector('a[href="help.html"]');
      if (tocLink) { nav.insertBefore(adminLink, tocLink); }
      else { nav.appendChild(adminLink); }
    }

    // Settings link
    var settingsLink = document.createElement('a');
    settingsLink.href = 'settings.html';
    settingsLink.innerHTML = '&#9881;';
    settingsLink.title = 'Settings';
    settingsLink.style.fontSize = '1.1rem';
    if (window.location.pathname.indexOf('settings') >= 0) settingsLink.className = 'active';
    nav.appendChild(settingsLink);

    // User badge
    var badge = document.createElement('span');
    badge.className = 'nav-user-badge';
    var roleLabels = { admin: 'Admin', teamlead: 'Review Lead', readonly: 'Read Only', reviewer: 'POD' };
    badge.innerHTML = '<span class="nav-user-name">' + _escHtml(user.displayName) + '</span>' +
      '<span class="nav-role-tag role-' + user.role + '">' + roleLabels[user.role] + '</span>';
    nav.appendChild(badge);

    // Logout
    var logoutLink = document.createElement('a');
    logoutLink.href = '#';
    logoutLink.textContent = 'Logout';
    logoutLink.className = 'nav-logout';
    logoutLink.addEventListener('click', function(e) {
      e.preventDefault();
      logout();
    });
    nav.appendChild(logoutLink);

    // Auto-attach debug drawer
    renderDebugDrawer();
  }

  function _escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Role display labels
  var ROLE_LABELS = { admin: 'Admin', teamlead: 'Review Lead', readonly: 'Read Only', reviewer: 'POD' };

  // Review role labels
  var REVIEW_ROLE_LABELS = { clerk: 'Clerk Reviewer', mailhandler: 'Mail Handler Reviewer', lead: 'Lead', teamlead: 'Review Lead' };

  // --- Access / Role Requests ---
  function getRequests() {
    try { return JSON.parse(localStorage.getItem(REQUESTS_KEY)) || []; }
    catch(e) { return []; }
  }
  function _saveRequests(reqs) { localStorage.setItem(REQUESTS_KEY, JSON.stringify(reqs)); }
  function submitRequest(data) {
    var reqs = getRequests();
    reqs.push({
      id: crypto.randomUUID(),
      type: data.type || 'account', // 'account' | 'review_role' | 'fin_access'
      firstName: data.firstName || '',
      lastName: data.lastName || '',
      email: data.email || '',
      password: data.password || '', // pre-hashed
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    _saveRequests(reqs);
  }

  function resolveRequest(id, status, role) {
    var reqs = getRequests();
    for (var i = 0; i < reqs.length; i++) {
      if (reqs[i].id === id) {
        reqs[i].status = status;
        reqs[i].resolvedAt = new Date().toISOString();
        var assignRole = role || 'reviewer';

        if (status === 'approved' && reqs[i].type === 'account') {
          // Try to match to existing seeded user
          var match = findMatchingUser(reqs[i].firstName, reqs[i].lastName, reqs[i].email);
          if (match) {
            // Update existing user: set their password and activate
            match.password = reqs[i].password;
            match.email = reqs[i].email;
            match.role = assignRole;
            match.mustChangePassword = false;
            _saveUsers(getUsers().map(function(u) { return u.id === match.id ? match : u; }));
            reqs[i].matchedUserId = match.id;
            reqs[i].matchedUserName = match.displayName;
          } else {
            // Create new user
            var displayName = reqs[i].lastName + ', ' + reqs[i].firstName;
            var result = createUser({
              displayName: displayName,
              email: reqs[i].email,
              password: reqs[i].password,
              role: assignRole,
              mustChangePassword: false
            });
            if (result && result.id) {
              reqs[i].createdUserId = result.id;
            }
          }
          // Consume the token
          if (reqs[i].token) consumeToken(reqs[i].token);
        }
        break;
      }
    }
    _saveRequests(reqs);
  }

  // --- Role Switcher (admin debug) ---
  // Debug user map: switch to the actual debug account for that role
  var DEBUG_USERS = {
    admin:    'admin',
    teamlead: 'adminteamlead',
    readonly: 'adminreadonly',
    reviewer: 'adminreviewer'
  };

  function switchRole(role) {
    var session = currentUser();
    if (!session) return;
    // Store the real role so we can restore it
    if (!session._realRole) {
      session._realRole = session.role;
    }
    session.role = role;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.location.reload();
  }

  function getRealRole() {
    var session = currentUser();
    if (!session) return null;
    return session._realRole || session.role;
  }

  // --- Admin Tools Drawer (collapsible left-side panel) ---
  function renderDebugDrawer() {
    var users = getUsers();
    var session = currentUser();
    if (!session || !users.length) return;

    // Always render right-side Tools drawer for everyone
    renderToolboxDrawer();

    // Only show debug drawer for admin (real role)
    var realRole = session._realRole || session.role;
    if (realRole !== 'admin') return;

    var drawer = document.createElement('div');
    drawer.id = 'debug-drawer';
    drawer.className = 'debug-drawer debug-drawer--collapsed';

    var tab = document.createElement('button');
    tab.className = 'debug-drawer-tab';
    tab.innerHTML = '&#9881;';
    tab.title = 'Role Switcher';
    tab.addEventListener('click', function() {
      drawer.classList.toggle('debug-drawer--collapsed');
    });
    drawer.appendChild(tab);

    var panel = document.createElement('div');
    panel.className = 'debug-drawer-panel';
    panel.innerHTML = '<div class="debug-drawer-title">Role Switcher</div>';

    // Show current status
    if (session._realRole && session.role !== session._realRole) {
      var info = document.createElement('div');
      info.style.cssText = 'padding:6px 8px;margin-bottom:8px;background:#7c2d12;color:#fed7aa;border-radius:6px;font-size:0.75rem;text-align:center;';
      info.textContent = 'Viewing as: ' + (ROLE_LABELS[session.role] || session.role);
      panel.appendChild(info);

      var restoreBtn = document.createElement('button');
      restoreBtn.className = 'debug-drawer-user debug-drawer-user--active';
      restoreBtn.textContent = 'Restore: ' + (ROLE_LABELS[session._realRole] || session._realRole);
      restoreBtn.addEventListener('click', function() {
        session.role = session._realRole;
        delete session._realRole;
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        window.location.reload();
      });
      panel.appendChild(restoreBtn);

      var sep = document.createElement('hr');
      sep.style.cssText = 'border:none;border-top:1px solid #334155;margin:8px 0;';
      panel.appendChild(sep);
    }

    // Role switch buttons
    var rolesHdr = document.createElement('div');
    rolesHdr.className = 'debug-drawer-role-hdr';
    rolesHdr.textContent = 'Temp Role Switch';
    panel.appendChild(rolesHdr);

    var roles = ['admin', 'teamlead', 'readonly', 'reviewer'];
    roles.forEach(function(r) {
      var btn = document.createElement('button');
      btn.className = 'debug-drawer-user' + (session.role === r ? ' debug-drawer-user--active' : '');
      btn.textContent = ROLE_LABELS[r] || r;
      btn.addEventListener('click', function() {
        switchRole(r);
      });
      panel.appendChild(btn);
    });

    // User switch buttons
    var userHdr = document.createElement('div');
    userHdr.className = 'debug-drawer-role-hdr';
    userHdr.style.marginTop = '0.5rem';
    userHdr.textContent = 'Switch User';
    panel.appendChild(userHdr);

    var roleOrder = { admin: 0, teamlead: 1, readonly: 2, reviewer: 3 };
    var sorted = users.slice().sort(function(a, b) {
      var ra = roleOrder[a.role] !== undefined ? roleOrder[a.role] : 9;
      var rb = roleOrder[b.role] !== undefined ? roleOrder[b.role] : 9;
      if (ra !== rb) return ra - rb;
      return (a.displayName || '').localeCompare(b.displayName || '');
    });

    var lastRole = '';
    sorted.forEach(function(u) {
      if (u.role !== lastRole) {
        lastRole = u.role;
        var hdr = document.createElement('div');
        hdr.className = 'debug-drawer-role-hdr';
        hdr.style.fontSize = '0.65rem';
        hdr.textContent = ROLE_LABELS[u.role] || u.role;
        panel.appendChild(hdr);
      }
      var btn = document.createElement('button');
      btn.className = 'debug-drawer-user' + (u.id === session.id ? ' debug-drawer-user--active' : '');
      var signedUp = !u.mustChangePassword;
      btn.textContent = (signedUp ? '✅ ' : '') + (u.displayName || u.username);
      if (signedUp) btn.title = 'Has signed up';
      btn.addEventListener('click', function() {
        setSession(u);
        window.location.reload();
      });
      panel.appendChild(btn);
    });

    // --- Travel Survey Randomizer section ---
    var randHdr = document.createElement('div');
    randHdr.className = 'debug-drawer-role-hdr';
    randHdr.style.marginTop = '0.75rem';
    randHdr.textContent = '🎲 Travel Survey Randomizer';
    panel.appendChild(randHdr);

    var randWrap = document.createElement('div');
    randWrap.style.cssText = 'padding:0.35rem 0.5rem;';
    randWrap.innerHTML =
      '<div id="dd-rand-info" style="font-size:0.72rem;color:var(--text-light);margin-bottom:0.3rem;"></div>' +
      '<button id="dd-rand-btn" class="btn btn-primary btn-sm" style="width:100%;font-size:0.75rem;padding:0.3rem 0.4rem;">🎲 Randomize Pending Surveys</button>' +
      '<div id="dd-rand-result" style="min-height:20px;padding:0.3rem;margin-top:0.3rem;background:var(--bg-light);border:1px solid var(--border);border-radius:4px;font-size:0.78rem;white-space:pre-line;"></div>';
    panel.appendChild(randWrap);

    // --- Mock Data Generator Buttons ---
    if (typeof MockData !== 'undefined') {
      var mockHdr = document.createElement('div');
      mockHdr.className = 'debug-drawer-role-hdr';
      mockHdr.style.marginTop = '0.75rem';
      mockHdr.textContent = '🧪 Mock Data Generators';
      panel.appendChild(mockHdr);

      var mockWrap = document.createElement('div');
      mockWrap.style.cssText = 'padding:0.35rem 0.5rem;display:flex;flex-direction:column;gap:0.3rem;';

      var mockStatus = document.createElement('div');
      mockStatus.style.cssText = 'font-size:0.72rem;color:var(--success);min-height:1.2em;';

      function addMockBtn(label, emoji, fn) {
        var b = document.createElement('button');
        b.className = 'btn btn-outline btn-sm';
        b.style.cssText = 'width:100%;font-size:0.72rem;padding:0.3rem 0.4rem;text-align:left;';
        b.textContent = emoji + ' ' + label;
        b.addEventListener('click', function() {
          mockStatus.textContent = 'Generating...';
          mockStatus.style.color = 'var(--warning)';
          setTimeout(function() {
            try {
              var result = fn();
              mockStatus.style.color = 'var(--success)';
              mockStatus.textContent = '✅ Done! Reload to see data.';
            } catch(e) {
              mockStatus.style.color = 'var(--danger)';
              mockStatus.textContent = '❌ ' + e.message;
            }
          }, 50);
        });
        mockWrap.appendChild(b);
      }

      // Track last created review for chaining
      var _lastMockReviewId = null;

      addMockBtn('Create Mock Review', '📋', function() {
        var r = MockData.generateReview();
        _lastMockReviewId = r.id;
        return r;
      });

      addMockBtn('Generate Pre-Review Plan', '✈️', function() {
        var rid = _lastMockReviewId || _findLatestMockReview();
        if (!rid) throw new Error('Create a mock review first.');
        return MockData.generatePreReview(rid);
      });

      addMockBtn('Generate Review Period Notes', '📝', function() {
        var rid = _lastMockReviewId || _findLatestMockReview();
        if (!rid) throw new Error('Create a mock review first.');
        return MockData.generateReviewPeriod(rid);
      });

      addMockBtn('Generate Post-Review Data', '📊', function() {
        var rid = _lastMockReviewId || _findLatestMockReview();
        if (!rid) throw new Error('Create a mock review first.');
        return MockData.generatePostReview(rid);
      });

      addMockBtn('Generate EVERYTHING (Full Mock)', '🚀', function() {
        var r = MockData.generateAll();
        if (r) _lastMockReviewId = r.id;
        return r;
      });

      function _findLatestMockReview() {
        try {
          var revs = JSON.parse(localStorage.getItem('clerk_obs_reviews') || '[]');
          for (var i = revs.length - 1; i >= 0; i--) {
            if (revs[i].name && revs[i].name.indexOf('Mock') !== -1) return revs[i].id;
          }
          if (revs.length > 0) return revs[revs.length - 1].id;
        } catch(e) {}
        return null;
      }

      mockWrap.appendChild(mockStatus);
      panel.appendChild(mockWrap);
    }

    drawer.appendChild(panel);
    document.body.appendChild(drawer);

    // Wire randomizer — auto-fill pending travel surveys with random data
    var ddRandInfo = document.getElementById('dd-rand-info');
    var ddRandBtn = document.getElementById('dd-rand-btn');
    var ddRandResult = document.getElementById('dd-rand-result');

    function ddGetTravelKey() {
      var setup = null;
      try { setup = JSON.parse(localStorage.getItem('reviewDaySetup')); } catch(e) {}
      var reviewId = (setup && setup.reviewId) || '';
      if (!reviewId) {
        var params = new URLSearchParams(window.location.search);
        reviewId = params.get('travelReview') || params.get('review') || params.get('rid') || '';
      }
      if (!reviewId) {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf('clerk_obs_travel_survey_') === 0) {
            reviewId = k.replace('clerk_obs_travel_survey_', '');
            break;
          }
        }
      }
      return reviewId ? 'clerk_obs_travel_survey_' + reviewId : '';
    }

    function ddUpdateInfo() {
      var key = ddGetTravelKey();
      if (!key) { ddRandInfo.textContent = 'No active travel survey found.'; return; }
      try {
        var data = JSON.parse(localStorage.getItem(key)) || {};
        var total = (data.assignments || []).length;
        var pending = (data.assignments || []).filter(function(a) { return !data.responses || !data.responses[a.userId]; }).length;
        ddRandInfo.textContent = total + ' travelers, ' + pending + ' pending';
      } catch(e) { ddRandInfo.textContent = 'Error reading survey.'; }
    }
    ddUpdateInfo();

    if (ddRandBtn) {
      ddRandBtn.addEventListener('click', function() {
        var key = ddGetTravelKey();
        if (!key) { ddRandResult.textContent = 'No travel survey found.'; ddRandResult.style.color = 'var(--danger)'; return; }
        var data = null;
        try { data = JSON.parse(localStorage.getItem(key)); } catch(e) {}
        if (!data || !data.assignments || !data.assignments.length) {
          ddRandResult.textContent = 'No travelers assigned.'; ddRandResult.style.color = 'var(--danger)'; return;
        }
        if (!data.responses) data.responses = {};

        // Find pending (no response yet)
        var pending = data.assignments.filter(function(a) { return !data.responses[a.userId]; });
        if (pending.length === 0) {
          ddRandResult.textContent = 'All surveys already submitted!'; ddRandResult.style.color = 'var(--success)'; return;
        }

        // Random helpers
        var airlines = ['Delta', 'United', 'American', 'Southwest', 'JetBlue', 'Spirit', 'Frontier'];
        var airports = ['JFK', 'LGA', 'EWR', 'BDL', 'PHL', 'BOS', 'DCA', 'IAD', 'ATL', 'ORD', 'CLT', 'PIT'];
        function randEl(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
        function randPhone() { return '(' + (200 + Math.floor(Math.random() * 800)) + ') ' + (200 + Math.floor(Math.random() * 800)) + '-' + (1000 + Math.floor(Math.random() * 9000)); }
        function randFlight() { return String(100 + Math.floor(Math.random() * 9000)); }
        function randTime() { var h = 5 + Math.floor(Math.random() * 16); var m = Math.floor(Math.random() * 4) * 15; return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0'); }

        // Get review dates for realistic arrival/departure
        var review = null;
        try {
          var setup2 = JSON.parse(localStorage.getItem('reviewDaySetup')) || {};
          if (typeof Reviews !== 'undefined' && Reviews.getById) review = Reviews.getById(setup2.reviewId);
        } catch(e) {}
        var startDate = (review && review.startDate) || new Date().toISOString().slice(0,10);
        var endDate = (review && review.endDate) || startDate;
        // Arrive day before start
        var arrD = new Date(startDate + 'T00:00:00'); arrD.setDate(arrD.getDate() - 1);
        var arrDate = arrD.getFullYear() + '-' + String(arrD.getMonth()+1).padStart(2,'0') + '-' + String(arrD.getDate()).padStart(2,'0');
        // Depart day after end
        var depD = new Date(endDate + 'T00:00:00'); depD.setDate(depD.getDate() + 1);
        var depDate = depD.getFullYear() + '-' + String(depD.getMonth()+1).padStart(2,'0') + '-' + String(depD.getDate()).padStart(2,'0');

        var filled = [];
        pending.forEach(function(a) {
          var mode = Math.random() < 0.7 ? 'flying' : 'driving';
          var resp = {
            mode: mode,
            phone: randPhone(),
            hotelBooked: Math.random() < 0.5,
            submittedAt: new Date().toISOString()
          };
          if (mode === 'flying') {
            var ap = randEl(airports);
            resp.arrival = { date: arrDate, time: randTime(), airline: randEl(airlines), flight: randFlight(), airport: ap };
            resp.departure = { date: depDate, time: randTime(), airline: randEl(airlines), flight: randFlight(), airport: ap };
          }
          data.responses[a.userId] = resp;
          filled.push(a.name + ' → ' + (mode === 'flying' ? '✈️' : '🚗'));
        });

        localStorage.setItem(key, JSON.stringify(data));
        ddRandResult.style.color = 'var(--success)';
        ddRandResult.textContent = '✅ Filled ' + filled.length + ' surveys:\n' + filled.join('\n');
        ddUpdateInfo();
      });
    }

  }

  function renderToolboxDrawer() {
    var toolbox = document.createElement('div');
    toolbox.className = 'tools-drawer';
    toolbox.id = 'tools-drawer';

    // Tab button
    var tTab = document.createElement('button');
    tTab.className = 'tools-drawer-tab';
    tTab.textContent = 'Toolbox';
    tTab.addEventListener('click', function() {
      toolbox.classList.toggle('open');
      backdrop.classList.toggle('visible');
    });
    toolbox.appendChild(tTab);

    // Backdrop (mobile)
    var backdrop = document.createElement('div');
    backdrop.className = 'tools-drawer-backdrop';
    backdrop.addEventListener('click', function() {
      toolbox.classList.remove('open');
      backdrop.classList.remove('visible');
    });

    // Panel
    var tPanel = document.createElement('div');
    tPanel.className = 'tools-drawer-panel';

    // Header
    tPanel.innerHTML = '<div class="tools-drawer-header"><h3>🧰 Toolbox</h3><button class="tools-drawer-close" id="tools-drawer-close">&times;</button></div>';

    var tBody = document.createElement('div');
    tBody.className = 'tools-drawer-body';

    // ====== Section 1: Calculator ======
    var calcSection = document.createElement('details');
    calcSection.className = 'tools-section';
    calcSection.open = true;
    calcSection.innerHTML = '<summary class="tools-section-toggle">Calculator</summary>';
    var calcBody = document.createElement('div');
    calcBody.className = 'tools-section-body';

    var calcDisplay = document.createElement('input');
    calcDisplay.type = 'text';
    calcDisplay.className = 'basic-calc-display';
    calcDisplay.readOnly = true;
    calcDisplay.value = '0';
    calcBody.appendChild(calcDisplay);

    var calcGrid = document.createElement('div');
    calcGrid.className = 'basic-calc-grid';

    var calcState = { current: '0', prev: '', op: '', resetNext: false };
    var buttons = [
      { t: 'C', cls: 'bc-func' }, { t: '±', cls: 'bc-func' }, { t: '%', cls: 'bc-func' }, { t: '÷', cls: 'bc-op' },
      { t: '7' }, { t: '8' }, { t: '9' }, { t: '×', cls: 'bc-op' },
      { t: '4' }, { t: '5' }, { t: '6' }, { t: '−', cls: 'bc-op' },
      { t: '1' }, { t: '2' }, { t: '3' }, { t: '+', cls: 'bc-op' },
      { t: '0', cls: 'bc-zero' }, { t: '.' }, { t: '=', cls: 'bc-eq' }
    ];

    function calcUpdate() { calcDisplay.value = calcState.current; }
    function calcOperate(a, b, op) {
      a = parseFloat(a); b = parseFloat(b);
      if (isNaN(a) || isNaN(b)) return b;
      switch(op) {
        case '+': return a + b;
        case '−': return a - b;
        case '×': return a * b;
        case '÷': return b === 0 ? 'Error' : a / b;
        default: return b;
      }
    }

    buttons.forEach(function(b) {
      var btn = document.createElement('button');
      btn.className = 'basic-calc-btn' + (b.cls ? ' ' + b.cls : '') + (b.t === '0' ? ' bc-zero' : '');
      btn.textContent = b.t;
      btn.addEventListener('click', function() {
        var t = b.t;
        if (t === 'C') {
          calcState = { current: '0', prev: '', op: '', resetNext: false };
        } else if (t === '±') {
          calcState.current = String(parseFloat(calcState.current) * -1);
        } else if (t === '%') {
          calcState.current = String(parseFloat(calcState.current) / 100);
        } else if (['+','−','×','÷'].indexOf(t) >= 0) {
          if (calcState.op && !calcState.resetNext) {
            var res = calcOperate(calcState.prev, calcState.current, calcState.op);
            calcState.current = String(res);
            calcState.prev = String(res);
          } else {
            calcState.prev = calcState.current;
          }
          calcState.op = t;
          calcState.resetNext = true;
        } else if (t === '=') {
          if (calcState.op) {
            var res = calcOperate(calcState.prev, calcState.current, calcState.op);
            calcState.current = String(res);
            calcState.prev = '';
            calcState.op = '';
          }
          calcState.resetNext = true;
        } else if (t === '.') {
          if (calcState.resetNext) { calcState.current = '0'; calcState.resetNext = false; }
          if (calcState.current.indexOf('.') === -1) calcState.current += '.';
        } else {
          // digit
          if (calcState.resetNext || calcState.current === '0') {
            calcState.current = t;
            calcState.resetNext = false;
          } else {
            calcState.current += t;
          }
        }
        calcUpdate();
      });
      calcGrid.appendChild(btn);
    });
    calcBody.appendChild(calcGrid);
    calcSection.appendChild(calcBody);
    tBody.appendChild(calcSection);

    // ====== Section 2: Stopwatch ======
    var swSection = document.createElement('details');
    swSection.className = 'tools-section';
    swSection.innerHTML = '<summary class="tools-section-toggle">⏱ Stopwatch</summary>';
    var swBody = document.createElement('div');
    swBody.className = 'tools-section-body';
    swBody.innerHTML =
      '<div style="text-align:center;">' +
        '<div id="tb-sw-display" style="font-size:1.6rem;font-weight:700;font-family:monospace;padding:0.5rem 0;letter-spacing:0.05em;">00:00:00<span style="font-size:1rem;">.00</span></div>' +
        '<div style="display:flex;gap:0.35rem;justify-content:center;margin-top:0.3rem;">' +
          '<button id="tb-sw-start" class="btn btn-primary btn-sm" style="font-size:0.78rem;min-width:60px;">Start</button>' +
          '<button id="tb-sw-lap" class="btn btn-sm" style="font-size:0.78rem;min-width:60px;" disabled>Lap</button>' +
          '<button id="tb-sw-reset" class="btn btn-sm" style="font-size:0.78rem;min-width:60px;" disabled>Reset</button>' +
        '</div>' +
        '<div id="tb-sw-laps" style="margin-top:0.4rem;max-height:120px;overflow-y:auto;text-align:left;font-size:0.75rem;"></div>' +
      '</div>';
    swSection.appendChild(swBody);
    tBody.appendChild(swSection);

    // ====== Section 3: Piece Count Converter ======
    var pcSection = document.createElement('details');
    pcSection.className = 'tools-section';
    pcSection.innerHTML = '<summary class="tools-section-toggle">📦 Piece Count Converter</summary>';
    var pcBody = document.createElement('div');
    pcBody.className = 'tools-section-body';
    pcBody.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:0.5rem;">' +
        '<div style="font-size:0.72rem;color:var(--text-light);margin-bottom:0.1rem;">221 letters / 12 in &bull; 115 flats / 12 in</div>' +
        '<div style="display:flex;align-items:center;gap:0.4rem;">' +
          '<label style="font-size:0.78rem;font-weight:600;width:55px;">Inches:</label>' +
          '<input type="number" id="tb-pc-inches" class="util-calc-input" value="0" min="0" step="0.1">' +
        '</div>' +
        '<div id="tb-pc-result" style="font-size:0.82rem;padding:0.35rem;background:var(--bg-light);border-radius:4px;"></div>' +
        '<hr style="border:none;border-top:1px solid var(--border);margin:0.2rem 0;">' +
        '<div style="display:flex;align-items:center;gap:0.4rem;">' +
          '<label style="font-size:0.78rem;font-weight:600;width:55px;">Pieces:</label>' +
          '<input type="number" id="tb-pc-pieces" class="util-calc-input" value="0" min="0" step="1">' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:0.4rem;">' +
          '<label style="font-size:0.78rem;font-weight:600;width:55px;">Type:</label>' +
          '<select id="tb-pc-type" style="padding:0.3rem 0.35rem;border:1px solid var(--border);border-radius:4px;font-size:0.82rem;background:var(--bg);color:var(--text);">' +
            '<option value="ltr">Letters (221/12 in)</option>' +
            '<option value="flt">Flats (115/12 in)</option>' +
          '</select>' +
        '</div>' +
        '<div id="tb-pc-rev-result" style="font-size:0.82rem;padding:0.35rem;background:var(--bg-light);border-radius:4px;"></div>' +
      '</div>';
    pcSection.appendChild(pcBody);
    tBody.appendChild(pcSection);

    tPanel.appendChild(tBody);
    toolbox.appendChild(tPanel);
    document.body.appendChild(toolbox);
    document.body.appendChild(backdrop);

    // Wire close button
    var closeBtn = tPanel.querySelector('#tools-drawer-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        toolbox.classList.remove('open');
        backdrop.classList.remove('visible');
      });
    }

    // Wire stopwatch
    var swDisplay = document.getElementById('tb-sw-display');
    var swStartBtn = document.getElementById('tb-sw-start');
    var swLapBtn = document.getElementById('tb-sw-lap');
    var swResetBtn = document.getElementById('tb-sw-reset');
    var swLapsDiv = document.getElementById('tb-sw-laps');
    var swState = { running: false, startTime: 0, elapsed: 0, interval: null, laps: [] };

    function swFormat(ms) {
      var cs = Math.floor((ms % 1000) / 10);
      var secs = Math.floor(ms / 1000) % 60;
      var mins = Math.floor(ms / 60000) % 60;
      var hrs = Math.floor(ms / 3600000);
      return (hrs < 10 ? '0' : '') + hrs + ':' + (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs +
        '<span style="font-size:1rem;">.' + (cs < 10 ? '0' : '') + cs + '</span>';
    }
    function swTick() {
      var now = Date.now();
      var total = swState.elapsed + (now - swState.startTime);
      swDisplay.innerHTML = swFormat(total);
    }
    if (swStartBtn) {
      swStartBtn.addEventListener('click', function() {
        if (!swState.running) {
          swState.running = true;
          swState.startTime = Date.now();
          swState.interval = setInterval(swTick, 31);
          swStartBtn.textContent = 'Stop';
          swStartBtn.classList.remove('btn-primary');
          swStartBtn.style.background = 'var(--danger)';
          swStartBtn.style.color = '#fff';
          swLapBtn.disabled = false;
          swResetBtn.disabled = true;
        } else {
          swState.running = false;
          swState.elapsed += Date.now() - swState.startTime;
          clearInterval(swState.interval);
          swStartBtn.textContent = 'Resume';
          swStartBtn.classList.add('btn-primary');
          swStartBtn.style.background = '';
          swStartBtn.style.color = '';
          swLapBtn.disabled = true;
          swResetBtn.disabled = false;
        }
      });
    }
    if (swLapBtn) {
      swLapBtn.addEventListener('click', function() {
        if (!swState.running) return;
        var total = swState.elapsed + (Date.now() - swState.startTime);
        swState.laps.push(total);
        var lapNum = swState.laps.length;
        var prev = lapNum > 1 ? swState.laps[lapNum - 2] : 0;
        var diff = total - prev;
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;padding:0.15rem 0.3rem;border-bottom:1px solid var(--border);font-family:monospace;';
        row.innerHTML = '<span>Lap ' + lapNum + '</span><span>' + swFormat(diff).replace(/<[^>]+>/g, '') + '</span><span style="color:var(--text-light);">' + swFormat(total).replace(/<[^>]+>/g, '') + '</span>';
        swLapsDiv.insertBefore(row, swLapsDiv.firstChild);
      });
    }
    if (swResetBtn) {
      swResetBtn.addEventListener('click', function() {
        swState = { running: false, startTime: 0, elapsed: 0, interval: null, laps: [] };
        swDisplay.innerHTML = swFormat(0);
        swStartBtn.textContent = 'Start';
        swStartBtn.classList.add('btn-primary');
        swStartBtn.style.background = '';
        swStartBtn.style.color = '';
        swLapBtn.disabled = true;
        swResetBtn.disabled = true;
        swLapsDiv.innerHTML = '';
      });
    }

    // Wire piece count converter
    var pcInches = document.getElementById('tb-pc-inches');
    var pcResult = document.getElementById('tb-pc-result');
    var pcPieces = document.getElementById('tb-pc-pieces');
    var pcType   = document.getElementById('tb-pc-type');
    var pcRevResult = document.getElementById('tb-pc-rev-result');
    var LTR_PER_12 = 221, FLT_PER_12 = 115;

    function updateInchesToPieces() {
      var inches = parseFloat(pcInches.value) || 0;
      var ltrs = Math.round(inches / 12 * LTR_PER_12);
      var flts = Math.round(inches / 12 * FLT_PER_12);
      pcResult.innerHTML = '<strong>' + ltrs.toLocaleString() + '</strong> letters &nbsp;|&nbsp; <strong>' + flts.toLocaleString() + '</strong> flats';
    }
    function updatePiecesToInches() {
      var pcs = parseFloat(pcPieces.value) || 0;
      var rate = pcType.value === 'ltr' ? LTR_PER_12 : FLT_PER_12;
      var label = pcType.value === 'ltr' ? 'letters' : 'flats';
      var inches = pcs / rate * 12;
      pcRevResult.innerHTML = '<strong>' + pcs.toLocaleString() + '</strong> ' + label + ' = <strong>' + inches.toFixed(1) + '</strong> inches';
    }
    if (pcInches) pcInches.addEventListener('input', updateInchesToPieces);
    if (pcPieces) { pcPieces.addEventListener('input', updatePiecesToInches); pcType.addEventListener('change', updatePiecesToInches); }
    updateInchesToPieces();
    updatePiecesToInches();
  }

  // --- Apply dark mode on load (dark is default) ---
  if (localStorage.getItem('clerk_obs_dark') !== '0') {
    document.documentElement.classList.add('dark');
  }

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
