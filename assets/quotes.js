/* ============================================================
   quotes.js — presupuestos para el cliente

   Un presupuesto se puede escribir a mano o sacar de una ficha
   (se lleva el equipo, la avería y las piezas ya apuntadas).
   El PDF lo monta el servidor; aquí sólo se pide.
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Store, U = global.UI;

  var STATUSES = [
    { id: 'borrador',  label: 'Borrador',  color: 'var(--mute)',   soft: 'var(--mute-soft)' },
    { id: 'enviado',   label: 'Enviado',   color: 'var(--info)',   soft: 'var(--info-soft)' },
    { id: 'aceptado',  label: 'Aceptado',  color: 'var(--good)',   soft: 'var(--good-soft)' },
    { id: 'rechazado', label: 'Rechazado', color: 'var(--bad)',    soft: 'var(--bad-soft)' }
  ];

  var current = null;          // presupuesto abierto
  var snapshot = '';
  var onChange = function () {};

  function el(id) { return document.getElementById(id); }
  function esc(s) { return U.esc(s); }

  function status(id) {
    for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].id === id) return STATUSES[i];
    return STATUSES[0];
  }

  /* ── Modelo ──────────────────────────────────────────────── */
  function blank() {
    var today = S.today();
    var d = new Date();
    d.setDate(d.getDate() + 15);
    return {
      id: S.uid(),
      number: nextNumber(),
      status: 'borrador',
      createdAt: today,
      validUntil: d.toISOString().slice(0, 10),
      kind: 'presupuesto',       // o 'factura', cuando se cobra
      invoiceNumber: '',         // numeración aparte, correlativa y sin saltos
      issuedAt: '',              // fecha de la factura
      payMethod: '',             // efectivo, tarjeta, Bizum…
      customer: { name: '', phone: '', email: '', taxId: '', address: '' },
      device: { brand: '', model: '', storage: '', imei: '' },
      issue: '',
      lines: [],
      discount: 0,
      vatRate: 21,
      notes: '',
      ticketId: '',
      updatedAt: new Date().toISOString()
    };
  }

  function normalize(q) {
    var out = Object.assign(blank(), q || {});
    out.customer = Object.assign({ name: '', phone: '', email: '', taxId: '', address: '' }, out.customer || {});
    out.device = Object.assign({ brand: '', model: '', storage: '', imei: '' }, out.device || {});
    out.lines = (Array.isArray(out.lines) ? out.lines : []).map(function (l) {
      return {
        id: l.id || S.uid(),
        concept: String(l.concept || ''),
        note: String(l.note || ''),
        qty: S.num(l.qty) || 1,
        unitPrice: S.num(l.unitPrice)
      };
    });
    out.discount = S.num(out.discount);
    out.vatRate = S.num(out.vatRate);
    out.kind = out.kind === 'factura' ? 'factura' : 'presupuesto';
    ['invoiceNumber', 'issuedAt', 'payMethod'].forEach(function (k) {
      out[k] = out[k] == null ? '' : String(out[k]);
    });
    if (!STATUSES.some(function (s) { return s.id === out.status; })) out.status = 'borrador';
    return out;
  }

  /* Numeración por año: 2026-001, 2026-002… */
  function nextNumber() {
    var year = String(new Date().getFullYear());
    var top = 0;
    S.quotes().forEach(function (q) {
      var m = String(q.number || '').match(/^(\d{4})-(\d+)$/);
      if (m && m[1] === year) top = Math.max(top, parseInt(m[2], 10));
    });
    return year + '-' + ('00' + (top + 1)).slice(-3);
  }

  /* Las facturas llevan su propia serie, correlativa y sin saltos:
     F2026-001, F2026-002… Hacienda no perdona los huecos, así que el
     número se asigna al cobrar y ya no se toca. */
  function nextInvoiceNumber() {
    var year = String(new Date().getFullYear());
    var top = 0;
    S.quotes().forEach(function (q) {
      var m = String(q.invoiceNumber || '').match(/^F(\d{4})-(\d+)$/);
      if (m && m[1] === year) top = Math.max(top, parseInt(m[2], 10));
    });
    return 'F' + year + '-' + ('00' + (top + 1)).slice(-3);
  }

  /* ── Cuentas ─────────────────────────────────────────────── */
  function totals(q) {
    var base = (q.lines || []).reduce(function (sum, l) {
      return sum + S.num(l.qty) * S.num(l.unitPrice);
    }, 0);
    var discount = S.num(q.discount);
    var net = Math.max(0, base - discount);
    var vat = net * S.num(q.vatRate) / 100;
    return { base: base, discount: discount, net: net, vat: vat, total: net + vat };
  }

  /* ── Sacar un presupuesto de una ficha ───────────────────── */
  function fromTicket(ticket) {
    var q = blank();
    q.ticketId = ticket.id;
    q.device = {
      brand: ticket.brand || '', model: ticket.model || '',
      storage: ticket.storage || '', imei: ticket.imei || ''
    };
    q.issue = ticket.issue || '';
    q.customer.name = ticket.customerName || '';
    q.customer.phone = ticket.customerPhone || '';

    // las piezas van tal cual, y la mano de obra se deja apuntada aparte
    q.lines = (ticket.parts || []).filter(function (p) { return p.name; }).map(function (p) {
      return { id: S.uid(), concept: p.name, note: '', qty: S.num(p.qty) || 1,
               unitPrice: S.num(p.unitCost) };
    });
    if (S.num(ticket.extraCost)) {
      q.lines.push({ id: S.uid(), concept: 'Otros gastos', note: '', qty: 1,
                     unitPrice: S.num(ticket.extraCost) });
    }
    q.lines.push({ id: S.uid(), concept: 'Mano de obra', note: '', qty: 1, unitPrice: 0 });
    return q;
  }

  /* ── Lista ───────────────────────────────────────────────── */
  function render() {
    var list = S.quotes().slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
             String(b.number || '').localeCompare(String(a.number || ''));
    });

    el('quote-list').innerHTML = list.map(function (q) {
      var factura = q.kind === 'factura';
      var st = factura
        ? { label: 'Cobrada', color: 'var(--good)', soft: 'var(--good-soft)' }
        : status(q.status);
      var sums = totals(q);
      var who = (q.customer && q.customer.name) || 'Sin cliente';
      var what = [q.device && q.device.brand, q.device && q.device.model]
        .filter(Boolean).join(' ') || 'Sin equipo';
      var numero = factura ? (q.invoiceNumber || '—') : (q.number || '—');

      return '<article class="ticket" data-quote="' + esc(q.id) + '" ' +
        'style="--st-color:' + st.color + ';--st-soft:' + st.soft + '">' +
        '<div class="ticket-main">' +
          '<div class="ticket-title">' + (factura ? '🧾 ' : '') +
            esc(numero) + ' · ' + esc(who) + '</div>' +
          '<div class="ticket-sub">' + esc(what) + (q.issue ? ' — ' + esc(q.issue) : '') + '</div>' +
          '<div class="ticket-meta">' +
            '<span class="badge">' + (factura ? 'Factura' : esc(st.label)) + '</span>' +
            '<span class="tag">' + esc(U.dateLabel(factura ? (q.issuedAt || q.createdAt)
                                                           : q.createdAt)) + '</span>' +
            (factura && q.payMethod ? '<span class="tag">' + esc(q.payMethod) + '</span>' : '') +
            ((q.lines || []).length ? '<span class="tag">' + q.lines.length + ' línea' +
              (q.lines.length > 1 ? 's' : '') + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="ticket-money">' +
          '<div class="money-profit' + (factura ? ' pos' : '') + '">' +
            esc(S.money(sums.total)) + '</div>' +
          '<div class="money-sub">' + (S.num(q.vatRate) ? 'IVA incluido' : 'sin IVA') + '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    var empty = el('quote-empty');
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.textContent = 'Todavía no hay nada. Dale a «Nuevo presupuesto», o ábrelo ' +
        'desde una ficha para que se rellene solo. Cuando cobres, el presupuesto se ' +
        'convierte en factura con un botón.';
    }
  }

  /* ── Editor ──────────────────────────────────────────────── */
  function open(quote) {
    current = normalize(quote || blank());
    snapshot = JSON.stringify(current);

    var form = el('quote-form');
    form.reset();

    setValue('number', current.number);
    setValue('createdAt', current.createdAt);
    setValue('validUntil', current.validUntil);
    setValue('customerName', current.customer.name);
    setValue('customerPhone', current.customer.phone);
    setValue('customerEmail', current.customer.email);
    setValue('customerTaxId', current.customer.taxId);
    setValue('customerAddress', current.customer.address);
    setValue('brand', current.device.brand);
    setValue('model', current.device.model);
    setValue('storage', current.device.storage);
    setValue('imei', current.device.imei);
    setValue('issue', current.issue);
    setValue('notes', current.notes);
    setValue('discount', current.discount ? String(current.discount).replace('.', ',') : '');
    setValue('vatRate', String(current.vatRate));

    el('quote-status').innerHTML = STATUSES.map(function (st) {
      return '<option value="' + st.id + '"' + (st.id === current.status ? ' selected' : '') + '>' +
        esc(st.label) + '</option>';
    }).join('');

    renderLines();
    renderTotals();

    applyKind();
    el('quote-from-catalog').hidden = !global.Catalog.ready();
    el('quote-delete').hidden = !quote;
    el('quote-drawer').hidden = false;
    el('quote-backdrop').hidden = false;
    document.body.classList.add('drawer-open');
    document.body.style.overflow = 'hidden';
  }

  function setValue(name, value) {
    var input = el('quote-form').querySelector('[name="' + name + '"]');
    if (input) input.value = value == null ? '' : value;
  }

  function close(force) {
    if (!force && current && JSON.stringify(sync()) !== snapshot) {
      if (!confirm('Tienes cambios sin guardar. ¿Cerrar de todas formas?')) return;
    }
    el('quote-drawer').hidden = true;
    el('quote-backdrop').hidden = true;
    document.body.classList.remove('drawer-open');
    document.body.style.overflow = '';
    current = null;
  }

  function sync() {
    if (!current) return null;
    var form = el('quote-form');
    function val(name) {
      var input = form.querySelector('[name="' + name + '"]');
      return input ? input.value : '';
    }

    current.number = val('number').trim();
    current.createdAt = val('createdAt');
    current.validUntil = val('validUntil');
    current.status = el('quote-status').value;
    current.customer = {
      name: val('customerName'), phone: val('customerPhone'), email: val('customerEmail'),
      taxId: val('customerTaxId'), address: val('customerAddress')
    };
    current.device = {
      brand: val('brand'), model: val('model'),
      storage: val('storage'), imei: val('imei')
    };
    current.issue = val('issue');
    current.notes = val('notes');
    current.discount = S.num(val('discount'));
    current.vatRate = S.num(val('vatRate'));

    current.lines = Array.prototype.map.call(form.querySelectorAll('.qline'), function (row) {
      return {
        id: row.dataset.line,
        concept: row.querySelector('.qline-concept').value,
        note: row.querySelector('.qline-note').value,
        qty: S.num(row.querySelector('.qline-qty').value) || 1,
        unitPrice: S.num(row.querySelector('.qline-price').value)
      };
    });

    return current;
  }

  function renderLines() {
    var head = '<div class="qline-head"><span>Concepto</span><span>Uds</span>' +
               '<span>€/ud</span><span>Importe</span><span></span></div>';
    el('quote-lines').innerHTML = head + (current.lines.length
      ? current.lines.map(lineRow).join('')
      : '<p class="hint" style="margin:4px 0 0">Sin líneas todavía.</p>');
  }

  function lineRow(line) {
    var amount = S.num(line.qty) * S.num(line.unitPrice);
    return '<div class="qline" data-line="' + esc(line.id) + '">' +
      '<input class="qline-concept" list="dl-parts" placeholder="Pantalla, mano de obra…" ' +
        'value="' + esc(line.concept) + '">' +
      '<input class="qline-qty" type="text" inputmode="decimal" value="' +
        esc(String(line.qty).replace('.', ',')) + '" aria-label="Cantidad">' +
      '<input class="qline-price" type="text" inputmode="decimal" value="' +
        esc(String(line.unitPrice).replace('.', ',')) + '" aria-label="Precio por unidad">' +
      '<span class="qline-amount">' + esc(S.money(amount)) + '</span>' +
      '<button type="button" class="part-del" aria-label="Quitar línea">×</button>' +
      '<input class="qline-note" placeholder="detalle para el cliente (opcional)" value="' +
        esc(line.note) + '">' +
    '</div>';
  }

  function renderTotals() {
    var sums = totals(current);
    var rows = [['Base', S.money(sums.base)]];
    if (sums.discount) {
      rows.push(['Descuento', '-' + S.money(sums.discount)]);
      rows.push(['Subtotal', S.money(sums.net)]);
    }
    if (S.num(current.vatRate)) rows.push(['IVA (' + S.num(current.vatRate) + '%)', S.money(sums.vat)]);

    el('quote-totals').innerHTML =
      rows.map(function (r) {
        return '<div class="sum-row"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>';
      }).join('') +
      '<div class="sum-row total"><span>Total</span><span>' + esc(S.money(sums.total)) + '</span></div>' +
      '<div class="sum-note">' + (S.num(current.vatRate)
        ? 'El cliente paga ' + esc(S.money(sums.total)) + ', IVA incluido.'
        : 'Sin IVA: se le cobran ' + esc(S.money(sums.total)) + '.') + '</div>';

    // las líneas también llevan su importe al día
    Array.prototype.forEach.call(el('quote-lines').querySelectorAll('.qline'), function (row) {
      var qty = S.num(row.querySelector('.qline-qty').value) || 1;
      var price = S.num(row.querySelector('.qline-price').value);
      row.querySelector('.qline-amount').textContent = S.money(qty * price);
    });
  }

  function save() {
    var quote = sync();
    if (!quote.customer.name.trim() && !quote.device.model.trim()) {
      U.toast('Ponle al menos el cliente o el modelo');
      return null;
    }
    quote.lines = quote.lines.filter(function (l) { return l.concept.trim() || l.unitPrice; });
    var saved = S.saveQuote(quote);
    snapshot = JSON.stringify(current);
    onChange();
    return saved;
  }

  /* ── PDF ─────────────────────────────────────────────────── */
  /* ── Imprimir: A4 o rollo de tickets ─────────────────────── */
  var printing = null;          // el documento que se va a imprimir

  function openPrint() {
    if (!S.isRemote()) {
      return U.toast('El PDF lo monta el servidor: abre la web por su dirección, no como fichero');
    }
    var quote = save();
    if (!quote) return;

    printing = quote;
    var factura = quote.kind === 'factura';
    el('doc-title').textContent = factura
      ? 'Imprimir factura ' + (quote.invoiceNumber || '')
      : 'Imprimir presupuesto ' + (quote.number || '');
    el('doc-hint').textContent = 'Para el rollo de tickets, en el diálogo de imprimir pon ' +
      'escala 100 % y márgenes «ninguno».';

    check('doc-format', S.prefs().docFormat || 'a4');
    el('doc-modal').hidden = false;
  }

  function check(name, value) {
    Array.prototype.forEach.call(
      document.querySelectorAll('[name="' + name + '"]'), function (input) {
        input.checked = input.value === value;
      });
  }

  function docUrl() {
    var input = document.querySelector('[name="doc-format"]:checked');
    var format = input ? input.value : 'a4';
    S.prefs({ docFormat: format });
    return format === 'a4'
      ? S.quotePdfUrl(printing.id)
      : S.quoteTicketUrl(printing.id, format);
  }

  function closePrint() { el('doc-modal').hidden = true; printing = null; }

  function pdf() { openPrint(); }

  /* ── Cobrar: el presupuesto pasa a ser factura ───────────── */
  function openCharge() {
    if (!current) return;
    if (current.kind === 'factura') {
      return U.toast('Esto ya es la factura ' + current.invoiceNumber);
    }
    var quote = sync();
    if (!quote.lines.length || !totals(quote).total) {
      return U.toast('Ponle antes lo que le cobras');
    }

    var total = totals(quote).total;
    el('charge-amount').textContent = S.money(total);
    el('charge-date').value = S.today();

    // si tiene enlace de cobro, se le puede enseñar el QR al cliente
    var enlace = S.payUrl(total);
    var conQr = !!enlace && S.isRemote();
    el('charge-show-qr').hidden = !conQr;

    // si cobra por QR, que la forma de pago quede puesta sin tener que pensar
    el('charge-pay-link').hidden = !conQr;
    el('charge-pay-link-label').textContent =
      S.payment().provider === 'custom' ? 'Enlace de pago' : 'PayPal';
    el('charge-qr').hidden = true;
    el('charge-qr-img').innerHTML = enlace && S.isRemote()
      ? '<img alt="QR para pagar" width="208" height="208" src="' +
        esc(S.qrUrl(enlace, 7)) + '">'
      : '';
    el('charge-note').textContent = 'Se le pondrá el número ' + nextInvoiceNumber() +
      '. Las facturas van correlativas, así que ese número ya no se puede cambiar ' +
      'ni saltar.';
    check('charge-pay', 'Efectivo');
    el('charge-modal').hidden = false;
  }

  function doCharge() {
    var pago = document.querySelector('[name="charge-pay"]:checked');
    var quote = sync();
    quote.kind = 'factura';
    quote.invoiceNumber = nextInvoiceNumber();
    quote.issuedAt = el('charge-date').value || S.today();
    quote.payMethod = pago ? pago.value : '';
    quote.status = 'aceptado';

    // el select del formulario también, que si no el siguiente sync()
    // vuelve a dejarlo en «borrador»
    el('quote-status').value = 'aceptado';
    el('charge-modal').hidden = true;
    S.saveQuote(quote);
    snapshot = JSON.stringify(current);
    onChange();
    render();
    applyKind();
    U.toast('Factura ' + quote.invoiceNumber + ' · ' + S.money(totals(quote).total));

    // lo normal al cobrar es querer el papel en la mano
    openPrint();
  }

  /* Deja el editor con la cara que toque: presupuesto o factura */
  function applyKind() {
    if (!current) return;
    var factura = current.kind === 'factura';
    el('quote-title').textContent = factura
      ? 'Factura ' + (current.invoiceNumber || '')
      : (current.number ? 'Presupuesto ' + current.number : 'Nuevo presupuesto');
    el('quote-charge').hidden = factura;
    el('quote-print').textContent = factura ? 'Imprimir factura' : 'Imprimir';

    // una factura ya no es un borrador que se apruebe: su número manda
    el('quote-number-box').hidden = factura;
    el('quote-status-box').hidden = factura;
    el('quote-invoice-box').hidden = !factura;
    setValue('invoiceNumber', current.invoiceNumber);
  }

  function remove() {
    if (!current) return;
    if (current.kind === 'factura') {
      if (!confirm('Vas a borrar la factura ' + current.invoiceNumber + '.\n\n' +
                   'Una factura emitida no se borra: se hace una rectificativa. Si la ' +
                   'borras quedará un hueco en la numeración y eso a Hacienda no le vale.\n\n' +
                   '¿Aun así quieres borrarla?')) return;
    } else if (!confirm('¿Borrar el presupuesto ' + current.number + '?')) return;
    S.removeQuote(current.id);
    close(true);
    render();
    onChange();
    U.toast('Presupuesto borrado');
  }

  /* ── Arranque ────────────────────────────────────────────── */
  function init(options) {
    onChange = (options && options.onChange) || function () {};

    el('quote-new').addEventListener('click', function () { open(null); });
    el('quote-close').addEventListener('click', function () { close(false); });
    el('quote-cancel').addEventListener('click', function () { close(false); });
    el('quote-backdrop').addEventListener('click', function () { close(false); });
    el('quote-delete').addEventListener('click', remove);
    el('quote-print').addEventListener('click', openPrint);
    el('quote-charge').addEventListener('click', openCharge);

    el('charge-close').addEventListener('click', function () { el('charge-modal').hidden = true; });
    el('charge-cancel').addEventListener('click', function () { el('charge-modal').hidden = true; });
    el('charge-go').addEventListener('click', doCharge);

    el('charge-show-qr').addEventListener('click', function () {
      var qr = el('charge-qr');
      qr.hidden = !qr.hidden;
      el('charge-show-qr').textContent = qr.hidden ? 'Enseñar QR' : 'Ocultar QR';
      if (!qr.hidden) {
        var opcion = document.querySelector('#charge-pay-link input');
        if (opcion) opcion.checked = true;
      }
    });
    el('charge-modal').addEventListener('click', function (e) {
      if (e.target === el('charge-modal')) el('charge-modal').hidden = true;
    });

    el('doc-close').addEventListener('click', closePrint);
    el('doc-cancel').addEventListener('click', closePrint);
    el('doc-modal').addEventListener('click', function (e) {
      if (e.target === el('doc-modal')) closePrint();
    });

    el('doc-go').addEventListener('click', function () {
      var url = docUrl();
      closePrint();
      S.quotesSaved().then(function () {
        var win = global.open(url, '_blank');
        if (!win) return U.toast('El navegador ha bloqueado la ventana. Prueba con «Descargar».');
        try { win.addEventListener('load', function () { win.print(); }); } catch (err) { /* da igual */ }
      });
    });

    el('doc-download').addEventListener('click', function () {
      var url = docUrl();
      closePrint();
      S.quotesSaved().then(function () {
        var a = document.createElement('a');
        a.href = url + (url.indexOf('?') > -1 ? '&' : '?') + 'download=1';
        a.rel = 'noopener';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    });

    el('quote-save').addEventListener('click', function () {
      var quote = save();
      if (!quote) return;
      close(true);
      render();
      U.toast(quote.kind === 'factura' ? 'Factura guardada' : 'Presupuesto guardado');
    });

    el('quote-list').addEventListener('click', function (e) {
      var card = e.target.closest('[data-quote]');
      if (card) open(S.quote(card.dataset.quote));
    });

    el('quote-add-line').addEventListener('click', function () {
      sync();
      current.lines.push({ id: S.uid(), concept: '', note: '', qty: 1, unitPrice: 0 });
      renderLines();
      renderTotals();
      var inputs = el('quote-lines').querySelectorAll('.qline-concept');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    /* Una línea sacada de la tarifa del proveedor, con su precio puesto */
    el('quote-from-catalog').addEventListener('click', function () {
      sync();
      global.Catalog.pick({
        title: 'Añadir pieza al presupuesto',
        query: [(current.device || {}).brand, (current.device || {}).model]
          .filter(Boolean).join(' '),
        onPick: function (item) {
          current.lines.push({
            id: S.uid(),
            concept: item.name,
            note: item.ref ? 'Ref. ' + item.ref : '',
            qty: 1,
            unitPrice: S.num(item.price)
          });
          renderLines();
          renderTotals();
          U.toast(item.name + ' · ' + S.money(item.price));
        }
      });
    });

    el('quote-lines').addEventListener('click', function (e) {
      if (!e.target.classList.contains('part-del')) return;
      sync();
      var id = e.target.closest('.qline').dataset.line;
      current.lines = current.lines.filter(function (l) { return l.id !== id; });
      renderLines();
      renderTotals();
    });

    var form = el('quote-form');
    form.addEventListener('input', function () { if (current) { sync(); renderTotals(); } });
    form.addEventListener('change', function () { if (current) { sync(); renderTotals(); } });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
  }

  global.Quotes = {
    init: init,
    render: render,
    open: open,
    close: close,
    fromTicket: fromTicket,
    totals: totals,
    isOpen: function () { return !el('quote-drawer').hidden; },
    STATUSES: STATUSES
  };
})(window);
