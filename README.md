# Cebo de Pemento · v0.1.0

Aplicación de pesca **online**, mobile first, en gallego y castellano. React/TypeScript/Vite, Fastify, SQLite y Drizzle. Incluye acceso por invitación, catálogo editable, fotografías, sesiones y lotes, propuestas para otro usuario, ligas simples/personalizadas, clasificaciones versionadas, estadísticas y mapa con zonas.

El catálogo original conserva sus 932 entradas de referencia, 62 seleccionadas y 870 fuera de la selección inicial. No es un inventario verificado de fauna gallega. No se han inventado fotos, traducciones de nombres, tallas o coordenadas. No hay normativa, modo offline, cola de operaciones ni cuentas de demostración en la base de uso.

## Windows 11: instalar y arrancar

Instala Node.js **24 LTS x64** y Git desde PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Abre una nueva terminal y comprueba `node --version` (24.x) y `git --version`. Si el instalador LTS ofrece otra versión mayor, descarga Node 24 desde https://nodejs.org/en/download.

**Si recibiste el ZIP**, descomprímelo y entra en su carpeta `CeboDePemento`. El ZIP incluye esta implementación; los commits locales no se han enviado automáticamente a GitHub. Clonar el remoto antes de incorporar esos commits solo descarga su estado anterior.

```powershell
cd CeboDePemento
Copy-Item .env.example .env
npm ci
npm run setup
npm run admin:create -- admin
npm run dev
```

El comando de administrador pide una contraseña sin mostrarla (12–128 caracteres). No la pases como argumento. No hay contraseña predeterminada. Abre **http://localhost:5173** e inicia sesión con el usuario que has creado. `npm run dev` arranca React y la API; Vite redirige `/api` a `127.0.0.1:3001`.

`setup` compila los contratos, copia `catalogo.sqlite` únicamente si la base de trabajo no existe y aplica las migraciones pendientes. **No ejecutes además `seed.sql`**: es una vía alternativa para el catálogo original. Si un antivirus o una instalación de Node de otra arquitectura impide cargar SQLite/Argon2, comprueba primero Node 24 x64 y los mensajes de `npm ci`.

## Acceso desde el móvil por Wi-Fi

Ejecuta `ipconfig` en el PC. Añade su dirección real a `.env`:

```dotenv
APP_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.50:5173
```

Sustituye la IP, reinicia `npm run dev` y abre `http://TU_IP:5173` en el móvil conectado a esa Wi-Fi. Permite Node en el firewall para la **red privada**. El móvil usa el proxy de Vite; Fastify sigue en localhost. El HTTP de desarrollo está pensado para esa LAN; el acceso externo utiliza HTTPS y Caddy. No abras el puerto de Vite o Node en el router.

Para probar el build sin Vite: `npm run build`, añade `http://localhost:3001` a `APP_ORIGINS`, ejecuta `npm start` y abre esa dirección. Mantén un único proceso de API por base de datos.

## Primer uso

1. En Inicio → Administración, genera una invitación y entrega el código a tu amigo. Caduca a las 72 horas; el registro lo consume una sola vez. También puedes crearla con `npm run invite:create -- admin 72`.
2. En Sesión, inicia una jornada o introduce los horarios reales de una sesión pasada. El fin vacío significa activa. Cerrar el navegador no la termina.
3. Añade lotes: especie, instante, cantidad, retenidos y, cuando corresponda, cantidad que cumple la referencia de talla. Peso total, longitud mayor y peso individual mayor son campos separados y opcionales. Un dato desconocido se deja vacío, no se convierte en cero.
4. En un lote guardado, abre sus detalles para corregirlo o subir varias fotografías. JPEG/PNG/WebP hasta 8 MB; el servidor elimina EXIF/GPS. Para una foto propia puedes dejar la URL vacía: se registra la subida local con su autoría, licencia y usuario que la aportó.
5. Cierra la sesión con el botón o introduce el fin real retrospectivo. Si propones una sesión para otro usuario, no cuenta hasta que esa persona la apruebe. Tras aprobar, solo su propietario controla las modificaciones.
6. Crea una liga simple (1 punto por ejemplar) o personalizada. Se pueden copiar las plantillas y modificar sus grupos, valores y ámbito. La misma captura suma en varias ligas admitidas; entrar tarde incluye capturas previas dentro del periodo.

