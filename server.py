#!/usr/bin/env python3
"""
Servidor del Taller: sirve la web y guarda los datos en disco.

Sólo usa la librería estándar de Python 3 — no hay que instalar nada.

    python3 server.py                 # http://0.0.0.0:8477
    python3 server.py --port 9000
    TALLER_PORT=9000 python3 server.py

Los datos van a --data (por defecto /var/lib/taller si se puede escribir,
si no ~/.local/share/taller). Un fichero JSON por perfil.
"""

import argparse
import json
import os
import re
import shutil
import socket
import sys
import threading
import time
import unicodedata
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 8477          # 8083 lo deja libre a propósito (lo usan otros paneles)
FORBIDDEN_PORTS = {8083}
MAX_BODY = 8 * 1024 * 1024   # 8 MB de fichas es muchísimo; corta ahí

STATIC_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webmanifest': 'application/manifest+json',
    '.ico': 'image/x-icon',
}

_lock = threading.Lock()


# ───────────────────────── almacén en disco ─────────────────────────

class Storage:
    """Un fichero JSON por perfil, más un índice de perfiles."""

    def __init__(self, data_dir):
        self.dir = data_dir
        self.profiles_path = os.path.join(self.dir, 'profiles.json')
        os.makedirs(os.path.join(self.dir, 'profiles'), exist_ok=True)
        os.makedirs(os.path.join(self.dir, 'backups'), exist_ok=True)
        if not os.path.exists(self.profiles_path):
            self._write_json(self.profiles_path, [])

    # — utilidades —

    @staticmethod
    def _read_json(path, fallback):
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return fallback

    @staticmethod
    def _write_json(path, data):
        """Escritura atómica: primero a .tmp y luego rename, para no dejar
        un fichero a medias si se va la luz."""
        os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)

    def _ticket_path(self, profile_id):
        return os.path.join(self.dir, 'profiles', profile_id + '.json')

    # — perfiles —

    def profiles(self):
        data = self._read_json(self.profiles_path, [])
        return data if isinstance(data, list) else []

    def save_profiles(self, profiles):
        self._write_json(self.profiles_path, profiles)

    def create_profile(self, name):
        name = (name or '').strip() or 'Taller'
        profiles = self.profiles()
        profile = {
            'id': uuid.uuid4().hex[:12],
            'name': name[:60],
            'createdAt': time.strftime('%Y-%m-%d'),
        }
        profiles.append(profile)
        self.save_profiles(profiles)
        self._write_json(self._ticket_path(profile['id']), [])
        return profile

    def rename_profile(self, profile_id, name):
        profiles = self.profiles()
        for profile in profiles:
            if profile['id'] == profile_id:
                profile['name'] = (name or '').strip()[:60] or profile['name']
                self.save_profiles(profiles)
                return profile
        return None

    def delete_profile(self, profile_id):
        profiles = self.profiles()
        rest = [p for p in profiles if p['id'] != profile_id]
        if len(rest) == len(profiles):
            return False
        self.save_profiles(rest)
        path = self._ticket_path(profile_id)
        if os.path.exists(path):
            # no se borra del todo: se aparta por si acaso
            shutil.move(path, os.path.join(
                self.dir, 'backups',
                'borrado-%s-%s.json' % (profile_id, time.strftime('%Y%m%d-%H%M%S'))))
        return True

    # — fichas —

    def tickets(self, profile_id):
        data = self._read_json(self._ticket_path(profile_id), [])
        return data if isinstance(data, list) else []

    def save_tickets(self, profile_id, tickets):
        path = self._ticket_path(profile_id)
        if os.path.exists(path):
            self._rotate_backup(profile_id, path)
        self._write_json(path, tickets)

    def _rotate_backup(self, profile_id, path):
        """Deja una copia al día por perfil, y guarda las 14 últimas."""
        stamp = time.strftime('%Y%m%d')
        target = os.path.join(self.dir, 'backups', '%s-%s.json' % (profile_id, stamp))
        if not os.path.exists(target):
            try:
                shutil.copy2(path, target)
            except OSError:
                return
        copies = sorted(
            f for f in os.listdir(os.path.join(self.dir, 'backups'))
            if f.startswith(profile_id + '-')
        )
        for old in copies[:-14]:
            try:
                os.remove(os.path.join(self.dir, 'backups', old))
            except OSError:
                pass

    # — ajustes (tiendas, etc.) —

    def settings(self):
        return self._read_json(os.path.join(self.dir, 'settings.json'), {})

    def save_settings(self, settings):
        self._write_json(os.path.join(self.dir, 'settings.json'), settings)


