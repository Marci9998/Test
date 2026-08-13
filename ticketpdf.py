"""ticketpdf.py — el ticket de papel térmico, el fino de las tiendas.

Las impresoras de recibos usan rollo continuo de 58 o 80 mm: el ancho es
fijo y el alto es el que salga. Por eso el ticket se monta en dos pasadas:
primero se apunta todo lo que va a llevar y se mide, y con el alto ya
sabido se pinta, que en un PDF las coordenadas van desde abajo.

Se imprime desde el navegador a la impresora térmica como a cualquier otra.
En el diálogo de imprimir hay que poner **escala 100 %** y márgenes
«ninguno»: si se deja en «ajustar a la página» sale encogido.

Dos tipos, que en el taller no son lo mismo:

  · **resguardo** — lo que se le da al cliente cuando deja el aparato:
    qué ha traído, qué le pasa y lo que se le ha presupuestado.
  · **entrega** — lo que se le da al recogerlo: lo que se ha hecho, lo que
    paga y la garantía.

Sólo biblioteca estándar.
"""

import time

import pdfgen

MM = 72.0 / 25.4                     # milímetros a puntos
WIDTHS = {'80': 80.0, '58': 58.0}    # anchos de rollo corrientes

BLACK = (.08, .09, .11)
GREY = (.35, .38, .42)
RULE = (.55, .58, .62)


def _money(value):
    """1234.5 → «1.234,50 €», como se escribe aquí."""
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0.0
    entera, decimal = ('%.2f' % abs(number)).split('.')
    grupos = []
    while len(entera) > 3:
        grupos.insert(0, entera[-3:])
        entera = entera[:-3]
    grupos.insert(0, entera)
    return ('-' if number < 0 else '') + '.'.join(grupos) + ',' + decimal + ' €'


def _date(iso):
    iso = str(iso or '')[:10]
    if len(iso) == 10 and iso[4] == '-':
        return '%s/%s/%s' % (iso[8:10], iso[5:7], iso[0:4])
    return iso


class Ticket:
    """Va apuntando lo que lleva el ticket; al final se mide y se pinta."""

    def __init__(self, width_mm=80.0):
        self.page_w = width_mm * MM
        self.margin = 6 * MM if width_mm >= 70 else 4 * MM
        self.inner = self.page_w - 2 * self.margin
        self.rows = []

    # — ir apuntando —

    def text(self, value, size=8.5, bold=False, align='left', color=BLACK, gap=2.2):
        """Una línea (o varias, si no cabe: se parte por palabras)."""
        for line in pdfgen.wrap(str(value or ''), self.inner, size, bold) or ['']:
            self.rows.append({'kind': 'text', 'text': line, 'size': size, 'bold': bold,
                              'align': align, 'color': color, 'h': size + gap})

    def pair(self, left, right, size=8.5, bold=False, color=BLACK, gap=2.2):
        """Concepto a la izquierda, importe a la derecha, sin que se pisen."""
        left = str(left or '')
        right = str(right or '')
        hueco = self.inner - pdfgen.text_width(right, size, bold) - 6
        trozos = pdfgen.wrap(left, max(20, hueco), size, bold) or ['']

        self.rows.append({'kind': 'pair', 'text': trozos[0], 'right': right, 'size': size,
                          'bold': bold, 'color': color, 'h': size + gap})
        for extra in trozos[1:]:            # el resto del concepto, debajo
            self.rows.append({'kind': 'text', 'text': extra, 'size': size, 'bold': bold,
                              'align': 'left', 'color': color, 'h': size + gap})

    def rule(self, dashed=True, gap=5.5):
        self.rows.append({'kind': 'rule', 'dashed': dashed, 'h': gap})

    def space(self, height=5):
        self.rows.append({'kind': 'space', 'h': height})

    # — pintar —

    def build(self, title='Ticket'):
        alto = self.margin * 2 + sum(row['h'] for row in self.rows)
        alto += 14 * MM                    # cola en blanco: la térmica corta ahí

        pdf = pdfgen.Pdf(title, width=self.page_w, height=alto, margin=self.margin)
        y = alto - self.margin

        for row in self.rows:
            y -= row['h']
            if row['kind'] == 'text':
                x = {'left': self.margin,
                     'center': self.page_w / 2.0,
                     'right': self.page_w - self.margin}[row['align']]
                pdf.text(x, y, row['text'], row['size'], row['bold'], row['color'], row['align'])
            elif row['kind'] == 'pair':
                pdf.text(self.margin, y, row['text'], row['size'], row['bold'], row['color'])
                pdf.text(self.page_w - self.margin, y, row['right'], row['size'],
                         row['bold'], row['color'], 'right')
            elif row['kind'] == 'rule':
                self._rule(pdf, y + row['h'] / 2.0, row.get('dashed', True))

        return pdf.build()

    def _rule(self, pdf, y, dashed):
        if not dashed:
            pdf.line(self.margin, y, self.page_w - self.margin, y, RULE, 0.8)
            return
        # a rayitas, como los tickets de toda la vida
        paso, raya = 4.0, 2.4
        x = self.margin
        while x < self.page_w - self.margin:
            pdf.line(x, y, min(x + raya, self.page_w - self.margin), y, RULE, 0.7)
            x += paso


