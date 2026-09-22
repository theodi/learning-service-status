(function () {
  var root = document.getElementById('configure-root');
  if (!root) return;

  function jsonSnippetText(el, revealed) {
    var url = el.getAttribute('data-url') || '';
    var key = el.getAttribute('data-key') || '';
    return (
      '{\n' +
      '  "statusReportUrl": "' +
      url +
      '",\n' +
      '  "statusReportKey": "' +
      (revealed ? key : '••••••••') +
      '",\n' +
      '  "hostId": "learndata-1",\n' +
      '  "scanRoots": [\n' +
      '    "/var/www/example-app"\n' +
      '  ],\n' +
      '  "intervalMs": 3600000\n' +
      '}'
    );
  }

  function flashCopied(btn) {
    var prev = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(function () {
      btn.textContent = prev;
    }, 1200);
  }

  function copyText(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flashCopied(btn);
      }).catch(function () {});
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      flashCopied(btn);
    } catch (e) {}
    document.body.removeChild(ta);
  }

  root.addEventListener('click', function (ev) {
    var revealBtn = ev.target.closest('.config-reveal');
    if (revealBtn) {
      var targetId = revealBtn.getAttribute('data-reveal-target');
      var code = targetId && document.getElementById(targetId);
      if (!code) return;
      var secret = code.getAttribute('data-secret') || '';
      var shown = revealBtn.getAttribute('aria-pressed') === 'true';
      var next = !shown;
      revealBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      revealBtn.textContent = next ? 'Hide' : 'Show';
      code.textContent = next ? secret : '••••••••';
      code.setAttribute('aria-label', next ? 'Ingest key' : 'Ingest key (hidden)');
      var snippet = document.getElementById('config-json-snippet');
      if (snippet) snippet.textContent = jsonSnippetText(snippet, next);
      return;
    }

    var copyBtn = ev.target.closest('.config-copy');
    if (!copyBtn || copyBtn.classList.contains('allowlist-remove')) return;

    if (copyBtn.getAttribute('data-copy-secret')) {
      var secretEl = document.getElementById(copyBtn.getAttribute('data-copy-secret'));
      if (secretEl) copyText(secretEl.getAttribute('data-secret') || '', copyBtn);
      return;
    }

    if (copyBtn.getAttribute('data-copy-json')) {
      var jsonEl = document.getElementById(copyBtn.getAttribute('data-copy-json'));
      if (jsonEl) {
        copyText(jsonSnippetText(jsonEl, true), copyBtn);
      }
      return;
    }

    var id = copyBtn.getAttribute('data-copy-target');
    var el = id && document.getElementById(id);
    if (el) copyText(el.textContent || '', copyBtn);
  });

  // —— Allowlist admin ——
  var listEl = document.getElementById('allowlist-ips');
  var form = document.getElementById('allowlist-form');
  var input = document.getElementById('allowlist-input');
  var statusEl = document.getElementById('allowlist-status');
  var emptyEl = document.getElementById('allowlist-empty');
  var addMine = document.getElementById('allowlist-add-mine');
  var clientIpEl = document.getElementById('config-client-ip');

  function currentIps() {
    if (!listEl) return [];
    return Array.prototype.map.call(listEl.querySelectorAll('li[data-ip]'), function (li) {
      return li.getAttribute('data-ip');
    });
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('is-error', Boolean(isError));
  }

  function renderList(ips) {
    if (!listEl) return;
    listEl.innerHTML = '';
    (ips || []).forEach(function (ip) {
      var li = document.createElement('li');
      li.setAttribute('data-ip', ip);
      var code = document.createElement('code');
      code.textContent = ip;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'config-copy allowlist-remove';
      btn.setAttribute('data-remove-ip', ip);
      btn.textContent = 'Remove';
      li.appendChild(code);
      li.appendChild(btn);
      listEl.appendChild(li);
    });
    if (emptyEl) {
      emptyEl.hidden = (ips || []).length > 0;
    }
  }

  function saveIps(ips) {
    setStatus('Saving…');
    return fetch('/settings', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ allowedIps: ips }),
    })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          window.location.href = '/login';
          return null;
        }
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (out) {
        if (!out) return;
        if (!out.ok) {
          setStatus((out.data && out.data.error) || 'Save failed', true);
          return;
        }
        renderList(out.data.allowedIps || []);
        setStatus('Saved');
      })
      .catch(function () {
        setStatus('Save failed', true);
      });
  }

  if (form && input) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var ip = (input.value || '').trim();
      if (!ip) {
        setStatus('Enter an IPv4 or IPv6 address', true);
        return;
      }
      var next = currentIps();
      if (next.indexOf(ip) === -1) next.push(ip);
      saveIps(next).then(function () {
        input.value = '';
      });
    });
  }

  if (listEl) {
    listEl.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-remove-ip]');
      if (!btn) return;
      var remove = btn.getAttribute('data-remove-ip');
      var next = currentIps().filter(function (ip) {
        return ip !== remove;
      });
      saveIps(next);
    });
  }

  if (addMine && clientIpEl) {
    addMine.addEventListener('click', function () {
      var ip = (clientIpEl.textContent || '').trim();
      if (!ip || ip === 'unknown') {
        setStatus('Could not detect your IP', true);
        return;
      }
      var next = currentIps();
      if (next.indexOf(ip) === -1) next.push(ip);
      saveIps(next);
    });
  }
})();
