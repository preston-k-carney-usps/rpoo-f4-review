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
          '<h3 style="color:#818cf8;margin:0 0 6px;">Request Access</h3>' +
          '<p style="color:#94a3b8;margin:0;font-size:0.85rem;">Enter your info below. An admin will approve your account.</p>' +
        '</div>' +
        '<input id="gh-pick-first" type="text" placeholder="First Name" style="width:100%;padding:12px;' +
          'background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;' +
          'font-size:1rem;margin-bottom:8px;box-sizing:border-box;" />' +
        '<input id="gh-pick-last" type="text" placeholder="Last Name" style="width:100%;padding:12px;' +
          'background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;' +
          'font-size:1rem;margin-bottom:8px;box-sizing:border-box;" />' +
        '<div style="display:flex;align-items:center;margin-bottom:12px;">' +
          '<input id="gh-pick-email" type="text" placeholder="USPS Email" style="flex:1;padding:12px;' +
            'background:#0f172a;border:1px solid #334155;border-radius:8px 0 0 8px;border-right:none;color:#e2e8f0;' +
            'font-size:1rem;box-sizing:border-box;" />' +
          '<span style="padding:12px;background:#1e293b;border:1px solid #334155;border-left:none;' +
            'border-radius:0 8px 8px 0;color:#64748b;font-size:0.9rem;white-space:nowrap;">@usps.gov</span>' +
        '</div>' +
        '<button id="gh-btn-pick-go" style="width:100%;padding:12px;background:#4f46e5;' +
          'color:white;border:none;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;">' +
          'Request Access</button>' +
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
              }
            }
          } catch(e) { /* fall through to success */ }

          // Connected — redirect to login page
          hide('gh-join');
          show('gh-success');
          $('gh-btn-done').textContent = 'Go to Login';
          $('gh-btn-done').onclick = function() { window.location.href = 'login.html'; };
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

    // === Request Access: submit request ===
    $('gh-btn-pick-go').onclick = function() {
      var first = $('gh-pick-first').value.trim();
      var last = $('gh-pick-last').value.trim();
      var emailPrefix = $('gh-pick-email').value.trim().toLowerCase();

      if (!first || !last) { msg('gh-pick-msg', 'Please enter your first and last name.', false); return; }
      if (!emailPrefix) { msg('gh-pick-msg', 'Please enter your USPS email.', false); return; }

      var email = emailPrefix.indexOf('@') === -1 ? emailPrefix + '@usps.gov' : emailPrefix;
      var displayName = last + ', ' + first;

      // Check if email already exists as a user
      var users = JSON.parse(localStorage.getItem('clerk_obs_users') || '[]');
      for (var i = 0; i < users.length; i++) {
        if (users[i].email && users[i].email.toLowerCase() === email.toLowerCase()) {
          msg('gh-pick-msg', 'An account with that email already exists. Go to the login page to sign in.', false);
          return;
        }
      }

      // Check if a pending request already exists for this email
      var reqs = JSON.parse(localStorage.getItem('clerk_obs_requests') || '[]');
      for (var j = 0; j < reqs.length; j++) {
        if (reqs[j].email && reqs[j].email.toLowerCase() === email.toLowerCase() && reqs[j].status === 'pending') {
          msg('gh-pick-msg', 'A request for this email is already pending. Please wait for admin approval.', false);
          return;
        }
      }

      // Submit access request
      reqs.push({
        id: crypto.randomUUID(),
        type: 'access',
        firstName: first,
        lastName: last,
        displayName: displayName,
        email: email,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      localStorage.setItem('clerk_obs_requests', JSON.stringify(reqs));

      $('gh-btn-pick-go').disabled = true;
      msg('gh-pick-msg', 'Access requested! An admin will review your request. You\u2019ll be able to log in once approved.', true);

      // After 3 seconds redirect to login
      setTimeout(function() {
        window.location.href = 'login.html';
      }, 3000);
    };
    $('gh-pick-email').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') $('gh-btn-pick-go').click();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showSetup);
  } else {
    showSetup();
  }
})();
