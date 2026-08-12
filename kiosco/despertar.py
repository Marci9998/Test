#!/usr/bin/env python3
"""Enciende un ordenador de la red mandándole el «paquete mágico» (Wake-on-LAN).

Para el camino de Home Assistant, o para encender el all-in-one desde el
servidor sin levantarte:

    python3 despertar.py A4:BB:6D:11:22:33

Antes hay que dejarlo preparado en el ordenador que quieres encender:
  · BIOS: «Wake on LAN» / «Power on by PCI-E» activado.
  · Windows: Administrador de dispositivos → tu tarjeta de red →
    Opciones de energía → «Permitir que este dispositivo reactive el equipo».
  · Y quitar el arranque rápido de Windows (Panel de control → Opciones de
    energía → Elegir el comportamiento de los botones), que si no, al apagar
    la tarjeta de red se queda muerta y no oye nada.
  · Sólo funciona por cable. Por wifi casi nunca va.

Sin dependencias: sólo la biblioteca estándar de Python 3.
"""

import argparse
import re
import socket
import sys


def magic_packet(mac):
    """Seis bytes a 0xFF y luego la MAC repetida dieciséis veces."""
    limpia = re.sub(r'[^0-9a-fA-F]', '', mac)
    if len(limpia) != 12:
        raise ValueError('La MAC «%s» no tiene buena pinta. '
                         'Se espera algo como A4:BB:6D:11:22:33' % mac)
    return b'\xff' * 6 + bytes.fromhex(limpia) * 16


def despertar(mac, broadcast='255.255.255.255', port=9):
    paquete = magic_packet(mac)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        # se manda un par de veces: es UDP, no hay acuse de recibo
        for _ in range(3):
            sock.sendto(paquete, (broadcast, port))
    finally:
        sock.close()


def main():
    parser = argparse.ArgumentParser(description='Enciende un ordenador por red.')
    parser.add_argument('mac', help='MAC del ordenador, p. ej. A4:BB:6D:11:22:33')
    parser.add_argument('--broadcast', default='255.255.255.255',
                        help='Dirección de difusión de tu red (p. ej. 192.168.1.255). '
                             'Si con la de por defecto no va, prueba con esta.')
    parser.add_argument('--puerto', type=int, default=9, help='Por defecto, el 9.')
    args = parser.parse_args()

    try:
        despertar(args.mac, args.broadcast, args.puerto)
    except (ValueError, OSError) as err:
        print('No se ha podido mandar: %s' % err, file=sys.stderr)
        return 1

    print('Paquete mandado a %s. Tarda unos segundos en arrancar.' % args.mac)
    return 0


if __name__ == '__main__':
    sys.exit(main())
