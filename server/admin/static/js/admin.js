/* ============================================================
   管理大屏 · 交互
   ────────────────────────────────────────────────────────────
   没有框架、没有图表库：整块墙的数据量很小（几十条订单），
   一次 /api/admin/overview 全部取回，然后在浏览器里画。
   图表用原生 SVG 手写 —— 少一个依赖，答辩时也解释得清每一根线。
   ────────────────────────────────────────────────────────────
   结构
     1. 工具函数（格式化 / DOM）
     2. 拉取与调度（10s 轮询、暂停、失败降级）
     3. 渲染（KPI / 趋势 / 流水 / 状态 / 告警 / 门店 / 骑手 / 热销）
     4. 订单抽屉
     5. 事件绑定与启动
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.XLLM_ADMIN || {};
  var REFRESH_MS = 10000;
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = {
    win: 'today',
    paused: false,
    busy: false,
    data: null,
    seen: new Set(),
    firstPaint: true,
    orderId: null,
    timer: null
  };

  /* ==========================================================
     1. 工具
     ========================================================== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(value, digits) {
    var d = digits === undefined ? 0 : digits;
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function money(value, cents) {
    return '¥' + num(value, cents ? 2 : 0);
  }

  function pct(value) {
    return num(value, 1) + '%';
  }

  function minutes(value) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return '—';
    if (n < 60) return Math.round(n) + ' min';
    var h = Math.floor(n / 60), m = Math.round(n % 60);
    return h + 'h' + (m ? ' ' + String(m).padStart(2, '0') : '');
  }

  function ago(min) {
    if (min === null || min === undefined) return '—';
    if (min < 1) return 'now';
    if (min < 60) return min + 'm';
    var h = Math.floor(min / 60), m = min % 60;
    return h + 'h' + (m ? String(m).padStart(2, '0') : '');
  }

  function hhmm(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function dayLabel(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
  }

  function toast(message, tone) {
    var node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.dataset.tone = tone || '';
    node.classList.add('is-on');
    clearTimeout(node._t);
    node._t = setTimeout(function () { node.classList.remove('is-on'); }, 3200);
  }

  /* ==========================================================
     2. 拉取与调度
     ========================================================== */
  function setLive(kind) {
    var pill = $('#live-pill');
    if (!pill) return;
    pill.dataset.state = kind;
    var label = $('#live-label');
    if (!label) return;
    if (kind === 'error') label.textContent = 'Offline — retrying';
    else if (state.paused) label.textContent = 'Paused';
    else label.textContent = 'Live ' + (REFRESH_MS / 1000) + 's';
  }

  function setBusy(busy) {
    var btn = $('#refresh-btn');
    if (btn) btn.classList.toggle('is-spinning', !!busy);
  }

  function load() {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    setBusy(true);

    return fetch(CFG.overview + '?window=' + encodeURIComponent(state.win), {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    })
      .then(function (res) {
        if (res.status === 401) {
          window.location.href = CFG.login + '?next=' + encodeURIComponent('/admin/');
          return null;
        }
        return res.json().then(function (body) {
          if (!res.ok || !body.ok) throw new Error(body.error || ('HTTP ' + res.status));
          render(body.data);
          setLive('live');
          return body.data;
        });
      })
      .catch(function (err) {
        setLive('error');
        toast('Refresh failed — ' + (err && err.message ? err.message : 'network'), 'bad');
      })
      .then(function () {
        state.busy = false;
        state.firstPaint = false;
        setBusy(false);
      });
  }

  function schedule() {
    clearTimeout(state.timer);
    if (state.paused) return;
    state.timer = setTimeout(function () {
      if (document.hidden) { schedule(); return; }
      load().then(schedule);
    }, REFRESH_MS);
  }

  /* ==========================================================
     3. 渲染
     ========================================================== */
  function render(data) {
    state.data = data;
    renderKpis(data);
    drawTrend(data.trend);
    renderFeed(data.live);
    renderMix(data.status_mix, data.kpis);
    renderAlerts(data.alerts);
    renderStores(data.restaurants);
    renderRiders(data.riders);
    renderTop(data.top_items);

    $$('[data-window-tag]').forEach(function (node) {
      node.textContent = data.window.label.toLowerCase();
    });

    var engine = $('#foot-engine');
    if (engine) engine.textContent = data.meta.engine + ' · py' + data.meta.python + ' · ' + data.meta.host;
    var orders = $('#foot-orders');
    if (orders) {
      orders.textContent = num(data.meta.orders_total) + ' orders · ' +
        data.meta.customers + ' customers · ' + data.meta.riders + ' riders';
    }
    var updated = $('#foot-updated');
    if (updated) updated.textContent = 'updated ' + hhmm(data.generated_at) + ':' +
      String(new Date(data.generated_at).getSeconds()).padStart(2, '0');
  }

  function setKpi(id, value, opts) {
    var node = document.getElementById(id);
    if (!node) return;
    var o = opts || {};
    var target = Number(value) || 0;
    var from = node.dataset.value === undefined ? 0 : Number(node.dataset.value);
    node.dataset.value = target;

    var paint = function (v) {
      return (o.prefix ? '<small>' + esc(o.prefix) + '</small>' : '') +
        num(v, o.decimals || 0) +
        (o.suffix ? '<small>' + esc(o.suffix) + '</small>' : '');
    };

    if (REDUCED || state.firstPaint || from === target) {
      node.innerHTML = paint(target);
      return;
    }
    cancelAnimationFrame(node._raf);
    var start = performance.now();
    var tick = function (now) {
      var p = Math.min((now - start) / 520, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      node.innerHTML = paint(from + (target - from) * eased);
      if (p < 1) node._raf = requestAnimationFrame(tick);
    };
    node._raf = requestAnimationFrame(tick);
  }

  function setChip(id, delta, invert) {
    var node = document.getElementById(id);
    if (!node) return;
    if (delta === null || delta === undefined) {
      node.textContent = '—';
      node.dataset.tone = 'flat';
      return;
    }
    var good = invert ? delta < 0 : delta > 0;
    node.dataset.tone = delta === 0 ? 'flat' : (good ? 'good' : 'bad');
    node.textContent = (delta > 0 ? '▲ ' : delta < 0 ? '▼ ' : '· ') + num(Math.abs(delta), 1) + '%';
  }

  function renderKpis(data) {
    var k = data.kpis;

    setKpi('kpi-orders', k.orders);
    setChip('kpi-orders-delta', k.orders_delta, false);
    var ordersNote = $('#kpi-orders-note');
    if (ordersNote) ordersNote.textContent = 'vs previous period';

    setKpi('kpi-gross', k.gross, { prefix: '¥' });
    setChip('kpi-gross-delta', k.gross_delta, false);
    var grossNote = $('#kpi-gross-note');
    if (grossNote) grossNote.textContent = 'avg basket ' + money(k.avg_order, true);

    setKpi('kpi-active', k.active);
    var activeNote = $('#kpi-active-note');
    if (activeNote) {
      var bits = [];
      if (k.unassigned) bits.push(k.unassigned + ' waiting for a rider');
      if (k.late) bits.push(k.late + ' past ETA');
      if (k.delayed) bits.push(k.delayed + ' flagged late');
      activeNote.textContent = bits.length ? bits.join(' · ') : 'nothing stuck right now';
    }

    setKpi('kpi-delivered', k.delivered);
    var deliveredNote = $('#kpi-delivered-note');
    if (deliveredNote) deliveredNote.textContent = 'completion ' + pct(k.completion);

    setKpi('kpi-cancel', k.cancel_rate, { decimals: 1, suffix: '%' });
    var cancelNote = $('#kpi-cancel-note');
    if (cancelNote) cancelNote.textContent = k.cancelled + ' cancelled';

    setKpi('kpi-delivery', k.avg_delivery_minutes, { decimals: 0, suffix: ' min' });
    var deliveryNote = $('#kpi-delivery-note');
    if (deliveryNote) deliveryNote.textContent = 'kitchen ' + minutes(k.avg_prep_minutes);
  }

  /* ---------- 趋势图：手写 SVG ---------- */
  // 轴线取整：刻度数固定 4 段，先求每段步长再向上取整到 1/1.5/2/2.5/3/4/5/6/8/10，
  // 这样"订单数"这条轴永远是整数刻度，不会出现 2.5 单这种读数。
  function niceTop(value, lines) {
    var raw = Math.max(value, 1);
    var unit = Math.ceil(raw / lines);
    var mag = Math.pow(10, Math.floor(Math.log10(unit)));
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) {
      if (unit <= steps[i] * mag) { unit = steps[i] * mag; break; }
    }
    return unit * lines;
  }

  function svgNode(name, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  function drawTrend(trend) {
    var wrap = $('#trend-wrap');
    var svg = $('#trend-chart');
    if (!wrap || !svg || !trend || !trend.length) return;

    var w = wrap.clientWidth;
    var h = wrap.clientHeight;
    if (w < 60 || h < 60) return;

    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var pad = { l: 30, r: 44, t: 12, b: 20 };
    var plotW = Math.max(w - pad.l - pad.r, 10);
    var plotH = Math.max(h - pad.t - pad.b, 10);
    var n = trend.length;

    var maxOrders = Math.max.apply(null, trend.map(function (b) { return b.orders; }).concat([1]));
    var maxRevenue = Math.max.apply(null, trend.map(function (b) { return b.revenue; }).concat([1]));
    var topOrders = niceTop(maxOrders, 4);
    var topRevenue = niceTop(maxRevenue, 4);

    var yOrders = function (v) { return pad.t + plotH - (v / topOrders) * plotH; };
    var yRevenue = function (v) { return pad.t + plotH - (v / topRevenue) * plotH; };
    var band = plotW / n;
    var cx = function (i) { return pad.l + band * (i + 0.5); };
    var barW = Math.max(Math.min(band * 0.52, 26), 3);

    /* 面积渐变 */
    var defs = svgNode('defs', {});
    var grad = svgNode('linearGradient', { id: 'a-area-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(svgNode('stop', { offset: '0', 'stop-color': '#5B9BFF', 'stop-opacity': '.34' }));
    grad.appendChild(svgNode('stop', { offset: '1', 'stop-color': '#5B9BFF', 'stop-opacity': '0' }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    /* 横向网格 + 左右刻度 */
    var lines = 4;
    for (var g = 0; g <= lines; g++) {
      var y = pad.t + (plotH / lines) * g;
      svg.appendChild(svgNode('line', {
        class: 'a-chart__grid', x1: pad.l, y1: y, x2: pad.l + plotW, y2: y
      }));
      var leftLabel = svgNode('text', {
        class: 'a-chart__axis', x: pad.l - 6, y: y + 3, 'text-anchor': 'end'
      });
      leftLabel.textContent = num(topOrders - (topOrders / lines) * g);
      svg.appendChild(leftLabel);

      if (g % 2 === 0) {
        var rightLabel = svgNode('text', {
          class: 'a-chart__axis', x: pad.l + plotW + 6, y: y + 3, 'text-anchor': 'start'
        });
        rightLabel.textContent = topRevenue - (topRevenue / lines) * g >= 1000
          ? Math.round((topRevenue - (topRevenue / lines) * g) / 1000) + 'k'
          : num(topRevenue - (topRevenue / lines) * g);
        svg.appendChild(rightLabel);
      }
    }

    /* x 轴标签：按宽度抽稀 */
    var step = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(plotW / 58))));
    trend.forEach(function (bucket, i) {
      if (i % step !== 0) return;
      var label = svgNode('text', {
        class: 'a-chart__axis', x: cx(i), y: pad.t + plotH + 13, 'text-anchor': 'middle'
      });
      label.textContent = n <= 8 ? bucket.short : bucket.label;
      svg.appendChild(label);
    });

    /* 柱子（订单数） */
    var bars = [];
    trend.forEach(function (bucket, i) {
      if (bucket.future) {
        svg.appendChild(svgNode('rect', {
          class: 'a-chart__bar a-chart__bar--future',
          x: cx(i) - barW / 2, y: pad.t + plotH - 2, width: barW, height: 2, rx: 1
        }));
        return;
      }
      var top = yOrders(bucket.orders);
      var height = Math.max(pad.t + plotH - top, bucket.orders ? 2 : 0);
      var bar = svgNode('rect', {
        class: 'a-chart__bar', x: cx(i) - barW / 2, y: pad.t + plotH - height,
        width: barW, height: height, rx: barW > 8 ? 1 : 0
      });
      svg.appendChild(bar);
      bars.push(bar);
    });

    /* 折线（营收）+ 面积 */
    var solid = trend.filter(function (b) { return !b.future; });
    if (solid.length > 1) {
      var points = solid.map(function (bucket) {
        return [cx(trend.indexOf(bucket)), yRevenue(bucket.revenue)];
      });
      var line = points.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var area = line +
        ' L' + points[points.length - 1][0].toFixed(1) + ' ' + (pad.t + plotH).toFixed(1) +
        ' L' + points[0][0].toFixed(1) + ' ' + (pad.t + plotH).toFixed(1) + ' Z';

      svg.appendChild(svgNode('path', { class: 'a-chart__area', d: area }));
      svg.appendChild(svgNode('path', { class: 'a-chart__line', d: line }));
    }

    /* 悬浮：一条竖线 + 提示框 */
    var tip = $('#trend-tip');
    var guide = svgNode('line', {
      class: 'a-chart__guide', x1: 0, y1: pad.t, x2: 0, y2: pad.t + plotH,
      opacity: 0
    });
    svg.appendChild(guide);

    var dot = svgNode('circle', { class: 'a-chart__dot', r: 3, opacity: 0 });
    svg.appendChild(dot);

    var hit = svgNode('rect', {
      x: pad.l, y: pad.t, width: plotW, height: plotH, fill: 'transparent'
    });
    svg.appendChild(hit);

    function showAt(index) {
      var bucket = trend[index];
      if (!bucket) return;
      var x = cx(index);
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      guide.setAttribute('opacity', '.9');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', yRevenue(bucket.revenue));
      dot.setAttribute('opacity', bucket.revenue ? '.95' : '0');
      bars.forEach(function (bar, i) {
        bar.classList.toggle('a-chart__bar--hover', i === index);
      });
      if (tip) {
        tip.innerHTML =
          '<div class="a-tip__head">' + esc(n <= 8 ? bucket.label : bucket.label) + '</div>' +
          '<div>Orders <b>' + bucket.orders + '</b></div>' +
          '<div>Revenue <b>' + money(bucket.revenue) + '</b></div>' +
          '<div>Delivered <b>' + bucket.delivered + '</b></div>';
        tip.style.left = Math.min(Math.max(x, 60), w - 60) + 'px';
        tip.style.top = pad.t + 4 + 'px';
        tip.classList.add('is-on');
      }
    }

    function hide() {
      guide.setAttribute('opacity', '0');
      dot.setAttribute('opacity', '0');
      bars.forEach(function (bar) { bar.classList.remove('a-chart__bar--hover'); });
      if (tip) tip.classList.remove('is-on');
    }

    hit.addEventListener('mousemove', function (event) {
      var box = svg.getBoundingClientRect();
      var x = event.clientX - box.left;
      var index = Math.floor((x - pad.l) / band);
      index = Math.max(0, Math.min(index, n - 1));
      showAt(index);
    });
    hit.addEventListener('mouseleave', hide);

    /* 卡片右上角：峰值 */
    var peak = trend.reduce(function (best, bucket) {
      return bucket.orders > best.orders ? bucket : best;
    }, trend[0]);
    var peakNode = $('#trend-peak');
    if (peakNode) {
      peakNode.textContent = peak.orders
        ? 'peak ' + peak.orders + ' at ' + peak.label
        : 'no orders in this window';
    }
  }

  /* ---------- 实时流水 ---------- */
  function renderFeed(rows) {
    var box = $('#feed');
    if (!box) return;

    var activeCount = rows.filter(function (r) { return r.active; }).length;
    var meta = $('#feed-meta');
    if (meta) meta.textContent = activeCount + ' in progress · ' + rows.length + ' shown';

    if (!rows.length) {
      box.innerHTML = '<div class="a-empty"><span class="a-empty__mark">◦</span>No orders yet</div>';
      return;
    }

    box.innerHTML = rows.map(function (row) {
      var isNew = !state.firstPaint && !state.seen.has(row.id);
      var flags = [];
      if (row.late) flags.push('<span class="a-feed__flag a-feed__flag--late">past ETA</span>');
      else if (row.delayed) flags.push('<span class="a-feed__flag">delay</span>');
      if (row.status === 'ready' && !row.rider) flags.push('<span class="a-feed__flag">no rider</span>');

      return '' +
        '<div class="a-feed__row' + (isNew ? ' is-new' : '') + '" data-order-id="' + row.id + '" role="button" tabindex="0">' +
          '<span class="a-feed__time">' + esc(hhmm(row.created_at)) + '</span>' +
          '<div class="a-feed__main">' +
            '<div class="a-feed__no">' + esc(row.order_no) +
              '<span class="a-pill" data-status="' + esc(row.status) + '">' + esc(row.status_label) + '</span>' +
            '</div>' +
            '<div class="a-feed__sub">' + esc(row.restaurant) + ' · ' + esc(row.customer) +
              ' · ' + row.item_count + ' item' + (row.item_count === 1 ? '' : 's') +
              (row.rider ? ' · ' + esc(row.rider) : '') +
            '</div>' +
          '</div>' +
          '<div class="a-feed__right">' +
            '<span class="a-feed__total">' + money(row.total, true) + '</span>' +
            (flags.length ? flags.join(' ') : '<span class="a-feed__flag" style="color:var(--a-text-3)">' + ago(row.age_minutes) + '</span>') +
          '</div>' +
        '</div>';
    }).join('');

    rows.forEach(function (row) { state.seen.add(row.id); });
  }

  /* ---------- 状态分布 ---------- */
  function renderMix(mix, kpis) {
    var bar = $('#mix-bar');
    var list = $('#mix-list');
    var meta = $('#mix-meta');
    if (!bar || !list) return;

    if (!mix.length) {
      bar.innerHTML = '';
      list.innerHTML = '<div class="a-empty">No orders in this window</div>';
      if (meta) meta.textContent = '0 orders';
      return;
    }

    bar.innerHTML = mix.map(function (row) {
      return '<span class="a-mix__seg" data-status="' + esc(row.status) + '" style="width:' +
        Math.max(row.share, 1.5) + '%" title="' + esc(row.label) + ' ' + row.count + '"></span>';
    }).join('');

    list.innerHTML = mix.map(function (row) {
      return '' +
        '<div class="a-mix__row">' +
          '<span class="a-mix__dot" data-status="' + esc(row.status) + '"></span>' +
          '<span class="a-mix__name">' + esc(row.label) + '</span>' +
          '<span class="a-mix__count">' + row.count + '</span>' +
          '<span class="a-mix__share">' + pct(row.share) + '</span>' +
        '</div>';
    }).join('');

    if (meta) {
      meta.textContent = (kpis ? kpis.orders : mix.reduce(function (s, r) { return s + r.count; }, 0)) +
        ' orders · ' + mix.length + ' states';
    }
  }

  /* ---------- 告警 ---------- */
  function renderAlerts(alerts) {
    var box = $('#alerts');
    var meta = $('#alerts-meta');
    if (!box) return;

    var critical = alerts.filter(function (a) { return a.severity === 'critical'; }).length;
    var warn = alerts.filter(function (a) { return a.severity === 'warn'; }).length;
    if (meta) meta.textContent = alerts.length
      ? critical + ' critical · ' + warn + ' warning'
      : 'all clear';

    if (!alerts.length) {
      box.innerHTML = '<div class="a-empty"><span class="a-empty__mark">✓</span>Nothing needs a human right now</div>';
      return;
    }

    box.innerHTML = alerts.map(function (alert) {
      var clickable = alert.order_id ? ' a-alert--clickable' : '';
      return '' +
        '<div class="a-alert' + clickable + '" data-severity="' + esc(alert.severity) + '"' +
          (alert.order_id ? ' data-order-id="' + alert.order_id + '" role="button" tabindex="0"' : '') + '>' +
          '<div class="a-alert__title">' + esc(alert.title) + '</div>' +
          '<div class="a-alert__detail">' + esc(alert.detail) + '</div>' +
          (alert.age_minutes !== null && alert.age_minutes !== undefined
            ? '<div class="a-alert__age">' + ago(alert.age_minutes) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  /* ---------- 门店 ---------- */
  function renderStores(stores) {
    var body = $('#stores-body');
    var meta = $('#stores-meta');
    if (!body) return;

    var accepting = stores.filter(function (s) { return s.accepting; }).length;
    if (meta) meta.textContent = accepting + '/' + stores.length + ' accepting orders';

    if (!stores.length) {
      body.innerHTML = '<tr><td colspan="8"><div class="a-empty">No restaurants</div></td></tr>';
      return;
    }

    body.innerHTML = stores.map(function (store) {
      var loadPct = store.capacity ? Math.min(Math.round(store.load / store.capacity * 100), 100) : 0;
      var level = loadPct >= 100 ? 'full' : loadPct >= 70 ? 'warn' : '';
      return '' +
        '<tr class="' + (store.accepting ? '' : 'is-dim') + '">' +
          '<td>' +
            '<div class="a-store__name">' + esc(store.name) +
              (store.cuisine ? '<span class="a-store__cuisine">' + esc(store.cuisine) + '</span>' : '') +
            '</div>' +
          '</td>' +
          '<td>' +
            '<span class="a-store__state" data-state="' + esc(store.state) + '" title="' + esc(store.detail) + '">' +
              '<i class="a-store__dot"></i>' + esc(store.state_label) +
            '</span>' +
          '</td>' +
          '<td>' +
            '<span class="a-load">' +
              '<span class="a-load__track"><i class="a-load__fill" data-level="' + level + '" style="width:' + loadPct + '%"></i></span>' +
              '<span class="a-num">' + store.load + '/' + store.capacity + '</span>' +
            '</span>' +
          '</td>' +
          '<td class="a-num' + (store.queue > 0 ? '' : ' a-muted') + '">' + store.queue + '</td>' +
          '<td class="a-num">' + store.orders + '</td>' +
          '<td class="a-num">' + money(store.revenue) + '</td>' +
          '<td class="a-num">' + (store.rating === null ? '<span class="a-muted">—</span>' :
            store.rating + ' <span class="a-muted">(' + store.review_count + ')</span>') + '</td>' +
          '<td class="a-num' + (store.cancel_rate > 15 ? ' ' : ' a-muted') + '"' +
            (store.cancel_rate > 15 ? ' style="color:var(--a-red)"' : '') + '>' + pct(store.cancel_rate) + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ---------- 骑手 ---------- */
  function renderRiders(riders) {
    var body = $('#riders-body');
    var meta = $('#riders-meta');
    if (!body) return;

    var online = riders.filter(function (r) { return r.online; }).length;
    var delivering = riders.reduce(function (s, r) { return s + r.delivering; }, 0);
    if (meta) meta.textContent = online + '/' + riders.length + ' on shift · ' + delivering + ' in hand';

    if (!riders.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="a-empty">No riders</div></td></tr>';
      return;
    }

    body.innerHTML = riders.map(function (rider) {
      var stale = rider.online && rider.ping_age !== null && rider.ping_age >= 10;
      return '' +
        '<tr class="' + (rider.online ? '' : 'is-dim') + '">' +
          '<td><div class="a-rider__name"><i class="a-rider__dot" data-online="' + (rider.online ? '1' : '0') + '"></i>' +
            esc(rider.name) + '<span class="a-store__cuisine">' + esc(rider.vehicle) + '</span></div></td>' +
          '<td class="a-num">' + (rider.online ? 'on' : 'off') + '</td>' +
          '<td class="a-num' + (rider.delivering ? '' : ' a-muted') + '">' + rider.delivering + '</td>' +
          '<td class="a-num">' + rider.done + '</td>' +
          '<td class="a-num">' + (rider.avg_minutes ? rider.avg_minutes + 'm' : '<span class="a-muted">—</span>') + '</td>' +
          '<td class="a-num' + (rider.on_time_rate >= 80 ? '' : ' a-muted') + '">' +
            (rider.done ? pct(rider.on_time_rate) : '<span class="a-muted">—</span>') + '</td>' +
          '<td class="a-num"' + (stale ? ' style="color:var(--a-amber)"' : '') + '>' +
            (rider.ping_age === null ? '<span class="a-muted">no signal</span>' : ago(rider.ping_age) + ' ago') + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ---------- 热销 ---------- */
  function renderTop(items) {
    var box = $('#top-items');
    var meta = $('#top-meta');
    if (!box) return;

    if (!items.length) {
      box.innerHTML = '<div class="a-empty">No dishes sold in this window</div>';
      if (meta) meta.textContent = '';
      return;
    }

    var max = Math.max.apply(null, items.map(function (i) { return i.quantity; }));
    if (meta) meta.textContent = 'by quantity';

    box.innerHTML = items.map(function (item) {
      return '' +
        '<div class="a-top-row" title="' + esc(item.name) + ' · ' + money(item.revenue, true) + '">' +
          '<span class="a-top-row__emoji">' + esc(item.emoji || '🍽') + '</span>' +
          '<span class="a-top-row__name">' + esc(item.name) + '</span>' +
          '<span class="a-top-row__qty">' + item.quantity + '×</span>' +
          '<span class="a-top-row__track"><i class="a-top-row__fill" style="width:' +
            Math.max(Math.round(item.quantity / max * 100), 4) + '%"></i></span>' +
        '</div>';
    }).join('');
  }

  /* ==========================================================
     4. 订单抽屉
     ========================================================== */
  function openDrawer(id) {
    var drawer = $('#drawer');
    var scrim = $('#scrim');
    if (!drawer || !scrim) return;

    state.orderId = id;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
    requestAnimationFrame(function () { scrim.classList.add('is-open'); });

    $('#drawer-no').textContent = 'Loading…';
    $('#drawer-sub').textContent = '';
    $('#drawer-body').innerHTML =
      '<div class="a-drawer__loading">' +
        '<span class="a-skeleton" style="width:60%"></span>' +
        '<span class="a-skeleton" style="width:90%"></span>' +
        '<span class="a-skeleton" style="width:75%"></span>' +
        '<span class="a-skeleton" style="width:85%"></span>' +
      '</div>';

    loadOrder(id);
  }

  function loadOrder(id) {
    return fetch((CFG.order + id), {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    })
      .then(function (res) {
        if (res.status === 401) { window.location.href = CFG.login; return null; }
        return res.json().then(function (body) {
          if (!res.ok || !body.ok) throw new Error(body.error || ('HTTP ' + res.status));
          paintOrder(body.data);
        });
      })
      .catch(function (err) {
        $('#drawer-body').innerHTML = '<div class="a-empty">Could not load this order<br>' + esc(err.message) + '</div>';
      });
  }

  function paintOrder(order) {
    var drawerNo = $('#drawer-no');
    var drawerSub = $('#drawer-sub');
    if (drawerNo) drawerNo.textContent = order.order_no;
    if (drawerSub) {
      drawerSub.innerHTML = '<span class="a-pill" data-status="' + esc(order.status) + '">' +
        esc(order.status_label || order.status) + '</span> ' +
        esc(order.restaurant ? order.restaurant.name : '—') + ' · ' + ago(order.age_minutes) + ' ago';
    }

    var minutesBlock = order.minutes || {};
    var rider = order.rider || {};
    var customer = order.customer || {};
    var delivery = order.delivery || {};

    var timeline = (order.timeline || []).map(function (step) {
      return '' +
        '<div class="a-timeline__step" data-state="' + esc(step.state) + '">' +
          '<i class="a-timeline__dot"></i>' +
          '<span>' + esc(step.label) + '</span>' +
          '<span class="a-timeline__when">' + (step.at ? hhmm(step.at) : '—') + '</span>' +
        '</div>';
    }).join('');

    var items = (order.items || []).map(function (item) {
      return '' +
        '<div class="a-line-item">' +
          '<div>' +
            '<div class="a-line-item__name">' + esc(item.name) + '</div>' +
            '<div class="a-line-item__qty">' + item.quantity + ' × ' + money(item.unit_price, true) + '</div>' +
          '</div>' +
          '<div class="a-line-item__sum">' + money(item.subtotal, true) + '</div>' +
        '</div>';
    }).join('');

    var reviews = (order.reviews || []).map(function (review) {
      return '<div class="a-line-item">' +
        '<div class="a-line-item__name">' + '★'.repeat(review.rating) + ' <span class="a-line-item__qty">' +
        esc(review.target_type) + '</span></div>' +
        '<div class="a-line-item__sum" style="color:var(--a-text-3);font-size:11px">' +
        esc(review.reviewer_name) + '</div></div>';
    }).join('');

    var body = '' +
      '<div class="a-block">' +
        '<div class="a-block__title">Progress</div>' +
        '<div class="a-timeline">' + timeline + '</div>' +
      '</div>' +

      '<div class="a-block">' +
        '<div class="a-block__title">Parties</div>' +
        '<dl class="a-kv">' +
          '<dt>Customer</dt><dd>' + esc(customer.name || '—') +
            (customer.phone ? ' · ' + esc(customer.phone) : '') + '</dd>' +
          '<dt>Kitchen</dt><dd>' + esc(order.restaurant ? order.restaurant.name : '—') +
            (order.restaurant && order.restaurant.phone ? ' · ' + esc(order.restaurant.phone) : '') + '</dd>' +
          '<dt>Rider</dt><dd>' + (rider.name
            ? esc(rider.name) + (rider.phone ? ' · ' + esc(rider.phone) : '')
            : '<span style="color:var(--a-amber)">not assigned yet</span>') + '</dd>' +
          '<dt>Payment</dt><dd>' + esc(order.payment_status) + '</dd>' +
        '</dl>' +
      '</div>' +

      '<div class="a-block">' +
        '<div class="a-block__title">Timings</div>' +
        '<dl class="a-kv">' +
          '<dt>Accept</dt><dd>' + (minutesBlock.to_accept !== null && order.accepted_at
            ? minutesBlock.to_accept + ' min after placing' : '—') + '</dd>' +
          '<dt>Kitchen</dt><dd>' + (minutesBlock.prep ? minutesBlock.prep + ' min' : '—') + '</dd>' +
          '<dt>Delivery</dt><dd>' + (minutesBlock.to_deliver ? minutesBlock.to_deliver + ' min' : '—') + '</dd>' +
          '<dt>Door to door</dt><dd>' + (minutesBlock.total ? minutesBlock.total + ' min' : '—') + '</dd>' +
          '<dt>Promised</dt><dd>' + (order.estimated_delivery_at ? hhmm(order.estimated_delivery_at) : '—') +
            (order.is_delayed ? ' <span class="a-feed__flag">delay flagged</span>' : '') + '</dd>' +
        '</dl>' +
      '</div>' +

      '<div class="a-block">' +
        '<div class="a-block__title">Delivery</div>' +
        '<dl class="a-kv">' +
          '<dt>Address</dt><dd>' + esc(delivery.address_text || '—') + '</dd>' +
          '<dt>Contact</dt><dd>' + esc(delivery.contact_name || '—') +
            (delivery.contact_phone ? ' · ' + esc(delivery.contact_phone) : '') + '</dd>' +
          '<dt>Distance</dt><dd>' + (order.distance_km !== null && order.distance_km !== undefined
            ? order.distance_km + ' km' : '—') + '</dd>' +
          '<dt>Rider last ping</dt><dd>' + (order.rider_location
            ? hhmm(order.rider_location.recorded_at) +
              (order.rider_distance_km ? ' · ' + order.rider_distance_km + ' km from kitchen' : '')
            : 'no position reports') + '</dd>' +
          '<dt>Note</dt><dd>' + esc(order.remark || '—') + '</dd>' +
          (order.cancel_reason ? '<dt>Cancel reason</dt><dd>' + esc(order.cancel_reason) +
            ' (' + esc(order.cancelled_by) + ')</dd>' : '') +
        '</dl>' +
      '</div>' +

      '<div class="a-block">' +
        '<div class="a-block__title">Items · ' + (order.item_count || 0) + '</div>' +
        items +
        '<div class="a-total"><span>Total</span><b>' + money(order.total_amount, true) + '</b></div>' +
        '<dl class="a-kv" style="margin-top:8px">' +
          '<dt>Items</dt><dd>' + money(order.items_amount, true) + '</dd>' +
          '<dt>Delivery fee</dt><dd>' + money(order.delivery_fee, true) + '</dd>' +
          (order.discount_amount ? '<dt>Discount</dt><dd>−' + money(order.discount_amount, true) + '</dd>' : '') +
        '</dl>' +
      '</div>' +

      (reviews ? '<div class="a-block"><div class="a-block__title">Reviews</div>' + reviews + '</div>' : '') +

      '<div class="a-block" style="margin-bottom:0">' +
        '<div class="a-block__title">Console</div>' +
        '<div style="font-size:11px;color:var(--a-text-3);line-height:1.6">' +
          'Placed ' + esc(order.created_at ? order.created_at.replace('T', ' ').slice(0, 19) : '—') +
          '<br>This console is read-only — advance the order from its own side.' +
        '</div>' +
      '</div>';

    $('#drawer-body').innerHTML = body;
  }

  function closeDrawer() {
    var drawer = $('#drawer');
    var scrim = $('#scrim');
    if (!drawer || !scrim) return;
    state.orderId = null;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('is-open');
    setTimeout(function () { if (!drawer.classList.contains('is-open')) scrim.hidden = true; }, 240);
  }

  /* ==========================================================
     5. 事件
     ========================================================== */
  function bind() {
    /* 时间窗口 */
    $$('.a-window__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.classList.contains('is-active')) return;
        $$('.a-window__btn').forEach(function (other) { other.classList.remove('is-active'); });
        btn.classList.add('is-active');
        state.win = btn.dataset.window;
        load().then(schedule);
      });
    });

    /* 暂停 / 恢复轮询 */
    var pill = $('#live-pill');
    if (pill) {
      pill.addEventListener('click', function () {
        state.paused = !state.paused;
        setLive(state.paused ? 'paused' : 'live');
        if (state.paused) clearTimeout(state.timer);
        else load().then(schedule);
        toast(state.paused ? 'Auto-refresh paused' : 'Auto-refresh resumed');
      });
    }

    var refresh = $('#refresh-btn');
    if (refresh) refresh.addEventListener('click', function () { load().then(schedule); });

    var fullscreen = $('#fullscreen-btn');
    if (fullscreen) {
      fullscreen.addEventListener('click', function () {
        if (!document.fullscreenElement) {
          if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(function () {});
          }
        } else if (document.exitFullscreen) {
          document.exitFullscreen().catch(function () {});
        }
      });
    }

    /* 流水 / 告警 → 抽屉（事件委托） */
    document.addEventListener('click', function (event) {
      var target = event.target.closest('[data-order-id]');
      if (target) {
        var id = Number(target.dataset.orderId);
        if (id) openDrawer(id);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDrawer();
      if (event.key === 'Enter' && event.target.dataset && event.target.dataset.orderId) {
        event.preventDefault();
        openDrawer(Number(event.target.dataset.orderId));
      }
    });

    var close = $('#drawer-close');
    if (close) close.addEventListener('click', closeDrawer);
    var done = $('#drawer-done');
    if (done) done.addEventListener('click', closeDrawer);
    var again = $('#drawer-refresh');
    if (again) again.addEventListener('click', function () {
      if (state.orderId) loadOrder(state.orderId);
    });
    var scrim = $('#scrim');
    if (scrim) scrim.addEventListener('click', closeDrawer);

    /* 窗口尺寸变化 → 重画图表（rAF 防抖） */
    var pending = false;
    window.addEventListener('resize', function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        if (state.data) drawTrend(state.data.trend);
      });
    });

    /* 切回标签页立刻补一次，别让墙停在旧数据上 */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !state.paused) load().then(schedule);
    });
  }

  function tickClock() {
    var now = new Date();
    var time = $('#clock-time');
    var date = $('#clock-date');
    if (time) {
      time.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map(function (n) { return String(n).padStart(2, '0'); }).join(':');
    }
    if (date) date.textContent = dayLabel(now.toISOString());
  }

  function start() {
    bind();
    tickClock();
    setInterval(tickClock, 1000);
    load().then(schedule);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