# ── el ticket de una ficha ───────────────────────────────────────────

def build(ticket, business=None, profile_name='', kind='resguardo', width='80',
          number=None, costs=False):
    """Devuelve los bytes del PDF del ticket de una ficha.

    `costs=True` es la copia para el taller: lleva los costes de las piezas
    y el beneficio. Esa no se le da al cliente.
    """
    business = business or {}
    ancho = WIDTHS.get(str(width), 80.0)
    t = Ticket(ancho)

    cliente = (ticket.get('type') == 'cliente')
    entrega = (kind == 'entrega')

    # — cabecera del taller —
    nombre = (business.get('name') or profile_name or 'Taller').strip()
    t.text(nombre.upper(), size=11 if ancho >= 70 else 9.5, bold=True, align='center', gap=3)
    for linea in (business.get('address'), business.get('phone'),
                  ('NIF ' + business['taxId']) if business.get('taxId') else ''):
        if linea:
            t.text(linea, size=7.5, align='center', color=GREY, gap=1.6)
    t.space(4)
    t.rule()

    # — de qué es este papel —
    if costs:
        titulo = 'COPIA PARA EL TALLER'
    elif cliente:
        titulo = 'TICKET DE ENTREGA' if entrega else 'RESGUARDO DE ENTRADA'
    else:
        titulo = 'TICKET DE VENTA' if entrega else 'FICHA DE EQUIPO'
    t.text(titulo, size=9.5, bold=True, align='center', gap=3)

    referencia = str(number or ticket.get('ref') or (ticket.get('id') or '')[:8]).upper()
    fecha = _date(ticket.get('soldAt') if entrega and ticket.get('soldAt')
                  else ticket.get('createdAt'))
    t.pair('N.º ' + referencia, fecha, size=8)
    t.rule()

    # — cliente —
    if cliente and (ticket.get('customerName') or ticket.get('customerPhone')):
        if ticket.get('customerName'):
            t.pair('Cliente', ticket['customerName'], size=8)
        if ticket.get('customerPhone'):
            t.pair('Teléfono', ticket['customerPhone'], size=8)
        t.rule()

    # — el aparato —
    equipo = ' '.join(x for x in [ticket.get('brand'), ticket.get('model')] if x).strip()
    t.text(equipo or 'Sin modelo', size=9, bold=True, gap=2.6)
    detalles = ' · '.join(x for x in [ticket.get('storage'), ticket.get('color')] if x)
    if detalles:
        t.text(detalles, size=7.5, color=GREY, gap=1.8)
    if ticket.get('imei'):
        t.text('IMEI ' + str(ticket['imei']), size=7.5, color=GREY, gap=1.8)
    if ticket.get('issue'):
        t.space(2)
        t.text('Avería: ' + str(ticket['issue']), size=8)
    t.rule()

    # — lo que se ha hecho —
    #
    # Ojo con los importes: en una ficha, lo que hay apuntado en cada pieza
    # es lo que te cuesta a ti, no lo que le cobras. En el papel del cliente
    # sólo va la lista de lo que se ha cambiado; los números salen en la
    # copia para el taller. Si quieres darle el desglose con precios de
    # venta, eso es un presupuesto, y también se imprime en térmico.
    partes = [p for p in (ticket.get('parts') or [])
              if (p.get('name') or '').strip() or _num(p.get('unitCost'))]

    if partes:
        t.text('COSTES DEL TALLER' if costs else 'TRABAJO REALIZADO',
               size=7, bold=True, color=GREY, gap=3)
        for parte in partes:
            unidades = _num(parte.get('qty')) or 1
            etiqueta = (parte.get('name') or 'Pieza').strip()
            if unidades != 1:
                etiqueta += '  x%s' % _qty(unidades)
            if costs:
                t.pair(etiqueta, _money(unidades * _num(parte.get('unitCost'))), size=8)
            else:
                t.text('· ' + etiqueta, size=8)
        t.space(1)

    if costs:
        if _num(ticket.get('purchaseCost')) and not cliente:
            t.pair('Compra del equipo', _money(ticket['purchaseCost']), size=8)
        if _num(ticket.get('extraCost')):
            t.pair('Otros gastos', _money(ticket['extraCost']), size=8)

    total = _total(ticket, cliente, entrega)
    grande = 11 if ancho >= 70 else 9.5
    t.rule()

    if costs:
        coste = _cost(ticket, cliente)
        t.pair('COSTE TOTAL', _money(coste), size=grande, bold=True, gap=3)
        t.pair('Precio de venta', _money(total) if total is not None else 'sin poner', size=8)
        if total is not None:
            t.pair('Beneficio', _money(total - coste), size=8.5, bold=True)
    elif total is None:
        # sin precio puesto se dice, y no se inventa un número
        t.pair('TOTAL' if cliente else 'PRECIO', 'pendiente', size=grande, bold=True, gap=3)
        t.text('Se le dirá el precio antes de tocar nada.' if cliente
               else 'Precio todavía sin poner.', size=7, color=GREY, gap=1.4)
    else:
        t.pair('TOTAL' if cliente else 'PRECIO', _money(total), size=grande, bold=True, gap=3)
    t.rule()

    # — estado y avisos —
    if costs:
        t.text('Estado: ' + str(ticket.get('status') or '—'), size=7.5,
               align='center', color=GREY, gap=2.6)
        t.text('Copia interna. No dársela al cliente.', size=7,
               align='center', color=GREY, gap=1.4)
    elif entrega:
        t.text('Pagado. Gracias por la confianza.', size=8, align='center', gap=2.6)
    else:
        estado = 'Presupuesto sin compromiso.' if cliente else 'Ficha interna del taller.'
        t.text(estado, size=8, align='center', color=GREY, gap=2.6)

    aviso = (business.get('terms') or '').strip()
    if aviso and not costs:
        t.space(3)
        t.text(aviso, size=7, color=GREY, gap=1.4)

    if cliente and not entrega and not costs:
        t.space(3)
        t.text('Conserve este resguardo: hace falta para recoger el equipo.',
               size=7, align='center', color=GREY, gap=1.4)

    pie = (business.get('footer') or '').strip()
    if pie and not costs:
        t.space(3)
        t.text(pie, size=7, align='center', color=GREY, gap=1.4)

    t.space(4)
    t.text(time.strftime('%d/%m/%Y %H:%M'), size=6.5, align='center', color=GREY, gap=1.2)

    return t.build('Ticket %s' % referencia)


