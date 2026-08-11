/* ============================================================
   csv.js — importar/exportar CSV y copias de seguridad JSON
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Store;

  /* ── Parser CSV (comillas, saltos de línea dentro de celda) ── */
  function detectDelimiter(text) {
    var firstLine = text.split(/\r?\n/)[0] || '';
    var counts = { ';': 0, ',': 0, '\t': 0 };
    var inQuotes = false;
    for (var i = 0; i < firstLine.length; i++) {
      var ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && counts[ch] !== undefined) counts[ch]++;
    }
    var best = ';', bestCount = -1;
    Object.keys(counts).forEach(function (d) {
      if (counts[d] > bestCount) { bestCount = counts[d]; best = d; }
    });
    return bestCount > 0 ? best : ';';
  }

  function parse(text) {
    text = String(text).replace(/^﻿/, '');           // quita BOM
    var delim = detectDelimiter(text);
    var rows = [], row = [], field = '', inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') { inQuotes = true; continue; }
      if (ch === delim) { row.push(field); field = ''; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      if (ch === '\r') continue;
      field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    // fuera filas totalmente vacías
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    if (!rows.length) return { headers: [], rows: [] };

    var headers = rows[0].map(function (h) { return String(h).trim(); });
    return { headers: headers, rows: rows.slice(1) };
  }

  /* ── Campos que se pueden mapear al importar ─────────────── */
  var FIELDS = [
    { key: 'brand',         label: 'Marca',                 hints: ['marca', 'brand', 'fabricante'] },
    { key: 'model',         label: 'Modelo',                hints: ['modelo', 'model', 'movil', 'móvil', 'equipo', 'dispositivo', 'terminal'] },
    { key: 'storage',       label: 'Almacenamiento',        hints: ['almacenamiento', 'gb', 'memoria', 'capacidad', 'storage'] },
    { key: 'color',         label: 'Color',                 hints: ['color'] },
    { key: 'imei',          label: 'IMEI / nº serie',       hints: ['imei', 'serie', 'sn'] },
    { key: 'customerName',  label: 'Cliente',               hints: ['cliente', 'nombre', 'customer'] },
    { key: 'customerPhone', label: 'Teléfono del cliente',  hints: ['telefono', 'teléfono', 'movil cliente', 'contacto', 'phone'] },
    { key: 'issue',         label: 'Avería',                hints: ['averia', 'avería', 'problema', 'fallo', 'reparacion', 'reparación', 'trabajo'] },
    { key: 'type',          label: 'Tipo (cliente/reventa)', hints: ['tipo', 'type'] },
    { key: 'partsList',     label: 'Piezas (detalle)',      hints: ['piezas', 'pieza', 'repuesto', 'repuestos', 'material', 'materiales'] },
    { key: 'partsCost',     label: 'Coste de piezas',       hints: ['coste piezas', 'costo piezas', 'total piezas', 'precio piezas', 'coste material'] },
    { key: 'purchaseCost',  label: 'Precio de compra',      hints: ['precio compra', 'coste compra', 'costo compra', 'compra', 'pagado'], money: true },
    { key: 'extraCost',     label: 'Otros gastos',          hints: ['otros gastos', 'gastos', 'otros', 'envio', 'envío', 'extra'], money: true },
    { key: 'listPrice',     label: 'Precio en Wallapop',    hints: ['precio wallapop', 'wallapop', 'publicado', 'precio venta', 'pvp', 'presupuesto', 'precio', 'venta'], money: true },
    { key: 'salePrice',     label: 'Precio final vendido',  hints: ['precio vendido', 'vendido por', 'vendido', 'cobrado', 'precio final', 'ingreso'], money: true },
    { key: 'listingUrl',    label: 'Enlace de Wallapop',    hints: ['enlace', 'link', 'url'] },
    { key: 'status',        label: 'Estado',                hints: ['estado', 'status', 'situacion', 'situación'] },
    { key: 'createdAt',     label: 'Fecha de entrada',      hints: ['fecha entrada', 'entrada', 'fecha', 'alta', 'dia', 'día'], date: true },
    { key: 'soldAt',        label: 'Fecha de venta',        hints: ['fecha venta', 'fecha de venta', 'vendido el', 'fecha cobro'], date: true },
    { key: 'notes',         label: 'Notas',                 hints: ['notas', 'nota', 'observacion', 'observación', 'comentario'] }
  ];

  function slug(s) {
    return String(s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /* Puntúa lo bien que una cabecera encaja con un campo */
  function score(field, header) {
    var hs = slug(header);
    if (!hs) return 0;
    // una columna de fechas nunca es un importe, y al revés
    var looksDate = /(^| )fecha( |$)|(^| )date( |$)/.test(hs);
    if (field.money && looksDate) return 0;
    if (field.date && !looksDate && !/entrada|alta|dia|venta/.test(hs)) return 0;

    var best = 0;
    field.hints.forEach(function (hint) {
      var hint2 = slug(hint);
      if (hs === hint2) best = Math.max(best, 3);
      else if (hs.indexOf(hint2) > -1 || hint2.indexOf(hs) > -1) best = Math.max(best, 2);
    });
    return best;
  }

  /* Adivina qué columna del CSV va con cada campo.
     Dos vueltas: primero las coincidencias exactas, luego las parciales,
     para que «Coste piezas» no se lleve la columna que en realidad era «Piezas». */
  function guessMapping(headers) {
    var map = {}, used = {};

    [3, 2].forEach(function (minScore) {
      FIELDS.forEach(function (f) {
        if (map[f.key]) return;
        var best = '', bestScore = 0;
        headers.forEach(function (h) {
          if (used[h]) return;
          var s = score(f, h);
          if (s >= minScore && s > bestScore) { bestScore = s; best = h; }
        });
        if (best) { map[f.key] = best; used[best] = true; }
      });
    });

    return map;
  }

  /* «Pantalla x2 @ 20,25 | Batería x1 @ 15» → lista de piezas.
     Devuelve null si la celda no tiene ese formato (p.ej. es sólo un número). */
  function parsePartsList(value) {
    var s = String(value || '').trim();
    if (!s) return null;
    var chunks = s.split(/\s*\|\s*/).filter(Boolean);
    var parts = [], matched = 0;

    chunks.forEach(function (chunk) {
      var m = chunk.match(/^(.*?)\s*[x×]\s*([\d.,]+)\s*@\s*([\d.,]+)\s*$/i);
      if (m) {
        matched++;
        parts.push({ id: S.uid(), name: m[1].trim(), qty: S.num(m[2]) || 1, unitCost: S.num(m[3]) });
      } else if (/[a-zñáéíóú]/i.test(chunk)) {
        parts.push({ id: S.uid(), name: chunk.trim(), qty: 1, unitCost: 0 });
      }
    });

    return matched ? parts : null;
  }

  /* Texto libre del Excel → id de estado */
  function parseStatus(value) {
    var v = slug(value);
    if (!v) return '';
    if (/vendid|entregad|cobrad|pagad/.test(v)) return 'vendido';
    if (/publicad|wallapop|subid|anunci|avisad/.test(v)) return 'publicado';
    if (/listo|acabad|terminad|reparad|arreglad|hecho/.test(v)) return 'listo';
    if (/pieza|repuesto|esperand|pedid/.test(v)) return 'piezas';
    if (/reparand|reparacion|arreglando|proceso|curso|taller|abiert/.test(v)) return 'reparando';
    if (/descartad|perdid|chatarr|anulad|cancelad/.test(v)) return 'descartado';
    return 'pendiente';
  }

  /* dd/mm/aaaa, aaaa-mm-dd, dd-mm-aa… → aaaa-mm-dd */
  function parseDate(value) {
    var s = String(value || '').trim();
    if (!s) return '';
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) {
      var year = m[3].length === 2 ? '20' + m[3] : m[3];
      return year + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    }
    var d = new Date(s);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }

  /* ── CSV + mapeo → fichas ────────────────────────────────── */
  function toTickets(parsed, mapping) {
    var index = {};
    parsed.headers.forEach(function (h, i) { if (index[h] === undefined) index[h] = i; });

    return parsed.rows.map(function (row) {
      function cell(key) {
        var header = mapping[key];
        if (!header || index[header] === undefined) return '';
        return String(row[index[header]] == null ? '' : row[index[header]]).trim();
      }

      var t = S.blank();
      t.brand = cell('brand');
      t.model = cell('model');
      t.storage = cell('storage');
      t.color = cell('color');
      t.imei = cell('imei');
      t.customerName = cell('customerName');
      t.customerPhone = cell('customerPhone');
      t.issue = cell('issue');
      t.notes = cell('notes');
      t.listingUrl = cell('listingUrl');
      t.purchaseCost = S.num(cell('purchaseCost'));
      t.extraCost = S.num(cell('extraCost'));
      t.listPrice = S.num(cell('listPrice'));
      t.salePrice = S.num(cell('salePrice'));

      // el detalle de piezas manda; si no lo hay, un único apunte con el total
      var detail = parsePartsList(cell('partsList'));
      var pc = S.num(cell('partsCost')) || (detail ? 0 : S.num(cell('partsList')));
      if (detail) t.parts = detail;
      else if (pc) t.parts = [{ id: S.uid(), name: 'Piezas (importado del Excel)', qty: 1, unitCost: pc }];

      t.type = /client/i.test(cell('type')) || (!cell('type') && t.customerName) ? 'cliente' : 'reventa';
      if (t.type === 'cliente') t.purchaseCost = 0;

      var st = parseStatus(cell('status'));
      if (st) t.status = st;
      else if (t.salePrice) t.status = 'vendido';
      else if (t.listPrice) t.status = 'publicado';

      var date = parseDate(cell('createdAt'));
      if (date) t.createdAt = date;
      if (t.status === 'vendido') t.soldAt = parseDate(cell('soldAt')) || date || t.createdAt || S.today();

      return t;
    }).filter(function (t) {
      // descarta filas sin nada útil (totales, separadores…)
      return t.model || t.brand || t.customerName || t.listPrice || t.salePrice ||
             t.purchaseCost || S.partsCost(t);
    });
  }

  /* ── Exportar ────────────────────────────────────────────── */
  var EXPORT_COLS = [
    ['Tipo',            function (t) { return t.type === 'cliente' ? 'Cliente' : 'Compra-venta'; }],
    ['Estado',          function (t) { return S.statusLabel(t.status, t.type); }],
    ['Fecha entrada',   function (t) { return t.createdAt; }],
    ['Fecha venta',     function (t) { return t.soldAt; }],
    ['Marca',           function (t) { return t.brand; }],
    ['Modelo',          function (t) { return t.model; }],
    ['Almacenamiento',  function (t) { return t.storage; }],
    ['Color',           function (t) { return t.color; }],
    ['IMEI',            function (t) { return t.imei; }],
    ['Cliente',         function (t) { return t.customerName; }],
    ['Telefono',        function (t) { return t.customerPhone; }],
    ['Averia',          function (t) { return t.issue; }],
    ['Piezas',          function (t) {
      return (t.parts || []).map(function (p) {
        return p.name + ' x' + decimals(S.num(p.qty)) + ' @ ' + decimals(S.num(p.unitCost));
      }).join(' | ');
    }],
    ['Coste piezas',    function (t) { return blankIfZero(S.partsCost(t)); }],
    ['Precio compra',   function (t) { return blankIfZero(t.type === 'cliente' ? 0 : S.num(t.purchaseCost)); }],
    ['Otros gastos',    function (t) { return blankIfZero(S.num(t.extraCost)); }],
    ['Coste total',     function (t) { return S.totalCost(t); }],
    ['Precio Wallapop', function (t) { return blankIfZero(S.num(t.listPrice)); }],
    ['Precio vendido',  function (t) { return blankIfZero(S.num(t.salePrice)); }],
    ['Beneficio',       function (t) { return S.profit(t); }],
    ['Margen %',        function (t) { return Math.round(S.margin(t) * 10) / 10; }],
    ['Enlace',          function (t) { return t.listingUrl; }],
    ['Notas',           function (t) { return t.notes; }]
  ];

  /* Números con coma decimal, que es lo que espera Excel en español */
  function decimals(n) { return String(Math.round(n * 100) / 100).replace('.', ','); }
  function blankIfZero(n) { return n ? n : ''; }

  function escapeCell(value) {
    var s = value == null ? '' : String(value);
    if (typeof value === 'number') s = s.replace('.', ',');   // decimales para Excel en español
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(tickets) {
    var lines = [EXPORT_COLS.map(function (c) { return escapeCell(c[0]); }).join(';')];
    tickets.forEach(function (t) {
      lines.push(EXPORT_COLS.map(function (c) { return escapeCell(c[1](t)); }).join(';'));
    });
    return '﻿' + lines.join('\r\n');    // BOM para que Excel respete los acentos
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  global.CSV = {
    parse: parse,
    FIELDS: FIELDS,
    guessMapping: guessMapping,
    toTickets: toTickets,
    toCSV: toCSV,
    download: download,
    stamp: stamp
  };
})(window);
