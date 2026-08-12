# Taller — control de reparaciones y ventas de móviles

Sustituto del Excel para llevar las reparaciones: qué piezas lleva cada móvil, cuánto te ha
costado en total, por cuánto lo tienes en Wallapop y cuánto ganas realmente con cada uno.

Con buscador de repuestos integrado, perfiles separados y un instalador de una línea.

## Instalar

En el servidor, NAS o el trasto donde tengas CasaOS:

```bash
curl -fsSL https://raw.githubusercontent.com/Marci9998/Test/claude/mobile-repair-ticket-app-rz2jfm/install.sh | sudo bash
```

Sale por pantalla la dirección para abrirlo (`http://<ip-del-equipo>:8477`). Arranca solo
al encender el equipo. **No usa el 8083**; si quieres otro puerto:

```bash
curl -fsSL <la misma url> | sudo TALLER_PORT=9000 bash
```

| Variable | Para qué | Por defecto |
|---|---|---|
| `TALLER_PORT` | Puerto | `8477` |
| `TALLER_DIR` | Dónde se instala el programa | `/opt/taller` |
| `TALLER_DATA` | Dónde se guardan tus fichas | `/var/lib/taller` |

### Actualizar

```bash
sudo taller-update
```

El instalador deja ese atajo puesto. Se trae la última versión, recuerda el puerto y las
carpetas que elegiste, y **no toca tus fichas**: los datos viven en `/var/lib/taller`, aparte
del programa. Si prefieres no usar el atajo, vale con volver a lanzar el comando de instalar:
hace exactamente lo mismo.

```bash
sudo systemctl status taller      # ¿va bien?
sudo journalctl -u taller -f      # ver qué hace
sudo taller-update --uninstall    # desinstalar
```

Desinstalar borra el programa pero **no** tus fichas (siguen en `/var/lib/taller`).

### Sin instalar nada

- **A pelo**: doble clic en `index.html`. Funciona todo menos compartir entre dispositivos:
  los datos se quedan en ese navegador.
- **A mano**: `python3 server.py --port 8477`. Sólo necesita Python 3, sin librerías.

## Tu cuenta

La primera vez que lo abres sale una pantalla de bienvenida para **crear tu cuenta**: un
usuario y una contraseña. A partir de ahí, quien entre en la dirección tiene que
identificarse; sin eso no se ve ni una ficha.

- La contraseña **no se guarda**: se guarda su huella (PBKDF2-SHA256, con sal y 210.000
  vueltas), en `users.json` con permisos sólo para el servicio.
- La sesión dura 30 días en ese dispositivo. Hay botón de salir en **Datos → Tu cuenta**.
- Tras diez intentos fallidos seguidos, ese dispositivo espera unos minutos.
- Desde **Datos → Tu cuenta** puedes darle acceso a otra persona (un ayudante). El dueño
  es quien crea y quita cuentas.
- ¿Se te olvidó la contraseña? Borra `/var/lib/taller/users.json` y al abrir volverá a
  salir la pantalla de «Hola» para crear cuenta otra vez. Las fichas no se tocan.

Las **cuentas** son para entrar; los **puestos** son los talleres (móviles, PCs…). Cada
cuenta entra sólo a los puestos que tenga marcados — mira más abajo.

> ⚠️ La conexión va por http, sin cifrar: dentro de tu red de casa o del taller está bien,
> pero no dejes esa dirección abierta a internet.

## En el móvil

La web ya se adapta al móvil, pero además se puede **añadir a la pantalla de inicio** y
queda con su icono, sin barra del navegador:

- **Android (Chrome)**: menú ⋮ → *Añadir a pantalla de inicio*.
- **iPhone (Safari)**: compartir → *Añadir a pantalla de inicio*.

Trae `manifest.webmanifest`, iconos propios y un *service worker* que guarda la interfaz,
para que abra rápido y no se quede en blanco si el servidor tarda. Si el servidor no
responde, en vez de enseñarte un taller vacío te avisa de que estás sin conexión (así no
apuntas nada que luego no aparecería en el ordenador).

Un detalle técnico: el navegador sólo activa el *service worker* en sitios seguros (https o
localhost). Por http en tu red se lo salta sin quejarse y la aplicación funciona igual, sólo
que sin el arranque instantáneo. Para eso está la aplicación de Android, que va por debajo.

## La aplicación de Android (APK)

