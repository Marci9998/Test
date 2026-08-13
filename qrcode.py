"""qrcode.py — códigos QR sin librerías.

Hace falta para el QR de cobro: el cliente lo escanea con el móvil y le
sale la pantalla de pago con el importe ya puesto.

Se genera a mano porque el resto del programa no instala nada: sólo la
biblioteca estándar de Python 3. Sigue la norma ISO/IEC 18004 en lo que
nos hace falta — modo byte (UTF-8), versiones 1 a 10 y corrección de
errores L o M, que sobra de largo para una dirección web.

Devuelve la matriz de puntos; quien la use la pinta como quiera (SVG para
la pantalla, rectángulos para el PDF del ticket).
"""

# ── aritmética del campo de Galois GF(256), la de Reed-Solomon ───────

_EXP = [0] * 512
_LOG = [0] * 256

def _init_tables():
    x = 1
    for i in range(255):
        _EXP[i] = x
        _LOG[x] = i
        x <<= 1
        if x & 0x100:          # el polinomio irreducible de QR
            x ^= 0x11D
    for i in range(255, 512):
        _EXP[i] = _EXP[i - 255]

_init_tables()


def _mul(a, b):
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _rs_generator(degree):
    """Polinomio generador, en orden descendente: el primero es el líder.

    Es (x - α⁰)(x - α¹)… multiplicado paso a paso; en este campo restar y
    sumar son lo mismo (un XOR).
    """
    poly = [1]
    for i in range(degree):
        nuevo = [0] * (len(poly) + 1)
        for j, coef in enumerate(poly):
            nuevo[j] ^= coef                        # coef · x
            nuevo[j + 1] ^= _mul(coef, _EXP[i])     # coef · αⁱ
        poly = nuevo
    return poly


def _rs_encode(data, ec_len):
    """Los bytes de corrección de un bloque: el resto de la división."""
    generator = _rs_generator(ec_len)
    resto = list(data) + [0] * ec_len

    for i in range(len(data)):
        coef = resto[i]
        if coef:
            for j in range(1, len(generator)):
                resto[i + j] ^= _mul(generator[j], coef)

    return resto[len(data):]


# ── tablas de la norma ───────────────────────────────────────────────
# version → nivel → (bytes de corrección por bloque, [(nº bloques, bytes de datos)])

BLOCKS = {
    1:  {'L': (7,  [(1, 19)]),              'M': (10, [(1, 16)])},
    2:  {'L': (10, [(1, 34)]),              'M': (16, [(1, 28)])},
    3:  {'L': (15, [(1, 55)]),              'M': (26, [(1, 44)])},
    4:  {'L': (20, [(1, 80)]),              'M': (18, [(2, 32)])},
    5:  {'L': (26, [(1, 108)]),             'M': (24, [(2, 43)])},
    6:  {'L': (18, [(2, 68)]),              'M': (16, [(4, 27)])},
    7:  {'L': (20, [(2, 78)]),              'M': (18, [(4, 31)])},
    8:  {'L': (24, [(2, 97)]),              'M': (22, [(2, 38), (2, 39)])},
    9:  {'L': (30, [(2, 116)]),             'M': (22, [(3, 36), (2, 37)])},
    10: {'L': (18, [(2, 68), (2, 69)]),     'M': (26, [(4, 43), (1, 44)])},
}

# centros de los patrones de alineación, por versión
ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}

EC_BITS = {'L': 1, 'M': 0, 'Q': 3, 'H': 2}      # como van en la cabecera


def _data_capacity(version, level):
    _, groups = BLOCKS[version][level]
    return sum(count * size for count, size in groups)


def _bch15(data):
    """Los 15 bits del bloque de formato (nivel + máscara)."""
    d = data << 10
    while d.bit_length() > 10:
        d ^= 0x537 << (d.bit_length() - 11)
    return ((data << 10) | d) ^ 0x5412


def _bch18(version):
    """Los 18 bits del bloque de versión (sólo de la 7 en adelante)."""
    d = version << 12
    while d.bit_length() > 12:
        d ^= 0x1F25 << (d.bit_length() - 13)
    return (version << 12) | d


# ── construir el código ──────────────────────────────────────────────

