/**
 * gh-config.js -- GitHub Gist sync setup wizard
 *
 * On first run, shows a setup UI:
 *   Admin: enter GitHub token -> app creates gist -> generates team code
 *   Team member: enter team code -> connects to existing gist
 *
 * Token is stored in localStorage, never in source code.
 */
(function() {
  'use strict';

  if (window.location.protocol === 'file:') {
    window.GH_CONFIG = { gistId: '', token: '' };
    return;
  }

  var GIST_KEY = '_gh_gist_id';
  var TOKEN_KEY = '_gh_token';
  var SKIP_KEY = '_gh_skip_sync';

  var gistId = localStorage.getItem(GIST_KEY) || '';
  var token = localStorage.getItem(TOKEN_KEY) || '';

  window.GH_CONFIG = { gistId: gistId, token: token };

  // Team code helpers
  function makeTeamCode(g, t) { return btoa(g + '|' + t); }
  function parseTeamCode(code) {
    try {
      var d = atob(code.trim());
      var i = d.indexOf('|');
      if (i > 0) {
        var g = d.substring(0, i);
        var t = d.substring(i + 1);
        if (g.length > 10 && t.length > 10) return { gistId: g, token: t };
      }
    } catch(e) {}
    return null;
  }

  // Expose team code for admin to retrieve later
  window.GH_SETUP = {
    teamCode: function() {
      var g = localStorage.getItem(GIST_KEY);
      var t = localStorage.getItem(TOKEN_KEY);
      if (g && t) return makeTeamCode(g, t);
      return null;
    },
    reset: function() {
      localStorage.removeItem(GIST_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SKIP_KEY);
      location.reload();
    }
  };

  // Already configured or user chose to skip
  if ((gistId && token) || localStorage.getItem(SKIP_KEY)) return;

  // === Setup UI ===
  function showSetup() {
    var S = 'style';
    var wrap = document.createElement('div');
    wrap.id = 'gh-setup';
    wrap.setAttribute(S,
      'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.88);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;' +
      'font-family:system-ui,-apple-system,sans-serif;'
    );

    var card =
      '<div id="gh-card" style="background:#1e293b;border-radius:16px;padding:28px 24px;' +
      'max-width:400px;width:100%;color:#e2e8f0;box-shadow:0 25px 50px rgba(0,0,0,0.5);">' +

      // Header
      '<div style="text-align:center;margin-bottom:20px;">' +
        '<div style="font-size:2rem;margin-bottom:4px;">&#128279;</div>' +
        '<h2 style="margin:0 0 6px;color:#818cf8;font-size:1.3rem;">Data Sync Setup</h2>' +
        '<p style="color:#94a3b8;margin:0;font-size:0.85rem;">Connect to share data across all team devices.</p>' +
      '</div>' +

      // Choice buttons
      '<div id="gh-choices">' +
        '<button id="gh-btn-admin" style="width:100%;padding:14px;margin-bottom:10px;' +
          'background:#4f46e5;color:white;border:none;border-radius:10px;font-size:1rem;' +
          'font-weight:600;cursor:pointer;">I\'m the Admin - Set Up New</button>' +
        '<button id="gh-btn-join" style="width:100%;padding:14px;margin-bottom:10px;' +
          'background:#334155;color:#e2e8f0;border:1px solid #475569;border-radius:10px;' +
          'font-size:1rem;cursor:pointer;">I Have a Team Code</button>' +
        '<button id="gh-btn-skip" style="width:100%;padding:10px;' +
          'background:transparent;color:#64748b;border:none;font-size:0.85rem;' +
          'cursor:pointer;text-decoration:underline;">Skip - use offline only</button>' +
      '</div>' +

      // Admin panel (hidden)
      '<div id="gh-admin" style="display:none;">' +
        '<p style="color:#94a3b8;font-size:0.85rem;margin:0 0 12px;">Paste your GitHub Personal Access Token below.' +
          '<br><span style="color:#64748b;font-size:0.8rem;">(github.com &#8594; Settings &#8594; Developer settings &#8594; Personal access tokens &#8594; Tokens (classic) &#8594; Generate &#8594; check "gist" only)</span></p>' +
        '<input id="gh-token-in" type="password" placeholder="ghp_xxxxxxxxxxxx" style="width:100%;padding:12px;' +
          'background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;' +
          'font-size:1rem;margin-bottom:12px;box-sizing:border-box;" />' +
        '<button id="gh-btn-create" style="width:100%;padding:12px;background:#4f46e5;' +
          'color:white;border:none;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;">' +
          'Create Data Store</button>' +
        '<div id="gh-admin-msg" style="margin-top:10px;font-size:0.85rem;text-align:center;"></div>' +
        '<button id="gh-btn-back1" style="width:100%;padding:8px;margin-top:8px;' +
          'background:transparent;color:#64748b;border:none;font-size:0.85rem;cursor:pointer;">' +
          '&#8592; Back</button>' +
      '</div>' +

      // Join panel (hidden)
      '<div id="gh-join" style="display:none;">' +
        '<p style="color:#94a3b8;font-size:0.85rem;margin:0 0 12px;">Paste the team code your admin gave you:</p>' +
        '<input id="gh-code-in" type="text" placeholder="Paste team code here" style="width:100%;padding:12px;' +
          'background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;' +
          'font-size:1rem;margin-bottom:12px;box-sizing:border-box;" />' +
        '<button id="gh-btn-connect" style="width:100%;padding:12px;background:#4f46e5;' +
          'color:white;border:none;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;">' +
          'Connect</button>' +
        '<div id="gh-join-msg" style="margin-top:10px;font-size:0.85rem;text-align:center;"></div>' +
        '<button id="gh-btn-back2" style="width:100%;padding:8px;margin-top:8px;' +
          'background:transparent;color:#64748b;border:none;font-size:0.85rem;cursor:pointer;">' +
          '&#8592; Back</button>' +
      '</div>' +

      // Name picker panel (hidden) — shown after team code join
      '<div id="gh-pick" style="display:none;">' +
        '<div style="text-align:center;margin-bottom:16px;">' +
          '<div style="font-size:2rem;margin-bottom:4px;">&#128100;</div>' +
          '<h3 style="color:#818cf8;margin:0 0 6px;">Who are you?</h3>' +
          '<p style="color:#94a3b8;margin:0;font-size:0.85rem;">Select your name, then set a password.</p>' +
        '</div>' +
        '<select id="gh-name-pick" style="width:100%;padding:12px;background:#0f172a;' +
          'border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:1rem;' +
          'margin-bottom:12px;box-sizing:border-box;appearance:auto;">' +
          '<option value="">-- Choose your name --</option></select>' +
        '<input id="gh-pick-pass" type="password" placeholder="Set your password" style="width:100%;padding:12px;' +
          'background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;' +
          'font-size:1rem;margin-bottom:8px;box-sizing:border-box;" />' +
        '<input id="gh-pick-pass2" type="password" placeholder="Confirm password" style="width:100%;padding:12px;' +
          'background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;' +
          'font-size:1rem;margin-bottom:12px;box-sizing:border-box;" />' +
        '<button id="gh-btn-pick-go" style="width:100%;padding:12px;background:#4f46e5;' +
          'color:white;border:none;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;">' +
          'Set Password &amp; Sign In</button>' +
        '<div id="gh-pick-msg" style="margin-top:10px;font-size:0.85rem;text-align:center;"></div>' +
      '</div>' +

      // Success panel (hidden)
      '<div id="gh-success" style="display:none;text-align:center;">' +
        '<div style="font-size:2.5rem;margin-bottom:8px;">&#9989;</div>' +
        '<h3 style="color:#34d399;margin:0 0 12px;">Connected!</h3>' +
        '<div id="gh-team-code-box" style="display:none;">' +
          '<p style="color:#94a3b8;font-size:0.85rem;margin:0 0 8px;">Share this team code with your reviewers:</p>' +
          '<div id="gh-team-code" style="background:#0f172a;padding:12px;border-radius:8px;' +
            'font-family:monospace;font-size:0.8rem;word-break:break-all;color:#a5b4fc;' +
            'border:1px solid #334155;margin-bottom:12px;user-select:all;"></div>' +
          '<button id="gh-btn-copy" style="width:100%;padding:10px;background:#334155;' +
            'color:#e2e8f0;border:none;border-radius:8px;font-size:0.9rem;cursor:pointer;' +
            'margin-bottom:16px;">Copy Team Code</button>' +
        '</div>' +
        '<button id="gh-btn-done" style="width:100%;padding:14px;background:#059669;' +
          'color:white;border:none;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;">' +
          'Start Using App</button>' +
      '</div>' +

      '</div>';

    wrap.innerHTML = card;
    document.body.appendChild(wrap);

    // === Helpers ===
    function $(id) { return document.getElementById(id); }
    function show(id) { $(id).style.display = 'block'; }
    function hide(id) { $(id).style.display = 'none'; }
    function msg(id, text, ok) {
      var el = $(id);
      el.textContent = text;
      el.style.color = ok ? '#34d399' : '#f87171';
    }

    // === Navigation ===
    $('gh-btn-admin').onclick = function() { hide('gh-choices'); show('gh-admin'); $('gh-token-in').focus(); };
    $('gh-btn-join').onclick = function() { hide('gh-choices'); show('gh-join'); $('gh-code-in').focus(); };
    $('gh-btn-back1').onclick = function() { hide('gh-admin'); show('gh-choices'); };
    $('gh-btn-back2').onclick = function() { hide('gh-join'); show('gh-choices'); };
    $('gh-btn-skip').onclick = function() {
      localStorage.setItem(SKIP_KEY, '1');
      wrap.remove();
    };

    // === Admin: Create gist ===
    $('gh-btn-create').onclick = function() {
      var tk = $('gh-token-in').value.trim();
      if (!tk) { msg('gh-admin-msg', 'Please paste your token.', false); return; }
      if (tk.length < 10) { msg('gh-admin-msg', 'That token looks too short.', false); return; }

      msg('gh-admin-msg', 'Testing token...', true);
      $('gh-btn-create').disabled = true;

      // Test token
      var x1 = new XMLHttpRequest();
      x1.open('GET', 'https://api.github.com/user', true);
      x1.setRequestHeader('Authorization', 'token ' + tk);
      x1.timeout = 10000;
      x1.onload = function() {
        if (x1.status !== 200) {
          msg('gh-admin-msg', 'Token rejected by GitHub. Check it and try again.', false);
          $('gh-btn-create').disabled = false;
          return;
        }
        msg('gh-admin-msg', 'Token valid! Creating data store...', true);

        // Create secret gist
        var x2 = new XMLHttpRequest();
        x2.open('POST', 'https://api.github.com/gists', true);
        x2.setRequestHeader('Authorization', 'token ' + tk);
        x2.setRequestHeader('Content-Type', 'application/json');
        x2.timeout = 15000;
        x2.onload = function() {
          if (x2.status === 201) {
            try {
              var resp = JSON.parse(x2.responseText);
              var newGistId = resp.id;
              localStorage.setItem(GIST_KEY, newGistId);
              localStorage.setItem(TOKEN_KEY, tk);
              window.GH_CONFIG = { gistId: newGistId, token: tk };

              // Show success + team code
              hide('gh-admin');
              show('gh-success');
              show('gh-team-code-box');
              $('gh-team-code').textContent = makeTeamCode(newGistId, tk);
            } catch(e) {
              msg('gh-admin-msg', 'Error reading response. Try again.', false);
              $('gh-btn-create').disabled = false;
            }
          } else {
            msg('gh-admin-msg', 'Failed to create data store (HTTP ' + x2.status + '). Make sure "gist" scope is checked.', false);
            $('gh-btn-create').disabled = false;
          }
        };
        x2.onerror = function() {
          msg('gh-admin-msg', 'Network error. Check your connection.', false);
          $('gh-btn-create').disabled = false;
        };
        x2.send(JSON.stringify({
          description: 'RPOO Function 4 Review Data',
          public: false,
          files: { '_init.json': { content: '{"created":"' + new Date().toISOString() + '"}' } }
        }));
      };
      x1.onerror = function() {
        msg('gh-admin-msg', 'Cannot reach GitHub. Check your connection.', false);
        $('gh-btn-create').disabled = false;
      };
      x1.ontimeout = function() {
        msg('gh-admin-msg', 'Request timed out. Try again.', false);
        $('gh-btn-create').disabled = false;
      };
      x1.send();
    };

    // === Join: Connect with team code ===
    var _joinedUsers = []; // stashed for name picker
    $('gh-btn-connect').onclick = function() {
      var code = $('gh-code-in').value.trim();
      if (!code) { msg('gh-join-msg', 'Please paste the team code.', false); return; }

      var parsed = parseTeamCode(code);
      if (!parsed) { msg('gh-join-msg', 'Invalid team code. Ask your admin for the correct one.', false); return; }

      msg('gh-join-msg', 'Testing connection...', true);
      $('gh-btn-connect').disabled = true;

      var x = new XMLHttpRequest();
      x.open('GET', 'https://api.github.com/gists/' + parsed.gistId, true);
      x.setRequestHeader('Authorization', 'token ' + parsed.token);
      x.timeout = 10000;
      x.onload = function() {
        if (x.status === 200) {
          localStorage.setItem(GIST_KEY, parsed.gistId);
          localStorage.setItem(TOKEN_KEY, parsed.token);
          window.GH_CONFIG = { gistId: parsed.gistId, token: parsed.token };

          // Parse users from gist response
          try {
            var gistData = JSON.parse(x.responseText);
            var usersFile = gistData.files && gistData.files['clerk_obs_users.json'];
            if (usersFile && usersFile.content) {
              var users = JSON.parse(usersFile.content);
              if (Array.isArray(users) && users.length > 0) {
                // Save users to localStorage so sync has them
                localStorage.setItem('clerk_obs_users', JSON.stringify(users));
                _joinedUsers = users;

                // Populate dropdown sorted by name
                var sel = $('gh-name-pick');
                users.slice().sort(function(a, b) {
                  return (a.displayName || a.username).localeCompare(b.displayName || b.username);
                }).forEach(function(u) {
                  var opt = document.createElement('option');
                  opt.value = u.id;
                  opt.textContent = u.displayName || u.username;
                  sel.appendChild(opt);
                });

                hide('gh-join');
                show('gh-pick');
                $('gh-name-pick').focus();
                return;
              }
            }
          } catch(e) { /* fall through to simple success */ }

          // No users in gist — show plain success
          hide('gh-join');
          show('gh-success');
        } else {
          msg('gh-join-msg', 'Could not connect (HTTP ' + x.status + '). Check the code.', false);
          $('gh-btn-connect').disabled = false;
        }
      };
      x.onerror = function() {
        msg('gh-join-msg', 'Network error. Check your connection.', false);
        $('gh-btn-connect').disabled = false;
      };
      x.ontimeout = function() {
        msg('gh-join-msg', 'Timed out. Try again.', false);
        $('gh-btn-connect').disabled = false;
      };
      x.send();
    };

    // === Copy team code ===
    $('gh-btn-copy').onclick = function() {
      var code = $('gh-team-code').textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(function() {
          $('gh-btn-copy').textContent = 'Copied!';
          setTimeout(function() { $('gh-btn-copy').textContent = 'Copy Team Code'; }, 2000);
        });
      } else {
        // Fallback
        var ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        $('gh-btn-copy').textContent = 'Copied!';
        setTimeout(function() { $('gh-btn-copy').textContent = 'Copy Team Code'; }, 2000);
      }
    };

    // === Done - reload ===
    $('gh-btn-done').onclick = function() { location.reload(); };

    // === Name picker: set password & sign in ===
    $('gh-btn-pick-go').onclick = function() {
      var sel = $('gh-name-pick');
      var userId = sel.value;
      var pw = $('gh-pick-pass').value;
      var pw2 = $('gh-pick-pass2').value;

      if (!userId) { msg('gh-pick-msg', 'Please select your name.', false); return; }
      if (!pw || pw.length < 4) { msg('gh-pick-msg', 'Password must be at least 4 characters.', false); return; }
      if (pw !== pw2) { msg('gh-pick-msg', 'Passwords do not match.', false); return; }

      $('gh-btn-pick-go').disabled = true;

      // Hash password with SHA-256
      var enc = new TextEncoder().encode(pw);
      crypto.subtle.digest('SHA-256', enc).then(function(buf) {
        var hash = Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

        // Find and update user in stored users
        var users = JSON.parse(localStorage.getItem('clerk_obs_users') || '[]');
        var found = null;
        for (var i = 0; i < users.length; i++) {
          if (users[i].id === userId) {
            users[i].password = hash;
            users[i].mustChangePassword = false;
            users[i].role = 'teamlead'; // auto-assign Review Lead on sign-up
            found = users[i];
            break;
          }
        }
        if (!found) { msg('gh-pick-msg', 'User not found. Try again.', false); $('gh-btn-pick-go').disabled = false; return; }

        // Save updated users list
        localStorage.setItem('clerk_obs_users', JSON.stringify(users));

        // Create session so Auth.currentUser() finds them after reload
        localStorage.setItem('clerk_obs_session', JSON.stringify({
          userId: found.id,
          username: found.username,
          displayName: found.displayName || found.username,
          role: found.role,
          loginAt: new Date().toISOString()
        }));

        msg('gh-pick-msg', 'Welcome, ' + (found.displayName || found.username) + '!', true);

        // Brief delay so they see the welcome, then redirect
        setTimeout(function() {
          window.location.href = 'index.html';
        }, 800);
      });
    };
    $('gh-pick-pass2').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') $('gh-btn-pick-go').click();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showSetup);
  } else {
    showSetup();
  }
})();
