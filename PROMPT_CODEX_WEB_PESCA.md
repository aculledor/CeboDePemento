# Encargo para ChatGPT Codex: aplicación web de pesca

Actúa como ingeniero de software full-stack sénior, arquitecto y responsable de calidad. Quiero que **desarrolles una aplicación web funcional, ejecutable y mantenible**, no que te limites a elaborar un plan, pseudocódigo o mockups. Tienes autorización para crear y modificar archivos del proyecto, instalar dependencias cuando el entorno lo permita, ejecutar pruebas y corregir errores. Trabaja autónomamente y por fases comprobables; pregunta únicamente si existe un bloqueo real que no puedas resolver de manera segura.

## 1. Fuentes y precedencia

Antes de programar, examina los archivos disponibles en este repositorio:

- `REQUISITOS_WEB_PESCA_ACTUALIZADOS.md` (fuente principal de requisitos)
- `PLAN_DESARROLLO_WEB_PESCA_ACTUALIZADO.md` (plan por fases)
- `LEEME.md`, `REQUISITOS.md` (antecedentes; pueden contener decisiones obsoletas)
- `catalogo.sqlite` (base de datos inicial REAL)
- `schema.sql` y `seed.sql` (esquema y volcado reproducible)
- `resumen.json`, `referencia_xunta.json`, `referencia_continental.json`
- `Guia_pesca_Arousa_campo_alta_calidad(1).pdf` (material editorial y zonas)

**Precedencia:** este encargo y `REQUISITOS_WEB_PESCA_ACTUALIZADOS.md` prevalecen sobre documentos antiguos ante contradicciones. Conserva las decisiones funcionales ya confirmadas. Si falta algún archivo esencial, indica exactamente cuál; no finjas haberlo leído. No alteres irreversiblemente la base original: trabaja con una copia e implementa migraciones. No ejecutes `seed.sql` y la importación de `catalogo.sqlite` simultáneamente, pues son vías alternativas para cargar el mismo catálogo.

Al comenzar, inspecciona repositorio, herramientas, SQLite y documentación; presenta un resumen muy breve del estado real y un plan de ejecución, y **empieza a implementar inmediatamente**.

## 2. Objetivo y entorno

La web permitirá a un grupo pequeño de amigos registrar sesiones de pesca y capturas, consultar especies y zonas, competir en ligas y consultar estadísticas propias y comunitarias. Será **mobile first**, accesible desde Android y iPhone mediante navegador, y bilingüe en **gallego y castellano**. Primero se desarrollará en **Windows 11**, y después se desplegará en un **servidor doméstico Linux**, accesible de forma segura desde Internet. Bastan 10–20 usuarios concurrentes. Prioriza simplicidad operativa y mantenimiento; evita microservicios, nube obligatoria o infraestructura sobredimensionada.

**La web funciona exclusivamente ONLINE.** No implementes modo offline, cola de operaciones, guardado local pendiente, sincronización diferida ni caché editable con IndexedDB. Cada lectura de datos requiere respuesta efectiva de la API, y ninguna escritura, edición, borrado o aprobación puede darse por realizada sin confirmación del servidor. Si la API no responde, indica desconexión y bloquea acciones dependientes del servidor hasta restablecer y verificar su estado. No confíes únicamente en `navigator.onLine`. Usa identificadores idempotentes para prevenir registros duplicados si el servidor guarda algo y se pierde la respuesta. No uses actualizaciones optimistas para datos de capturas o puntos.

**No incluir módulo de normativa**: nada de pantallas de legislación, permisos, vedas, cupos o actualizaciones legales. Los campos de talla mínima editables son referencias internas revisables para las reglas de competición y nunca se presentan como certificación de legalidad actual.

## 3. Stack preferido

