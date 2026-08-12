/* ============================================================
   catalog.js — elegir la pieza de la tarifa del proveedor

   En vez de ir a la web de la tienda, mirar el precio y volver a
   escribirlo a mano, se abre esta ventanita ya buscando el modelo
   que tienes encima de la mesa: eliges la pieza y el nombre y el
   precio se ponen solos en la ficha o en el presupuesto.

   Lo que se busca está en el servidor (la tarifa entera puede tener
   decenas de miles de piezas), así que se pide según escribes, pero
   esperando un poco a que pares de teclear.
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Store;

  var box, input, results, hint, title, footNote;
  var onPick = null;
  var onShop = null;
  var timer = null;
  var lastQuery = '';

  function el(id) { return document.getElementById(id); }
  function esc(s) { return global.UI.esc(s); }

  /* ── Abrir el buscador ───────────────────────────────────── */
  function pick(options) {
    options = options || {};
    onPick = options.onPick || null;
    onShop = options.onShop || null;

    title.textContent = options.title || 'Elegir pieza de la tarifa';
    input.value = options.query || '';
    box.hidden = false;
    document.body.classList.add('picker-open');

    var piezas = S.catalogPieces();
    footNote.textContent = piezas
      ? piezas.toLocaleString('es-ES') + ' piezas en tus tarifas'
      : 'sin tarifas cargadas';

    input.focus();
    input.select();
    if (input.value) run(input.value);
    else showHint('Escribe el modelo y la pieza: «iphone 11 pantalla».');
  }

  function close() {
    box.hidden = true;
    document.body.classList.remove('picker-open');
    onPick = null;
    onShop = null;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function isOpen() { return !box.hidden; }

  /* ── Buscar ──────────────────────────────────────────────── */
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { run(input.value); }, 220);
  }

  function run(query) {
    query = (query || '').trim();
    lastQuery = query;

    if (query.length < 2) {
      results.innerHTML = '';
      showHint('Escribe al menos dos letras.');
      return;
    }

    showHint('Buscando…');
    S.searchCatalog(query, 40).then(function (items) {
      if (query !== lastQuery) return;          // llegó tarde: ya hay otra búsqueda
      render(items, query);
    });
  }

  function showHint(text) {
    hint.textContent = text;
    hint.hidden = !text;
  }

  function render(items, query) {
    if (!items.length) {
      results.innerHTML = '';
      showHint(S.catalogPieces()
        ? 'Nada con «' + query + '» entre tus ' + S.catalogPieces() + ' piezas. ' +
          'Prueba con menos palabras.'
        : 'Todavía no has cargado ninguna tarifa. Ve a Datos → Tarifas de proveedor.');
      return;
    }

    showHint('');
    results.innerHTML = items.map(function (item, i) {
      var stock = String(item.stock == null ? '' : item.stock).trim();
      var agotado = stock === '0' || /^(no|sin|agotado|out)/i.test(stock);

      return '<button type="button" class="cat-item" data-i="' + i + '">' +
        '<span class="cat-main">' +
          '<span class="cat-name">' + esc(item.name) + '</span>' +
          '<span class="cat-sub">' +
            (item.ref ? '<span class="tag">' + esc(item.ref) + '</span>' : '') +
            '<span class="tag">' + esc(item.sourceName || 'tarifa') + '</span>' +
            (stock ? '<span class="tag' + (agotado ? ' is-bad' : '') + '">' +
              (agotado ? 'sin stock' : 'stock ' + esc(stock)) + '</span>' : '') +
          '</span>' +
        '</span>' +
        '<span class="cat-price">' + esc(S.money(item.price)) + '</span>' +
      '</button>';
    }).join('');

    results._items = items;
  }

  /* ── Arranque ────────────────────────────────────────────── */
  function init() {
    box = el('catalog-picker');
    input = el('catalog-query');
    results = el('catalog-results');
    hint = el('catalog-hint');
    title = el('catalog-picker-title');
    footNote = el('catalog-foot-note');

    el('catalog-close').addEventListener('click', close);
    el('catalog-backdrop').addEventListener('click', close);

    // si en la tarifa no está, se sale a las tiendas con lo que hubiera escrito
    el('catalog-to-shop').addEventListener('click', function () {
      var query = input.value;
      var callback = onShop;
      close();
      if (callback) callback(query);
      else global.Shop.open({ query: query });
    });

    input.addEventListener('input', schedule);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); run(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      // bajar a la lista con la flecha, para no tener que soltar el teclado
      if (e.key === 'ArrowDown') {
        var first = results.querySelector('.cat-item');
        if (first) { e.preventDefault(); first.focus(); }
      }
    });

    results.addEventListener('click', function (e) {
      var button = e.target.closest('.cat-item');
      if (!button || !results._items) return;
      var item = results._items[parseInt(button.dataset.i, 10)];
      if (!item) return;
      var callback = onPick;
      close();
      if (callback) callback(item);
    });

    // En captura y parando la propagación: si no, el Escape sigue su camino
    // hasta el manejador general y cierra también la ficha de debajo.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }, true);
  }

  global.Catalog = {
    init: init,
    pick: pick,
    close: close,
    isOpen: isOpen,
    /* ¿merece la pena ofrecer el catálogo, o no hay nada cargado? */
    ready: function () { return S.isRemote() && S.catalogPieces() > 0; }
  };
})(window);
