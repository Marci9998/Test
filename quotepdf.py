#!/usr/bin/env python3
"""
quotepdf.py — el presupuesto, maquetado.

Se separa del generador (pdfgen.py) a propósito: aquí sólo está el diseño,
así se puede cambiar el aspecto sin tocar las tripas del PDF.
"""

from pdfgen import Pdf, PAGE_W, PAGE_H, MARGIN, text_width, wrap

# Colores del documento
INK = (.11, .13, .17)          # texto principal
SOFT = (.42, .46, .52)         # texto secundario
FAINT = (.62, .66, .72)
LINE = (.87, .89, .92)
BRAND = (.18, .43, .96)        # el azul de la aplicación
BAND = (.96, .97, .99)         # fondo de las bandas
WHITE = (1, 1, 1)

CONTENT_W = PAGE_W - 2 * MARGIN

MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
          'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']


def money(value):
    """1234.5 → '1.234,50 €' (a la española)."""
    try:
        value = float(value or 0)
    except (TypeError, ValueError):
        value = 0.0
    entero, decimales = divmod(round(abs(value) * 100), 100)
    miles = '{:,}'.format(int(entero)).replace(',', '.')
    return '%s%s,%02d €' % ('-' if value < 0 else '', miles, decimales)


def nice_date(iso):
    """'2026-08-11' → '11 de agosto de 2026'."""
    try:
        year, month, day = str(iso).split('-')[:3]
        return '%d de %s de %s' % (int(day), MONTHS[int(month) - 1], year)
    except (ValueError, IndexError):
        return str(iso or '')


def totals(quote):
    base = 0.0
    for line in quote.get('lines') or []:
        base += _num(line.get('qty'), 1) * _num(line.get('unitPrice'))
    discount = _num(quote.get('discount'))
    base = max(0.0, base - discount)
    rate = _num(quote.get('vatRate'))
    vat = base * rate / 100.0
    return {'base': base, 'discount': discount, 'rate': rate, 'vat': vat, 'total': base + vat}


def _num(value, default=0.0):
    try:
        if value in (None, ''):
            return default
        return float(str(value).replace(',', '.'))
    except (TypeError, ValueError):
        return default


def _txt(value):
    return '' if value is None else str(value).strip()


# ── el documento ─────────────────────────────────────────────────────

def build(quote, business, profile_name='', attachments=None):
    quote = quote or {}
    business = business or {}
    sums = totals(quote)

    title = 'Presupuesto %s' % _txt(quote.get('number') or '')
    pdf = Pdf(title=title)

    y = _header(pdf, quote, business, profile_name)
    y = _parties(pdf, quote, business, y)
    y = _device(pdf, quote, y)
    y = _lines_table(pdf, quote, y)
    y = _totals(pdf, sums, y)
    y = _notes(pdf, quote, business, y, attachments)
    _footer(pdf, business)

    return pdf.build()


def _header(pdf, quote, business, profile_name):
    """Banda de arriba: quién hace el presupuesto y qué número tiene."""
    top = PAGE_H - 132
    pdf.rect(0, top, PAGE_W, 132, BRAND)

    name = _txt(business.get('name')) or profile_name or 'Taller de móviles'
    pdf.text(MARGIN, PAGE_H - 62, name, size=21, bold=True, color=WHITE)

    tagline = _txt(business.get('tagline')) or 'Reparación y venta de teléfonos'
    pdf.text(MARGIN, PAGE_H - 80, tagline, size=9.5, color=(.85, .89, 1))

    datos = ' · '.join(filter(None, [
        _txt(business.get('phone')),
        _txt(business.get('email')),
        _txt(business.get('taxId')),
    ]))
    if datos:
        pdf.text(MARGIN, PAGE_H - 96, datos, size=8.5, color=(.82, .87, 1))
    address = _txt(business.get('address'))
    if address:
        pdf.text(MARGIN, PAGE_H - 110, address, size=8.5, color=(.82, .87, 1))

    # bloque del número, a la derecha
    right = PAGE_W - MARGIN
    pdf.text(right, PAGE_H - 52, 'PRESUPUESTO', size=10, bold=True,
             color=(.85, .89, 1), align='right')
    pdf.text(right, PAGE_H - 76, _txt(quote.get('number')) or '—', size=19, bold=True,
             color=WHITE, align='right')
    pdf.text(right, PAGE_H - 96, nice_date(quote.get('createdAt')), size=9,
             color=(.85, .89, 1), align='right')
    if _txt(quote.get('validUntil')):
        pdf.text(right, PAGE_H - 110, 'Válido hasta el ' + nice_date(quote.get('validUntil')),
                 size=8.5, color=(.82, .87, 1), align='right')

    return top - 34