- Monorepositorio con `apps/web` (React, TypeScript, Vite) y `apps/api` (Node.js, TypeScript, Fastify); código compartido cuando resulte útil.
- React Router, TanStack Query, React Hook Form y Zod.
- i18next para interfaz y contenidos gl/es desde el primer día.
- SQLite + Drizzle ORM; activar foreign keys, configurar WAL en condiciones apropiadas y usar migraciones versionadas.
- Leaflet y OpenStreetMap para mapas ONLINE.
- Archivos de imágenes en almacenamiento local persistente, metadatos y relaciones en SQLite, miniaturas/WebP derivados.
- Scripts npm sencillos para desarrollo, compilación, migración, seed, pruebas y arranque.
- Preparar Docker Compose + Caddy para Linux, HTTPS, volúmenes, backups y restauración.

Puedes ajustar detalles menores por compatibilidad, pero explica cualquier desviación importante. El frontend nunca accede directamente al archivo SQLite. La API aplica validaciones y permisos, no solo la interfaz.

## 4. Acceso, usuarios y privacidad

- Autenticación inicial mediante **usuario y contraseña**, no Google OAuth todavía.
- Registro únicamente con invitación de un solo uso y caducidad, generada por el administrador; recuperación mediante token temporal de un solo uso entregable por el administrador, sin correo automático obligatorio.
- Roles `admin` y `member`. Usuarios autenticados pueden ver perfiles, históricos, estadísticas y ligas de otros usuarios; no publicar información personal en páginas accesibles sin login.
- Password hashing Argon2id; cookies de sesión HttpOnly, Secure en producción, SameSite y protección CSRF adecuada; límites de intentos y comprobaciones de autorización reales.
- Cada sesión de pesca decide privacidad de ubicación: `private`, `general` (solo zona) o `exact` (coordenadas). No enviar coordenadas privadas a clientes no autorizados, ni filtrarlas por mapas, endpoints, respuestas estadísticas o metadatos EXIF. Eliminar GPS/EXIF de fotos servidas.
- Cualquier usuario puede crear ligas e invitar usuarios a ellas. Invitaciones de registro y de liga son conceptos distintos.

## 5. Catálogo, búsqueda e imágenes

Aprovecha `catalogo.sqlite` respetando los IDs existentes. Contiene **932 entradas de referencia, de las que 62 están seleccionadas inicialmente**, y no constituye un inventario validado de 932 especies gallegas. Las demás están pendientes de revisión; no afirmes presencia local ni inventes identificaciones o traducciones. Conserva fuentes y trazabilidad. Implementa catálogo visible inicialmente a partir de la selección y administración de pendientes/ampliaciones.

Mantén `fish`, `cephalopod` y `crustacean` como filtros biológicos principales; admite clase, orden y familia cuando estén disponibles. Los alias y nombres comunes gallegos y castellanos deben buscarse juntos, ignorando mayúsculas y tildes, junto al nombre científico y sinónimos. En cada ficha muestra siempre nombres gl/es disponibles y el científico en menor tamaño. Un nombre coloquial no constituye ID de especie. Evita duplicar taxones: maragota/pinto = `Labrus bergylta`; choupa = `Spondyliosoma cantharus`; rapante/meiga = `Lepidorhombus whiffiagonis`. Lorcho y otras identificaciones genéricas no cuentan como especies distintas para diversidad.

Implementa **administración CRUD del catálogo**: crear, editar, activar/ocultar, revisar y relacionar nombres, alias, taxonomía, identificación, descripciones, consejos, tallas de referencia, imagen principal y galería. Talla con estado `pending`, `has_minimum`, `confirmed_no_minimum`, con fuente/fecha/autor cuando sea posible. Un dato desconocido NO significa sin talla mínima. No elimines físicamente un taxón con registros históricos; usa desactivación, correcciones o asociaciones preservando integridad referencial. Conserva auditoría de modificaciones.

