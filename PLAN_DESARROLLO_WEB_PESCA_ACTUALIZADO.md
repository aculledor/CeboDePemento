# Plan de desarrollo — Web de pesca (versión online mobile first)

Actualizado: 12 de octubre de 2026. Basado en `REQUISITOS_WEB_PESCA_ACTUALIZADOS.md`, `LEEME.md` y la base `catalogo.sqlite` suministrada.

## Estado del proyecto
- `catalogo.sqlite`: 932 entradas de referencia, 62 en selección inicial, 870 pendientes de revisar; sin fotos importadas. No son 932 especies gallegas verificadas.
- Tablas existentes: `sources`, `taxa`, `names`, `evidence`, `scoring_templates`, `template_members`, `metadata` y vistas `initial_catalog`/`pending_catalog`.
- Las plantillas iniciales corresponden a Morralla (1/1), Comunes (1/2) y Especiales (2/4).
- No hay frontend, backend, usuarios, sesiones, ligas o datos de captura.
- El PDF de campo da contenido editorial y zonas, no un catálogo legal de pesca.

## Tecnología
- Monorepositorio: frontend React/TypeScript/Vite + API Fastify/TypeScript + SQLite/Drizzle.
- React Router, TanStack Query, React Hook Form, Zod, i18next, Leaflet y OpenStreetMap.
- Fotografías locales en carpeta de servidor, optimizadas a WebP; metadatos y relaciones en SQLite.
- Desarrollo Windows 11 mediante Node LTS y Git; despliegue posterior Linux con Docker Compose + Caddy/HTTPS.
- Sin cola offline, ni IndexedDB para captura, ni service worker de sincronización.

## Fases y entregables

### Fase 0 — Arranque
1. Crear repositorio, configurar Node LTS, Git, TypeScript y scripts de arranque para Windows.
2. Copiar la base original de forma segura y establecer migraciones reproducibles.
3. Prueba de API + React en un único entorno local.
**Entregable:** interfaz y API arrancan en Windows y leen el catálogo.

### Fase 1 — Modelo de datos y seguridad
1. Conservar IDs históricos de especies; crear usuarios, invitaciones y sesiones autenticadas.
2. Crear tablas de sesiones pesqueras, lotes, fotos, zonas, ligas, reglas versionadas, miembros y aprobaciones.
3. Añadir roles `admin`/`member`, permisos en API, logs, identificadores idempotentes y copia de seguridad.
**Entregable:** API con endpoints y pruebas de validación/autorización.

### Fase 2 — Interfaz mobile first y catálogo editable
1. Diseño móvil de navegación inferior e idioma gallego/castellano desde el inicio.
2. Buscador por nombres gl/es/científico con y sin acentos; fichas de especie.
3. Administración CRUD de especies, alias, taxonomía, imagen principal, galería, tallas, descripción y revisión.
4. Crear fichas para taxones no identificados sin forzar identificaciones falsas.
**Entregable:** catálogo navegable y editable, funcionando online.

### Fase 3 — Importación de fotografías
1. Desarrollar importador de candidatos usando nombre científico: Wikimedia Commons, iNaturalist; Openverse/GBIF como respaldo.
2. Obtener URL, autor, licencia, enlace original, procedencia, miniatura y estado de aprobación.
3. Mostrar 3–5 candidatas por entrada, con rechazo/aprobación por un administrador.
4. Descargar solo tras aprobar y comprobar permiso: WebP + thumbnail, guardados en almacenamiento local.
5. Ejecutar primero en las 62 seleccionadas; ampliar después al catálogo revisado. Fallback sin foto.
**Entregable:** catálogo inicial con fotografías aceptadas y lista de faltantes.

### Fase 4 — Sesiones y capturas (prioridad de uso)
1. Iniciar/terminar sesión online; lugar y privacidad; inicio/fin incluso cruzando medianoche.
2. Alta por lote: especie, cantidad, cantidad que cumple talla, retenidas, peso total, longitud mayor, peso ejemplar más pesado, fotos opcionales.
3. Histórico, edición retrospectiva y propuestas de sesión a otro usuario con aprobación.
4. Bloqueo visible cuando la API no contesta; confirmar guardados antes de cambiar la interfaz; UUID para idempotencia.
**Entregable:** diarios y capturas utilizables desde móvil y sin duplicados.

### Fase 5 — Ligas y motor de puntuación
1. Ligas abiertas/privadas, periodos, ámbitos de peces/cefalópodos/crustáceos y especies, invitaciones.
2. Liga simple 1 punto por ejemplar; personalizada con grupos de puntos y valores distintos según talla, o valor único cuando no haya mínimo.
3. Plantillas por defecto, reglas independientes por liga y versiones al editar.
4. Clasificación reproducible por fecha real de captura; una captura puede sumar en varias ligas.
5. Entradas tardías, edición de sesiones pasadas y recalculado de resultados.
**Entregable:** rankings consistentes y auditables.

### Fase 6 — Estadísticas y mapas
1. Perfiles públicos entre usuarios registrados, estadísticas por jornada (06:00 a 06:00 Europe/Madrid), temporada y especies.
2. Comunidad: récords, kilos, capturas/hora, jornadas, horas y especies exclusivas identificadas.
3. Fichas de zonas del PDF de Arousa; mapas Leaflet con visibilidad según privacidad.
**Entregable:** paneles personales y comunitarios y mapa de puntos.

### Fase 7 — Preparación del servidor
1. Docker Compose, HTTPS, reverse proxy Caddy y persistencia de SQLite y fotos.
2. Copia de seguridad diaria y prueba de restauración; secretos fuera del repositorio.
3. Pruebas de uso desde móvil y fuera de la LAN, autenticación y privacidad de coordenadas.
**Entregable:** servicio doméstico publicado de forma controlada.

## Pruebas críticas
- Sesión 23:00 a 04:00, jornada 06:00, inicio/fin de liga y cambios de horario oficial.
- Una captura válida en 2+ ligas, liga simple, grupos personalizados, especie sin talla y sin identificación específica.
- Reescritura de reglas de liga y recálculo tras sesión histórica o unirse tarde.
- Solicitud HTTP duplicada, timeout tras escribir en servidor, fallo de servidor antes de guardar.
- Control de acceso a coordenadas exactas e imágenes, EXIF eliminado, permisos de administración.
- Bilingüismo gl/es, búsqueda por alias y tildes, accesibilidad y rendimiento en móvil.

## Política de fotos
- Priorizar CC0 y CC BY; admitir CC BY-SA con atribución y respeto a condiciones aplicables. Revisar individualmente la licencia y las condiciones de cada archivo. No suponer que todas las fotos de iNaturalist son libres de uso comercial.
- Guardar autor real, URL de origen y licencia; mostrar créditos desde la ficha. Una foto sin procedencia o sin derecho de uso no se publica.
- No identificar taxones por nombre vulgar ambiguo ni extraer libremente imágenes del PDF sin verificar derechos.
- Cuando una ficha quede sin foto: placeholder neutral + opción de subida manual por administración.

## Alcance excluido
- Modo offline, sincronización y acciones sin conexión.
- Apartado de normativa, vedas, cupos, permisos y actualización legislativa.
- OAuth con Google de inicio; no es necesario para primera versión.
- Validación exhaustiva previa de todo el catálogo de referencia; se revisa gradualmente.
