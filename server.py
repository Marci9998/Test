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
import base64
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import socket
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qs, urljoin

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 8477          # 8083 lo deja libre a propósito (lo usan otros paneles)
COOKIE_NAME = 'taller_sesion'
SESSION_DAYS = 30
PBKDF2_ROUNDS = 210000
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
        os.makedirs(os.path.join(self.dir, 'quotes'), exist_ok=True)
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

    # — presupuestos —

    def _quote_path(self, profile_id):
        return os.path.join(self.dir, 'quotes', profile_id + '.json')

    def quotes(self, profile_id):
        data = self._read_json(self._quote_path(profile_id), [])
        return data if isinstance(data, list) else []

    def save_quotes(self, profile_id, quotes):
        path = self._quote_path(profile_id)
        if os.path.exists(path):
            stamp = time.strftime('%Y%m%d')
            target = os.path.join(self.dir, 'backups',
                                  'presupuestos-%s-%s.json' % (profile_id, stamp))
            if not os.path.exists(target):
                try:
                    shutil.copy2(path, target)
                except OSError:
                    pass
        self._write_json(path, quotes)

    def quote(self, profile_id, quote_id):
        for item in self.quotes(profile_id):
            if item.get('id') == quote_id:
                return item
        return None

    # — cuentas y sesiones —

    def users(self):
        data = self._read_json(os.path.join(self.dir, 'users.json'), [])
        return data if isinstance(data, list) else []

    def save_users(self, users):
        self._write_json(os.path.join(self.dir, 'users.json'), users)
        # las cuentas no las tiene que poder leer cualquiera del sistema
        try:
            os.chmod(os.path.join(self.dir, 'users.json'), 0o600)
        except OSError:
            pass

    def find_user(self, login):
        login = (login or '').strip().lower()
        for user in self.users():
            if user.get('login') == login:
                return user
        return None

    def create_user(self, name, login, password, role='dueño'):
        login = (login or '').strip().lower()
        if not re.fullmatch(r'[a-z0-9._-]{3,32}', login or ''):
            raise ValueError('El usuario admite de 3 a 32 letras, números, punto, guion o guion bajo.')
        if len(password or '') < 6:
            raise ValueError('La contraseña necesita al menos 6 caracteres.')
        if self.find_user(login):
            raise ValueError('Ya hay una cuenta con ese usuario.')

        users = self.users()
        user = {
            'id': uuid.uuid4().hex[:12],
            'name': (name or '').strip()[:60] or login,
            'login': login,
            'role': role,
            'createdAt': time.strftime('%Y-%m-%d'),
        }
        user.update(hash_password(password))
        users.append(user)
        self.save_users(users)
        return user

    def delete_user(self, user_id):
        users = self.users()
        rest = [u for u in users if u['id'] != user_id]
        if len(rest) == len(users):
            return False
        if not rest:
            raise ValueError('Tiene que quedar al menos una cuenta.')
        self.save_users(rest)
        # fuera las sesiones de quien ya no existe
        sessions = self.sessions()
        for token in [t for t, s in sessions.items() if s.get('user') == user_id]:
            sessions.pop(token, None)
        self.save_sessions(sessions)
        return True

    def sessions(self):
        data = self._read_json(os.path.join(self.dir, 'sessions.json'), {})
        if not isinstance(data, dict):
            return {}
        now = time.time()
        return {t: s for t, s in data.items() if s.get('exp', 0) > now}

    def save_sessions(self, sessions):
        self._write_json(os.path.join(self.dir, 'sessions.json'), sessions)
        try:
            os.chmod(os.path.join(self.dir, 'sessions.json'), 0o600)
        except OSError:
            pass

    def open_session(self, user_id):
        token = secrets.token_urlsafe(32)
        sessions = self.sessions()
        sessions[token] = {'user': user_id, 'exp': time.time() + SESSION_DAYS * 86400}
        self.save_sessions(sessions)
        return token

    def close_session(self, token):
        sessions = self.sessions()
        if sessions.pop(token, None) is not None:
            self.save_sessions(sessions)

    def user_of_session(self, token):
        if not token:
            return None
        session = self.sessions().get(token)
        if not session:
            return None
        for user in self.users():
            if user['id'] == session['user']:
                return user
        return None

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

    _extra_headers = None

    def _send(self, status, body=b'', content_type='application/json; charset=utf-8', extra=None):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        headers = dict(self._extra_headers or {})
        headers.update(extra or {})
        for key, value in headers.items():
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
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        self._extra_headers = {}
        try:
            # El proxy tarda lo que tarde la tienda: no puede bloquear al resto
            if path == '/api/proxy' and method == 'GET':
                if self.storage.users() and not self.current_user():
                    return self._error(401, 'Entra con tu cuenta.')
                self._proxy(parsed.query)
            elif path.startswith('/api/'):
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

    # — cuentas —

    def _cookie_token(self):
        raw = self.headers.get('Cookie')
        if not raw:
            return ''
        try:
            cookie = SimpleCookie()
            cookie.load(raw)
        except Exception:                              # noqa: BLE001
            return ''
        morsel = cookie.get(COOKIE_NAME)
        return morsel.value if morsel else ''

    def current_user(self):
        return self.storage.user_of_session(self._cookie_token())

    @staticmethod
    def public_user(user):
        return {'id': user['id'], 'name': user['name'],
                'login': user['login'], 'role': user.get('role', 'dueño')}

    def _set_session_cookie(self, token):
        self._extra_headers['Set-Cookie'] = (
            '%s=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d'
            % (COOKIE_NAME, token, SESSION_DAYS * 86400))

    def _auth(self, method, parts):
        storage = self.storage
        users = storage.users()

        if parts == ['auth', 'status'] and method == 'GET':
            user = self.current_user()
            return self._json({
                'needsSetup': not users,
                'user': self.public_user(user) if user else None,
            })

        if parts == ['auth', 'register'] and method == 'POST':
            body = self._body() or {}
            # el primero se crea solo; a partir de ahí, sólo el dueño invita
            if users:
                current = self.current_user()
                if not current or current.get('role') != 'dueño':
                    return self._error(403, 'Sólo el dueño puede crear más cuentas.')
                user = storage.create_user(body.get('name'), body.get('login'),
                                           body.get('password'), body.get('role') or 'ayudante')
                return self._json(self.public_user(user), 201)

            user = storage.create_user(body.get('name'), body.get('login'),
                                       body.get('password'), 'dueño')
            self._set_session_cookie(storage.open_session(user['id']))
            return self._json(self.public_user(user), 201)

        if parts == ['auth', 'login'] and method == 'POST':
            if too_many_tries(self.client_address[0]):
                return self._error(429, 'Demasiados intentos. Espera un par de minutos.')
            body = self._body() or {}
            user = storage.find_user(body.get('login'))
            if not user or not check_password(body.get('password'), user):
                note_failed_try(self.client_address[0])
                return self._error(401, 'Usuario o contraseña que no cuadran.')
            clear_tries(self.client_address[0])
            self._set_session_cookie(storage.open_session(user['id']))
            return self._json(self.public_user(user))

        if parts == ['auth', 'logout'] and method == 'POST':
            storage.close_session(self._cookie_token())
            self._extra_headers['Set-Cookie'] = (
                '%s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' % COOKIE_NAME)
            return self._json({'ok': True})

        if parts == ['auth', 'users']:
            current = self.current_user()
            if not current:
                return self._error(401, 'Entra con tu cuenta.')
            if method == 'GET':
                return self._json([self.public_user(u) for u in users])
            return self._error(405, 'Método no permitido')

        if len(parts) == 3 and parts[:2] == ['auth', 'users'] and method == 'DELETE':
            current = self.current_user()
            if not current or current.get('role') != 'dueño':
                return self._error(403, 'Sólo el dueño puede borrar cuentas.')
            if parts[2] == current['id']:
                return self._error(400, 'No puedes borrar tu propia cuenta.')
            ok = storage.delete_user(safe_id(parts[2]))
            return self._json({'ok': True}) if ok else self._error(404, 'No existe esa cuenta.')

        return None

    def _api(self, method, path):
        parts = [p for p in path.split('/') if p][1:]   # quita 'api'

        if parts == ['ping']:
            return self._json({'ok': True, 'app': 'taller', 'version': 3})

        if parts and parts[0] == 'auth':
            handled = self._auth(method, parts)
            if handled is None:
                return self._error(404, 'Ruta desconocida')
            return handled

        # Del resto no se ve nada sin haber entrado
        if self.storage.users() and not self.current_user():
            return self._error(401, 'Entra con tu cuenta.')

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

        if len(parts) == 3 and parts[0] == 'profiles' and parts[2] == 'quotes':
            profile_id = safe_id(parts[1])
            if not any(p['id'] == profile_id for p in self.storage.profiles()):
                return self._error(404, 'No existe ese perfil')
            if method == 'GET':
                return self._json(self.storage.quotes(profile_id))
            if method == 'PUT':
                quotes = self._body()
                if not isinstance(quotes, list):
                    raise ValueError('Se esperaba una lista de presupuestos')
                self.storage.save_quotes(profile_id, quotes)
                return self._json({'ok': True, 'count': len(quotes)})
            return self._error(405, 'Método no permitido')

        if len(parts) == 5 and parts[0] == 'profiles' and parts[2] == 'quotes' \
                and parts[4] == 'pdf' and method == 'GET':
            profile_id = safe_id(parts[1])
            quote = self.storage.quote(profile_id, safe_id(parts[3]))
            if not quote:
                return self._error(404, 'No existe ese presupuesto')

            profile_name = ''
            for p in self.storage.profiles():
                if p['id'] == profile_id:
                    profile_name = p.get('name', '')

            try:
                import quotepdf
                data = quotepdf.build(quote, (self.storage.settings() or {}).get('business'),
                                      profile_name)
            except Exception as err:                   # noqa: BLE001
                sys.stderr.write('Error montando el PDF: %r\n' % (err,))
                return self._error(500, 'No se pudo montar el PDF')

            name = 'presupuesto-%s.pdf' % (quote.get('number') or quote.get('id'))
            return self._send(200, data, 'application/pdf',
                              {'Content-Disposition': 'attachment; filename="%s"' % name})

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

    # — proxy de tiendas —

    def _proxy(self, query):
        """Trae una página de una tienda y la sirve desde aquí.

        Casi todas las tiendas mandan cabeceras (X-Frame-Options,
        Content-Security-Policy) que impiden verse dentro de otra web. Al pasar
        por aquí la página llega desde nuestra propia dirección y el navegador
        ya no la bloquea. Sólo se permiten las tiendas configuradas.
        """
        params = parse_qs(query or '')
        url = (params.get('url') or [''])[0]

        try:
            target = check_target(url, self.storage.settings())
        except ValueError as err:
            return self._proxy_error(str(err))

        request = urllib.request.Request(target, headers={
            'User-Agent': BROWSER_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,'
                      'image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9',
            'Accept-Encoding': 'gzip, identity',
        })

        try:
            with urllib.request.urlopen(request, timeout=PROXY_TIMEOUT) as response:
                final_url = response.geturl()
                # tras una redirección el destino también tiene que estar permitido
                check_target(final_url, self.storage.settings())
                raw = response.read(PROXY_MAX_BYTES + 1)
                content_type = response.headers.get('Content-Type', 'application/octet-stream')
                if response.headers.get('Content-Encoding') == 'gzip':
                    try:
                        raw = gzip.decompress(raw)
                    except OSError:
                        pass
        except urllib.error.HTTPError as err:
            return self._proxy_error('La tienda respondió con un error %s.' % err.code)
        except ValueError as err:
            return self._proxy_error(str(err))
        except Exception as err:                       # noqa: BLE001
            return self._proxy_error('No se pudo conectar con la tienda (%s).'
                                     % type(err).__name__)

        if len(raw) > PROXY_MAX_BYTES:
            return self._proxy_error('La página pesa demasiado para verla aquí dentro.')

        if 'html' not in content_type.lower():
            return self._send(200, raw, content_type)

        charset = 'utf-8'
        if 'charset=' in content_type.lower():
            charset = content_type.lower().split('charset=')[1].split(';')[0].strip() or 'utf-8'
        try:
            html = raw.decode(charset, errors='replace')
        except LookupError:
            html = raw.decode('utf-8', errors='replace')

        proxy_base = 'http://%s/api/proxy?url=' % (self.headers.get('Host') or 'localhost')
        self._send(200, prepare_html(html, final_url, proxy_base), 'text/html; charset=utf-8')

    def _proxy_error(self, message):
        page = ('<!doctype html><meta charset="utf-8">'
                '<div style="font:15px/1.5 system-ui;color:#555;padding:28px;text-align:center">'
                '<p><b>No se ha podido traer la página.</b></p><p>%s</p>'
                '<p style="color:#888;font-size:13px">Prueba con el botón '
                '<b>Abrir fuera ↗</b> de aquí abajo.</p></div>'
                % html_escape(message))
        self._send(200, page, 'text/html; charset=utf-8')

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


