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
    var groups = list ? list.querySelectorAll('.host-group') : [];
    groups.forEach(function (group) {
      var services = group.querySelectorAll('.service');
      var anyVisible = false;
      services.forEach(function (el) {
        var overall = el.getAttribute('data-overall');
        var stale = el.getAttribute('data-stale') === 'true';
        var name = (el.getAttribute('data-service') || '').toLowerCase();
        var host = (el.getAttribute('data-host') || group.getAttribute('data-host') || '').toLowerCase();
        var statusOk =
          currentStatus === 'all' ||
          (currentStatus === 'stale' ? stale : overall === currentStatus);
        var searchOk = !q || name.indexOf(q) !== -1 || host.indexOf(q) !== -1;
        var show = statusOk && searchOk;
        el.style.display = show ? '' : 'none';
        if (show) anyVisible = true;
      });
      group.style.display = anyVisible ? '' : 'none';
    });
  }

  if (summary) {
    summary.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-filter]');
      if (!btn || !summary.contains(btn)) return;
      var next = btn.getAttribute('data-filter') || 'all';
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
      var section = btn.closest('.service, .host-group');
      if (!section) return;
      var collapsed = section.getAttribute('data-collapsed') !== 'false';
      var next = !collapsed;
      section.setAttribute('data-collapsed', next ? 'true' : 'false');
      btn.setAttribute('aria-expanded', next ? 'false' : 'true');
      var toggle = btn.querySelector('.service-toggle');
      if (toggle) toggle.textContent = next ? '▸' : '▾';
    });
  }
})();
