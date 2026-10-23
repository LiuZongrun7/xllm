/* ==========================================================================
   xLLM · public site — /info
   只有三件事：移动端菜单、滚动出现、当前区块高亮。
   没有框架、没有依赖、没有网络请求。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 菜单 */
  var nav = document.getElementById('i-nav-links');
  var toggle = document.getElementById('i-nav-toggle');

  function closeMenu() {
    if (!nav || !toggle) return;
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
  }

  if (nav && toggle) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) closeMenu();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 980) closeMenu();
    });
  }

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* -------------------------------------------------------- 滚动出现 */
  var revealSelector = [
    '.i-sec__head', '.i-role', '.i-cell', '.i-flow__step',
    '.i-branch', '.i-tree', '.i-stack__group', '.i-design',
    '.i-team__member', '.i-cta', '.i-note'
  ].join(',');

  var candidates = document.querySelectorAll(revealSelector);

  if (!reduced && 'IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('i-in');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });

    candidates.forEach(function (el) {
      var siblings = Array.prototype.filter.call(
        el.parentElement.children,
        function (child) { return child.matches(revealSelector); }
      );
      var index = siblings.indexOf(el);
      el.style.setProperty('--d', String(Math.min(Math.max(index, 0), 6)));
      el.classList.add('i-reveal');
      revealObserver.observe(el);
    });
  }

  /* ---------------------------------------------------- 当前区块高亮 */
  var links = Array.prototype.slice.call(
    document.querySelectorAll('.i-nav__links a[href^="#"]')
  );

  var sections = links
    .map(function (link) {
      var id = link.getAttribute('href').slice(1);
      var section = document.getElementById(id);
      return section ? { link: link, section: section } : null;
    })
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        sections.forEach(function (item) {
          if (item.section !== entry.target) item.link.removeAttribute('aria-current');
        });
        var match = sections.filter(function (item) {
          return item.section === entry.target;
        })[0];
        if (match) match.link.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    sections.forEach(function (item) { spy.observe(item.section); });
  }
})();