# ───────────────────────── contraseñas ─────────────────────────

def hash_password(password):
    """La contraseña nunca se guarda: sólo su huella, con sal y muchas vueltas."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', (password or '').encode('utf-8'), salt, PBKDF2_ROUNDS)
    return {
        'salt': base64.b64encode(salt).decode(),
        'hash': base64.b64encode(digest).decode(),
        'rounds': PBKDF2_ROUNDS,
    }


def check_password(password, user):
    try:
        salt = base64.b64decode(user.get('salt', ''))
        expected = base64.b64decode(user.get('hash', ''))
        rounds = int(user.get('rounds') or PBKDF2_ROUNDS)
    except Exception:                                  # noqa: BLE001
        return False
    digest = hashlib.pbkdf2_hmac('sha256', (password or '').encode('utf-8'), salt, rounds)
    return hmac.compare_digest(digest, expected)       # comparación sin pistas por tiempo


# Freno sencillo a quien prueba contraseñas a lo loco
_tries = {}
MAX_TRIES = 10
TRIES_WINDOW = 300


def too_many_tries(ip):
    fails = [t for t in _tries.get(ip, []) if time.time() - t < TRIES_WINDOW]
    _tries[ip] = fails
    return len(fails) >= MAX_TRIES


def note_failed_try(ip):
    _tries.setdefault(ip, []).append(time.time())


def clear_tries(ip):
    _tries.pop(ip, None)


# ───────────────────────── ayudas del proxy ─────────────────────────

BROWSER_UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
              'Chrome/124.0 Safari/537.36')
PROXY_TIMEOUT = 20
PROXY_MAX_BYTES = 6 * 1024 * 1024

# Dominios permitidos aunque el usuario no haya guardado sus tiendas todavía.
# Tienen que coincidir con DEFAULT_SHOPS de assets/store.js.
DEFAULT_HOSTS = (
    'repuestosfuente.com',
    'mobilesentrix.eu',
    'mobilesentrix.com',
    'wallapop.com',
    'google.com',
)

PRIVATE_HOST = re.compile(
    r'^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::1|\[|'
    r'172\.(1[6-9]|2\d|3[01])\.)', re.I)


def html_escape(text):
    return (str(text).replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def allowed_hosts(settings):
    """Dominios que se pueden pedir: los de las tiendas configuradas.

    Devuelve (dominios, exactos): los primeros aceptan subdominios; los
    segundos son los hosts tal cual los escribió el usuario.
    """
    domains = set(DEFAULT_HOSTS)
    exact = set()
    for shop in (settings or {}).get('shops') or []:
        host = urlparse(str(shop.get('url') or '')).hostname or ''
        if not host:
            continue
        exact.add(host)
        # nos quedamos con el dominio de segundo nivel para aceptar subdominios
        parts = [p for p in host.split('.') if p]
        if len(parts) >= 2:
            domains.add('.'.join(parts[-2:]))
    return domains, exact


def check_target(url, settings):
    """Comprueba que la dirección se puede pedir. Devuelve la url o revienta."""
    url = (url or '').strip()
    if not url:
        raise ValueError('Falta la dirección.')
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Sólo se pueden abrir direcciones http o https.')
    host = parsed.hostname or ''
    if not host:
        raise ValueError('Esa dirección no se puede abrir desde aquí.')

    domains, exact = allowed_hosts(settings)

    # Una dirección de la red de casa sólo vale si es exactamente una tienda
    # que se ha configurado a mano; así el proxy no sirve para husmear la red.
    if PRIVATE_HOST.match(host):
        if host in exact:
            return url
        raise ValueError('Esa dirección no se puede abrir desde aquí.')

    if host in exact:
        return url
    for allowed in domains:
        if host == allowed or host.endswith('.' + allowed):
            return url
    raise ValueError('«%s» no está en tus tiendas. Añádela en Datos → Tiendas '
                     'de repuestos y vuelve a probar.' % host)


# Le quitamos a la página sus propias reglas de bloqueo por marco
META_BLOCK = re.compile(
    r'<meta[^>]+http-equiv\s*=\s*["\']?(content-security-policy|x-frame-options)'
    r'["\']?[^>]*>', re.I)
HEAD_OPEN = re.compile(r'<head[^>]*>', re.I)


def prepare_html(html, base_url, proxy_base):
    """Prepara la página de la tienda para verse dentro del panel.

    · <base> para que sus imágenes, estilos y scripts sigan saliendo de la
      tienda (eso el navegador no lo bloquea, sólo bloquea el marco).
    · un script que hace que los enlaces y las búsquedas de dentro sigan
      pasando por aquí, para poder navegar por la tienda.
    """
    html = META_BLOCK.sub('', html)

    inject_head = '<base href="%s">' % html_escape(base_url)
    match = HEAD_OPEN.search(html)
    if match:
        html = html[:match.end()] + inject_head + html[match.end():]
    else:
        html = inject_head + html

    script = """
<script>(function () {
  var P = %s;
  function via(u) { return P + encodeURIComponent(u); }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self')) return;
    var href = a.href || '';
    if (!/^https?:/i.test(href)) return;
    e.preventDefault();
    location.href = via(href);
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || (f.method && f.method.toLowerCase() === 'post')) return;
    var action = f.action || '';
    if (!/^https?:/i.test(action)) return;
    e.preventDefault();
    var data = new URLSearchParams(new FormData(f)).toString();
    location.href = via(action + (action.indexOf('?') > -1 ? '&' : '?') + data);
  }, true);
})();</script>
""" % json.dumps(proxy_base)

    if re.search(r'</body>', html, re.I):
        html = re.sub(r'</body>', script + '</body>', html, count=1, flags=re.I)
    else:
        html += script
    return html


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
