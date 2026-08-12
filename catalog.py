"""catalog.py — catálogo de piezas de tus proveedores.

La idea: tener en el servidor la tarifa de tu proveedor para que, al apuntar
una pieza en una ficha o en un presupuesto, salga el nombre y el precio solos
en vez de tener que ir a la web a mirarlos.

De dónde salen los datos, según lo que te dé la tienda:

  · Una **API** con su clave: se le pide la lista cada vez que le des a
    actualizar. Muy pocas tiendas de repuestos dan clave a los clientes;
    normalmente hay que tener cuenta de profesional y pedirla.
  · Un **fichero de tarifa** (CSV, Excel guardado como CSV, JSON o XML): esto
    sí lo da casi cualquier proveedor. Se sube una vez y listo.

Da igual de dónde venga: aquí se convierte todo a la misma lista de piezas y
se guarda en disco, así que buscar es instantáneo y no depende de que la
tienda esté en pie.

Sólo biblioteca estándar de Python 3.
"""

import csv
import io
import json
import re
import time
import unicodedata
import xml.etree.ElementTree as ET

# Cómo se llaman en la vida real las columnas que nos interesan. Se mira
# primero la coincidencia exacta y luego que la contenga, igual que con el
# CSV de fichas: si no, «precio_sin_iva» se lleva por delante a «precio».
FIELD_HINTS = {
    'name': ['nombre', 'name', 'producto', 'product', 'descripcion', 'description',
             'titulo', 'title', 'articulo', 'concepto', 'denominacion'],
    'ref': ['referencia', 'ref', 'sku', 'codigo', 'code', 'ean', 'mpn', 'id',
            'partnumber', 'part_number'],
    'price': ['precio', 'price', 'pvp', 'coste', 'cost', 'importe', 'tarifa',
              'preciocompra', 'precio_compra', 'unitprice', 'unit_price'],
    'stock': ['stock', 'existencias', 'cantidad', 'quantity', 'disponible',
              'available', 'qty'],
    'brand': ['marca', 'brand', 'fabricante', 'manufacturer'],
    'model': ['modelo', 'model', 'compatible', 'compatibilidad', 'equipo',
              'dispositivo', 'device'],
    'url': ['url', 'enlace', 'link', 'href', 'ficha'],
}

MAX_ITEMS = 60000        # una tarifa más gorda que esto no la aguanta la memoria
MAX_TEXT = 400


def strip_accents(text):
    """«Batería» y «bateria» tienen que encontrarse la una a la otra."""
    nfkd = unicodedata.normalize('NFKD', str(text))
    return ''.join(c for c in nfkd if not unicodedata.combining(c))


def normalize(text):
    text = strip_accents(str(text or '')).lower()
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def to_number(value):
    """Precios tal y como los escriben las tiendas: «12,50 €», «1.234,56», «$9.99»."""
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    text = str(value or '').strip()
    if not text:
        return 0.0
    text = re.sub(r'[^\d,.\-]', '', text)
    if not text:
        return 0.0

    if ',' in text and '.' in text:
        # el que va más a la derecha manda: es el separador de decimales
        if text.rfind(',') > text.rfind('.'):
            text = text.replace('.', '').replace(',', '.')
        else:
            text = text.replace(',', '')
    elif ',' in text:
        entera, _, decimal = text.rpartition(',')
        # «1,234» con tres cifras detrás son miles, no decimales
        text = (entera + '.' + decimal) if len(decimal) != 3 else text.replace(',', '')

    try:
        return round(float(text), 2)
    except ValueError:
        return 0.0


def guess_mapping(columns):
    """Empareja las columnas del fichero con los campos que usamos."""
    clean = [normalize(c).replace(' ', '') for c in columns]
    mapping = {}
    used = set()

    for field, hints in FIELD_HINTS.items():
        for exact in (True, False):
            if field in mapping:
                break
            for i, col in enumerate(clean):
                if i in used or not col:
                    continue
                hit = any(col == h for h in hints) if exact \
                    else any(h in col for h in hints)
                if hit:
                    mapping[field] = columns[i]
                    used.add(i)
                    break
    return mapping


# ── convertir lo que llega en una lista de diccionarios ──────────────────

