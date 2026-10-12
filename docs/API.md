# API de la aplicación

Base `/api`, JSON, mismo origen. Todas las lecturas de datos requieren autenticación salvo `GET /health` y `GET /auth/csrf`. Respuestas `Cache-Control: no-store`. En desarrollo Vite actúa como proxy; en producción React y API se sirven juntos tras Caddy.

## Seguridad y escrituras

1. `GET /auth/csrf` devuelve `{token}` y fija una cookie HttpOnly.
2. En cada escritura envía `Origin` admitido, `Content-Type: application/json`, `X-CSRF-Token: token` y las cookies de la sesión.
3. Las escrituras de entidades usan `Idempotency-Key: UUID`. Repetir el mismo cuerpo, ruta y actor devuelve el resultado ya aplicado. Reutilizar la clave con otros datos produce 409.
4. `GET /operations/:uuid` devuelve `{applied:false}` o `{applied:true,result}` para el actor actual. No consulta operaciones de otra cuenta.

Las revisiones se envían como `revision`: 0 al crear, valor recibido al editar. Un cambio simultáneo produce `409 REVISION_CONFLICT`. Si la respuesta se pierde, consulta la operación antes de editar datos o generar otra clave. No hay reenvío automático offline.

## Rutas

| Ámbito | Rutas principales |
| --- | --- |
| Acceso | GET `/auth/me`, POST `/auth/login`, `/auth/logout`, `/auth/register`, `/auth/reset` |
| Administración de acceso | GET `/admin/users`, `/admin/invitations`; POST `/admin/invitations`, `/admin/invitations/:id/revoke`, `/admin/recovery` |
| Catálogo | GET `/catalog`, `/catalog/:id`, `/catalog/:id/sources`, `/catalog/:id/photos` |
| Edición del catálogo | GET `/admin/catalog`, `/admin/catalog/:id/history`; POST `/admin/catalog`; PATCH `/admin/catalog/:id` |
| Fotos | POST `/admin/catalog/:id/photos`, `/admin/catalog/:id/photo-candidates`; POST `/admin/photos/:id/approve`, `/reject`, `/primary`; GET `/photos/:id/image` o `/thumbnail` |
| Usuarios y diario | GET `/users`, `/sessions`, `/sessions/:id`; POST `/sessions`; PATCH `/sessions/:id`; POST `/sessions/:id/decision`, `/sessions/:id/delete` |
| Capturas | POST `/sessions/:id/captures`; PATCH `/captures/:id`; POST `/captures/:id/delete`; GET/POST `/captures/:id/photos` |
| Ligas | GET/POST `/leagues`; GET/PATCH `/leagues/:id`; POST `/leagues/:id/join`, `/leagues/:id/invitations`, `/league-invitations/accept` |
| Comunidad | GET `/stats`, `/map`, `/zones`; GET `/admin/zones`; POST `/admin/zones`; PATCH `/admin/zones/:id` |

Catálogo: `q`, `category` (`fish/cephalopod/crustacean`), `page`, `pageSize` hasta 100. Administración añade `active=all/0/1`. Sesiones: `page`, `pageSize` hasta 100, `ownerId`, `status`. Estadísticas: `userId`, `taxonId`, `firstDay` y `lastDay` (ambas o ninguna). Ligas: `version` opcional para una versión guardada de reglas y periodo.

## Cuerpos de ejemplo (estructura, no datos insertados)

Una sesión usa `ownerId` opcional, `startAt`/`endAt` ISO con offset (fin null mientras activa), `zoneId`, `privacy`, `latitude`, `longitude`, `notes` y `revision`. Proponer otro propietario genera `pending`. Solo el propietario aprueba; el autor puede editar mientras está pendiente. Coordenadas privadas no se devuelven a otros usuarios, incluidos administradores ajenos. `general` conserva solo la zona.

Un lote usa `taxonId`, `caughtAt`, `quantity`, `qualifying`, `retained`, `totalWeightKg`, `maxLengthCm`, `maxWeightKg`, `revision` y `reviewSizeReference` opcional (false por defecto). Medidas/qualifying desconocidas: null. Cumplimientos/retenciones están acotados por cantidad. El mayor peso individual no supera un peso total conocido. El instante debe estar dentro de la sesión. La referencia de talla se conserva salvo actualización explícita o cambio de taxón.

Una liga usa `name`, `visibility` (`open/private`), `firstDay`, `lastDay`, `revision`, `useTemplates` y `rules`: `mode`, `defaultPoints`, `allowUngrouped`, `allowGeneric`, `categories`, `taxonIds`, `groups`. Cada grupo tiene `id`, `name`, `below`, `above`, `single`, `taxonIds`. Los puntos admiten hasta seis decimales y se normalizan a esa precisión para evitar residuos de coma flotante. No se permite una especie en dos grupos. Sin `taxonIds` explícitos se usa el ámbito biológico; con selección se aplica la intersección de ambos criterios. El modo simple ignora los grupos al puntuar.

Subida: `base64`, `author`, `license`, `originalUrl`, `rightsConfirmed:true`, `isPrimary`. La URL puede estar vacía para una fotografía propia: la procedencia es su subida local. Para fuentes externas debe ser HTTPS sin credenciales. Solo JPEG/PNG/WebP, hasta 8 MB y límite de píxeles; se convierten a WebP sin EXIF. Una captura permite varias fotografías; editar/subir requiere propietario o autor de propuesta aún pendiente. Las fotos de una sesión archivada dejan de servirse.

Candidatas: `{provider:'commons'|'inaturalist'}`. Aprobación exige `{rightsConfirmed:true,isPrimary:boolean}`. Los hosts de descarga son fijos y se rechazan redirecciones; no existe descarga arbitraria por URL. Se registran autor, licencia, origen, modificaciones y revisión.

Catálogo/acceso: contratos en `packages/shared/src/index.ts`; validaciones adicionales en los módulos correspondientes de la API. Los DTO del catálogo/acceso usan camelCase; diario/filas de lectura usan los nombres SQL documentados. El detalle de sesión añade `captures`; la lista devuelve resúmenes sin lotes. No se envían hashes de contraseña.

Errores: `{code,message,details?}`. 400 validación, 401 acceso, 403 permisos/CSRF/origen, 404 no visible, 409 revisión/idempotencia, 413 payload, 415 formato, 429 límite y 5xx fallo. Una respuesta de error nunca significa que una escritura se confirmó. Las acciones relevantes quedan auditadas.