En `apk/` está el proyecto: una aplicación que abre tu servidor a pantalla completa, con
su icono, guardando la sesión y con botón de atrás. La primera vez pide la dirección
(`http://192.168.x.x:8477`) y ya no la vuelve a pedir.

**El APK lo compila GitHub, no hace falta que instales nada**:

1. Entra en la pestaña **Actions** del repositorio.
2. Elige **Construir el APK** → **Run workflow**.
3. Cuando acabe (un par de minutos), en esa misma página, abajo del todo, hay un
   **Artifact** llamado `taller-apk`. Descárgalo y descomprime.
4. Pásalo al móvil e instálalo dando permiso a «orígenes desconocidos».

Va firmado con la clave de depuración: sirve para instalarlo en tus móviles, no para
publicarlo en Google Play.

Si al abrirla se queda **en blanco**: menú **⋮ → ¿Qué ha fallado?** enseña la dirección
guardada y el último error, y desde ahí se puede recargar o cambiar la dirección.

## Qué hace

### Ficha por móvil

Marca, modelo, almacenamiento, color, IMEI, avería y notas. Dos tipos:

- **Compra-venta**: compras el móvil, lo arreglas y lo vendes. Cuenta el precio de compra.
- **Cliente**: el móvil es de alguien; guardas su nombre y teléfono y lo que le cobras.

**Piezas** una a una, con cantidad y precio por unidad. Los nombres que ya has usado se
autocompletan la próxima vez.

**Los números salen solos** mientras escribes:

```
coste total = compra + piezas + otros gastos
beneficio   = precio de venta − coste total
margen      = beneficio ÷ precio de venta
```

Mientras no esté vendido usa el precio publicado en Wallapop, así ves el beneficio
*previsto*. Cuando cierres el trato pon el precio final y pasa el estado a **Vendido**:
a partir de ahí cuenta como beneficio real.

**Estados**: Pendiente · Reparando · Esperando piezas · Listo · Publicado · Vendido · Descartado.

**Panel** con lo que tienes en taller y cuánto dinero llevas metido, el beneficio que te
espera si vendes todo, lo vendido este mes y el beneficio mes a mes.

**Buscador** por modelo, cliente, IMEI, avería, notas o nombre de pieza (`Ctrl` + `K`).

### Buscador de repuestos

La lupa que hay al lado de cada pieza abre un panel en la esquina con la búsqueda ya
escrita (**modelo + pieza**, por ejemplo «Samsung A13 Pantalla») en Repuestos Fuente,
Mobile Sentrix, Wallapop o Google. El panel se arrastra por su barra de título y se
redimensiona por la esquina; con la ficha abierta se coloca a su izquierda para poder
copiar el precio sin tapar nada.

Bastantes tiendas —y Wallapop— mandan cabeceras (`X-Frame-Options` /
`Content-Security-Policy`) que impiden verse dentro de otra web: por eso el marco sale en
blanco o con un *refused to connect*. Cada tienda se puede abrir de tres maneras, y se
elige abajo del panel (o en **Datos → Tiendas**):

| Modo | Qué hace | Cuándo |
|---|---|---|
| **Por el servidor** | La página la pide `server.py` y te la sirve él. Como llega desde tu propia dirección, el navegador ya no la bloquea. | Lo normal para tiendas de repuestos. Es el modo de fábrica. |
| **Directa** | El marco carga la tienda tal cual, con tus cookies y tu sesión. | Cuando la tienda no bloquea el marco. |
| **Siempre fuera** | Ni se intenta: se abre en una ventana aparte. | Wallapop y cualquier cosa que necesite tu sesión. |

Detalles de «por el servidor», para que sepas qué esperar: sólo pasan por ahí los dominios
de las tiendas que tengas configuradas; los enlaces y las búsquedas de dentro siguen
navegando por el panel; y **no lleva tu sesión** (entra como si fueras un visitante
cualquiera), así que sirve para mirar piezas y precios, no para entrar en tu cuenta. Si una
tienda usa Cloudflare o similar, puede que te dé error igualmente: para eso está el botón
**«Abrir fuera ↗»**, que sigue estando siempre a mano.

Los botones **Mis ventas** y **Mensajes** van a tu Wallapop y se abren siempre fuera, por lo
mismo: necesitan tu sesión iniciada.

Las direcciones de las tiendas se editan en **Datos → Tiendas de repuestos**. El `{q}` es
lo que se busca. Si una tienda cambia su buscador o quieres añadir otra (AliExpress, tu
proveedor de siempre…), se cambia ahí sin tocar código.

### Diagnósticos y adjuntos

