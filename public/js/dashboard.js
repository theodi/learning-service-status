(function () {
  var root = document.getElementById('dashboard-root');
  if (!root) return;

  var searchInput = document.getElementById('filter-search');
  var list = document.getElementById('service-list');
  var summary = document.getElementById('fleet-summary');
  var currentStatus = 'all';

  function setActiveFilter(status) {
    currentStatus = status || 'all';
    root.setAttribute('data-filter', currentStatus);
    if (!summary) return;
    summary.querySelectorAll('[data-filter]').forEach(function (btn) {
      var active = btn.getAttribute('data-filter') === currentStatus;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function applyFilters() {
    var q = ((searchInput && searchInput.value) || '').trim().toLowerCase();
    var sections = list ? list.querySelectorAll('.service') : [];
    sections.forEach(function (el) {
      var overall = el.getAttribute('data-overall');
      var stale = el.getAttribute('data-stale') === 'true';
      var name = (el.getAttribute('data-service') || '').toLowerCase();
      var statusOk =
        currentStatus === 'all' ||
        (currentStatus === 'stale' ? stale : overall === currentStatus);
      var searchOk = !q || name.indexOf(q) !== -1;
      el.style.display = statusOk && searchOk ? '' : 'none';
    });
  }

  if (summary) {
    summary.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-filter]');
      if (!btn || !summary.contains(btn)) return;
      var next = btn.getAttribute('data-filter') || 'all';
      // Clicking the active filter again clears to all
      if (next === currentStatus && next !== 'all') next = 'all';
      setActiveFilter(next);
      applyFilters();
    });
  }

  if (searchInput) searchInput.addEventListener('input', applyFilters);

  if (list) {
    list.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.service-summary');
      if (!btn || !list.contains(btn)) return;
      var section = btn.closest('.service');
      if (!section) return;
      var collapsed = section.getAttribute('data-collapsed') !== 'false';
      var next = !collapsed;
      section.setAttribute('data-collapsed', next ? 'true' : 'false');
      btn.setAttribute('aria-expanded', next ? 'false' : 'true');
      var toggle = btn.querySelector('.service-toggle');
      if (toggle) toggle.textContent = next ? '▸' : '▾';
    });
  }

  setInterval(function () {
    fetch('/reports', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          window.location.href = '/login';
          return null;
        }
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.services)) return;
        window.location.reload();
      })
      .catch(function () {});
  }, 30000);
})();
