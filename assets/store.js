/* ============================================================
   store.js — datos, cálculos, perfiles y guardado

   Funciona de dos maneras y se apaña sola:
     · con servidor  → guarda en el equipo donde corre server.py (API /api/…)
     · sin servidor  → abriendo index.html a pelo, guarda en el navegador
   ============================================================ */
(function (global) {
  'use strict';

  var LEGACY_KEY = 'taller.tickets.v1';          // datos de la primera versión
  var PROFILES_KEY = 'taller.profiles.v1';
  var TICKETS_KEY = 'taller.tickets.v2.';        // + id de perfil
  var SETTINGS_KEY = 'taller.settings.v1';
  var PREFS_KEY = 'taller.prefs.v1';             // tema, pestaña… siempre local

  /* ── Estados posibles de una ficha ───────────────────────── */
  var STATUSES = [
    { id: 'pendiente', label: 'Pendiente',   color: 'var(--mute)', soft: 'var(--mute-soft)', open: true },
    { id: 'reparando', label: 'Reparando',   color: 'var(--info)', soft: 'var(--info-soft)', open: true },
    { id: 'piezas',    label: 'Esperando piezas', color: 'var(--warn)', soft: 'var(--warn-soft)', open: true },
    { id: 'listo',     label: 'Listo',       color: 'var(--good)', soft: 'var(--good-soft)', open: true },
    { id: 'publicado', label: 'Publicado',   color: 'var(--accent)', soft: 'var(--accent-soft)', open: true },
    { id: 'vendido',   label: 'Vendido',     color: 'var(--good)', soft: 'var(--good-soft)', open: false },
    { id: 'descartado',label: 'Descartado',  color: 'var(--bad)',  soft: 'var(--bad-soft)',  open: false }
  ];

  function status(id) {
    for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].id === id) return STATUSES[i];
    return STATUSES[0];
  }

  /* En fichas de cliente algunos estados se llaman distinto */
  function statusLabel(id, type) {
    if (type === 'cliente') {
      if (id === 'publicado') return 'Avisado';
      if (id === 'vendido') return 'Entregado y cobrado';
    }
    return status(id).label;
  }

  /* ── Utilidades ──────────────────────────────────────────── */
  function uid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  /* Acepta "12,50", "12.50", "1.234,56 €", "" → número */
  function num(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    if (value === null || value === undefined) return 0;
    var s = String(value).replace(/[^\d,.\-]/g, '').trim();
    if (!s) return 0;
    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // el separador decimal es el que va más a la derecha
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      s = s.replace(/\./g, '').replace(',', '.');
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  var eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
  function money(n) { return eur.format(num(n)); }

  function today() { return new Date().toISOString().slice(0, 10); }

  function monthKey(iso) { return (iso || '').slice(0, 7); }

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) { return fallback; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (err) { return false; }
  }

  /* ── Ficha vacía ─────────────────────────────────────────── */
  function blank() {
    return {
      id: uid(),
      type: 'reventa',
      brand: '', model: '', storage: '', color: '', imei: '',
      customerName: '', customerPhone: '',
      status: 'pendiente',
      issue: '',
      parts: [],
      purchaseCost: 0,
      extraCost: 0,
      listPrice: 0,
      salePrice: 0,
      listingUrl: '',
      notes: '',
      batchId: '',
      createdAt: today(),
      soldAt: '',
      updatedAt: new Date().toISOString()
    };
  }

  /* Rellena huecos de fichas viejas o importadas */
  function normalize(t) {
    var out = Object.assign(blank(), t || {});
    out.id = out.id || uid();
    out.type = out.type === 'cliente' ? 'cliente' : 'reventa';
    if (!STATUSES.some(function (s) { return s.id === out.status; })) out.status = 'pendiente';
    out.parts = (Array.isArray(out.parts) ? out.parts : []).map(function (p) {
      return {
        id: p.id || uid(),
        name: String(p.name || ''),
        qty: num(p.qty) || 1,
        unitCost: num(p.unitCost)
      };
    });
    ['purchaseCost', 'extraCost', 'listPrice', 'salePrice'].forEach(function (k) { out[k] = num(out[k]); });
    ['brand', 'model', 'storage', 'color', 'imei', 'customerName', 'customerPhone',
     'issue', 'listingUrl', 'notes', 'batchId', 'createdAt', 'soldAt'].forEach(function (k) {
      out[k] = out[k] == null ? '' : String(out[k]);
    });
    return out;
  }

  /* ── Cálculos ────────────────────────────────────────────── */
  function partsCost(t) {
    return (t.parts || []).reduce(function (sum, p) { return sum + num(p.qty) * num(p.unitCost); }, 0);
  }

  function totalCost(t) {
    var purchase = t.type === 'cliente' ? 0 : num(t.purchaseCost);
    return purchase + partsCost(t) + num(t.extraCost);
  }

  /* Ingreso real si está vendido; si no, el precio publicado como estimación */
  function revenue(t) { return num(t.salePrice) || num(t.listPrice); }

  function isSold(t) { return t.status === 'vendido'; }

  function profit(t) { return revenue(t) - totalCost(t); }

  function margin(t) {
    var r = revenue(t);
    return r > 0 ? profit(t) / r * 100 : 0;
  }

  function calc(t) {
    return {
      parts: partsCost(t),
      cost: totalCost(t),
      revenue: revenue(t),
      profit: profit(t),
      margin: margin(t),
      estimated: !num(t.salePrice)
    };
  }

  function title(t) {
    var name = [t.brand, t.model].filter(Boolean).join(' ').trim();
    return name || 'Sin modelo';
  }

  /* ── Hablar con el servidor ──────────────────────────────── */
  var remote = false;          // ¿hay server.py detrás?
  var onError = function () {};

  function api(path, options) {
    options = options || {};
    return fetch('/api' + path, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      keepalive: !!options.keepalive
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          throw new Error(data.error || ('El servidor respondió ' + res.status));
        });
      }
      return res.status === 204 ? null : res.json();
    });
  }

  function detectServer() {
    if (location.protocol === 'file:') return Promise.resolve(false);
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(false); }, 2500); });
    return Promise.race([
      api('/ping').then(function (data) { return !!(data && data.ok); }).catch(function () { return false; }),
      timeout
    ]);
  }

  /* ── Cuentas ─────────────────────────────────────────────── */
  var auth = { needsSetup: false, user: null, enabled: false };

  function authStatus() {
    if (!remote) {
      auth = { needsSetup: false, user: null, enabled: false };
      return Promise.resolve(auth);
    }
    return api('/auth/status').then(function (data) {
      auth = {
        needsSetup: !!(data && data.needsSetup),
        user: (data && data.user) || null,
        enabled: true
      };
      return auth;
    }).catch(function () {
      auth = { needsSetup: false, user: null, enabled: false };
      return auth;
    });
  }

  function register(fields) {
    return api('/auth/register', { method: 'POST', body: fields }).then(function (user) {
      // sólo la primera cuenta entra sola; las demás las crea el dueño
      if (!auth.user) { auth.user = user; auth.needsSetup = false; }
      return user;
    });
  }

  function login(fields) {
    return api('/auth/login', { method: 'POST', body: fields }).then(function (user) {
      auth.user = user;
      auth.needsSetup = false;
      return user;
    });
  }

  function logout() {
    return api('/auth/logout', { method: 'POST' }).then(function () {
      auth.user = null;
      return true;
    });
  }

  function users() { return api('/auth/users'); }

  function deleteUser(id) { return api('/auth/users/' + id, { method: 'DELETE' }); }

  function updateUser(id, fields) {
    return api('/auth/users/' + id, { method: 'PATCH', body: fields });
  }

  /* ── Perfiles ────────────────────────────────────────────── */
  var profiles = [];
  var activeId = null;
  var tickets = [];

  function localProfiles() {
    var list = lsGet(PROFILES_KEY, null);
    if (!Array.isArray(list) || !list.length) {
      list = [{ id: uid().slice(0, 12), name: 'Mi taller', createdAt: today() }];
      lsSet(PROFILES_KEY, list);
      // si venías de la primera versión, esas fichas pasan al primer perfil
      var legacy = lsGet(LEGACY_KEY, null);
      if (Array.isArray(legacy) && legacy.length) lsSet(TICKETS_KEY + list[0].id, legacy);
    }
    return list;
  }

  function loadProfiles() {
    if (!remote) { profiles = localProfiles(); return Promise.resolve(profiles); }
    return api('/profiles').then(function (list) {
      profiles = Array.isArray(list) ? list : [];
      return profiles;
    });
  }

  var PROFILE_KINDS = [
    { id: 'moviles', label: 'Móviles', icon: '📱' },
    { id: 'pcs',     label: 'PCs',     icon: '💻' },
    { id: 'otro',    label: 'Otro',    icon: '🧰' }
  ];

  function profileKind(profile) {
    var id = (profile && profile.kind) || 'moviles';
    for (var i = 0; i < PROFILE_KINDS.length; i++) if (PROFILE_KINDS[i].id === id) return PROFILE_KINDS[i];
    return PROFILE_KINDS[0];
  }

  function createProfile(name, kind) {
    if (!remote) {
      var profile = { id: uid().slice(0, 12), name: (name || 'Taller').trim().slice(0, 60),
                      kind: kind || 'moviles', createdAt: today() };
      profiles.push(profile);
      lsSet(PROFILES_KEY, profiles);
      lsSet(TICKETS_KEY + profile.id, []);
      return Promise.resolve(profile);
    }
    return api('/profiles', { method: 'POST', body: { name: name, kind: kind } }).then(function (profile) {
      profiles.push(profile);
      return profile;
    });
  }

  function renameProfile(id, name, kind) {
    name = (name || '').trim().slice(0, 60);
    if (!name) return Promise.resolve(null);

    function apply() {
      profiles.forEach(function (p) {
        if (p.id !== id) return;
        p.name = name;
        if (kind) p.kind = kind;
      });
    }

    if (!remote) {
      apply();
      lsSet(PROFILES_KEY, profiles);
      return Promise.resolve(true);
    }
    return api('/profiles/' + id, { method: 'PATCH', body: { name: name, kind: kind } })
      .then(function () { apply(); return true; });
  }

  function deleteProfile(id) {
    if (profiles.length <= 1) return Promise.reject(new Error('Tiene que quedar al menos un perfil'));
    function afterDelete() {
      profiles = profiles.filter(function (p) { return p.id !== id; });
      if (activeId === id) activeId = profiles[0].id;
      lsSet(PREFS_KEY, Object.assign(prefs(), { profile: activeId }));
      return loadTickets();
    }
    if (!remote) {
      try { localStorage.removeItem(TICKETS_KEY + id); } catch (err) { /* da igual */ }
      lsSet(PROFILES_KEY, profiles.filter(function (p) { return p.id !== id; }));
      return afterDelete();
    }
    return api('/profiles/' + id, { method: 'DELETE' }).then(afterDelete);
  }

  function setActiveProfile(id) {
    if (!profiles.some(function (p) { return p.id === id; })) return Promise.resolve(false);
    activeId = id;
    prefs({ profile: id });
    return loadTickets().then(function () { return true; });
  }

  function activeProfile() {
    for (var i = 0; i < profiles.length; i++) if (profiles[i].id === activeId) return profiles[i];
    return profiles[0] || null;
  }

  /* ── Fichas ──────────────────────────────────────────────── */
  function loadTickets() {
    if (!remote) {
      tickets = (lsGet(TICKETS_KEY + activeId, []) || []).map(normalize);
      return Promise.resolve(tickets);
    }
    return api('/profiles/' + activeId + '/tickets').then(function (list) {
      tickets = (Array.isArray(list) ? list : []).map(normalize);
      return tickets;
    });
  }

  /* Guardado: se junta lo que pase en el mismo instante y se manda una vez */
  var pending = null, saving = false, dirty = false;
  var inFlight = Promise.resolve();   // el guardado que está saliendo ahora mismo

  function save() {
    dirty = true;
    if (pending) return pending;
    pending = new Promise(function (resolve) {
      setTimeout(function () {
        pending = null;
        resolve(flush());
      }, 120);
    });
    return pending;
  }

  function flush(keepalive) {
    if (!dirty) return Promise.resolve();
    // Si ya hay un guardado en vuelo no se pisan, pero tampoco se puede
    // dejar el cambio ahí tirado: se encola detrás del que está saliendo.
    // Si no, se quedaba sin mandar hasta que tocaras otra cosa, y cerrando
    // la web en ese momento se perdía.
    if (saving) return inFlight.then(function () { return flush(keepalive); });
    dirty = false;
    if (!remote) {
      if (!lsSet(TICKETS_KEY + activeId, tickets)) {
        onError('No se pudo guardar en este navegador (¿memoria llena o modo incógnito?)');
      }
      return Promise.resolve();
    }
    saving = true;
    inFlight = api('/profiles/' + activeId + '/tickets', {
      method: 'PUT', body: tickets, keepalive: !!keepalive
    }).catch(function (err) {
      dirty = true;                       // lo volveremos a intentar
      onError('No se pudo guardar en el servidor: ' + err.message);
    }).then(function () { saving = false; });
    return inFlight;
  }

  function all() { return tickets; }

  function get(id) {
    for (var i = 0; i < tickets.length; i++) if (tickets[i].id === id) return tickets[i];
    return null;
  }

  function upsert(t) {
    var item = normalize(t);
    item.updatedAt = new Date().toISOString();
    if (isSold(item) && !item.soldAt) item.soldAt = today();
    if (!isSold(item)) item.soldAt = '';
    var idx = -1;
    for (var i = 0; i < tickets.length; i++) if (tickets[i].id === item.id) { idx = i; break; }
    if (idx >= 0) tickets[idx] = item; else tickets.unshift(item);
    save();
    return item;
  }

  function remove(id) {
    tickets = tickets.filter(function (t) { return t.id !== id; });
    save();
  }

  function replaceAll(list) {
    tickets = (list || []).map(normalize);
    save();
  }

  function addMany(list) {
    tickets = (list || []).map(normalize).concat(tickets);
    save();
  }

  function wipe() { tickets = []; save(); }

  /* ── Presupuestos ────────────────────────────────────────── */
  var quotes = [];
  var QUOTES_KEY = 'taller.quotes.v1.';       // + id de perfil

  function loadQuotes() {
    if (!remote) {
      quotes = lsGet(QUOTES_KEY + activeId, []) || [];
      return Promise.resolve(quotes);
    }
    return api('/profiles/' + activeId + '/quotes').then(function (list) {
      quotes = Array.isArray(list) ? list : [];
      return quotes;
    }).catch(function () { quotes = []; return quotes; });
  }

  /* El último guardado que ha salido, para poder esperarlo antes de
     pedirle al servidor el PDF de un presupuesto recién creado. */
  var quotesInFlight = Promise.resolve();

  function saveQuotesList() {
    if (!remote) {
      lsSet(QUOTES_KEY + activeId, quotes);
      return Promise.resolve();
    }
    quotesInFlight = api('/profiles/' + activeId + '/quotes', { method: 'PUT', body: quotes })
      .catch(function (err) {
        onError('No se pudo guardar el presupuesto: ' + err.message);
      });
    return quotesInFlight;
  }

  function allQuotes() { return quotes; }

  function quote(id) {
    for (var i = 0; i < quotes.length; i++) if (quotes[i].id === id) return quotes[i];
    return null;
  }

  function saveQuote(q) {
    q.updatedAt = new Date().toISOString();
    var idx = -1;
    for (var i = 0; i < quotes.length; i++) if (quotes[i].id === q.id) { idx = i; break; }
    if (idx >= 0) quotes[idx] = q; else quotes.unshift(q);
    saveQuotesList();
    return q;
  }

  function removeQuote(id) {
    quotes = quotes.filter(function (q) { return q.id !== id; });
    saveQuotesList();
  }

  function quotePdfUrl(id) {
    return '/api/profiles/' + activeId + '/quotes/' + id + '/pdf';
  }

  /* ── Adjuntos de una ficha (diagnósticos, fotos) ─────────── */
  /* Índice ligero para saber qué fichas llevan algo adjunto, sin pedir
     los adjuntos de cada una por separado. */
  var fileCounts = {};

  function loadFileCounts() {
    if (!remote) { fileCounts = {}; return Promise.resolve(fileCounts); }
    return api('/profiles/' + activeId + '/files').then(function (list) {
      fileCounts = {};
      (list || []).forEach(function (f) {
        var box = fileCounts[f.ticketId] || (fileCounts[f.ticketId] = { total: 0, report: false });
        box.total++;
        if (f.kind === 'diagnostico') box.report = true;
      });
      return fileCounts;
    }).catch(function () { fileCounts = {}; return fileCounts; });
  }

  function filesOf(ticketId) { return fileCounts[ticketId] || { total: 0, report: false }; }

  function ticketFiles(ticketId) {
    if (!remote) return Promise.resolve([]);
    return api('/profiles/' + activeId + '/tickets/' + ticketId + '/files')
      .catch(function () { return []; });
  }

  function uploadFile(ticketId, file) {
    if (!remote) return Promise.reject(new Error('Los adjuntos necesitan el servidor'));
    return fetch('/api/profiles/' + activeId + '/tickets/' + ticketId +
                 '/files?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || 'No se pudo subir');
        return data;
      });
    });
  }

  function deleteFile(fileId) {
    return api('/profiles/' + activeId + '/files/' + fileId, { method: 'DELETE' });
  }

  function fileUrl(fileId) {
    return '/api/profiles/' + activeId + '/files/' + fileId;
  }

  /* El ticket de papel térmico de una ficha (lo monta el servidor) */
  function ticketPdfUrl(ticketId, options) {
    options = options || {};
    return '/api/profiles/' + activeId + '/tickets/' + ticketId + '/ticket' +
      '?kind=' + encodeURIComponent(options.kind || 'resguardo') +
      '&width=' + encodeURIComponent(options.width || '80') +
      (options.costs ? '&costs=1' : '');
  }

  /* Y el del presupuesto, para darlo en mano al momento */
  function quoteTicketUrl(quoteId, width) {
    return '/api/profiles/' + activeId + '/quotes/' + quoteId + '/ticket' +
      '?width=' + encodeURIComponent(width || '80');
  }

  /* ── Lotes de compra ─────────────────────────────────────── */
  var batches = [];
  var BATCHES_KEY = 'taller.batches.v1.';

  function loadBatches() {
    if (!remote) {
      batches = lsGet(BATCHES_KEY + activeId, []) || [];
      return Promise.resolve(batches);
    }
    return api('/profiles/' + activeId + '/batches').then(function (list) {
      batches = Array.isArray(list) ? list : [];
      return batches;
    }).catch(function () { batches = []; return batches; });
  }

  function saveBatchList() {
    if (!remote) { lsSet(BATCHES_KEY + activeId, batches); return Promise.resolve(); }
    return api('/profiles/' + activeId + '/batches', { method: 'PUT', body: batches })
      .catch(function (err) { onError('No se pudo guardar el lote: ' + err.message); });
  }

  function allBatches() { return batches; }

  function batch(id) {
    for (var i = 0; i < batches.length; i++) if (batches[i].id === id) return batches[i];
    return null;
  }

  function saveBatch(b) {
    b.updatedAt = new Date().toISOString();
    var idx = -1;
    for (var i = 0; i < batches.length; i++) if (batches[i].id === b.id) { idx = i; break; }
    if (idx >= 0) batches[idx] = b; else batches.unshift(b);
    saveBatchList();
    return b;
  }

  function removeBatch(id) {
    batches = batches.filter(function (b) { return b.id !== id; });
    saveBatchList();
  }

  /* ── Datos del taller (los que salen en el PDF) ──────────── */
  function business() { return settings.business || {}; }

  function saveBusiness(data) {
    settings.business = data;
    if (!remote) { lsSet(SETTINGS_KEY, settings); return Promise.resolve(); }
    return api('/settings', { method: 'PUT', body: settings }).catch(function (err) {
      onError('No se pudieron guardar los datos del taller: ' + err.message);
    });
  }

  /* ── Cobro con QR ────────────────────────────────────────── */
  /* No se cobra desde aquí: se le enseña al cliente un enlace de pago
     tuyo con el importe puesto, y él paga desde su móvil. La aplicación
     no toca dinero ni guarda nada de su tarjeta. */

  function payment() { return settings.payment || { provider: 'paypal', user: '', url: '' }; }

  function savePayment(data) {
    settings.payment = data;
    if (!remote) { lsSet(SETTINGS_KEY, settings); return Promise.resolve(); }
    return api('/settings', { method: 'PUT', body: settings }).catch(function (err) {
      onError('No se pudieron guardar los datos de cobro: ' + err.message);
    });
  }

  /* El enlace de pago para un importe. Devuelve '' si no está configurado. */
  function payUrl(amount) {
    var pay = payment();
    var total = Math.max(0, num(amount));
    // PayPal.Me quiere el importe con punto y dos decimales
    var texto = total.toFixed(2);

    if (pay.provider === 'custom') {
      if (!pay.url) return '';
      return String(pay.url)
        .replace(/\{importe\}/g, encodeURIComponent(texto))
        .replace(/\{amount\}/g, encodeURIComponent(texto));
    }

    var user = String(pay.user || '').trim().replace(/^@/, '');
    // por si pega la dirección entera en vez del usuario
    user = user.replace(/^https?:\/\/(www\.)?paypal\.me\//i, '').replace(/\/.*$/, '');
    if (!user) return '';
    return 'https://paypal.me/' + encodeURIComponent(user) + '/' + texto + 'EUR';
  }

  function qrUrl(data, scale) {
    return '/api/qr?data=' + encodeURIComponent(data) +
           (scale ? '&scale=' + scale : '');
  }

  /* ── Preferencias del dispositivo (tema, pestaña, perfil) ── */
  function prefs(patch) {
    var current = lsGet(PREFS_KEY, {}) || {};
    if (!patch) return current;
    lsSet(PREFS_KEY, Object.assign(current, patch));
    return current;
  }

  /* ── Ajustes compartidos (tiendas de repuestos) ──────────── */
  var settings = {};

  /* Wallapop va «fuera» de serie porque hace falta tu sesión iniciada,
     y por el servidor entraría como si no hubieras entrado nunca. */
  var DEFAULT_SHOPS = [
    { id: 'fuente',  name: 'Repuestos Fuente', url: 'https://www.repuestosfuente.com/buscar?controller=search&s={q}', mode: 'servidor' },
    { id: 'sentrix', name: 'Mobile Sentrix',   url: 'https://es.mobilesentrix.eu/catalogsearch/result/?q={q}', mode: 'servidor' },
    { id: 'wallapop', name: 'Wallapop',        url: 'https://es.wallapop.com/app/search?keywords={q}', mode: 'fuera' },
    { id: 'google',  name: 'Buscar en Google', url: 'https://www.google.com/search?q={q}', mode: 'servidor' }
  ];

  var WALLAPOP_LINKS = [
    { id: 'wp-sales', name: 'Mis ventas', url: 'https://es.wallapop.com/app/catalog/published' },
    { id: 'wp-chat',  name: 'Mensajes',   url: 'https://es.wallapop.com/app/chat' }
  ];

  function loadSettings() {
    if (!remote) {
      settings = lsGet(SETTINGS_KEY, {}) || {};
      return Promise.resolve(settings);
    }
    return api('/settings').then(function (data) {
      settings = data || {};
      return settings;
    }).catch(function () { settings = {}; return settings; });
  }

  function shops() {
    var saved = settings.shops;
    var list = (Array.isArray(saved) && saved.length) ? saved : DEFAULT_SHOPS.slice();
    return list.map(function (shop) {
      var copy = Object.assign({}, shop);
      // «popup» era la marca antigua de «esto ábrelo fuera»
      if (!copy.mode) copy.mode = copy.popup ? 'fuera' : (remote ? 'servidor' : 'directo');
      return copy;
    });
  }

  /* Pasar la página por el servidor es lo que esquiva el bloqueo de marco */
  function proxyUrl(url) {
    return '/api/proxy?url=' + encodeURIComponent(url);
  }

  /* ── Catálogo de piezas del proveedor ────────────────────── */
  /* Vive en el servidor: la tarifa es la misma para todo el taller y ahí
     puede pesar lo que quiera sin llenar el navegador. */

  var catalogSources = [];

  function loadCatalogSources() {
    if (!remote) { catalogSources = []; return Promise.resolve([]); }
    return api('/catalog/sources').then(function (list) {
      catalogSources = Array.isArray(list) ? list : [];
      return catalogSources;
    }).catch(function () { catalogSources = []; return []; });
  }

  function catalogPieces() {
    return catalogSources.reduce(function (sum, s) { return sum + (s.count || 0); }, 0);
  }

  function searchCatalog(query, limit) {
    if (!remote || !query) return Promise.resolve([]);
    return api('/catalog?q=' + encodeURIComponent(query) + '&limit=' + (limit || 30))
      .then(function (data) { return (data && data.items) || []; })
      .catch(function () { return []; });
  }

  function saveCatalogSource(source) {
    var path = source.id ? '/catalog/sources/' + source.id : '/catalog/sources';
    return api(path, { method: source.id ? 'PATCH' : 'POST', body: source })
      .then(function (saved) { return loadCatalogSources().then(function () { return saved; }); });
  }

  function removeCatalogSource(id) {
    return api('/catalog/sources/' + id, { method: 'DELETE' })
      .then(function () { return loadCatalogSources(); });
  }

  function syncCatalogSource(id) {
    return api('/catalog/sources/' + id + '/sync', { method: 'POST', body: {} })
      .then(function (data) { return loadCatalogSources().then(function () { return data; }); });
  }

  function importCatalogFile(id, file) {
    return fetch('/api/catalog/sources/' + id + '/import', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'text/csv' },
      body: file
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || 'No se pudo leer la tarifa');
        return loadCatalogSources().then(function () { return data; });
      });
    });
  }

  function saveShops(list) {
    settings.shops = list;
    if (!remote) { lsSet(SETTINGS_KEY, settings); return Promise.resolve(); }
    return api('/settings', { method: 'PUT', body: settings }).catch(function (err) {
      onError('No se pudieron guardar los ajustes: ' + err.message);
    });
  }

  /* ── Métricas del panel ──────────────────────────────────── */
  function stats() {
    var openTickets = tickets.filter(function (t) { return status(t.status).open; });
    var sold = tickets.filter(isSold);
    var thisMonth = monthKey(today());
    var soldThisMonth = sold.filter(function (t) { return monthKey(t.soldAt || t.updatedAt) === thisMonth; });

    var margins = sold.map(margin).filter(function (m) { return m !== 0; });

    return {
      open: openTickets.length,
      sold: sold.length,
      soldThisMonth: soldThisMonth.length,
      invested: openTickets.reduce(function (s, t) { return s + totalCost(t); }, 0),
      expected: openTickets.reduce(function (s, t) { return s + profit(t); }, 0),
      profitMonth: soldThisMonth.reduce(function (s, t) { return s + profit(t); }, 0),
      profitTotal: sold.reduce(function (s, t) { return s + profit(t); }, 0),
      avgMargin: margins.length ? margins.reduce(function (a, b) { return a + b; }, 0) / margins.length : 0
    };
  }

  /* Beneficio de los últimos n meses, para el gráfico */
  function monthlyProfit(months) {
    var out = [], now = new Date();
    for (var i = months - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
      var total = tickets.filter(function (t) {
        return isSold(t) && monthKey(t.soldAt || t.updatedAt) === key;
      }).reduce(function (s, t) { return s + profit(t); }, 0);
      out.push({
        key: key,
        label: d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''),
        value: total
      });
    }
    return out;
  }

  /* Sugerencias para los datalist (marcas, modelos, piezas ya usadas) */
  function suggestions() {
    var brands = {}, models = {}, parts = {};
    tickets.forEach(function (t) {
      if (t.brand) brands[t.brand] = 1;
      if (t.model) models[t.model] = 1;
      (t.parts || []).forEach(function (p) { if (p.name) parts[p.name] = 1; });
    });
    return {
      brands: Object.keys(brands).sort(),
      models: Object.keys(models).sort(),
      parts: Object.keys(parts).sort()
    };
  }

  /* ── Arranque ────────────────────────────────────────────── */
  function init() {
    return detectServer().then(function (found) {
      remote = found;
      return authStatus();
    }).then(function (status) {
      // sin haber entrado no se pide nada más: lo decide la pantalla de bienvenida
      if (status.enabled && !status.user) return null;
      return loadData();
    }).then(function () {
      return { remote: remote, auth: auth, profile: activeProfile(),
               tickets: tickets.length };
    });
  }

  /* Carga lo del usuario que acaba de entrar (o de arrancar sin cuentas) */
  function loadData() {
    return loadProfiles().then(function () {
      if (!profiles.length) return createProfile('Mi taller');
    }).then(function () {
      var saved = prefs().profile;
      activeId = profiles.some(function (p) { return p.id === saved; }) ? saved : profiles[0].id;
      prefs({ profile: activeId });
      return Promise.all([loadTickets(), loadQuotes(), loadBatches(), loadSettings(),
                          loadFileCounts(), loadCatalogSources()]);
    });
  }

  global.Store = {
    STATUSES: STATUSES,
    DEFAULT_SHOPS: DEFAULT_SHOPS,
    WALLAPOP_LINKS: WALLAPOP_LINKS,
    status: status,
    statusLabel: statusLabel,
    uid: uid,
    num: num,
    money: money,
    today: today,
    blank: blank,
    normalize: normalize,
    calc: calc,
    partsCost: partsCost,
    totalCost: totalCost,
    profit: profit,
    margin: margin,
    isSold: isSold,
    title: title,

    init: init,
    loadData: loadData,
    isRemote: function () { return remote; },
    auth: function () { return auth; },
    authStatus: authStatus,
    register: register,
    login: login,
    logout: logout,
    users: users,
    deleteUser: deleteUser,
    updateUser: updateUser,
    PROFILE_KINDS: PROFILE_KINDS,
    profileKind: profileKind,
    onError: function (fn) { onError = fn || function () {}; },
    flush: flush,
    quotesSaved: function () { return quotesInFlight; },

    profiles: function () { return profiles; },
    activeProfile: activeProfile,
    setActiveProfile: setActiveProfile,
    createProfile: createProfile,
    renameProfile: renameProfile,
    deleteProfile: deleteProfile,

    all: all,
    get: get,
    upsert: upsert,
    remove: remove,
    replaceAll: replaceAll,
    addMany: addMany,
    wipe: wipe,

    shops: shops,
    saveShops: saveShops,
    proxyUrl: proxyUrl,

    catalogSources: function () { return catalogSources.slice(); },
    catalogPieces: catalogPieces,
    loadCatalogSources: loadCatalogSources,
    searchCatalog: searchCatalog,
    saveCatalogSource: saveCatalogSource,
    removeCatalogSource: removeCatalogSource,
    syncCatalogSource: syncCatalogSource,
    importCatalogFile: importCatalogFile,

    ticketFiles: ticketFiles,
    filesOf: filesOf,
    loadFileCounts: loadFileCounts,
    uploadFile: uploadFile,
    deleteFile: deleteFile,
    fileUrl: fileUrl,
    ticketPdfUrl: ticketPdfUrl,
    quoteTicketUrl: quoteTicketUrl,

    batches: allBatches,
    batch: batch,
    saveBatch: saveBatch,
    removeBatch: removeBatch,

    quotes: allQuotes,
    quote: quote,
    saveQuote: saveQuote,
    removeQuote: removeQuote,
    quotePdfUrl: quotePdfUrl,

    payment: payment,
    savePayment: savePayment,
    payUrl: payUrl,
    qrUrl: qrUrl,
    business: business,
    saveBusiness: saveBusiness,

    prefs: prefs,
    stats: stats,
    monthlyProfit: monthlyProfit,
    suggestions: suggestions
  };
})(window);