Dentro de cada ficha, en **Diagnóstico y adjuntos**, se pueden subir ficheros: el informe
del **M360** (o de cualquier otro diagnóstico), fotos del equipo antes de tocarlo, el
resguardo… Se guardan en el servidor junto a la ficha, en `/var/lib/taller/files/`.

- Admite PDF y fotos (`.pdf .png .jpg .jpeg .webp .heic`), hasta 25 MB cada uno.
- Si el nombre del fichero suena a informe (*m360*, *diagnóstico*, *report*, *test*…) se
  marca solo como **diagnóstico**; en la lista de fichas verás un 📄 para saber de un
  vistazo cuáles lo llevan.
- **Abrir** enseña el PDF en una pestaña (para reenviarlo por WhatsApp, por ejemplo).
- Cuando hagas el presupuesto desde esa ficha, el PDF lista abajo del todo, en
  **«Se entrega con este presupuesto»**, el informe y los demás adjuntos con su fecha
  (va anclado al pie, así aprovecha el hueco de los presupuestos cortos).
- Al borrar una ficha, sus adjuntos se borran con ella (no se quedan ocupando disco).
- Como todo lo demás, sin haber entrado con tu cuenta no se pueden ni ver ni descargar.

> Esto guarda el informe **junto** al presupuesto, no dentro del mismo PDF. Si lo que
> quieres es que las páginas del M360 salgan pegadas al final del presupuesto en un único
> fichero, se puede intentar, pero haría falta un informe de verdad para probarlo.

### Imprimir en papel térmico (el ticket fino de tienda)

Dentro de una ficha guardada hay un botón **Imprimir**. Sale un PDF con el **ancho exacto
del rollo** (80 o 58 mm) y el alto que haga falta, así que la impresora de recibos lo saca
como cualquier ticket de tienda. Se instala como una impresora normal; no hay que
configurar nada raro.

Tres papeles distintos, porque en el taller no son lo mismo:

| | Qué lleva | Para quién |
|---|---|---|
| **Resguardo de entrada** | Equipo, avería, lo que se le ha presupuestado | El cliente, al dejar el móvil |
| **Ticket de entrega** | Lo mismo, ya pagado | El cliente, al recogerlo |
| **Copia para el taller** | Costes de cada pieza, coste total y **beneficio** | Tú. Ésta no se la des al cliente |

En fichas de compra-venta los papeles se llaman **Ficha del equipo** (para pegar en la
bolsa mientras lo tienes) y **Ticket de venta** (para el comprador).

Los presupuestos también se imprimen así, con el botón **Ticket** que hay junto a **PDF**:
ese sí lleva el desglose completo con base, descuento, IVA y total.

> **En el diálogo de imprimir**: escala **100 %** y márgenes «ninguno». Si lo dejas en
> «ajustar a la página» sale encogido y descuadrado — es el fallo típico con estas
> impresoras.

Si todavía no has puesto el presupuesto, el ticket pone **«TOTAL pendiente»** en vez de un
número: nunca saca tus costes como si fueran el precio del cliente.

Un detalle pensado a propósito: en el papel del cliente salen las piezas **sin importes**,
sólo la lista de lo que se ha cambiado. Lo que hay apuntado en cada pieza de una ficha es
lo que te cuesta **a ti**, no lo que le cobras, y no tiene sentido enseñarle tu margen. Si
quieres darle el desglose con precios de venta, para eso está el presupuesto.

### Tarifas de proveedor (el precio se pone solo)

Carga la lista de precios de tu proveedor y, al apuntar una pieza, sale el nombre y el
precio sin escribir nada. Se configura en **Datos → Tarifas de proveedor**.

Dos maneras de cargarla:

| | Cómo | Para quién |
|---|---|---|
| **Subir la tarifa** | El CSV o el Excel (guardado como CSV) que te manda el proveedor | Cualquiera. Es lo normal |
| **Con clave (API)** | La tienda te da una dirección y una clave, y se actualiza al pulsar un botón | Sólo si tienes cuenta de profesional y te la dan |

> **Ojo con lo de la API**: ni Repuestos Fuente ni Mobile Sentrix reparten claves a
> cualquiera. Normalmente hay que tener cuenta de profesional y pedírsela a ellos. Lo que sí
> te dan casi todos es la tarifa en CSV o Excel, y con eso funciona igual de bien.

