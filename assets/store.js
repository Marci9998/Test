/* ============================================================
   store.js — datos, cálculos y persistencia
   Todo se guarda en localStorage del navegador. Sin servidor.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'taller.tickets.v1';
  var PREFS_KEY = 'taller.prefs.v1';

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
      createdAt: today(),
      soldAt: '',
      updatedAt: new Date().toISOString()
    };
  }

  /* Rellena huecos de fichas viejas o importadas */
  function normalize(t) {
    var base = blank();
    var out = Object.assign(base, t || {});
    out.id = out.id || uid();
    out.type = out.type === 'cliente' ? 'cliente' : 'reventa';
    if (!status(out.status) || !STATUSES.some(function (s) { return s.id === out.status; })) out.status = 'pendiente';
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
     'issue', 'listingUrl', 'notes', 'createdAt', 'soldAt'].forEach(function (k) {
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
  function revenue(t) {
    return num(t.salePrice) || num(t.listPrice);
  }

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

  /* ── Persistencia ────────────────────────────────────────── */
  var tickets = [];

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      tickets = raw ? JSON.parse(raw).map(normalize) : [];
    } catch (err) {
      console.warn('No se pudieron leer los datos guardados:', err);
      tickets = [];
    }
    return tickets;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(tickets));
      return true;
    } catch (err) {
      console.error('No se pudo guardar:', err);
      return false;
    }
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

  /* ── Preferencias (tema, filtros) ────────────────────────── */
  function prefs(patch) {
    var current = {};
    try { current = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (err) { current = {}; }
    if (!patch) return current;
    var next = Object.assign(current, patch);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch (err) { /* modo incógnito */ }
    return next;
  }

  /* ── Métricas del panel ──────────────────────────────────── */
  function stats() {
    var openTickets = tickets.filter(function (t) { return status(t.status).open; });
    var sold = tickets.filter(isSold);
    var thisMonth = monthKey(today());

    var soldThisMonth = sold.filter(function (t) { return monthKey(t.soldAt || t.updatedAt) === thisMonth; });

    var invested = openTickets.reduce(function (s, t) { return s + totalCost(t); }, 0);
    var expected = openTickets.reduce(function (s, t) { return s + profit(t); }, 0);
    var profitMonth = soldThisMonth.reduce(function (s, t) { return s + profit(t); }, 0);
    var profitTotal = sold.reduce(function (s, t) { return s + profit(t); }, 0);

    var margins = sold.map(margin).filter(function (m) { return m !== 0; });
    var avgMargin = margins.length ? margins.reduce(function (a, b) { return a + b; }, 0) / margins.length : 0;

    return {
      open: openTickets.length,
      sold: sold.length,
      soldThisMonth: soldThisMonth.length,
      invested: invested,
      expected: expected,
      profitMonth: profitMonth,
      profitTotal: profitTotal,
      avgMargin: avgMargin
    };
  }

  /* Beneficio de los últimos n meses, para el gráfico */
  function monthlyProfit(months) {
    var out = [];
    var now = new Date();
    for (var i = months - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = d.toISOString().slice(0, 7);
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
    return { brands: Object.keys(brands).sort(), models: Object.keys(models).sort(), parts: Object.keys(parts).sort() };
  }

  global.Store = {
    STATUSES: STATUSES,
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
    load: load,
    save: save,
    all: all,
    get: get,
    upsert: upsert,
    remove: remove,
    replaceAll: replaceAll,
    addMany: addMany,
    wipe: wipe,
    prefs: prefs,
    stats: stats,
    monthlyProfit: monthlyProfit,
    suggestions: suggestions
  };
})(window);
