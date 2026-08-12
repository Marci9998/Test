# El all-in-one del mostrador

Para que el ordenador del taller se encienda y aparezca la web sola, sin tocar
nada. Y, si quieres, con un *«Ok Google, taller»*.

## La web sola al arrancar

1. Abre `taller-kiosco.bat` con el Bloc de notas y cambia la dirección de la
   primera línea por la de tu servidor:

   ```
   set URL=http://192.168.1.50:8477/
   ```

2. Pulsa **Windows + R**, escribe `shell:startup` y pega ahí un **acceso
   directo** al `.bat` (botón derecho sobre el fichero → *Mostrar más opciones*
   → *Enviar a* → *Escritorio*, y ese acceso directo lo mueves a la carpeta).

3. Para que no pida la contraseña al encender: **Windows + R** → `netplwiz` →
   desmarca *«Los usuarios deben escribir su nombre y contraseña»*.

Se abre a pantalla completa, sin barras ni pestañas. Para salir, **Alt + F4**.

> El `.bat` espera hasta dos minutos a que el servidor conteste antes de abrir
> el navegador. Si arrancan los dos a la vez, el all-in-one suele llegar antes
> que el servidor y si no se esperase saldría un «no se puede acceder».

Si el all-in-one lleva Linux en vez de Windows, usa `taller-kiosco.sh` y mételo
en *Aplicaciones al inicio*.

## «Ok Google, taller»

El Google Home **no puede** hablar directamente con tu PC ni con tu servidor:
Google no deja que una rutina llame a un aparato de tu red. Hace falta algo en
medio. Dos maneras:

### La fácil: un enchufe inteligente (unos 10 €)

Un enchufe compatible con Google Home (TP-Link Tapo P100 o parecido), con el
all-in-one enchufado ahí.

1. En la BIOS del HP (F10 al arrancar): **Restore on AC Power Loss → Power On**,
   normalmente en *Advanced → Power Options*. Así, en cuanto le llega corriente,
   arranca solo.
2. En la app de Google Home: **+ → Rutinas → Nueva**, la frase *«taller»* y como
   acción encender ese enchufe.
3. Con lo de arriba puesto, la web sale sola.

Para apagar, mejor hazlo desde el propio PC: cortarle la luz de golpe cada
noche no le sienta bien al disco.

### La fina: Wake-on-LAN

Enciende el ordenador por red, sin enchufes de por medio, y el apagado es
limpio. `despertar.py` manda el «paquete mágico»:

```bash
python3 despertar.py A4:BB:6D:11:22:33
```

Para que funcione, en el all-in-one hay que dejar preparado:

- **BIOS**: *Wake on LAN* activado.
- **Windows**: Administrador de dispositivos → tu tarjeta de red → *Opciones de
  energía* → marcar *«Permitir que este dispositivo reactive el equipo»*.
- **Quitar el arranque rápido** (Panel de control → Opciones de energía →
  *Elegir el comportamiento de los botones de inicio/apagado*). Con el arranque
  rápido puesto, al apagar la tarjeta de red se queda muerta y no oye nada.
- Sólo va **por cable**. Por wifi casi nunca funciona.

La MAC la sacas con `ipconfig /all` en el all-in-one (*Dirección física*).

Esto ya te sirve para encenderlo desde el móvil con cualquier app de
Wake-on-LAN gratis. Para decirlo por voz hace falta **Home Assistant** en el
servidor y conectarlo con Google: o pagando **Nabu Casa** (unos 6,50 €/mes, y
está listo en cinco minutos), o montándolo a mano con un proyecto de Google
Cloud, que es gratis pero pide dominio propio y HTTPS.