def build_quote(quote, business=None, profile_name='', width='80'):
    """El presupuesto en papel térmico.

    Aquí sí va el desglose con importes: las líneas de un presupuesto son
    precios de venta, lo que se le cobra, no lo que cuesta la pieza.
    """
    business = business or {}
    ancho = WIDTHS.get(str(width), 80.0)
    t = Ticket(ancho)

    nombre = (business.get('name') or profile_name or 'Taller').strip()
    t.text(nombre.upper(), size=11 if ancho >= 70 else 9.5, bold=True, align='center', gap=3)
    for linea in (business.get('address'), business.get('phone'),
                  ('NIF ' + business['taxId']) if business.get('taxId') else ''):
        if linea:
            t.text(linea, size=7.5, align='center', color=GREY, gap=1.6)
    t.space(4)
    t.rule()

    factura = quote.get('kind') == 'factura'
    numero = str((quote.get('invoiceNumber') if factura else quote.get('number')) or '')

    t.text('FACTURA' if factura else 'PRESUPUESTO', size=9.5, bold=True,
           align='center', gap=3)
    t.pair('N.º ' + numero,
           _date(quote.get('issuedAt') if factura else quote.get('createdAt')), size=8)
    if factura and quote.get('payMethod'):
        t.pair('Forma de pago', str(quote['payMethod']), size=7.5, color=GREY)
    elif not factura and quote.get('validUntil'):
        t.pair('Válido hasta', _date(quote['validUntil']), size=7.5, color=GREY)
    t.rule()

    cliente = quote.get('customer') or {}
    if cliente.get('name') or cliente.get('phone'):
        if cliente.get('name'):
            t.pair('Cliente', cliente['name'], size=8)
        if cliente.get('phone'):
            t.pair('Teléfono', cliente['phone'], size=8)
        t.rule()

    equipo = quote.get('device') or {}
    nombre_equipo = ' '.join(x for x in [equipo.get('brand'), equipo.get('model')] if x).strip()
    if nombre_equipo:
        t.text(nombre_equipo, size=9, bold=True, gap=2.6)
        if equipo.get('storage'):
            t.text(equipo['storage'], size=7.5, color=GREY, gap=1.8)
        if equipo.get('imei'):
            t.text('IMEI ' + str(equipo['imei']), size=7.5, color=GREY, gap=1.8)
    if quote.get('issue'):
        t.space(2)
        t.text('Avería: ' + str(quote['issue']), size=8)
    t.rule()

    base = 0.0
    t.pair('CONCEPTO', 'IMPORTE', size=7, bold=True, color=GREY, gap=3)
    for linea in quote.get('lines') or []:
        unidades = _num(linea.get('qty')) or 1
        importe = unidades * _num(linea.get('unitPrice'))
        base += importe
        etiqueta = (linea.get('concept') or '').strip() or 'Concepto'
        if unidades != 1:
            etiqueta += '  x%s' % _qty(unidades)
        t.pair(etiqueta, _money(importe), size=8)
        if linea.get('note'):
            t.text('   ' + str(linea['note']), size=6.8, color=GREY, gap=1.4)

    t.rule()
    descuento = _num(quote.get('discount'))
    neto = max(0.0, base - descuento)
    iva = neto * _num(quote.get('vatRate')) / 100.0

    if descuento:
        t.pair('Base', _money(base), size=8, color=GREY)
        t.pair('Descuento', '-' + _money(descuento), size=8, color=GREY)
    if _num(quote.get('vatRate')):
        t.pair('Subtotal', _money(neto), size=8, color=GREY)
        t.pair('IVA (%s%%)' % _qty(_num(quote.get('vatRate'))), _money(iva), size=8, color=GREY)

    t.pair('TOTAL', _money(neto + iva), size=11 if ancho >= 70 else 9.5, bold=True, gap=3)
    t.rule()

    if factura:
        t.text('PAGADO' + (' · ' + str(quote['payMethod']) if quote.get('payMethod') else ''),
               size=9, bold=True, align='center', gap=2.6)
    if _num(quote.get('vatRate')):
        t.text('IVA incluido.', size=7.5, align='center', color=GREY, gap=2.2)

    for texto, size in ((quote.get('notes'), 7), (business.get('terms'), 7)):
        if (texto or '').strip():
            t.space(3)
            t.text(texto.strip(), size=size, color=GREY, gap=1.4)

    pie = (business.get('footer') or '').strip()
    if pie:
        t.space(3)
        t.text(pie, size=7, align='center', color=GREY, gap=1.4)

    t.space(4)
    t.text(time.strftime('%d/%m/%Y %H:%M'), size=6.5, align='center', color=GREY, gap=1.2)

    return t.build(('Factura %s' if factura else 'Presupuesto %s') % numero)


