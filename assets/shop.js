/* ============================================================
   shop.js — mini navegador de repuestos en una esquina

   Muchas tiendas (y Wallapop) mandan cabeceras que impiden verse
   dentro de otra web, y el navegador no deja saber si ha pasado:
   una página bloqueada y una que ha cargado bien se ven igual desde
   fuera (las dos dan SecurityError al mirarlas). Por eso no se
   intenta adivinar: el botón de «abrir fuera» está siempre a mano,
   y cada tienda se puede marcar para que se abra directamente en
   una ventana aparte, que sí funciona siempre.
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Store;
  var POPUP_NAME = 'taller-repuestos';

  var panel, iframe, sourceSelect, queryInput, quickEl, rememberBox;
  var currentUrl = '';

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
    if (!url) return;
    var width = 480, height = Math.min(820, global.screen.availHeight - 60);
    var left = Math.max(0, global.screen.availWidth - width - 20);
    var features = 'popup=yes,width=' + width + ',height=' + height +
                   ',left=' + left + ',top=40,resizable=yes,scrollbars=yes';
    var win = global.open(url, POPUP_NAME, features);
    if (!win) {
      // el navegador ha bloqueado la ventana emergente
      global.open(url, '_blank', 'noopener');
    } else {
      win.focus();
    }
  }

  /* ── Cargar dentro del panel ─────────────────────────────── */
  function load(url) {
    currentUrl = url;
    var shop = currentShop() || {};
    rememberBox.checked = !!shop.popup;

    if (shop.popup) {                  // esta tienda va siempre en ventana aparte
      iframe.removeAttribute('src');
      iframe.srcdoc = '<p style="font:15px system-ui;color:#666;padding:24px;text-align:center">' +
        'Esta tienda se abre en una ventana aparte.</p>';
      openOutside(url);
      return;
    }

    iframe.removeAttribute('srcdoc');
    iframe.src = url;
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
      return '<button type="button" class="shop-chip" data-url="' + esc(link.url) + '">' +
        esc(link.name) + ' ↗</button>';
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
    rememberBox = el('shop-remember');

    renderSources();
    renderQuick();

    el('shop-close').addEventListener('click', close);
    el('shop-open-out').addEventListener('click', function () { openOutside(); });
    el('shop-go').addEventListener('click', function () { search(); });
    el('shop-blocked-open').addEventListener('click', function () { openOutside(); });

    queryInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); search(); }
    });

    sourceSelect.addEventListener('change', function () {
      S.prefs({ shopSource: sourceSelect.value });
      search();
    });

    rememberBox.addEventListener('change', function () {
      var shop = currentShop();
      if (!shop) return;
      var list = S.shops().map(function (s) {
        return s.id === shop.id ? Object.assign({}, s, { popup: rememberBox.checked }) : s;
      });
      S.saveShops(list);
      if (global.UI) global.UI.renderShopSettings();
      if (rememberBox.checked) load(currentUrl);
    });

    quickEl.addEventListener('click', function (e) {
      var chip = e.target.closest('.shop-chip');
      if (chip) openOutside(chip.dataset.url);
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