Jornada y límites de liga: **06:00–06:00 Europe/Madrid**. Los cambios de hora usan calendario local. En una hora repetida el formulario pide escoger el desfase UTC real; una hora inexistente se rechaza. Divide los lotes que correspondan a instantes a ambos lados de un límite.

Las tallas son referencias internas de competición, con fuente, fecha y autor del cambio. Un cambio del catálogo no modifica silenciosamente la referencia conservada en una captura: al editarla puedes actualizarla **expresamente** y revisar los ejemplares que cumplen. Las identificaciones genéricas no cuentan como especies distintas o exclusivas.

## Catálogo, fotografías y zonas

El administrador puede crear, editar, revisar y activar/ocultar fichas, conservar/corregir alias, taxonomía y textos gl/es, y gestionar referencias de talla. Los IDs se mantienen. Las ediciones simultáneas se detectan mediante revisiones; las modificaciones quedan auditadas.

Busca candidatos por nombre científico y sinónimos desde la ficha administrativa: Wikimedia primero o iNaturalist. Autor, licencia y origen acompañan cada candidato. **No se descarga/publica hasta aprobarlo**, comprobando identificación y derechos; puedes rechazarlo o cambiar la imagen principal. CC0 y licencias CC BY/CC BY-SA reconocidas tienen enlaces de atribución. En iNaturalist no se deduce una versión de licencia a partir de un código incompleto: se admiten CC0 o versiones con URL reconocida.

En este entorno las APIs externas están bloqueadas por la política de red: la integración está probada con respuestas de prueba y la subida manual funciona con archivos reales. No se importaron automáticamente las fotos del catálogo. Desde tu servidor con acceso a esas APIs podrás buscar y aprobar candidatas. Algunas fichas pueden seguir sin fotografía o sin traducción; se muestra explícitamente.

Las **21 zonas del PDF** tienen fichas editoriales adaptadas y bilingües. Sus coordenadas se dejaron vacías porque no se obtuvieron coordenadas verificadas del texto. Un administrador puede situarlas y editarlas en Mapa y zonas. Leaflet utiliza OpenStreetMap online. Las coordenadas personales son privadas, generales (solo zona) o exactas, según la sesión; las privadas no se envían a otros usuarios, tampoco a un administrador ajeno a esa sesión.

## Recuperación de acceso

Administración permite emitir un código de recuperación para un usuario. Caduca en una hora y se consume al cambiar la contraseña; se revocan todas sus sesiones autenticadas. También:

```powershell
npm run recovery:create -- admin nombre_de_usuario
```

Entrega ese código personalmente. La aplicación no envía correos ni mensajes automáticamente.

## Comandos y comprobaciones

| Comando | Resultado |
| --- | --- |
| `npm run dev` | React y API; preparación previa del catálogo |
| `npm run setup` | Contratos compilados, copia inicial y migración |
| `npm run db:migrate` | Migraciones pendientes, con backup y checksum |
| `npm run admin:create -- admin` | Primer administrador, contraseña por entrada oculta |
| `npm run invite:create -- admin 72` | Invitación de registro por CLI |
| `npm run recovery:create -- admin usuario` | Recuperación de un solo uso |
| `npm run db:backup` | Snapshot verificado de SQLite y fotografías |
| `npm run db:restore -- SNAPSHOT data/restored.sqlite data/restored-photos` | Restaurar en destinos nuevos |
| `npm run typecheck` | TypeScript estricto |
| `npm test` | Pruebas unitarias/integración con bases temporales reales |
| `npm run build` | Compila contratos, API y frontend |
| `npm start` | API compilada y React en el mismo origen |

Prueba opcional de navegador, también reproducible en Windows:

```powershell
npx playwright install chromium
npm run test:browser
```

Si ya tienes Chromium, puedes indicar su ejecutable mediante `PLAYWRIGHT_CHROMIUM`. La prueba utiliza una base temporal y una cuenta **solo de prueba**, en localhost:3003. No utiliza tu base de trabajo ni crea usuarios en ella; su servidor de fixtures rechaza `NODE_ENV=production`.

## Backups y restauración local