def _parties(pdf, quote, business, y):
    """Para quién es el presupuesto."""
    customer = quote.get('customer') or {}
    pdf.text(MARGIN, y, 'PARA', size=8, bold=True, color=FAINT)
    y -= 16

    pdf.text(MARGIN, y, _txt(customer.get('name')) or 'Cliente', size=13, bold=True, color=INK)
    y -= 15

    for value in [_txt(customer.get('taxId')), _txt(customer.get('address')),
                  ' · '.join(filter(None, [_txt(customer.get('phone')),
                                           _txt(customer.get('email'))]))]:
        if value:
            pdf.text(MARGIN, y, value, size=9.5, color=SOFT)
            y -= 13

    return y - 12


def _device(pdf, quote, y):
    """El aparato y lo que le pasa, en una banda suave."""
    device = quote.get('device') or {}
    parts = [_txt(device.get('brand')), _txt(device.get('model'))]
    name = ' '.join([p for p in parts if p]).strip()
    issue = _txt(quote.get('issue'))
    if not name and not issue:
        return y

    extra = ' · '.join(filter(None, [
        _txt(device.get('storage')),
        ('IMEI ' + _txt(device.get('imei'))) if _txt(device.get('imei')) else '',
    ]))

    height = 30 if not issue else 30 + 13 * len(wrap(issue, CONTENT_W - 28, 9.5))
    pdf.rect(MARGIN, y - height + 14, CONTENT_W, height, BAND, radius=6)

    inner = y
    pdf.text(MARGIN + 14, inner, name or 'Equipo', size=11, bold=True, color=INK)
    if extra:
        pdf.text(PAGE_W - MARGIN - 14, inner, extra, size=9, color=SOFT, align='right')
    inner -= 14

    for row in wrap(issue, CONTENT_W - 28, 9.5):
        pdf.text(MARGIN + 14, inner, row, size=9.5, color=SOFT)
        inner -= 12

    return y - height - 6


def _lines_table(pdf, quote, y):
    """La tabla del trabajo a hacer."""
    col_qty = PAGE_W - MARGIN - 210
    col_unit = PAGE_W - MARGIN - 110
    col_total = PAGE_W - MARGIN

    y -= 16
    pdf.text(MARGIN, y, 'CONCEPTO', size=8, bold=True, color=FAINT)
    pdf.text(col_qty, y, 'UDS', size=8, bold=True, color=FAINT, align='right')
    pdf.text(col_unit, y, 'PRECIO', size=8, bold=True, color=FAINT, align='right')
    pdf.text(col_total, y, 'IMPORTE', size=8, bold=True, color=FAINT, align='right')
    y -= 8
    pdf.line(MARGIN, y, PAGE_W - MARGIN, y, LINE, 1)
    y -= 16

    for line in quote.get('lines') or []:
        concept = _txt(line.get('concept')) or 'Concepto'
        qty = _num(line.get('qty'), 1)
        unit = _num(line.get('unitPrice'))
        rows = wrap(concept, col_qty - MARGIN - 16, 10)

        # ¿cabe la fila en lo que queda de página?
        if y - 13 * len(rows) < 150:
            pdf.new_page()
            y = PAGE_H - MARGIN - 10

        pdf.text(MARGIN, y, rows[0], size=10, color=INK)
        pdf.text(col_qty, y, ('%g' % qty).replace('.', ','), size=10, color=SOFT, align='right')
        pdf.text(col_unit, y, money(unit), size=10, color=SOFT, align='right')
        pdf.text(col_total, y, money(qty * unit), size=10, bold=True, color=INK, align='right')

        for extra_row in rows[1:]:
            y -= 12
            pdf.text(MARGIN, y, extra_row, size=10, color=SOFT)

        detail = _txt(line.get('note'))
        if detail:
            for row in wrap(detail, col_qty - MARGIN - 16, 8.5):
                y -= 11
                pdf.text(MARGIN, y, row, size=8.5, color=FAINT)

        y -= 12
        pdf.line(MARGIN, y, PAGE_W - MARGIN, y, (.94, .95, .97), 0.6)
        y -= 15

    return y