def _bitstream(text, version, level):
    """Los datos, en bits, con su cabecera y el relleno de la norma."""
    payload = text.encode('utf-8')
    capacity = _data_capacity(version, level)

    bits = []
    def put(value, length):
        for i in range(length - 1, -1, -1):
            bits.append((value >> i) & 1)

    put(0b0100, 4)                                  # modo byte
    put(len(payload), 8 if version < 10 else 16)    # cuántos bytes vienen
    for byte in payload:
        put(byte, 8)

    # terminador y relleno hasta llenar el hueco
    put(0, min(4, capacity * 8 - len(bits)))
    while len(bits) % 8:
        bits.append(0)

    data = bytearray(int(''.join(map(str, bits[i:i + 8])), 2)
                     for i in range(0, len(bits), 8))
    pad = [0xEC, 0x11]
    while len(data) < capacity:
        data.append(pad[(len(data) - len(bits) // 8) % 2])
    return bytes(data)


def _interleave(data, version, level):
    """Reparte en bloques, calcula la corrección y lo entrelaza."""
    ec_len, groups = BLOCKS[version][level]

    blocks, pos = [], 0
    for count, size in groups:
        for _ in range(count):
            blocks.append(data[pos:pos + size])
            pos += size

    ec_blocks = [_rs_encode(b, ec_len) for b in blocks]

    out = bytearray()
    for i in range(max(len(b) for b in blocks)):
        for block in blocks:
            if i < len(block):
                out.append(block[i])
    for i in range(ec_len):
        for block in ec_blocks:
            out.append(block[i])
    return bytes(out)


def _reserve(size, version):
    """Marca lo que no es zona de datos: patrones, tiempos y formato."""
    taken = [[False] * size for _ in range(size)]

    def block(row, col, height, width):
        for r in range(row, row + height):
            for c in range(col, col + width):
                if 0 <= r < size and 0 <= c < size:
                    taken[r][c] = True

    # los tres ojos, con su separador y el hueco del formato
    block(0, 0, 9, 9)
    block(0, size - 8, 9, 8)
    block(size - 8, 0, 8, 9)

    for pos in ALIGN[version]:                      # patrones de alineación
        for other in ALIGN[version]:
            if (pos, other) in ((6, 6), (6, size - 7), (size - 7, 6)):
                continue
            block(pos - 2, other - 2, 5, 5)

    block(6, 0, 1, size)                            # líneas de tiempo
    block(0, 6, size, 1)

    if version >= 7:                                # bloques de versión
        block(size - 11, 0, 3, 6)
        block(0, size - 11, 6, 3)

    return taken


def _draw_patterns(m, size, version):
    def finder(row, col):
        for r in range(-1, 8):
            for c in range(-1, 8):
                rr, cc = row + r, col + c
                if not (0 <= rr < size and 0 <= cc < size):
                    continue
                borde = (r in (0, 6) and 0 <= c <= 6) or (c in (0, 6) and 0 <= r <= 6)
                centro = 2 <= r <= 4 and 2 <= c <= 4
                m[rr][cc] = borde or centro

    finder(0, 0)
    finder(0, size - 7)
    finder(size - 7, 0)

    for pos in ALIGN[version]:
        for other in ALIGN[version]:
            if (pos, other) in ((6, 6), (6, size - 7), (size - 7, 6)):
                continue
            for r in range(-2, 3):
                for c in range(-2, 3):
                    m[pos + r][other + c] = max(abs(r), abs(c)) != 1

    for i in range(size):                           # líneas de tiempo
        m[6][i] = m[6][i] if i < 8 or i >= size - 8 else (i % 2 == 0)
        m[i][6] = m[i][6] if i < 8 or i >= size - 8 else (i % 2 == 0)

    m[size - 8][8] = True                           # el módulo siempre negro

    if version >= 7:
        bits = _bch18(version)
        for i in range(18):
            bit = (bits >> i) & 1
            m[size - 11 + i % 3][i // 3] = bool(bit)
            m[i // 3][size - 11 + i % 3] = bool(bit)


def _place_data(m, taken, size, payload):
    """Coloca los bits en zigzag, de abajo a la derecha hacia arriba."""
    bits = []
    for byte in payload:
        for i in range(7, -1, -1):
            bits.append((byte >> i) & 1)

    index = 0
    col = size - 1
    upward = True
    while col > 0:
        if col == 6:                                # la columna de tiempo no cuenta
            col -= 1
        rows = range(size - 1, -1, -1) if upward else range(size)
        for row in rows:
            for c in (col, col - 1):
                if taken[row][c]:
                    continue
                m[row][c] = bool(bits[index]) if index < len(bits) else False
                index += 1
        upward = not upward
        col -= 2


def _mask_value(mask, row, col):
    if mask == 0: return (row + col) % 2 == 0
    if mask == 1: return row % 2 == 0
    if mask == 2: return col % 3 == 0
    if mask == 3: return (row + col) % 3 == 0
    if mask == 4: return (row // 2 + col // 3) % 2 == 0
    if mask == 5: return (row * col) % 2 + (row * col) % 3 == 0
    if mask == 6: return ((row * col) % 2 + (row * col) % 3) % 2 == 0
    return ((row + col) % 2 + (row * col) % 3) % 2 == 0


def _apply_format(m, size, level, mask):
    """Los 15 bits que dicen el nivel de corrección y la máscara usada.

    Van dos veces: una rodeando el ojo de arriba a la izquierda y otra
    repartida entre los otros dos, para que se pueda leer aunque una
    esquina esté rozada. Aquí `m` es m[fila][columna].
    """
    bits = _bch15((EC_BITS[level] << 3) | mask)

    for i in range(15):
        bit = bool((bits >> i) & 1)

        # primera copia: baja por la columna 8 y luego tuerce por la fila 8
        if i < 6:
            m[i][8] = bit
        elif i == 6:
            m[7][8] = bit
        elif i == 7:
            m[8][8] = bit
        elif i == 8:
            m[8][7] = bit
        else:
            m[8][14 - i] = bit

        # segunda copia: ocho módulos en la fila 8 por la derecha y siete
        # en la columna 8 por abajo (el que falta es el que va siempre negro)
        if i < 8:
            m[8][size - 1 - i] = bit
        else:
            m[size - 15 + i][8] = bit


def _penalty(m, size):
    """Lo fea que le queda la máscara al lector; gana la de menos puntos."""
    score = 0

    # 1. rachas del mismo color
    for line in list(m) + [[m[r][c] for r in range(size)] for c in range(size)]:
        run, prev = 1, line[0]
        for value in line[1:]:
            if value == prev:
                run += 1
            else:
                if run >= 5:
                    score += 3 + (run - 5)
                run, prev = 1, value
        if run >= 5:
            score += 3 + (run - 5)

    # 2. cuadrados de 2×2 del mismo color
    for r in range(size - 1):
        for c in range(size - 1):
            if m[r][c] == m[r][c + 1] == m[r + 1][c] == m[r + 1][c + 1]:
                score += 3

    # 3. dibujos que se confunden con un ojo
    patron = [True, False, True, True, True, False, True, False, False, False, False]
    revés = patron[::-1]
    for r in range(size):
        for c in range(size - 10):
            fila = [m[r][c + i] for i in range(11)]
            if fila == patron or fila == revés:
                score += 40
            columna = [m[c + i][r] for i in range(11)]
            if columna == patron or columna == revés:
                score += 40

    # 4. desequilibrio entre blanco y negro
    oscuros = sum(sum(1 for v in row if v) for row in m)
    porcentaje = oscuros * 100 // (size * size)
    score += 10 * min(abs(porcentaje - 50) // 5, 10)

    return score


def matrix(text, level='M'):
    """Devuelve la matriz de puntos (lista de listas de bool) del texto."""
    text = str(text or '')
    payload_len = len(text.encode('utf-8'))

    version = None
    for candidate in sorted(BLOCKS):
        cabecera = 4 + (8 if candidate < 10 else 16)
        if _data_capacity(candidate, level) * 8 >= cabecera + payload_len * 8:
            version = candidate
            break
    if version is None:
        raise ValueError('Ese texto es demasiado largo para un QR de este tamaño')

    size = 17 + 4 * version
    payload = _interleave(_bitstream(text, version, level), version, level)

    best, best_score = None, None
    for mask in range(8):
        m = [[False] * size for _ in range(size)]
        taken = _reserve(size, version)
        _draw_patterns(m, size, version)
        _place_data(m, taken, size, payload)

        for r in range(size):
            for c in range(size):
                if not taken[r][c] and _mask_value(mask, r, c):
                    m[r][c] = not m[r][c]

        _apply_format(m, size, level, mask)

        score = _penalty(m, size)
        if best_score is None or score < best_score:
            best, best_score = m, score

    return best


def svg(text, level='M', quiet=4, scale=4, dark='#000', light='#fff'):
    """El QR como SVG, listo para meter en la página."""
    m = matrix(text, level)
    size = len(m)
    total = (size + quiet * 2) * scale

    rects = []
    for r, row in enumerate(m):
        c = 0
        while c < size:
            if not row[c]:
                c += 1
                continue
            largo = 1                       # se juntan los puntos seguidos
            while c + largo < size and row[c + largo]:
                largo += 1
            rects.append('<rect x="%d" y="%d" width="%d" height="%d"/>'
                         % ((c + quiet) * scale, (r + quiet) * scale,
                            largo * scale, scale))
            c += largo

    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" '
            'viewBox="0 0 %d %d" shape-rendering="crispEdges">'
            '<rect width="%d" height="%d" fill="%s"/>'
            '<g fill="%s">%s</g></svg>'
            % (total, total, total, total, total, total, light, dark, ''.join(rects)))


def draw_pdf(pdf, text, x, y, box, level='M', quiet=2):
    """Pinta el QR en un PDF de pdfgen, dentro de un cuadrado de `box` puntos.

    (x, y) es la esquina de abajo a la izquierda. Devuelve el lado real,
    que se redondea para que cada punto caiga en un número entero y no
    salgan bordes borrosos.
    """
    m = matrix(text, level)
    size = len(m)
    unit = box / float(size + quiet * 2)
    lado = unit * (size + quiet * 2)

    pdf.rect(x, y, lado, lado, (1, 1, 1))
    for r, row in enumerate(m):
        c = 0
        while c < size:
            if not row[c]:
                c += 1
                continue
            largo = 1
            while c + largo < size and row[c + largo]:
                largo += 1
            pdf.rect(x + (c + quiet) * unit,
                     y + lado - (r + quiet + 1) * unit,
                     largo * unit + 0.06, unit + 0.06, (0, 0, 0))
            c += largo
    return lado
