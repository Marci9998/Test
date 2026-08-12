/* ============================================================
   batches.js — lotes de compra

   Compras un paquete de móviles por un precio conjunto y ese
   dinero hay que repartirlo entre los móviles que salen, que si
   no, no hay manera de saber lo que ganas con cada uno.

   El reparto sale a partes iguales, pero se puede tocar a mano
   (un iPhone del lote no «cuesta» lo mismo que un Alcatel).
   Cada parte se guarda como el precio de compra de su ficha, que
   es lo que ya usaban el panel y los números de siempre.
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Store, U = global.UI;

  var current = null;
  var snapshot = '';
  var onChange = function () {};

  function el(id) { return document.getElementById(id); }
  function esc(s) { return U.esc(s); }

  /* ── Modelo ──────────────────────────────────────────────── */
  function blank() {
    return {
      id: S.uid(),
      number: nextNumber(),
      supplier: '',
      date: S.today(),
      totalCost: 0,
      extraCost: 0,
      notes: '',
      createdAt: S.today(),
      updatedAt: new Date().toISOString()
    };
  }

  function nextNumber() {
    var year = String(new Date().getFullYear());
    var top = 0;
    S.batches().forEach(function (b) {
      var m = String(b.number || '').match(/^(\d{4})-(\d+)$/);
      if (m && m[1] === year) top = Math.max(top, parseInt(m[2], 10));
    });
    return year + '-' + ('0' + (top + 1)).slice(-2);
  }

  function normalize(b) {
    var out = Object.assign(blank(), b || {});
    out.totalCost = S.num(out.totalCost);
    out.extraCost = S.num(out.extraCost);
    ['supplier', 'notes', 'date', 'number'].forEach(function (k) {
      out[k] = out[k] == null ? '' : String(out[k]);
    });
    return out;
  }

  /* ── Cuentas del lote ────────────────────────────────────── */
  function ticketsOf(batchId) {
    return S.all().filter(function (t) { return t.batchId === batchId; });
  }

  function totals(batch) {
    var units = ticketsOf(batch.id);
    var pagado = S.num(batch.totalCost) + S.num(batch.extraCost);
    var repartido = units.reduce(function (sum, t) { return sum + S.num(t.purchaseCost); }, 0);

    var vendidos = units.filter(S.isSold);
    var recuperado = vendidos.reduce(function (sum, t) { return sum + S.num(t.salePrice); }, 0);
    var beneficio = units.reduce(function (sum, t) {
      return S.isSold(t) ? sum + S.profit(t) : sum;
    }, 0);

    return {
      pagado: pagado,
      repartido: repartido,
      pendiente: pagado - repartido,
      units: units.length,
      vendidos: vendidos.length,
      recuperado: recuperado,
      beneficio: beneficio,
      // lo que falta por vender para dejar de perder dinero con el lote
      recuperada: recuperado >= pagado
    };
  }

  /* Reparte el coste del lote entre sus móviles, a partes iguales */
  function splitEvenly(batch) {
    var units = ticketsOf(batch.id);
    if (!units.length) return 0;

    var total = S.num(batch.totalCost) + S.num(batch.extraCost);
    var each = Math.floor(total / units.length * 100) / 100;
    var used = each * (units.length - 1);

    units.forEach(function (t, i) {
      // al último se le deja el resto, para que la suma cuadre al céntimo
      t.purchaseCost = i === units.length - 1
        ? Math.round((total - used) * 100) / 100
        : each;
      S.upsert(t);
    });
    return units.length;
  }

  /* ── Lista ───────────────────────────────────────────────── */
  function render() {
    var list = S.batches().slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    el('batch-list').innerHTML = list.map(function (b) {
      var t = totals(b);
      var color = t.recuperada ? 'var(--good)' : 'var(--warn)';
      var soft = t.recuperada ? 'var(--good-soft)' : 'var(--warn-soft)';

      return '<article class="ticket" data-batch="' + esc(b.id) + '" ' +
        'style="--st-color:' + color + ';--st-soft:' + soft + '">' +
        '<div class="ticket-main">' +
          '<div class="ticket-title">Lote ' + esc(b.number) +
            (b.supplier ? ' · ' + esc(b.supplier) : '') + '</div>' +
          '<div class="ticket-sub">' + esc(U.dateLabel(b.date)) + ' · ' +
            esc(S.money(t.pagado)) + ' por ' + t.units +
            (t.units === 1 ? ' móvil' : ' móviles') + '</div>' +
          '<div class="ticket-meta">' +
            '<span class="badge">' + (t.recuperada ? 'Recuperado' : 'Por recuperar') + '</span>' +
            '<span class="tag">' + t.vendidos + ' de ' + t.units + ' vendidos</span>' +
            (Math.abs(t.pendiente) >= 0.01
              ? '<span class="tag">sin repartir ' + esc(S.money(t.pendiente)) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="ticket-money">' +
          '<div class="money-profit ' + (t.beneficio > 0 ? 'pos' : (t.beneficio < 0 ? 'neg' : '')) + '">' +
            (t.beneficio > 0 ? '+' : '') + esc(S.money(t.beneficio)) + '</div>' +
          '<div class="money-sub">' + esc(S.money(t.recuperado)) + ' recuperados</div>' +
        '</div>' +
      '</article>';
    }).join('');

    var empty = el('batch-empty');
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.textContent = 'Aquí van los paquetes de móviles que compras de golpe: pones lo que ' +
        'pagaste por todo y el programa reparte ese dinero entre los móviles del lote.';
    }
  }

  /* ── Editor ──────────────────────────────────────────────── */
  function open(batch) {
    current = normalize(batch || blank());
    snapshot = JSON.stringify(current);

    setValue('number', current.number);
    setValue('supplier', current.supplier);
    setValue('date', current.date);
    setValue('totalCost', current.totalCost ? String(current.totalCost).replace('.', ',') : '');
    setValue('extraCost', current.extraCost ? String(current.extraCost).replace('.', ',') : '');
    setValue('notes', current.notes);

    el('batch-title').textContent = batch ? 'Lote ' + current.number : 'Nuevo lote';
    el('batch-delete').hidden = !batch;
    el('batch-new-count').value = '';

    renderUnits();
    el('batch-drawer').hidden = false;
    el('batch-backdrop').hidden = false;
    document.body.classList.add('drawer-open');
    document.body.style.overflow = 'hidden';
  }

  function setValue(name, value) {
    var input = el('batch-form').querySelector('[name="' + name + '"]');
    if (input) input.value = value == null ? '' : value;
  }

  function close(force) {
    if (!force && current && JSON.stringify(sync()) !== snapshot) {
      if (!confirm('Tienes cambios sin guardar. ¿Cerrar de todas formas?')) return;
    }
    el('batch-drawer').hidden = true;
    el('batch-backdrop').hidden = true;
    document.body.classList.remove('drawer-open');
    document.body.style.overflow = '';
    current = null;
  }

  function sync() {
    if (!current) return null;
    var form = el('batch-form');
    function val(name) {
      var input = form.querySelector('[name="' + name + '"]');
      return input ? input.value : '';
    }
    current.number = val('number').trim();
    current.supplier = val('supplier');
    current.date = val('date');
    current.totalCost = S.num(val('totalCost'));
    current.extraCost = S.num(val('extraCost'));
    current.notes = val('notes');
    return current;
  }

  /* Las cuentas del lote. Se repinta mientras se escribe, así que va
     aparte de la lista de móviles: repintar la lista borraría lo tecleado. */
  function renderSummary() {
    if (!current) return;
    var t = totals(sync() || current);

    el('batch-summary').innerHTML =
      '<div class="sum-row"><span>Pagado por el lote</span><span>' + esc(S.money(t.pagado)) + '</span></div>' +
      '<div class="sum-row"><span>Repartido entre ' + t.units +
        (t.units === 1 ? ' móvil' : ' móviles') + '</span><span>' + esc(S.money(t.repartido)) + '</span></div>' +
      (Math.abs(t.pendiente) >= 0.01
        ? '<div class="sum-row" style="color:var(--warn)"><span>Sin repartir</span><span>' +
          esc(S.money(t.pendiente)) + '</span></div>'
        : '') +
      '<div class="sum-row"><span>Recuperado con ' + t.vendidos + ' venta' +
        (t.vendidos === 1 ? '' : 's') + '</span><span>' + esc(S.money(t.recuperado)) + '</span></div>' +
      '<div class="sum-row total ' + (t.beneficio > 0 ? 'pos' : (t.beneficio < 0 ? 'neg' : '')) + '">' +
        '<span>Beneficio del lote</span><span>' + (t.beneficio > 0 ? '+' : '') +
        esc(S.money(t.beneficio)) + '</span></div>' +
      '<div class="sum-note">' + (t.recuperada
        ? 'Ya has recuperado lo que pagaste por el lote.'
        : 'Te faltan ' + esc(S.money(t.pagado - t.recuperado)) + ' por vender para recuperar el lote.') +
      '</div>';
  }

  /* Los móviles del lote, con su parte del dinero */
  function renderUnits() {
    if (!current) return;
    var units = ticketsOf(current.id);
    renderSummary();

    el('batch-units').innerHTML = units.length ? units.map(function (ticket) {
      var vendido = S.isSold(ticket);
      return '<div class="bunit" data-unit="' + esc(ticket.id) + '">' +
        '<div class="bunit-main">' +
          '<div class="bunit-name">' + esc(S.title(ticket)) + '</div>' +
          '<div class="bunit-sub">' + esc(S.statusLabel(ticket.status, ticket.type)) +
            (vendido ? ' · vendido por ' + esc(S.money(ticket.salePrice)) : '') + '</div>' +
        '</div>' +
        '<input class="bunit-cost" type="text" inputmode="decimal" ' +
          'value="' + esc(String(S.num(ticket.purchaseCost)).replace('.', ',')) + '" ' +
          'aria-label="Parte del lote">' +
        '<button type="button" class="btn sm" data-open="' + esc(ticket.id) + '">Abrir</button>' +
      '</div>';
    }).join('') : '<p class="hint" style="margin:4px 0 0">Todavía no hay móviles en este lote. ' +
        'Añádelos aquí abajo y luego les pones el modelo y la avería.</p>';
  }

  /* Mete N fichas nuevas en el lote, ya con su parte del coste */
  function addUnits(count) {
    count = Math.max(1, Math.min(50, parseInt(count, 10) || 0));
    var batch = sync();
    S.saveBatch(batch);

    for (var i = 0; i < count; i++) {
      var ticket = S.blank();
      ticket.batchId = batch.id;
      ticket.type = 'reventa';
      ticket.model = '';
      ticket.notes = 'Del lote ' + batch.number +
        (batch.supplier ? ' (' + batch.supplier + ')' : '');
      S.upsert(ticket);
    }

    splitEvenly(batch);
    renderUnits();
    onChange();
    U.toast(count === 1 ? 'Móvil añadido al lote' : count + ' móviles añadidos');
  }

  function save() {
    var batch = sync();
    if (!batch.totalCost) {
      U.toast('Pon lo que pagaste por el lote');
      return null;
    }
    S.saveBatch(batch);
    snapshot = JSON.stringify(current);
    onChange();
    return batch;
  }

  function remove() {
    if (!current) return;
    var units = ticketsOf(current.id);
    var aviso = units.length
      ? '¿Borrar el lote ' + current.number + '? Los ' + units.length +
        ' móviles NO se borran: se quedan como fichas sueltas con su precio de compra.'
      : '¿Borrar el lote ' + current.number + '?';
    if (!confirm(aviso)) return;

    units.forEach(function (t) { t.batchId = ''; S.upsert(t); });
    S.removeBatch(current.id);
    close(true);
    render();
    onChange();
    U.toast('Lote borrado');
  }

  /* ── Arranque ────────────────────────────────────────────── */
  function init(options) {
    onChange = (options && options.onChange) || function () {};
    var openTicket = (options && options.openTicket) || function () {};

    el('batch-new').addEventListener('click', function () { open(null); });
    el('batch-close').addEventListener('click', function () { close(false); });
    el('batch-cancel').addEventListener('click', function () { close(false); });
    el('batch-backdrop').addEventListener('click', function () { close(false); });
    el('batch-delete').addEventListener('click', remove);

    el('batch-save').addEventListener('click', function () {
      if (!save()) return;
      close(true);
      render();
      U.toast('Lote guardado');
    });

    el('batch-list').addEventListener('click', function (e) {
      var card = e.target.closest('[data-batch]');
      if (!card) return;
      var batch = S.batches().filter(function (b) { return b.id === card.dataset.batch; })[0];
      if (batch) open(batch);
    });

    el('batch-add').addEventListener('click', function () {
      addUnits(el('batch-new-count').value || 1);
      el('batch-new-count').value = '';
    });

    el('batch-split').addEventListener('click', function () {
      var batch = sync();
      S.saveBatch(batch);
      var n = splitEvenly(batch);
      if (!n) return U.toast('Primero mete móviles en el lote');
      renderUnits();
      onChange();
      U.toast('Repartido entre ' + n + (n === 1 ? ' móvil' : ' móviles'));
    });

    // cambiar a mano la parte de un móvil: se apunta según se escribe,
    // pero sin repintar la lista, que borraría lo que se está tecleando
    function unitCost(e) {
      if (!e.target.classList.contains('bunit-cost')) return;
      var id = e.target.closest('.bunit').dataset.unit;
      var ticket = S.get(id);
      if (!ticket) return;
      ticket.purchaseCost = S.num(e.target.value);
      S.upsert(ticket);
      renderSummary();
      onChange();
    }
    el('batch-units').addEventListener('input', unitCost);
    el('batch-units').addEventListener('change', unitCost);

    el('batch-units').addEventListener('click', function (e) {
      var button = e.target.closest('[data-open]');
      if (!button) return;
      var ticket = S.get(button.dataset.open);
      if (!ticket) return;
      close(true);
      openTicket(ticket);
    });

    // el resto del formulario (lo pagado, el transporte…) sólo mueve las cuentas
    var form = el('batch-form');
    function formChanged(e) {
      if (!current) return;
      if (e.target.classList.contains('bunit-cost')) return; // ya lo lleva unitCost
      sync();
      renderSummary();
    }
    form.addEventListener('input', formChanged);
    form.addEventListener('change', formChanged);
    form.addEventListener('submit', function (e) { e.preventDefault(); });
  }

  global.Batches = {
    init: init,
    render: render,
    open: open,
    close: close,
    totals: totals,
    ticketsOf: ticketsOf,
    isOpen: function () { return !el('batch-drawer').hidden; }
  };
})(window);