Da igual el formato (CSV con comas o con punto y coma, JSON, XML) ni cómo se llamen las
columnas: las empareja solo, y entiende los precios escritos como sea — `12,50 €`,
`1.234,56`, `$9.99`. También le da igual el acento: buscando *bateria* encuentra *Batería*.

Cuando la clave es de una API, se manda como te pida la tienda: `Authorization: Bearer`,
Basic (lo típico de PrestaShop), una cabecera suya, o metida en la dirección.

**Cómo se usa el día a día**: dentro de una ficha, en una pieza, dale a la 🔎. Se abre una
ventanita buscando ya tu modelo; eliges la pieza y el nombre y el precio se ponen solos.
Lo que no tenga stock sale al final, para que no elijas algo que no te pueden servir. Si
esa pieza no está en tu tarifa, el botón **Buscar en las tiendas ↗** te lleva al navegador
de siempre. En los presupuestos es igual, con **+ Pieza de la tarifa**.

Un par de cosas sobre las claves:

- Se guardan sólo en el servidor, en `catalog/sources.json` con permisos `600`, y **no se
  devuelven nunca al navegador**: por la API sólo salen los cuatro últimos caracteres.
- Las tarifas las toca sólo el dueño. Un ayudante puede buscar piezas, pero no ve ni cambia
  las claves.
- No se pueden pedir tarifas a direcciones de tu propia red, para que nadie use el servidor
  del taller como puerta trasera para husmear el router o las cámaras.

### Lotes de móviles comprados

Pestaña **Lotes**: cuando compras un paquete de móviles por un precio conjunto (400 € por
seis terminales, más 20 € del transporte), aquí se reparte ese dinero entre los móviles para
que cada ficha sepa lo que te costó de verdad y el beneficio salga bien.

Cómo va:

1. **Nuevo lote** → quién te lo vendió, la fecha, lo que pagaste por todo y los gastos
   aparte (transporte, comisiones…).
2. **Añadir móviles**: pones cuántos venían y se crean esas fichas de golpe, ya enlazadas
   al lote y con su parte del coste puesta.
3. El reparto sale **a partes iguales**, pero se cambia a mano en la propia lista — un
   iPhone del lote no «cuesta» lo mismo que un Alcatel. El botón **Repartir a partes
   iguales** vuelve a dejarlo plano cuando quieras.
4. Si lo repartido no cuadra con lo pagado, te lo avisa: *«sin repartir −75,00 €»*.

Cada parte se guarda como el **precio de compra** de su ficha, así que el panel, el margen y
los números de siempre siguen funcionando igual, sin nada especial. En la ficha lo verás
como *Compra (su parte del lote 2026-01)*.

La tarjeta del lote te dice en todo momento cuántos llevas vendidos, cuánto has recuperado y
el beneficio, y cambia de **Por recuperar** a **Recuperado** en cuanto lo vendido supera lo
que pagaste.

> Borrar un lote **no borra los móviles**: se quedan como fichas sueltas con su precio de
> compra, sólo pierden el enlace al lote.

### Presupuestos y PDF

Pestaña **Presupuestos**: papeles para dar al cliente, con su numeración por año
(`2026-001`, `2026-002`…), fecha de validez, líneas de lo que se le cobra, descuento e IVA.
El total se calcula solo mientras escribes.

Lo más cómodo es sacarlos de una ficha: al abrir un móvil hay un botón **Presupuesto** que
crea uno ya relleno — el equipo, la avería, el cliente y las piezas apuntadas, más una
línea de mano de obra para que le pongas precio.

El botón **PDF** genera un documento A4 con la cabecera de tu taller, los datos del cliente,
el equipo, la tabla del trabajo, los totales y un hueco para la firma. Lo monta el servidor
(`pdfgen.py` + `quotepdf.py`, escritos a mano, sin librerías), así que se descarga como un
PDF de verdad — nada de imprimir desde el navegador.

Rellena una vez **Datos → Datos del taller** (nombre, NIF, teléfono, dirección, condiciones)
y sale en todos los presupuestos. Los estados son Borrador · Enviado · Aceptado · Rechazado.

> El PDF necesita el servidor. Si abres la web como fichero suelto, el botón te lo dice.

### Varios puestos en un mismo servidor

Un servidor lleva todos tus puestos sin que se mezcle nada: **Móviles 1**, **Móviles 2**,
**PCs 1**, **PCs 2**… Cada puesto tiene sus fichas, sus presupuestos, sus adjuntos y sus
números por separado, y se cambia de puesto con el desplegable de arriba a la derecha
(aparecen agrupados por tipo: 📱 Móviles, 💻 PCs, 🧰 Otro).

