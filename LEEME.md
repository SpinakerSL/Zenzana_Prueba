# Zenzana · Inventario y Rentabilidad

App web instalable (PWA) para llevar el inventario de Zenzana Ritual Beauty Studio y calcular la rentabilidad. Funciona sin internet y guarda los datos en el propio iPhone.

## Publicar en GitHub Pages
1. Crea un repositorio nuevo en GitHub (por ejemplo `zenzana-inventario`).
2. Sube todos los archivos de esta carpeta a la raíz del repositorio (`index.html`, `app.js`, `app.css`, `sw.js`, `manifest.webmanifest` y las carpetas `fonts`, `icons`, `vendor`).
3. En el repositorio: Settings → Pages → Source: "Deploy from a branch" → Branch: `main` / carpeta `/ (root)` → Save.
4. En 1 o 2 minutos tendrás la dirección `https://TU-USUARIO.github.io/zenzana-inventario/`.

## Instalar en el iPhone
1. Abre esa dirección en **Safari**.
2. Toca el botón Compartir → **Añadir a pantalla de inicio**.
3. Ábrela desde el ícono nuevo. Desde ahí funciona como una app y sin conexión.

## Primer uso
La app ya viene cargada con tu planilla v5: 92 productos, 15 tratamientos con sus recetas, 12 paquetes y tus costos (sueldo, horas, gastos fijos).
1. Ajustes → revisa tu sueldo, horas y gastos fijos.
2. Tratamientos → confirma las cantidades marcadas con ≈ (estimadas).
3. Sesión → toca el tratamiento al terminar cada atención.
4. Resultados → mira ganancia, tu hora y margen.

Para actualizar precios o productos nuevos: Ajustes → Importar desde Excel (modo "Precios y nuevos" no toca tu stock).

## Respaldo
Los datos se guardan solo en el iPhone. Usa Ajustes → **Respaldo (JSON)** cada cierto tiempo y guárdalo en Archivos o iCloud. Si cambias de teléfono, restaura con el mismo botón.

## Al actualizar la app
Si cambias el código, sube la versión en `sw.js` (`const CACHE = 'zenzana-v3'`) para que los teléfonos descarguen la nueva.