**Fotografías de especies:** implementar un importador semiautomático. Buscar candidatos por nombre científico y sinónimos en Wikimedia Commons prioritariamente e iNaturalist en segundo lugar; Openverse/GBIF opcionales. Mostrar candidatos con miniatura, taxón, autor, procedencia y licencia; un admin revisa, elige o descarta. Descargar al servidor y convertir a WebP/miniatura **solo fotografías con permisos confirmados**. Preferir CC0/CC BY; tratar CC BY-SA y restricciones específicas correctamente. Guardar URL original, autor, licencia, URL de licencia, descarga, revisión e imagen principal. Admitir subida manual de fotografías con autoría/licencia, validación de tipo/tamaño y sanitización. Fallback neutral si no hay foto. No copiar arbitrariamente imágenes del PDF ni usar fotos de origen incierto. Si no se puede acceder a APIs externas, entrega la integración implementada y probada con mocks, y deja un modo de carga manual operativo; no inventes imágenes ni licencias.

## 6. Sesiones de pesca y capturas

- Una sesión pertenece a un único usuario, guarda fecha/hora de inicio y fin obligatorios (fin nulo solo mientras está activa), zona opcional, privacidad y observaciones. Puede pasar de un día al siguiente, incluso varias jornadas; cerrar el navegador no la termina. Pueden existir sesiones sin capturas.
- Registrar sesiones pasadas y corregir sesiones/capturas históricas. Los datos retrospectivos tienen fecha/hora real de captura y fecha de declaración separada. No inventar horarios que falten.
- Una captura es un **lote** dentro de una sola sesión, con timestamp, taxón o identificación genérica, cantidad positiva, cuántos cumplen talla cuando proceda, cuántos se retuvieron, peso total del lote, longitud del ejemplar mayor, peso individual del más pesado y cero o varias fotos; medidas y fotos opcionales. El ejemplar más largo y el más pesado pueden ser distintos. Retenidas y liberadas puntúan igual.
- Validar `0 <= cumplen_talla <= cantidad`, `0 <= retenidas <= cantidad`, valores físicos no negativos, fecha de captura coherente con sesión, tamaños de fotos y autorizaciones. Si un lote corresponde a instantes que atraviesan el límite de una jornada o competición, pedir dividirlo o registrar timestamps correctos en vez de repartirlo ficticiamente.
- Una captura pertenece a una sola sesión, pero puede aportar puntos a **todas las ligas** del propietario para las que cumple los criterios.
- Un usuario puede proponer una sesión para otro: queda pendiente de aprobación; no suma estadísticas ni puntos antes de ser aceptada. El destinatario puede revisar/corregir y aprobar o rechazar. Registrar proponente, destinatario, estado y auditoría. No duplicar sesiones entre cuentas.

**Jornada pesquera:** zona `Europe/Madrid`; empieza a las **06:00** (inclusive) y termina al día siguiente a las 06:00 (exclusive). Una sesión 22:00–04:00 pertenece a una única jornada, aunque abarque dos fechas civiles. Una sesión más larga puede abarcar varias jornadas; atribuye capturas por su timestamp y calcula tiempo de manera consistente. Los límites de liga siguen la misma convención local de las 06:00 y los cambios de hora oficial se procesan sin suponer que todos los días duran exactamente 24 h. Guarda instantes reales y fecha civil local.

## 7. Ligas y puntuación