def _rows_from_csv(text):
    sample = text[:4000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|')
        delimiter = dialect.delimiter
    except csv.Error:
        # el sniffer se atraganta a menudo: contamos a mano
        counts = {d: sample.count(d) for d in ',;\t|'}
        delimiter = max(counts, key=counts.get) if any(counts.values()) else ','

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    return [row for row in reader], list(reader.fieldnames or [])


def _rows_from_json(data):
    """Acepta una lista pelada o el típico {"products": [...]}."""
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = None
        for key in ('products', 'items', 'data', 'results', 'rows', 'articulos',
                    'productos', 'piezas'):
            if isinstance(data.get(key), list):
                rows = data[key]
                break
        if rows is None:
            # PrestaShop y compañía a veces meten la lista en la única clave que hay
            listas = [v for v in data.values() if isinstance(v, list)]
            rows = listas[0] if len(listas) == 1 else []
    else:
        rows = []

    rows = [r for r in rows if isinstance(r, dict)]
    columns = []
    for row in rows[:50]:
        for key in row:
            if key not in columns:
                columns.append(key)
    return rows, columns


def _flatten(element):
    """Un nodo XML como diccionario plano: hijos e atributos."""
    row = dict(element.attrib)
    for child in element:
        text = (child.text or '').strip()
        if len(child):                      # nodo con hijos: nos quedamos con el texto suelto
            text = ''.join(child.itertext()).strip()
        if child.tag not in row:
            row[child.tag] = text
    return row


def _rows_from_xml(text):
    root = ET.fromstring(text)
    # el nodo que más se repite es el del producto
    counts = {}
    for parent in root.iter():
        for child in parent:
            counts[child.tag] = counts.get(child.tag, 0) + 1
    if not counts:
        return [], []
    tag = max(counts, key=counts.get)

    rows = [_flatten(node) for node in root.iter(tag)]
    columns = []
    for row in rows[:50]:
        for key in row:
            if key not in columns:
                columns.append(key)
    return rows, columns


def parse(raw, content_type=''):
    """Devuelve (filas, columnas) mirando lo que hay dentro, no la extensión."""
    if isinstance(raw, bytes):
        for encoding in ('utf-8-sig', 'utf-8', 'cp1252', 'latin-1'):
            try:
                text = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = raw.decode('utf-8', 'replace')
    else:
        text = str(raw)

    head = text.lstrip()[:1]
    if head in ('{', '['):
        try:
            return _rows_from_json(json.loads(text))
        except ValueError:
            pass
    if head == '<':
        try:
            return _rows_from_xml(text)
        except ET.ParseError:
            pass
    if 'json' in (content_type or '').lower():
        try:
            return _rows_from_json(json.loads(text))
        except ValueError:
            pass

    return _rows_from_csv(text)


def build_items(rows, columns, mapping=None, source_id='', source_name=''):
    """Pasa las filas del fichero a piezas nuestras, ya listas para buscar."""
    mapping = dict(mapping or {})
    for field, column in guess_mapping(columns).items():
        mapping.setdefault(field, column)

    def take(row, field):
        column = mapping.get(field)
        if not column:
            return ''
        value = row.get(column, '')
        if isinstance(value, (dict, list)):
            return ''
        return str(value if value is not None else '').strip()[:MAX_TEXT]

    items = []
    for row in rows[:MAX_ITEMS]:
        name = take(row, 'name')
        if not name:
            continue
        price = to_number(take(row, 'price'))
        item = {
            'name': name,
            'ref': take(row, 'ref'),
            'price': price,
            'stock': take(row, 'stock'),
            'brand': take(row, 'brand'),
            'model': take(row, 'model'),
            'url': take(row, 'url')[:600],
            'source': source_id,
            'sourceName': source_name,
        }
        # lo que se usa para buscar, ya masticado: así no hay que normalizar
        # sesenta mil filas en cada tecleo
        item['q'] = normalize(' '.join(filter(None, [
            name, item['ref'], item['brand'], item['model']])))
        items.append(item)

    return items, mapping


# ── búsqueda ─────────────────────────────────────────────────────────────

def agotado(stock):
    """Cada tienda lo escribe a su manera: 0, «no», «sin stock», «agotado»…"""
    text = str(stock if stock is not None else '').strip().lower()
    if not text:
        return False
    if re.fullmatch(r'0+([.,]0+)?', text):
        return True
    return bool(re.match(r'^(no|sin|agotado|out|unavailable)', text))


def search(items, query, limit=40):
    """Busca las piezas que llevan **todas** las palabras que has escrito.

    Escribes «iphone 11 pantalla» y salen las pantallas del iPhone 11, no
    todo lo que lleve la palabra pantalla.
    """
    words = [w for w in normalize(query).split() if w]
    if not words:
        return []

    found = []
    for item in items:
        haystack = item.get('q') or normalize(item.get('name', ''))
        if not all(w in haystack for w in words):
            continue

        # Lo que se puede comprar hoy, primero: una pieza agotada no sirve
        # de nada aunque sea la que mejor encaja.
        score = 0
        if agotado(item.get('stock')):
            score += 100
        if haystack.startswith(words[0]):
            score -= 10
        score += len(haystack) / 100.0
        if not item.get('price'):
            score += 5                     # sin precio no ayuda mucho, al final
        found.append((score, item))

        if len(found) > limit * 20:        # tarifas enormes: no barremos de más
            break

    found.sort(key=lambda pair: pair[0])
    return [item for _, item in found[:limit]]


def summary(source, count):
    out = dict(source or {})
    out['count'] = count
    out['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    return out
