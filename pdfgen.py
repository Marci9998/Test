#!/usr/bin/env python3
"""
pdfgen.py — genera el PDF del presupuesto sin librerías de fuera.

Escribe el PDF a mano (es un formato de texto con un índice al final), así
que no hace falta instalar nada: con el Python que ya trae el sistema vale.

Usa Helvetica, que va dentro de cualquier lector de PDF, con la codificación
WinAnsi, que cubre acentos, eñes y el símbolo del euro.
"""

import time

# ── medidas ──────────────────────────────────────────────────────────
# Un A4 en puntos (1 punto = 1/72 pulgada)
PAGE_W, PAGE_H = 595.28, 841.89
MARGIN = 48

# Anchos reales de Helvetica, para poder alinear a la derecha y cortar
# líneas donde toca. Están en milésimas del tamaño de letra.
_REG = {
    ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
    '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
    ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
    'A': 667, 'B': 667, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778, 'H': 722,
    'I': 278, 'J': 500, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778, 'P': 667,
    'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944, 'X': 667,
    'Y': 667, 'Z': 611, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333,
    'a': 556, 'b': 556, 'c': 500, 'd': 556, 'e': 556, 'f': 278, 'g': 556, 'h': 556,
    'i': 222, 'j': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556, 'p': 556,
    'q': 556, 'r': 333, 's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722, 'x': 500,
    'y': 500, 'z': 500, '{': 334, '|': 260, '}': 334, '~': 584,
}
_BOLD = {
    ' ': 278, '!': 333, '"': 474, '#': 556, '$': 556, '%': 889, '&': 722, "'": 238,
    '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
    ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611, '@': 975,
    'A': 722, 'B': 722, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778, 'H': 722,
    'I': 278, 'J': 556, 'K': 722, 'L': 611, 'M': 833, 'N': 722, 'O': 778, 'P': 667,
    'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944, 'X': 667,
    'Y': 667, 'Z': 611, '[': 333, '\\': 278, ']': 333, '^': 584, '_': 556, '`': 333,
    'a': 556, 'b': 611, 'c': 556, 'd': 611, 'e': 556, 'f': 333, 'g': 611, 'h': 611,
    'i': 278, 'j': 278, 'k': 556, 'l': 278, 'm': 889, 'n': 611, 'o': 611, 'p': 611,
    'q': 611, 'r': 389, 's': 556, 't': 333, 'u': 611, 'v': 556, 'w': 778, 'x': 556,
    'y': 556, 'z': 500, '{': 389, '|': 280, '}': 389, '~': 584,
}
for _d in (_REG, _BOLD):
    for _c in '0123456789':
        _d[_c] = 556

# Las acentuadas miden lo mismo que su letra sin acento
_BASE = {
    'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
    'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i', 'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o',
    'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u', 'ñ': 'n', 'ç': 'c',
    'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ñ': 'N', 'Ü': 'U', 'Ç': 'C',
    '€': 'E', '¿': '?', '¡': '!', 'º': 'o', 'ª': 'a', '·': '.', '–': '-', '—': '-',
    '“': '"', '”': '"', '‘': "'", '’': "'", '…': '.',
}


def text_width(text, size, bold=False):
    table = _BOLD if bold else _REG
    total = 0
    for ch in str(text):
        ch = _BASE.get(ch, ch)
        total += table.get(ch, 556)
    return total * size / 1000.0


def wrap(text, width, size, bold=False):
    """Parte el texto en líneas que quepan en el ancho dado."""
    words = str(text).split()
    if not words:
        return ['']
    lines, current = [], words[0]
    for word in words[1:]:
        probe = current + ' ' + word
        if text_width(probe, size, bold) <= width:
            current = probe
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


# ── el PDF en sí ─────────────────────────────────────────────────────

