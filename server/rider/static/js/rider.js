/* ============================================================================
   xLLM · Rider app — vanilla JS
   ----------------------------------------------------------------------------
   One file for all rider pages. The page is chosen by <body data-page="...">.
   No libraries, no build step, no CDN. Everything comes from /api/rider/*.
   ========================================================================== */
(function () {
  'use strict';

  var ROOT = '/rider';
  var body = document.body;
  var PAGE = body.getAttribute('data-page') || '';
  var FLASH_KEY = 'xllm.rider.flash';
  var CLAIMED_KEY = 'xllm.rider.claimed';

  var STATUS_LABELS = {
    pending: 'Placed',
    accepted: 'Accepted',
    preparing: 'Preparing',
    ready: 'Ready',
    delivering: 'On the way',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
  };
  var STATUS_CHIPS = {
    pending: 'r-chip--neutral',
    accepted: 'r-chip--neutral',
    preparing: 'r-chip--neutral',
    ready: 'r-chip--warning',
    delivering: '',
    delivered: 'r-chip--neutral',
    cancelled: 'r-chip--danger'
  };
  var VEHICLES = {
    bike: 'Bike',
    ebike: 'E-bike',
    motorbike: 'Motorbike',
    car: 'Car'
  };

  /* ------------------------------------------------------------------------
     Tiny DOM helpers
     ---------------------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ------------------------------------------------------------------------
     Formatting — docs: ¥12.00 / HH:mm / Oct 22 / 1.2 km
     ---------------------------------------------------------------------- */
  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function km(value) {
    var n = num(value);
    if (n == null) return '—';
    var text = (Math.round(n * 10) / 10).toFixed(1);
    return text.replace(/\.0$/, '');
  }

  function money(value) {
    var n = num(value);
    return n == null ? '0.00' : n.toFixed(2);
  }

  function parseDate(value) {
    if (!value) return null;
    var d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function fmtTime(value) {
    var d = parseDate(value);
    return d ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '—';
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(value) {
    var d = parseDate(value);
    if (!d) return '—';
    return MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  function agoShort(epochMs) {
    if (!epochMs) return 'just now';
    var secs = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
    if (secs < 4) return 'just now';
    if (secs < 60) return secs + ' s ago';
    var mins = Math.floor(secs / 60);
    if (mins < 60) return mins + ' min ago';
    var hours = Math.floor(mins / 60);
    return hours + ' h ago';
  }

  function plural(n, one, many) {
    return n === 1 ? one : (many || one + 's');
  }

  function initials(name, username) {
    var source = String(name || username || 'R').trim();
    var parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  function telHref(phone) {
    return String(phone || '').replace(/[^0-9+]/g, '');
  }

  function firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || '';
  }

  /* ------------------------------------------------------------------------
     API — {ok, data} / {ok, error}; 401 redirects unless we are on auth pages
     ---------------------------------------------------------------------- */
  function ApiError(message, status) {
    this.name = 'ApiError';
    this.message = message;
    this.status = status || 0;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function defaultError(status) {
    if (status === 404) return 'We could not find that. It may have been removed.';
    if (status === 422) return 'That data did not look right. Check it and try again.';
    if (status === 409) return 'This order changed while you were looking at it. Refresh and try again.';
    if (status >= 500) return 'Something went wrong on our side. Try again in a moment.';
    return 'Request failed. Check your connection and try again.';
  }

  function api(path, options, config) {
    var opts = options || {};
    var cfg = config || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    };
    if (opts.body != null) init.body = opts.body;

    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (res.status === 401 && !cfg.noRedirect) {
          window.location.href = ROOT + '/login';
          throw new ApiError('Your session expired. Please sign in again.', 401);
        }
        if (!json || json.ok !== true) {
          var message = (json && json.error) || defaultError(res.status);
          throw new ApiError(message, res.status);
        }
        return json.data === undefined ? {} : json.data;
      });
    }, function () {
      throw new ApiError('Network error. Check your connection and try again.', 0);
    });
  }

  /* ------------------------------------------------------------------------
     Toasts / flash across navigation
     ---------------------------------------------------------------------- */
  function toast(message, tone, ms) {
    if (!message) return;
    var host = $('#toasts');
    if (!host) return;
    var node = el('div', 'r-toast' + (tone === 'success' ? ' r-toast--success' : tone === 'error' ? ' r-toast--error' : ''), message);
    host.appendChild(node);
    window.setTimeout(function () {
      node.style.opacity = '0';
      window.setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 200);
    }, ms || 4200);
  }

  function flash(message, tone) {
    try {
      sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message: message, tone: tone || 'success' }));
    } catch (e) { /* private mode */ }
  }

  /* Workbench API only lists *delivering* orders, so a claimed order that has
     not been picked up yet would vanish from both tabs. Remember it locally
     and re-hydrate from the order detail endpoint until pickup. */
  function claimedIds() {
    try {
      var raw = localStorage.getItem(CLAIMED_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function rememberClaimed(id) {
    var ids = claimedIds().filter(function (value) { return value !== String(id); });
    ids.unshift(String(id));
    try {
      localStorage.setItem(CLAIMED_KEY, JSON.stringify(ids.slice(0, 8)));
    } catch (e) { /* storage full or disabled */ }
  }

  function forgetClaimed(id) {
    var ids = claimedIds().filter(function (value) { return value !== String(id); });
    try {
      localStorage.setItem(CLAIMED_KEY, JSON.stringify(ids));
    } catch (e) { /* ignore */ }
  }

  function consumeFlash() {
    var raw = null;
    try {
      raw = sessionStorage.getItem(FLASH_KEY);
      if (raw) sessionStorage.removeItem(FLASH_KEY);
    } catch (e) { return; }
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      if (data && data.message) toast(data.message, data.tone, 5200);
    } catch (e) { /* ignore malformed */ }
  }

  /* ------------------------------------------------------------------------
     Icons (inline SVG only — no icon font, no images)
     ---------------------------------------------------------------------- */
  function svg(paths, extra) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (extra || '') + '>' + paths + '</svg>';
  }

  var ICON = {
    pin: svg('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>'),
    home: svg('<path d="M3 21h18M6 21V8l6-4 6 4v13M10 21v-5h4v5"/>'),
    phone: svg('<path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z"/>'),
    nav: svg('<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    bag: svg('<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
    loc: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    check: svg('<path d="M4 12.5l5 5L20 6.5"/>'),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>')
  };

  var EMPTY_ICON = {
    bag: '<svg class="r-empty__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="14" width="32" height="22" rx="3"/><path d="M16 14V9h16v5"/><path d="M18 25h12"/></svg>',
    route: '<svg class="r-empty__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="12" r="4"/><circle cx="35" cy="36" r="4"/><path d="M13 16v10a6 6 0 0 0 6 6h12"/></svg>',
    check: '<svg class="r-empty__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="24" cy="24" r="16"/><path d="M16 24.5l6 6 11-13"/></svg>',
    alert: '<svg class="r-empty__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M24 9 43 41H5L24 9Z"/><path d="M24 21v9M24 35v.01"/></svg>',
    clock: '<svg class="r-empty__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="24" cy="24" r="16"/><path d="M24 13v11l8 5"/></svg>',
    offline: '<svg class="r-empty__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 20a22 22 0 0 1 32 0M14 27a14 14 0 0 1 20 0M20 34a6 6 0 0 1 8 0"/><path d="M24 40v.01"/></svg>'
  };

  function emptyState(opts) {
    return '<div class="r-card"><div class="r-empty r-empty--card">' +
      (EMPTY_ICON[opts.icon] || EMPTY_ICON.bag) +
      '<div class="r-empty__title">' + esc(opts.title) + '</div>' +
      '<div class="r-empty__desc">' + esc(opts.desc) + '</div>' +
      (opts.actions ? '<div class="r-empty__actions">' + opts.actions + '</div>' : '') +
      '</div></div>';
  }

  function errorBanner(message) {
    return '<div class="r-banner r-banner--error" role="alert">' + ICON.alert +
      '<span>' + esc(message) + '</span></div>';
  }

  /* ------------------------------------------------------------------------
     Buttons
     ---------------------------------------------------------------------- */
  function setBtnBusy(btn, busy, label) {
    if (!btn) return;
    var spinner = btn.querySelector('.r-spinner');
    var text = btn.querySelector('.r-btn__label');
    if (busy) {
      if (text) {
        btn.setAttribute('data-prev-label', text.textContent);
        if (label) text.textContent = label;
      }
      btn.disabled = true;
      btn.classList.add('is-loading');
      if (spinner) spinner.hidden = false;
    } else {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      if (spinner) spinner.hidden = true;
      var prev = btn.getAttribute('data-prev-label');
      if (text && prev) text.textContent = prev;
    }
  }

  /* ------------------------------------------------------------------------
     Segmented tabs (roving tabindex + arrow keys)
     ---------------------------------------------------------------------- */
  function bindTabs(container, attr, onChange) {
    if (!container) return null;
    var tabs = $$('[' + attr + ']', container);
    if (!tabs.length) return null;

    function select(tab, focus) {
      tabs.forEach(function (item) {
        var active = item === tab;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
        item.tabIndex = active ? 0 : -1;
      });
      if (focus) tab.focus();
      if (onChange) onChange(tab.getAttribute(attr), tab);
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { select(tab); });
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        var step = event.key === 'ArrowRight' ? 1 : -1;
        select(tabs[(index + step + tabs.length) % tabs.length], true);
      });
    });
    return { select: select, tabs: tabs };
  }

  function chooseTab(container, attr, value) {
    var tabs = $$('[' + attr + ']', container);
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute(attr) === String(value)) { tabs[i].click(); return; }
    }
  }

  /* ------------------------------------------------------------------------
     CSS gradients for restaurant tiles (stable hash, no images)
     ---------------------------------------------------------------------- */
  var GRADIENTS = [
    ['#E8B268', '#B8762B'],
    ['#8FAF8B', '#4C7A5A'],
    ['#D39A9A', '#A85555'],
    ['#9DB2C8', '#5A7593'],
    ['#BFA6D6', '#7B5A94'],
    ['#E2B27E', '#9C6B3A']
  ];

  function hashString(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function shopTile(name) {
    var source = String(name || 'xLLM');
    var g = GRADIENTS[hashString(source) % GRADIENTS.length];
    return '<div class="r-shop" style="--r-shop-a:' + g[0] + ';--r-shop-b:' + g[1] + '" aria-hidden="true">' +
      esc(source.trim().charAt(0).toUpperCase()) + '</div>';
  }

  /* ------------------------------------------------------------------------
     Location sharing (order page)
     ---------------------------------------------------------------------- */
  var locationState = {
    supported: typeof navigator !== 'undefined' && !!navigator.geolocation,
    state: 'off',
    permission: 'unknown',
    lastAt: null,
    accuracy: null,
    error: '',
    auto: false,
    timer: null,
    inFlight: false,
    orderId: null
  };

  function geoMessage(error) {
    if (!error) return 'Could not read your location. Try again.';
    if (error.code === 1) {
      return 'Location access is blocked. Allow location access in your browser settings, then tap Share my location again.';
    }
    if (error.code === 2) {
      return 'We could not get a GPS fix. Move somewhere more open and try again.';
    }
    if (error.code === 3) {
      return 'Getting your location timed out. Try again.';
    }
    return 'Could not read your location. Try again.';
  }

  function locationCard() {
    return '<section class="r-card" id="location-card" style="margin-bottom:12px">' +
      '<div class="r-card__title">' + ICON.loc + '<span>Location sharing</span></div>' +
      '<div class="r-loc">' +
        '<div class="r-loc__state">' +
          '<span class="r-loc__pulse r-loc__pulse--off" data-loc-pulse></span>' +
          '<div>' +
            '<div class="r-loc__status" data-loc-status>Location sharing is off</div>' +
            '<div class="r-loc__detail" data-loc-detail>Tap Share my location so the customer can follow your ride.</div>' +
          '</div>' +
        '</div>' +
        '<div class="r-loc__grid">' +
          '<div><div class="r-meta">Last shared</div><div class="r-loc__val" data-loc-last>—</div></div>' +
          '<div><div class="r-meta">Auto-share</div><div class="r-loc__val">Every 20 s</div></div>' +
        '</div>' +
        '<div class="r-banner r-banner--error" data-loc-error hidden>' + ICON.alert +
          '<span data-loc-error-text></span></div>' +
        '<button class="r-btn r-btn--ghost" type="button" data-action="share">' +
          '<span class="r-spinner" hidden aria-hidden="true"></span>' +
          '<span class="r-btn__label">Share my location</span>' +
        '</button>' +
      '</div>' +
    '</section>';
  }

  function updateLocationPanel() {
    var card = document.getElementById('location-card');
    if (!card) return;
    var statusEl = card.querySelector('[data-loc-status]');
    var detailEl = card.querySelector('[data-loc-detail]');
    var pulse = card.querySelector('[data-loc-pulse]');
    var lastEl = card.querySelector('[data-loc-last]');
    var errEl = card.querySelector('[data-loc-error]');
    var errText = card.querySelector('[data-loc-error-text]');

    var status = 'Location sharing is off';
    var detail = 'Tap Share my location to allow access. It then auto-shares every 20 seconds while you deliver.';
    var mode = 'off';

    if (!locationState.supported) {
      detail = 'This browser cannot share a location. Use a phone with location services enabled.';
    } else if (locationState.state === 'requesting') {
      status = 'Sharing your location…';
      detail = 'Waiting for a GPS fix.';
      mode = 'idle';
    } else if (locationState.state === 'shared') {
      status = 'Shared ' + agoShort(locationState.lastAt);
      detail = 'Accuracy ±' + (locationState.accuracy == null ? '—' : locationState.accuracy) +
        ' m · auto-shares every 20 seconds.';
      mode = locationState.auto ? 'live' : 'idle';
    } else if (locationState.state === 'denied') {
      detail = 'Your browser is blocking location. Allow it in your browser settings, then tap Share my location again.';
    } else if (locationState.state === 'error') {
      detail = 'We could not share your position. Tap Share my location to try again.';
    }

    if (statusEl) statusEl.textContent = status;
    if (detailEl) detailEl.textContent = detail;
    if (lastEl) lastEl.textContent = locationState.lastAt ? fmtTime(new Date(locationState.lastAt)) : '—';

    if (pulse) {
      pulse.classList.remove('is-live', 'r-loc__pulse--off', 'r-loc__pulse--err');
      if (mode === 'live') pulse.classList.add('is-live');
      else if (mode === 'idle') {
        /* green but not pulsing while a share is in flight */
      } else if (locationState.error) pulse.classList.add('r-loc__pulse--err');
      else pulse.classList.add('r-loc__pulse--off');
    }

    if (errEl) errEl.hidden = !locationState.error;
    if (errText) errText.textContent = locationState.error || '';
  }

  function stopAutoShare() {
    if (locationState.timer) {
      window.clearInterval(locationState.timer);
      locationState.timer = null;
    }
    locationState.auto = false;
  }

  function startAutoShare(immediate) {
    if (locationState.auto) {
      if (immediate) reportLocation(false);
      return;
    }
    locationState.auto = true;
    locationState.timer = window.setInterval(function () {
      if (!document.hidden) reportLocation(false);
    }, 20000);
    if (immediate) reportLocation(false);
    updateLocationPanel();
  }

  function reportLocation(manual) {
    if (locationState.inFlight) return;
    var order = orderState.order;
    if (!order || order.status !== 'delivering') return;

    var btn = document.querySelector('[data-action="share"]');
    locationState.inFlight = true;
    locationState.error = '';
    locationState.state = 'requesting';
    updateLocationPanel();
    if (manual) setBtnBusy(btn, true, 'Sharing…');

    function finish() {
      locationState.inFlight = false;
      if (manual) setBtnBusy(btn, false);
      updateLocationPanel();
    }

    if (!locationState.supported) {
      locationState.state = 'unsupported';
      locationState.error = 'This device does not support location sharing.';
      finish();
      return;
    }

    navigator.geolocation.getCurrentPosition(function (position) {
      var coords = position.coords;
      api('/api/rider/orders/' + locationState.orderId + '/location', {
        method: 'POST',
        body: JSON.stringify({
          lng: coords.longitude,
          lat: coords.latitude,
          accuracy_m: Math.round(coords.accuracy)
        })
      }).then(function () {
        locationState.state = 'shared';
        locationState.lastAt = Date.now();
        locationState.accuracy = Math.round(coords.accuracy);
        locationState.error = '';
        if (locationState.permission !== 'granted') locationState.permission = 'granted';
        if (!locationState.auto) startAutoShare(false);
        finish();
      }).catch(function (error) {
        locationState.state = 'error';
        locationState.error = error.status === 422
          ? error.message
          : (error.message || 'Could not share your location.');
        if (manual) toast(locationState.error, 'error');
        finish();
      });
    }, function (error) {
      locationState.state = error && error.code === 1 ? 'denied' : 'error';
      locationState.error = geoMessage(error);
      if (error && error.code === 1) locationState.permission = 'denied';
      if (manual) toast(locationState.error, 'error');
      finish();
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 });
  }

  function startLocation(order) {
    if (locationState.orderId === order.id && locationState.auto) {
      updateLocationPanel();
      return;
    }
    locationState.orderId = order.id;
    locationState.state = 'off';
    locationState.error = '';
    updateLocationPanel();

    if (!locationState.supported) {
      locationState.state = 'unsupported';
      locationState.error = 'This device does not support location sharing.';
      updateLocationPanel();
      return;
    }

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(function (status) {
        locationState.permission = status.state;
        if (status.state === 'granted') {
          startAutoShare(true);
        } else {
          if (status.state === 'denied') locationState.state = 'denied';
          updateLocationPanel();
        }
        if (status.addEventListener) {
          status.addEventListener('change', function () {
            locationState.permission = status.state;
            if (status.state === 'granted') {
              startAutoShare(true);
            } else {
              stopAutoShare();
              locationState.state = status.state === 'denied' ? 'denied' : 'off';
              updateLocationPanel();
            }
          });
        }
      }).catch(function () {
        startAutoShare(true);
      });
    } else {
      startAutoShare(true);
    }
  }

  function stopLocation() {
    stopAutoShare();
    locationState.state = 'off';
    locationState.orderId = null;
    locationState.inFlight = false;
  }

  /* ------------------------------------------------------------------------
     AUTH pages (login / register)
     ---------------------------------------------------------------------- */
  function validateEmail(value) {
    return /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(value);
  }

  function setFieldError(name, message) {
    var field = $('[data-field="' + name + '"]');
    if (!field) return;
    var input = field.querySelector('input, select');
    var err = field.querySelector('[data-err]');
    field.classList.toggle('is-invalid', !!message);
    if (err) {
      err.textContent = message || '';
      if (message) {
        if (!err.id) err.id = 'err-' + name;
        if (input) input.setAttribute('aria-describedby', err.id);
      }
    }
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function clearFieldErrors(form) {
    $$('.r-field', form).forEach(function (field) {
      field.classList.remove('is-invalid');
      var err = field.querySelector('[data-err]');
      if (err) err.textContent = '';
      var input = field.querySelector('input, select');
      if (input) input.removeAttribute('aria-invalid');
    });
  }

  function showFormError(message) {
    var banner = $('#form-error');
    if (!banner) return;
    banner.hidden = !message;
    var text = banner.querySelector('[data-error-text]');
    if (text) text.textContent = message || '';
  }

  function fieldForError(message) {
    var m = String(message || '').toLowerCase();
    if (m.indexOf('username') !== -1) return 'username';
    if (m.indexOf('email') !== -1) return 'email';
    if (m.indexOf('password') !== -1) return 'password';
    if (m.indexOf('phone') !== -1) return 'phone';
    return null;
  }

  function bindPasswordToggles() {
    $$('[data-pw-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        var wrap = button.closest('.r-inputwrap');
        var input = wrap ? wrap.querySelector('input') : null;
        if (!input) return;
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.setAttribute('aria-pressed', show ? 'true' : 'false');
        button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        button.innerHTML = show
          ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15.6 15.6 0 0 1-3.3 3.9M6.6 7.5A15.8 15.8 0 0 0 2.5 12S6 18 12 18a9.8 9.8 0 0 0 3.3-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
          : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
        input.focus();
      });
    });
  }

  function initAuth() {
    bindPasswordToggles();
    var form = PAGE === 'login' ? $('#login-form') : $('#register-form');
    if (!form) return;
    var submit = $('#submit-btn');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearFieldErrors(form);
      showFormError('');

      var data = {
        account: (form.account && form.account.value || '').trim(),
        password: form.password ? form.password.value : ''
      };

      if (PAGE === 'login') {
        var loginErrors = 0;
        if (!data.account) { setFieldError('account', 'Enter your username or email.'); loginErrors++; }
        if (!data.password) { setFieldError('password', 'Enter your password.'); loginErrors++; }
        if (loginErrors) { focusFirstInvalid(form); return; }
        submitAuth('/api/auth/login', { account: data.account, password: data.password }, submit, 'Signing in…');
        return;
      }

      var username = (($('#username', form) || {}).value || '').trim();
      var email = (($('#email', form) || {}).value || '').trim();
      var phone = (($('#phone', form) || {}).value || '').trim();
      var password = ($('#password', form) || {}).value || '';
      var confirm = ($('#confirm', form) || {}).value || '';
      var errors = 0;

      if (!username) { setFieldError('username', 'Choose a username.'); errors++; }
      else if (!/^[\w\u4e00-\u9fa5]{3,40}$/.test(username)) {
        setFieldError('username', 'Use 3–40 letters, digits, underscore or Chinese characters.');
        errors++;
      }
      if (!email) { setFieldError('email', 'Enter your email address.'); errors++; }
      else if (!validateEmail(email)) { setFieldError('email', 'Enter a valid email address.'); errors++; }
      if (phone && !/^[0-9+\-\s]+$/.test(phone)) {
        setFieldError('phone', 'Use digits, spaces, + and - only.');
        errors++;
      }
      if (password.length < 8) { setFieldError('password', 'Use at least 8 characters.'); errors++; }
      if (!confirm) { setFieldError('confirm', 'Type your password again.'); errors++; }
      else if (confirm !== password) { setFieldError('confirm', 'The two passwords do not match.'); errors++; }

      if (errors) { focusFirstInvalid(form); return; }

      submitAuth('/api/auth/register', {
        username: username,
        email: email,
        password: password,
        phone: phone || undefined,
        role: 'rider'
      }, submit, 'Creating account…');
    });

    function focusFirstInvalid(root) {
      var first = $('.r-field.is-invalid input, .r-field.is-invalid select', root);
      if (first) first.focus();
    }

    function submitAuth(path, payload, button, label) {
      setBtnBusy(button, true, label);
      api(path, {
        method: 'POST',
        body: JSON.stringify(payload)
      }, { noRedirect: true }).then(function (data) {
        if (PAGE === 'login' && data && data.role && data.role !== 'rider') {
          return api('/api/auth/logout', { method: 'POST' }, { noRedirect: true }).then(function () {
            throw new ApiError('That account is not a rider account. Use the customer or merchant portal instead.', 403);
          });
        }
        window.location.href = ROOT + '/';
      }).catch(function (error) {
        setBtnBusy(button, false);
        var field = fieldForError(error.message);
        if (field) setFieldError(field, error.message);
        showFormError(error.message);
        if (field) {
          var input = $('[data-field="' + field + '"] input');
          if (input) input.focus();
        }
      });
    }
  }

  /* ------------------------------------------------------------------------
     WORKBENCH
     ---------------------------------------------------------------------- */
  var wb = {
    data: null,
    pending: [],
    tab: 'available',
    notice: null,
    noticeTimer: null,
    lastSync: 0,
    loading: false,
    error: null
  };

  function vehicleLabel(type) {
    return VEHICLES[type] || 'E-bike';
  }

  function setSyncText(text) {
    var node = $('[data-sync]');
    if (node) node.textContent = text;
  }

  function initWorkbench() {
    bindTabs($('.r-tabs'), 'data-tab', function (name) {
      wb.tab = name;
      renderPanels();
    });

    document.addEventListener('click', function (event) {
      var target = event.target.closest('button, a');
      if (!target) return;

      if (target.hasAttribute('data-refresh') || target.hasAttribute('data-refresh-inline')) {
        event.preventDefault();
        loadWorkbench({ user: true });
        return;
      }
      if (target.hasAttribute('data-retry')) {
        event.preventDefault();
        loadWorkbench({ user: true });
        return;
      }
      if (target.hasAttribute('data-go-online')) {
        event.preventDefault();
        setOnline(true);
        return;
      }
      var switchTab = target.closest('[data-switch-tab]');
      if (switchTab) {
        event.preventDefault();
        chooseTab($('.r-tabs'), 'data-tab', switchTab.getAttribute('data-switch-tab'));
        return;
      }
      if (target.hasAttribute('data-online-toggle')) {
        event.preventDefault();
        setOnline(target.getAttribute('aria-checked') !== 'true');
        return;
      }
      var claim = target.closest('[data-claim]');
      if (claim) { event.preventDefault(); claimOrder(claim.getAttribute('data-claim'), claim); return; }
      var deliver = target.closest('[data-deliver]');
      if (deliver) { event.preventDefault(); deliverFromCard(deliver.getAttribute('data-deliver'), deliver); return; }
      var pickup = target.closest('[data-pickup]');
      if (pickup) { event.preventDefault(); pickupFromCard(pickup.getAttribute('data-pickup'), pickup); }
    });

    window.setInterval(function () {
      if (!wb.data || !wb.data.profile || !wb.data.profile.is_online) return;
      if (document.hidden) return;
      loadWorkbench({ silent: true });
    }, 30000);

    window.setInterval(function () {
      if (wb.lastSync) setSyncText('Updated ' + agoShort(wb.lastSync));
    }, 10000);

    loadWorkbench({ initial: true });
  }

  function loadWorkbench(options) {
    var opts = options || {};
    if (wb.loading && !opts.force) return;
    wb.loading = true;
    if (opts.user) setSyncText('Refreshing…');

    api('/api/rider/workbench').then(function (data) {
      wb.data = data;
      wb.error = null;
      wb.lastSync = Date.now();
      return hydratePendingPickups().then(function () {
        renderWorkbench();
        setSyncText('Updated just now');
        $('#hero').setAttribute('aria-busy', 'false');
      });
    }).catch(function (error) {
      if (error.status === 401) return;
      wb.error = error.message;
      if (wb.data) {
        toast(error.message, 'error');
        setSyncText('Could not refresh — showing the last update');
      } else {
        renderWorkbenchError(error.message);
      }
    }).then(function () {
      wb.loading = false;
      $$('[data-refresh], [data-refresh-inline]').forEach(function (button) {
        if (button.classList.contains('is-loading')) setBtnBusy(button, false);
      });
    });
  }

  function hydratePendingPickups() {
    var ids = claimedIds();
    if (!ids.length) {
      wb.pending = [];
      return Promise.resolve();
    }
    return Promise.all(ids.slice(0, 5).map(function (id) {
      return api('/api/rider/orders/' + id).then(function (order) {
        if (order && order.status === 'ready' && (order.actions || []).indexOf('pickup') !== -1) {
          return order;
        }
        forgetClaimed(id);
        return null;
      }).catch(function () {
        forgetClaimed(id);
        return null;
      });
    })).then(function (rows) {
      wb.pending = rows.filter(Boolean);
    });
  }

  function renderWorkbenchError(message) {
    var hero = $('#hero');
    if (hero) {
      hero.setAttribute('aria-busy', 'false');
      hero.innerHTML = '<div class="r-empty" style="padding:4px 0">' +
        EMPTY_ICON.alert +
        '<div class="r-empty__title">We could not load your workbench</div>' +
        '<div class="r-empty__desc">' + esc(message) + '</div>' +
        '<div class="r-empty__actions">' +
          '<button class="r-btn" type="button" data-retry><span class="r-btn__label">Try again</span></button>' +
        '</div>' +
      '</div>';
    }
    var tabs = $('.r-tabs');
    if (tabs) tabs.hidden = true;
    var available = $('#panel-available');
    var active = $('#panel-active');
    var notice = $('#pool-notice');
    if (available) { available.hidden = true; available.setAttribute('aria-busy', 'false'); }
    if (active) { active.hidden = true; active.setAttribute('aria-busy', 'false'); }
    if (notice) notice.hidden = true;
    setSyncText('Not connected');
  }

  function renderWorkbench() {
    if (!wb.data) return;
    var tabs = $('.r-tabs');
    if (tabs) tabs.hidden = false;
    renderHero();
    renderCounts();
    renderNotice();
    renderPanels();
  }

  function renderHero() {
    var hero = $('#hero');
    var data = wb.data;
    var profile = data.profile || {};
    var stats = data.stats || {};
    var online = !!profile.is_online;
    var poolCount = (data.pool || []).length;
    var rating = stats.rating && stats.rating.rating != null ? Number(stats.rating.rating).toFixed(1) : '—';
    var reviewCount = stats.rating && stats.rating.review_count ? stats.rating.review_count : 0;
    var kmToday = km(stats.today_distance_km);
    var greeting = firstName(profile.name);

    var greetingEl = $('#greeting');
    if (greetingEl) greetingEl.textContent = greeting ? 'Hi, ' + greeting : 'Workbench';

    var chip = $('#rider-chip');
    if (chip) {
      chip.textContent = vehicleLabel(profile.vehicle_type);
      chip.hidden = false;
    }

    var subtitle = online
      ? (poolCount ? poolCount + ' ' + plural(poolCount, 'order') + ' ready to grab' : 'Watching for ready orders near you')
      : 'Go online to see orders near you';

    hero.innerHTML =
      '<div class="r-between">' +
        '<div class="r-row" style="gap:10px;align-items:flex-start">' +
          '<span class="r-dot ' + (online ? 'r-dot--live' : 'r-dot--off') + '" style="margin-top:7px"></span>' +
          '<div>' +
            '<div class="r-hero__title">' + (online ? "You're online" : "You're offline") + '</div>' +
            '<div class="r-hero__sub">' + esc(subtitle) + '</div>' +
          '</div>' +
        '</div>' +
        '<button class="r-switch" type="button" role="switch" aria-checked="' + (online ? 'true' : 'false') +
          '" aria-label="Online status" data-online-toggle>' +
          '<span class="r-switch__track"><span class="r-switch__thumb"></span></span>' +
          '<span class="r-switch__text">' + (online ? 'On' : 'Off') + '</span>' +
        '</button>' +
      '</div>' +
      '<div class="r-divider"></div>' +
      '<div class="r-stats">' +
        '<div class="r-stat">' +
          '<div class="r-big">' + (stats.today_deliveries || 0) + '</div>' +
          '<div class="r-stat__label">Deliveries today</div>' +
        '</div>' +
        '<div class="r-stat">' +
          '<div class="r-big">' + kmToday + '<span class="r-stat__unit"> km</span></div>' +
          '<div class="r-stat__label">Distance today</div>' +
        '</div>' +
        '<div class="r-stat">' +
          '<div class="r-big"' + (reviewCount ? ' title="' + reviewCount + ' rider reviews"' : '') + '>' + rating + '</div>' +
          '<div class="r-stat__label">' + (reviewCount ? 'Rating' : 'No ratings yet') + '</div>' +
        '</div>' +
      '</div>';
  }

  /* 后端现在也会把「已抢未取」的 ready 单放进 active，
     localStorage 里的 pending 只作为兜底，两边可能指向同一单 —— 必须去重。 */
  function uniqueActive() {
    var active = (wb.data && wb.data.active) || [];
    var seen = {};
    active.forEach(function (row) { seen[String(row.id)] = true; });
    var pending = (wb.pending || []).filter(function (row) {
      return !seen[String(row.id)];
    });
    return { active: active, pending: pending };
  }

  function renderCounts() {
    if (!wb.data) return;
    var online = !!(wb.data.profile && wb.data.profile.is_online);
    var pool = (wb.data.pool || []).length;
    var merged = uniqueActive();
    var active = merged.active.length + merged.pending.length;
    var poolEl = $('[data-count-available]');
    var activeEl = $('[data-count-active]');
    if (poolEl) poolEl.textContent = online ? pool : '–';
    if (activeEl) activeEl.textContent = active;
  }

  function renderNotice() {
    var host = $('#pool-notice');
    if (!host) return;
    host.hidden = !wb.notice;
    host.innerHTML = wb.notice ? errorBanner(wb.notice) : '';
  }

  function showPoolNotice(message) {
    wb.notice = message;
    renderNotice();
    if (wb.noticeTimer) window.clearTimeout(wb.noticeTimer);
    wb.noticeTimer = window.setTimeout(function () {
      wb.notice = null;
      renderNotice();
    }, 9000);
  }

  function renderPanels() {
    if (!wb.data) return;
    var available = $('#panel-available');
    var active = $('#panel-active');
    if (!available || !active) return;

    var isAvailable = wb.tab === 'available';
    available.hidden = !isAvailable;
    active.hidden = isAvailable;

    var tabAvailable = $('#tab-available');
    var tabActive = $('#tab-active');
    if (tabAvailable) {
      tabAvailable.classList.toggle('is-active', isAvailable);
      tabAvailable.setAttribute('aria-selected', isAvailable ? 'true' : 'false');
      tabAvailable.tabIndex = isAvailable ? 0 : -1;
    }
    if (tabActive) {
      tabActive.classList.toggle('is-active', !isAvailable);
      tabActive.setAttribute('aria-selected', !isAvailable ? 'true' : 'false');
      tabActive.tabIndex = !isAvailable ? 0 : -1;
    }

    if (isAvailable) renderAvailablePanel();
    else renderActivePanel();

    available.setAttribute('aria-busy', 'false');
    active.setAttribute('aria-busy', 'false');
  }

  function renderAvailablePanel() {
    var panel = $('#panel-available');
    if (!panel || !wb.data) return;
    var profile = wb.data.profile || {};
    var pool = wb.data.pool || [];

    if (!profile.is_online) {
      panel.innerHTML = '<div class="r-card"><div class="r-offline">' +
        '<div class="r-offline__icon">' + EMPTY_ICON.offline + '</div>' +
        '<div class="r-offline__title">You are offline</div>' +
        '<div class="r-offline__desc">The order pool is hidden while you are offline. Go online to see ready orders near you and start earning.</div>' +
        '<div class="r-empty__actions">' +
          '<button class="r-btn" type="button" data-go-online><span class="r-btn__label">Go online</span></button>' +
        '</div>' +
      '</div></div>';
      return;
    }

    if (!pool.length) {
      panel.innerHTML = emptyState({
        icon: 'bag',
        title: 'No orders ready right now',
        desc: 'Orders appear here the moment a restaurant marks them ready. We check again every 30 seconds.',
        actions: '<button class="r-btn r-btn--ghost" type="button" data-refresh-inline><span class="r-btn__label">Refresh the pool</span></button>'
      });
      return;
    }

    panel.innerHTML = pool.map(poolCard).join('');
  }

  function poolCard(order) {
    var pickup = order.pickup || {};
    var dropoff = order.dropoff || {};
    var waiting = Number(order.waiting_minutes) || 0;
    var items = Number(order.item_count) || 0;
    var trip = km(order.trip_km != null ? order.trip_km : order.distance_km);
    var waitChip = waiting >= 10 ? 'r-chip--warning' : 'r-chip--neutral';

    return '<article class="r-card r-order-card">' +
      '<div class="r-order-card__head">' +
        shopTile(pickup.name || order.order_no) +
        '<div class="r-order-card__headtext">' +
          '<div class="r-shop__name">' + esc(pickup.name || 'Restaurant') + '</div>' +
          '<div class="r-order-card__sub">' + esc(order.order_no) + ' · ' + items + ' ' + plural(items, 'item') +
            ' · ¥' + money(order.total_amount) + '</div>' +
        '</div>' +
        '<span class="r-chip ' + waitChip + '">' + waiting + ' min</span>' +
      '</div>' +
      '<div class="r-route">' +
        '<div class="r-route__rail" aria-hidden="true">' +
          '<span class="r-route__dot"></span><span class="r-route__line"></span><span class="r-route__dot r-route__dot--drop"></span>' +
        '</div>' +
        '<div class="r-route__body">' +
          '<div>' +
            '<div class="r-route__label">Pick up</div>' +
            '<div class="r-route__val">' + esc(pickup.name || 'Restaurant') + '</div>' +
            '<div class="r-route__sub">' + esc(pickup.address_text || 'Address not available') + '</div>' +
          '</div>' +
          '<div>' +
            '<div class="r-route__label">Drop off</div>' +
            '<div class="r-route__val">' + esc(dropoff.address_text || 'Address not available') + '</div>' +
            '<div class="r-route__sub">' + esc(dropoff.contact_name || 'Customer') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="r-kpis">' +
        '<div class="r-kpi"><div class="r-kpi__label">Trip</div>' +
          '<div class="r-big">' + trip + '<span class="r-kpi__unit"> km</span></div></div>' +
        '<div class="r-kpi"><div class="r-kpi__label">Items</div>' +
          '<div class="r-big">' + items + '</div></div>' +
        '<div class="r-kpi"><div class="r-kpi__label">Waiting</div>' +
          '<div class="r-big">' + waiting + '<span class="r-kpi__unit"> min</span></div></div>' +
      '</div>' +
      '<button class="r-btn" type="button" data-claim="' + order.id + '">' +
        '<span class="r-spinner" hidden aria-hidden="true"></span>' +
        '<span class="r-btn__label">Grab order</span>' +
      '</button>' +
    '</article>';
  }

  function renderActivePanel() {
    var panel = $('#panel-active');
    if (!panel || !wb.data) return;
    var merged = uniqueActive();
    var active = merged.active;
    var pending = merged.pending;

    if (!active.length && !pending.length) {
      panel.innerHTML = emptyState({
        icon: 'route',
        title: 'No deliveries in progress',
        desc: 'Grab an order from Available. It moves here as soon as it is yours.',
        actions: '<button class="r-btn r-btn--ghost" type="button" data-switch-tab="available"><span class="r-btn__label">Browse available orders</span></button>'
      });
      return;
    }

    panel.innerHTML = pending.map(pendingCard).join('') + active.map(activeCard).join('');
  }

  function pendingCard(order) {
    var pickup = order.pickup || {};
    var dropoff = order.dropoff || {};
    var items = Number(order.item_count) || 0;
    var trip = km(order.trip_km != null ? order.trip_km : order.distance_km);
    var waiting = Number(order.waiting_minutes) || 0;

    return '<article class="r-card r-order-card">' +
      '<div class="r-order-card__head">' +
        shopTile(pickup.name || order.order_no) +
        '<div class="r-order-card__headtext">' +
          '<div class="r-shop__name">' + esc(pickup.name || 'Restaurant') + '</div>' +
          '<div class="r-order-card__sub">' + esc(order.order_no) + ' · ' + esc(dropoff.contact_name || 'Customer') + '</div>' +
        '</div>' +
        '<span class="r-chip r-chip--warning">Ready</span>' +
      '</div>' +
      '<div class="r-route">' +
        '<div class="r-route__rail" aria-hidden="true">' +
          '<span class="r-route__dot"></span><span class="r-route__line"></span><span class="r-route__dot r-route__dot--drop"></span>' +
        '</div>' +
        '<div class="r-route__body">' +
          '<div>' +
            '<div class="r-route__label">Pick up</div>' +
            '<div class="r-route__val">' + esc(pickup.name || 'Restaurant') + '</div>' +
            '<div class="r-route__sub">' + esc(pickup.address_text || 'Address not available') + '</div>' +
          '</div>' +
          '<div>' +
            '<div class="r-route__label">Deliver to</div>' +
            '<div class="r-route__val">' + esc(dropoff.address_text || 'Address not available') + '</div>' +
            '<div class="r-route__sub">' + esc(dropoff.contact_name || 'Customer') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="r-kpis">' +
        '<div class="r-kpi"><div class="r-kpi__label">Trip</div>' +
          '<div class="r-big">' + trip + '<span class="r-kpi__unit"> km</span></div></div>' +
        '<div class="r-kpi"><div class="r-kpi__label">Items</div>' +
          '<div class="r-big">' + items + '</div></div>' +
        '<div class="r-kpi"><div class="r-kpi__label">Waiting</div>' +
          '<div class="r-big">' + waiting + '<span class="r-kpi__unit"> min</span></div></div>' +
      '</div>' +
      '<button class="r-btn" type="button" data-pickup="' + order.id + '">' +
        '<span class="r-spinner" hidden aria-hidden="true"></span>' +
        '<span class="r-btn__label">Mark picked up</span>' +
      '</button>' +
      '<a class="r-link" href="' + ROOT + '/orders/' + order.id + '">Order details' + ICON.arrow + '</a>' +
    '</article>';
  }

  function activeCard(order) {
    var pickup = order.pickup || {};
    var dropoff = order.dropoff || {};
    var actions = order.actions || [];
    var canDeliver = actions.indexOf('deliver') !== -1;
    var canPickup = actions.indexOf('pickup') !== -1;
    var items = Number(order.item_count) || 0;
    var trip = km(order.trip_km != null ? order.trip_km : order.distance_km);
    var eta = order.estimated_delivery_at ? fmtTime(order.estimated_delivery_at) : '—';
    var label = STATUS_LABELS[order.status] || order.status;

    return '<article class="r-card r-order-card">' +
      '<div class="r-order-card__head">' +
        shopTile(pickup.name || order.order_no) +
        '<div class="r-order-card__headtext">' +
          '<div class="r-shop__name">' + esc(pickup.name || 'Restaurant') + '</div>' +
          '<div class="r-order-card__sub">' + esc(order.order_no) + ' · ' + esc(dropoff.contact_name || 'Customer') + '</div>' +
        '</div>' +
        '<span class="r-chip ' + (STATUS_CHIPS[order.status] || '') + '">' + esc(label) + '</span>' +
      '</div>' +
      '<div class="r-route">' +
        '<div class="r-route__rail" aria-hidden="true">' +
          '<span class="r-route__dot r-route__dot--drop"></span>' +
        '</div>' +
        '<div class="r-route__body">' +
          '<div>' +
            '<div class="r-route__label">Deliver to</div>' +
            '<div class="r-route__val">' + esc(dropoff.address_text || 'Address not available') + '</div>' +
            '<div class="r-route__sub">' + esc(dropoff.contact_name || 'Customer') +
              (dropoff.contact_phone ? ' · ' + esc(dropoff.contact_phone) : '') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="r-kpis">' +
        '<div class="r-kpi"><div class="r-kpi__label">Trip</div>' +
          '<div class="r-big">' + trip + '<span class="r-kpi__unit"> km</span></div></div>' +
        '<div class="r-kpi"><div class="r-kpi__label">Items</div>' +
          '<div class="r-big">' + items + '</div></div>' +
        '<div class="r-kpi"><div class="r-kpi__label">ETA</div>' +
          '<div class="r-big">' + eta + '</div></div>' +
      '</div>' +
      '<div class="r-actions">' +
        '<button class="r-btn r-btn--ghost" type="button" data-pickup="' + order.id + '"' +
          (canPickup ? '' : ' disabled title="Already picked up"') + '>' +
          '<span class="r-spinner" hidden aria-hidden="true"></span>' +
          '<span class="r-btn__label">Mark picked up</span>' +
        '</button>' +
        '<button class="r-btn r-btn--success" type="button" data-deliver="' + order.id + '"' +
          (canDeliver ? '' : ' disabled title="Not picked up yet"') + '>' +
          '<span class="r-spinner" hidden aria-hidden="true"></span>' +
          '<span class="r-btn__label">Confirm delivered</span>' +
        '</button>' +
      '</div>' +
      '<a class="r-link" href="' + ROOT + '/orders/' + order.id + '">' +
        'Order details' + ICON.arrow +
      '</a>' +
    '</article>';
  }

  function setOnline(want) {
    var button = $('[data-online-toggle]');
    if (button) button.disabled = true;
    api('/api/rider/status', {
      method: 'POST',
      body: JSON.stringify({ is_online: !!want })
    }).then(function (result) {
      toast(result.message || (want ? 'You are online' : 'You are offline'), want ? 'success' : 'default');
      return loadWorkbench({ silent: true, force: true });
    }).catch(function (error) {
      if (button) button.disabled = false;
      if (error.status === 401) return;
      toast(error.message, 'error');
      if (!wb.data) loadWorkbench({});
    });
  }

  function claimOrder(id, button) {
    setBtnBusy(button, true, 'Grabbing…');
    wb.notice = null;
    renderNotice();
    api('/api/rider/orders/' + id + '/claim', { method: 'POST' }).then(function (result) {
      rememberClaimed(id);
      flash(result.message || 'Order claimed — head to the restaurant', 'success');
      window.location.href = ROOT + '/orders/' + id;
    }).catch(function (error) {
      setBtnBusy(button, false);
      if (error.status === 401) return;
      showPoolNotice(error.message);
      if (error.status !== 409) toast(error.message, 'error', 6000);
      loadWorkbench({ silent: true, force: true });
    });
  }

  function pickupFromCard(id, button) {
    setBtnBusy(button, true, 'Marking…');
    api('/api/rider/orders/' + id + '/pickup', { method: 'POST' }).then(function (result) {
      forgetClaimed(id);
      toast(result.message || 'Picked up', 'success');
      return loadWorkbench({ silent: true, force: true });
    }).catch(function (error) {
      setBtnBusy(button, false);
      if (error.status === 401) return;
      toast(error.message, 'error');
      loadWorkbench({ silent: true, force: true });
    });
  }

  function deliverFromCard(id, button) {
    setBtnBusy(button, true, 'Confirming…');
    api('/api/rider/orders/' + id + '/deliver', { method: 'POST' }).then(function (result) {
      forgetClaimed(id);
      toast(result.message || 'Delivered', 'success');
      return loadWorkbench({ silent: true, force: true });
    }).catch(function (error) {
      setBtnBusy(button, false);
      if (error.status === 401) return;
      toast(error.message, 'error');
      loadWorkbench({ silent: true, force: true });
    });
  }

  /* ------------------------------------------------------------------------
     ORDER DETAIL
     ---------------------------------------------------------------------- */
  var orderState = {
    order: null,
    error: null,
    banner: null,
    lastSync: 0,
    loading: false
  };

  function initOrder() {
    var id = body.getAttribute('data-order-id');
    if (!id) { renderOrderError('This order link is missing an order number.'); return; }

    document.addEventListener('click', function (event) {
      var target = event.target.closest('button, a');
      if (!target) return;

      if (target.hasAttribute('data-refresh-order')) {
        event.preventDefault();
        loadOrder({});
        return;
      }
      if (target.hasAttribute('data-retry-order')) {
        event.preventDefault();
        loadOrder({ initial: true });
        return;
      }

      var action = target.getAttribute('data-action');
      if (!action) return;
      event.preventDefault();

      if (action === 'share') { reportLocation(true); return; }
      if (action === 'claim' || action === 'pickup' || action === 'deliver') {
        orderAction(action, target);
      }
    });

    window.setInterval(function () {
      if (!orderState.lastSync) return;
      var node = $('[data-order-sync]');
      if (node) node.textContent = 'Updated ' + agoShort(orderState.lastSync);
    }, 10000);

    window.setInterval(updateLocationPanel, 1000);
    window.addEventListener('pagehide', function () { stopLocation(); });

    loadOrder({ initial: true });
  }

  function loadOrder(options) {
    var opts = options || {};
    var id = body.getAttribute('data-order-id');
    if (orderState.loading) return;
    orderState.loading = true;
    if (opts.user) {
      var sync = $('[data-order-sync]');
      if (sync) sync.textContent = 'Refreshing…';
    }
    if (opts.initial) orderState.error = null;

    api('/api/rider/orders/' + id).then(function (order) {
      orderState.order = order;
      orderState.error = null;
      if (order.status === 'ready' && (order.actions || []).indexOf('pickup') !== -1) {
        rememberClaimed(order.id);
      } else if (order.status !== 'ready') {
        forgetClaimed(order.id);
      }
      orderState.lastSync = Date.now();
      renderOrder();
      if (order.status === 'delivering') startLocation(order);
      else stopLocation();
    }).catch(function (error) {
      if (error.status === 401) return;
      orderState.error = error.message;
      if (orderState.order) {
        toast(error.message, 'error');
        renderOrder();
      } else {
        renderOrderError(error.message);
      }
    }).then(function () {
      orderState.loading = false;
    });
  }

  function renderOrderError(message) {
    var host = $('#order-body');
    if (!host) return;
    host.setAttribute('aria-busy', 'false');
    host.innerHTML = emptyState({
      icon: 'alert',
      title: 'We could not load this order',
      desc: message,
      actions: '<button class="r-btn" type="button" data-retry-order><span class="r-btn__label">Try again</span></button>' +
        '<a class="r-btn r-btn--ghost" href="' + ROOT + '/">Back to workbench</a>'
    });
  }

  function navLink(lng, lat, name, label) {
    if (lng == null || lat == null) return '';
    var url = 'https://uri.amap.com/marker?position=' + lng + ',' + lat +
      '&name=' + encodeURIComponent(name || 'Delivery address');
    return '<a class="r-navlink" href="' + esc(url) + '" target="_blank" rel="noopener">' +
      ICON.nav + esc(label || 'Navigate') + '</a>';
  }

  function callLink(phone, label) {
    if (!phone) return '';
    return '<a class="r-navlink" href="tel:' + esc(telHref(phone)) + '">' +
      ICON.phone + esc(label || 'Call') + '</a>';
  }

  function orderProgressStat(order) {
    if (order.status === 'delivered' && order.delivered_at) {
      return { value: fmtTime(order.delivered_at), label: 'Delivered' };
    }
    if (order.status === 'delivering' && order.picked_up_at) {
      return { value: fmtTime(order.picked_up_at), label: 'Picked up' };
    }
    if (order.waiting_minutes != null && ['ready', 'preparing', 'accepted', 'pending'].indexOf(order.status) !== -1) {
      return { value: (Number(order.waiting_minutes) || 0) + ' min', label: 'Waiting' };
    }
    return { value: fmtTime(order.created_at), label: 'Placed' };
  }

  function renderOrder() {
    var order = orderState.order;
    if (!order) return;
    var host = $('#order-body');
    if (!host) return;

    var actions = order.actions || [];
    var isPool = actions.indexOf('claim') !== -1;
    var pickup = order.pickup || {};
    var dropoff = order.dropoff || {};
    var items = Number(order.item_count) || 0;
    var trip = km(order.trip_km != null ? order.trip_km : order.distance_km);
    var eta = order.estimated_delivery_at ? fmtTime(order.estimated_delivery_at) : '—';
    var statusLabel = STATUS_LABELS[order.status] || order.status;
    var progress = orderProgressStat(order);
    var buttons = [];

    if (isPool) {
      buttons.push('<button class="r-btn" type="button" data-action="claim">' +
        '<span class="r-spinner" hidden aria-hidden="true"></span><span class="r-btn__label">Grab order</span></button>');
    }
    if (actions.indexOf('pickup') !== -1) {
      buttons.push('<button class="r-btn" type="button" data-action="pickup">' +
        '<span class="r-spinner" hidden aria-hidden="true"></span><span class="r-btn__label">Mark picked up</span></button>');
    }
    if (actions.indexOf('deliver') !== -1) {
      buttons.push('<button class="r-btn r-btn--success" type="button" data-action="deliver">' +
        '<span class="r-spinner" hidden aria-hidden="true"></span><span class="r-btn__label">Confirm delivered</span></button>');
    }
    if (!buttons.length) {
      buttons.push('<a class="r-btn" href="' + ROOT + '/">Back to workbench</a>');
      if (order.status === 'delivered') {
        buttons.push('<a class="r-btn r-btn--ghost" href="' + ROOT + '/history">View delivery history</a>');
      }
    }

    var pickupCard = '<section class="r-card" style="margin-bottom:12px">' +
      '<div class="r-card__title">' + ICON.pin + '<span>Pick up</span></div>' +
      '<div class="r-route">' +
        '<div class="r-route__rail" aria-hidden="true"><span class="r-route__dot"></span></div>' +
        '<div class="r-route__body"><div>' +
          '<div class="r-route__label">Restaurant</div>' +
          '<div class="r-route__val">' + esc(pickup.name || 'Restaurant') + '</div>' +
          '<div class="r-route__sub">' + esc(pickup.address_text || 'Address not available') + '</div>' +
        '</div></div>' +
      '</div>' +
      '<div class="r-contact">' +
        '<div class="r-contact__who">' + ICON.phone + '<span>' + esc(pickup.phone || 'No phone number') + '</span></div>' +
        '<div class="r-contact__actions">' +
          callLink(pickup.phone, 'Call') +
          navLink(pickup.lng, pickup.lat, pickup.name, 'Navigate') +
        '</div>' +
      '</div>' +
    '</section>';

    var dropoffCard = '<section class="r-card" style="margin-bottom:12px">' +
      '<div class="r-card__title">' + ICON.home + '<span>Drop off</span></div>' +
      '<div class="r-route">' +
        '<div class="r-route__rail" aria-hidden="true"><span class="r-route__dot r-route__dot--drop"></span></div>' +
        '<div class="r-route__body"><div>' +
          '<div class="r-route__label">Customer</div>' +
          '<div class="r-route__val">' + esc(dropoff.contact_name || 'Customer') + '</div>' +
          '<div class="r-route__sub">' + esc(dropoff.address_text || 'Address not available') + '</div>' +
        '</div></div>' +
      '</div>' +
      '<div class="r-contact">' +
        '<div class="r-contact__who">' + ICON.phone + '<span>' + esc(dropoff.contact_phone || 'No phone number') + '</span></div>' +
        '<div class="r-contact__actions">' +
          callLink(dropoff.contact_phone, 'Call') +
          navLink(dropoff.lng, dropoff.lat, dropoff.contact_name, 'Navigate') +
        '</div>' +
      '</div>' +
    '</section>';

    var itemsRows = (order.items || []).map(function (item) {
      return '<div class="r-item">' +
        '<span class="r-item__qty">×' + (item.quantity || 1) + '</span>' +
        '<span class="r-item__name">' + esc(item.name) + '</span>' +
        '<span class="r-item__price">¥' + money(item.subtotal) + '</span>' +
      '</div>';
    }).join('');

    var itemsCard = '<section class="r-card" style="margin-bottom:12px">' +
      '<div class="r-card__title">' + ICON.bag + '<span>Order items</span></div>' +
      '<div class="r-items">' + (itemsRows || '<div class="r-meta">No items on this order.</div>') + '</div>' +
      '<div class="r-totals">' +
        '<div class="r-totalrow"><span>Items</span><span>¥' + money(order.items_amount) + '</span></div>' +
        '<div class="r-totalrow"><span>Delivery fee</span><span>¥' + money(order.delivery_fee) + '</span></div>' +
        '<div class="r-totalrow r-totalrow--grand"><span>Total</span><span>¥' + money(order.total_amount) + '</span></div>' +
      '</div>' +
      (order.remark ? '<div class="r-note"><strong>Note from the customer</strong><br>' + esc(order.remark) + '</div>' : '') +
    '</section>';

    var timelineCard = '';
    if (order.timeline && order.timeline.length) {
      timelineCard = '<section class="r-card" style="margin-bottom:12px">' +
        '<div class="r-card__title">' + ICON.clock + '<span>Timeline</span></div>' +
        '<ol class="r-timeline">' +
          order.timeline.map(function (step) {
            return '<li class="r-timeline__item is-' + esc(step.state) + '">' +
              '<span class="r-timeline__dot"></span>' +
              '<span class="r-timeline__label">' + esc(step.label) + (step.state === 'current' ? ' · now' : '') + '</span>' +
              '<span class="r-timeline__at">' + (step.at ? fmtTime(step.at) : '') + '</span>' +
            '</li>';
          }).join('') +
        '</ol>' +
      '</section>';
    }

    var deliveredBanner = order.status === 'delivered'
      ? '<div class="r-banner r-banner--success" role="status" style="margin-top:12px">' + ICON.check +
        '<span>Delivered — the customer has been notified.</span></div>'
      : '';

    var delayBanner = order.is_delayed
      ? '<div class="r-banner r-banner--error" role="status" style="margin-top:12px">' + ICON.alert +
        '<span>This order is flagged delayed' + (order.delay_reason ? ': ' + esc(order.delay_reason) : '') + '.</span></div>'
      : '';

    var errorBannerHtml = orderState.error
      ? '<div style="margin-bottom:12px">' + errorBanner(orderState.error) + '</div>'
      : '';
    var actionBannerHtml = orderState.banner
      ? '<div style="margin-bottom:12px">' + errorBanner(orderState.banner) + '</div>'
      : '';
    var addressBannerHtml = order.address_updated_at &&
      order.status !== 'delivered' && order.status !== 'cancelled'
      ? '<div style="margin-bottom:12px">' +
          '<div class="r-banner r-banner--info" role="status">' + ICON.alert +
            '<span><strong>The customer changed the delivery address</strong> — check the drop-off point. ' +
            'New address: ' + esc(dropoff.address_text || 'not provided') + '</span>' +
          '</div>' +
        '</div>'
      : '';

    host.innerHTML = errorBannerHtml + actionBannerHtml + addressBannerHtml +
      '<section class="r-card" style="margin-bottom:12px">' +
        '<div class="r-detailhead">' +
          '<div>' +
            '<div class="r-detailhead__no">' + esc(order.order_no || 'Order #' + order.id) + '</div>' +
            '<div class="r-detailhead__title">' + esc(pickup.name || 'Restaurant') + '</div>' +
          '</div>' +
          '<span class="r-chip ' + (STATUS_CHIPS[order.status] || '') + '">' + esc(statusLabel) + '</span>' +
        '</div>' +
        '<div class="r-meta" style="margin-top:8px">' + esc(statusLabel) + ' · ' +
          items + ' ' + plural(items, 'item') + ' · ¥' + money(order.total_amount) + '</div>' +
        '<div class="r-stats" style="margin-top:16px">' +
          '<div class="r-stat"><div class="r-big">' + trip + '<span class="r-stat__unit"> km</span></div>' +
            '<div class="r-stat__label">Trip distance</div></div>' +
          '<div class="r-stat"><div class="r-big">' + eta + '</div>' +
            '<div class="r-stat__label">Estimated delivery</div></div>' +
          '<div class="r-stat"><div class="r-big">' + esc(progress.value) + '</div>' +
            '<div class="r-stat__label">' + esc(progress.label) + '</div></div>' +
        '</div>' +
        delayBanner +
        deliveredBanner +
        '<div class="r-actions" style="margin-top:16px">' + buttons.join('') + '</div>' +
      '</section>' +
      pickupCard +
      dropoffCard +
      (order.status === 'delivering' ? locationCard() : '') +
      timelineCard +
      itemsCard +
      '<div class="r-sync"><span data-order-sync>Updated just now</span>' +
        '<button type="button" data-refresh-order>Refresh</button></div>';

    host.setAttribute('aria-busy', 'false');
    updateLocationPanel();
  }

  function orderAction(kind, button) {
    var order = orderState.order;
    if (!order) return;
    var labels = { claim: 'Grabbing…', pickup: 'Marking…', deliver: 'Confirming…' };
    orderState.banner = null;
    setBtnBusy(button, true, labels[kind] || 'Working…');
    api('/api/rider/orders/' + order.id + '/' + kind, { method: 'POST' }).then(function (result) {
      if (kind === 'claim') rememberClaimed(order.id);
      if (kind === 'pickup' || kind === 'deliver') forgetClaimed(order.id);
      toast(result.message || 'Done', 'success');
      return loadOrder({ user: true });
    }).catch(function (error) {
      setBtnBusy(button, false);
      if (error.status === 401) return;
      orderState.banner = error.message;
      toast(error.message, 'error', 6000);
      loadOrder({ user: true });
    });
  }

  /* ------------------------------------------------------------------------
     HISTORY
     ---------------------------------------------------------------------- */
  var historyState = { days: 30, data: null, loading: false, lastSync: 0 };

  function initHistory() {
    bindTabs($('.r-tabs'), 'data-days', function (days) {
      loadHistory(Number(days) || 30);
    });

    document.addEventListener('click', function (event) {
      var target = event.target.closest('button, a');
      if (!target) return;
      if (target.hasAttribute('data-retry-history')) {
        event.preventDefault();
        loadHistory(historyState.days);
      }
      if (target.hasAttribute('data-refresh-history') || target.hasAttribute('data-refresh')) {
        event.preventDefault();
        loadHistory(historyState.days);
      }
    });

    window.setInterval(function () {
      if (!historyState.lastSync) return;
      var node = $('[data-sync]');
      if (node) node.textContent = 'Updated ' + agoShort(historyState.lastSync);
    }, 10000);

    loadHistory(historyState.days);
  }

  function historySkeleton() {
    return '<div class="r-card r-skelcard" aria-hidden="true">' +
      '<div class="r-skelrow"><div style="flex:1"><div class="r-skel r-skel--title"></div>' +
      '<div class="r-skel r-skel--line" style="margin-top:8px"></div></div>' +
      '<div class="r-skel r-skel--line" style="width:48px"></div></div></div>' +
      '<div class="r-card r-skelcard" aria-hidden="true">' +
      '<div class="r-skelrow"><div style="flex:1"><div class="r-skel r-skel--title"></div>' +
      '<div class="r-skel r-skel--line" style="margin-top:8px"></div></div>' +
      '<div class="r-skel r-skel--line" style="width:48px"></div></div></div>';
  }

  function loadHistory(days) {
    if (historyState.loading) return;
    historyState.loading = true;
    historyState.days = days || 30;
    var list = $('#history-list');
    var summary = $('#history-summary');
    if (list) { list.innerHTML = historySkeleton(); list.setAttribute('aria-busy', 'true'); }
    if (summary) {
      summary.setAttribute('aria-busy', 'true');
      summary.innerHTML = '<div class="r-stats">' +
        '<div class="r-stat"><div class="r-skel r-skel--big"></div></div>' +
        '<div class="r-stat"><div class="r-skel r-skel--big"></div></div>' +
        '<div class="r-stat"><div class="r-skel r-skel--big"></div></div>' +
      '</div>';
    }
    setSyncText('Loading your deliveries…');

    api('/api/rider/history?days=' + historyState.days).then(function (data) {
      historyState.data = data;
      historyState.lastSync = Date.now();
      renderHistory();
      setSyncText('Updated just now');
    }).catch(function (error) {
      if (error.status === 401) return;
      renderHistoryError(error.message);
    }).then(function () {
      historyState.loading = false;
      $$('[data-refresh], [data-refresh-history]').forEach(function (button) {
        if (button.classList.contains('is-loading')) setBtnBusy(button, false);
      });
    });
  }

  function renderHistory() {
    var data = historyState.data;
    if (!data) return;
    var summary = data.summary || {};
    var orders = data.orders || [];
    var summaryEl = $('#history-summary');
    if (summaryEl) {
      summaryEl.setAttribute('aria-busy', 'false');
      summaryEl.innerHTML = '<div class="r-stats">' +
        '<div class="r-stat"><div class="r-big">' + (summary.deliveries || 0) + '</div>' +
          '<div class="r-stat__label">Deliveries</div></div>' +
        '<div class="r-stat"><div class="r-big">' + km(summary.distance_km) +
          '<span class="r-stat__unit"> km</span></div><div class="r-stat__label">Distance</div></div>' +
        '<div class="r-stat"><div class="r-big">' + (summary.days || historyState.days) +
          '<span class="r-stat__unit"> days</span></div><div class="r-stat__label">Range</div></div>' +
      '</div>';
    }

    var list = $('#history-list');
    if (!list) return;
    list.setAttribute('aria-busy', 'false');

    if (!orders.length) {
      list.innerHTML = emptyState({
        icon: 'check',
        title: 'No deliveries in this range',
        desc: 'Completed deliveries show up here as soon as you confirm them.',
        actions: '<a class="r-btn" href="' + ROOT + '/">Go to workbench</a>' +
          '<button class="r-btn r-btn--ghost" type="button" data-retry-history><span class="r-btn__label">Check again</span></button>'
      });
      return;
    }

    var groups = [];
    var index = {};
    orders.forEach(function (order) {
      var date = order.delivered_at ? String(order.delivered_at).slice(0, 10) : 'unknown';
      if (!index[date]) {
        index[date] = { date: date, orders: [] };
        groups.push(index[date]);
      }
      index[date].orders.push(order);
    });

    list.innerHTML = groups.map(function (group) {
      var headerDate = group.date === 'unknown' ? 'Earlier' : fmtDate(group.date);
      return '<div class="r-daygroup">' +
        '<div class="r-daygroup__head"><span>' + esc(headerDate) + '</span>' +
          '<span>' + group.orders.length + ' ' + plural(group.orders.length, 'delivery', 'deliveries') + '</span></div>' +
        group.orders.map(function (order) {
          var dropoff = order.delivery || order.dropoff || {};
          return '<a class="r-card r-histrow" href="' + ROOT + '/orders/' + order.id + '">' +
            '<div class="r-histrow__main">' +
              '<div class="r-histrow__no">' + ICON.check + '<span>' + esc(order.order_no) + '</span></div>' +
              '<div class="r-histrow__addr">' + esc(dropoff.address_text || 'Delivery address') + '</div>' +
            '</div>' +
            '<div class="r-histrow__side">' +
              '<div class="r-histrow__km">' + km(order.distance_km) + ' km</div>' +
              '<div class="r-histrow__time">' + fmtTime(order.delivered_at) + '</div>' +
            '</div>' +
          '</a>';
        }).join('') +
      '</div>';
    }).join('');
  }

  function renderHistoryError(message) {
    var summary = $('#history-summary');
    if (summary) {
      summary.setAttribute('aria-busy', 'false');
      summary.innerHTML = '<div class="r-empty" style="padding:8px 0">' +
        '<div class="r-empty__desc">Your delivery summary is unavailable right now.</div></div>';
    }
    var list = $('#history-list');
    if (list) {
      list.setAttribute('aria-busy', 'false');
      list.innerHTML = emptyState({
        icon: 'alert',
        title: 'We could not load your history',
        desc: message,
        actions: '<button class="r-btn" type="button" data-retry-history><span class="r-btn__label">Try again</span></button>'
      });
    }
    setSyncText('Not connected');
  }

  /* ------------------------------------------------------------------------
     SETTINGS
     ---------------------------------------------------------------------- */
  var settingsState = { data: null, loading: false, online: false };

  function initSettings() {
    document.addEventListener('click', function (event) {
      var target = event.target.closest('button, a');
      if (!target) return;

      if (target.hasAttribute('data-retry-settings')) {
        event.preventDefault();
        loadSettings();
        return;
      }
      if (target.hasAttribute('data-settings-online')) {
        event.preventDefault();
        toggleOnline(target);
        return;
      }
      if (target.hasAttribute('data-signout')) {
        event.preventDefault();
        signOut(target);
      }
    });

    loadSettings();
  }

  function loadSettings() {
    if (settingsState.loading) return;
    settingsState.loading = true;
    api('/api/rider/profile').then(function (data) {
      settingsState.data = data;
      settingsState.online = !!(data.profile && data.profile.is_online);
      renderSettings();
    }).catch(function (error) {
      if (error.status === 401) return;
      renderSettingsError(error.message);
    }).then(function () {
      settingsState.loading = false;
    });
  }

  function renderSettingsError(message) {
    var host = $('#settings-body');
    if (!host) return;
    host.setAttribute('aria-busy', 'false');
    host.innerHTML = emptyState({
      icon: 'alert',
      title: 'We could not load your settings',
      desc: message,
      actions: '<button class="r-btn" type="button" data-retry-settings><span class="r-btn__label">Try again</span></button>'
    });
  }

  function switchMarkup(online, attr) {
    return '<button class="r-switch" type="button" role="switch" aria-checked="' + (online ? 'true' : 'false') +
      '" aria-label="Online status" ' + attr + '>' +
      '<span class="r-switch__track"><span class="r-switch__thumb"></span></span>' +
      '<span class="r-switch__text">' + (online ? 'On' : 'Off') + '</span>' +
    '</button>';
  }

  function renderSettings() {
    var data = settingsState.data;
    if (!data) return;
    var user = data.user || {};
    var profile = data.profile || {};
    var stats = data.stats || {};
    var online = !!profile.is_online;
    var radius = profile.service_radius_km != null ? profile.service_radius_km : 5;
    var rating = stats.rating && stats.rating.rating != null ? Number(stats.rating.rating).toFixed(1) : '—';

    var host = $('#settings-body');
    host.innerHTML =
      '<section class="r-card" style="margin-bottom:12px">' +
        '<div class="r-setting">' +
          '<div>' +
            '<div class="r-setting__label">Online status</div>' +
            '<div class="r-setting__hint" data-online-hint>' +
              (online ? 'Online — you will see orders in the pool' : 'Offline — no new orders will be shown') +
            '</div>' +
          '</div>' +
          switchMarkup(online, 'data-settings-online') +
        '</div>' +
      '</section>' +

      '<section class="r-card" style="margin-bottom:12px">' +
        '<h2 class="r-h2" style="margin-bottom:14px">Delivery profile</h2>' +
        '<div class="r-banner r-banner--error" id="settings-error" role="alert" hidden>' + ICON.alert +
          '<span data-settings-error-text></span></div>' +
        '<div class="r-banner r-banner--success" id="settings-success" role="status" hidden>' + ICON.check +
          '<span>Settings saved.</span></div>' +
        '<form class="r-form" id="settings-form" novalidate style="margin-top:12px">' +
          '<div class="r-field" data-field="name">' +
            '<label class="r-field__label" for="name">Name</label>' +
            '<input class="r-input" id="name" name="name" type="text" autocomplete="name" ' +
              'value="' + esc(user.name || '') + '" placeholder="Your display name">' +
            '<p class="r-field__err" data-err></p>' +
          '</div>' +
          '<div class="r-field" data-field="phone">' +
            '<label class="r-field__label" for="phone">Phone</label>' +
            '<input class="r-input" id="phone" name="phone" type="tel" autocomplete="tel" ' +
              'value="' + esc(user.phone || '') + '" placeholder="138 0000 0000">' +
            '<p class="r-field__hint">Shared with restaurants and customers only during a delivery.</p>' +
            '<p class="r-field__err" data-err></p>' +
          '</div>' +
          '<div class="r-field" data-field="vehicle_type">' +
            '<label class="r-field__label" for="vehicle_type">Vehicle type</label>' +
            '<select class="r-select" id="vehicle_type" name="vehicle_type">' +
              ['bike', 'ebike', 'motorbike', 'car'].map(function (value) {
                return '<option value="' + value + '"' + (profile.vehicle_type === value ? ' selected' : '') + '>' +
                  VEHICLES[value] + '</option>';
              }).join('') +
            '</select>' +
            '<p class="r-field__err" data-err></p>' +
          '</div>' +
          '<div class="r-field" data-field="service_radius_km">' +
            '<label class="r-field__label" for="service_radius_km">Service radius</label>' +
            '<div class="r-suffix">' +
              '<input class="r-input" id="service_radius_km" name="service_radius_km" type="number" ' +
                'inputmode="decimal" min="1" max="30" step="0.5" value="' + esc(radius) + '">' +
              '<span class="r-suffix__unit">km</span>' +
            '</div>' +
            '<p class="r-field__hint">Between 1 and 30 km. Orders further away are not offered to you.</p>' +
            '<p class="r-field__err" data-err></p>' +
          '</div>' +
          '<button class="r-btn" type="submit" id="save-settings">' +
            '<span class="r-spinner" hidden aria-hidden="true"></span>' +
            '<span class="r-btn__label">Save changes</span>' +
          '</button>' +
        '</form>' +
      '</section>' +

      '<section class="r-card">' +
        '<div class="r-account">' +
          '<div class="r-avatar" aria-hidden="true">' + esc(initials(user.name, user.username)) + '</div>' +
          '<div>' +
            '<div class="r-account__name">' + esc(user.name || user.username || 'Rider') + '</div>' +
            '<div class="r-account__meta">' + esc(user.username || '') +
              (user.email ? ' · ' + esc(user.email) : '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="r-stats" style="margin-top:16px">' +
          '<div class="r-stat"><div class="r-big">' + (stats.total_deliveries || 0) + '</div>' +
            '<div class="r-stat__label">Total deliveries</div></div>' +
          '<div class="r-stat"><div class="r-big">' + km(stats.total_distance_km) +
            '<span class="r-stat__unit"> km</span></div><div class="r-stat__label">Total distance</div></div>' +
          '<div class="r-stat"><div class="r-big">' + rating + '</div>' +
            '<div class="r-stat__label">Rating</div></div>' +
        '</div>' +
        '<div class="r-actions" style="margin-top:16px">' +
          '<button class="r-btn r-btn--danger" type="button" data-signout>' +
            '<span class="r-spinner" hidden aria-hidden="true"></span>' +
            '<span class="r-btn__label">Sign out</span>' +
          '</button>' +
        '</div>' +
      '</section>';

    host.setAttribute('aria-busy', 'false');

    var form = $('#settings-form');
    if (form) form.addEventListener('submit', saveSettings);
  }

  function applyOnlineToSettings(online) {
    settingsState.online = online;
    if (settingsState.data && settingsState.data.profile) {
      settingsState.data.profile.is_online = online;
    }
    var button = $('[data-settings-online]');
    if (button) {
      button.setAttribute('aria-checked', online ? 'true' : 'false');
      var text = button.querySelector('.r-switch__text');
      if (text) text.textContent = online ? 'On' : 'Off';
    }
    var hint = $('[data-online-hint]');
    if (hint) {
      hint.textContent = online
        ? 'Online — you will see orders in the pool'
        : 'Offline — no new orders will be shown';
    }
  }

  function toggleOnline(button) {
    var next = button.getAttribute('aria-checked') !== 'true';
    button.disabled = true;
    api('/api/rider/status', {
      method: 'POST',
      body: JSON.stringify({ is_online: next })
    }).then(function (result) {
      applyOnlineToSettings(!!(result.profile && result.profile.is_online));
      toast(result.message || (next ? 'You are online' : 'You are offline'), next ? 'success' : 'default');
    }).catch(function (error) {
      if (error.status === 401) return;
      toast(error.message, 'error');
    }).then(function () {
      button.disabled = false;
    });
  }

  function showSettingsBanner(id, message) {
    var banner = document.getElementById(id);
    if (!banner) return;
    banner.hidden = !message;
    var text = banner.querySelector('[data-settings-error-text]');
    if (text) text.textContent = message || '';
  }

  function saveSettings(event) {
    event.preventDefault();
    if (!settingsState.data) return;
    var form = event.currentTarget;
    var button = $('#save-settings');
    clearFieldErrors(form);
    showSettingsBanner('settings-error', '');
    showSettingsBanner('settings-success', '');

    var name = (($('#name', form) || {}).value || '').trim();
    var phone = (($('#phone', form) || {}).value || '').trim();
    var vehicle = ($('#vehicle_type', form) || {}).value;
    var radius = Number(($('#service_radius_km', form) || {}).value);
    var invalid = 0;

    if (name.length < 2) { setFieldError('name', 'Enter at least 2 characters.'); invalid++; }
    if (phone && !/^[0-9+\-\s]+$/.test(phone)) {
      setFieldError('phone', 'Use digits, spaces, + and - only.');
      invalid++;
    }
    if (['bike', 'ebike', 'motorbike', 'car'].indexOf(vehicle) === -1) {
      setFieldError('vehicle_type', 'Choose a vehicle type.');
      invalid++;
    }
    if (!isFinite(radius) || radius < 1 || radius > 30) {
      setFieldError('service_radius_km', 'Use a radius between 1 and 30 km.');
      invalid++;
    }
    if (invalid) {
      var first = $('.r-field.is-invalid input, .r-field.is-invalid select', form);
      if (first) first.focus();
      return;
    }

    setBtnBusy(button, true, 'Saving…');
    api('/api/rider/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        name: name,
        phone: phone,
        vehicle_type: vehicle,
        service_radius_km: radius
      })
    }).then(function (data) {
      settingsState.data = {
        user: data.user,
        profile: data.profile,
        stats: settingsState.data.stats
      };
      applyOnlineToSettings(!!(data.profile && data.profile.is_online));
      var accountName = $('.r-account__name');
      if (accountName) accountName.textContent = data.user.name || data.user.username;
      var avatar = $('.r-avatar');
      if (avatar) avatar.textContent = initials(data.user.name, data.user.username);
      showSettingsBanner('settings-success', 'saved');
      toast(data.message || 'Settings saved', 'success');
    }).catch(function (error) {
      if (error.status === 401) return;
      showSettingsBanner('settings-error', error.message);
      var field = fieldForError(error.message);
      if (field && $('[data-field="' + field + '"]')) setFieldError(field, error.message);
      toast(error.message, 'error');
    }).then(function () {
      setBtnBusy(button, false);
    });
  }

  function signOut(button) {
    setBtnBusy(button, true, 'Signing out…');
    api('/api/auth/logout', { method: 'POST' }).then(function () {
      window.location.href = ROOT + '/login';
    }).catch(function (error) {
      setBtnBusy(button, false);
      if (error.status === 401) return;
      toast(error.message, 'error');
    });
  }

  /* ------------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */
  function boot() {
    consumeFlash();
    if (PAGE === 'login' || PAGE === 'register') initAuth();
    else if (PAGE === 'workbench') initWorkbench();
    else if (PAGE === 'order') initOrder();
    else if (PAGE === 'history') initHistory();
    else if (PAGE === 'settings') initSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