# ───────────────────────── servidor HTTP ─────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = 'Taller'
    protocol_version = 'HTTP/1.1'
    storage = None

    # — respuestas —

    def _send(self, status, body=b'', content_type='application/json; charset=utf-8', extra=None):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _json(self, data, status=200):
        self._send(status, json.dumps(data, ensure_ascii=False))

    def _error(self, status, message):
        self._json({'error': message}, status)

    def _body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0:
            return None
        if length > MAX_BODY:
            raise ValueError('El envío es demasiado grande')
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

    # — enrutado —

    def do_GET(self):
        self._route('GET')

    def do_HEAD(self):
        self._route('GET')

    def do_POST(self):
        self._route('POST')

    def do_PUT(self):
        self._route('PUT')

    def do_PATCH(self):
        self._route('PATCH')

    def do_DELETE(self):
        self._route('DELETE')

    def _route(self, method):
        path = unquote(urlparse(self.path).path)
        try:
            if path.startswith('/api/'):
                with _lock:
                    self._api(method, path)
            elif method == 'GET':
                self._static(path)
            else:
                self._error(405, 'Método no permitido')
        except ValueError as err:
            self._error(400, str(err))
        except Exception as err:                       # noqa: BLE001
            sys.stderr.write('Error atendiendo %s %s: %r\n' % (method, path, err))
            self._error(500, 'Error interno del servidor')

    # — API —

    def _api(self, method, path):
        parts = [p for p in path.split('/') if p][1:]   # quita 'api'

        if parts == ['ping']:
            return self._json({'ok': True, 'app': 'taller', 'version': 2})

        if parts == ['profiles']:
            if method == 'GET':
                return self._json(self.storage.profiles())
            if method == 'POST':
                body = self._body() or {}
                return self._json(self.storage.create_profile(body.get('name')), 201)
            return self._error(405, 'Método no permitido')

        if len(parts) == 2 and parts[0] == 'profiles':
            profile_id = safe_id(parts[1])
            if method == 'PATCH':
                body = self._body() or {}
                profile = self.storage.rename_profile(profile_id, body.get('name'))
                return self._json(profile) if profile else self._error(404, 'No existe ese perfil')
            if method == 'DELETE':
                ok = self.storage.delete_profile(profile_id)
                return self._json({'ok': True}) if ok else self._error(404, 'No existe ese perfil')
            return self._error(405, 'Método no permitido')

        if len(parts) == 3 and parts[0] == 'profiles' and parts[2] == 'tickets':
            profile_id = safe_id(parts[1])
            if not any(p['id'] == profile_id for p in self.storage.profiles()):
                return self._error(404, 'No existe ese perfil')
            if method == 'GET':
                return self._json(self.storage.tickets(profile_id))
            if method == 'PUT':
                tickets = self._body()
                if not isinstance(tickets, list):
                    raise ValueError('Se esperaba una lista de fichas')
                self.storage.save_tickets(profile_id, tickets)
                return self._json({'ok': True, 'count': len(tickets)})
            return self._error(405, 'Método no permitido')

        if parts == ['settings']:
            if method == 'GET':
                return self._json(self.storage.settings())
            if method == 'PUT':
                settings = self._body()
                if not isinstance(settings, dict):
                    raise ValueError('Se esperaba un objeto de ajustes')
                self.storage.save_settings(settings)
                return self._json({'ok': True})
            return self._error(405, 'Método no permitido')

        return self._error(404, 'Ruta desconocida')

    # — ficheros de la web —

    def _static(self, path):
        rel = path.lstrip('/') or 'index.html'
        full = os.path.normpath(os.path.join(APP_DIR, rel))
        if not full.startswith(APP_DIR + os.sep) and full != APP_DIR:
            return self._error(403, 'Fuera de sitio')
        if os.path.isdir(full):
            full = os.path.join(full, 'index.html')
        if not os.path.isfile(full):
            return self._error(404, 'No encontrado')

        ext = os.path.splitext(full)[1].lower()
        with open(full, 'rb') as fh:
            body = fh.read()
        self._send(200, body, STATIC_TYPES.get(ext, 'application/octet-stream'))

    def log_message(self, fmt, *args):
        if os.environ.get('TALLER_VERBOSE'):
            sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


def safe_id(value):
    """Sólo dejamos ids nuestros: nada de ../ ni sorpresas en las rutas."""
    value = unicodedata.normalize('NFKD', value)
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value or ''):
        raise ValueError('Identificador de perfil no válido')
    return value


def pick_data_dir(explicit):
    if explicit:
        return os.path.abspath(os.path.expanduser(explicit))
    for candidate in ('/var/lib/taller', os.path.expanduser('~/.local/share/taller')):
        try:
            os.makedirs(candidate, exist_ok=True)
            probe = os.path.join(candidate, '.escritura')
            with open(probe, 'w') as fh:
                fh.write('ok')
            os.remove(probe)
            return candidate
        except OSError:
            continue
    return os.path.join(APP_DIR, 'datos')


def local_ip():
    """La IP de la LAN, para enseñar la dirección que hay que abrir en el móvil."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(('10.255.255.255', 1))
        return sock.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        sock.close()


def main():
    parser = argparse.ArgumentParser(description='Servidor del Taller')
    parser.add_argument('--port', type=int,
                        default=int(os.environ.get('TALLER_PORT') or DEFAULT_PORT))
    parser.add_argument('--host', default=os.environ.get('TALLER_HOST', '0.0.0.0'))
    parser.add_argument('--data', default=os.environ.get('TALLER_DATA'))
    args = parser.parse_args()

    if args.port in FORBIDDEN_PORTS:
        sys.exit('El puerto %d está reservado para otros paneles. Elige otro '
                 '(por defecto %d).' % (args.port, DEFAULT_PORT))

    data_dir = pick_data_dir(args.data)
    Handler.storage = Storage(data_dir)

    # el primer arranque crea un perfil para no empezar en blanco
    if not Handler.storage.profiles():
        Handler.storage.create_profile('Mi taller')

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as err:
        sys.exit('No se pudo abrir el puerto %d: %s\nPrueba con --port OTRO.'
                 % (args.port, err))

    httpd.daemon_threads = True
    print('Taller en marcha')
    print('  En este equipo : http://localhost:%d' % args.port)
    if args.host in ('0.0.0.0', '::'):
        print('  Desde el móvil : http://%s:%d' % (local_ip(), args.port))
    print('  Datos          : %s' % data_dir)
    print('Ctrl+C para parar.')

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nHasta luego.')
        httpd.shutdown()


if __name__ == '__main__':
    main()
