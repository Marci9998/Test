# Taller — control de reparaciones y ventas de móviles

Sustituto del Excel para llevar las reparaciones: qué piezas lleva cada móvil, cuánto te ha
costado en total, por cuánto lo tienes en Wallapop y cuánto ganas realmente con cada uno.

No hay que instalar nada: es una web normal que funciona abriendo el fichero `index.html`.
Los datos se guardan en el propio navegador.

## Cómo usarlo

1. Abre `index.html` (doble clic, o arrástralo al navegador).
2. Pestaña **Datos → Cargar ejemplos** si quieres ver cómo queda antes de meter lo tuyo.
3. **+ Nueva ficha** para dar de alta un móvil.

Para tenerlo en el móvil del taller sin cables: sube el repo a GitHub Pages
(*Settings → Pages → Deploy from a branch*) y añade la web a la pantalla de inicio.

## Qué hace

**Ficha por móvil** — marca, modelo, almacenamiento, color, IMEI, avería y notas.
Dos tipos:

- **Compra-venta**: compras el móvil, lo arreglas y lo vendes. Cuenta el precio de compra.
- **Cliente**: el móvil es de alguien; guardas su nombre y teléfono y lo que le cobras.

**Piezas** — cada pieza con su cantidad y su precio por unidad. Los nombres que ya has usado
se autocompletan la próxima vez.

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
Filtra por cualquiera desde las pestañas de arriba de la lista.

**Panel** — lo que tienes en taller y cuánto dinero llevas metido, el beneficio que te espera
si vendes todo, lo vendido este mes y el beneficio por mes de los últimos seis.

**Buscador** — modelo, cliente, IMEI, avería, notas o nombre de pieza (`Ctrl` + `K`).

## Traer tu Excel

1. En Excel: *Archivo → Guardar como → CSV*.
2. En la web: **Datos → Importar CSV**.
3. Sale una ventana con tus columnas ya emparejadas (intenta adivinarlas por el nombre).
   Repasa que cada una esté donde toca y dale a **Importar**.

Entiende los CSV con `;` y con `,`, y los decimales con coma (`18,50`).
Si tenías una columna de estado en plan «vendido», «en reparación», «esperando pieza»…
la traduce sola.

También se puede exportar a CSV en cualquier momento (**Datos → Exportar a CSV**), que se abre
en Excel con acentos y decimales correctos.

## Copias de seguridad

Los datos viven en el navegador de ese dispositivo: si borras los datos del navegador o
cambias de ordenador, se van. Descarga una copia de vez en cuando desde
**Datos → Descargar copia (.json)** y guárdala donde quieras. Para recuperarla,
**Restaurar copia**.

## Atajos

| Atajo | Qué hace |
|---|---|
| `Ctrl` + `K` | Ir al buscador |
| `Ctrl` + `Enter` | Guardar la ficha abierta |
| `Esc` | Cerrar la ficha |

## Cómo está hecho

HTML, CSS y JavaScript a pelo, sin dependencias ni compilación:

```
index.html
assets/
  styles.css   estilos y tema claro/oscuro
  store.js     datos, cálculos y guardado en localStorage
  csv.js       importar y exportar CSV / copias JSON
  ui.js        pintado del panel, la lista y la ficha
  app.js       arranque y eventos
```
