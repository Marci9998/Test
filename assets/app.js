/* ============================================================
   app.js — arranque y eventos
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Store, C = global.CSV, U = global.UI, Shop = global.Shop,
      Quotes = global.Quotes, Batches = global.Batches;
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
    U.renderStorageInfo();      // los textos nombran al perfil abierto
    Quotes.render();
    Batches.render();
  }

  /* Mete en su fila la pieza elegida de la tarifa: nombre y precio */
  function fillPart(partId, item) {
    syncFromForm();
    current.parts.forEach(function (part) {
      if (part.id !== partId) return;
      part.name = item.name;
      part.unitCost = S.num(item.price);
      if (!part.qty) part.qty = 1;
    });
    U.renderParts(current.parts);
    U.renderSummary(current);
    U.toast(item.name + ' · ' + S.money(item.price));
  }

  /* Texto que se manda al buscador de repuestos: modelo + pieza */
  function searchTerms(partName) {
    if (!current) return partName || '';
    var device = [current.brand, current.model, current.storage].filter(Boolean).join(' ').trim();
    return [device, partName || ''].filter(Boolean).join(' ').trim();
  }

  /* ── Navegación por pestañas ─────────────────────────────── */
  function showView(name) {
    ['panel', 'fichas', 'lotes', 'presupuestos', 'datos'].forEach(function (v) {
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
    el('ticket-print').hidden = !ticket || !S.isRemote();

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
    loadFiles();

    el('drawer').hidden = false;
    el('drawer-backdrop').hidden = false;
    document.body.classList.add('drawer-open');
    document.body.style.overflow = 'hidden';

    // Enfocar ya, no con retardo: si tarda, roba el foco a media palabra
    // cuando alguien escribe rápido nada más abrir la ficha.
    if (!ticket) {
      var first = el('ticket-form').querySelector('[name="model"]');
      if (first) first.focus();
    }
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

  /* ── Adjuntos de la ficha (diagnóstico del M360, fotos…) ─── */
  function renderFiles(files) {
    var list = el('files-list');
    if (!files.length) {
      list.innerHTML = '<li class="mini-empty">Todavía no hay nada adjunto.</li>';
      return;
    }
    list.innerHTML = files.map(function (f) {
      var esDiag = f.kind === 'diagnostico';
      return '<li data-file="' + U.esc(f.id) + '">' +
        '<div class="mini-main">' +
          '<div class="mini-title">' + (f.ext === '.pdf' ? '📄 ' : '🖼️ ') + U.esc(f.name) +
            (esDiag ? ' <span class="tag">diagnóstico</span>' : '') + '</div>' +
          '<div class="mini-sub">' + U.esc(fileSize(f.size)) + ' · ' + U.esc(f.uploadedAt) + '</div>' +
        '</div>' +
        '<a class="btn sm" href="' + U.esc(S.fileUrl(f.id)) + '" target="_blank" rel="noopener">Abrir</a>' +
        '<button type="button" class="btn sm btn-danger-ghost" data-remove="' + U.esc(f.id) + '">Quitar</button>' +
      '</li>';
    }).join('');
  }

  function fileSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (Math.round(bytes / 1024 / 102.4) / 10) + ' MB';
  }

  function loadFiles() {
    if (!current) return;
    var block = el('files-block');

    if (!S.isRemote()) {
      block.hidden = false;
      el('files-add').disabled = true;
      el('files-hint').textContent = 'Los adjuntos se guardan en el servidor, así que ' +
        'para esto hay que abrir la web por su dirección, no como fichero suelto.';
      el('files-list').innerHTML = '';
      return;
    }

    el('files-add').disabled = false;
    S.ticketFiles(current.id).then(renderFiles);
  }

  function uploadFiles(fileList) {
    if (!current || !fileList.length) return;

    // que la ficha exista antes de colgarle nada
    S.upsert(syncFromForm());

    var pending = Array.prototype.slice.call(fileList);
    U.toast(pending.length > 1 ? 'Subiendo ' + pending.length + ' ficheros…' : 'Subiendo…');

    pending.reduce(function (chain, file) {
      return chain.then(function () { return S.uploadFile(current.id, file); });
    }, Promise.resolve()).then(function () {
      loadFiles();
      return S.loadFileCounts();
    }).then(function () {
      refresh();
      U.toast('Adjuntado');
    }).catch(function (err) {
      loadFiles();
      U.toast(err.message);
    });
  }

  /* ── Perfiles ────────────────────────────────────────────── */
  var editingProfile = null;

  function openProfileModal(id) {
    editingProfile = id;
    var profile = id ? S.profiles().filter(function (p) { return p.id === id; })[0] : null;
    el('profile-modal-title').textContent = profile ? 'Cambiar puesto' : 'Nuevo puesto';
    el('profile-name').value = profile ? profile.name : '';

    var kind = profile ? S.profileKind(profile).id : 'moviles';
    el('profile-kind').innerHTML = S.PROFILE_KINDS.map(function (k) {
      return '<option value="' + k.id + '"' + (k.id === kind ? ' selected' : '') + '>' +
        k.icon + '  ' + U.esc(k.label) + '</option>';
    }).join('');

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

    var kind = el('profile-kind').value;
    var action = editingProfile
      ? S.renameProfile(editingProfile, name, kind)
      : S.createProfile(name, kind).then(function (profile) { return S.setActiveProfile(profile.id); });

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
        mode: row.querySelector('.shop-mode-box').value,
        popup: row.querySelector('.shop-mode-box').value === 'fuera'
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
        var terms = searchTerms(name);

        // Con la tarifa cargada se elige la pieza y el precio se pone solo;
        // sin ella, a la tienda como toda la vida.
        if (Catalog.ready()) {
          Catalog.pick({
            query: terms,
            onPick: function (item) { fillPart(row.dataset.part, item); },
            onShop: function (query) { Shop.open({ query: query }); }
          });
        } else {
          Shop.open({ query: terms });
        }
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
    el('files-add').addEventListener('click', function () {
      el('files-input').value = '';
      el('files-input').click();
    });

    el('files-input').addEventListener('change', function () {
      if (this.files && this.files.length) uploadFiles(this.files);
    });

    el('files-list').addEventListener('click', function (e) {
      var button = e.target.closest('[data-remove]');
      if (!button) return;
      if (!confirm('¿Quitar este adjunto?')) return;
      S.deleteFile(button.dataset.remove)
        .then(function () { loadFiles(); return S.loadFileCounts(); })
        .then(function () { refresh(); U.toast('Adjunto quitado'); })
        .catch(function (err) { U.toast(err.message); });
    });

    el('ticket-quote').addEventListener('click', function () {
      var ticket = syncFromForm();
      if (!ticket.model.trim() && !ticket.brand.trim()) {
        return U.toast('Ponle antes la marca o el modelo');
      }
      S.upsert(ticket);            // que no se pierda lo escrito
      closeDrawer(true);
      refresh();
      showView('presupuestos');
      Quotes.open(Quotes.fromTicket(ticket));
    });

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

    el('account-new').addEventListener('click', function () { openAccountModal(null); });
    el('account-modal-close').addEventListener('click', closeAccountModal);
    el('account-cancel').addEventListener('click', closeAccountModal);
    el('account-save').addEventListener('click', saveAccount);
    el('account-role').addEventListener('change', applyAccountRole);

    el('account-logout').addEventListener('click', function () {
      if (!confirm('¿Salir de la cuenta?')) return;
      S.logout().then(function () {
        showWelcome('login');
        U.toast('Hasta luego');
      });
    });

    el('account-list').addEventListener('click', function (e) {
      var edit = e.target.closest('button[data-edit]');
      if (edit) {
        var who = accounts.filter(function (u) { return u.id === edit.dataset.edit; })[0];
        if (who) openAccountModal(who);
        return;
      }

      var button = e.target.closest('button[data-user]');
      if (!button) return;
      if (!confirm('¿Quitarle el acceso a esta persona?')) return;
      S.deleteUser(button.dataset.user)
        .then(function () { renderAccount(); U.toast('Acceso quitado'); })
        .catch(function (err) { U.toast(err.message); });
    });

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

    /* Datos del taller */
    var businessForm = el('business-form');
    function saveBusiness() {
      var data = {};
      Array.prototype.forEach.call(businessForm.querySelectorAll('[name]'), function (input) {
        data[input.name] = input.value.trim();
      });
      S.saveBusiness(data);
    }
    businessForm.addEventListener('change', saveBusiness);
    businessForm.addEventListener('submit', function (e) { e.preventDefault(); });

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

    /* Imprimir y tarifas de proveedor */
    wirePrint();
    wireCatalog();

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
      // sólo se cierra lo más de arriba, nunca dos cosas de un tecleo
      if (e.key === 'Escape') {
        if (!el('print-modal').hidden) el('print-modal').hidden = true;
        else if (!el('charge-modal').hidden) el('charge-modal').hidden = true;
        else if (!el('doc-modal').hidden) el('doc-modal').hidden = true;
        else if (!el('csv-modal').hidden) el('csv-modal').hidden = true;
        else if (!el('profile-modal').hidden) closeProfileModal();
        else if (!el('account-modal').hidden) closeAccountModal();
        else if (Quotes.isOpen()) Quotes.close(false);
        else if (Batches.isOpen()) Batches.close(false);
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

  /* ── Bienvenida / entrar ─────────────────────────────────── */
  function showWelcome(mode) {
    var setup = mode === 'setup';
    el('welcome').hidden = false;
    el('welcome-setup').hidden = !setup;
    el('welcome-login').hidden = setup;
    el('field-name').hidden = !setup;
    el('field-password2').hidden = !setup;
    el('welcome-submit').textContent = setup ? 'Crear mi cuenta' : 'Entrar';
    el('welcome-error').hidden = true;
    el('welcome-note').textContent = setup
      ? 'La cuenta se queda en tu servidor. Si se te olvida la contraseña se puede borrar el fichero users.json y volver a empezar.'
      : '';

    var pass = el('welcome-form').querySelector('[name="password"]');
    pass.setAttribute('autocomplete', setup ? 'new-password' : 'current-password');

    document.body.classList.remove('is-booting');
    document.body.classList.add('is-locked');
    setTimeout(function () {
      var first = el('welcome-form').querySelector(setup ? '[name="name"]' : '[name="login"]');
      if (first) first.focus();
    }, 80);
  }

  function hideWelcome() {
    el('welcome').hidden = true;
    document.body.classList.remove('is-locked');
  }

  function revealApp() {
    document.body.classList.remove('is-booting', 'is-locked');
  }

  function showOffline() {
    el('offline').hidden = false;
    document.body.classList.remove('is-booting');
    document.body.classList.add('is-locked');
  }

  function welcomeError(message) {
    var node = el('welcome-error');
    node.textContent = message;
    node.hidden = false;
  }

  function submitWelcome(e) {
    if (e) e.preventDefault();
    var form = el('welcome-form');
    var setup = !el('welcome-setup').hidden;
    var fields = {
      name: form.name.value.trim(),
      login: form.login.value.trim().toLowerCase(),
      password: form.password.value
    };

    if (setup) {
      if (fields.password.length < 6) return welcomeError('La contraseña necesita al menos 6 caracteres.');
      if (fields.password !== form.password2.value) return welcomeError('Las dos contraseñas no son iguales.');
    }

    var button = el('welcome-submit');
    button.disabled = true;
    (setup ? S.register(fields) : S.login(fields))
      .then(function () { return S.loadData(); })
      .then(function () {
        form.reset();
        hideWelcome();
        startApp();
        U.toast(setup ? '¡Listo! Bienvenido' : 'Hola de nuevo');
      })
      .catch(function (err) { welcomeError(err.message); })
      .then(function () { button.disabled = false; });
  }

  /* ── Cuentas (pestaña Datos) ─────────────────────────────── */
  var accounts = [];

  function renderAccount() {
    var auth = S.auth();
    var card = el('account-card');
    card.hidden = !auth.enabled;
    if (!auth.enabled || !auth.user) return;

    el('account-who').textContent = auth.user.name + ' · ' + auth.user.role;
    var isOwner = auth.user.role === 'dueño';
    el('account-new').hidden = !isOwner;

    S.users().then(function (list) {
      accounts = list;
      el('account-list').innerHTML = list.map(function (u) {
        var self = u.id === auth.user.id;
        var donde = u.role === 'dueño' ? 'todos los puestos'
          : (u.profiles || []).map(function (id) {
              var p = S.profiles().filter(function (x) { return x.id === id; })[0];
              return p ? S.profileKind(p).icon + ' ' + p.name : null;
            }).filter(Boolean).join(', ') || 'ningún puesto todavía';

        return '<li>' +
          '<div class="mini-main">' +
            '<div class="mini-title">' + U.esc(u.name) + (self ? ' <span class="tag">tú</span>' : '') + '</div>' +
            '<div class="mini-sub">' + U.esc(u.login) + ' · ' + U.esc(u.role) + ' · ' + U.esc(donde) + '</div>' +
          '</div>' +
          (isOwner ? '<button class="btn sm" data-edit="' + U.esc(u.id) + '">Acceso</button>' : '') +
          (isOwner && !self ? '<button class="btn sm btn-danger-ghost" data-user="' + U.esc(u.id) + '">Quitar</button>' : '') +
        '</li>';
      }).join('');
    }).catch(function () { /* si no se puede, la tarjeta se queda con lo básico */ });
  }

  var editingAccount = null;

  function openAccountModal(user) {
    editingAccount = user || null;
    el('account-modal-title').textContent = user ? 'Cambiar acceso' : 'Dar acceso a alguien';
    el('account-name').value = user ? user.name : '';
    el('account-login').value = user ? user.login : '';
    el('account-password').value = '';
    el('account-role').value = user ? user.role : 'ayudante';
    el('account-error').hidden = true;

    // al editar no se cambia el usuario ni la contraseña
    el('account-login-field').hidden = !!user;
    el('account-password-field').hidden = !!user;

    var mine = (user && user.profiles) || [];
    el('account-profiles').innerHTML = S.profiles().map(function (p) {
      var kind = S.profileKind(p);
      return '<label class="access-row">' +
        '<input type="checkbox" value="' + U.esc(p.id) + '"' +
          (mine.indexOf(p.id) > -1 ? ' checked' : '') + '>' +
        '<span>' + kind.icon + ' ' + U.esc(p.name) + '</span>' +
        '<small>' + U.esc(kind.label) + '</small>' +
      '</label>';
    }).join('');

    applyAccountRole();
    el('account-modal').hidden = false;
    setTimeout(function () { el(user ? 'account-name' : 'account-name').focus(); }, 50);
  }

  /* Al dueño no se le marcan puestos: los ve todos por definición */
  function applyAccountRole() {
    el('account-profiles-field').hidden = el('account-role').value === 'dueño';
  }

  function closeAccountModal() {
    el('account-modal').hidden = true;
    editingAccount = null;
  }

  function saveAccount() {
    var role = el('account-role').value;
    var chosen = Array.prototype.filter.call(
      el('account-profiles').querySelectorAll('input:checked'),
      function () { return true; }
    ).map(function (input) { return input.value; });

    var fields = {
      name: el('account-name').value.trim(),
      role: role,
      profiles: role === 'dueño' ? [] : chosen
    };

    if (!editingAccount && role !== 'dueño' && !chosen.length) {
      return accountError('Márcale al menos un puesto, si no no verá nada.');
    }

    var action;
    if (editingAccount) {
      action = S.updateUser(editingAccount.id, fields);
    } else {
      fields.login = el('account-login').value.trim().toLowerCase();
      fields.password = el('account-password').value;
      if (!fields.login) return accountError('Ponle un usuario para entrar.');
      if (fields.password.length < 6) return accountError('La contraseña necesita 6 caracteres o más.');
      action = S.register(fields);
    }

    action.then(function () {
      closeAccountModal();
      renderAccount();
      U.toast(editingAccount ? 'Acceso cambiado' : 'Cuenta creada');
    }).catch(function (err) { accountError(err.message); });
  }

  function accountError(message) {
    var node = el('account-error');
    node.textContent = message;
    node.hidden = false;
  }

  /* ── Imprimir en papel térmico ───────────────────────────── */
  /* El PDF sale del servidor ya con el ancho exacto del rollo (80 o 58 mm).
     Se abre en una ventana aparte y se manda a imprimir desde ahí: así el
     navegador no reescala nada, que es lo que descuadra estos tickets. */

  var printTarget = null;      // la ficha que se va a imprimir

  function openPrint(ticket) {
    printTarget = ticket;
    var cliente = ticket.type === 'cliente';

    // los papeles no se llaman igual si es una reparación o un móvil de reventa
    el('print-kind1').textContent = cliente ? 'Resguardo de entrada' : 'Ficha del equipo';
    el('print-kind1-sub').textContent = cliente
      ? 'Lo que se le da al cliente cuando deja el equipo'
      : 'Para pegar en la bolsa del móvil mientras lo tienes';
    el('print-kind2').textContent = cliente ? 'Ticket de entrega' : 'Ticket de venta';
    el('print-kind2-sub').textContent = cliente
      ? 'Al recogerlo y pagar'
      : 'Para el comprador, al vendérselo';

    // por defecto, lo que toca según el estado de la ficha
    var kind = S.isSold(ticket) ? 'entrega' : 'resguardo';
    check('print-kind', kind);
    check('print-width', S.prefs().printWidth || '80');

    el('print-modal').hidden = false;
  }

  function check(name, value) {
    Array.prototype.forEach.call(
      document.querySelectorAll('[name="' + name + '"]'), function (input) {
        input.checked = input.value === value;
      });
  }

  function checked(name) {
    var input = document.querySelector('[name="' + name + '"]:checked');
    return input ? input.value : '';
  }

  function printUrl() {
    var kind = checked('print-kind');
    var width = checked('print-width') || '80';
    S.prefs({ printWidth: width });
    return S.ticketPdfUrl(printTarget.id, {
      kind: kind === 'taller' ? 'entrega' : kind,
      width: width,
      costs: kind === 'taller'
    });
  }

  function wirePrint() {
    el('ticket-print').addEventListener('click', function () {
      if (!current) return;
      if (!S.isRemote()) return U.toast('Imprimir el ticket necesita el servidor');

      // El ticket lo monta el servidor con lo que tenga guardado, así que
      // hay que esperar a que llegue: si no, el papel sale con lo de antes.
      var ticket = syncFromForm();
      S.upsert(ticket);
      snapshot = JSON.stringify(current);
      refresh();
      S.flush().then(function () { openPrint(ticket); });
    });

    function cerrar() { el('print-modal').hidden = true; printTarget = null; }
    el('print-close').addEventListener('click', cerrar);
    el('print-cancel').addEventListener('click', cerrar);
    el('print-modal').addEventListener('click', function (e) {
      if (e.target === el('print-modal')) cerrar();
    });

    el('print-go').addEventListener('click', function () {
      var url = printUrl();
      cerrar();
      var win = global.open(url, '_blank');
      if (!win) return U.toast('El navegador ha bloqueado la ventana. Prueba con «Descargar PDF».');
      // algunos navegadores no dejan imprimir hasta que el PDF ha cargado
      try { win.addEventListener('load', function () { win.print(); }); } catch (err) { /* da igual */ }
    });

    el('print-download').addEventListener('click', function () {
      var url = printUrl();
      cerrar();
      var a = document.createElement('a');
      a.href = url + '&download=1';
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  /* ── Tarifas de proveedor ────────────────────────────────── */
  function sourceForm(row) {
    function val(cls) {
      var input = row.querySelector('.' + cls);
      return input ? input.value.trim() : '';
    }
    var source = {
      id: row.dataset.source,
      name: val('cat-name') || 'Tarifa',
      url: val('cat-url'),
      auth: val('cat-auth') || 'ninguna',
      authName: val('cat-authname')
    };
    // la clave sólo se manda si has escrito una nueva; si no, se queda la guardada
    var key = val('cat-key');
    if (key) source.apiKey = key;
    return source;
  }

  function wireCatalog() {
    var wrap = el('catalog-sources');
    var fileInput = el('catalog-file');
    var uploading = '';

    el('catalog-add').addEventListener('click', function () {
      S.saveCatalogSource({ name: 'Mi proveedor' }).then(function () {
        U.renderCatalogSources();
      }).catch(function (err) { U.toast(err.message); });
    });

    wrap.addEventListener('click', function (e) {
      var button = e.target.closest('[data-action]');
      if (!button) return;
      var row = button.closest('.cat-source');
      var id = row.dataset.source;
      var action = button.dataset.action;

      if (action === 'remove-source') {
        if (!confirm('¿Quitar esta tarifa? Se borran sus piezas del buscador ' +
                     '(las fichas que ya la usaron no se tocan).')) return;
        S.removeCatalogSource(id).then(function () {
          U.renderCatalogSources();
          U.toast('Tarifa quitada');
        }).catch(function (err) { U.toast(err.message); });
        return;
      }

      if (action === 'save-source') {
        S.saveCatalogSource(sourceForm(row)).then(function () {
          U.renderCatalogSources();
          U.toast('Guardado');
        }).catch(function (err) { U.toast(err.message); });
        return;
      }

      if (action === 'upload-source') {
        // se guarda antes por si acaba de cambiar el nombre
        uploading = id;
        S.saveCatalogSource(sourceForm(row)).then(function () {
          fileInput.value = '';
          fileInput.click();
        }).catch(function (err) { U.toast(err.message); });
        return;
      }

      if (action === 'sync-source') {
        button.disabled = true;
        button.textContent = 'Pidiendo…';
        S.saveCatalogSource(sourceForm(row))
          .then(function () { return S.syncCatalogSource(id); })
          .then(function (data) {
            U.renderCatalogSources();
            U.toast(data.count.toLocaleString('es-ES') + ' piezas cargadas');
          })
          .catch(function (err) {
            U.renderCatalogSources();
            alert('No se ha podido traer la tarifa.\n\n' + err.message);
          });
      }
    });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file || !uploading) return;
      U.toast('Leyendo ' + file.name + '…');
      S.importCatalogFile(uploading, file).then(function (data) {
        U.renderCatalogSources();
        var columnas = Object.keys(data.map || {}).map(function (k) {
          return k + ' ← ' + data.map[k];
        }).join('\n');
        U.toast(data.count.toLocaleString('es-ES') + ' piezas cargadas');
        if (data.sample && data.sample.length) {
          console.log('Ejemplo de lo leído:', data.sample);
        }
        if (columnas) console.log('Columnas emparejadas:\n' + columnas);
      }).catch(function (err) {
        alert('No he podido leer esa tarifa.\n\n' + err.message);
      }).then(function () { uploading = ''; });
    });
  }

  /* ── Arranque ────────────────────────────────────────────── */
  var wired = false;

  function startApp() {
    revealApp();
    if (!wired) {
      wire();
      Shop.init();
      Catalog.init();
      Quotes.init({ onChange: refresh });
      Batches.init({ onChange: refresh, openTicket: openTicket });
      wired = true;
    }
    refresh();
    U.renderShopSettings();
    U.renderCatalogSources();
    U.renderStorageInfo();
    renderAccount();

    var business = S.business();
    Array.prototype.forEach.call(el('business-form').querySelectorAll('[name]'), function (input) {
      input.value = business[input.name] || '';
    });

    var view = S.prefs().view;
    showView(['panel', 'fichas', 'datos'].indexOf(view) > -1 ? view : 'panel');
  }

  /* Si algo se atasca al arrancar, la pantalla se queda en blanco (la
     aplicación está oculta hasta que se sabe si hay que entrar). Esto la
     destapa igualmente y cuenta lo que pasa, que desde el móvil no hay
     forma de mirar la consola. */
  function bootWatchdog() {
    setTimeout(function () {
      if (!document.body.classList.contains('is-booting')) return;
      revealApp();
      U.toast('El servidor tarda en contestar. Prueba a recargar.');
      console.warn('El arranque no terminó a tiempo');
    }, 12000);
  }

  function init() {
    initTheme();
    bootWatchdog();
    S.onError(function (message) {
      if (/Entra con tu cuenta/i.test(message)) return showWelcome('login');
      U.toast(message);
    });

    el('welcome-form').addEventListener('submit', submitWelcome);

    el('offline-retry').addEventListener('click', function () {
      el('offline-retry').disabled = true;
      location.reload();
    });

    S.init().then(function (info) {
      var auth = info.auth || {};

      if (auth.enabled && !auth.user) {
        // sin haber entrado no se enseña nada de dentro
        wire();
        Shop.init();
        Catalog.init();
        Quotes.init({ onChange: refresh });
        Batches.init({ onChange: refresh, openTicket: openTicket });
        wired = true;
        showWelcome(auth.needsSetup ? 'setup' : 'login');
        return;
      }

      // Servida por http pero sin servidor detrás: es una caída de conexión,
      // no el modo «fichero suelto». Mejor decirlo que enseñar un taller vacío.
      if (!info.remote && location.protocol !== 'file:') {
        return showOffline();
      }

      startApp();
    }).catch(function (err) {
      console.error(err);
      revealApp();
      el('welcome').hidden = true;
      el('offline').hidden = true;
      document.body.insertAdjacentHTML('afterbegin',
        '<p class="empty">No se pudo arrancar: ' + U.esc(err.message || err) +
        '<br><button class="btn" onclick="location.reload()" style="margin-top:12px">Reintentar</button></p>');
    });
  }

  /* Para que abra aunque el servidor tarde. El navegador sólo lo permite en
     sitios seguros (https o localhost); por http en la red de casa se lo
     salta sin quejarse, y la aplicación funciona igual. */
  function registerWorker() {
    if (!('serviceWorker' in navigator) || !global.isSecureContext) return;
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.info('Sin modo sin conexión:', err && err.message);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); registerWorker(); });
  } else {
    init();
    registerWorker();
  }
})(window);
