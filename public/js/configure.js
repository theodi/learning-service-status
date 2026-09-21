(function () {
  var root = document.getElementById('configure-root');
  if (!root) return;

  function envSnippetText(el, revealed) {
    var url = el.getAttribute('data-url') || '';
    var key = el.getAttribute('data-key') || '';
    return (
      'STATUS_REPORT_URL=' +
      url +
      '\nSTATUS_REPORT_KEY=' +
      (revealed ? key : '••••••••')
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
      var snippet = document.getElementById('config-env-snippet');
      if (snippet) snippet.textContent = envSnippetText(snippet, next);
      return;
    }

    var copyBtn = ev.target.closest('.config-copy');
    if (!copyBtn) return;

    if (copyBtn.getAttribute('data-copy-secret')) {
      var secretEl = document.getElementById(copyBtn.getAttribute('data-copy-secret'));
      if (secretEl) copyText(secretEl.getAttribute('data-secret') || '', copyBtn);
      return;
    }

    if (copyBtn.getAttribute('data-copy-env')) {
      var envEl = document.getElementById(copyBtn.getAttribute('data-copy-env'));
      if (envEl) {
        copyText(
          'STATUS_REPORT_URL=' +
            (envEl.getAttribute('data-url') || '') +
            '\nSTATUS_REPORT_KEY=' +
            (envEl.getAttribute('data-key') || ''),
          copyBtn
        );
      }
      return;
    }

    var id = copyBtn.getAttribute('data-copy-target');
    var el = id && document.getElementById(id);
    if (el) copyText(el.textContent || '', copyBtn);
  });
})();
