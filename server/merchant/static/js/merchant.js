/* ============================================================
   xLLM · 商家后台交互（原生 JavaScript，无任何第三方依赖）
   页面路由：body[data-page] / body[data-auth] / body[data-order-id]
   数据一律来自 /api/merchant/*，前端不写死任何业务数据。
   ============================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     词表：与 docs/设计语言.md §6.1 完全一致
     ------------------------------------------------------------------ */
  const STATUS_LABELS = {
    pending: 'Placed',
    accepted: 'Accepted',
    preparing: 'Preparing',
    ready: 'Ready',
    delivering: 'On the way',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };
  const STATUS_TONE = {
    pending: 'warning',
    accepted: 'neutral',
    preparing: 'warning',
    ready: '',
    delivering: 'primary',
    delivered: '',
    cancelled: 'danger',
  };
  const ACTION_LABELS = {
    accept: 'Accept',
    decline: 'Decline',
    preparing: 'Start preparing',
    ready: 'Mark ready',
    flag_delay: 'Flag delay',
    delay: 'Flag delay',
  };

  /* ------------------------------------------------------------------
     小工具
     ------------------------------------------------------------------ */
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }
  function money(value) {
    return '\u00a5' + Number(value || 0).toFixed(2);
  }
  function intNum(value) {
    return Number(value || 0).toLocaleString('en-US');
  }
  const PLURAL_FORMS = { dish: 'dishes', 'more line': 'more lines' };
  function plural(count, word) {
    const value = Number(count);
    return value + ' ' + (value === 1 ? word : (PLURAL_FORMS[word] || word + 's'));
  }
  function pad(value) {
    return String(value).padStart(2, '0');
  }
  function hhmm(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function dateShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function dateTime(iso) {
    if (!iso) return '';
    return dateShort(iso) + ', ' + hhmm(iso);
  }
  function minutesSince(iso) {
    if (!iso) return 0;
    const started = new Date(iso).getTime();
    if (Number.isNaN(started)) return 0;
    return Math.max(0, Math.floor((Date.now() - started) / 60000));
  }
  function humanWait(iso) {
    const mins = minutesSince(iso);
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  }
  function statusLabel(status) {
    return STATUS_LABELS[status] || status || 'Unknown';
  }
  function titleCase(value) {
    const text = String(value || '');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  function statusChip(status) {
    const tone = STATUS_TONE[status];
    return '<span class="m-chip' + (tone ? ' m-chip--' + tone : '') + '">' +
      esc(statusLabel(status)) + '</span>';
  }
  function toneForSeverity(severity) {
    if (severity === 'danger') return 'danger';
    if (severity === 'warning') return 'warning';
    return 'neutral';
  }
  function emptyHTML(title, desc, icon) {
    return '<div class="m-empty">' +
      (icon || '<svg class="m-empty__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="12" width="32" height="24" rx="2"/><path d="M8 20h32"/></svg>') +
      '<div class="m-empty__title">' + esc(title) + '</div>' +
      '<div class="m-empty__desc">' + esc(desc) + '</div>' +
      '</div>';
  }
  function loadingHTML(label) {
    return '<div class="m-loading"><span class="m-spinner" aria-hidden="true"></span>' +
      esc(label || 'Loading\u2026') + '</div>';
  }
  function errorHTML(message) {
    return '<div class="m-error-box">' +
      '<div class="m-error-box__title">Something went wrong</div>' +
      '<div class="m-error-box__msg">' + esc(message || 'The request failed.') + '</div>' +
      '<button class="m-btn m-btn--quiet m-btn--sm" type="button" data-retry>Try again</button>' +
      '</div>';
  }
  function showError(container, error, retry) {
    container.innerHTML = errorHTML(error && error.message);
    const btn = container.querySelector('[data-retry]');
    if (btn && retry) btn.addEventListener('click', retry);
  }
  function toast(message, kind) {
    const stack = $('#toast-stack');
    if (!stack || !message) return;
    const node = document.createElement('div');
    node.className = 'm-toast' + (kind ? ' m-toast--' + kind : '');
    node.textContent = message;
    stack.appendChild(node);
    window.setTimeout(() => {
      node.classList.add('is-leaving');
      window.setTimeout(() => node.remove(), 220);
    }, 4200);
  }
  function setBusy(btn, busy, busyLabel) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = busyLabel || 'Working\u2026';
    } else {
      btn.disabled = false;
      if (btn.dataset.idleLabel) btn.textContent = btn.dataset.idleLabel;
    }
  }
  function fillStrip(parts) {
    const el = $('#page-strip');
    if (!el) return;
    el.textContent = parts.filter(Boolean).join(' · ');
  }
  function hueFor(text) {
    let h = 0;
    for (let i = 0; i < String(text).length; i += 1) {
      h = (h * 31 + String(text).charCodeAt(i)) % 360;
    }
    return h;
  }
  function dishTile(name, emoji) {
    const hue = hueFor(name || 'dish');
    const bg = 'linear-gradient(135deg,hsl(' + hue + ' 72% 93%),hsl(' +
      ((hue + 26) % 360) + ' 58% 84%))';
    return '<span class="m-dish__emoji" style="background:' + bg + '" aria-hidden="true">' +
      esc(emoji || '\ud83c\udf7d\ufe0f') + '</span>';
  }

  /* fetch 封装：统一错误 / 401 跳转（登录接口本身也用 401，故支持 noRedirect） */
  async function api(path, options) {
    const opts = options || {};
    const noRedirect = opts.noRedirect === true;
    const init = Object.assign({}, opts);
    delete init.noRedirect;
    init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {});
    init.credentials = 'same-origin';
    const res = await fetch(path, init);
    let json;
    try {
      json = await res.json();
    } catch (err) {
      json = { ok: false, error: 'Network error — check your connection and try again' };
    }
    if (res.status === 401 && !noRedirect) {
      window.location.href = '/merchant/login';
      throw new Error('Please sign in again');
    }
    if (!json.ok) {
      const error = new Error(json.error || 'Request failed');
      error.status = res.status;
      throw error;
    }
    return json.data;
  }

  /* ------------------------------------------------------------------
     表单错误
     ------------------------------------------------------------------ */
  function setFieldError(input, message) {
    if (!input) return;
    const field = input.closest('.m-field');
    if (!field) return;
    field.classList.toggle('has-error', !!message);
    const box = field.querySelector('.m-field-error');
    if (box) box.textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  function clearFormErrors(form) {
    if (!form) return;
    $$('.has-error', form).forEach((field) => field.classList.remove('has-error'));
    $$('.m-field-error', form).forEach((box) => { box.textContent = ''; });
    $$('input, textarea, select', form).forEach((input) => input.removeAttribute('aria-invalid'));
  }
  function formError(box, message) {
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('is-visible', !!message);
  }
  function guessField(message) {
    const text = String(message || '').toLowerCase();
    if (text.indexOf('password') !== -1) return 'password';
    if (text.indexOf('username') !== -1) return 'username';
    if (text.indexOf('email') !== -1) return 'email';
    if (text.indexOf('phone') !== -1) return 'phone';
    if (text.indexOf('store name') !== -1) return 'name';
    if (text.indexOf('street address') !== -1 || text.indexOf('address') !== -1) return 'address';
    if (text.indexOf('cuisine') !== -1) return 'cuisine';
    if (text.indexOf('calor') !== -1) return 'calories';
    if (text.indexOf('price') !== -1) return 'price';
    if (text.indexOf('stock') !== -1) return 'stock';
    return null;
  }

  /* ------------------------------------------------------------------
     顶栏：营业开关 / 账号 / 退出
     ------------------------------------------------------------------ */
  function setStoreStatus(isOpen, state) {
    const toggle = $('#store-open-switch');
    if (toggle) toggle.checked = !!isOpen;
    const dot = $('#store-dot');
    if (dot) dot.classList.toggle('m-dot--off', !isOpen);
    const label = $('#store-status-label');
    if (label) {
      if (!isOpen) label.textContent = 'Paused';
      else if (state && state.hours) label.textContent = state.hours;
      else if (state && state.detail) label.textContent = state.detail;
      else label.textContent = 'Open';
    }
  }

  async function refreshStoreStatus() {
    try {
      const data = await api('/api/merchant/settings');
      if (data && data.restaurant) setStoreStatus(data.restaurant.is_open, data.state);
    } catch (err) {
      /* 顶栏状态失败不阻塞页面，页面自己的错误态会说明问题 */
    }
  }

  function initChrome() {
    const nameEl = $('#account-name');
    const initialEl = $('#account-initial');
    api('/api/auth/me').then((user) => {
      if (nameEl) nameEl.textContent = user.name || user.username;
      if (initialEl) initialEl.textContent = String(user.name || user.username || '?').trim().charAt(0).toUpperCase();
    }).catch(() => {});

    const signout = $('#signout-btn');
    if (signout) {
      signout.addEventListener('click', async () => {
        signout.disabled = true;
        try { await api('/api/auth/logout', { method: 'POST' }); } catch (err) { /* 无所谓 */ }
        window.location.href = '/merchant/login';
      });
    }

    const toggle = $('#store-open-switch');
    if (toggle) {
      toggle.addEventListener('change', async () => {
        const wanted = toggle.checked;
        toggle.disabled = true;
        try {
          const data = await api('/api/merchant/status', {
            method: 'POST',
            body: JSON.stringify({ is_open: wanted }),
          });
          setStoreStatus(data.is_open, data.state);
          toast(data.message || 'Store status updated');
        } catch (err) {
          toggle.checked = !wanted;
          toast(err.message, 'error');
        } finally {
          toggle.disabled = false;
        }
      });
    }

    refreshStoreStatus();
  }

  /* ------------------------------------------------------------------
     登录 / 注册 / 开店
     ------------------------------------------------------------------ */
  function fieldValue(id) {
    const el = $('#' + id);
    return el ? el.value.trim() : '';
  }

  function initLogin() {
    const form = $('#login-form');
    if (!form) return;
    const account = $('#login-account');
    const password = $('#login-password');
    const errorBox = $('#login-form-error');
    const submit = $('#login-submit');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      formError(errorBox, '');
      let invalid = false;
      if (!account.value.trim()) { setFieldError(account, 'Enter your username or email'); invalid = true; }
      if (!password.value) { setFieldError(password, 'Enter your password'); invalid = true; }
      if (invalid) return;

      setBusy(submit, true, 'Signing in\u2026');
      try {
        await api('/api/auth/login', {
          method: 'POST',
          noRedirect: true,
          body: JSON.stringify({ account: account.value.trim(), password: password.value }),
        });
        window.location.href = '/merchant/';
      } catch (err) {
        formError(errorBox, err.message);
        setFieldError(account, 'Check this account');
        setFieldError(password, 'Check this password');
        setBusy(submit, false);
        password.focus();
      }
    });
  }

  function initRegister() {
    const form = $('#register-form');
    if (!form) return;
    const username = $('#register-username');
    const email = $('#register-email');
    const phone = $('#register-phone');
    const password = $('#register-password');
    const errorBox = $('#register-form-error');
    const submit = $('#register-submit');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      formError(errorBox, '');
      let invalid = false;
      if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{3,40}$/.test(username.value.trim())) {
        setFieldError(username, 'Use 3–40 letters, digits, underscores or Chinese characters');
        invalid = true;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        setFieldError(email, 'Enter a valid email address');
        invalid = true;
      }
      if (phone.value.trim() && phone.value.trim().length < 6) {
        setFieldError(phone, 'Enter a phone number customers can call');
        invalid = true;
      }
      if (password.value.length < 8) {
        setFieldError(password, 'Use at least 8 characters');
        invalid = true;
      }
      if (invalid) return;

      setBusy(submit, true, 'Creating\u2026');
      try {
        await api('/api/auth/register', {
          method: 'POST',
          noRedirect: true,
          body: JSON.stringify({
            username: username.value.trim(),
            email: email.value.trim(),
            phone: phone.value.trim() || null,
            password: password.value,
            role: 'restaurant',
          }),
        });
        window.location.href = '/merchant/setup';
      } catch (err) {
        formError(errorBox, err.message);
        const key = guessField(err.message);
        const map = { username: username, email: email, phone: phone, password: password };
        if (key && map[key]) setFieldError(map[key], err.message);
        setBusy(submit, false);
      }
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function initSetupMap() {
    const box = $('#setup-map');
    if (!box) return;
    const key = String(box.dataset.amapKey || '').trim();
    if (!key) return;                       /* 没配置 Key：保留 HTML 里的说明，用默认市中心坐标 */
    const lngInput = $('#setup-lng');
    const latInput = $('#setup-lat');
    const help = $('#setup-map-help');
    const fallbackHTML = '<div class="m-map__fallback"><span>Map unavailable right now.</span>' +
      '<span class="m-map__pin-note">Your store will still be placed at the Shanghai city centre (121.4737, 31.2304).</span></div>';

    const security = String(box.dataset.amapSecurity || '').trim();
    if (security) window._AMapSecurityConfig = { securityJsCode: security };
    loadScript('https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(key) +
      '&plugin=AMap.Geocoder').then(() => {
      if (!window.AMap) throw new Error('AMap missing');
      box.innerHTML = '';
      const lng = parseFloat(lngInput.value) || 121.4737;
      const lat = parseFloat(latInput.value) || 31.2304;
      const map = new window.AMap.Map(box, {
        zoom: 15,
        center: [lng, lat],
        resizeEnable: true,
      });
      const marker = new window.AMap.Marker({ position: [lng, lat], draggable: true });
      map.add(marker);
      const geocoder = new window.AMap.Geocoder({ city: 'Shanghai' });

      const sync = (position) => {
        const nextLng = typeof position.getLng === 'function' ? position.getLng() : position.lng;
        const nextLat = typeof position.getLat === 'function' ? position.getLat() : position.lat;
        lngInput.value = Number(nextLng).toFixed(7);
        latInput.value = Number(nextLat).toFixed(7);
        geocoder.getAddress([nextLng, nextLat], (status, result) => {
          if (status === 'complete' && result.regeocode && result.regeocode.formattedAddress) {
            const address = $('#setup-address');
            if (address && !address.value.trim()) address.value = result.regeocode.formattedAddress;
          }
        });
      };

      map.on('click', (event) => {
        marker.setPosition(event.lnglat);
        sync(event.lnglat);
      });
      marker.on('dragend', (event) => sync(event.lnglat));
      if (help) help.textContent = 'Click the map or drag the pin to set the exact pickup point.';
    }).catch(() => {
      box.innerHTML = fallbackHTML;
      if (help) help.textContent = 'The map could not load — we will use the Shanghai city centre until you set a pin.';
    });
  }

  function initSetup() {
    const form = $('#setup-form');
    if (!form) return;
    initSetupMap();

    const fields = {
      name: $('#setup-name'),
      phone: $('#setup-phone'),
      address: $('#setup-address'),
      cuisine: $('#setup-cuisine'),
      description: $('#setup-description'),
      minOrder: $('#setup-min-order'),
      deliveryFee: $('#setup-delivery-fee'),
      radius: $('#setup-radius'),
      maxOrders: $('#setup-max-orders'),
      prep: $('#setup-prep'),
    };
    const errorBox = $('#setup-form-error');
    const submit = $('#setup-submit');
    const signout = $('#setup-signout');

    if (signout) {
      signout.addEventListener('click', async () => {
        try { await api('/api/auth/logout', { method: 'POST' }); } catch (err) { /* noop */ }
        window.location.href = '/merchant/login';
      });
    }

    function numeric(input, low, high, label) {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < low || value > high) {
        setFieldError(input, label + ' must be between ' + low + ' and ' + high);
        return null;
      }
      setFieldError(input, '');
      return value;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      formError(errorBox, '');
      let invalid = false;

      if (fields.name.value.trim().length < 2) {
        setFieldError(fields.name, 'Store name must be at least 2 characters');
        invalid = true;
      }
      if (!fields.phone.value.trim()) {
        setFieldError(fields.phone, 'Add a phone number customers can call');
        invalid = true;
      }
      if (fields.address.value.trim().length < 6) {
        setFieldError(fields.address, 'Add the street address so riders can find you');
        invalid = true;
      }

      const numbers = {
        min_order_amount: numeric(fields.minOrder, 0, 500, 'Minimum order'),
        delivery_fee: numeric(fields.deliveryFee, 0, 100, 'Delivery fee'),
        delivery_radius_km: numeric(fields.radius, 0.5, 30, 'Delivery radius'),
        max_concurrent_orders: numeric(fields.maxOrders, 1, 200, 'Max concurrent orders'),
        avg_prep_minutes: numeric(fields.prep, 1, 120, 'Average prep time'),
      };
      Object.keys(numbers).forEach((key) => { if (numbers[key] === null) invalid = true; });
      if (invalid) {
        formError(errorBox, 'Check the highlighted fields and try again.');
        return;
      }

      const payload = {
        name: fields.name.value.trim(),
        phone: fields.phone.value.trim(),
        address_text: fields.address.value.trim(),
        cuisine: fields.cuisine.value.trim() || 'Chinese',
        description: fields.description.value.trim(),
        min_order_amount: numbers.min_order_amount,
        delivery_fee: numbers.delivery_fee,
        delivery_radius_km: numbers.delivery_radius_km,
        max_concurrent_orders: numbers.max_concurrent_orders,
        avg_prep_minutes: numbers.avg_prep_minutes,
        lng: Number($('#setup-lng').value),
        lat: Number($('#setup-lat').value),
      };

      setBusy(submit, true, 'Creating store\u2026');
      try {
        const data = await api('/api/merchant/store', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast(data.message || 'Store created');
        window.location.href = '/merchant/';
      } catch (err) {
        formError(errorBox, err.message);
        const key = guessField(err.message);
        const map = {
          name: fields.name, phone: fields.phone, address: fields.address,
          cuisine: fields.cuisine,
        };
        if (key && map[key]) setFieldError(map[key], err.message);
        setBusy(submit, false);
      }
    });
  }

  /* ------------------------------------------------------------------
     总览
     ------------------------------------------------------------------ */
  const MINI_COLUMNS = [
    { title: 'Placed', statuses: ['pending'] },
    { title: 'Accepted', statuses: ['accepted'] },
    { title: 'Preparing', statuses: ['preparing'] },
    { title: 'Ready + On the way', statuses: ['ready', 'delivering'] },
  ];

  function kpiCard(label, value, sub, tone) {
    return '<div class="m-kpi-card' + (tone ? ' m-kpi-card--' + tone : '') + '">' +
      '<div class="m-kpi-card__label">' + esc(label) + '</div>' +
      '<div class="m-kpi-card__num">' + value + '</div>' +
      (sub ? '<div class="m-kpi-card__sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  function issueHref(issue) {
    if (issue.order) return '/merchant/orders/' + issue.order.id;
    if (issue.kind === 'sold_out') return '/merchant/menu';
    return '/merchant/issues';
  }

  function miniBoard(buckets) {
    return '<div class="m-board m-board--mini">' + MINI_COLUMNS.map((column) => {
      const orders = column.statuses.reduce((all, status) => all.concat(buckets[status] || []), []);
      const shown = orders.slice(0, 3);
      return '<div class="m-board__col">' +
        '<div class="m-board__head"><span class="m-board__title">' + esc(column.title) + '</span>' +
        '<span class="m-count">' + orders.length + '</span></div>' +
        (shown.length ? shown.map((order) =>
          '<a class="m-mini m-mini--' + order.status + '" href="/merchant/orders/' + order.id + '">' +
          '<span class="m-mini__no">' + esc(order.order_no) + '</span>' +
          '<span class="m-mini__meta">' + plural(order.item_count, 'item') + ' · ' + money(order.total_amount) + '</span>' +
          '<span class="m-mini__meta">' + humanWait(order.created_at) + ' waiting</span>' +
          '</a>').join('') : '<div class="m-board__empty">No orders here</div>') +
        (orders.length > 3 ? '<div class="m-mini__more">+' + (orders.length - 3) + ' more</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function alertList(issues) {
    if (!issues.length) {
      return emptyHTML('All clear', 'No unclaimed orders, delays or sold-out dishes right now.');
    }
    return '<div class="m-alert-list">' + issues.map((issue) => {
      const tone = issue.severity === 'danger' ? 'danger'
        : issue.severity === 'warning' ? 'warning' : 'neutral';
      return '<div class="m-alert m-alert--' + tone + '">' +
        '<span class="m-alert__dot" aria-hidden="true"></span>' +
        '<div class="m-alert__body">' +
        '<div class="m-alert__title">' + esc(issue.label) + '</div>' +
        '<div class="m-alert__detail">' + esc(issue.detail) + '</div>' +
        '</div>' +
        '<a class="m-alert__link" href="' + issueHref(issue) + '">' +
        (issue.order ? 'View' : 'Open') + ' →</a>' +
        '</div>';
    }).join('') + '</div>';
  }

  async function initDashboard() {
    const app = $('#dash-app');
    if (!app) return;

    async function load() {
      app.innerHTML = loadingHTML('Loading today\u2019s numbers\u2026');
      try {
        /* 总览接口只给进行中的队列；已送达 / 已取消的当日单另外各取一次。
           ⚠️ 不用多状态逗号参数：后端 clean(status, 20) 会把长参数截断。 */
        const results = await Promise.all([
          api('/api/merchant/dashboard'),
          api('/api/merchant/orders?status=delivered').catch(() => ({ orders: [] })),
          api('/api/merchant/orders?status=cancelled').catch(() => ({ orders: [] })),
        ]);
        const merged = new Map();
        (results[0].queue.orders || []).forEach((order) => merged.set(order.id, order));
        (results[1].orders || []).concat(results[2].orders || [])
          .forEach((order) => merged.set(order.id, order));
        renderDashboard(app, results[0], Array.from(merged.values()));
      } catch (err) {
        showError(app, err, load);
      }
    }

    load();
  }

  function todaysOrdersTable(orders) {
    if (!orders.length) {
      return emptyHTML('No orders yet today',
        'New orders appear here the moment a customer checks out.');
    }
    return '<table class="m-table"><thead><tr>' +
      '<th class="m-th">Order</th><th class="m-th">Customer</th><th class="m-th">Items</th>' +
      '<th class="m-th">Total</th><th class="m-th">Status</th><th class="m-th">Placed</th>' +
      '</tr></thead><tbody>' +
      orders.map((order) => {
        const customer = (order.delivery && order.delivery.contact_name) ||
          (order.customer && order.customer.name) || 'Customer';
        return '<tr>' +
          '<td class="m-td"><a class="m-link num" href="/merchant/orders/' + order.id + '">' +
          esc(order.order_no) + '</a></td>' +
          '<td class="m-td"><div class="m-cell-title">' + esc(customer) + '</div>' +
          '<div class="m-cell-sub num">' + esc((order.delivery && order.delivery.contact_phone) || '') + '</div></td>' +
          '<td class="m-td num">' + order.item_count + '</td>' +
          '<td class="m-td num">' + money(order.total_amount) + '</td>' +
          '<td class="m-td">' + statusChip(order.status) +
          (order.is_delayed ? ' <span class="m-chip m-chip--warning">Delayed</span>' : '') + '</td>' +
          '<td class="m-td m-cell-sub num">' + hhmm(order.created_at) + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';
  }

  function serviceCard(data) {
    const state = data.state || {};
    const restaurant = data.restaurant || {};
    const load = Math.min(100, Math.round(
      ((state.active_orders || 0) / (state.capacity || 1)) * 100));
    return '<section class="m-card">' +
      '<div class="m-card__head"><div class="m-card__title">Service today</div>' +
      '<span class="m-chip' + (state.accepting ? '' : ' m-chip--warning') + '">' +
      esc(state.label || '—') + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Service window</span><span class="m-kv__v">' +
      esc(state.hours || '—') + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Kitchen load</span><span class="m-kv__v">' +
      (state.active_orders || 0) + ' / ' + (state.capacity || 0) + '</span></div>' +
      '<div class="m-breakdown__bar" style="margin:6px 0 10px">' +
      '<div class="m-breakdown__fill" style="width:' + load + '%"></div></div>' +
      '<div class="m-kv"><span class="m-kv__k">Capacity left</span><span class="m-kv__v">' +
      (state.seats_left || 0) + ' orders</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Delivery radius</span><span class="m-kv__v">' +
      Number(restaurant.delivery_radius_km || 0).toFixed(1) + ' km</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Delivery fee</span><span class="m-kv__v">' +
      money(restaurant.delivery_fee) + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Minimum order</span><span class="m-kv__v">' +
      money(restaurant.min_order_amount) + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Average prep</span><span class="m-kv__v">' +
      (restaurant.avg_prep_minutes || 0) + ' min</span></div>' +
      '<div class="m-divider"></div>' +
      '<a class="m-link" href="/merchant/settings">Edit hours and capacity →</a>' +
      '</section>';
  }

  function renderDashboard(app, data, orders) {
    const k = data.kpis;
    const state = data.state || {};
    const todayKey = new Date().toDateString();
    const todayOrders = (orders || [])
      .filter((order) => new Date(order.created_at).toDateString() === todayKey)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 6);

    const sub = $('#dash-sub');
    if (sub) {
      sub.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric',
      }) + ' · ' + (state.detail || state.label || '');
    }
    fillStrip([
      plural(data.queue.orders.length, 'live order'),
      k.awaiting_rider + ' waiting for a rider',
      k.delayed_orders ? k.delayed_orders + ' delayed' : 'No delays flagged',
    ]);

    app.innerHTML =
      '<div class="m-kpi-cards">' +
      kpiCard('Orders today', intNum(k.today_orders), plural(k.today_delivered, 'delivered')) +
      kpiCard('Revenue today', money(k.today_revenue), 'Delivered orders only', 'accent') +
      kpiCard('Active orders', intNum(k.active_orders), 'In the kitchen now') +
      kpiCard('Delayed', intNum(k.delayed_orders), k.delayed_orders ? 'Customers notified' : 'None flagged', k.delayed_orders ? 'warn' : '') +
      kpiCard('Awaiting rider', intNum(k.awaiting_rider), 'Ready and unclaimed', k.awaiting_rider ? 'warn' : '') +
      kpiCard('Cancel rate', Number(k.cancel_rate || 0).toFixed(1) + '%', plural(k.cancelled_today, 'cancellation') + ' today') +
      kpiCard('Avg preparation', Number(k.avg_prep_minutes || 0).toFixed(1) + ' min', 'Accepted → ready') +
      '</div>' +
      '<div class="m-dash-cols">' +
      '<section class="m-card">' +
      '<div class="m-card__head"><div class="m-card__title">Live queue</div>' +
      '<a class="m-link" href="/merchant/orders">Open the board →</a></div>' +
      miniBoard(data.queue.buckets) +
      '</section>' +
      '<section class="m-card">' +
      '<div class="m-card__head"><div class="m-card__title">Needs attention</div>' +
      '<a class="m-link" href="/merchant/issues">All issues →</a></div>' +
      alertList(data.issues) +
      '</section>' +
      '</div>' +
      '<div class="m-dash-cols">' +
      '<section class="m-card m-card--flush">' +
      '<div class="m-card__head"><div class="m-card__title">Today\u2019s orders</div>' +
      '<a class="m-link" href="/merchant/orders">View all orders →</a></div>' +
      todaysOrdersTable(todayOrders) +
      '</section>' +
      serviceCard(data) +
      '</div>';
  }

  /* ------------------------------------------------------------------
     订单看板
     ------------------------------------------------------------------ */
  const BOARD_COLUMNS = [
    { title: 'Placed', statuses: ['pending'], empty: 'No new orders. The board refreshes every 15 seconds.' },
    { title: 'Accepted', statuses: ['accepted'], empty: 'Nothing waiting to be started.' },
    { title: 'Preparing', statuses: ['preparing'], empty: 'The kitchen is clear.' },
    { title: 'Ready + On the way', statuses: ['ready', 'delivering'], empty: 'No orders waiting for a rider.' },
  ];

  function cardActions(order) {
    const buttons = [];
    if (order.status === 'pending') {
      buttons.push(['accept', 'Accept', '']);
      buttons.push(['decline', 'Decline', 'quiet']);
    } else if (order.status === 'accepted') {
      buttons.push(['preparing', 'Start preparing', '']);
      buttons.push(['decline', 'Decline', 'quiet']);
    } else if (order.status === 'preparing') {
      buttons.push(['ready', 'Mark ready', '']);
      buttons.push(['delay', 'Flag delay', 'quiet']);
    } else if (order.status === 'ready' || order.status === 'delivering') {
      buttons.push(['delay', 'Flag delay', 'quiet']);
    }
    return buttons.map((button) =>
      '<button class="m-btn m-btn--sm' + (button[2] ? ' m-btn--' + button[2] : '') +
      '" type="button" data-action="' + button[0] + '" data-label="' + esc(button[1]) + '">' +
      esc(button[1]) + '</button>').join('');
  }

  function orderCard(order) {
    const customer = (order.delivery && order.delivery.contact_name) ||
      (order.customer && order.customer.name) || 'Customer';
    const chips = [];
    if (order.is_delayed) chips.push('<span class="m-chip m-chip--warning">Delayed</span>');
    if (order.status === 'delivering') chips.push('<span class="m-chip m-chip--primary">On the way</span>');
    if (order.status === 'ready' && !order.rider) chips.push('<span class="m-chip m-chip--neutral">Waiting for rider</span>');

    const items = order.items || [];
    const itemLines = items.slice(0, 2).map((item) =>
      '<div class="m-order-card__item"><span>' + esc(item.name) + ' ×' + item.quantity + '</span>' +
      '<span class="num">' + money(item.subtotal) + '</span></div>').join('');
    const extraCount = items.length - 2;
    const moreItems = extraCount > 0
      ? '<div class="m-order-card__meta">+' + extraCount + ' more ' +
        (extraCount === 1 ? 'line' : 'lines') + '</div>' : '';

    return '<article class="m-order-card m-order-card--' + order.status +
      (order.is_delayed ? ' is-delayed' : '') + '" data-order-id="' + order.id + '">' +
      '<div class="m-order-card__row">' +
      '<a class="m-order-no" href="/merchant/orders/' + order.id + '">' + esc(order.order_no) + '</a>' +
      '<span class="m-order-card__wait">' + humanWait(order.created_at) + '</span>' +
      '</div>' +
      '<div class="m-cell-title">' + esc(customer) + '</div>' +
      (itemLines ? '<div class="m-order-card__items">' + itemLines + '</div>' + moreItems : '') +
      '<div class="m-order-card__meta">' + plural(order.item_count, 'item') + ' · ' + money(order.total_amount) + '</div>' +
      (chips.length ? '<div class="m-order-card__chips">' + chips.join('') + '</div>' : '') +
      (order.rider && order.status === 'delivering'
        ? '<div class="m-order-card__hint">Rider: ' + esc(order.rider.name || 'Assigned') + '</div>' : '') +
      '<div class="m-order-card__actions">' + cardActions(order) + '</div>' +
      '<a class="m-order-card__link" href="/merchant/orders/' + order.id + '">View details</a>' +
      '</article>';
  }

  function renderBoard(board, orders) {
    board.innerHTML = BOARD_COLUMNS.map((column) => {
      const list = orders.filter((order) => column.statuses.indexOf(order.status) !== -1);
      return '<div class="m-board__col">' +
        '<div class="m-board__head"><span class="m-board__title">' + esc(column.title) + '</span>' +
        '<span class="m-count">' + list.length + '</span></div>' +
        (list.length ? list.map(orderCard).join('') :
          '<div class="m-board__empty">' + esc(column.empty) + '</div>') +
        '</div>';
    }).join('');
  }

  async function runOrderAction(orderId, action) {
    const endpoints = {
      accept: 'accept', decline: 'decline', preparing: 'preparing',
      ready: 'ready', delay: 'delay', flag_delay: 'delay',
    };
    const body = {};
    if (action === 'decline') body.reason = 'The restaurant cannot accept this order right now';
    if (action === 'delay' || action === 'flag_delay') body.reason = 'Kitchen is running behind';
    return api('/api/merchant/orders/' + orderId + '/' + (endpoints[action] || action), {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  function initOrders() {
    const orderId = document.body.dataset.orderId;
    if (orderId) { initOrderDetail(orderId); return; }

    const board = $('#board');
    if (!board) return;

    let loading = false;

    async function load(silent) {
      if (loading) return;
      loading = true;
      if (!silent) board.innerHTML = '<div class="m-loading" style="grid-column:1/-1"><span class="m-spinner" aria-hidden="true"></span>Loading the board\u2026</div>';
      try {
        const data = await api('/api/merchant/orders');
        renderBoard(board, data.orders);
        const counts = data.queue.counts || {};
        fillStrip([
          plural(data.orders.length, 'live order'),
          (counts.pending || 0) + ' placed',
          (counts.preparing || 0) + ' preparing',
          (counts.ready || 0) + ' waiting for a rider',
        ]);
        const updated = $('#board-updated');
        if (updated) updated.textContent = 'Updated ' + hhmm(new Date().toISOString());
      } catch (err) {
        if (silent) toast(err.message, 'error');
        else {
          board.innerHTML = '<div style="grid-column:1/-1">' + errorHTML(err.message) + '</div>';
          const retry = board.querySelector('[data-retry]');
          if (retry) retry.addEventListener('click', () => load(false));
        }
      } finally {
        loading = false;
      }
    }

    board.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const card = button.closest('[data-order-id]');
      if (!card) return;
      const action = button.dataset.action;
      if (action === 'decline' && !window.confirm('Decline this order? The customer is refunded in this demo.')) return;
      setBusy(button, true, 'Working\u2026');
      try {
        const data = await runOrderAction(card.dataset.orderId, action);
        toast(data.message || 'Order updated');
        await load(true);
      } catch (err) {
        toast(err.message, 'error');
        setBusy(button, false);
      }
    });

    const refresh = $('#board-refresh');
    if (refresh) refresh.addEventListener('click', () => load(false));

    load(false);

    window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 15000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') load(true);
    });
  }

  /* ------------------------------------------------------------------
     订单详情
     ------------------------------------------------------------------ */
  function orderBanners(order) {
    let html = '';
    if (order.is_delayed) {
      html += '<div class="m-banner m-banner--warn" style="margin-bottom:12px">' +
        '<svg class="m-banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.5 20h19L12 4z"/><path d="M12 10v4"/><path d="M12 17.5v.5"/></svg>' +
        '<span><span class="m-banner__title">Delay flagged.</span>' +
        esc(order.delay_reason || 'The kitchen is running behind') +
        '. The customer has been notified and the estimate moved back 10 minutes.</span></div>';
    }
    if (order.status === 'cancelled') {
      html += '<div class="m-banner m-banner--danger" style="margin-bottom:12px">' +
        '<svg class="m-banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 8 8 8M16 8l-8 8"/></svg>' +
        '<span><span class="m-banner__title">Order cancelled' +
        (order.cancelled_by ? ' by ' + esc(order.cancelled_by) : '') + '.</span>' +
        esc(order.cancel_reason || 'No reason was recorded') +
        (order.cancelled_at ? ' · ' + dateTime(order.cancelled_at) : '') + '</span></div>';
    }
    return html;
  }

  function renderTimeline(order) {
    if (!order.timeline || !order.timeline.length) {
      return '<div class="m-help">No timeline events yet.</div>';
    }
    return '<div class="m-tl">' + order.timeline.map((step) =>
      '<div class="m-tl__item is-' + step.state + '">' +
      '<span class="m-tl__dot" aria-hidden="true"></span>' +
      '<span class="m-tl__label">' + esc(step.label) + '</span>' +
      '<span class="m-tl__time">' + (step.at ? hhmm(step.at) : step.state === 'current' ? 'Now' : '—') + '</span>' +
      '</div>').join('') + '</div>';
  }

  function orderActionsCard(order) {
    const actions = order.actions || [];
    if (!actions.length) {
      return '<section class="m-card">' +
        '<div class="m-card__head"><div class="m-card__title">Actions</div>' + statusChip(order.status) + '</div>' +
        emptyHTML('Nothing to do here', 'This order is ' + statusLabel(order.status).toLowerCase() + ' and needs no kitchen action.');
    }
    return '<section class="m-card">' +
      '<div class="m-card__head"><div class="m-card__title">Actions</div>' + statusChip(order.status) + '</div>' +
      '<div class="m-stack" style="gap:8px">' +
      actions.map((action) => {
        const tone = action === 'accept' || action === 'preparing' || action === 'ready' ? '' : 'quiet';
        return '<button class="m-btn' + (tone ? ' m-btn--' + tone : '') + '" type="button" data-action="' +
          action + '" data-label="' + esc(ACTION_LABELS[action] || action) + '">' +
          esc(ACTION_LABELS[action] || action) + '</button>';
      }).join('') +
      '</div>' +
      '<p class="m-help" style="margin-top:10px">Actions follow the order state machine — declined orders are refunded automatically.</p>' +
      '</section>';
  }

  function renderOrder(app, order) {
    const customer = order.delivery || {};
    const items = order.items || [];
    const subtotal = Number(order.items_amount || 0);
    const total = Number(order.total_amount || 0);
    const discount = Number(order.discount_amount || 0);

    const itemsCard = '<section class="m-card m-card--flush">' +
      '<div class="m-card__head"><div class="m-card__title">Items</div>' +
      '<span class="m-meta">' + plural(order.item_count, 'item') + '</span></div>' +
      '<table class="m-table">' +
      '<thead><tr><th class="m-th">Dish</th><th class="m-th">Qty</th><th class="m-th">Unit</th><th class="m-th">Subtotal</th></tr></thead>' +
      '<tbody>' + items.map((item) =>
        '<tr><td class="m-td"><div class="m-dish">' +
        dishTile(item.name) +
        '<div class="m-dish__text"><div class="m-cell-title">' + esc(item.name) + '</div></div>' +
        '</div></td>' +
        '<td class="m-td num">' + item.quantity + '</td>' +
        '<td class="m-td num">' + money(item.unit_price) + '</td>' +
        '<td class="m-td num">' + money(item.subtotal) + '</td></tr>').join('') +
      '</tbody></table>' +
      '<div class="m-card__foot">' +
      '<div class="m-kv"><span class="m-kv__k">Items subtotal</span><span class="m-kv__v">' + money(subtotal) + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Delivery fee</span><span class="m-kv__v">' + money(order.delivery_fee) + '</span></div>' +
      (discount > 0 ? '<div class="m-kv"><span class="m-kv__k">Discount</span><span class="m-kv__v">−' + money(discount) + '</span></div>' : '') +
      '<div class="m-kv m-kv--total"><span class="m-kv__k">Customer paid</span><span class="m-kv__v">' + money(total) + '</span></div>' +
      '</div></section>';

    const deliveryCard = '<section class="m-card">' +
      '<div class="m-card__head"><div class="m-card__title">Delivery details</div>' +
      '<span class="m-chip m-chip--neutral">' + esc(titleCase(order.payment_status || 'unpaid')) + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Customer</span><span class="m-kv__v">' + esc(customer.contact_name || '—') + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Phone</span><span class="m-kv__v">' +
      (customer.contact_phone ? '<a class="m-link" href="tel:' + esc(customer.contact_phone) + '">' + esc(customer.contact_phone) + '</a>' : '—') +
      '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Address</span><span class="m-kv__v">' + esc(customer.address_text || '—') + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Distance</span><span class="m-kv__v">' +
      (order.distance_km ? Number(order.distance_km).toFixed(1) + ' km' : '—') + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Estimated delivery</span><span class="m-kv__v">' +
      (order.estimated_delivery_at ? hhmm(order.estimated_delivery_at) : '—') + '</span></div>' +
      (order.remark ? '<div class="m-divider"></div><div class="m-help">Customer note</div><div class="m-cell-title">' + esc(order.remark) + '</div>' : '') +
      '</section>';

    const riderCard = '<section class="m-card">' +
      '<div class="m-card__head"><div class="m-card__title">Rider</div>' +
      (order.rider ? '<span class="m-chip">Assigned</span>' : '<span class="m-chip m-chip--neutral">Not assigned</span>') +
      '</div>' +
      (order.rider
        ? '<div class="m-kv"><span class="m-kv__k">Name</span><span class="m-kv__v">' + esc(order.rider.name || '—') + '</span></div>' +
          '<div class="m-kv"><span class="m-kv__k">Phone</span><span class="m-kv__v">' +
          (order.rider.phone ? '<a class="m-link" href="tel:' + esc(order.rider.phone) + '">' + esc(order.rider.phone) + '</a>' : '—') +
          '</span></div>'
        : '<div class="m-help">No rider has claimed this order yet. Riders see it on their board as soon as it is marked ready.</div>') +
      '</section>';

    app.innerHTML =
      '<div class="m-pagehead">' +
      '<div><div class="m-row" style="gap:10px;flex-wrap:wrap">' +
      '<h1 class="m-h1">' + esc(order.order_no) + '</h1>' + statusChip(order.status) +
      (order.is_delayed ? '<span class="m-chip m-chip--warning">Delayed</span>' : '') +
      '</div><div class="m-pagehead__sub">Placed ' + dateTime(order.created_at) +
      ' · ' + plural(order.item_count, 'item') + ' · ' + money(total) + '</div></div>' +
      '<div class="m-pagehead__actions">' +
      '<a class="m-btn m-btn--quiet" href="/merchant/orders">← Order board</a>' +
      '</div></div>' +
      orderBanners(order) +
      '<div class="m-detail-grid">' +
      '<div class="m-stack">' + itemsCard + deliveryCard + riderCard + '</div>' +
      '<div class="m-stack">' + orderActionsCard(order) +
      '<section class="m-card"><div class="m-card__head"><div class="m-card__title">Timeline</div>' +
      '<span class="m-meta">' + esc(statusLabel(order.status)) + '</span></div>' +
      renderTimeline(order) + '</section>' +
      '<section class="m-card"><div class="m-card__head"><div class="m-card__title">Reference</div></div>' +
      '<div class="m-kv"><span class="m-kv__k">Order number</span><span class="m-kv__v">' + esc(order.order_no) + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Placed</span><span class="m-kv__v">' + dateTime(order.created_at) + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Accepted</span><span class="m-kv__v">' + (order.accepted_at ? hhmm(order.accepted_at) : '—') + '</span></div>' +
      '<div class="m-kv"><span class="m-kv__k">Ready</span><span class="m-kv__v">' + (order.ready_at ? hhmm(order.ready_at) : '—') + '</span></div>' +
      '</section>' +
      '</div></div>';
  }

  function initOrderDetail(orderId) {
    const app = $('#order-app');
    if (!app) return;

    async function load(silent) {
      if (!silent) app.innerHTML = loadingHTML('Loading the order\u2026');
      try {
        const order = await api('/api/merchant/orders/' + orderId);
        renderOrder(app, order);
        fillStrip([
          order.order_no + ' · ' + statusLabel(order.status),
          plural(order.item_count, 'item'),
          money(order.total_amount),
          order.is_delayed ? 'Delay flagged' : '',
        ]);
      } catch (err) {
        showError(app, err, () => load(false));
      }
    }

    app.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'decline' && !window.confirm('Decline this order? The customer is refunded in this demo.')) return;
      setBusy(button, true, 'Working\u2026');
      try {
        const data = await runOrderAction(orderId, action);
        toast(data.message || 'Order updated');
        await load(true);
      } catch (err) {
        toast(err.message, 'error');
        setBusy(button, false);
      }
    });

    load(false);
  }

  /* ------------------------------------------------------------------
     菜单与库存
     ------------------------------------------------------------------ */
  function stockChip(state) {
    if (state === 'sold_out') return '<span class="m-chip m-chip--danger">Sold out</span>';
    if (state === 'low_stock') return '<span class="m-chip m-chip--warning">Low stock</span>';
    return '<span class="m-chip">In stock</span>';
  }

  function initMenu() {
    const list = $('#menu-list');
    if (!list) return;

    let items = [];
    let categories = [];
    let stats = { total: 0, sold_out: 0, low_stock: 0 };
    let filter = 'all';
    let query = '';
    let editingId = null;
    const panel = $('#menu-panel');
    const createForm = $('#menu-create-form');
    const createError = $('#menu-form-error');

    function recomputeStats() {
      stats = {
        total: items.length,
        sold_out: items.filter((item) => item.sold_out).length,
        low_stock: items.filter((item) => item.stock_state === 'low_stock').length,
      };
    }

    function updateMeta() {
      const meta = $('#menu-stats');
      if (meta) {
        meta.textContent = 'Prices, calories and stock. A dish at zero hides itself from customers.';
      }
      const select = $('#menu-category');
      if (select) {
        if (!categories.length) {
          select.innerHTML = '<option value="all">All categories</option>';
        } else {
          select.innerHTML = '<option value="all">All categories</option>' +
            categories.map((cat) => '<option value="' + esc(cat) + '">' + esc(cat) + '</option>').join('');
        }
        if (filter !== 'all' && categories.indexOf(filter) === -1) filter = 'all';
        select.value = filter;
      }
      const dataList = $('#menu-categories');
      if (dataList) {
        dataList.innerHTML = categories.map((cat) => '<option value="' + esc(cat) + '"></option>').join('');
      }
      const count = $('#menu-filter-count');
      if (count) count.textContent = '';
    }

    function visibleItems() {
      const needle = query.toLowerCase();
      return items.filter((item) =>
        (filter === 'all' || item.category === filter) &&
        (!needle || ((item.name || '') + ' ' + (item.category || '') + ' ' + (item.description || ''))
          .toLowerCase().indexOf(needle) !== -1));
    }

    function tableHTML(rows) {
      return '<div class="m-card m-card--flush"><table class="m-table">' +
        '<thead><tr>' +
        '<th class="m-th">Dish</th><th class="m-th">Category</th><th class="m-th">Price</th>' +
        '<th class="m-th">Calories</th><th class="m-th">Stock</th><th class="m-th">Status</th>' +
        '<th class="m-th">On sale</th><th class="m-th">Actions</th>' +
        '</tr></thead><tbody>' +
        rows.map(rowHTML).join('') +
        '</tbody></table></div>';
    }

    function rowHTML(item) {
      if (editingId === item.id) {
        return '<tr data-item-id="' + item.id + '">' +
          '<td class="m-td"><input class="m-input m-input--sm" data-field="name" maxlength="80" value="' + esc(item.name) + '" aria-label="Dish name"></td>' +
          '<td class="m-td"><input class="m-input m-input--sm" data-field="category" list="menu-categories" maxlength="30" value="' + esc(item.category || '') + '" aria-label="Category"></td>' +
          '<td class="m-td"><input class="m-input m-input--sm num" data-field="price" type="number" min="0.01" max="9999" step="0.01" value="' + esc(item.price) + '" aria-label="Price"></td>' +
          '<td class="m-td"><input class="m-input m-input--sm num" data-field="calories" type="number" min="0" max="5000" step="1" value="' + (item.calories == null ? '' : item.calories) + '" aria-label="Calories"></td>' +
          '<td class="m-td"><input class="m-input m-input--sm num" data-field="stock" type="number" min="0" step="1" value="' + (item.stock == null ? '' : item.stock) + '" placeholder="∞" aria-label="Stock"></td>' +
          '<td class="m-td m-cell-sub">Editing</td>' +
          '<td class="m-td">—</td>' +
          '<td class="m-td"><div class="m-row m-row--tight">' +
          '<button class="m-btn m-btn--sm" type="button" data-action="save">Save</button>' +
          '<button class="m-btn m-btn--quiet m-btn--sm" type="button" data-action="cancel-edit">Cancel</button>' +
          '</div></td></tr>';
      }
      const unlimited = item.stock == null;
      return '<tr data-item-id="' + item.id + '">' +
        '<td class="m-td"><div class="m-dish">' + dishTile(item.name, item.emoji) +
        '<div class="m-dish__text"><div class="m-cell-title">' + esc(item.name) + '</div>' +
        '<div class="m-cell-sub">' + esc(item.description || 'No description') + '</div></div></div></td>' +
        '<td class="m-td"><span class="m-chip m-chip--neutral">' + esc(item.category || '—') + '</span></td>' +
        '<td class="m-td num">' + money(item.price) + '</td>' +
        '<td class="m-td m-cell-sub num">' + (item.calories ? item.calories + ' kcal' : '—') + '</td>' +
        '<td class="m-td">' +
        '<div class="m-stepper">' +
        '<button class="m-stepper__btn" type="button" data-action="stock-down" aria-label="Decrease stock for ' + esc(item.name) + '"' + (unlimited ? ' disabled' : '') + '>−</button>' +
        '<span class="m-stepper__val num">' + (unlimited ? '∞' : item.stock) + '</span>' +
        '<button class="m-stepper__btn" type="button" data-action="stock-up" aria-label="Increase stock for ' + esc(item.name) + '">+</button>' +
        '</div>' +
        (unlimited ? '<div class="m-cell-sub" style="margin-top:2px">Unlimited</div>' : '') +
        '</td>' +
        '<td class="m-td">' + stockChip(item.stock_state) + '</td>' +
        '<td class="m-td"><label class="m-switch"><input type="checkbox" data-action="availability"' +
        (item.is_available && !item.sold_out ? ' checked' : '') + ' aria-label="Available to order: ' + esc(item.name) + '"><span class="m-switch__track"></span></label></td>' +
        '<td class="m-td"><div class="m-row m-row--tight">' +
        '<button class="m-btn m-btn--quiet m-btn--sm" type="button" data-action="edit">Edit</button>' +
        '<button class="m-btn m-btn--danger m-btn--sm" type="button" data-action="delete">Delete</button>' +
        '</div></td></tr>';
    }

    function render() {
      const visible = visibleItems();
      const count = $('#menu-filter-count');
      if (!items.length) {
        list.innerHTML = '<div class="m-card">' +
          emptyHTML('Your menu is empty',
            'Add your first dish so customers have something to order. You can set price, calories and stock in one go.') +
          '<div class="m-row" style="justify-content:center;padding-bottom:24px">' +
          '<button class="m-btn" type="button" data-action="new">+ New item</button></div></div>';
      } else if (!visible.length) {
        list.innerHTML = '<div class="m-card">' +
          emptyHTML('No dishes match this filter', 'Try another category or clear the search to see the full menu.') +
          '</div>';
      } else {
        list.innerHTML = tableHTML(visible);
      }
      if (count) count.textContent = items.length ? visible.length + ' of ' + items.length + ' dishes' : 'No dishes yet';
    }

    async function load(showLoading) {
      if (showLoading) list.innerHTML = loadingHTML('Loading the menu\u2026');
      try {
        const data = await api('/api/merchant/menu-items');
        items = data.items || [];
        categories = data.categories || [];
        stats = data.stats || { total: items.length, sold_out: 0, low_stock: 0 };
        updateMeta();
        render();
        fillStrip([
          plural(items.length, 'dish'),
          stats.low_stock + ' low stock',
          stats.sold_out + ' sold out',
          'Menu changes apply immediately',
        ]);
      } catch (err) {
        showError(list, err, () => load(true));
      }
    }

    function openPanel() {
      if (!panel) return;
      panel.hidden = false;
      if (createForm) createForm.reset();
      clearFormErrors(createForm);
      formError(createError, '');
      const name = $('#new-name');
      if (name) { name.focus(); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }

    function closePanel() {
      if (!panel) return;
      panel.hidden = true;
      if (createForm) createForm.reset();
      clearFormErrors(createForm);
      formError(createError, '');
    }

    if ($('#menu-new')) $('#menu-new').addEventListener('click', openPanel);
    if ($('#menu-panel-close')) $('#menu-panel-close').addEventListener('click', closePanel);
    if ($('#menu-create-cancel')) $('#menu-create-cancel').addEventListener('click', closePanel);

    const search = $('#menu-search');
    if (search) search.addEventListener('input', () => { query = search.value.trim(); render(); });
    const category = $('#menu-category');
    if (category) category.addEventListener('change', () => { filter = category.value; render(); });

    list.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'new') { openPanel(); return; }
      const row = button.closest('tr[data-item-id]');
      if (!row) return;
      const id = Number(row.dataset.itemId);
      const item = items.find((entry) => entry.id === id);
      if (!item) return;

      if (action === 'edit') {
        editingId = id;
        render();
        const nameInput = list.querySelector('tr[data-item-id="' + id + '"] [data-field="name"]');
        if (nameInput) nameInput.focus();
      } else if (action === 'cancel-edit') {
        editingId = null;
        render();
      } else if (action === 'save') {
        await saveEdit(row, item);
      } else if (action === 'delete') {
        await removeItem(item);
      } else if (action === 'stock-up' || action === 'stock-down') {
        await changeStock(item, action === 'stock-up' ? 1 : -1);
      }
    });

    list.addEventListener('change', async (event) => {
      const input = event.target.closest('input[data-action="availability"]');
      if (!input) return;
      const row = input.closest('tr[data-item-id]');
      if (!row) return;
      const item = items.find((entry) => entry.id === Number(row.dataset.itemId));
      if (!item) return;
      const wanted = input.checked;
      const payload = wanted && item.stock === 0
        ? { is_available: true, stock: 10 }
        : { is_available: wanted };
      input.disabled = true;
      try {
        const data = await api('/api/merchant/menu-items/' + item.id + '/stock', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        Object.assign(item, data.item);
        recomputeStats();
        updateMeta();
        render();
        toast(wanted
          ? (item.stock === 0 ? 'Back on sale' : item.name + ' is on sale')
          : item.name + ' marked sold out');
      } catch (err) {
        input.checked = !wanted;
        toast(err.message, 'error');
      } finally {
        input.disabled = false;
      }
    });

    async function changeStock(item, delta) {
      const current = item.stock == null ? null : item.stock;
      const next = current == null ? (delta > 0 ? 10 : 0) : Math.max(0, current + delta);
      if (current != null && next === current) return;
      try {
        const data = await api('/api/merchant/menu-items/' + item.id + '/stock', {
          method: 'PATCH',
          body: JSON.stringify({ stock: next }),
        });
        Object.assign(item, data.item);
        recomputeStats();
        updateMeta();
        render();
        toast(next === 0 ? item.name + ' is sold out' : item.name + ': ' + next + ' left');
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    async function saveEdit(row, item) {
      const get = (field) => {
        const input = row.querySelector('[data-field="' + field + '"]');
        return input ? input.value.trim() : '';
      };
      const name = get('name');
      if (name.length < 2) { toast('Dish name must be at least 2 characters', 'error'); return; }
      const price = Number(get('price'));
      if (!Number.isFinite(price) || price <= 0 || price > 9999) {
        toast('Price must be between 0 and 9999', 'error');
        return;
      }
      const caloriesRaw = get('calories');
      const stockRaw = get('stock');
      const calories = caloriesRaw === '' ? null : Number(caloriesRaw);
      const stock = stockRaw === '' ? null : Number(stockRaw);
      if (calories !== null && (!Number.isInteger(calories) || calories < 0 || calories > 5000)) {
        toast('Calories must be a whole number between 0 and 5000', 'error');
        return;
      }
      if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
        toast('Stock must be a whole number, or empty for unlimited', 'error');
        return;
      }
      try {
        const data = await api('/api/merchant/menu-items/' + item.id, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            category: get('category') || 'Mains',
            price,
            calories,
            stock,
          }),
        });
        Object.assign(item, data.item, { emoji: item.emoji });
        editingId = null;
        recomputeStats();
        updateMeta();
        render();
        toast('Dish updated');
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    async function removeItem(item) {
      if (!window.confirm('Remove "' + item.name + '" from the menu? This cannot be undone.')) return;
      try {
        const data = await api('/api/merchant/menu-items/' + item.id, { method: 'DELETE' });
        items = items.filter((entry) => entry.id !== item.id);
        categories = Array.from(new Set(items.map((entry) => entry.category).filter(Boolean))).sort();
        recomputeStats();
        updateMeta();
        render();
        toast(data.message || 'Dish removed');
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    if (createForm) {
      createForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFormErrors(createForm);
        formError(createError, '');
        let invalid = false;
        const nameInput = $('#new-name');
        const priceInput = $('#new-price');
        const caloriesInput = $('#new-calories');
        const stockInput = $('#new-stock');

        if (nameInput.value.trim().length < 2) {
          setFieldError(nameInput, 'Dish name must be at least 2 characters');
          invalid = true;
        }
        const price = Number(priceInput.value);
        if (!Number.isFinite(price) || price <= 0 || price > 9999) {
          setFieldError(priceInput, 'Enter a price between 0.01 and 9999');
          invalid = true;
        }
        const calories = caloriesInput.value === '' ? null : Number(caloriesInput.value);
        if (calories !== null && (!Number.isInteger(calories) || calories < 0 || calories > 5000)) {
          setFieldError(caloriesInput, 'Whole number between 0 and 5000');
          invalid = true;
        }
        const stock = stockInput.value === '' ? null : Number(stockInput.value);
        if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
          setFieldError(stockInput, 'Whole number, or leave empty for unlimited');
          invalid = true;
        }
        if (invalid) return;

        const submit = $('#menu-create-submit');
        setBusy(submit, true, 'Adding\u2026');
        try {
          const data = await api('/api/merchant/menu-items', {
            method: 'POST',
            body: JSON.stringify({
              name: nameInput.value.trim(),
              category: $('#new-category').value.trim() || 'Mains',
              price,
              calories,
              stock,
              description: $('#new-description').value.trim(),
            }),
          });
          toast(data.message || 'Dish added');
          closePanel();
          await load(false);
        } catch (err) {
          formError(createError, err.message);
          const key = guessField(err.message);
          const map = { name: nameInput, price: priceInput, calories: caloriesInput, stock: stockInput };
          if (key && map[key]) setFieldError(map[key], err.message);
          setBusy(submit, false);
        }
      });
    }

    const restock = $('#menu-restock');
    if (restock) {
      restock.addEventListener('click', async () => {
        setBusy(restock, true, 'Restocking\u2026');
        try {
          const data = await api('/api/merchant/menu-items/restock', {
            method: 'POST',
            body: JSON.stringify({ threshold: 5, amount: 40 }),
          });
          toast(data.updated ? data.message : 'No low-stock dishes to restock',
            data.updated ? undefined : 'info');
          await load(false);
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          setBusy(restock, false);
        }
      });
    }

    load(false);
  }

  /* ------------------------------------------------------------------
     营业设置
     ------------------------------------------------------------------ */
  const SETTINGS_FIELDS = [
    { id: 'f-max_concurrent_orders', key: 'max_concurrent_orders', low: 1, high: 200, step: 1, label: 'Max concurrent orders' },
    { id: 'f-avg_prep_minutes', key: 'avg_prep_minutes', low: 1, high: 120, step: 1, label: 'Average prep time' },
    { id: 'f-delivery_radius_km', key: 'delivery_radius_km', low: 0.5, high: 30, step: 0.5, label: 'Delivery radius' },
    { id: 'f-min_order_amount', key: 'min_order_amount', low: 0, high: 500, step: 0.5, label: 'Minimum order' },
    { id: 'f-delivery_fee', key: 'delivery_fee', low: 0, high: 100, step: 0.5, label: 'Delivery fee' },
  ];

  function stateChip(state) {
    if (!state) return '';
    const tone = state.accepting ? '' : 'warning';
    return '<span class="m-chip' + (tone ? ' m-chip--' + tone : '') + '" id="settings-state-chip">' +
      esc(state.label || (state.accepting ? 'Open' : 'Closed')) + '</span>';
  }

  function hoursRow(hour, weekdayNames) {
    const name = weekdayNames[String(hour.weekday)] || weekdayNames[hour.weekday] || 'Day';
    const closed = !!hour.is_closed;
    return '<div class="m-hours__row' + (closed ? ' is-closed' : '') + '" data-weekday="' + hour.weekday + '">' +
      '<span class="m-hours__day">' + esc(name) + '</span>' +
      '<input class="m-input m-input--sm num" type="time" data-time="open" value="' + esc(hour.open_time || '10:00') + '" aria-label="' + esc(name) + ' opens"' + (closed ? ' disabled' : '') + '>' +
      '<input class="m-input m-input--sm num" type="time" data-time="close" value="' + esc(hour.close_time || '22:00') + '" aria-label="' + esc(name) + ' closes"' + (closed ? ' disabled' : '') + '>' +
      '<div class="m-hours__switch"><label class="m-switch"><input type="checkbox" data-closed' + (closed ? ' checked' : '') + ' aria-label="' + esc(name) + ' closed"><span class="m-switch__track"></span></label></div>' +
      '</div>';
  }

  function initSettings() {
    const root = $('#settings-app');
    if (!root) return;
    const saveButton = $('#save-settings');
    let savedDescription = '';

    function settingsField(field) {
      return '<div class="m-field">' +
        '<label class="m-label" for="' + field.id + '">' + esc(field.label) + '</label>' +
        '<input class="m-input num" id="' + field.id + '" type="number" min="' + field.low +
        '" max="' + field.high + '" step="' + field.step + '" value="" data-setting="' + field.key + '">' +
        '<span class="m-field-error" aria-live="polite"></span>' +
        '</div>';
    }

    async function load(showLoading) {
      if (showLoading) root.innerHTML = loadingHTML('Loading store settings\u2026');
      try {
        const data = await api('/api/merchant/settings');
        renderSettings(data);
      } catch (err) {
        showError(root, err, () => load(true));
      }
    }

    function renderSettings(data) {
      const restaurant = data.restaurant;
      const state = data.state || {};
      const hours = (data.opening_hours || []).slice().sort((a, b) => a.weekday - b.weekday);
      const names = data.weekday_names || {};
      savedDescription = restaurant.description || '';

      root.innerHTML =
        '<div class="m-settings-grid">' +
        '<div class="m-stack">' +
        '<section class="m-card">' +
        '<div class="m-card__head"><div class="m-card__title">Store status</div>' + stateChip(state) + '</div>' +
        '<div class="m-status-row">' +
        '<div><div class="m-status-row__label">' + (restaurant.is_open ? 'Accepting orders' : 'Orders paused') + '</div>' +
        '<div class="m-help" id="settings-state-detail">' + esc(state.detail || '') + '</div></div>' +
        '<label class="m-switch"><input type="checkbox" id="settings-open"' + (restaurant.is_open ? ' checked' : '') +
        ' aria-label="Accepting orders"><span class="m-switch__track"></span></label>' +
        '</div>' +
        '<div class="m-divider"></div>' +
        '<div class="m-kv"><span class="m-kv__k">Store</span><span class="m-kv__v">' + esc(restaurant.name) + '</span></div>' +
        '<div class="m-kv"><span class="m-kv__k">Phone</span><span class="m-kv__v">' + esc(restaurant.phone) + '</span></div>' +
        '<div class="m-kv"><span class="m-kv__k">Address</span><span class="m-kv__v">' + esc(restaurant.address_text) + '</span></div>' +
        '<div class="m-kv"><span class="m-kv__k">Cuisine</span><span class="m-kv__v">' + esc(restaurant.cuisine || '—') + '</span></div>' +
        '<p class="m-help" style="margin-top:10px">The switch in the top bar changes this instantly; saving here applies it too.</p>' +
        '</section>' +

        '<section class="m-card">' +
        '<div class="m-card__head"><div class="m-card__title">Opening hours</div>' +
        '<span class="m-meta">' + esc(state.hours || '') + '</span></div>' +
        '<div class="m-hours">' +
        '<div class="m-hours__head"><span>Day</span><span>Opens</span><span>Closes</span><span>Closed</span></div>' +
        hours.map((hour) => hoursRow(hour, names)).join('') +
        '</div>' +
        '<p class="m-help" style="margin-top:10px">A closing time earlier than the opening time means overnight service.</p>' +
        '</section>' +
        '</div>' +

        '<div class="m-stack">' +
        '<section class="m-card">' +
        '<div class="m-card__head"><div class="m-card__title">Capacity and delivery</div>' +
        '<span class="m-meta" id="settings-capacity-meta">' + (state.active_orders || 0) + ' / ' +
        (restaurant.max_concurrent_orders || 0) + ' in the kitchen</span></div>' +
        '<div class="m-form-grid">' + SETTINGS_FIELDS.map(settingsField).join('') + '</div>' +
        '<p class="m-help" style="margin-top:10px">When the kitchen reaches the maximum, new customers see a “Busy” notice.</p>' +
        '</section>' +

        '<section class="m-card">' +
        '<div class="m-card__head"><div class="m-card__title">Store description</div>' +
        '<span class="m-meta" id="desc-count">' + (restaurant.description || '').length + '/500</span></div>' +
        '<div class="m-field">' +
        '<label class="m-label sr-only" for="settings-description">Store description</label>' +
        '<textarea class="m-textarea" id="settings-description" maxlength="500" placeholder="One or two lines about the kitchen — what you are known for.">' +
        esc(restaurant.description || '') + '</textarea>' +
        '<span class="m-help">Shown to customers under your store name.</span>' +
        '</div>' +
        '</section>' +

        '<div class="m-form-error" id="settings-error" role="alert"></div>' +
        '<p class="m-help">One save applies opening hours, capacity and the description. The top-bar switch is instant.</p>' +
        '</div>' +
        '</div>';

      SETTINGS_FIELDS.forEach((field) => {
        const input = $('#' + field.id);
        if (input) input.value = restaurant[field.key] == null ? '' : restaurant[field.key];
      });

      const toggle = $('#settings-open');
      if (toggle) {
        toggle.addEventListener('change', () => {
          const label = $('.m-status-row__label');
          if (label) label.textContent = toggle.checked ? 'Accepting orders (unsaved)' : 'Orders paused (unsaved)';
        });
      }

      $$('.m-hours__row').forEach((row) => {
        const closed = row.querySelector('[data-closed]');
        if (!closed) return;
        closed.addEventListener('change', () => {
          row.classList.toggle('is-closed', closed.checked);
          $$('input[type="time"]', row).forEach((input) => { input.disabled = closed.checked; });
        });
      });

      const description = $('#settings-description');
      const count = $('#desc-count');
      if (description && count) {
        description.addEventListener('input', () => {
          count.textContent = description.value.length + '/500';
        });
      }

      fillStrip([
        restaurant.is_open ? 'Accepting orders' : 'Orders paused',
        state.hours || state.detail || '',
        (state.active_orders || 0) + ' / ' + (restaurant.max_concurrent_orders || 0) + ' in the kitchen',
        'One save applies everything',
      ]);

      if (saveButton) saveButton.disabled = false;
    }

    async function save() {
      const errorBox = $('#settings-error');
      formError(errorBox, '');
      const payload = {
        is_open: $('#settings-open').checked,
        opening_hours: [],
      };
      let invalid = false;

      SETTINGS_FIELDS.forEach((field) => {
        const input = $('#' + field.id);
        if (!input) return;
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < field.low || value > field.high) {
          setFieldError(input, field.label + ' must be between ' + field.low + ' and ' + field.high);
          invalid = true;
        } else {
          setFieldError(input, '');
          payload[field.key] = value;
        }
      });

      $$('.m-hours__row').forEach((row) => {
        const weekday = Number(row.dataset.weekday);
        if (!weekday) return;
        const open = row.querySelector('[data-time="open"]');
        const close = row.querySelector('[data-time="close"]');
        const closed = row.querySelector('[data-closed]').checked;
        payload.opening_hours.push({
          weekday,
          open_time: open.value || '10:00',
          close_time: close.value || '22:00',
          is_closed: closed,
        });
      });

      if (invalid) {
        formError(errorBox, 'Check the highlighted fields and save again.');
        return;
      }

      setBusy(saveButton, true, 'Saving\u2026');
      try {
        const data = await api('/api/merchant/settings', {
          method: 'PUT',
          body: JSON.stringify(payload),
        });

        const description = $('#settings-description').value.trim();
        if (description !== (savedDescription || '')) {
          /* API gap: PUT /settings 不接收 description，用店铺资料接口补一次 */
          await api('/api/merchant/store', {
            method: 'PATCH',
            body: JSON.stringify({ description }),
          });
          savedDescription = description;
        }

        setStoreStatus(data.restaurant.is_open, data.state);
        const detail = $('#settings-state-detail');
        if (detail) detail.textContent = (data.state && data.state.detail) || '';
        const chip = $('#settings-state-chip');
        if (chip && data.state) {
          chip.textContent = data.state.label || (data.state.accepting ? 'Open' : 'Closed');
          chip.className = 'm-chip' + (data.state.accepting ? '' : ' m-chip--warning');
        }
        const capacity = $('#settings-capacity-meta');
        if (capacity) {
          capacity.textContent = ((data.state && data.state.active_orders) || 0) + ' / ' +
            data.restaurant.max_concurrent_orders + ' in the kitchen';
        }
        const statusLabelEl = $('.m-status-row__label');
        if (statusLabelEl) statusLabelEl.textContent = data.restaurant.is_open ? 'Accepting orders' : 'Orders paused';
        const saved = $('#settings-saved');
        if (saved) saved.textContent = 'Saved ' + hhmm(new Date().toISOString());
        toast(data.message || 'Settings saved');
      } catch (err) {
        formError(errorBox, err.message);
        toast(err.message, 'error');
      } finally {
        setBusy(saveButton, false);
      }
    }

    if (saveButton) saveButton.onclick = save;
    load(true);
  }

  /* ------------------------------------------------------------------
     营业分析
     ------------------------------------------------------------------ */
  function barChart(rows, options) {
    const opts = options || {};
    const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
    const step = Math.max(1, Math.ceil(rows.length / 14));
    const bars = rows.map((row, index) => {
      const value = Number(row.value) || 0;
      const height = value ? Math.max(3, Math.round((value / max) * 100)) : 2;
      const muted = opts.mutedZero && !value ? ' m-chart__bar--muted' : '';
      return '<div class="m-chart__col" title="' + esc(row.title || (row.label + ': ' + row.display)) + '">' +
        '<div class="m-chart__bar' + muted + '" style="height:' + height + '%"></div></div>';
    }).join('');
    const labels = rows.map((row, index) =>
      '<span class="m-chart__label">' + (index % step === 0 ? esc(row.label) : '') + '</span>').join('');
    return '<div class="m-chart">' +
      '<div class="m-chart__plot">' + bars + '</div>' +
      '<div class="m-chart__labels">' + labels + '</div>' +
      '</div>';
  }

  function renderAnalytics(app, data) {
    const k = data.kpis;
    const totalOrders = k.orders || 0;
    const orderRows = data.daily.map((row) => ({
      label: dateShort(row.date + 'T00:00:00'),
      value: row.orders,
      display: row.orders,
      title: dateShort(row.date + 'T00:00:00') + ': ' + plural(row.orders, 'order'),
    }));
    const revenueRows = data.daily.map((row) => ({
      label: dateShort(row.date + 'T00:00:00'),
      value: row.revenue,
      display: money(row.revenue),
      title: dateShort(row.date + 'T00:00:00') + ': ' + money(row.revenue),
    }));
    const hourlyRows = (data.hourly || []).map((row) => ({
      label: pad(row.hour),
      value: row.orders,
      display: row.orders,
      title: pad(row.hour) + ':00 — ' + plural(row.orders, 'order'),
    }));
    const statusTotal = (data.status || []).reduce((sum, row) => sum + row.count, 0) || 1;
    const peakHour = hourlyRows.reduce((best, row) =>
      (row.value > best.value ? row : best), hourlyRows[0] || { value: 0, label: '00' });

    const topRows = (data.top_items || []).map((row, index) =>
      '<tr><td class="m-td num">' + (index + 1) + '</td>' +
      '<td class="m-td"><div class="m-dish">' + dishTile(row.name) +
      '<div class="m-dish__text"><div class="m-cell-title">' + esc(row.name) + '</div></div></div></td>' +
      '<td class="m-td num">' + row.quantity + '</td>' +
      '<td class="m-td num">' + money(row.revenue) + '</td></tr>').join('');

    app.innerHTML =
      '<div class="m-kpi-cards">' +
      kpiCard('Orders', intNum(k.orders), plural(k.delivered, 'delivered'), 'accent') +
      kpiCard('Revenue', money(k.revenue), 'Delivered orders only') +
      kpiCard('Average order', money(k.avg_order_value), 'Per delivered order') +
      kpiCard('Cancellations', Number(k.cancel_rate || 0).toFixed(1) + '%', plural(Math.round(totalOrders * (k.cancel_rate || 0) / 100), 'order') + ' cancelled') +
      kpiCard('Avg preparation', Number(k.avg_prep_minutes || 0).toFixed(1) + ' min', 'Accepted → ready') +
      kpiCard('Total orders', intNum(k.orders), 'Last ' + data.days + ' days') +
      '</div>' +

      '<div class="m-stack" style="margin-top:16px">' +
      '<div class="m-two-col">' +
      '<section class="m-card">' +
      '<div class="m-card__head"><div class="m-card__title">Orders per day</div>' +
      '<span class="m-meta">' + plural(totalOrders, 'order') + ' in ' + data.days + ' days</span></div>' +
      (totalOrders ? barChart(orderRows) : emptyHTML('No orders in this range', 'Try a longer range or check back after service.')) +
      '</section>' +
      '<section class="m-card">' +
      '<div class="m-card__head"><div class="m-card__title">Revenue per day</div>' +
      '<span class="m-meta">' + money(k.revenue) + ' delivered</span></div>' +
      (totalOrders ? barChart(revenueRows, { money: true })
        : emptyHTML('No revenue yet', 'Delivered orders are what count towards revenue.')) +
      '</section>' +
      '</div>' +

      '<section class="m-card">' +
      '<div class="m-card__head"><div class="m-card__title">Orders by hour</div>' +
      '<span class="m-meta">' + (totalOrders
        ? 'Peak ' + plural(peakHour.value, 'order') + ' at ' + peakHour.label + ':00'
        : 'Local time') + '</span></div>' +
      (totalOrders ? barChart(hourlyRows, { mutedZero: true })
        : emptyHTML('Nothing to show yet', 'Hourly demand appears once orders start coming in.')) +
      '</section>' +

      '<div class="m-two-col">' +
      '<section class="m-card m-card--flush">' +
      '<div class="m-card__head"><div class="m-card__title">Top dishes</div>' +
      '<span class="m-meta">By quantity sold</span></div>' +
      (topRows
        ? '<table class="m-table"><thead><tr><th class="m-th">#</th><th class="m-th">Dish</th>' +
          '<th class="m-th">Sold</th><th class="m-th">Revenue</th></tr></thead><tbody>' + topRows + '</tbody></table>'
        : emptyHTML('No dish sales yet', 'Delivered orders will rank your best sellers here.')) +
      '</section>' +
      '<section class="m-card">' +
      '<div class="m-card__head"><div class="m-card__title">Status breakdown</div>' +
      '<span class="m-meta">' + plural(totalOrders, 'order') + '</span></div>' +
      ((data.status || []).length
        ? '<div class="m-breakdown">' + data.status.map((row) =>
          '<div class="m-breakdown__row">' + statusChip(row.status) +
          '<div class="m-breakdown__bar"><div class="m-breakdown__fill" style="width:' +
          Math.round((row.count / statusTotal) * 100) + '%"></div></div>' +
          '<span class="m-breakdown__count">' + row.count + '</span></div>').join('') + '</div>'
        : emptyHTML('No status data', 'Orders from this range will be grouped by state here.')) +
      '</section>' +
      '</div>' +
      '</div>';

    fillStrip([
      data.days + ' days',
      plural(k.orders, 'order'),
      money(k.revenue) + ' revenue',
      Number(k.cancel_rate || 0).toFixed(1) + '% cancelled',
    ]);
  }

  function initAnalytics() {
    const app = $('#analytics-app');
    if (!app) return;
    const range = $('#analytics-range');
    let days = 7;

    async function load(nextDays) {
      days = nextDays || days;
      if (range) {
        $$('button[data-days]', range).forEach((button) => {
          button.classList.toggle('is-active', Number(button.dataset.days) === days);
        });
      }
      app.innerHTML = loadingHTML('Loading analytics\u2026');
      try {
        const data = await api('/api/merchant/analytics?days=' + days);
        renderAnalytics(app, data);
      } catch (err) {
        showError(app, err, () => load(days));
      }
    }

    if (range) {
      range.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-days]');
        if (button) load(Number(button.dataset.days));
      });
    }

    load(7);
  }

  /* ------------------------------------------------------------------
     异常与售后
     ------------------------------------------------------------------ */
  const ISSUE_GROUPS = [
    { key: 'no_rider', label: 'No rider', tone: 'warning', blurb: 'Ready and still unclaimed', link: 'View order' },
    { key: 'delayed', label: 'Delayed', tone: 'warning', blurb: 'Flagged by the kitchen', link: 'View order' },
    { key: 'cancelled', label: 'Cancelled', tone: 'neutral', blurb: 'Last 24 hours', link: 'View order' },
    { key: 'sold_out', label: 'Sold out', tone: 'neutral', blurb: 'Hidden from customers', link: 'Open menu' },
    { key: 'address', label: 'Address needs checking', tone: 'danger', blurb: 'Incomplete delivery details', link: 'View order' },
  ];

  function issueCard(issue, group) {
    const order = issue.order;
    const link = order ? '/merchant/orders/' + order.id : (issue.kind === 'sold_out' ? '/merchant/menu' : '/merchant/issues');
    return '<article class="m-issue-card m-issue-card--' + toneForSeverity(issue.severity) + '">' +
      '<div class="m-issue-card__top">' +
      '<span class="m-issue-card__label">' + esc(issue.label) + '</span>' +
      '<span class="m-help">' + esc(order ? dateTime(order.created_at) : 'Menu') + '</span>' +
      '</div>' +
      '<div class="m-issue-card__detail">' + esc(issue.detail) + '</div>' +
      '<div class="m-issue-card__foot">' +
      '<span class="num">' + esc(order ? order.order_no : 'Menu') + '</span>' +
      '<a class="m-link" href="' + link + '">' + (group ? group.link : 'Open') + ' →</a>' +
      '</div></article>';
  }

  function issueHintsHTML() {
    const hint = (label, tone, body, linkLabel, href, linkId) =>
      '<div class="m-issue-hint">' +
      '<span class="m-chip m-chip--' + tone + '">' + esc(label) + '</span>' +
      '<div class="m-help">' + esc(body) + '</div>' +
      '<a class="m-link" href="' + href + '"' + (linkId ? ' id="' + linkId + '"' : '') + '>' +
      esc(linkLabel) + ' →</a></div>';
    return '<section class="m-card m-issue-hints">' +
      '<div class="m-card__head"><div class="m-card__title">Keeping the queue healthy</div>' +
      '<span class="m-meta">Issues clear themselves as orders move on</span></div>' +
      '<div class="m-issue-hints__grid">' +
      hint('No rider yet', 'warning',
        'Mark an order ready only once it is packed — riders can claim it from that moment.',
        'Open the order board', '/merchant/orders', 'issue-hint-board') +
      hint('Delayed', 'neutral',
        'Flag a delay on the order card so the customer sees the new estimate straight away.',
        'Open the order board', '/merchant/orders', 'issue-hint-board-2') +
      hint('Sold out', 'danger',
        'Restock or re-list the dish so it stops showing as unavailable on the storefront.',
        'Open the menu', '/merchant/menu', 'issue-hint-menu') +
      '</div></section>';
  }

  function initIssues() {
    const app = $('#issues-app');
    if (!app) return;
    let filter = 'all';
    let issues = [];
    let counts = { total: 0, no_rider: 0, delayed: 0, cancelled: 0, sold_out: 0 };

    function groups() {
      const addressCount = issues.filter((issue) => issue.kind === 'address').length;
      return ISSUE_GROUPS.filter((group) => group.key !== 'address' || addressCount > 0);
    }

    function tile(group, count, active) {
      return '<button class="m-tile m-tile--' + group.tone + (active ? ' is-active' : '') +
        '" type="button" data-kind="' + group.key + '">' +
        '<span class="m-tile__label">' + esc(group.label) + '</span>' +
        '<span class="m-tile__num">' + count + '</span>' +
        '<span class="m-help">' + esc(group.blurb) + '</span></button>';
    }

    function renderGroups() {
      const container = $('#issue-groups');
      if (!container) return;
      const list = groups()
        .filter((group) => filter === 'all' || group.key === filter)
        .map((group) => ({ group, rows: issues.filter((issue) => issue.kind === group.key) }))
        .filter((entry) => entry.rows.length > 0);
      if (!list.length) {
        const emptyTitle = issues.length ? 'Nothing in this view' : 'No issues right now';
        const emptyDesc = issues.length
          ? 'Pick another category or wait for the next refresh.'
          : 'Unclaimed orders, delays, cancellations and sold-out dishes will be collected here.';
        container.innerHTML = '<div class="m-card" style="margin-top:16px">' +
          emptyHTML(emptyTitle, emptyDesc) + '</div>' + issueHintsHTML();
        return;
      }
      container.innerHTML = list.map((entry) => {
        const group = entry.group;
        return '<section class="m-issue-group">' +
          '<div class="m-issue-group__head">' +
          '<span class="m-issue-group__title">' + esc(group.label) + '</span>' +
          '<span class="m-count">' + entry.rows.length + '</span>' +
          '<span class="m-help">' + esc(group.blurb) + '</span></div>' +
          '<div class="m-issues-grid">' +
          entry.rows.map((issue) => issueCard(issue, group)).join('') +
          '</div></section>';
      }).join('');
      if (list.length <= 2) {
        container.insertAdjacentHTML('beforeend', issueHintsHTML());
      }
    }

    function renderTiles() {
      const container = $('#issue-tiles');
      if (!container) return;
      const addressCount = issues.filter((issue) => issue.kind === 'address').length;
      const allGroup = { key: 'all', label: 'All issues', tone: 'neutral', blurb: 'Everything open right now' };
      container.innerHTML =
        '<button class="m-tile m-tile--neutral' + (filter === 'all' ? ' is-active' : '') +
        '" type="button" data-kind="all">' +
        '<span class="m-tile__label">All issues</span><span class="m-tile__num">' + counts.total + '</span>' +
        '<span class="m-help">Everything open right now</span></button>' +
        ISSUE_GROUPS.slice(0, 4).map((group) =>
          tile(group, counts[group.key] || 0, filter === group.key)).join('') +
        (addressCount
          ? tile(ISSUE_GROUPS[4], addressCount, filter === 'address')
          : '');
      if (filter === 'all') {
        const first = container.querySelector('[data-kind="all"]');
        if (first) first.classList.add('is-active');
      }
    }

    async function load(showLoading) {
      if (showLoading) app.innerHTML = loadingHTML('Loading issues\u2026');
      try {
        const data = await api('/api/merchant/issues');
        issues = data.issues || [];
        counts = data.counts || counts;
        render(showLoading);
        fillStrip([
          counts.total + ' open issues',
          (counts.no_rider || 0) + ' without a rider',
          (counts.delayed || 0) + ' delayed',
          (counts.cancelled || 0) + ' cancelled today',
        ]);
      } catch (err) {
        showError(app, err, () => load(true));
      }
    }

    function render() {
      app.innerHTML =
        '<div class="m-tiles m-tiles--auto" id="issue-tiles"></div>' +
        '<div id="issue-groups"></div>';
      const container = $('#issue-tiles');
      if (container) {
        container.addEventListener('click', (event) => {
          const button = event.target.closest('button[data-kind]');
          if (!button) return;
          filter = button.dataset.kind;
          renderTiles();
          renderGroups();
        });
      }
      renderTiles();
      renderGroups();
    }

    const refresh = $('#issues-refresh');
    if (refresh) refresh.addEventListener('click', () => load(false));
    load(true);
  }

  /* ------------------------------------------------------------------
     路由
     ------------------------------------------------------------------ */
  function start() {
    const page = document.body.dataset.page || '';
    const auth = document.body.dataset.auth || '';

    if (auth === 'login') { initLogin(); return; }
    if (auth === 'register') { initRegister(); return; }
    if (page === 'setup') { initSetup(); return; }

    initChrome();

    if (page === 'dashboard') initDashboard();
    else if (page === 'orders') initOrders();
    else if (page === 'menu') initMenu();
    else if (page === 'settings') initSettings();
    else if (page === 'analytics') initAnalytics();
    else if (page === 'issues') initIssues();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
