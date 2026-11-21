# Radio Móvil PWA · un enlace para Android e iPhone

Esta carpeta es la forma de cumplir el requisito de **un enlace que se pueda enviar a cualquier persona**, tenga iPhone o Android, **sin pagar y sin Mac**.

## Qué es

Una app web instalable (PWA) con la **misma interfaz de la maqueta** (fondo oscuro, acento lima, pestañas Hablar/Mensajes/Mapa, PTT circular). Se abre desde un enlace HTTPS, se añade a la pantalla de inicio y funciona sin internet porque el service worker guarda todos los archivos.

La comunicación entre móviles es **directa, de móvil a móvil**, mediante WebRTC con señalización por código QR:

1. Un móvil pulsa **Crear grupo** → muestra un QR con su oferta.
2. El otro pulsa **Unirse** → escanea el QR → muestra su QR de respuesta.
3. El primero escanea la respuesta → conexión establecida.
4. Ya pueden enviarse texto, posición y mantener pulsado el PTT para hablar.

No hay cuenta, ni servidor de señalización, ni tráfico por internet. Los dos móviles deben estar en la misma Wi‑Fi o hotspot (por ejemplo, el hotspot de uno de ellos, aunque no tenga datos).

## Cómo instalarlo

Abre el enlace publicado en el móvil:

- **Android:** menú del navegador → **Instalar aplicación** / **Añadir a pantalla de inicio**.
- **iPhone:** botón **Compartir** → **Añadir a la pantalla de inicio**.

Después de la primera carga funciona **sin internet**.

> **Guía visual paso a paso con imágenes:** [descarga el PDF](Guia_Radio_Movil.pdf).

## Cómo usarlo

Los dos móviles deben estar en la misma Wi‑Fi o en el hotspot de uno de ellos.

1. Uno pulsa **Crear grupo** y muestra el código QR.
2. El otro pulsa **Unirse**, escanea y muestra su código de respuesta.
3. El primero escanea esa respuesta. Ya están conectados.
4. Escribe en **Mensajes**, comparte tu posición o mantén pulsado **PTT** para hablar.

## Qué incluye

- Interfaz oscura con acento lima: Hablar / Mensajes / Mapa.
- Texto, posición con distancia y rumbo, radar y voz PTT.
- Sin cuenta, sin servidor y sin tráfico por internet.

## Limitaciones honestas

- **Emparejamiento por QR**, no descubrimiento automático de malla como mesh-walkie. Para grupos de más de dos personas hace falta repetir el emparejamiento.
- WebRTC en Safari/iOS puede variar según la versión: **hay que probarlo en dos móviles reales**. En Android/Chrome funciona mejor.
- iOS limita la ejecución en segundo plano; con la app en primer plano funciona.
- El audio usa el track de WebRTC; si dos personas hablan a la vez se solapan (no hay mezcla aún).
- Para cobertura kilométrica seguiría haciendo falta hardware externo; aquí el alcance es el del hotspot/Wi‑Fi local.
