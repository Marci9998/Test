/* ============================================================
   app.js — arranque y eventos
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Store, C = global.CSV, U = global.UI, Shop = global.Shop;
  var el = U.el;

  var filter = { status: 'todos', query: '', sort: 'updated' };
  var current = null;       // ficha abierta en el panel lateral
  var snapshot = '';        // copia para detectar cambios sin guardar
  var fileMode = 'json';    // qué esperamos del <input type=file>

  /* ── Tema ────────────────────────────────────────────────── */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1216' : '#f5f6f8');
    S.prefs({ theme: theme });
  }

  function initTheme() {
    var saved = S.prefs().theme;
    if (!saved) {
      saved = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(saved);
  }

  /* ── Refrescos ───────────────────────────────────────────── */
  function refresh() {
    U.renderPanel();
    U.renderChips(filter.status);
    U.renderList(filter);
    U.renderSuggestions();
    U.renderProfiles();
  }

  /* Texto que se manda al buscador de repuestos: modelo + pieza */
  function searchTerms(partName) {
    if (!current) return partName || '';
    var device = [current.brand, current.model, current.storage].filter(Boolean).join(' ').trim();
    return [device, partName || ''].filter(Boolean).join(' ').trim();
  }

  /* ── Navegación por pestañas ─────────────────────────────── */
  function showView(name) {
    ['panel', 'fichas', 'datos'].forEach(function (v) {
      el('view-' + v).classList.toggle('is-active', v === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.classList.toggle('is-active', tab.dataset.view === name);
    });
    S.prefs({ view: name });
  }

  /* ── Panel lateral (ficha) ───────────────────────────────── */
  function openTicket(ticket) {
    current = S.normalize(ticket || S.blank());
    snapshot = JSON.stringify(current);

    el('drawer-title').textContent = ticket ? S.title(current) : 'Nueva ficha';
    el('delete-ticket').hidden = !ticket;

    var form = el('ticket-form');
    form.reset();

    Array.prototype.forEach.call(form.querySelectorAll('[name]'), function (input) {
      var key = input.name;
      if (key === 'type') { input.checked = input.value === current.type; return; }
      if (key === 'status') return;                    // se pinta aparte
      var value = current[key];
      if (typeof value === 'number') value = value ? String(value).replace('.', ',') : '';
      input.value = value == null ? '' : value;
    });

    U.renderStatusOptions(current.type, current.status);
    U.renderParts(current.parts);
    applyType();
    U.renderSummary(current);

    el('drawer').hidden = false;
    el('drawer-backdrop').hidden = false;
    document.body.classList.add('drawer-open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var first = el('ticket-form').querySelector('[name="model"]');
      if (first && !ticket) first.focus();
    }, 60);
  }

  function closeDrawer(force) {
    if (!force && current && JSON.stringify(syncFromForm()) !== snapshot) {
      if (!confirm('Tienes cambios sin guardar. ¿Cerrar de todas formas?')) return;
    }
    el('drawer').hidden = true;
    el('drawer-backdrop').hidden = true;
    document.body.classList.remove('drawer-open');
    document.body.style.overflow = '';
    current = null;
  }

  /* Muestra u oculta los campos que sólo aplican a un tipo */
  function applyType() {
    var type = current.type;
    Array.prototype.forEach.call(document.querySelectorAll('[data-only]'), function (node) {
      node.hidden = node.dataset.only !== type;
    });
    var listLabel = document.querySelector('[data-label="list"]');
    var saleLabel = document.querySelector('[data-label="sale"]');
    if (listLabel) listLabel.textContent = type === 'cliente' ? 'Presupuesto al cliente (€)' : 'Precio en Wallapop (€)';
    if (saleLabel) saleLabel.textContent = type === 'cliente' ? 'Cobrado al final (€)' : 'Precio final de venta (€)';
  }

  /* Lee el formulario y devuelve la ficha actualizada */
  function syncFromForm() {
    if (!current) return null;
    var form = el('ticket-form');

    Array.prototype.forEach.call(form.querySelectorAll('[name]'), function (input) {
      var key = input.name;
      if (key === 'type') { if (input.checked) current.type = input.value; return; }
      if (['purchaseCost', 'extraCost', 'listPrice', 'salePrice'].indexOf(key) > -1) {
        current[key] = S.num(input.value);
      } else {
        current[key] = input.value;
      }
    });

    current.parts = Array.prototype.map.call(form.querySelectorAll('.part'), function (row) {
      return {
        id: row.dataset.part,
        name: row.querySelector('.part-name').value,
        qty: S.num(row.querySelector('.part-qty').value) || 1,
        unitCost: S.num(row.querySelector('.part-cost').value)
      };
    });

    return current;
  }

  function saveTicket() {
    var ticket = syncFromForm();
    if (!ticket.model.trim() && !ticket.brand.trim()) {
      U.toast('Ponle al menos la marca o el modelo');
      el('ticket-form').querySelector('[name="model"]').focus();
      return;
    }
    ticket.parts = ticket.parts.filter(function (p) { return p.name.trim() || p.unitCost; });
    S.upsert(ticket);
    closeDrawer(true);
    refresh();
    U.toast('Ficha guardada');
  }

  function deleteTicket() {
    if (!current) return;
    if (!confirm('¿Borrar esta ficha? No se puede deshacer.')) return;
    S.remove(current.id);
    closeDrawer(true);
    refresh();
    U.toast('Ficha borrada');
  }

  /* ── Importar / exportar ─────────────────────────────────── */
  function exportJSON() {
    C.download('taller-copia-' + C.stamp() + '.json',
      JSON.stringify(S.all(), null, 2), 'application/json;charset=utf-8');
    U.toast('Copia descargada');
  }

  function exportCSV() {
    if (!S.all().length) return U.toast('No hay nada que exportar');
    C.download('taller-' + C.stamp() + '.csv', C.toCSV(S.all()), 'text/csv;charset=utf-8');
    U.toast('CSV descargado');
  }

  function pickFile(mode) {
    fileMode = mode;
    var input = el('file-input');
    input.value = '';
    input.accept = mode === 'csv' ? '.csv,text/csv' : '.json,application/json';
    input.click();
  }

  function handleFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result);
      if (fileMode === 'json') importJSON(text);
      else openCSVModal(text);
    };
    reader.onerror = function () { U.toast('No se pudo leer el fichero'); };
    reader.readAsText(file, 'utf-8');
  }

  function importJSON(text) {
    var data;
    try { data = JSON.parse(text); } catch (err) { return U.toast('Ese fichero no es una copia válida'); }
    if (!Array.isArray(data)) return U.toast('Ese fichero no es una copia válida');
    if (S.all().length && !confirm('Vas a sustituir las ' + S.all().length + ' fichas actuales por las ' + data.length + ' de la copia. ¿Seguimos?')) return;
    S.replaceAll(data);
    refresh();
    U.toast(data.length + ' fichas restauradas');
  }

  /* ── Modal de mapeo del CSV ──────────────────────────────── */
  var csvParsed = null;

  function openCSVModal(text) {
    csvParsed = C.parse(text);
    if (!csvParsed.headers.length || !csvParsed.rows.length) return U.toast('Ese CSV está vacío');

    var guess = C.guessMapping(csvParsed.headers);
    var options = ['<option value="">— ninguna —</option>'].concat(
      csvParsed.headers.map(function (h) { return '<option value="' + U.esc(h) + '">' + U.esc(h) + '</option>'; })
    ).join('');

    el('csv-map').innerHTML = C.FIELDS.map(function (f) {
      return '<label><span>' + U.esc(f.label) + '</span>' +
        '<select data-field="' + f.key + '">' + options + '</select></label>';
    }).join('');

    Object.keys(guess).forEach(function (key) {
      var select = el('csv-map').querySelector('[data-field="' + key + '"]');
      if (select) select.value = guess[key];
    });

    el('csv-count').textContent = csvParsed.rows.length + ' filas detectadas · ' +
      csvParsed.headers.length + ' columnas.';
    el('csv-modal').hidden = false;
  }

  function confirmCSV() {
    var mapping = {};
    Array.prototype.forEach.call(el('csv-map').querySelectorAll('select'), function (select) {
      if (select.value) mapping[select.dataset.field] = select.value;
    });

    var tickets = C.toTickets(csvParsed, mapping);
    if (!tickets.length) return U.toast('No se ha podido leer ninguna fila; revisa el mapeo');

    S.addMany(tickets);
    el('csv-modal').hidden = true;
    csvParsed = null;
    filter.status = 'todos';
    refresh();
    showView('fichas');
    U.toast(tickets.length + ' fichas importadas');
  }

  /* ── Perfiles ────────────────────────────────────────────── */
  var editingProfile = null;

  function openProfileModal(id) {
    editingProfile = id;
    var profile = id ? S.profiles().filter(function (p) { return p.id === id; })[0] : null;
    el('profile-modal-title').textContent = profile ? 'Renombrar perfil' : 'Nuevo perfil';
    el('profile-name').value = profile ? profile.name : '';
    el('profile-modal').hidden = false;
    setTimeout(function () { el('profile-name').focus(); }, 50);
  }

  function closeProfileModal() {
    el('profile-modal').hidden = true;
    editingProfile = null;
  }

  function saveProfile() {
    var name = el('profile-name').value.trim();
    if (!name) return U.toast('Ponle un nombre');

    var action = editingProfile
      ? S.renameProfile(editingProfile, name)
      : S.createProfile(name).then(function (profile) { return S.setActiveProfile(profile.id); });

    action.then(function () {
      closeProfileModal();
      filter.status = 'todos';
      refresh();
      U.toast('Perfil guardado');
    }).catch(function (err) { U.toast(err.message); });
  }

  /* ── Tiendas ─────────────────────────────────────────────── */
  function saveShopSettings() {
    var list = Array.prototype.map.call(el('shop-settings').querySelectorAll('.shop-row'), function (row) {
      return {
        id: row.dataset.shop,
        name: row.querySelector('.shop-name').value.trim() || 'Tienda',
        url: row.querySelector('.shop-url').value.trim(),
        popup: row.querySelector('.shop-popup-box').checked
      };
    }).filter(function (shop) { return shop.url; });

    S.saveShops(list);
    Shop.renderSources();
  }

  /* ── Fichas de ejemplo ───────────────────────────────────── */
  function loadDemo() {
    if (S.all().length && !confirm('Se añadirán 3 fichas de ejemplo a las que ya tienes. ¿Seguimos?')) return;
    var d = new Date();
    function daysAgo(n) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
      return x.toISOString().slice(0, 10);
    }
    S.addMany([
      {
        type: 'reventa', brand: 'Xiaomi', model: 'Redmi Note 11', storage: '128 GB', color: 'Azul',
        status: 'vendido', issue: 'Pantalla rota', purchaseCost: 45, extraCost: 4,
        parts: [{ name: 'Pantalla completa', qty: 1, unitCost: 28 }],
        listPrice: 130, salePrice: 125, createdAt: daysAgo(24), soldAt: daysAgo(9),
        notes: 'Vendido en Wallapop, entrega en mano.'
      },
      {
        type: 'reventa', brand: 'Samsung', model: 'Galaxy A52', storage: '128 GB', color: 'Negro',
        status: 'publicado', issue: 'No cargaba: puerto sucio + batería gastada', purchaseCost: 60, extraCost: 3,
        parts: [{ name: 'Batería', qty: 1, unitCost: 15 }, { name: 'Puerto de carga', qty: 1, unitCost: 6 }],
        listPrice: 145, createdAt: daysAgo(11)
      },
      {
        type: 'cliente', brand: 'Apple', model: 'iPhone 11', storage: '64 GB',
        customerName: 'Laura', customerPhone: '600 111 222',
        status: 'piezas', issue: 'Cambio de pantalla', extraCost: 0,
        parts: [{ name: 'Pantalla incell', qty: 1, unitCost: 32 }],
        listPrice: 85, createdAt: daysAgo(3), notes: 'Pieza pedida el lunes.'
      }
    ]);
    refresh();
    showView('fichas');
    U.toast('Ejemplos cargados');
  }

  /* ── Eventos ─────────────────────────────────────────────── */
  function wire() {
    el('theme-toggle').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    el('new-ticket').addEventListener('click', function () { openTicket(null); });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () { showView(tab.dataset.view); });
    });

    el('search').addEventListener('input', function () {
      filter.query = this.value.trim();
      U.renderList(filter);
      if (filter.query) showView('fichas');
    });

    el('status-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      filter.status = chip.dataset.status;
      U.renderChips(filter.status);
      U.renderList(filter);
    });

    el('sort').addEventListener('change', function () {
      filter.sort = this.value;
      U.renderList(filter);
    });

    el('list').addEventListener('click', function (e) {
      var card = e.target.closest('.ticket');
      if (card) openTicket(S.get(card.dataset.id));
    });

    ['attention', 'recent-sales'].forEach(function (id) {
      el(id).addEventListener('click', function (e) {
        var li = e.target.closest('li[data-id]');
        if (li) openTicket(S.get(li.dataset.id));
      });
    });

    /* Panel lateral */
    el('drawer-close').addEventListener('click', function () { closeDrawer(false); });
    el('cancel-ticket').addEventListener('click', function () { closeDrawer(false); });
    el('drawer-backdrop').addEventListener('click', function () { closeDrawer(false); });
    el('save-ticket').addEventListener('click', saveTicket);
    el('delete-ticket').addEventListener('click', deleteTicket);

    var form = el('ticket-form');

    function onFormChange(e) {
      if (!current) return;
      syncFromForm();
      if (e.target && e.target.name === 'type') {
        applyType();
        U.renderStatusOptions(current.type, current.status);
      }
      U.renderSummary(current);
    }

    form.addEventListener('input', onFormChange);
    form.addEventListener('change', onFormChange);

    form.addEventListener('submit', function (e) { e.preventDefault(); saveTicket(); });

    el('add-part').addEventListener('click', function () {
      syncFromForm();
      current.parts.push({ id: S.uid(), name: '', qty: 1, unitCost: 0 });
      U.renderParts(current.parts);
      var rows = el('parts').querySelectorAll('.part-name');
      if (rows.length) rows[rows.length - 1].focus();
    });

    el('parts').addEventListener('click', function (e) {
      var row = e.target.closest('.part');
      if (!row) return;

      if (e.target.closest('.part-search')) {
        syncFromForm();
        var name = row.querySelector('.part-name').value;
        Shop.open({ query: searchTerms(name) });
        return;
      }

      if (!e.target.closest('.part-del')) return;
      syncFromForm();
      var id = row.dataset.part;
      current.parts = current.parts.filter(function (p) { return p.id !== id; });
      U.renderParts(current.parts);
      U.renderSummary(current);
    });

    /* Buscador de repuestos */
    el('shop-toggle').addEventListener('click', function () {
      if (Shop.isOpen()) return Shop.close();
      Shop.open(current ? { query: searchTerms('') } : {});
    });

    /* Perfiles */
    el('profile-select').addEventListener('change', function () {
      var id = this.value;
      S.setActiveProfile(id).then(function () {
        filter.status = 'todos';
        refresh();
        U.toast('Perfil: ' + S.activeProfile().name);
      });
    });

    el('profile-new').addEventListener('click', function () { openProfileModal(null); });

    el('profile-list').addEventListener('click', function (e) {
      var button = e.target.closest('button[data-action]');
      if (!button) return;
      var id = button.closest('li').dataset.profile;
      if (button.dataset.action === 'rename') return openProfileModal(id);

      var profile = S.profiles().filter(function (p) { return p.id === id; })[0];
      if (!profile) return;
      if (!confirm('¿Borrar el perfil «' + profile.name + '» y todas sus fichas?')) return;
      S.deleteProfile(id).then(function () {
        refresh();
        U.toast('Perfil borrado');
      }).catch(function (err) { U.toast(err.message); });
    });

    el('profile-modal-close').addEventListener('click', closeProfileModal);
    el('profile-cancel').addEventListener('click', closeProfileModal);
    el('profile-save').addEventListener('click', saveProfile);
    el('profile-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveProfile(); }
    });

    /* Tiendas de repuestos */
    el('shop-settings').addEventListener('input', saveShopSettings);
    el('shop-settings').addEventListener('change', saveShopSettings);

    el('shop-settings').addEventListener('click', function (e) {
      var button = e.target.closest('[data-action="remove-shop"]');
      if (!button) return;
      var index = parseInt(button.dataset.index, 10);
      var list = S.shops().filter(function (_, i) { return i !== index; });
      S.saveShops(list);
      U.renderShopSettings();
      Shop.renderSources();
    });

    el('shop-add').addEventListener('click', function () {
      var list = S.shops().concat([{ id: S.uid().slice(0, 8), name: 'Nueva tienda', url: 'https://ejemplo.com/buscar?q={q}' }]);
      S.saveShops(list);
      U.renderShopSettings();
      Shop.renderSources();
    });

    el('shop-reset').addEventListener('click', function () {
      S.saveShops(S.DEFAULT_SHOPS.slice());
      U.renderShopSettings();
      Shop.renderSources();
      U.toast('Tiendas restauradas');
    });

    /* Datos */
    el('export-json').addEventListener('click', exportJSON);
    el('export-csv').addEventListener('click', exportCSV);
    el('import-json').addEventListener('click', function () { pickFile('json'); });
    el('import-csv').addEventListener('click', function () { pickFile('csv'); });
    el('demo').addEventListener('click', loadDemo);

    el('wipe').addEventListener('click', function () {
      if (!S.all().length) return U.toast('Ya está todo vacío');
      if (!confirm('Se borrarán las ' + S.all().length + ' fichas de este navegador. ¿Seguro?')) return;
      if (!confirm('Última oportunidad: ¿de verdad quieres borrarlo todo?')) return;
      S.wipe();
      refresh();
      U.toast('Todo borrado');
    });

    el('file-input').addEventListener('change', function () {
      if (this.files && this.files[0]) handleFile(this.files[0]);
    });

    /* Modal CSV */
    el('csv-close').addEventListener('click', function () { el('csv-modal').hidden = true; });
    el('csv-cancel').addEventListener('click', function () { el('csv-modal').hidden = true; });
    el('csv-confirm').addEventListener('click', confirmCSV);

    /* Teclado */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!el('csv-modal').hidden) el('csv-modal').hidden = true;
        else if (!el('profile-modal').hidden) closeProfileModal();
        else if (!el('drawer').hidden) closeDrawer(false);
        else if (Shop.isOpen()) Shop.close();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        el('search').focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !el('drawer').hidden) {
        e.preventDefault();
        saveTicket();
      }
    });

    /* Aviso si se cierra la pestaña con la ficha a medias */
    global.addEventListener('beforeunload', function (e) {
      S.flush(true);                    // lo pendiente de guardar, sale ya
      if (current && JSON.stringify(syncFromForm()) !== snapshot) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /* ── Arranque ────────────────────────────────────────────── */
  function init() {
    initTheme();
    S.onError(function (message) { U.toast(message); });

    S.init().then(function (info) {
      wire();
      Shop.init();
      refresh();
      U.renderShopSettings();
      U.renderStorageInfo();

      var view = S.prefs().view;
      showView(['panel', 'fichas', 'datos'].indexOf(view) > -1 ? view : 'panel');

      if (!info.remote && location.protocol !== 'file:') {
        U.toast('Sin servidor: los datos se guardan sólo en este navegador');
      }
    }).catch(function (err) {
      console.error(err);
      document.body.insertAdjacentHTML('afterbegin',
        '<p class="empty">No se pudieron cargar los datos: ' + U.esc(err.message) + '</p>');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