def _num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _cost(ticket, cliente):
    """Lo que te ha costado a ti: compra + piezas + gastos."""
    piezas = sum((_num(p.get('qty')) or 1) * _num(p.get('unitCost'))
                 for p in ticket.get('parts') or [])
    compra = 0.0 if cliente else _num(ticket.get('purchaseCost'))
    return compra + piezas + _num(ticket.get('extraCost'))


def _qty(value):
    """2.0 → «2»; 1.5 → «1,5»."""
    if abs(value - round(value)) < 0.005:
        return str(int(round(value)))
    return ('%.2f' % value).rstrip('0').rstrip('.').replace('.', ',')


def _total(ticket, cliente, entrega):
    """Lo que se le cobra al cliente, o lo que vale el móvil de reventa.

    Devuelve None si todavía no hay precio puesto. Aquí **no** se puede
    tirar de los costes como apaño: lo apuntado en las piezas es lo que te
    cuesta a ti, y sacarlo en el papel del cliente le estaría enseñando tu
    margen y, encima, un número que no es el que va a pagar.
    """
    if entrega and _num(ticket.get('salePrice')):
        return _num(ticket['salePrice'])
    if _num(ticket.get('listPrice')):
        return _num(ticket['listPrice'])
    if _num(ticket.get('salePrice')):
        return _num(ticket['salePrice'])
    return None