class Pdf:
    """Un PDF de varias páginas con lo justo: texto, líneas y recuadros."""

    def __init__(self, title='Documento', width=PAGE_W, height=PAGE_H, margin=MARGIN):
        """Por defecto un A4. Los tickets de papel térmico pasan su ancho
        de rollo y el alto que les haya salido."""
        self.pages = []
        self.parts = []
        self.title = title
        self.width = width
        self.height = height
        self.margin = margin
        self.new_page()

    def new_page(self):
        if self.parts:
            self.pages.append(''.join(self.parts))
        self.parts = []
        self.y = self.height - self.margin

    # — dibujo —

    def rect(self, x, y, w, h, color=(0, 0, 0), radius=0):
        r, g, b = color
        if radius <= 0:
            self.parts.append('%.3f %.3f %.3f rg %.2f %.2f %.2f %.2f re f\n'
                              % (r, g, b, x, y, w, h))
            return
        # esquinas redondeadas con curvas de Bézier
        k = radius * 0.5523
        self.parts.append(
            '%.3f %.3f %.3f rg\n'
            '%.2f %.2f m\n'
            '%.2f %.2f l %.2f %.2f %.2f %.2f %.2f %.2f c\n'
            '%.2f %.2f l %.2f %.2f %.2f %.2f %.2f %.2f c\n'
            '%.2f %.2f l %.2f %.2f %.2f %.2f %.2f %.2f c\n'
            '%.2f %.2f l %.2f %.2f %.2f %.2f %.2f %.2f c\n'
            'f\n' % (
                r, g, b,
                x + radius, y,
                x + w - radius, y, x + w - radius + k, y, x + w, y + radius - k, x + w, y + radius,
                x + w, y + h - radius, x + w, y + h - radius + k, x + w - radius + k, y + h, x + w - radius, y + h,
                x + radius, y + h, x + radius - k, y + h, x, y + h - radius + k, x, y + h - radius,
                x, y + radius, x, y + radius - k, x + radius - k, y, x + radius, y,
            ))

    def line(self, x1, y1, x2, y2, color=(.85, .87, .9), width=0.7):
        r, g, b = color
        self.parts.append('%.3f %.3f %.3f RG %.2f w %.2f %.2f m %.2f %.2f l S\n'
                          % (r, g, b, width, x1, y1, x2, y2))

    def text(self, x, y, value, size=10, bold=False, color=(.1, .12, .15), align='left', width=0):
        value = str(value)
        if not value:
            return
        if align == 'right':
            x -= text_width(value, size, bold)
        elif align == 'center':
            x -= text_width(value, size, bold) / 2.0
        r, g, b = color
        self.parts.append('BT /%s %.2f Tf %.3f %.3f %.3f rg %.2f %.2f Td (%s) Tj ET\n'
                          % ('F2' if bold else 'F1', size, r, g, b, x, y, _escape(value)))

    # — armar el fichero —

    def build(self):
        self.pages.append(''.join(self.parts))
        self.parts = []

        objects = []                      # cada objeto del PDF, en orden

        def add(body):
            objects.append(body)
            return len(objects)           # los números empiezan en 1

        font_regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica '
                           '/Encoding /WinAnsiEncoding >>')
        font_bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold '
                        '/Encoding /WinAnsiEncoding >>')

        pages_id = len(objects) + 1 + 2 * len(self.pages)   # se sabe al final
        page_ids = []

        for content in self.pages:
            raw = content.encode('cp1252', errors='replace')
            stream_id = add('<< /Length %d >>\nstream\n%s\nendstream'
                            % (len(raw), raw.decode('cp1252')))
            page_ids.append(add(
                '<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] '
                '/Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> '
                '/Contents %d 0 R >>'
                % (pages_id, self.width, self.height, font_regular, font_bold, stream_id)))

        kids = ' '.join('%d 0 R' % pid for pid in page_ids)
        add('<< /Type /Pages /Kids [%s] /Count %d >>' % (kids, len(page_ids)))
        catalog = add('<< /Type /Catalog /Pages %d 0 R >>' % pages_id)
        stamp = time.strftime('D:%Y%m%d%H%M%S')
        info = add('<< /Title (%s) /Producer (Taller) /CreationDate (%s) >>'
                   % (_escape(self.title), stamp))

        out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
        offsets = [0]
        for number, body in enumerate(objects, start=1):
            offsets.append(len(out))
            out += ('%d 0 obj\n%s\nendobj\n' % (number, body)).encode('cp1252', errors='replace')

        start_xref = len(out)
        out += ('xref\n0 %d\n' % (len(objects) + 1)).encode()
        out += b'0000000000 65535 f \n'
        for offset in offsets[1:]:
            out += ('%010d 00000 n \n' % offset).encode()
        out += ('trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n'
                % (len(objects) + 1, catalog, info, start_xref)).encode()
        return bytes(out)


def _escape(text):
    return (str(text).replace('\\', r'\\').replace('(', r'\(').replace(')', r'\)'))