Quién ve qué:

| | Dueño (admin) | Ayudante |
|---|---|---|
| Puestos que ve | todos | sólo los que le marques |
| Crear, renombrar y borrar puestos | sí | no |
| Dar y quitar accesos | sí | no |

Se administra en **Datos → Puestos** y **Datos → Tu cuenta → Dar acceso a alguien**: creas
la cuenta, eliges si es ayudante o dueño y marcas sus puestos. El botón **Acceso** de cada
cuenta permite cambiárselos después.

El candado no es sólo de pantalla: si alguien intenta pedir por la API las fichas de un
puesto que no es suyo, el servidor responde 403. Al borrar un puesto, sus fichas se guardan
por si acaso en `/var/lib/taller/backups/`.

## Traer tu Excel

1. En Excel: *Archivo → Guardar como → CSV*.
2. En la web: **Datos → Importar CSV**.
3. Sale una ventana con tus columnas ya emparejadas (las adivina por el nombre). Repasa que
   cada una esté donde toca y dale a **Importar**.

Entiende los CSV con `;` y con `,`, los decimales con coma (`18,50`) y las fechas
`dd/mm/aaaa`. Si tenías una columna de estado en plan «vendido» o «en reparación», la
traduce sola. También exporta a CSV (**Datos → Exportar a CSV**), que se abre en Excel con
acentos y decimales correctos.

## Copias de seguridad

Con servidor, el propio servidor guarda una copia al día de cada perfil en
`/var/lib/taller/backups/` (guarda las 14 últimas). Aun así, **Datos → Descargar copia
(.json)** te da un fichero con todo para llevártelo donde quieras; **Restaurar copia** lo
vuelve a meter.

Sin servidor, los datos viven sólo en ese navegador: si lo limpias, se van. Descarga copias.

## Atajos

| Atajo | Qué hace |
|---|---|
| `Ctrl` + `K` | Ir al buscador |
| `Ctrl` + `Enter` | Guardar la ficha abierta |
| `Esc` | Cerrar la ficha, la ventana o el panel de repuestos |

## Cómo está hecho

Sin dependencias, sin compilar nada, sin base de datos. Python 3 de serie y JavaScript a pelo:

```
install.sh     instalador (systemd + usuario propio + servicio + atajo de actualizar)
server.py      servidor, API y proxy de tiendas; guarda un JSON por perfil
pdfgen.py      escribe PDF (texto, líneas y recuadros) sin librerías
quotepdf.py    el diseño del presupuesto, separado de las tripas del PDF
index.html
manifest.webmanifest  para añadirla a la pantalla de inicio del móvil
sw.js                 arranque rápido y aviso de sin conexión
apk/                  proyecto de la aplicación de Android (lo compila GitHub)
assets/
  styles.css   estilos y tema claro/oscuro
  store.js     datos, cálculos, perfiles y guardado (servidor o navegador)
  csv.js       importar y exportar CSV / copias JSON
  shop.js      panel buscador de repuestos
  quotes.js    presupuestos: lista, editor y PDF
  ui.js        pintado del panel, la lista y la ficha
  app.js       arranque y eventos
```

La API, por si quieres trastear:

```
GET    /api/ping
GET    /api/profiles              POST /api/profiles           {name}
PATCH  /api/profiles/<id>         {name}
DELETE /api/profiles/<id>
GET    /api/profiles/<id>/tickets
PUT    /api/profiles/<id>/tickets [ …fichas… ]
GET    /api/settings              PUT /api/settings            {shops:[…], business:{…}}
GET    /api/profiles/<id>/quotes  PUT /api/profiles/<id>/quotes [ …presupuestos… ]
GET    /api/profiles/<id>/files             todos los adjuntos del perfil
GET    /api/profiles/<id>/tickets/<tid>/files
POST   /api/profiles/<id>/tickets/<tid>/files?name=…   (el fichero, en crudo)
GET    /api/profiles/<id>/files/<fid>       DELETE para quitarlo
GET    /api/profiles/<id>/quotes/<qid>/pdf
GET    /api/proxy?url=…          (sólo dominios de tus tiendas)

GET    /api/auth/status           ¿hay que crear cuenta o entrar?
POST   /api/auth/register         {name, login, password}
POST   /api/auth/login            {login, password}     → cookie de sesión
POST   /api/auth/logout
GET    /api/auth/users            DELETE /api/auth/users/<id>
```
