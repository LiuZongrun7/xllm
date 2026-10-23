/* ============================================================
   xLLM · Customer front-end
   ------------------------------------------------------------
   Vanilla JS only. One file, page router keyed off
   `.c-app[data-page]`. Cart lives in localStorage under
   `xllm.cart.v1`; recent searches under `xllm.search.v1`.
   All UI strings are English.
   ============================================================ */
(function () {
  'use strict';

  var CART_KEY = 'xllm.cart.v1';
  var RECENT_KEY = 'xllm.search.v1';
  var CITY = { lng: 121.4737, lat: 31.2304 };
  var MAX_QTY = 99;

  /* Page context comes from the shell rendered by base.html. Deferred
     scripts run after parsing, so the element already exists here. */
  var APP_ROOT = document.querySelector('.c-app');
  var PAGE = APP_ROOT ? APP_ROOT.dataset.page : '';
  var RESTAURANT_ID = Number(APP_ROOT && APP_ROOT.dataset.restaurantId) || 0;
  var ORDER_ID = Number(APP_ROOT && APP_ROOT.dataset.orderId) || 0;

  var STATUS_LABEL = {
    pending: 'Placed',
    accepted: 'Accepted',
    preparing: 'Preparing',
    ready: 'Ready',
    delivering: 'On the way',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
  };
  var STATUS_CHIP = {
    pending: 'c-chip--neutral',
    accepted: 'c-chip--accent',
    preparing: 'c-chip--warning',
    ready: 'c-chip--warning',
    delivering: 'c-chip--accent',
    delivered: '',
    cancelled: 'c-chip--danger'
  };
  var STATUS_PROGRESS = {
    pending: 14,
    accepted: 34,
    preparing: 54,
    ready: 70,
    delivering: 85,
    delivered: 100,
    cancelled: 0
  };
  var RATING_WORDS = ['Tap a star to rate', 'Not good', 'Could be better', 'Okay', 'Good', 'Loved it'];

  var ICON = {
    star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9Z"/></svg>',
    starTiny: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9Z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M3 9l2-5h14l2 5M9 21v-6h6v6"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16 14.5h2"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6Z"/><path d="M14 3v5h5M9 13h7M9 17h5"/></svg>',
    bag: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14h28l-3 22H13Z"/><path d="M18 14a6 6 0 0 1 12 0"/></svg>',
    tray: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 26h32M12 26l4-12h16l4 12"/><path d="M8 26v8a2 2 0 0 0 2 2h28a2 2 0 0 0 2-2v-8M24 14v-4"/></svg>'
  };

  /* ---------------------------------------------------------
     Tiny utilities
     --------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* 有实拍图就上图，没有就退回 emoji。
     图来自 docs/art-spec.json，缺图不是错误 —— 新菜、被删掉的菜都还能正常显示。 */
  function photoOrEmoji(imageUrl, emoji) {
    var fallback = esc(emoji || '\uD83C\uDF7D\uFE0F');
    if (!imageUrl) return fallback;
    /* emoji 永远垫在下面：图 404 的时候 onerror 把 <img> 摘掉，emoji 就露出来了，
       不会出现浏览器那种碎图图标。 */
    return '<span class="c-em" aria-hidden="true">' + fallback + '</span>' +
      '<img class="c-photo" src="' + esc(imageUrl) + '" alt="" loading="lazy" ' +
      'decoding="async" onload="this.classList.add(\'is-loaded\')" ' +
      'onerror="this.remove()">';
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function money(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return '\u00A5' + n.toFixed(2);
  }

  function plural(n, word) {
    return n + ' ' + word + (Number(n) === 1 ? '' : 's');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function parseDate(iso) {
    if (!iso) return null;
    // SQLAlchemy returns a naive local datetime string; Safari needs an
    // explicit separator because "YYYY-MM-DD HH:MM" is not ISO-safe.
    var text = String(iso).replace(' ', 'T');
    var d = new Date(text);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtTime(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtDate(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fmtDateTime(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    return fmtDate(iso) + ' \u00B7 ' + fmtTime(iso);
  }

  function arrivalText(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    if (d.getTime() <= Date.now()) return 'Arriving soon';
    return 'Arriving by ' + fmtTime(iso);
  }

  function fmtMonth(iso) {
    var d = parseDate(iso);
    if (!d) return 'Earlier';
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function relativeTime(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    var seconds = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (seconds < 60) return 'just now';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + ' min ago';
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + ' h ago';
    return fmtDate(iso);
  }

  function initial(name) {
    var text = String(name || '').trim();
    return text ? text.charAt(0).toUpperCase() : '\u2026';
  }

  function firstName(name) {
    var text = String(name || '').trim();
    return text ? text.split(/[\s_.-]+/)[0] : 'there';
  }

  function statusLabel(status) { return STATUS_LABEL[status] || status || 'Order'; }

  function statusChip(status) {
    return 'c-chip ' + (STATUS_CHIP[status] || '');
  }

  function statusProgress(status) {
    return STATUS_PROGRESS[status] == null ? 0 : STATUS_PROGRESS[status];
  }

  function distanceKm(lat1, lng1, lat2, lng2) {
    var radius = 6371;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * radius * Math.asin(Math.sqrt(a));
  }

  function hashString(text) {    var str = String(text);
    var h = 2166136261;
    for (var i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  /* Stable warm gradients for restaurant / dish imagery (no image assets).
     Hues stay inside cream → peach → coral → warm red → amber so the
     imagery never fights the red brand (no blues or purples). */
  var WARM_HUES = [8, 18, 28, 38, 46, 354, 344];
  function warmHue(seed) {
    return WARM_HUES[hashString(seed) % WARM_HUES.length];
  }

  function tint(seed, lightnessA, lightnessB) {
    var h = warmHue(seed);
    var a = lightnessA == null ? 91 : lightnessA;
    var b = lightnessB == null ? 77 : lightnessB;
    return 'linear-gradient(135deg, hsl(' + h + ' 82% ' + a + '%), hsl(' +
      ((h + 7) % 360) + ' 76% ' + b + '%)' + ')';
  }

  function heroTint(seed) {
    var h = warmHue(seed);
    return 'linear-gradient(140deg, hsl(' + h + ' 76% 70%), hsl(' +
      ((h + 8) % 360) + ' 70% 44%))';
  }

  /* Restaurants get a hue from their id so neighbouring cards never repeat
     the same tint. Still strictly inside the warm palette. */
  var RESTAURANT_HUES = [46, 28, 8, 354, 18, 344, 38, 24];
  function restaurantHue(id) {
    var index = (Math.max(1, Number(id) || 1) - 1) % RESTAURANT_HUES.length;
    return RESTAURANT_HUES[index];
  }

  function restaurantTint(id) {
    var h = restaurantHue(id);
    return 'linear-gradient(135deg, hsl(' + h + ' 84% 91%), hsl(' +
      ((h + 7) % 360) + ' 78% 75%))';
  }

  function restaurantHeroTint(id) {
    var h = restaurantHue(id);
    return 'linear-gradient(140deg, hsl(' + h + ' 78% 71%), hsl(' +
      ((h + 8) % 360) + ' 72% 44%))';
  }

  /* ---------------------------------------------------------
     API helper
     --------------------------------------------------------- */
  async function api(path, options) {
    var opts = options || {};
    var init = {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    };
    var keys = ['method', 'cache', 'signal'];
    keys.forEach(function (k) { if (opts[k] != null) init[k] = opts[k]; });
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

    var res;
    try {
      res = await fetch(path, init);
    } catch (err) {
      throw new Error('Network error \u2014 check your connection and try again');
    }

    var json = null;
    try { json = await res.json(); } catch (err) { json = null; }

    if (res.status === 401 && opts.redirectOn401 !== false) {
      location.href = '/customer/login';
      throw new Error('Your session expired \u2014 please sign in again');
    }
    if (!res.ok || !json || json.ok === false) {
      throw new Error((json && json.error) || 'Something went wrong \u2014 please try again');
    }
    return json.data;
  }

  /* ---------------------------------------------------------
     Alerts, toast, busy buttons
     --------------------------------------------------------- */
  function clearAlert(el) {
    if (!el) return;
    el.hidden = true;
    el.innerHTML = '';
  }

  function showError(el, message, actions) {
    if (!el) return;
    var list = actions || [];
    var buttons = list.map(function (action, index) {
      if (action.href) {
        return '<a class="c-alert__action" href="' + esc(action.href) + '">' + esc(action.label) + '</a>';
      }
      return '<button class="c-alert__action" type="button" data-action-index="' + index + '">' +
        esc(action.label) + '</button>';
    }).join('');
    el.hidden = false;
    el.className = 'c-alert' + (list.length ? ' c-alert--with-actions' : '');
    el.innerHTML = '<div class="c-alert__body"><span class="c-alert__text">' + esc(message) + '</span>' +
      (buttons ? '<div class="c-alert__actions">' + buttons + '</div>' : '') + '</div>';
    $$('[data-action-index]', el).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = list[Number(btn.dataset.actionIndex)];
        if (action && typeof action.run === 'function') action.run();
      });
    });
  }

  var toastTimer = null;
  function toast(message, kind) {
    var el = $('#c-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('c-toast--error', kind === 'error');
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 3400);
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.classList.add('is-loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('is-loading');
      btn.disabled = false;
      if (btn.dataset.label) {
        btn.textContent = btn.dataset.label;
        delete btn.dataset.label;
      }
    }
  }

  function fieldError(input, el, message) {
    if (input) {
      input.classList.toggle('is-invalid', !!message);
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
    if (!el) return;
    if (message) {
      el.hidden = false;
      el.textContent = message;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function skeletonCards(count) {
    var out = '';
    for (var i = 0; i < (count || 2); i += 1) {
      out += '<div class="c-card c-restcard-skel">' +
        '<span class="c-skel" style="display:block;width:100%;aspect-ratio:16/10;border-radius:14px"></span>' +
        '<div class="c-restcard-skel__body">' +
        '<span class="c-skel" style="width:56%;height:16px"></span>' +
        '<span class="c-skel" style="width:38%;height:12px"></span>' +
        '</div></div>';
    }
    return out;
  }

  function emptyCard(title, desc, ctaLabel, ctaHref, icon) {
    return '<div class="c-card"><div class="c-empty">' +
      '<div class="c-empty__icon" aria-hidden="true">' + (icon || ICON.bag) + '</div>' +
      '<div class="c-empty__title">' + esc(title) + '</div>' +
      '<div class="c-empty__desc">' + esc(desc) + '</div>' +
      (ctaHref ? '<a class="c-btn c-btn--ghost c-btn--inline" href="' + esc(ctaHref) + '">' +
        esc(ctaLabel) + '</a>' : '') +
      '</div></div>';
  }

  /* ---------------------------------------------------------
     Modal + confirm
     --------------------------------------------------------- */
  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('c-modal-open');
    var focusable = modal.querySelector('input:not([type="hidden"]), textarea, button');
    if (focusable) setTimeout(function () { focusable.focus({ preventScroll: true }); }, 80);
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('c-modal-open');
  }

  document.addEventListener('click', function (ev) {
    var closer = ev.target.closest ? ev.target.closest('[data-close]') : null;
    if (closer) {
      var modal = closer.closest('.c-modal');
      if (modal) closeModal(modal);
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      $$('.c-modal:not([hidden])').forEach(closeModal);
    }
  });

  function confirmDialog(opts) {
    var settings = opts || {};
    var modal = $('#c-confirm');
    if (!modal) return Promise.resolve(window.confirm(settings.body || settings.title || 'Are you sure?'));
    $('#c-confirm-title').textContent = settings.title || 'Are you sure?';
    $('#c-confirm-body').textContent = settings.body || '';
    var ok = $('#c-confirm-ok');
    var cancel = $('#c-confirm-cancel');
    var backdrop = $('.c-modal__backdrop', modal);
    ok.textContent = settings.confirmText || 'Confirm';
    cancel.textContent = settings.cancelText || 'Cancel';
    openModal(modal);
    return new Promise(function (resolve) {
      function finish(value) {
        closeModal(modal);
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onBackdrop);
        resolve(value);
      }
      function onOk() { finish(true); }
      function onCancel() { finish(false); }
      function onBackdrop() { finish(false); }
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onBackdrop);
    });
  }

  /* ---------------------------------------------------------
     Cart (localStorage)
     --------------------------------------------------------- */
  function emptyCart() {
    return { restaurant_id: 0, restaurant_name: '', items: {} };
  }

  function readCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      if (!raw) return emptyCart();
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.items) return emptyCart();
      var items = {};
      Object.keys(parsed.items).forEach(function (key) {
        var row = parsed.items[key];
        if (!row) return;
        var qty = Number(row.qty);
        var id = Number(row.id);
        if (!id || !isFinite(qty) || qty <= 0) return;
        items[String(id)] = {
          id: id,
          name: String(row.name || 'Dish'),
          price: Number(row.price) || 0,
          qty: Math.min(Math.round(qty), MAX_QTY),
          emoji: row.emoji || '\uD83C\uDF7D\uFE0F',
          image_url: row.image_url || null
        };
      });
      if (!Object.keys(items).length) return emptyCart();
      return {
        restaurant_id: Number(parsed.restaurant_id) || 0,
        restaurant_name: String(parsed.restaurant_name || ''),
        items: items
      };
    } catch (err) {
      return emptyCart();
    }
  }

  function writeCart(cart) {
    try {
      if (!cart || !cart.items || !Object.keys(cart.items).length) {
        localStorage.removeItem(CART_KEY);
        return;
      }
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (err) {
      toast('Your browser blocked local storage, so the cart cannot be saved', 'error');
    }
  }

  function cartLines(cart) {
    return Object.keys(cart.items || {}).map(function (key) { return cart.items[key]; });
  }

  function cartCount(cart) {
    return cartLines(cart).reduce(function (sum, row) { return sum + row.qty; }, 0);
  }

  function cartSubtotal(cart) {
    return cartLines(cart).reduce(function (sum, row) { return sum + row.price * row.qty; }, 0);
  }

  function cartQty(restaurantId, itemId) {
    var cart = readCart();
    if (Number(cart.restaurant_id) !== Number(restaurantId)) return 0;
    var row = cart.items[String(itemId)];
    return row ? row.qty : 0;
  }

  function decrementItem(restaurantId, itemId) {
    var cart = readCart();
    if (Number(cart.restaurant_id) !== Number(restaurantId)) return;
    var row = cart.items[String(itemId)];
    if (!row) return;
    row.qty -= 1;
    if (row.qty <= 0) delete cart.items[String(itemId)];
    writeCart(cart);
  }

  /**
   * Add one unit. Returns:
   *   'ok'        added
   *   'replaced'  previous cart cleared first
   *   'max'       stock limit reached
   *   'cancelled' user kept the other restaurant's cart
   */
  async function addToCart(restaurant, item) {
    var cart = readCart();
    var hasItems = cartLines(cart).length > 0;
    if (hasItems && cart.restaurant_id && Number(restaurant.id) !== Number(cart.restaurant_id)) {
      var replace = await confirmDialog({
        title: 'Start a new cart?',
        body: 'Your cart has items from ' + cart.restaurant_name + '. Adding this dish will clear them.',
        confirmText: 'Start new cart',
        cancelText: 'Keep my cart'
      });
      if (!replace) return 'cancelled';
      cart = emptyCart();
      hasItems = false;
    }
    cart.restaurant_id = Number(restaurant.id) || 0;
    cart.restaurant_name = restaurant.name || cart.restaurant_name;

    var key = String(item.id);
    var existing = cart.items[key];
    var nextQty = existing ? existing.qty + 1 : 1;
    var stock = item.stock == null ? null : Number(item.stock);
    if (stock != null && nextQty > stock) return 'max';

    cart.items[key] = {
      id: Number(item.id),
      name: item.name || 'Dish',
      price: Number(item.price) || 0,
      qty: Math.min(nextQty, MAX_QTY),
      emoji: item.emoji || '\uD83C\uDF7D\uFE0F',
      image_url: item.image_url || null
    };
    writeCart(cart);
    return hasItems ? 'ok' : 'ok';
  }

  /* Recent searches */
  function readRecent() {
    try {
      var arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(arr) ? arr.map(String).filter(Boolean).slice(0, 5) : [];
    } catch (err) { return []; }
  }

  function saveRecent(query) {
    var q = String(query || '').trim();
    if (q.length < 2) return;
    var list = readRecent().filter(function (row) { return row.toLowerCase() !== q.toLowerCase(); });
    list.unshift(q);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5))); } catch (err) { /* ignore */ }
  }

  function clearRecent() {
    try { localStorage.removeItem(RECENT_KEY); } catch (err) { /* ignore */ }
  }

  /* ---------------------------------------------------------
     Shared renderers
     --------------------------------------------------------- */
  function restaurantStateChip(card) {
    var state = card.state || {};
    var cls = 'c-chip';
    if (!state.accepting) cls += state.reason === 'full' ? ' c-chip--warning' : ' c-chip--danger';
    return '<span class="' + cls + '" title="' + esc(state.detail || '') + '">' +
      esc(state.label || (state.accepting ? 'Open' : 'Closed')) + '</span>';
  }

  function restaurantCardHtml(card) {
    var distance = card.distance_km == null ? 'Nearby' : Number(card.distance_km).toFixed(1) + ' km';
    var rating = card.rating == null
      ? '<span class="c-restcard__fee">New</span>'
      : '<span><span class="c-restcard__star" aria-hidden="true">' + ICON.starTiny + '</span> ' +
        Number(card.rating).toFixed(1) + '</span>' + (card.review_count ?
        '<span class="c-restcard__fee">(' + card.review_count + ')</span>' : '');
    /* 卡片是"图满版 + 底部渐变压字"：
       店名压在照片下缘的渐变上，价格和菜系留在白色页脚 ——
       照片不再是贴在卡片左边的一个小方块，整张卡就是那张图。 */
    var media = card.cover_url
      ? '<img class="c-photo" src="' + esc(card.cover_url) + '" alt="" loading="lazy" ' +
        'decoding="async" onload="this.classList.add(\'is-loaded\')" onerror="this.remove()">'
      : '<span class="c-restcard__fallback" aria-hidden="true">' +
        esc(card.emoji || '\uD83C\uDF7D\uFE0F') + '</span>';
    return '<a class="c-restcard c-restcard--photo" href="/customer/restaurant/' + card.id + '">' +
      '<span class="c-restcard__media" style="background:' + restaurantTint(card.id) + '">' +
        media +
        '<span class="c-restcard__scrim" aria-hidden="true"></span>' +
        '<span class="c-restcard__badge">' + restaurantStateChip(card) + '</span>' +
        '<span class="c-restcard__caption">' +
          '<span class="c-restcard__name">' + esc(card.name) + '</span>' +
          '<span class="c-restcard__meta">' + rating +
            '<span class="c-dot">\u00B7</span><span>' + esc(distance) + '</span>' +
            '<span class="c-dot">\u00B7</span><span>' + (card.eta_minutes || 25) + ' min</span>' +
          '</span>' +
        '</span>' +
      '</span>' +
      '<span class="c-restcard__foot">' +
        '<span class="c-chip c-chip--neutral">' + esc(card.cuisine || 'Food') + '</span>' +
        '<span class="c-restcard__fee num">' + money(card.min_order_amount) + ' min \u00B7 ' +
          money(card.delivery_fee) + ' delivery</span>' +
      '</span></a>';
  }

  function starsHtml(rating) {
    var value = Math.round(Number(rating) || 0);
    var out = '<span class="c-stars c-stars--sm" aria-label="' + value + ' out of 5 stars">';
    for (var i = 1; i <= 5; i += 1) {
      out += '<span class="' + (i <= value ? 'is-on' : '') + '" aria-hidden="true">' + ICON.starTiny + '</span>';
    }
    return out + '</span>';
  }

  function summaryRow(label, value, modifier) {
    return '<div class="c-summary__row' + (modifier ? ' ' + modifier : '') + '">' +
      '<span>' + esc(label) + '</span><span class="num">' + esc(value) + '</span></div>';
  }

  function deliveryRow(icon, label, valueHtml) {
    return '<div class="c-deliveryrow">' +
      '<span class="c-deliveryrow__icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="c-deliveryrow__main"><span class="c-deliveryrow__label">' + esc(label) + '</span>' +
      '<span class="c-deliveryrow__value">' + valueHtml + '</span></span></div>';
  }

  function telLink(phone, label) {
    return '<a class="c-callbtn" href="tel:' + esc(String(phone || '').replace(/[^\d+]/g, '')) + '">' +
      ICON.phone + '<span>' + esc(label || 'Call') + '</span></a>';
  }

  /* Back buttons: behave like the native back gesture when possible */
  function initBackButtons() {
    ['rest-back', 'search-back', 'cart-back', 'order-back'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', function (ev) {
        try {
          if (document.referrer && new URL(document.referrer).origin === location.origin &&
              history.length > 1) {
            ev.preventDefault();
            history.back();
          }
        } catch (err) { /* follow the href */ }
      });
    });
  }

  /* ---------------------------------------------------------
     HOME
     --------------------------------------------------------- */
  function initHome() {
    var state = { cuisine: '', openOnly: false, cuisines: [] };
    var listEl = $('#home-restaurants');
    var cuisinesEl = $('#home-cuisines');
    var countEl = $('#home-count');
    var errorEl = $('#home-error');
    var openBtn = $('#home-open');

    function renderAddress(address) {
      var el = $('#home-address');
      if (!el) return;
      if (address) {
        var label = address.label ? address.label + ' \u00B7 ' : '';
        el.textContent = label + address.address_text;
        el.title = address.address_text;
      } else {
        el.textContent = 'Add a delivery address';
        el.title = 'Open the address book';
      }
    }

    function renderCuisines(cuisines) {
      var all = [{ value: '', label: 'All' }].concat((cuisines || []).map(function (name) {
        return { value: name, label: name };
      }));
      cuisinesEl.innerHTML = all.map(function (row) {
        var active = row.value === state.cuisine;
        return '<button class="c-filter' + (active ? ' is-active' : '') + '" type="button" ' +
          'data-cuisine="' + esc(row.value) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
          esc(row.label) + '</button>';
      }).join('');
    }

    function renderRestaurants(rows) {
      countEl.textContent = rows.length
        ? plural(rows.length, 'place') + ' \u00B7 sorted by distance'
        : '';
      if (!rows.length) {
        listEl.innerHTML = emptyCard(
          state.cuisine || state.openOnly ? 'No restaurants match those filters' : 'No restaurants nearby yet',
          state.cuisine || state.openOnly
            ? 'Try another cuisine or turn off “Open now”.'
            : 'Restaurants will appear here once they open near your address.',
          'Clear filters',
          '/customer/',
          ICON.tray
        );
        var clear = listEl.querySelector('a.c-btn');
        if (clear) {
          clear.addEventListener('click', function (ev) {
            ev.preventDefault();
            if (state.cuisine || state.openOnly) {
              state.cuisine = '';
              state.openOnly = false;
              openBtn.setAttribute('aria-pressed', 'false');
              loadRestaurants();
            } else {
              location.reload();
            }
          });
        }
        return;
      }
      listEl.innerHTML = rows.map(restaurantCardHtml).join('');
    }

    async function loadRestaurants() {
      clearAlert(errorEl);
      listEl.innerHTML = skeletonCards(3);
      try {
        var params = new URLSearchParams();
        if (state.cuisine) params.set('cuisine', state.cuisine);
        if (state.openOnly) params.set('open', '1');
        var data = await api('/api/customer/restaurants' + (params.toString() ? '?' + params.toString() : ''));
        state.cuisines = data.cuisines || [];
        renderAddress(data.address);
        renderCuisines(state.cuisines);
        renderRestaurants(data.restaurants || []);
      } catch (err) {
        listEl.innerHTML = '';
        countEl.textContent = '';
        showError(errorEl, err.message, [
          { label: 'Try again', run: loadRestaurants },
          { label: 'Account', href: '/customer/account' }
        ]);
      }
    }

    async function loadActiveOrder() {
      var banner = $('#home-banner');
      try {
        var data = await api('/api/customer/active-order');
        var order = data.order;
        if (!order) { banner.innerHTML = ''; return; }
        var eta = order.estimated_delivery_at
          ? (order.is_delayed ? 'Delayed \u00B7 ETA ' + fmtTime(order.estimated_delivery_at) : arrivalText(order.estimated_delivery_at))
          : 'Tracking soon';
        banner.innerHTML = '<a class="c-activebanner" href="/customer/orders/' + order.id + '">' +
          '<div class="c-activebanner__top"><span class="' + statusChip(order.status) + '">' +
            esc(statusLabel(order.status)) + '</span>' +
            '<span class="c-activebanner__eta num">' + esc(eta) + '</span></div>' +
          '<div class="c-activebanner__title">' + esc(order.restaurant && order.restaurant.name || 'Your order') + '</div>' +
          '<div class="c-activebanner__bottom"><span class="num">' + plural(order.item_count, 'item') +
            ' \u00B7 ' + money(order.total_amount) + '</span>' +
            '<span class="c-activebanner__link">Track order \u2192</span></div>' +
          '<div class="c-activebanner__track"><span style="width:' + statusProgress(order.status) + '%"></span></div>' +
          '</a>';
      } catch (err) {
        banner.innerHTML = '';
      }
    }

    async function loadGreeting() {
      try {
        var data = await api('/api/customer/profile');
        var user = data.user || {};
        var name = user.name || user.username || '';
        $('#home-avatar').textContent = initial(name);
        $('#home-greet').textContent = 'Welcome back, ' + firstName(name);
      } catch (err) {
        /* the page still works with the default greeting */
      }
    }

    cuisinesEl.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-cuisine]');
      if (!btn) return;
      state.cuisine = btn.dataset.cuisine;
      renderCuisines(state.cuisines);
      loadRestaurants();
    });

    openBtn.addEventListener('click', function () {
      state.openOnly = !state.openOnly;
      openBtn.setAttribute('aria-pressed', state.openOnly ? 'true' : 'false');
      openBtn.classList.toggle('is-active', state.openOnly);
      loadRestaurants();
    });

    loadGreeting();
    loadActiveOrder();
    loadRestaurants();
  }

  /* ---------------------------------------------------------
     SEARCH
     --------------------------------------------------------- */
  function initSearch() {
    var input = $('#search-input');
    var form = $('#search-form');
    var results = $('#search-results');
    var statusEl = $('#search-status');
    var idle = $('#search-idle');
    var errorEl = $('#search-error');
    var recentSection = $('#recent-section');
    var recentChips = $('#recent-chips');
    var clearBtn = $('#search-clear');
    var debounceTimer = null;
    var saveTimer = null;
    var seq = 0;
    var dishById = {};

    function renderRecent() {
      var recent = readRecent();
      recentSection.hidden = !recent.length;
      recentChips.innerHTML = recent.map(function (q) {
        return '<button class="c-filter" type="button" data-recent="' + esc(q) + '">' +
          esc(q) + '</button>';
      }).join('');
    }

    function resetIdle() {
      seq += 1;
      clearTimeout(debounceTimer);
      clearTimeout(saveTimer);
      results.innerHTML = '';
      statusEl.innerHTML = '';
      errorEl.hidden = true;
      idle.hidden = false;
      renderRecent();
    }

    function dishResultHtml(dish) {
      var soldOut = dish.sold_out || dish.stock === 0;
      return '<div class="c-dishresult" data-dish-id="' + dish.id + '">' +
        '<span class="c-thumb c-thumb--md" style="background:' + tint('dish-' + dish.id + dish.name) + '">' +
          photoOrEmoji(dish.image_url, dish.emoji) + '</span>' +
        '<span class="c-dishresult__main">' +
          '<span class="c-dishresult__name">' + esc(dish.name) + '</span>' +
          '<span class="c-dishresult__sub">' + esc(dish.restaurant_name || '') + ' \u00B7 ' +
            (dish.calories != null ? dish.calories + ' kcal' : 'Freshly made') + '</span>' +
          '<span class="c-dishresult__price num">' + money(dish.price) + '</span>' +
        '</span>' +
        (soldOut
          ? '<span class="c-dishrow__soldout">Sold out</span>'
          : '<button class="c-addbtn c-addbtn--static" type="button" data-search-add="' + dish.id +
            '" aria-label="Add ' + esc(dish.name) + '">' + ICON.plus + '</button>') +
        '</div>';
    }

    async function runSearch(query, explicit) {
      var q = String(query || '').trim();
      if (!q) { resetIdle(); return; }
      var ticket = ++seq;
      clearAlert(errorEl);
      idle.hidden = true;
      statusEl.innerHTML = '<span class="c-skel" style="width:140px;height:16px;margin:10px 0 14px"></span>';
      results.innerHTML = skeletonCards(2);
      try {
        var data = await api('/api/customer/search?q=' + encodeURIComponent(q));
        if (ticket !== seq) return;
        var restaurants = data.restaurants || [];
        var dishes = data.dishes || [];
        dishById = {};
        dishes.forEach(function (dish) { dishById[dish.id] = dish; });
        if (!restaurants.length && !dishes.length) {
          statusEl.innerHTML = '';
          results.innerHTML = emptyCard(
            'No results for “' + q + '”',
            'Try a different spelling, a cuisine like “noodles”, or browse everything nearby.',
            'Browse restaurants',
            '/customer/',
            ICON.tray
          );
          return;
        }
        statusEl.innerHTML = '';
        var html = '';
        if (dishes.length) {
          html += '<section class="c-card c-card__body" style="margin-bottom:16px">' +
            '<div class="c-section__head" style="padding-top:0"><h2 class="c-section__title">Dishes</h2>' +
            '<span class="c-meta">' + plural(dishes.length, 'result') + '</span></div>' +
            dishes.map(dishResultHtml).join('') + '</section>';
        }
        if (restaurants.length) {
          html += '<section><div class="c-section__head" style="padding-top:0">' +
            '<h2 class="c-section__title">Restaurants</h2>' +
            '<span class="c-meta">' + plural(restaurants.length, 'result') + '</span></div>' +
            '<div class="c-stack c-stack--sm">' + restaurants.map(restaurantCardHtml).join('') +
            '</div></section>';
        }
        results.innerHTML = html;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { saveRecent(q); renderRecent(); }, 900);
      } catch (err) {
        if (ticket !== seq) return;
        statusEl.innerHTML = '';
        results.innerHTML = '';
        showError(errorEl, err.message, [{ label: 'Try again', run: function () { runSearch(q, true); } }]);
      }
    }

    input.addEventListener('input', function () {
      clearBtn.hidden = !input.value;
      clearTimeout(debounceTimer);
      clearTimeout(saveTimer);
      var q = input.value.trim();
      if (!q) { resetIdle(); return; }
      debounceTimer = setTimeout(function () { runSearch(q, false); }, 300);
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        runSearch(input.value.trim(), true);
      }
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      clearTimeout(debounceTimer);
      runSearch(input.value.trim(), true);
    });

    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.hidden = true;
      resetIdle();
      input.focus();
    });

    recentChips.addEventListener('click', function (ev) {
      var chip = ev.target.closest('[data-recent]');
      if (!chip) return;
      input.value = chip.dataset.recent;
      clearBtn.hidden = false;
      runSearch(chip.dataset.recent, true);
    });

    $('#recent-clear').addEventListener('click', function () {
      clearRecent();
      renderRecent();
      toast('Recent searches cleared');
    });

    results.addEventListener('click', async function (ev) {
      var btn = ev.target.closest('[data-search-add]');
      if (!btn) return;
      var dish = dishById[Number(btn.dataset.searchAdd)] || null;
      if (!dish) return;
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        var outcome = await addToCart(
          { id: dish.restaurant_id, name: dish.restaurant_name },
          { id: dish.id, name: dish.name, price: dish.price, emoji: dish.emoji, image_url: dish.image_url, stock: dish.stock }
        );
        if (outcome === 'max') {
          toast('Only ' + dish.stock + ' of ' + dish.name + ' left today', 'error');
        } else if (outcome === 'cancelled') {
          toast('Kept your cart from ' + readCart().restaurant_name);
        } else {
          toast('Added ' + dish.name + ' to your cart');
        }
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    renderRecent();
    var initial = new URLSearchParams(location.search).get('q') || '';
    if (initial) {
      input.value = initial;
      clearBtn.hidden = false;
      runSearch(initial, true);
    }
  }

  /* ---------------------------------------------------------
     RESTAURANT
     --------------------------------------------------------- */
  function initRestaurant() {
    var hero = $('#rest-hero');
    var emojiEl = $('#rest-emoji');
    var loading = $('#rest-loading');
    var content = $('#rest-content');
    var errorEl = $('#rest-error');
    var menuEl = $('#rest-menu');
    var anchorsEl = $('#rest-anchors');
    var reviewsEl = $('#rest-reviews');
    var restaurant = null;
    var canOrder = false;
    var itemMap = {};

    if (hero) hero.style.background = restaurantHeroTint(RESTAURANT_ID);

    function dishRowHtml(item) {
      var soldOut = !!(item.sold_out || item.stock === 0);
      var blocked = soldOut || !canOrder;
      var disabledAttr = blocked ? ' disabled' : '';
      return '<div class="c-dishrow' + (soldOut ? ' is-soldout' : '') + '" data-item-id="' + item.id + '">' +
        '<div class="c-dishrow__main">' +
          '<h3 class="c-dishrow__name">' + esc(item.name) + '</h3>' +
          (item.description ? '<p class="c-dishrow__desc">' + esc(item.description) + '</p>' : '') +
          '<div class="c-dishrow__meta">' +
            '<span class="c-dishrow__price num">' + money(item.price) + '</span>' +
            (item.calories != null ? '<span class="c-dishrow__kcal num">' + item.calories + ' kcal</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="c-dishrow__side">' +
          '<div class="c-dishrow__thumbwrap">' +
            '<span class="c-thumb c-thumb--dish" style="background:' +
              tint('dish-' + item.id + item.name, 90, 76) + '">' +
              photoOrEmoji(item.image_url, item.emoji) + '</span>' +
            (soldOut ? '' : '<button class="c-addbtn" type="button" data-add="' + item.id + '" ' +
              'aria-label="Add ' + esc(item.name) + '"' + disabledAttr + '>' + ICON.plus + '</button>') +
          '</div>' +
          (soldOut
            ? '<span class="c-dishrow__soldout">Sold out</span>'
            : '<div class="c-qty" data-qty hidden>' +
                '<button class="c-qty__btn" type="button" data-minus="' + item.id + '" ' +
                  'aria-label="Remove one ' + esc(item.name) + '">' + ICON.minus + '</button>' +
                '<span class="c-qty__val num">0</span>' +
                '<button class="c-qty__btn" type="button" data-plus="' + item.id + '" ' +
                  'aria-label="Add one ' + esc(item.name) + '"' + disabledAttr + '>' + ICON.plus + '</button>' +
              '</div>') +
        '</div>' +
      '</div>';
    }

    function syncRows() {
      $$('.c-dishrow[data-item-id]', menuEl).forEach(function (row) {
        var id = Number(row.dataset.itemId);
        var qty = cartQty(restaurant.id, id);
        var addBtn = $('[data-add]', row);
        var qtyWrap = $('[data-qty]', row);
        var val = $('.c-qty__val', row);
        if (addBtn) addBtn.hidden = qty > 0;
        if (qtyWrap) qtyWrap.hidden = qty === 0;
        if (val) val.textContent = qty;
      });
    }

    function updateCartBar() {
      var cart = readCart();
      var bar = $('#rest-cartbar');
      if (!bar) return;
      if (Number(cart.restaurant_id) !== Number(restaurant.id) || !cartCount(cart)) {
        bar.hidden = true;
        return;
      }
      var count = cartCount(cart);
      bar.hidden = false;
      $('#rest-cart-count').textContent = plural(count, 'item');
      $('#rest-cart-total').textContent = money(cartSubtotal(cart));
    }

    function renderInfo(data) {
      $('#rest-name').textContent = data.name;
      var state = data.state || {};
      var stateEl = $('#rest-state');
      stateEl.hidden = false;
      stateEl.className = 'c-chip' + (state.accepting ? '' : (state.reason === 'full' ? ' c-chip--warning' : ' c-chip--danger'));
      stateEl.textContent = state.label || (state.accepting ? 'Open' : 'Closed');
      stateEl.title = state.detail || '';

      var meta = '';
      if (data.rating != null) {
        meta += '<span class="c-rating"><span class="c-rating__star" aria-hidden="true">' +
          ICON.starTiny + '</span><span>' + Number(data.rating).toFixed(1) + '</span></span>' +
          '<span class="c-dot">\u00B7</span><span>(' + (data.review_count || 0) + ' review' +
          (data.review_count === 1 ? '' : 's') + ')</span>';
      } else {
        meta += '<span>New on xLLM</span>';
      }
      meta += '<span class="c-dot">\u00B7</span><span>' + esc(data.cuisine || 'Food') + '</span>';
      if (data.distance_km != null) {
        meta += '<span class="c-dot">\u00B7</span><span>' +
          Number(data.distance_km).toFixed(1) + ' km away</span>';
      }
      $('#rest-meta').innerHTML = meta;

      var desc = $('#rest-desc');
      desc.textContent = data.description || '';

      var facts = [
        { label: 'Min order', value: money(data.min_order_amount) },
        { label: 'Delivery', value: money(data.delivery_fee) },
        { label: 'Arrives', value: (data.eta_minutes || 25) + ' min' }
      ];
      $('#rest-facts').innerHTML = facts.map(function (fact) {
        return '<div class="c-fact"><span class="c-fact__label">' + esc(fact.label) + '</span>' +
          '<span class="c-fact__value num">' + esc(fact.value) + '</span></div>';
      }).join('');

      var note = $('#rest-closed-note');
      if (!state.accepting) {
        note.hidden = false;
        note.textContent = (state.label || 'Closed') + ' \u2014 ' + (state.detail || 'not taking orders') +
          '. You can browse the menu, but ordering is paused.';
      } else {
        note.hidden = true;
      }

      var radius = Number(data.delivery_radius_km || 0);
      if (radius) {
        var info = $('#rest-radius-note');
        if (!info) {
          info = document.createElement('p');
          info.id = 'rest-radius-note';
          info.className = 'c-field__hint';
          info.style.marginTop = '10px';
          $('#rest-facts').parentNode.appendChild(info);
        }
        info.textContent = 'Delivers within ' + radius.toFixed(1) + ' km' +
          (data.address_distance_km != null ? ' \u00B7 you are ' + Number(data.address_distance_km).toFixed(1) + ' km away' : '');
      }
    }

    function renderMenu(data) {
      var groups = data.menu || [];
      if (!groups.length) {
        anchorsEl.innerHTML = '';
        menuEl.innerHTML = emptyCard('No dishes right now',
          'This menu is empty at the moment. Check back a little later.',
          'Browse other restaurants', '/customer/', ICON.tray);
        return;
      }
      anchorsEl.innerHTML = groups.map(function (group, index) {
        return '<a class="c-filter c-filter--sm" href="#cat-' + index + '" data-anchor="cat-' + index + '">' +
          esc(group.category || 'Menu') + '</a>';
      }).join('');

      menuEl.innerHTML = groups.map(function (group, index) {
        return '<section class="c-menusec" id="cat-' + index + '">' +
          '<h2 class="c-menusec__title">' + esc(group.category || 'Menu') + '</h2>' +
          (group.items || []).map(function (item) {
            itemMap[item.id] = item;
            return dishRowHtml(item);
          }).join('') + '</section>';
      }).join('');
      syncRows();
    }

    function renderReviews(data) {
      var reviews = data.reviews || [];
      if (!reviews.length) { reviewsEl.hidden = true; return; }
      reviewsEl.hidden = false;
      $('#rest-review-summary').innerHTML = (data.rating != null
        ? Number(data.rating).toFixed(1) + ' from ' + (data.review_count || reviews.length) + ' review' +
          ((data.review_count || reviews.length) === 1 ? '' : 's')
        : '');
      $('#rest-review-list').innerHTML = reviews.map(function (review) {
        return '<div class="c-review">' +
          '<div class="c-review__head"><span class="c-review__name">' + esc(review.reviewer_name) + '</span>' +
            '<span class="c-review__date">' + esc(fmtDate(review.created_at)) + '</span></div>' +
          '<div style="margin-top:4px">' + starsHtml(review.rating) + '</div>' +
          (review.content ? '<p class="c-review__text">' + esc(review.content) + '</p>' : '') +
          '</div>';
      }).join('');
    }

    async function load() {
      if (!RESTAURANT_ID) {
        loading.hidden = true;
        showError(errorEl, 'We could not tell which restaurant to show.',
          [{ label: 'Back to home', href: '/customer/' }]);
        return;
      }
      try {
        var data = await api('/api/customer/restaurants/' + RESTAURANT_ID);
        restaurant = data;
        canOrder = !!(data.state && data.state.accepting);
        if (data.cover_url) {
          hero.classList.add('c-hero--photo');
          /* ⚠️ size / position 要一起写成行内样式：骨架屏阶段走过的
             `hero.style.background = ...` 简写已经在行内留下了
             background-size:auto / position:0% 0%，它比样式表里的规则优先。 */
          hero.style.background = 'center 70% / cover no-repeat url("' + data.cover_url + '")';
          emojiEl.textContent = '';
        } else {
          emojiEl.textContent = data.emoji || '\uD83C\uDF7D\uFE0F';
          hero.style.background = restaurantHeroTint(data.id);
        }
        document.title = data.name + ' \u00B7 xLLM';
        renderInfo(data);
        renderMenu(data);
        renderReviews(data);
        loading.hidden = true;
        content.hidden = false;
        updateCartBar();
      } catch (err) {
        loading.hidden = true;
        showError(errorEl, err.message, [
          { label: 'Try again', run: load },
          { label: 'Back to home', href: '/customer/' }
        ]);
      }
    }

    anchorsEl.addEventListener('click', function (ev) {
      var link = ev.target.closest('[data-anchor]');
      if (!link) return;
      ev.preventDefault();
      var target = document.getElementById(link.dataset.anchor);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $$('.c-filter', anchorsEl).forEach(function (el) { el.classList.remove('is-active'); });
      link.classList.add('is-active');
    });

    menuEl.addEventListener('click', async function (ev) {
      var addBtn = ev.target.closest('[data-add], [data-plus]');
      var minusBtn = ev.target.closest('[data-minus]');
      if (addBtn) {
        ev.preventDefault();
        if (addBtn.disabled) return;
        var addId = Number(addBtn.dataset.add || addBtn.dataset.plus);
        var item = itemMap[addId];
        if (!item || !restaurant) return;
        try {
          var outcome = await addToCart(restaurant, item);
          if (outcome === 'max') {
            toast('Only ' + item.stock + ' of ' + item.name + ' left today', 'error');
          } else if (outcome === 'cancelled') {
            toast('Kept your cart from ' + readCart().restaurant_name);
          } else {
            syncRows();
            updateCartBar();
            toast('Added ' + item.name + ' to your cart');
          }
        } catch (err) {
          toast(err.message, 'error');
        }
      }
      if (minusBtn) {
        ev.preventDefault();
        decrementItem(restaurant.id, Number(minusBtn.dataset.minus));
        syncRows();
        updateCartBar();
      }
    });

    load();
  }

  /* ---------------------------------------------------------
     CART
     --------------------------------------------------------- */
  function initCart() {
    var loading = $('#cart-loading');
    var content = $('#cart-content');
    var empty = $('#cart-empty');
    var bar = $('#cart-bar');
    var errorEl = $('#cart-error');
    var restaurant = null;
    var cart = readCart();

    function render() {
      cart = readCart();
      var lines = cartLines(cart);
      if (!lines.length) {
        content.hidden = true;
        empty.hidden = false;
        bar.hidden = true;
        return;
      }
      empty.hidden = true;
      content.hidden = false;

      var fee = restaurant ? Number(restaurant.delivery_fee) || 0 : 0;
      var minOrder = restaurant ? Number(restaurant.min_order_amount) || 0 : 0;
      var subtotal = cartSubtotal(cart);
      var total = subtotal + fee;
      var belowMin = minOrder > 0 && subtotal < minOrder;

      var linesHtml = lines.map(function (row) {
        return '<li class="c-cartline">' +
          '<span class="c-thumb c-thumb--md" style="background:' + tint('dish-' + row.id + row.name) + '">' +
            photoOrEmoji(row.image_url, row.emoji) + '</span>' +
          '<div class="c-cartline__main">' +
            '<div class="c-cartline__name">' + esc(row.name) + '</div>' +
            '<div class="c-cartline__unit num">' + money(row.price) + ' each</div>' +
            '<div class="c-cartline__controls">' +
              '<div class="c-qty">' +
                '<button class="c-qty__btn" type="button" data-cart-minus="' + row.id + '" ' +
                  'aria-label="Remove one ' + esc(row.name) + '">' + ICON.minus + '</button>' +
                '<span class="c-qty__val num">' + row.qty + '</span>' +
                '<button class="c-qty__btn" type="button" data-cart-plus="' + row.id + '" ' +
                  'aria-label="Add one ' + esc(row.name) + '">' + ICON.plus + '</button>' +
              '</div>' +
              '<button class="c-cartline__remove" type="button" data-cart-remove="' + row.id + '" ' +
                'aria-label="Remove ' + esc(row.name) + ' from cart">' + ICON.trash + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="c-cartline__total num">' + money(row.price * row.qty) + '</div>' +
          '</li>';
      }).join('');

      var alertHtml = '';
      if (belowMin) {
        alertHtml = '<div class="c-alert c-alert--warning c-minhint">' +
          '<div class="c-alert__body"><span class="c-alert__text">Add ' + money(minOrder - subtotal) +
          ' more to reach the ' + money(minOrder) + ' minimum order.</span>' +
          '<div class="c-alert__actions"><a class="c-alert__action" href="/customer/restaurant/' +
          cart.restaurant_id + '">Add more items</a></div></div></div>';
      }

      content.innerHTML =
        '<div class="c-carthead">' +
          '<span class="c-thumb c-thumb--md" style="background:' + restaurantTint(restaurant ? restaurant.id : cart.restaurant_id) + '">' +
            photoOrEmoji(restaurant && restaurant.cover_url, restaurant && restaurant.emoji) + '</span>' +
          '<div class="c-carthead__main"><div class="c-carthead__name">' +
            esc(cart.restaurant_name || (restaurant && restaurant.name) || 'Your cart') + '</div>' +
            '<div class="c-carthead__meta num">' +
              (restaurant ? (restaurant.eta_minutes || 25) + ' min \u00B7 ' + money(fee) + ' delivery' : 'Loading restaurant\u2026') +
            '</div></div>' +
          '<a class="c-btn c-btn--text" href="/customer/restaurant/' +
            (restaurant ? restaurant.id : cart.restaurant_id) + '">Add items</a>' +
        '</div>' +
        '<div class="c-cartlist">' +
          '<div class="c-cartlist__title">' + plural(cartCount(cart), 'item') + '</div>' +
          '<ul>' + linesHtml + '</ul>' +
        '</div>' +
        '<div class="c-card c-card__body" style="margin-top:16px">' +
          '<div class="c-summary">' +
            summaryRow('Subtotal', money(subtotal)) +
            summaryRow('Delivery fee', money(fee)) +
            summaryRow('Total', money(total), 'c-summary__row--total') +
          '</div>' +
        '</div>' +
        alertHtml +
        '<div class="c-cartactions">' +
          '<a class="c-btn c-btn--ghost" href="/customer/restaurant/' +
            (restaurant ? restaurant.id : cart.restaurant_id) + '">Add more items</a>' +
        '</div>';

      bar.hidden = false;
      $('#cart-bar-count').textContent = plural(cartCount(cart), 'item');
      $('#cart-bar-total').textContent = money(total);
    }

    content.addEventListener('click', function (ev) {
      var plus = ev.target.closest('[data-cart-plus]');
      var minus = ev.target.closest('[data-cart-minus]');
      var remove = ev.target.closest('[data-cart-remove]');
      if (!plus && !minus && !remove) return;

      var id = Number((plus || minus || remove).dataset.cartPlus ||
        (minus && minus.dataset.cartMinus) || (remove && remove.dataset.cartRemove));
      cart = readCart();
      var row = cart.items[String(id)];
      if (!row) { render(); return; }

      if (plus) {
        var menuItem = null;
        if (restaurant && restaurant.menu) {
          restaurant.menu.forEach(function (group) {
            (group.items || []).forEach(function (item) {
              if (item.id === id) menuItem = item;
            });
          });
        }
        if (menuItem && menuItem.stock != null && row.qty + 1 > menuItem.stock) {
          toast('Only ' + menuItem.stock + ' of ' + row.name + ' left today', 'error');
          return;
        }
        row.qty = Math.min(row.qty + 1, MAX_QTY);
        writeCart(cart);
        render();
        return;
      }
      if (minus) {
        row.qty -= 1;
        if (row.qty <= 0) delete cart.items[String(id)];
        writeCart(cart);
        render();
        return;
      }
      var name = row.name;
      delete cart.items[String(id)];
      writeCart(cart);
      render();
      toast('Removed ' + name);
    });

    async function load() {
      if (!cart.restaurant_id || !cartLines(cart).length) {
        loading.hidden = true;
        empty.hidden = false;
        return;
      }
      try {
        restaurant = await api('/api/customer/restaurants/' + cart.restaurant_id);
        loading.hidden = true;
        render();
      } catch (err) {
        loading.hidden = true;
        showError(errorEl, err.message, [
          { label: 'Browse restaurants', href: '/customer/' },
          { label: 'Clear cart', run: function () {
            writeCart(emptyCart());
            render();
            toast('Cart cleared');
          } }
        ]);
      }
    }

    $('#cart-checkout').addEventListener('click', function (ev) {
      if (!cartLines(readCart()).length) {
        ev.preventDefault();
        toast('Your cart is empty', 'error');
      }
    });

    load();
  }

  /* ---------------------------------------------------------
     CHECKOUT
     --------------------------------------------------------- */
  function initCheckout() {
    var cart = readCart();
    var errorEl = $('#checkout-error');
    var empty = $('#checkout-empty');
    var content = $('#checkout-content');
    var bar = $('#checkout-bar');
    var placeBtn = $('#place-order');
    var restaurant = null;
    var addresses = [];

    if (!cart.restaurant_id || !cartLines(cart).length) {
      var emptySkeleton = $('#checkout-loading');
      if (emptySkeleton) emptySkeleton.hidden = true;
      empty.hidden = false;
      return;
    }

    function addressCard(a, checked) {
      return '<label class="c-addrcard' + (checked ? ' is-selected' : '') + '">' +
        '<input class="sr-only" type="radio" name="address" value="' + a.id + '"' +
          (checked ? ' checked' : '') + '>' +
        '<span class="c-radio" aria-hidden="true"></span>' +
        '<span class="c-addrcard__main">' +
          '<span class="c-addrcard__top"><span class="c-addrcard__label">' +
            esc(a.label || 'Address') + '</span>' +
            (a.is_default ? '<span class="c-chip c-chip--neutral">Default</span>' : '') + '</span>' +
          '<span class="c-addrcard__contact">' + esc(a.contact_name) + ' \u00B7 ' + esc(a.contact_phone) + '</span>' +
          '<span class="c-addrcard__text">' + esc(a.address_text) + '</span>' +
        '</span></label>';
    }

    function renderAddresses() {
      var wrap = $('#co-addresses');
      if (!addresses.length) {
        wrap.innerHTML = '<div class="c-card"><div class="c-empty" style="padding:26px 18px">' +
          '<div class="c-empty__title">No delivery address yet</div>' +
          '<div class="c-empty__desc">Add one so we know where to bring your order.</div>' +
          '<a class="c-btn c-btn--ghost c-btn--inline" href="/customer/addresses">Add address</a>' +
          '</div></div>';
        return;
      }
      var defaultAddress = addresses.filter(function (a) { return a.is_default; })[0] || addresses[0];
      wrap.innerHTML = addresses.map(function (a) {
        return addressCard(a, a.id === defaultAddress.id);
      }).join('');
      wrap.addEventListener('change', function (ev) {
        if (ev.target.name !== 'address') return;
        $$('.c-addrcard', wrap).forEach(function (card) {
          var input = $('input[name="address"]', card);
          card.classList.toggle('is-selected', input && input.checked);
        });
        renderEta();
      });
    }

    function selectedAddress() {
      var picked = $('#co-addresses input[name="address"]:checked');
      if (!picked) return null;
      return addresses.filter(function (a) {
        return String(a.id) === String(picked.value);
      })[0] || null;
    }

    function renderEta() {
      var address = selectedAddress();
      var distance = null;
      if (address && restaurant.lat != null && restaurant.lng != null &&
          address.lat != null && address.lng != null) {
        distance = distanceKm(Number(restaurant.lat), Number(restaurant.lng),
          Number(address.lat), Number(address.lng));
      }
      var prep = Number(restaurant.avg_prep_minutes) || 20;
      var etaMinutes = prep + (distance == null ? 10 : Math.max(Math.round(distance / 18 * 60), 5));
      var radius = Number(restaurant.delivery_radius_km) || 0;
      var outside = distance != null && radius > 0 && distance > radius;
      var arrival = new Date(Date.now() + etaMinutes * 60000);
      var etaEl = $('#co-eta');
      etaEl.classList.toggle('is-warning', outside);

      var title = outside
        ? 'Outside the delivery radius'
        : 'Arriving around ' + fmtTime(arrival.toISOString());
      var sub = outside
        ? distance.toFixed(1) + ' km away \u00B7 ' + (restaurant.name || 'This restaurant') +
          ' delivers within ' + radius.toFixed(1) + ' km'
        : etaMinutes + ' min \u00B7 Standard delivery' +
          (distance != null ? ' \u00B7 ' + distance.toFixed(1) + ' km' : '');
      etaEl.innerHTML =
        '<span class="c-eta__icon" aria-hidden="true">' + ICON.clock + '</span>' +
        '<span class="c-eta__main"><span class="c-eta__title num">' + esc(title) + '</span>' +
        '<span class="c-eta__sub">' + esc(sub) + '</span></span>';
    }

    function checkoutActions(message) {
      var m = String(message || '').toLowerCase();
      if (m.indexOf('outside') !== -1 || m.indexOf('radius') !== -1) {
        return [{ label: 'Change address', href: '/customer/addresses' }];
      }
      if (m.indexOf('minimum') !== -1 || m.indexOf('more to reach') !== -1) {
        return [{ label: 'Add more items', href: '/customer/restaurant/' + cart.restaurant_id }];
      }
      if (m.indexOf('sold out') !== -1 || m.indexOf('no longer on this menu') !== -1 ||
          m.indexOf('only ') !== -1 || m.indexOf('reduce the quantity') !== -1) {
        return [{ label: 'Review cart', href: '/customer/cart' }];
      }
      if (m.indexOf('not taking orders') !== -1) {
        return [
          { label: 'Browse other restaurants', href: '/customer/' },
          { label: 'Back to cart', href: '/customer/cart' }
        ];
      }
      if (m.indexOf('address') !== -1) {
        return [{ label: 'Choose an address', href: '/customer/addresses' }];
      }
      return [{ label: 'Back to cart', href: '/customer/cart' }];
    }

    function render() {
      var lines = cartLines(cart);
      var subtotal = cartSubtotal(cart);
      var fee = Number(restaurant.delivery_fee) || 0;
      var minOrder = Number(restaurant.min_order_amount) || 0;
      var total = subtotal + fee;
      var belowMin = minOrder > 0 && subtotal < minOrder;

      renderAddresses();
      renderEta();

      $('#co-items').innerHTML = lines.map(function (row) {
        return '<div class="c-coitem">' +
          '<span class="c-coitem__qty num">' + row.qty + '\u00D7</span>' +
          '<span class="c-coitem__name">' + esc(row.name) + '</span>' +
          '<span class="c-coitem__price num">' + money(row.price * row.qty) + '</span></div>';
      }).join('');

      var warning = belowMin
        ? '<div class="c-alert c-alert--warning" style="margin-bottom:14px">' +
            '<div class="c-alert__body"><span class="c-alert__text">Add ' + money(minOrder - subtotal) +
            ' more to reach the ' + money(minOrder) + ' minimum order.</span>' +
            '<div class="c-alert__actions"><a class="c-alert__action" href="/customer/restaurant/' +
            cart.restaurant_id + '">Add more items</a></div></div></div>'
        : '';

      $('#co-summary').innerHTML = warning +
        summaryRow('Subtotal', money(subtotal)) +
        summaryRow('Delivery fee', money(fee)) +
        summaryRow('Total', money(total), 'c-summary__row--total');

      $('#co-total').textContent = money(total);
      placeBtn.textContent = 'Place order \u00B7 ' + money(total);
      content.hidden = false;
      bar.hidden = false;
    }

    placeBtn.addEventListener('click', async function () {
      clearAlert(errorEl);
      var picked = $('input[name="address"]:checked');
      if (!picked) {
        showError(errorEl, 'Choose a delivery address first \u2014 add one in your address book.',
          [{ label: 'Add address', href: '/customer/addresses' }]);
        errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      var remark = ($('#co-remark').value || '').trim();
      var payload = {
        restaurant_id: cart.restaurant_id,
        address_id: Number(picked.value),
        items: cartLines(cart).map(function (row) {
          return { menu_item_id: row.id, quantity: row.qty };
        }),
        remark: remark
      };
      setBusy(placeBtn, true);
      try {
        var data = await api('/api/customer/orders', { method: 'POST', body: payload });
        writeCart(emptyCart());
        toast(data.message || 'Order placed');
        location.href = '/customer/orders/' + data.order.id;
      } catch (err) {
        setBusy(placeBtn, false);
        showError(errorEl, err.message, checkoutActions(err.message));
        errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    async function load() {
      try {
        var results = await Promise.all([
          api('/api/customer/addresses'),
          api('/api/customer/restaurants/' + cart.restaurant_id)
        ]);
        addresses = results[0].addresses || [];
        restaurant = results[1];
        var skeleton = $('#checkout-loading');
        if (skeleton) skeleton.hidden = true;
        render();
      } catch (err) {
        var skeletonEl = $('#checkout-loading');
        if (skeletonEl) skeletonEl.hidden = true;
        showError(errorEl, err.message, [
          { label: 'Back to cart', href: '/customer/cart' },
          { label: 'Browse restaurants', href: '/customer/' }
        ]);
      }
    }

    load();
  }

  /* ---------------------------------------------------------
     ORDERS LIST
     --------------------------------------------------------- */
  function initOrders() {
    var loading = $('#orders-loading');
    var activeEl = $('#orders-active');
    var pastEl = $('#orders-past');
    var errorEl = $('#orders-error');
    var segActive = $('#seg-active');
    var segPast = $('#seg-past');

    function setTab(tab) {
      var isActive = tab === 'active';
      segActive.classList.toggle('is-active', isActive);
      segPast.classList.toggle('is-active', !isActive);
      segActive.setAttribute('aria-selected', isActive ? 'true' : 'false');
      segPast.setAttribute('aria-selected', isActive ? 'false' : 'true');
      activeEl.hidden = !isActive;
      pastEl.hidden = isActive;
    }

    function orderCard(order, past) {
      var label = statusLabel(order.status);
      var meta = esc(order.order_no) + ' \u00B7 ' + fmtDateTime(order.created_at) + ' \u00B7 ' +
        plural(order.item_count, 'item');
      var eta = '';
      if (!past) {
        eta = order.is_delayed ? 'Running late' : (order.estimated_delivery_at
          ? arrivalText(order.estimated_delivery_at) : 'Finding a rider');
      }
      var cta = past
        ? (order.status === 'delivered' && !order.reviewed ? 'Rate this order \u2192' : 'View details \u2192')
        : 'Track order \u2192';
      return '<a class="c-order-card" href="/customer/orders/' + order.id + '">' +
        '<div class="c-between"><span class="c-order-card__rest">' +
          esc(order.restaurant && order.restaurant.name || 'Restaurant') + '</span>' +
          '<span class="' + statusChip(order.status) + '">' + esc(label) + '</span></div>' +
        '<div class="c-order-card__meta num">' + meta + '</div>' +
        (eta ? '<div class="c-order-card__meta">' + esc(eta) + '</div>' : '') +
        '<div class="c-order-card__foot"><span class="c-order-card__total num">' +
          money(order.total_amount) + '</span><span class="c-order-card__cta">' + cta + '</span></div>' +
        (past ? '' : '<div class="c-minibar"><span style="width:' + statusProgress(order.status) + '%"></span></div>') +
        '</a>';
    }

    function render(active, past) {
      loading.hidden = true;
      if (!active.length) {
        activeEl.innerHTML = '<div class="c-orders-empty">' + emptyCard(
          'No active orders',
          'When you place an order, you can follow every step here.',
          'Browse restaurants', '/customer/', ICON.bag) + '</div>';
      } else {
        activeEl.innerHTML = '<div class="c-stack c-stack--sm">' +
          active.map(function (order) { return orderCard(order, false); }).join('') + '</div>';
      }

      if (!past.length) {
        pastEl.innerHTML = '<div class="c-orders-empty">' + emptyCard(
          'No past orders yet',
          'Your delivered and cancelled orders will be kept here.',
          'Browse restaurants', '/customer/', ICON.tray) + '</div>';
      } else {
        var groups = [];
        var byMonth = {};
        past.forEach(function (order) {
          var key = fmtMonth(order.created_at);
          if (!byMonth[key]) { byMonth[key] = []; groups.push(key); }
          byMonth[key].push(order);
        });
        pastEl.innerHTML = groups.map(function (month) {
          return '<div class="c-monthgroup">' +
            '<div class="c-monthgroup__title">' + esc(month) + '</div>' +
            '<div class="c-stack c-stack--sm">' +
              byMonth[month].map(function (order) { return orderCard(order, true); }).join('') +
            '</div></div>';
        }).join('');
      }
      setTab(active.length ? 'active' : (past.length ? 'past' : 'active'));
    }

    async function load() {
      clearAlert(errorEl);
      loading.hidden = false;
      activeEl.hidden = true;
      pastEl.hidden = true;
      try {
        var data = await api('/api/customer/orders');
        render(data.active || [], data.past || []);
      } catch (err) {
        loading.hidden = true;
        activeEl.hidden = false;
        setTab('active');
        showError(errorEl, err.message, [
          { label: 'Try again', run: load },
          { label: 'Home', href: '/customer/' }
        ]);
      }
    }

    segActive.addEventListener('click', function () {
      activeEl.hidden = false;
      pastEl.hidden = true;
      setTab('active');
    });
    segPast.addEventListener('click', function () {
      activeEl.hidden = true;
      pastEl.hidden = false;
      setTab('past');
    });

    load();
  }

  /* ---------------------------------------------------------
     ORDER DETAIL
     --------------------------------------------------------- */
  function initOrder() {
    var loading = $('#order-loading');
    var content = $('#order-content');
    var errorEl = $('#order-error');
    var actionsEl = $('#order-actions');
    var cancelModal = $('#cancel-modal');
    var reviewModal = $('#review-modal');
    var addressModal = $('#address-modal');
    var order = null;
    var pollTimer = null;
    var reviewRating = 0;
    var riderRating = 0;

    function setStars(container, value) {
      $$('.c-star', container).forEach(function (btn) {
        var on = Number(btn.dataset.value) <= value;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === value));
      });
    }

    function wireStars(container, onChange) {
      $$('.c-star', container).forEach(function (btn) {
        btn.addEventListener('click', function () {
          onChange(Number(btn.dataset.value));
        });
      });
    }

    function renderStatus(data) {
      var label = statusLabel(data.status);
      $('#order-title').textContent = label;
      $('#order-chip').className = statusChip(data.status);
      $('#order-chip').textContent = label;

      var sub = '';
      if (data.status === 'cancelled') {
        sub = 'Cancelled ' + fmtDateTime(data.cancelled_at);
      } else if (data.status === 'delivered') {
        sub = 'Delivered ' + fmtDateTime(data.delivered_at);
      } else if (data.estimated_delivery_at) {
        sub = data.is_delayed
          ? 'Running late \u00B7 updated arrival ' + fmtTime(data.estimated_delivery_at)
          : arrivalText(data.estimated_delivery_at);
      } else {
        sub = 'We are confirming your order';
      }
      $('#order-sub').textContent = sub;

      var delayed = $('#order-delayed');
      if (data.is_delayed) {
        delayed.hidden = false;
        delayed.textContent = 'The restaurant flagged this order as delayed' +
          (data.delay_reason ? ': ' + data.delay_reason : '') + '. We will keep you posted.';
      } else {
        delayed.hidden = true;
      }

      var cancelled = $('#order-cancelled');
      if (data.status === 'cancelled') {
        cancelled.hidden = false;
        var by = data.cancelled_by ? ' by ' + data.cancelled_by : '';
        cancelled.textContent = 'This order was cancelled' + by + '.' +
          (data.cancel_reason ? ' Reason: ' + data.cancel_reason : '') +
          (data.payment_status === 'refunded' ? ' Any payment was refunded (demo: no real charge).' : '');
      } else {
        cancelled.hidden = true;
      }

      var card = $('#order-timeline-card');
      var steps = data.steps || [];
      if (!steps.length) {
        card.hidden = true;
      } else {
        card.hidden = false;
        $('#order-timeline').innerHTML = steps.map(function (step) {
          var cls = step.state === 'done' ? ' is-done' : step.state === 'current' ? ' is-current' : '';
          // `ready` is not part of the customer timeline; show the next leg
          // ("On the way") as the current one so the bar never goes blank.
          if (data.status === 'ready' && step.status === 'delivering' && step.state === 'todo') {
            cls = ' is-current';
          }
          return '<div class="c-timeline__step' + cls + '">' +
            '<span class="c-timeline__dot" aria-hidden="true"></span>' +
            '<span class="c-timeline__label">' + esc(step.label) + '</span>' +
            '<span class="c-timeline__time num">' + (step.at ? fmtTime(step.at) : '') + '</span>' +
            '</div>';
        }).join('');
      }
    }

    function renderRestaurant(data) {
      var rest = data.restaurant || {};
      var phone = data.restaurant_phone || rest.phone;
      $('#order-restaurant').innerHTML = '<div class="c-contact">' +
        '<span class="c-contact__icon" aria-hidden="true">' + ICON.shop + '</span>' +
        '<span class="c-contact__main">' +
          '<span class="c-contact__title">' + esc(rest.name || 'Restaurant') + '</span>' +
          '<span class="c-contact__sub">' + esc(rest.address_text || '') + '</span>' +
        '</span>' + (phone ? telLink(phone, 'Call') : '') + '</div>';
    }

    function renderRider(data) {
      var section = $('#order-rider-section');
      var loc = data.rider_location;
      var active = ['pending', 'accepted', 'preparing', 'ready', 'delivering']
        .indexOf(data.status) !== -1;
      if (!data.rider && !loc && !active) {
        section.hidden = true;
        return;
      }
      section.hidden = false;

      var html = '';
      if (data.rider) {
        html += '<div class="c-contact">' +
          '<span class="c-contact__icon" aria-hidden="true">' + ICON.pin + '</span>' +
          '<span class="c-contact__main">' +
            '<span class="c-contact__title">' + esc(data.rider.name || 'Your rider') + '</span>' +
            '<span class="c-contact__sub">' +
              (data.rider.phone ? esc(data.rider.phone) : 'Phone number hidden') +
              ' \u00B7 delivering your order</span>' +
          '</span>' + (data.rider.phone ? telLink(data.rider.phone, 'Call') : '') + '</div>';
      } else {
        html += '<div class="c-contact">' +
          '<span class="c-contact__icon c-contact__icon--neutral" aria-hidden="true">' + ICON.pin + '</span>' +
          '<span class="c-contact__main">' +
            '<span class="c-contact__title">Looking for a rider</span>' +
            '<span class="c-contact__sub">A rider will be assigned once your order is ready for pickup.</span>' +
          '</span></div>';
      }

      if (loc && loc.lng != null && loc.lat != null) {
        var position = encodeURIComponent(Number(loc.lng)) + ',' + encodeURIComponent(Number(loc.lat));
        html += '<div class="c-riderloc">' +
          '<span class="c-riderloc__icon" aria-hidden="true">' + ICON.pin + '</span>' +
          '<span class="c-riderloc__text">Rider shared a location ' +
            esc(relativeTime(loc.recorded_at)) +
            (loc.accuracy_m != null ? ' \u00B7 \u00B1' + Math.round(loc.accuracy_m) + ' m' : '') +
          '</span>' +
          '<a class="c-riderloc__link" href="https://uri.amap.com/marker?position=' +
            encodeURIComponent(position) + '&name=' + encodeURIComponent('Your rider') +
            '" target="_blank" rel="noopener">View on map</a></div>';
      }
      $('#order-rider').innerHTML = html;
    }

    function renderDelivery(data) {
      var delivery = data.delivery || {};
      var html = '';
      html += deliveryRow(ICON.pin, 'Deliver to',
        esc(delivery.contact_name || '') + '<br>' + esc(delivery.address_text || '') +
        (delivery.contact_phone ? '<br><span class="num">' + esc(delivery.contact_phone) + '</span>' : ''));
      if (data.remark) {
        html += deliveryRow(ICON.note, 'Note for the restaurant', esc(data.remark));
      }
      html += deliveryRow(ICON.wallet, 'Payment', esc(data.payment_label || 'Paid (demo)'));
      if (data.distance_km != null) {
        html += deliveryRow(ICON.clock, 'Distance', Number(data.distance_km).toFixed(1) + ' km');
      }
      $('#order-delivery').innerHTML = html;
    }

    function renderItems(data) {
      var items = data.items || [];
      $('#order-items').innerHTML = items.map(function (item) {
        return '<div class="c-orderitem">' +
          '<span class="c-orderitem__qty num">' + item.quantity + '\u00D7</span>' +
          '<span class="c-orderitem__name">' + esc(item.name) + '</span>' +
          '<span class="c-orderitem__price num">' + money(item.subtotal) + '</span></div>';
      }).join('');
      var discount = Number(data.discount_amount) || 0;
      $('#order-summary').innerHTML =
        summaryRow('Items', money(data.items_amount)) +
        summaryRow('Delivery fee', money(data.delivery_fee)) +
        (discount > 0 ? summaryRow('Discount', '\u2212' + money(discount)) : '') +
        summaryRow('Total', money(data.total_amount), 'c-summary__row--total');
      $('#order-footnum').textContent = data.order_no + ' \u00B7 placed ' + fmtDateTime(data.created_at);
    }

    function renderActions(data) {
      var html = '';
      if (data.can_review) {
        html += '<div class="c-ratepromo">' +
          '<div class="c-ratepromo__title">How was your order?</div>' +
          '<div class="c-ratepromo__sub">Rate the restaurant' +
            (data.rider ? ' and your rider' : '') + ' — it helps other customers.</div>' +
          '<button class="c-btn" type="button" id="open-review">Rate this order</button></div>';
      }
      if (data.can_cancel) {
        html += '<button class="c-btn c-btn--danger" type="button" id="open-cancel">Cancel order</button>';
      }
      if (data.can_change_address) {
        html += '<button class="c-btn c-btn--ghost" type="button" id="open-address">Change address</button>';
      }
      if (!data.can_review && !data.can_cancel) {
        if (data.status === 'delivered' && data.reviewed) {
          html += '<p class="c-meta" style="text-align:center;padding:4px 0">Thanks \u2014 you rated this order.</p>';
        } else if (data.status === 'cancelled') {
          html += '<a class="c-btn c-btn--ghost" href="/customer/">Browse restaurants</a>';
        } else {
          html += '<p class="c-meta" style="text-align:center;padding:4px 0">' +
            'The restaurant is already working on this order. Call them if something is wrong.</p>';
        }
      }
      actionsEl.innerHTML = html;
      var cancelBtn = $('#open-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', openCancel);
      var reviewBtn = $('#open-review');
      if (reviewBtn) reviewBtn.addEventListener('click', openReview);
      var addressBtn = $('#open-address');
      if (addressBtn) addressBtn.addEventListener('click', openAddress);
    }

    function render(data) {
      order = data;
      renderStatus(data);
      renderRestaurant(data);
      renderRider(data);
      renderDelivery(data);
      renderItems(data);
      renderActions(data);
      loading.hidden = true;
      content.hidden = false;
      if (data.status === 'pending' || data.status === 'accepted' ||
          data.status === 'preparing' || data.status === 'ready' ||
          data.status === 'delivering') {
        schedulePoll();
      } else {
        clearInterval(pollTimer);
      }
    }

    function schedulePoll() {
      clearInterval(pollTimer);
      pollTimer = setInterval(function () {
        if (document.hidden) return;
        if ($('.c-modal:not([hidden])')) return;
        load(true);
      }, 20000);
    }

    async function load(silent) {
      if (!ORDER_ID) {
        loading.hidden = true;
        showError(errorEl, 'We could not tell which order to show.',
          [{ label: 'Back to orders', href: '/customer/orders' }]);
        return;
      }
      try {
        var data = await api('/api/customer/orders/' + ORDER_ID);
        render(data);
      } catch (err) {
        loading.hidden = true;
        if (!silent) {
          showError(errorEl, err.message, [
            { label: 'Try again', run: function () { load(false); } },
            { label: 'Back to orders', href: '/customer/orders' }
          ]);
        }
      }
    }

    /* ---- Cancel ---- */
    function openCancel() {
      if (!order) return;
      $('#cancel-reason').value = '';
      clearAlert($('#cancel-error'));
      fieldError($('#cancel-reason'), $('#cancel-error'), '');
      $$('#cancel-chips [data-reason]').forEach(function (chip) { chip.classList.remove('is-active'); });
      openModal(cancelModal);
    }

    $('#cancel-chips').addEventListener('click', function (ev) {
      var chip = ev.target.closest('[data-reason]');
      if (!chip) return;
      $('#cancel-reason').value = chip.dataset.reason;
      $$('#cancel-chips [data-reason]').forEach(function (el) {
        el.classList.toggle('is-active', el === chip);
      });
      fieldError($('#cancel-reason'), $('#cancel-error'), '');
    });

    $('#cancel-submit').addEventListener('click', async function () {
      var reason = ($('#cancel-reason').value || '').trim();
      if (reason.length < 3) {
        fieldError($('#cancel-reason'), $('#cancel-error'), 'Add a short reason (at least 3 characters).');
        $('#cancel-reason').focus();
        return;
      }
      var btn = this;
      setBusy(btn, true);
      try {
        var data = await api('/api/customer/orders/' + ORDER_ID + '/cancel', {
          method: 'POST',
          body: { reason: reason }
        });
        closeModal(cancelModal);
        toast(data.message || 'Order cancelled');
        await load(true);
      } catch (err) {
        fieldError($('#cancel-reason'), $('#cancel-error'), err.message);
      } finally {
        setBusy(btn, false);
      }
    });

    /* ---- Change delivery address (before pickup) ---- */
    function addressPickHtml(a, checked, current) {
      return '<label class="c-addrcard' + (checked ? ' is-selected' : '') + '">' +
        '<input class="sr-only" type="radio" name="address" value="' + a.id + '"' +
          (checked ? ' checked' : '') + '>' +
        '<span class="c-radio" aria-hidden="true"></span>' +
        '<span class="c-addrcard__main">' +
          '<span class="c-addrcard__top"><span class="c-addrcard__label">' +
            esc(a.label || 'Address') + '</span>' +
            (current ? '<span class="c-chip c-chip--neutral">Current</span>' : '') +
            (a.is_default ? '<span class="c-chip">Default</span>' : '') + '</span>' +
          '<span class="c-addrcard__contact">' + esc(a.contact_name) + ' \u00B7 ' +
            esc(a.contact_phone) + '</span>' +
          '<span class="c-addrcard__text">' + esc(a.address_text) + '</span>' +
        '</span></label>';
    }

    async function openAddress() {
      if (!order) return;
      clearAlert($('#address-error'));
      $('#address-submit').disabled = true;
      $('#address-list').innerHTML =
        '<span class="c-skel" style="width:100%;height:76px;border-radius:14px"></span>' +
        '<span class="c-skel" style="width:100%;height:76px;border-radius:14px"></span>';
      openModal(addressModal);
      try {
        var data = await api('/api/customer/addresses');
        var rows = data.addresses || [];
        if (!rows.length) {
          $('#address-list').innerHTML = '<div class="c-empty" style="padding:20px 8px">' +
            '<div class="c-empty__title">No saved addresses</div>' +
            '<div class="c-empty__desc">Add an address first, then come back to change this order.</div>' +
            '<a class="c-btn c-btn--ghost c-btn--inline" href="/customer/addresses">Add an address</a>' +
            '</div>';
          return;
        }
        var currentText = (order.delivery && order.delivery.address_text) || '';
        var matching = rows.filter(function (a) { return a.address_text === currentText; })[0];
        var selected = matching || rows.filter(function (a) { return a.is_default; })[0] || rows[0];
        $('#address-list').innerHTML = rows.map(function (a) {
          return addressPickHtml(a, a.id === selected.id, a.id === (matching && matching.id));
        }).join('');
        $('#address-submit').disabled = false;
      } catch (err) {
        $('#address-list').innerHTML = '';
        showError($('#address-error'), err.message, [
          { label: 'Try again', run: openAddress },
          { label: 'Manage addresses', href: '/customer/addresses' }
        ]);
      }
    }

    $('#address-list').addEventListener('change', function (ev) {
      if (ev.target.name !== 'address') return;
      $$('.c-addrcard', $('#address-list')).forEach(function (card) {
        var input = $('input[name="address"]', card);
        card.classList.toggle('is-selected', !!(input && input.checked));
      });
      clearAlert($('#address-error'));
    });

    $('#address-submit').addEventListener('click', async function () {
      var picked = $('#address-list input[name="address"]:checked');
      if (!picked) {
        showError($('#address-error'), 'Choose a delivery address to continue.');
        return;
      }
      var btn = this;
      setBusy(btn, true);
      clearAlert($('#address-error'));
      try {
        var data = await api('/api/customer/orders/' + ORDER_ID + '/address', {
          method: 'POST',
          body: { address_id: Number(picked.value) }
        });
        closeModal(addressModal);
        toast(data.message || 'Delivery address updated');
        await load(true);
      } catch (err) {
        showError($('#address-error'), err.message, [
          { label: 'Manage addresses', href: '/customer/addresses' }
        ]);
      } finally {
        setBusy(btn, false);
      }
    });

    /* ---- Review ---- */
    function openReview() {
      if (!order) return;
      reviewRating = 0;
      riderRating = 0;
      setStars($('#review-stars'), 0);
      setStars($('#rider-stars'), 0);
      $('#review-stars-label').textContent = RATING_WORDS[0];
      $('#rider-stars-label').textContent = 'Optional';
      $('#review-subtitle').textContent = order.restaurant && order.restaurant.name || '';
      $('#review-content').value = '';
      clearAlert($('#review-error'));
      var riderBlock = $('#rider-rateblock');
      if (order.rider) {
        riderBlock.hidden = false;
        $('#review-subtitle').textContent = (order.restaurant && order.restaurant.name || 'Your order') +
          ' \u00B7 ' + (order.rider.name || 'your rider');
      } else {
        riderBlock.hidden = true;
      }
      openModal(reviewModal);
    }

    wireStars($('#review-stars'), function (value) {
      reviewRating = value;
      setStars($('#review-stars'), value);
      $('#review-stars-label').textContent = RATING_WORDS[value] || RATING_WORDS[0];
      clearAlert($('#review-error'));
    });

    wireStars($('#rider-stars'), function (value) {
      riderRating = value;
      setStars($('#rider-stars'), value);
      $('#rider-stars-label').textContent = RATING_WORDS[value] || 'Optional';
    });

    $('#review-submit').addEventListener('click', async function () {
      if (!reviewRating) {
        showError($('#review-error'), 'Pick a rating for the restaurant (1\u20135 stars).');
        return;
      }
      var btn = this;
      setBusy(btn, true);
      clearAlert($('#review-error'));
      var payload = {
        restaurant_rating: reviewRating,
        content: ($('#review-content').value || '').trim()
      };
      if (order && order.rider && riderRating) payload.rider_rating = riderRating;
      try {
        var data = await api('/api/customer/orders/' + ORDER_ID + '/review', {
          method: 'POST',
          body: payload
        });
        closeModal(reviewModal);
        toast(data.message || 'Thanks for your rating');
        await load(true);
      } catch (err) {
        showError($('#review-error'), err.message);
      } finally {
        setBusy(btn, false);
      }
    });

    window.addEventListener('pagehide', function () { clearInterval(pollTimer); });
    load(false);
  }

  /* ---------------------------------------------------------
     ADDRESSES
     --------------------------------------------------------- */
  function initAddresses() {
    var listEl = $('#addr-list');
    var loading = $('#addr-loading');
    var empty = $('#addr-empty');
    var errorEl = $('#addr-error');
    var panel = $('#addr-form-panel');
    var form = $('#addr-form');
    var formError = $('#addr-form-error');
    var addToggle = $('#addr-add-toggle');
    var mapEl = $('#addr-map');
    var mapNote = $('#addr-map-note');
    var mapMessage = $('#addr-map-message');
    var coordsEl = $('#addr-coords');
    var resetPin = $('#addr-reset-pin');
    var key = (APP_ROOT && APP_ROOT.dataset.amapKey) || '';
    var picked = { lng: CITY.lng, lat: CITY.lat };
    var mapReady = false;
    var amap = null;
    var marker = null;

    function updateCoords() {
      var isCity = Math.abs(picked.lng - CITY.lng) < 0.000001 && Math.abs(picked.lat - CITY.lat) < 0.000001;
      coordsEl.textContent = 'Map point: ' + picked.lng.toFixed(4) + ', ' + picked.lat.toFixed(4) +
        (isCity ? ' (city centre)' : ' (picked)');
      resetPin.hidden = !mapReady || isCity;
    }

    function loadScript(src) {
      return new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = function () { reject(new Error('Map failed to load')); };
        document.head.appendChild(script);
      });
    }

    async function setupMap() {
      if (!key || mapReady) return;
      mapEl.hidden = false;
      mapNote.hidden = true;
      try {
        var config = await api('/api/customer/config', { redirectOn401: false });
        if (config.amap_security_code) {
          window._AMapSecurityConfig = { securityJsCode: config.amap_security_code };
        }
        await loadScript('https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(key));
        if (!window.AMap) throw new Error('Map unavailable');
        amap = new window.AMap.Map(mapEl, { zoom: 13, center: [CITY.lng, CITY.lat] });
        marker = new window.AMap.Marker({ position: [CITY.lng, CITY.lat], map: amap });
        amap.on('click', function (event) {
          var lnglat = event.lnglat;
          picked = { lng: Number(lnglat.getLng()), lat: Number(lnglat.getLat()) };
          marker.setPosition([picked.lng, picked.lat]);
          updateCoords();
        });
        mapReady = true;
        if (mapMessage) mapMessage.remove();
        updateCoords();
      } catch (err) {
        mapEl.hidden = true;
        mapNote.hidden = false;
        mapNote.textContent = 'Map picker unavailable \u2014 enter the address and we will use the city centre as the map point';
      }
    }

    if (!key) {
      mapEl.hidden = true;
      mapNote.hidden = false;
      mapNote.textContent = 'Map picker unavailable \u2014 enter the address and we will use the city centre as the map point';
    } else {
      mapNote.hidden = true;
      mapEl.hidden = false;
      if (mapMessage) mapMessage.textContent = 'Open the form to pick a point on the map.';
    }
    updateCoords();

    function renderAddresses(rows) {
      loading.hidden = true;
      if (!rows.length) {
        empty.hidden = false;
        listEl.innerHTML = '';
        return;
      }
      empty.hidden = true;
      listEl.innerHTML = rows.map(function (a) {
        return '<div class="c-card c-card__body" style="padding:14px">' +
          '<div class="c-between">' +
            '<div class="c-row"><span class="c-addrcard__label">' + esc(a.label || 'Address') + '</span>' +
              (a.is_default ? '<span class="c-chip">Default</span>' : '') + '</div>' +
            '<span class="c-meta">' + esc(a.contact_name) + ' \u00b7 ' + esc(a.contact_phone) + '</span>' +
          '</div>' +
          '<p class="c-addrcard__text">' + esc(a.address_text) + '</p>' +
          '<div class="c-addrcard__actions">' +
            (a.is_default
              ? '<span class="c-btn c-btn--text" style="color:#9A9A9A;cursor:default">Used by default</span>'
              : '<button class="c-btn c-btn--text" type="button" data-set-default="' + a.id + '">Set as default</button>') +
            '<button class="c-btn c-btn--text" type="button" data-delete-address="' + a.id + '" ' +
              (a.is_default ? 'disabled title="Set another address as default before deleting this one"' : '') +
              ' style="margin-left:auto;color:' + (a.is_default ? '#C9C9C9' : 'var(--c-danger)') + '">Delete</button>' +
          '</div></div>';
      }).join('');
    }

    async function loadAddresses() {
      clearAlert(errorEl);
      loading.hidden = false;
      empty.hidden = true;
      listEl.innerHTML = '';
      try {
        var data = await api('/api/customer/addresses');
        renderAddresses(data.addresses || []);
      } catch (err) {
        loading.hidden = true;
        showError(errorEl, err.message, [{ label: 'Try again', run: loadAddresses }]);
      }
    }

    function showForm(show) {
      panel.hidden = !show;
      addToggle.setAttribute('aria-expanded', show ? 'true' : 'false');
      if (show) {
        if (key) setupMap();
        setTimeout(function () { $('#addr-contact').focus({ preventScroll: true }); }, 60);
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    addToggle.addEventListener('click', function () {
      showForm(panel.hidden);
    });
    $('#addr-empty-add').addEventListener('click', function () { showForm(true); });
    $('#addr-cancel').addEventListener('click', function () {
      showForm(false);
      form.reset();
      ['contact_name', 'contact_phone', 'address_text'].forEach(function (name) {
        fieldError($('#addr-' + (name === 'contact_name' ? 'contact' : name === 'contact_phone' ? 'phone' : 'text')), $('#err-' + name), '');
      });
      clearAlert(formError);
    });

    resetPin.addEventListener('click', function () {
      picked = { lng: CITY.lng, lat: CITY.lat };
      if (amap) amap.setCenter([CITY.lng, CITY.lat]);
      if (marker) marker.setPosition([CITY.lng, CITY.lat]);
      updateCoords();
    });

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      clearAlert(formError);
      var contactInput = $('#addr-contact');
      var phoneInput = $('#addr-phone');
      var textInput = $('#addr-text');
      var ok = true;
      if (!contactInput.value.trim()) {
        fieldError(contactInput, $('#err-contact_name'), 'Add the name the rider should ask for.');
        ok = false;
      } else { fieldError(contactInput, $('#err-contact_name'), ''); }
      if (!phoneInput.value.trim()) {
        fieldError(phoneInput, $('#err-contact_phone'), 'Add a phone number so the rider can reach you.');
        ok = false;
      } else { fieldError(phoneInput, $('#err-contact_phone'), ''); }
      if (textInput.value.trim().length < 6) {
        fieldError(textInput, $('#err-address_text'), 'Include the street and building number.');
        ok = false;
      } else { fieldError(textInput, $('#err-address_text'), ''); }
      if (!ok) return;

      var payload = {
        label: $('#addr-label').value,
        contact_name: contactInput.value.trim(),
        contact_phone: phoneInput.value.trim(),
        address_text: textInput.value.trim(),
        lng: picked.lng,
        lat: picked.lat,
        is_default: $('#addr-default').checked
      };
      var btn = $('#addr-save');
      setBusy(btn, true);
      try {
        await api('/api/customer/addresses', { method: 'POST', body: payload });
        form.reset();
        picked = { lng: CITY.lng, lat: CITY.lat };
        updateCoords();
        showForm(false);
        toast('Address saved');
        await loadAddresses();
      } catch (err) {
        var msg = err.message;
        var lower = msg.toLowerCase();
        if (lower.indexOf('contact') !== -1) {
          fieldError(contactInput, $('#err-contact_name'), msg);
        } else if (lower.indexOf('address is too short') !== -1) {
          fieldError(textInput, $('#err-address_text'), msg);
        } else if (lower.indexOf('map') !== -1 || lower.indexOf('coordinate') !== -1) {
          showError(formError, msg);
        } else {
          showError(formError, msg);
        }
      } finally {
        setBusy(btn, false);
      }
    });

    listEl.addEventListener('click', async function (ev) {
      var defaultBtn = ev.target.closest('[data-set-default]');
      var deleteBtn = ev.target.closest('[data-delete-address]');
      if (defaultBtn) {
        defaultBtn.disabled = true;
        try {
          await api('/api/customer/addresses/' + defaultBtn.dataset.setDefault + '/default', { method: 'POST' });
          toast('Default address updated');
          await loadAddresses();
        } catch (err) {
          defaultBtn.disabled = false;
          showError(errorEl, err.message, [{ label: 'Try again', run: loadAddresses }]);
        }
        return;
      }
      if (deleteBtn && !deleteBtn.disabled) {
        var confirmed = await confirmDialog({
          title: 'Delete this address?',
          body: 'You can add it again later. Orders already placed keep their own copy of the address.',
          confirmText: 'Delete address',
          cancelText: 'Keep it'
        });
        if (!confirmed) return;
        try {
          await api('/api/customer/addresses/' + deleteBtn.dataset.deleteAddress, { method: 'DELETE' });
          toast('Address deleted');
          await loadAddresses();
        } catch (err) {
          showError(errorEl, err.message, [
            { label: 'Manage addresses', run: loadAddresses }
          ]);
        }
      }
    });

    loadAddresses();
  }

  /* ---------------------------------------------------------
     ACCOUNT
     --------------------------------------------------------- */
  function initAccount() {
    var loading = $('#account-loading');
    var content = $('#account-content');
    var errorEl = $('#account-error');
    var form = $('#acct-form');
    var profile = null;

    function render(data, orders) {
      profile = data;
      var user = data.user || {};
      var name = user.name || user.username || 'Customer';
      $('#acct-avatar').textContent = initial(name);
      $('#acct-name').textContent = name;
      $('#acct-email').textContent = user.email || '';
      var meta = [];
      if (user.phone) meta.push(user.phone);
      if (user.created_at) meta.push('Member since ' + fmtMonth(user.created_at));
      $('#acct-meta').textContent = meta.join(' \u00B7 ');

      var total = data.order_count || 0;
      var active = orders ? (orders.active || []).length : 0;
      var delivered = orders
        ? (orders.past || []).filter(function (order) { return order.status === 'delivered'; }).length
        : 0;
      $('#acct-stats').innerHTML =
        '<div class="c-stat"><span class="c-stat__num num">' + total + '</span>' +
          '<span class="c-stat__label">Orders</span></div>' +
        '<div class="c-stat"><span class="c-stat__num num">' + active + '</span>' +
          '<span class="c-stat__label">Active</span></div>' +
        '<div class="c-stat"><span class="c-stat__num num">' + delivered + '</span>' +
          '<span class="c-stat__label">Delivered</span></div>';

      $('#acct-input-name').value = user.name || user.username || '';
      $('#acct-input-phone').value = user.phone || '';
      loading.hidden = true;
      content.hidden = false;
    }

    async function load() {
      clearAlert(errorEl);
      try {
        var results = await Promise.all([
          api('/api/customer/profile'),
          api('/api/customer/orders').catch(function () { return null; })
        ]);
        render(results[0], results[1]);
      } catch (err) {
        loading.hidden = true;
        showError(errorEl, err.message, [
          { label: 'Try again', run: load },
          { label: 'Sign out', run: signOut }
        ]);
      }
    }

    async function signOut() {
      try {
        await api('/api/auth/logout', { method: 'POST', redirectOn401: false });
      } catch (err) { /* still leave the page */ }
      location.href = '/customer/login';
    }

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      clearAlert(errorEl);
      var nameInput = $('#acct-input-name');
      var phoneInput = $('#acct-input-phone');
      var name = nameInput.value.trim();
      if (name.length < 2) {
        fieldError(nameInput, $('#err-acct-name'), 'Name must be at least 2 characters.');
        nameInput.focus();
        return;
      }
      fieldError(nameInput, $('#err-acct-name'), '');
      fieldError(phoneInput, $('#err-acct-phone'), '');
      var btn = $('#acct-save');
      setBusy(btn, true);
      try {
        var data = await api('/api/customer/profile', {
          method: 'PATCH',
          body: { name: name, phone: phoneInput.value.trim() }
        });
        var user = data.user || {};
        $('#acct-name').textContent = user.name || name;
        $('#acct-avatar').textContent = initial(user.name || name);
        var meta = [];
        if (user.phone) meta.push(user.phone);
        if (user.created_at) meta.push('Member since ' + fmtMonth(user.created_at));
        $('#acct-meta').textContent = meta.join(' \u00B7 ');
        var saved = $('#acct-saved');
        saved.hidden = false;
        setTimeout(function () { saved.hidden = true; }, 2400);
        toast('Profile updated');
      } catch (err) {
        var msg = err.message;
        if (msg.toLowerCase().indexOf('name') !== -1) {
          fieldError(nameInput, $('#err-acct-name'), msg);
        } else if (msg.toLowerCase().indexOf('phone') !== -1) {
          fieldError(phoneInput, $('#err-acct-phone'), msg);
        } else {
          showError(errorEl, msg);
        }
      } finally {
        setBusy(btn, false);
      }
    });

    $('#signout').addEventListener('click', signOut);
    load();
  }

  /* ---------------------------------------------------------
     AUTH (login / register)
     --------------------------------------------------------- */
  function initLogin() {
    var errorEl = $('#auth-error');
    var noticeEl = $('#auth-notice');
    var panes = {
      password: $('#pane-password'),
      code: $('#pane-code'),
      forgot: $('#pane-forgot')
    };

    function setMode(mode) {
      Object.keys(panes).forEach(function (key) {
        if (panes[key]) panes[key].hidden = key !== mode;
      });
      clearAlert(errorEl);
      var first = panes[mode] && panes[mode].querySelector('input');
      if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 40);
    }

    function showAuthError(message) {
      showError(errorEl, message);
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function showNotice(message) {
      if (!noticeEl) return;
      noticeEl.hidden = false;
      noticeEl.textContent = message;
    }

    $$('[data-login-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.dataset.loginMode); });
    });

    $$('[data-toggle-password]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.dataset.togglePassword);
        if (!input) return;
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });

    function armResend(btn, seconds) {
      if (!btn) return;
      var original = btn.dataset.label || btn.textContent;
      btn.dataset.label = original;
      btn.classList.remove('is-loading');
      var left = Math.max(1, Number(seconds) || 60);
      btn.disabled = true;
      btn.textContent = 'Resend in ' + left + 's';
      var timer = setInterval(function () {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          btn.disabled = false;
          btn.textContent = original;
          delete btn.dataset.label;
        } else {
          btn.textContent = 'Resend in ' + left + 's';
        }
      }, 1000);
    }

    async function sendCode(emailInput, button, purpose, noticeLabel) {
      var email = (emailInput.value || '').trim();
      clearAlert(errorEl);
      if (!email) {
        fieldError(emailInput, null, '');
        emailInput.classList.add('is-invalid');
        showAuthError('Enter the email address linked to your account.');
        return;
      }
      emailInput.classList.remove('is-invalid');
      setBusy(button, true);
      var armed = false;
      try {
        var data = await api('/api/auth/code/send', {
          method: 'POST',
          body: { email: email, purpose: purpose },
          redirectOn401: false
        });
        var text = 'Code sent. If this email is registered, it will arrive within a minute.';
        if (data && data.debug_code) text += ' Demo code: ' + data.debug_code;
        showNotice(text);
        var label = document.getElementById(noticeLabel);
        if (label) {
          label.hidden = false;
          label.textContent = text;
        }
        armResend(button, 60);
        armed = true;
      } catch (err) {
        var match = /wait (\d+)s/i.exec(err.message || '');
        if (match) {
          armResend(button, Number(match[1]));
          armed = true;
        }
        showAuthError(err.message);
      } finally {
        if (!armed) setBusy(button, false);
      }
    }

    /* Password sign-in */
    var passwordForm = $('#pane-password');
    passwordForm.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      clearAlert(errorEl);
      var accountInput = $('#login-account');
      var passwordInput = $('#login-password');
      var ok = true;
      if (!accountInput.value.trim()) {
        fieldError(accountInput, $('#err-account'), 'Enter your username or email.');
        ok = false;
      } else fieldError(accountInput, $('#err-account'), '');
      if (!passwordInput.value) {
        fieldError(passwordInput, $('#err-password'), 'Enter your password.');
        ok = false;
      } else fieldError(passwordInput, $('#err-password'), '');
      if (!ok) return;

      var btn = $('#login-submit');
      setBusy(btn, true);
      try {
        var data = await api('/api/auth/login', {
          method: 'POST',
          body: { account: accountInput.value.trim(), password: passwordInput.value },
          redirectOn401: false
        });
        if (data && data.user && data.user.role !== 'customer') {
          showAuthError('This is a ' + data.user.role +
            ' account. Use the ' + (data.user.role === 'restaurant' ? 'Merchant' : 'Rider') +
            ' portal below to continue.');
          setBusy(btn, false);
          return;
        }
        location.href = '/customer/';
      } catch (err) {
        setBusy(btn, false);
        showAuthError(err.message);
      }
    });

    /* Code sign-in */
    $('#code-send').addEventListener('click', function () {
      sendCode($('#code-email'), this, 'login', 'code-sent');
    });

    $('#pane-code').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      clearAlert(errorEl);
      var email = ($('#code-email').value || '').trim();
      var code = ($('#code-value').value || '').trim();
      if (!email || !/^\d{6}$/.test(code)) {
        showAuthError(!email ? 'Enter your email address.' : 'Enter the 6-digit code from your email.');
        return;
      }
      var btn = $('#code-submit');
      setBusy(btn, true);
      try {
        var data = await api('/api/auth/code/login', {
          method: 'POST',
          body: { email: email, code: code },
          redirectOn401: false
        });
        if (data && data.user && data.user.role !== 'customer') {
          showAuthError('This account is not a customer account.');
          setBusy(btn, false);
          return;
        }
        location.href = '/customer/';
      } catch (err) {
        setBusy(btn, false);
        showAuthError(err.message);
      }
    });

    /* Forgot password */
    $('#forgot-send').addEventListener('click', function () {
      sendCode($('#forgot-email'), this, 'reset_password', 'forgot-sent');
    });

    $('#pane-forgot').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      clearAlert(errorEl);
      var email = ($('#forgot-email').value || '').trim();
      var code = ($('#forgot-code').value || '').trim();
      var password = $('#forgot-password').value;
      if (!email) { showAuthError('Enter your email address.'); return; }
      if (!/^\d{6}$/.test(code)) { showAuthError('Enter the 6-digit code from your email.'); return; }
      if (!password || password.length < 8) {
        showAuthError('Choose a new password with at least 8 characters.');
        return;
      }
      var btn = $('#forgot-submit');
      setBusy(btn, true);
      try {
        await api('/api/auth/password/reset', {
          method: 'POST',
          body: { email: email, code: code, new_password: password },
          redirectOn401: false
        });
        setMode('password');
        $('#login-account').value = email;
        showNotice('Password updated \u2014 sign in with your new password.');
        toast('Password updated');
      } catch (err) {
        setBusy(btn, false);
        showAuthError(err.message);
      }
    });

    setMode('password');
  }

  function initRegister() {
    var errorEl = $('#auth-error');
    var form = $('#register-form');
    var usernameInput = $('#reg-username');
    var emailInput = $('#reg-email');
    var phoneInput = $('#reg-phone');
    var passwordInput = $('#reg-password');

    $$('[data-toggle-password]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.dataset.togglePassword);
        if (!input) return;
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
      });
    });

    function clearErrors() {
      clearAlert(errorEl);
      fieldError(usernameInput, $('#err-username'), '');
      fieldError(emailInput, $('#err-email'), '');
      fieldError(phoneInput, $('#err-phone'), '');
      fieldError(passwordInput, $('#err-password'), '');
    }

    function serverField(message) {
      var m = message.toLowerCase();
      if (m.indexOf('username') !== -1) return usernameInput;
      if (m.indexOf('email') !== -1) return emailInput;
      if (m.indexOf('password') !== -1) return passwordInput;
      if (m.indexOf('phone') !== -1) return phoneInput;
      return null;
    }

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      clearErrors();
      var username = usernameInput.value.trim();
      var email = emailInput.value.trim();
      var phone = phoneInput.value.trim();
      var password = passwordInput.value;
      var ok = true;

      if (!/^[\w\u4e00-\u9fa5]{3,40}$/.test(username)) {
        fieldError(usernameInput, $('#err-username'), 'Use 3–40 letters, digits, underscores or Chinese characters.');
        ok = false;
      }
      if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email)) {
        fieldError(emailInput, $('#err-email'), 'Enter a valid email address.');
        ok = false;
      }
      if (!password || password.length < 8) {
        fieldError(passwordInput, $('#err-password'), 'Use at least 8 characters.');
        ok = false;
      }
      if (phone && !/^[+\d][\d\s-]{4,19}$/.test(phone)) {
        fieldError(phoneInput, $('#err-phone'), 'Use digits, spaces, + and - only.');
        ok = false;
      }
      if (!ok) {
        var firstInvalid = $('.c-input.is-invalid', form);
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      var btn = $('#register-submit');
      setBusy(btn, true);
      try {
        await api('/api/auth/register', {
          method: 'POST',
          body: {
            username: username,
            email: email,
            phone: phone || null,
            password: password,
            role: 'customer'
          },
          redirectOn401: false
        });
        location.href = '/customer/';
      } catch (err) {
        setBusy(btn, false);
        var input = serverField(err.message);
        if (input) {
          var map = {};
          map[usernameInput.id] = $('#err-username');
          map[emailInput.id] = $('#err-email');
          map[phoneInput.id] = $('#err-phone');
          map[passwordInput.id] = $('#err-password');
          fieldError(input, map[input.id], err.message);
          input.focus();
        } else {
          showError(errorEl, err.message);
        }
      }
    });
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initBackButtons();
    var routes = {
      home: initHome,
      search: initSearch,
      restaurant: initRestaurant,
      cart: initCart,
      checkout: initCheckout,
      orders: initOrders,
      order: initOrder,
      addresses: initAddresses,
      account: initAccount,
      login: initLogin,
      register: initRegister
    };
    var init = routes[PAGE];
    if (init) {
      try {
        init();
      } catch (err) {
        // Never leave a page silent: surface unexpected boot errors.
        var main = $('#c-main');
        if (main) {
          var alert = document.createElement('div');
          alert.className = 'c-alert';
          alert.style.margin = '16px';
          alert.textContent = 'Something went wrong while loading this page. Please refresh.';
          main.prepend(alert);
        }
        if (window.console) console.error(err);
      }
    }
  });
})();
