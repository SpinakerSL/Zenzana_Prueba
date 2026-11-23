# Zenzana · Inventario y Rentabilidad

App web instalable (PWA). Funciona sin internet. Los datos viven **cifrados** dentro del iPhone, protegidos por una clave que solo tú conoces.

## Seguridad: lo importante
- Este repositorio solo contiene el programa. **No contiene tus datos** (precios, costos, sueldo, clientas).
- **Nunca subas** a GitHub tu Excel ni el archivo `datos-zenzana.json`.
- Al abrir la app por primera vez eliges tu clave (mínimo 8 caracteres, mejor una frase larga). Todo se guarda cifrado con ella (AES-256).
- La app se bloquea sola si la dejas más de 2 minutos fuera. También puedes bloquearla en Ajustes.
- Si olvidas la clave no hay forma de recuperar los datos. Guarda un respaldo (Ajustes → Respaldo), que también va cifrado.
- El Excel que exporta la app NO va cifrado: guárdalo con cuidado.

## Publicar en GitHub Pages
1. Crea un repositorio nuevo.
2. Arrastra el **contenido** de esta carpeta (`index.html`, `app.js`, `app.css`, `sw.js`, `manifest.webmanifest` y las carpetas `fonts`, `icons`, `vendor`) a Add file → Upload files.
3. Settings → Pages → Deploy from a branch → `main` / `/ (root)`.

## Instalar en el iPhone
1. Abre la dirección en **Safari**.
2. Compartir → **Añadir a pantalla de inicio**.
3. Ábrela desde el ícono nuevo y crea tu clave.

## Cargar tus datos (una sola vez)
1. Pasa `datos-zenzana.json` a tu iPhone (AirDrop o app Archivos).
2. En la app: Sesión → **Cargar archivo de datos** y elige ese archivo.
3. Borra el archivo del teléfono y del computador cuando termines, o guárdalo en un lugar privado.

## Al actualizar la app
Sube la versión en `sw.js` (`const CACHE = 'zenzana-v5'`) para que los teléfonos descarguen la nueva.