def _totals(pdf, sums, y):
    """Los números, alineados a la derecha."""
    if y < 190:
        pdf.new_page()
        y = PAGE_H - MARGIN - 20

    box_x = PAGE_W - MARGIN - 230
    right = PAGE_W - MARGIN - 14
    left = box_x + 14

    rows = [('Base', money(sums['base'] + sums['discount']))]
    if sums['discount']:
        rows.append(('Descuento', '-' + money(sums['discount'])))
        rows.append(('Subtotal', money(sums['base'])))
    if sums['rate']:
        rows.append(('IVA (%g%%)' % sums['rate'], money(sums['vat'])))

    height = 30 + 15 * len(rows) + 34
    pdf.rect(box_x, y - height + 16, 230, height, BAND, radius=8)

    inner = y - 2
    for label, value in rows:
        pdf.text(left, inner, label, size=9.5, color=SOFT)
        pdf.text(right, inner, value, size=9.5, color=INK, align='right')
        inner -= 15

    inner -= 4
    pdf.line(left, inner + 8, right, inner + 8, (.85, .88, .93), 0.8)
    inner -= 8

    pdf.text(left, inner, 'TOTAL', size=11, bold=True, color=INK)
    pdf.text(right, inner, money(sums['total']), size=15, bold=True, color=BRAND, align='right')

    if not sums['rate']:
        inner -= 13
        pdf.text(right, inner, 'IVA no incluido', size=7.5, color=FAINT, align='right')

    return y - height - 10


def _notes(pdf, quote, business, y, attachments=None):
    """Notas, informe de diagnóstico y condiciones."""
    blocks = []
    if _txt(quote.get('notes')):
        blocks.append(('Notas', _txt(quote.get('notes'))))

    # Si la ficha lleva un informe de diagnóstico, que conste en el papel
    reports = [f for f in (attachments or []) if f.get('kind') == 'diagnostico']
    if reports:
        listado = '; '.join('%s (%s)' % (_txt(f.get('name')), _txt(f.get('uploadedAt')))
                            for f in reports[:3])
        blocks.append(('Diagnóstico',
                       'Se entrega junto a este presupuesto el informe de diagnóstico del '
                       'equipo: ' + listado + '.'))
    terms = _txt(business.get('terms')) or (
        'Presupuesto sin compromiso. La reparación no empieza hasta que lo apruebes. '
        'Puede haber averías que sólo se ven al abrir el equipo: si aparece algo más, '
        'te aviso antes de seguir.')
    blocks.append(('Condiciones', terms))

    for label, body in blocks:
        rows = wrap(body, CONTENT_W, 8.5)
        need = 16 + 11 * len(rows)
        if y - need < 90:
            pdf.new_page()
            y = PAGE_H - MARGIN - 20

        pdf.text(MARGIN, y, label.upper(), size=8, bold=True, color=FAINT)
        y -= 13
        for row in rows:
            pdf.text(MARGIN, y, row, size=8.5, color=SOFT)
            y -= 11
        y -= 8

    return y


def _footer(pdf, business):
    """Pie de todas las páginas, con hueco para la firma."""
    for index in range(len(pdf.pages) + 1):
        if index < len(pdf.pages):
            continue                       # el pie se pinta sólo en la última
        pdf.line(MARGIN, 96, PAGE_W - MARGIN, 96, LINE, 0.8)

        pdf.text(MARGIN, 78, 'Conforme (firma del cliente)', size=8, color=FAINT)
        pdf.line(MARGIN, 52, MARGIN + 190, 52, (.8, .83, .88), 0.8)

        closing = _txt(business.get('footer')) or 'Gracias por confiar en el taller.'
        pdf.text(PAGE_W - MARGIN, 78, closing, size=8.5, color=SOFT, align='right')
        name = _txt(business.get('name'))
        if name:
            pdf.text(PAGE_W - MARGIN, 64, name, size=8, color=FAINT, align='right')