- Ligas abiertas o privadas por invitación, con fechas inicial/final, miembros, categorías biológicas admitidas y/o selección explícita de especies y categorías genéricas. Una liga puede incorporar múltiples categorías.
- **Liga simple:** todo ejemplar admitido vale exactamente **1 punto**, independientemente de talla o especie.
- **Liga personalizada:** grupos arbitrarios de especies con puntos sin talla / con talla, o valor único para especies sin mínimo confirmado; cada liga define default de puntos, permiso de especies fuera de grupos y alcance de especies admitidas. Una especie no puede estar en dos grupos de puntuación de la misma liga.
- Plantillas iniciales: `Morralla` 1/1, `Comunes` 1/2, `Especiales` 2/4, copiadas al crear la liga, no referencias globales vivas. Lorcho, xarda y faneca son Morralla. Choco/calamar usan la plantilla común aunque su categoría biológica es cefalópodos.
- Si la talla aplicable revisada se conoce, al registrar el lote es obligatorio indicar cuántos cumplen; si está confirmada la ausencia de mínimo, aplicar valor único; si está pendiente o la identificación es genérica, aplicar solo puntuación básica de la liga, por defecto 1, y únicamente si la liga la admite. La pertenencia a grupos y la admisión son reglas independientes.
- Quien entre a mitad de liga suma también capturas previas realizadas dentro del periodo. Se pueden modificar reglas de liga (incluso terminada) y corregir sesiones históricas; recalcula rankings retrospectivos. Guarda versiones de reglas y auditoría. La clasificación es reproducible a partir de capturas y reglas; cualquier caché de puntuación debe poder regenerarse.
- Muestra explicación de puntos por captura y liga; aplica criterios deterministas de desempate, documentados.

## 8. Estadísticas y mapas

- Perfil propio completo e historial visible a los demás usuarios autenticados. Totales de ejemplares, especies identificadas, kilos declarados, longitud/peso récord, sesiones, jornadas, horas, capturas/hora y evolución temporal; filtros por periodo, especie y usuario cuando resulte útil.
- Página comunitaria con récords (mayor, más pesado, más horas, más kilos, más especies, etc.) y **especies exclusivas**, entendidas como identificadas y capturadas por un único usuario del grupo, NO como rareza biológica. Identificaciones genéricas no cuentan como exclusivas. No sumar dos veces horas de sesiones solapadas; distinguir dato de peso desconocido de peso cero y mostrar cobertura de pesos declarados.
- Mapa online con Leaflet y zonas editables. Usar el PDF de campo de Arousa para crear fichas editoriales de zonas, especies habituales y técnicas, señalando información orientativa. No extraer mapas/imágenes de terceros sin revisar permisos. Respetar privacidad `private/general/exact` en API y frontend.

## 9. UX y pantallas

Diseño **mobile first de verdad**: formularios cómodos a una mano, botones grandes, tipografía legible, navegación inferior fija y formularios rápidos con validación clara. Cinco accesos principales: `Inicio`, `Sesión`, `Ligas`, `Especies`, `Perfil`. El flujo prioritario es `Iniciar sesión de pesca -> Añadir captura en pocos toques -> Cerrar sesión`.

Implementar: acceso/registro por invitación; inicio/dashboard; perfil e historial; sesiones activa/pasadas y edición; captura por lote y fotos; aprobación de sesiones propuestas; ligas propias/disponibles, alta, detalle/ranking, creación y edición; catálogo/búsqueda/ficha; estadísticas comunitarias; mapa/fichas de zona; panel de administración de usuarios/invitaciones/especies/fotografías/tallas/zonas. Selector gl/es persistente y textos bilingües reales, no textos inventados ni una interfaz mayoritariamente monolingüe. Estados vacíos, de carga y de error; accesibilidad con teclado y contraste adecuado. **No incluir pantalla de normativa**.

## 10. Seguridad, integridad y producción

- Validación estricta Zod en API; límites de payload y fotos; sanitización de imágenes; gestión segura de rutas de archivos, SSRF al importar URLs remotas, XSS y CSRF; CORS restringido.
- Consultas parametrizadas, claves foráneas, transacciones al aprobar, puntuar y modificar datos relacionados. Auditoría para eventos relevantes.
- `GET /health` o mecanismo equivalente para comprobar disponibilidad; verificar API en vez de deducirla solo del estado de red.
- Configuración por variables de entorno documentadas, `.env.example`, secretos fuera de Git y sin credenciales reales de ejemplo.
- Docker Compose para Linux, Caddy/HTTPS (guía alternativa de túnel seguro), SQLite/fotos en volúmenes persistentes y copias automáticas verificables con procedimiento de restauración. No exponer el puerto interno de Node directamente a Internet.
- Nunca ejecutes operaciones destructivas sobre datos reales sin copia de seguridad y explicación.

