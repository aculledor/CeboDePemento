# Ampliación del 29/10/2026

Importador incremental de pescadeRías, migración 0006 y revisión administrativa implementados. Sin importación real por bloqueo 403 del proxy y sin permisos de reutilización verificables. Ver [CATALOGO_IMPORT.md](CATALOGO_IMPORT.md).

Docker/Compose, CI/GHCR AMD64 y actualizador opt-in preparados para el NUC real documentado en servidor-casa. Sin cambios en ese repositorio ni despliegue remoto. La instalación actual es privada por LAN HTTPS en puerto configurable; seguir [NUC.md](NUC.md), que sustituye el esquema anterior con dominio público/80/443.

El estado histórico de las funciones de aplicación se conserva debajo.

# Estado de la versión 0.1.0

| Fase | Implementación |
| --- | --- |
| 0 | Monorepo, Node 24, React/Vite, Fastify, copia segura del catálogo, migraciones y scripts Windows |
| 1 | Usuarios, Argon2id, invitaciones/recuperación, cookies, CSRF, límites, permisos, auditoría, idempotencia y backups |
| 2 | Catálogo bilingüe, buscador/alias, CRUD por desactivación, taxonomía, revisión, descripciones y tallas con control de versiones |
| 3 | Subida real, WebP/miniatura, EXIF eliminado, créditos, candidatas Commons/iNaturalist, aprobación/rechazo e imagen principal |
| 4 | Sesiones activas/históricas, lotes, medidas, fotos, edición, referencias de talla conservadas/corregibles, propuestas y archivo lógico |
| 5 | Ligas abiertas/privadas, invitaciones, reglas y periodos versionados, plantillas copiadas, puntos, rankings y explicaciones recalculados |
| 6 | Perfiles/comunidad, periodos, horas sin solapamiento, jornadas DST, pesos desconocidos, récords/especies exclusivas, mapa y 21 zonas editables |
| 7 | Docker construido y arrancado, Compose/Caddy, persistencia, backups diarios comprobados y restauración a destinos nuevos |

## Pendiente de operación y revisión de contenido

- Instalar y comprobar físicamente Windows 11, Android/iPhone y acceso desde otra red. La verificación de navegador disponible se hizo en Chromium a 390 × 844.
- Configurar tu dominio, DNS, router o túnel y desplegar en tu servidor doméstico. La imagen se verificó localmente; no se publicó un servicio en Internet.
- Revisar/importar fotografías reales de las 62 iniciales. Las APIs externas están bloqueadas en este entorno; las integraciones están probadas con fixtures y la subida manual con archivos reales.
- Situar las zonas con coordenadas revisadas. Sus textos vienen del PDF, pero no se inventaron posiciones.
- Revisar progresivamente presencia local, nomenclatura, traducciones que faltan y referencias de talla. Los registros de referencia no se declaran un inventario completo.

## Decisiones de comportamiento

- Guardado confirmado por POST/PATCH o consulta del resultado idempotente; sin estados optimistas. Tras perder la respuesta, el formulario conserva la operación en memoria y bloquea cambios hasta consultar/reintentar expresamente.
- No hay cola offline, IndexedDB o service worker. TanStack Query usa `networkMode: always` y sin reintentos de escrituras para impedir operaciones pausadas que se envíen al recuperar la red.
- Una captura conserva su referencia de talla. Actualizarla exige una corrección explícita del propietario; queda auditada y afecta los resultados posteriores.
- Una versión histórica de reglas se aplica a las capturas actuales, incluidas correcciones históricas, y utiliza el periodo guardado con esa versión. La auditoría conserva los cambios de datos.
- Ranking: puntos, cantidad admitida y luego ID estable. Especies genéricas no cuentan para diversidad ni exclusivas.
- Archivar sesiones/lotes no elimina filas, fotos ni claves históricas; se excluyen de API visible, estadísticas y ligas.
- El idioma es la única preferencia persistida en el navegador. Los registros permanecen en SQLite.
