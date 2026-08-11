/* ============================================================
   shop.js — mini navegador de repuestos en una esquina

   Muchas tiendas (y Wallapop) mandan cabeceras que impiden verse
   dentro de otra web. Cada tienda se abre de una de tres maneras:

     · «Por el servidor»: la página la pide server.py y la sirve desde
       aquí, así que el navegador ya no la bloquea. Es lo que se usa por
       defecto cuando hay servidor.
     · «Directa»: el marco carga la tienda tal cual. Sólo va con las que
       no bloquean el marco, pero conserva tu sesión y tus cookies.
     · «Siempre fuera»: ni se intenta; se abre en una ventana aparte.
       Es lo suyo para Wallapop, que necesita tu sesión iniciada.

   El navegador no deja saber si una web ha bloqueado el marco (una
   página bloqueada y una buena se ven igual desde fuera), así que el
   botón de «abrir fuera» está siempre a mano.
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Store;
  var POPUP_NAME = 'taller-repuestos';

  var panel, iframe, sourceSelect, queryInput, quickEl, modeSelect, modeHint, outLink;
  var currentUrl = '';

  var MODE_HINTS = {
    servidor: 'La trae tu servidor, por eso se deja ver aquí',
    directo: 'Si sale en blanco, esa web bloquea el marco',
    fuera: 'Esta tienda se abre en una ventana aparte'
  };

  function el(id) { return document.getElementById(id); }

  function buildUrl(shop, query) {
    if (!shop) return '';
    if (shop.url.indexOf('{q}') === -1) return shop.url;
    return shop.url.replace('{q}', encodeURIComponent(query || ''));
  }

  function shopById(id) {
    var list = S.shops();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  function currentShop() { return shopById(sourceSelect.value); }

  /* ── Abrir en ventana aparte (siempre funciona) ──────────── */
  function openOutside(url) {
    url = url || currentUrl;
    if (!url) return false;
    var width = 480, height = Math.min(820, global.screen.availHeight - 60);
    var left = Math.max(0, global.screen.availWidth - width - 20);
    var features = 'popup=yes,width=' + width + ',height=' + height +
                   ',left=' + left + ',top=40,resizable=yes,scrollbars=yes';
    var win = null;
    try { win = global.open(url, POPUP_NAME, features); } catch (err) { win = null; }
    if (win) { win.focus(); return true; }
    return false;      // bloqueada: que se encargue el enlace
  }

  /* ── Cargar dentro del panel ─────────────────────────────── */
  function load(url) {
    currentUrl = url;
    syncOutLink();

    var shop = currentShop() || {};
    var mode = shop.mode || 'directo';
    if (mode === 'servidor' && !S.isRemote()) mode = 'directo';   // sin servidor no hay proxy
    modeSelect.value = mode;
    modeHint.textContent = MODE_HINTS[mode] || '';

    if (mode === 'fuera') {
      iframe.removeAttribute('src');
      iframe.srcdoc = '<p style="font:15px system-ui;color:#666;padding:28px;text-align:center;' +
        'line-height:1.5">' + esc(shop.name || 'Esta tienda') + ' está puesta para abrirse ' +
        'en una ventana aparte.<br>Dale al botón <b>Abrir fuera ↗</b> de aquí abajo.</p>';
      return;
    }

    iframe.removeAttribute('srcdoc');
    if (mode === 'servidor') {
      // Sin «allow-same-origin»: la tienda llega desde nuestra dirección, así
      // que sin esto podría leer los datos de la aplicación.
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
      iframe.src = S.proxyUrl(url);
    } else {
      iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
      iframe.src = url;
    }
  }

  /* El botón de abrir fuera es un enlace de verdad: así, si el navegador
     bloquea la ventanita, al menos abre en una pestaña nueva. */
  function syncOutLink() {
    if (!outLink) return;
    if (currentUrl) outLink.href = currentUrl;
    else outLink.removeAttribute('href');
  }

  function search(query, shopId) {
    if (shopId) sourceSelect.value = shopId;
    if (query != null) queryInput.value = query;
    var url = buildUrl(currentShop(), queryInput.value);
    if (url) load(url);
  }

  /* ── Abrir / cerrar el panel ─────────────────────────────── */
  function open(options) {
    options = options || {};
    panel.hidden = false;
    S.prefs({ shopOpen: true });
    renderSources();
    renderQuick();
    if (options.query != null || options.shop) search(options.query, options.shop);
    else if (!currentUrl) search(queryInput.value || '');
  }

  function close() {
    panel.hidden = true;
    S.prefs({ shopOpen: false });
  }

  function toggle() { if (panel.hidden) open(); else close(); }

  function isOpen() { return !panel.hidden; }

  /* ── Pintado ─────────────────────────────────────────────── */
  function renderSources() {
    var list = S.shops();
    var previous = sourceSelect.value || S.prefs().shopSource;
    sourceSelect.innerHTML = list.map(function (shop) {
      return '<option value="' + esc(shop.id) + '">' + esc(shop.name) + '</option>';
    }).join('');
    if (previous && list.some(function (s) { return s.id === previous; })) sourceSelect.value = previous;
  }

  /* Accesos directos de Wallapop: sólo tienen sentido con sesión iniciada,
     así que van directos a ventana aparte. */
  function renderQuick() {
    quickEl.innerHTML = S.WALLAPOP_LINKS.map(function (link) {
      return '<a class="shop-chip" href="' + esc(link.url) + '" target="_blank" rel="noopener">' +
        esc(link.name) + ' ↗</a>';
    }).join('');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── Arrastrar el panel por su cabecera ──────────────────── */
  function makeDraggable(handle) {
    var dragging = false, startX = 0, startY = 0, startRight = 0, startBottom = 0;

    handle.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      var rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startRight = global.innerWidth - rect.right;
      startBottom = global.innerHeight - rect.bottom;
      panel.classList.add('is-dragging');
    });

    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var right = Math.max(0, Math.min(global.innerWidth - 120, startRight - (e.clientX - startX)));
      var bottom = Math.max(0, Math.min(global.innerHeight - 80, startBottom - (e.clientY - startY)));
      panel.style.right = right + 'px';
      panel.style.bottom = bottom + 'px';
      panel.classList.add('is-moved');
    });

    function stop(e) {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('is-dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* ya soltado */ }
    }
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  /* ── Arranque ────────────────────────────────────────────── */
  function init() {
    panel = el('shop');
    iframe = el('shop-iframe');
    sourceSelect = el('shop-source');
    queryInput = el('shop-query');
    quickEl = el('shop-quick');
    modeSelect = el('shop-mode');
    modeHint = el('shop-mode-hint');

    renderSources();
    renderQuick();

    el('shop-close').addEventListener('click', close);
    el('shop-open-out').addEventListener('click', function () {
      if (!openOutside() && currentUrl) global.open(currentUrl, '_blank', 'noopener');
    });
    el('shop-go').addEventListener('click', function () { search(); });
    outLink = el('shop-blocked-open');
    syncOutLink();
    outLink.addEventListener('click', function (e) {
      if (openOutside()) e.preventDefault();   // si cabe la ventanita, mejor que una pestaña
    });

    queryInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); search(); }
    });

    sourceSelect.addEventListener('change', function () {
      S.prefs({ shopSource: sourceSelect.value });
      search();
    });

    modeSelect.addEventListener('change', function () {
      var shop = currentShop();
      if (!shop) return;
      var mode = modeSelect.value;
      var list = S.shops().map(function (s) {
        return s.id === shop.id ? Object.assign({}, s, { mode: mode, popup: mode === 'fuera' }) : s;
      });
      S.saveShops(list);
      if (global.UI) global.UI.renderShopSettings();
      load(currentUrl);
    });

    quickEl.addEventListener('click', function (e) {
      var chip = e.target.closest('.shop-chip');
      if (chip && openOutside(chip.href)) e.preventDefault();
    });

    makeDraggable(panel.querySelector('.shop-head'));

    if (S.prefs().shopOpen) open();
  }

  global.Shop = {
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    search: search,
    openOutside: openOutside,
    renderSources: renderSources,
    buildUrl: buildUrl
  };
})(window);
