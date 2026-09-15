/* NICL site behaviour. No framework, no build step.
   Everything here degrades: the page reads fully with JavaScript off. */
(function () {
  'use strict';

  /* ---- Theme: honour the OS by default, remember an explicit choice. ---- */
  var root = document.documentElement;
  function storedTheme() { try { return localStorage.getItem('nicl-theme'); } catch (e) { return null; } }
  function storeTheme(v) { try { v ? localStorage.setItem('nicl-theme', v) : localStorage.removeItem('nicl-theme'); } catch (e) {} }
  var saved = storedTheme();
  if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);

  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    var label = btn.querySelector('span');
    function sync() {
      var explicit = root.getAttribute('data-theme');
      var dark = explicit ? explicit === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      if (label) label.textContent = dark ? 'Light mode' : 'Dark mode';
      btn.setAttribute('aria-pressed', String(dark));
    }
    btn.addEventListener('click', function () {
      var explicit = root.getAttribute('data-theme');
      var dark = explicit ? explicit === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      var next = dark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      storeTheme(next);
      sync();
    });
    sync();
  });

  /* ---- Mobile navigation ---- */
  var menuBtn = document.querySelector('.menu-btn');
  var nav = document.getElementById('site-nav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.textContent = open ? 'Close' : 'Menu';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) menuBtn.click();
    });
  }

  /* ---- Hero backdrop: an eight-point star lattice, drawn once, in brass. ----
     The pattern is geometric rather than photographic on purpose: the company
     has no product to photograph, only obligations it underwrites. */
  var canvas = document.getElementById('hero-lattice');
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext('2d');
    function drawLattice() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var cell = Math.max(72, Math.min(120, w / 12));
      var cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
      ctx.lineWidth = 1;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var cx = c * cell, cy = r * cell;
          /* Fade the lattice toward the left, where the headline sits. */
          var fx = Math.min(1, Math.max(0, (cx / w - 0.35) / 0.65));
          var fy = 1 - Math.abs(cy / h - 0.5) * 0.6;
          var a = 0.06 + 0.32 * fx * fy;
          ctx.strokeStyle = 'rgba(214, 178, 90,' + a.toFixed(3) + ')';
          star(cx, cy, cell * 0.5);
        }
      }
      function star(x, y, R) {
        var r = R * 0.62;
        ctx.beginPath();
        for (var i = 0; i < 16; i++) {
          var ang = (Math.PI / 8) * i - Math.PI / 2;
          var rad = i % 2 === 0 ? R : r;
          var px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, R * 0.18, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    drawLattice();
    var raf;
    window.addEventListener('resize', function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawLattice); });
  }

  /* ---- "Find your cover" router on the homepage ---- */
  var finder = document.getElementById('finder');
  if (finder) {
    finder.addEventListener('submit', function (e) {
      e.preventDefault();
      var sel = finder.querySelector('select');
      if (sel && sel.value) window.location.href = sel.value;
    });
  }

  /* ---- Table of contents: highlight the section in view ---- */
  var tocLinks = document.querySelectorAll('.toc a[href^="#"]');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          tocLinks.forEach(function (a) { a.classList.remove('is-active'); });
          var a = map[en.target.id]; if (a) a.classList.add('is-active');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    Object.keys(map).forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  }

  /* ---- Claims checklist: switch the document list by class of cover ---- */
  var claimSel = document.getElementById('claim-class');
  if (claimSel) {
    var lists = document.querySelectorAll('[data-claim-docs]');
    function showDocs() {
      lists.forEach(function (ul) { ul.hidden = ul.getAttribute('data-claim-docs') !== claimSel.value; });
    }
    claimSel.addEventListener('change', showDocs);
    showDocs();
  }

  /* ---- Tender filter ---- */
  var tenderFilter = document.getElementById('tender-status');
  if (tenderFilter) {
    var rows = document.querySelectorAll('[data-tender-status]');
    function filterTenders() {
      rows.forEach(function (tr) { tr.hidden = tenderFilter.value !== 'all' && tr.getAttribute('data-tender-status') !== tenderFilter.value; });
    }
    tenderFilter.addEventListener('change', filterTenders);
    filterTenders();
  }

  /* ---- Forms: this is a front-end; there is no server yet. ---- */
  document.querySelectorAll('form[data-demo]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = f.querySelector('[data-form-result]');
      if (out) { out.hidden = false; out.focus(); }
    });
  });
})();
