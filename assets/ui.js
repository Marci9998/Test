/* ============================================================
   ui.js — pintar el panel, la lista y la ficha
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Store;

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sign(n) { return n > 0 ? 'pos' : (n < 0 ? 'neg' : ''); }

  function statusVars(id) {
    var st = S.status(id);
    return 'style="--st-color:' + st.color + ';--st-soft:' + st.soft + '"';
  }

  function dateLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ── Panel ───────────────────────────────────────────────── */
  function renderPanel() {
    var s = S.stats();

    el('kpis').innerHTML = [
      kpi('En taller', String(s.open), s.invested ? S.money(s.invested) + ' invertidos' : 'nada pendiente'),
      kpi('Beneficio previsto', S.money(s.expected), 'si vendes lo que tienes', sign(s.expected)),
      kpi('Vendido este mes', String(s.soldThisMonth), S.money(s.profitMonth) + ' de beneficio', sign(s.profitMonth)),
      kpi('Beneficio total', S.money(s.profitTotal),
        s.sold + (s.sold === 1 ? ' venta' : ' ventas') +
        (s.sold ? ' · ' + Math.round(s.avgMargin) + '% margen medio' : ''), sign(s.profitTotal))
    ].join('');

    renderChart();
    renderAttention();
    renderRecentSales();
  }

  function kpi(label, value, sub, cls) {
    return '<div class="kpi">' +
      '<div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value ' + (cls || '') + '">' + esc(value) + '</div>' +
      '<div class="kpi-sub">' + esc(sub) + '</div>' +
    '</div>';
  }

  function renderChart() {
    var data = S.monthlyProfit(6);
    var max = Math.max.apply(null, data.map(function (d) { return Math.abs(d.value); }).concat([1]));
    el('chart').innerHTML = data.map(function (d) {
      var h = Math.max(3, Math.round(Math.abs(d.value) / max * 96));
      return '<div class="chart-col" title="' + esc(d.label + ': ' + S.money(d.value)) + '">' +
        '<div class="chart-amount ' + sign(d.value) + '">' + (d.value ? esc(Math.round(d.value) + ' €') : '') + '</div>' +
        '<div class="chart-bar ' + (d.value < 0 ? 'neg' : '') + '" style="height:' + h + 'px"></div>' +
        '<div class="chart-month">' + esc(d.label) + '</div>' +
      '</div>';
    }).join('');
  }

  function renderAttention() {
    var list = S.all().filter(function (t) {
      return t.status === 'pendiente' || t.status === 'reparando' || t.status === 'piezas';
    }).sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); }).slice(0, 6);

    el('attention').innerHTML = list.length ? list.map(function (t) {
      return '<li data-id="' + esc(t.id) + '">' +
        '<div class="mini-main">' +
          '<div class="mini-title">' + esc(S.title(t)) + '</div>' +
          '<div class="mini-sub">' + esc(S.statusLabel(t.status, t.type)) +
            (t.createdAt ? ' · desde el ' + esc(dateLabel(t.createdAt)) : '') + '</div>' +
        '</div>' +
        '<div class="mini-amount">' + esc(S.money(S.totalCost(t))) + '</div>' +
      '</li>';
    }).join('') : '<li class="mini-empty">Nada pendiente. 👌</li>';
  }

  function renderRecentSales() {
    var list = S.all().filter(S.isSold)
      .sort(function (a, b) { return (b.soldAt || '').localeCompare(a.soldAt || ''); })
      .slice(0, 6);

    el('recent-sales').innerHTML = list.length ? list.map(function (t) {
      var p = S.profit(t);
      return '<li data-id="' + esc(t.id) + '">' +
        '<div class="mini-main">' +
          '<div class="mini-title">' + esc(S.title(t)) + '</div>' +
          '<div class="mini-sub">' + esc(dateLabel(t.soldAt)) + ' · vendido por ' + esc(S.money(t.salePrice)) + '</div>' +
        '</div>' +
        '<div class="mini-amount ' + sign(p) + '">' + (p > 0 ? '+' : '') + esc(S.money(p)) + '</div>' +
      '</li>';
    }).join('') : '<li class="mini-empty">Aún no hay ventas registradas.</li>';
  }

  /* ── Chips de estado ─────────────────────────────────────── */
  function renderChips(active) {
    var counts = { todos: S.all().length };
    S.all().forEach(function (t) { counts[t.status] = (counts[t.status] || 0) + 1; });

    var items = [{ id: 'todos', label: 'Todas' }].concat(S.STATUSES);
    el('status-chips').innerHTML = items.map(function (item) {
      var n = counts[item.id] || 0;
      return '<button class="chip' + (active === item.id ? ' is-active' : '') + '" data-status="' + esc(item.id) + '">' +
        esc(item.label) + '<span class="chip-count">' + n + '</span></button>';
    }).join('');
  }

  /* ── Lista de fichas ─────────────────────────────────────── */
  function matches(t, query) {
    if (!query) return true;
    var hay = [t.brand, t.model, t.storage, t.color, t.imei, t.customerName, t.customerPhone, t.issue, t.notes]
      .concat((t.parts || []).map(function (p) { return p.name; }))
      .join(' ').toLowerCase();
    return query.toLowerCase().split(/\s+/).every(function (word) { return hay.indexOf(word) > -1; });
  }

  function sortList(list, mode) {
    var copy = list.slice();
    if (mode === 'profit') return copy.sort(function (a, b) { return S.profit(b) - S.profit(a); });
    if (mode === 'cost') return copy.sort(function (a, b) { return S.totalCost(b) - S.totalCost(a); });
    if (mode === 'model') return copy.sort(function (a, b) { return S.title(a).localeCompare(S.title(b), 'es'); });
    return copy.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  }

  function renderList(filter) {
    var list = S.all().filter(function (t) {
      return (filter.status === 'todos' || t.status === filter.status) && matches(t, filter.query);
    });
    list = sortList(list, filter.sort);

    el('list').innerHTML = list.map(ticketCard).join('');

    var empty = el('empty');
    if (list.length) {
      empty.hidden = true;
    } else {
      empty.hidden = false;
      empty.textContent = S.all().length
        ? 'No hay fichas que coincidan con ese filtro.'
        : 'Todavía no tienes fichas. Dale a «Nueva ficha» o importa tu Excel desde la pestaña Datos.';
    }
  }

  function ticketCard(t) {
    var c = S.calc(t);
    var sold = S.isSold(t);
    var profitCls = sold ? sign(c.profit) : (c.revenue ? 'pend' : 'pend');

    var tags = [];
    if (t.storage) tags.push(t.storage);
    if (t.color) tags.push(t.color);
    if (t.type === 'cliente' && t.customerName) tags.push('👤 ' + t.customerName);
    if ((t.parts || []).length) tags.push((t.parts.length) + ' pieza' + (t.parts.length > 1 ? 's' : ''));

    return '<article class="ticket" data-id="' + esc(t.id) + '" ' + statusVars(t.status) + '>' +
      '<div class="ticket-main">' +
        '<div class="ticket-title">' + esc(S.title(t)) + '</div>' +
        '<div class="ticket-sub">' + esc(t.issue || 'Sin avería anotada') + '</div>' +
        '<div class="ticket-meta">' +
          '<span class="badge">' + esc(S.statusLabel(t.status, t.type)) + '</span>' +
          tags.map(function (tag) { return '<span class="tag">' + esc(tag) + '</span>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="ticket-money">' +
        '<div class="money-profit ' + profitCls + '">' + (c.profit > 0 ? '+' : '') + esc(S.money(c.profit)) + '</div>' +
        '<div class="money-sub">' + esc(S.money(c.cost)) + ' coste · ' +
          esc(c.revenue ? S.money(c.revenue) : '— ') + (sold ? '' : ' previsto') + '</div>' +
      '</div>' +
    '</article>';
  }

  /* ── Datalists ───────────────────────────────────────────── */
  function renderSuggestions() {
    var s = S.suggestions();
    function fill(id, values) {
      el(id).innerHTML = values.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
    }
    fill('dl-brands', s.brands);
    fill('dl-models', s.models);
    fill('dl-parts', s.parts);
  }

  /* ── Resumen de números dentro de la ficha ───────────────── */
  function renderSummary(t) {
    var c = S.calc(t);
    var rows = [];

    if (t.type !== 'cliente') rows.push(['Compra del equipo', S.money(t.purchaseCost)]);
    rows.push(['Piezas', S.money(c.parts)]);
    if (S.num(t.extraCost)) rows.push(['Otros gastos', S.money(t.extraCost)]);
    rows.push(['<strong>Coste total</strong>', S.money(c.cost)]);
    rows.push([t.type === 'cliente' ? 'Se le cobra' : 'Se vende por',
      c.revenue ? S.money(c.revenue) : '—']);

    var html = rows.map(function (r) {
      return '<div class="sum-row"><span>' + r[0] + '</span><span>' + esc(r[1]) + '</span></div>';
    }).join('');

    html += '<div class="sum-row total ' + sign(c.profit) + '">' +
      '<span>Beneficio</span><span>' + (c.profit > 0 ? '+' : '') + esc(S.money(c.profit)) + '</span></div>';

    if (c.revenue) {
      html += '<div class="sum-note">Margen ' + Math.round(c.margin) + '%' +
        (c.estimated ? ' · estimado con el precio publicado' : '') + '</div>';
    } else {
      html += '<div class="sum-note">Pon un precio de venta para ver el beneficio.</div>';
    }

    el('summary').innerHTML = html;
  }

  /* ── Fila de pieza ───────────────────────────────────────── */
  function partRow(part) {
    return '<div class="part" data-part="' + esc(part.id) + '">' +
      '<input class="part-name" list="dl-parts" placeholder="Pantalla, batería…" value="' + esc(part.name) + '">' +
      '<input class="part-qty" type="text" inputmode="numeric" value="' + esc(part.qty) + '" aria-label="Cantidad">' +
      '<input class="part-cost" type="text" inputmode="decimal" value="' + esc(part.unitCost) + '" aria-label="Precio por unidad">' +
      '<button type="button" class="part-search" title="Buscar esta pieza en las tiendas" aria-label="Buscar esta pieza">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a6 6 0 1 0 3.9 10.6l4.3 4.2 1.4-1.4-4.2-4.3A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>' +
      '</button>' +
      '<button type="button" class="part-del" aria-label="Quitar pieza">×</button>' +
    '</div>';
  }

  function renderParts(parts) {
    var head = '<div class="parts-head"><span>Pieza</span><span>Uds</span><span>€/ud</span><span></span><span></span></div>';
    el('parts').innerHTML = head + (parts.length
      ? parts.map(partRow).join('')
      : '<p class="hint" style="margin:4px 0 0">Sin piezas todavía.</p>');
  }

  /* ── Perfiles ────────────────────────────────────────────── */
  function renderProfiles() {
    var list = S.profiles();
    var active = S.activeProfile();

    el('profile-select').innerHTML = list.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (active && p.id === active.id ? ' selected' : '') + '>' +
        esc(p.name) + '</option>';
    }).join('');

    var target = el('profile-list');
    if (!target) return;
    target.innerHTML = list.map(function (p) {
      var isActive = active && p.id === active.id;
      return '<li data-profile="' + esc(p.id) + '">' +
        '<div class="mini-main">' +
          '<div class="mini-title">' + esc(p.name) + (isActive ? ' <span class="tag">en uso</span>' : '') + '</div>' +
          '<div class="mini-sub">' + (p.createdAt ? 'creado el ' + esc(dateLabel(p.createdAt)) : '') + '</div>' +
        '</div>' +
        '<button type="button" class="btn sm" data-action="rename">Renombrar</button>' +
        (list.length > 1 ? '<button type="button" class="btn sm btn-danger-ghost" data-action="delete">Borrar</button>' : '') +
      '</li>';
    }).join('');
  }

  /* ── Ajustes de tiendas ──────────────────────────────────── */
  function renderShopSettings() {
    el('shop-settings').innerHTML = S.shops().map(function (shop, i) {
      return '<div class="shop-row" data-shop="' + esc(shop.id) + '">' +
        '<input class="shop-name" value="' + esc(shop.name) + '" placeholder="Nombre" aria-label="Nombre de la tienda">' +
        '<input class="shop-url" value="' + esc(shop.url) + '" placeholder="https://…/buscar?q={q}" aria-label="Dirección de búsqueda">' +
        '<select class="shop-mode-box" aria-label="Cómo abrir esta tienda">' +
          ['servidor', 'directo', 'fuera'].map(function (mode) {
            var labels = { servidor: 'por el servidor', directo: 'directa', fuera: 'ventana aparte' };
            return '<option value="' + mode + '"' + (shop.mode === mode ? ' selected' : '') + '>' +
              labels[mode] + '</option>';
          }).join('') +
        '</select>' +
        '<button type="button" class="part-del" data-action="remove-shop" aria-label="Quitar tienda" ' +
          'data-index="' + i + '">×</button>' +
      '</div>';
    }).join('');
  }

  /* ── Dónde se guardan los datos ──────────────────────────── */
  function renderStorageInfo() {
    var remote = S.isRemote();
    el('storage-mode').textContent = remote ? 'servidor' : 'sólo este navegador';
    el('storage-detail').innerHTML = remote
      ? 'Estás conectado al servidor del Taller: las fichas se guardan en el equipo donde corre ' +
        '<code>server.py</code>, así que las ves igual desde el móvil, la tablet o el ordenador. ' +
        'El servidor hace una copia al día de cada perfil.'
      : 'Has abierto la web como fichero suelto, así que las fichas se guardan sólo en este navegador ' +
        'y no se ven desde otros dispositivos. Si quieres compartirlas, instala el servidor ' +
        '(mira el README) o descarga copias desde aquí abajo.';

    var profile = S.activeProfile();
    var name = profile ? '«' + profile.name + '»' : 'este perfil';

    el('backup-hint').textContent = remote
      ? 'Descarga las fichas de ' + name + ' en un fichero, para guardarlas aparte del servidor ' +
        'o llevártelas a otro sitio.'
      : 'Descarga una copia de vez en cuando. Si cambias de móvil u ordenador, importa el fichero ' +
        'y lo tienes todo igual.';

    el('wipe-hint').textContent = 'Borra todas las fichas del perfil ' + name +
      '. Los demás perfiles no se tocan. Descarga una copia antes.';
  }

  /* ── Select de estados ───────────────────────────────────── */
  function renderStatusOptions(type, selected) {
    el('status-select').innerHTML = S.STATUSES.map(function (st) {
      return '<option value="' + st.id + '"' + (st.id === selected ? ' selected' : '') + '>' +
        esc(S.statusLabel(st.id, type)) + '</option>';
    }).join('');
  }

  /* ── Toast ───────────────────────────────────────────────── */
  var toastTimer;
  function toast(message) {
    var node = el('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 2600);
  }

  global.UI = {
    el: el,
    esc: esc,
    renderPanel: renderPanel,
    renderChips: renderChips,
    renderList: renderList,
    renderSuggestions: renderSuggestions,
    renderSummary: renderSummary,
    renderParts: renderParts,
    renderStatusOptions: renderStatusOptions,
    renderProfiles: renderProfiles,
    renderShopSettings: renderShopSettings,
    renderStorageInfo: renderStorageInfo,
    partRow: partRow,
    toast: toast,
    dateLabel: dateLabel
  };
})(window);
