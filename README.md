# Radio Móvil PWA · un enlace para Android e iPhone

Esta carpeta es la forma de cumplir el requisito de **un enlace que se pueda enviar a cualquier persona**, tenga iPhone o Android, **sin pagar y sin Mac**.

> Guía visual para usuarios: [`../gui/Guia_Radio_Movil.pdf`](../gui/Guia_Radio_Movil.pdf) (6 páginas, con capturas y pasos).

## Qué es

Una app web instalable (PWA) con la **misma interfaz de la maqueta** (fondo oscuro, acento lima, pestañas Hablar/Mensajes/Mapa, PTT circular). Se abre desde un enlace HTTPS, se añade a la pantalla de inicio y funciona sin internet porque el service worker guarda todos los archivos.

La comunicación entre móviles es **directa, de móvil a móvil**, mediante WebRTC. El emparejamiento se hace con un **PIN de 6 dígitos**:

1. Un móvil pulsa **Invitar (6 números)** → aparece un código tipo `482913`.
2. El otro pulsa **Unirse con código**, lo escribe y conecta solo.
3. Ya pueden enviarse texto, posición y mantener pulsado el PTT para hablar.

El PIN usa **internet gratuito solo durante el emparejamiento**: un buzón MQTT público (`wss://broker.hivemq.com:8884/mqtt`) guarda la oferta y la respuesta bajo ese número durante unos segundos. Después la voz y los datos van **directos entre móviles**, sin pasar por ese buzón. No hay cuenta ni pago.

Si no hay internet, el menú ⋮ ofrece **Emparejar sin internet (enlace/QR)**: el SDP se comprime con prefijo `RMO2.` a ~400 caracteres para que el QR tenga 69 módulos en vez de 177.

No hay cuenta ni pago. El buzón MQTT público se usa **solo** para intercambiar el PIN; la conversación no pasa por él. Con el PIN hace falta internet (datos o Wi‑Fi) al emparejar; con el modo QR/enlace basta Wi‑Fi local o hotspot.

## Cómo publicar el enlace (gratis)

1. Sube **toda esta carpeta** a un repositorio público de GitHub.
2. En *Settings → Pages*, activa GitHub Pages desde la rama principal y carpeta `/root`.
3. GitHub te da una URL `https://TU-USUARIO.github.io/REPOSITORIO/`.
4. Envía esa URL. En Android se puede instalar desde el menú del navegador; en iPhone: *Compartir → Añadir a la pantalla de inicio*.

La URL es la misma para los dos sistemas. No hay que pasar por App Store ni TestFlight.

## Qué funciona ya

- Interfaz idéntica a la maqueta, con tema oscuro/lima.
- Emparejamiento por **PIN de 6 dígitos** (buzón MQTT público gratuito) y, sin internet, por enlace o QR.
- Texto en el canal e historial.
- Envío de posición, distancia y rumbo en el radar.
- Voz PTT: el micrófono se activa solo mientras se mantiene pulsado.
- Instalación en pantalla de inicio y funcionamiento offline tras la primera carga (el service worker guarda también las tres librerías de unpkg, así que no hacen falta después).
- Botón **📶 Crear hotspot** con instrucciones para Android/iPhone y aviso sobre el Wi‑Fi de invitados.
- Aviso inteligente de red: distingue datos móviles, Wi‑Fi local y pérdida de red.
- Intento de **reconexión automática** (ICE restart) si el Wi‑Fi parpadea con la app abierta.
- **PTT por turnos**: si el otro está hablando, el micrófono se activa solo cuando termina.
- **Voz por canal de datos**: el audio viaja como PCM 16 kHz dentro del data channel de WebRTC, en vez de depender del track de audio (evita fallos de SDP y de autoplay). Hay un botón **🔊 Activar sonido** que se pulsa una sola vez.

## Limitaciones honestas

- **Emparejamiento por QR**, no descubrimiento automático de malla como mesh-walkie. Para grupos de más de dos personas hace falta repetir el emparejamiento (está previsto el modo estrella con repetidor).
- WebRTC en Safari/iOS puede variar según la versión: **hay que probarlo en dos móviles reales**. En Android/Chrome funciona mejor.
- iOS limita la ejecución en segundo plano; con la app en primer plano funciona.
- La reconexión automática solo funciona si la app sigue abierta; si se cierra o se reinicia el móvil hay que repetir el emparejamiento.
- El audio usa el track de WebRTC; si dos personas hablan a la vez se solapan (no hay mezcla aún).
- Para cobertura kilométrica seguiría haciendo falta hardware externo; aquí el alcance es el del hotspot/Wi‑Fi local.

## Archivos

```
pwa/
├── index.html                 # interfaz (maqueta hecha app)
├── app.js                     # WebRTC, QR, chat, posición, PTT
├── sw.js                      # caché offline (incluye las librerías de unpkg)
├── manifest.webmanifest       # instalación como app
└── icon.svg                   # icono
```