`db:backup` muestra la carpeta del snapshot. SQLite se copia con su API de backup (incluido WAL) y se comprueban integridad y FK. Las fotografías se copian después; los archivos archivados se conservan para no romper referencias históricas. Guarda otra copia de los snapshots fuera del disco del servidor y trata las copias como datos privados.

Para restaurar:

1. Detén la API.
2. Ejecuta `npm run db:restore -- "RUTA_SNAPSHOT" data/restored.sqlite data/restored-photos`.
3. Cambia en `.env` `DATABASE_PATH=data/restored.sqlite` y `PHOTO_DIRECTORY=data/restored-photos`.
4. Arranca y comprueba acceso, catálogo, diario y fotografías.

La restauración **no sobrescribe** destinos existentes. Si solo restauras un fichero SQLite, el primer argumento puede ser su ruta; el snapshot completo es preferible. No copies únicamente el `.sqlite` activo mientras está en WAL: utiliza el comando de backup.

## Linux doméstico: Docker y HTTPS

Instala Docker Engine y Compose v2 siguiendo la documentación de tu distribución. Copia este proyecto al servidor. En `.env` configura un **dominio real**, cuyo DNS apunte a tu conexión:

```dotenv
DOMAIN=pesca.tu-dominio.es
```

```bash
docker compose up -d --build
docker compose exec app node apps/api/dist/cli.js admin admin
```

Caddy expone 80/443 y gestiona HTTPS. La API no publica su puerto interno; SQLite, fotos y snapshots persisten en `fishing_data`. La aplicación comprueba backups al arrancar y cada hora; crea uno cuando han pasado 24 horas desde la última copia verificada. Los reinicios no reinician el cómputo de esa última copia. Las copias no se eliminan automáticamente.

Si migras datos de Windows, **no crees otro primer administrador**. Genera allí un snapshot, transfiérelo y restaura dentro del volumen en destinos nuevos:

```bash
docker compose cp ./snapshot app:/app/data/transferencia
docker compose exec --user root app chown -R node:node /app/data/transferencia
docker compose exec app node apps/api/dist/cli.js restore data/transferencia data/restored.sqlite data/restored-photos
```

Cambia `.env` a las rutas restauradas y aplica:

```dotenv
DATABASE_PATH=data/restored.sqlite
PHOTO_DIRECTORY=data/restored-photos
```

```bash
docker compose up -d --force-recreate app caddy
docker compose exec app node apps/api/dist/cli.js backup
docker compose logs --tail=50 app caddy
```

Para copiar backups fuera del contenedor: `docker compose cp app:/app/data/backups ./backups-servidor`. No uses `docker compose down -v`: eliminaría los volúmenes. Si la red Docker personalizada no utiliza 172.16.0.0/12, ajusta `TRUST_PROXY` al rango de tu proxy. Solo debe confiar en Caddy, no en cualquier origen.

Si tu operador usa CG-NAT, el reenvío de puertos no basta: utiliza acceso VPN privado (por ejemplo Tailscale) o un túnel HTTPS configurado con tu dominio y origen exacto. Ese acceso, DNS, certificados reales y pruebas desde fuera de tu LAN requieren tu infraestructura; no se han desplegado en este entorno.

## Estructura y estado

- `apps/web`: React, formularios, navegación móvil, datos confirmados por API.
- `apps/api`: Fastify, permisos, modelos, migraciones, cálculo y almacenamiento.
- `packages/shared`: contratos del catálogo/acceso y validaciones compartidas.
- `scripts`, `tests`: restauración y prueba de navegador aislada.
- `data`: base de trabajo, fotos y backups; ignorado por Git.
- `docs`: inspección, API, estado y verificación.
- `Dockerfile`, `compose.yaml`, `deploy/Caddyfile`: servidor Linux.

Drizzle tipa catálogo y usuarios; las consultas de cálculo, auditoría y relaciones complejas usan SQL parametrizado. Las migraciones SQL tienen checksum, transacción y copia previa. No edites una migración aplicada: añade otra. El servidor se niega a escribir sobre la base original, también a través de un enlace simbólico.

Consulta `docs/ESTADO.md` y `docs/VERIFICACION.md` para las comprobaciones realizadas y sus límites. El PDF se conserva como fuente editorial, sin extraer indiscriminadamente sus imágenes. Los requisitos actualizados prevalecen sobre `REQUISITOS.md`.