## 11. Forma de trabajar y entregables

Implementa por fases con commits claros si Git está disponible. **No te quedes en planificación**: produce código que arranque, migraciones, pruebas y documentación. Orden recomendado:

1. Inspección, estructura monorepo, scripts de desarrollo, apertura segura del catálogo existente y web/API funcionando en Windows.
2. Migraciones y modelo completo, autenticación por invitación y seguridad.
3. Interfaz móvil bilingüe, catálogo navegable y CRUD administrativo de fichas.
4. Importación/revisión de fotos y subida manual.
5. Sesiones de pesca, lotes, fotos, edición histórica y aprobación para terceros.
6. Ligas simples/personalizadas, invitaciones, motor de puntuación versionado y rankings.
7. Estadísticas, mapas y fichas de zonas.
8. Pruebas integrales, Docker Compose, HTTPS, backups y documentación de despliegue.

Por cada fase: ejecuta las pruebas posibles, corrige errores e indica brevemente qué está terminado, cómo verificarlo y qué queda. Si no puedes terminar todas en una ejecución, **entrega una fase realmente operativa y deja los siguientes pasos priorizados**, sin presentar prototipos falsos como funcionalidad acabada. No sustituyas endpoints reales por mocks fuera de pruebas ni simules guardados exitosos en el frontend.

Incluye como mínimo:

- `README.md` con instrucciones copiables para un Windows 11 recién instalado (Node LTS, Git, instalación, migraciones y `npm run dev`) y para Linux/Docker.
- `.env.example` y comandos reproducibles para crear el primer admin, generar invitaciones y restaurar backups.
- Tipos compartidos/API documentada y migraciones de SQLite sin pérdida de datos ni IDs del catálogo.
- Tests unitarios del motor de puntos, jornadas horarias, validaciones e identificación; tests de integración de API para permisos, privacidad e idempotencia; al menos pruebas funcionales de flujos principales cuando sea posible.
- Una cuenta/demo de desarrollo solo si está claramente separada y deshabilitada para producción.
- Al final de cada ejecución: archivos modificados, comandos realmente ejecutados, resultado de pruebas/build, instrucciones exactas para arrancar y bloqueos reales.

## 12. Criterios de aceptación imprescindibles

Verifica con pruebas, entre otros:

1. Buscar «xurelo», «jurel» y `Trachurus trachurus` devuelve la misma ficha; alternar gl/es no la duplica.
2. Sesión del 12 a las 22:00 al 13 a las 04:00 pertenece a la jornada del 12; funciona durante el cambio horario oficial.
3. Lote de 7 xurelos, 5 con talla y 2 sin talla, produce 12 puntos en una liga 1/2 y 7 en una liga simple; una misma captura suma en dos ligas válidas sin duplicarse en SQLite.
4. Un usuario que entra tarde recibe puntos por capturas anteriores dentro de las fechas de la liga.
5. Cambiar reglas, editar capturas pasadas y aprobar sesiones propuestas recalcula puntos y estadísticas con auditoría.
6. Un timeout con operación ya aplicada no duplica una captura cuando se reintenta mediante el identificador idempotente.
7. Sin API, ningún guardado/edición/aprobación aparece como correcto ni se encola para enviar posteriormente.
8. Un usuario no administrador no modifica fichas o tallas; un usuario no autorizado nunca recibe coordenadas privadas ni EXIF GPS.
9. El administrador puede corregir una especie, introducir talla de referencia y subir o seleccionar foto con procedencia/licencia, sin romper capturas antiguas.
10. `npm run build`, migraciones y suite de pruebas pasan; frontend y API arrancan localmente con pasos documentados.

**Empieza ahora inspeccionando los archivos reales y creando el repositorio funcional.** Prioriza resultados comprobables y utiliza criterios técnicos razonables sin detenerte por decisiones menores.
