# Instalación y operación en nuc-cas

Preparado para **Ubuntu Server 24.04, AMD64, Intel i5-5300U, 8 GB RAM y Docker Compose v2**. No se ha accedido por SSH ni desplegado en el NUC. Los comandos de instalación se ejecutan allí **después de revisar y fusionar el PR y autorizar la instalación**.

## Compatibilidad con servidor-casa

Se consultó `aculledor/servidor-casa`, main `0cc60161010c0bb550ca88cbde67f5a63ee82e5d` (29/10/2026): README, AGENTS, DESPLIEGUE, Compose del panel, workflow y ejecutores GitOps. Es una referencia documental, no una comprobación en vivo. No se ha modificado ese repositorio.

Pesca usa `/opt/servicios/cebo-pemento`, proyecto Compose `cebo-pemento`, origen `/opt/cebo-pemento` y puerto LAN **8444** propuesto, distinto del panel 8443. Hay que comprobarlo con `ss` antes de instalar. No toca 53/80/443, AdGuard, Tailscale, multimedia, HDD USB, firewall, DNS, UPnP ni router. No monta Docker socket en contenedores. Su actualizador usa el mismo bloqueo `/run/lock/servidor-casa-deploy.lock` para no coincidir con el GitOps existente, pero **no invoca ni amplía su allowlist**.

React compilado se sirve desde Fastify en un solo contenedor; SQLite es un archivo dentro del volumen, no un servidor/contenedor adicional. Caddy proporciona HTTPS privado. Límites: app 512 MB/0,5 CPU/128 procesos, Caddy 128 MB/0,25 CPU/64 procesos, logs rotados. Una sola réplica de API escribe SQLite WAL. No compilar en el NUC durante reproducción multimedia: las imágenes AMD64 se construyen en GitHub Actions. Los límites no sustituyen medir la carga real de Sharp/backups y usuarios.

## 1. Comprobación inicial, sin modificar servicios

```bash
uname -m                         # esperado: x86_64
free -h
docker version
docker compose version           # v2 moderno, con --wait y múltiples --env-file
sudo ss -lntup                   # comprobar 8444 libre; no detener al ocupante
df -h / /srv/datos
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
sudo docker volume ls
```

Si existe una instalación de pesca, **identifica su volumen, base, fotos y backups antes de continuar**. No sustituyas `.env` ni crees una base vacía en otro volumen creyendo que migras datos. En `.env` se puede indicar `DATA_VOLUME=VOLUMEN_EXISTENTE`. No cambies nombres/rutas de otros proyectos. Usa el SSD interno para SQLite, sin depender del HDD multimedia ni almacenamiento de red.

## 2. Código revisado e imagen publicada

En GitHub, proteger `main` mediante revisión y exigir los checks `validate` e `image`. El workflow `.github/workflows/ci-ghcr.yml` prueba TypeScript, API, importador, navegador móvil, estado del actualizador, Compose e imagen de producción. En PR construye/prueba sin publicar. Solo un push/ejecución manual sobre `main` publica:

```text
ghcr.io/aculledor/cebo-de-pemento:sha-COMMIT@sha256:DIGEST
```

Node y Caddy están fijados por versión y digest real; las acciones por SHA. Se genera SBOM/procedencia y el artefacto **cebo-image-digest/image.env**. No hay publicación desde PR, runner doméstico ni credenciales SSH del NUC en Actions. La primera publicación requiere que Actions esté habilitado y `GITHUB_TOKEN` tenga permiso de paquetes; si la cuenta impone aprobaciones/políticas, completarlas en GitHub. La ejecución remota del workflow no se considera verificada solo porque pasen pruebas locales.

Clonar solo si no existe el directorio; como usuario `servidor`:

```bash
sudo install -d -o servidor -g servidor -m 0755 /opt/cebo-pemento
git clone --branch main https://github.com/aculledor/CeboDePemento.git /opt/cebo-pemento
cd /opt/cebo-pemento
git status --short
git log -1 --oneline
```

Si ya existe el clon, revisa cambios y usa `git pull --ff-only origin main`. Nunca copiar un script nuevo a `/usr/local/sbin` automáticamente por haber actualizado Git.

Descarga el artefacto de la publicación **correcta de main** desde Actions, extrae `image.env` a `/tmp/cebo-release/image.env`. Alternativa, con GitHub CLI ya instalado/autenticado como `servidor`:

```bash
CEBO_RUN_ID=$(gh run list --repo aculledor/CeboDePemento --workflow ci-ghcr.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')
gh run download "$CEBO_RUN_ID" --repo aculledor/CeboDePemento --name cebo-image-digest --dir /tmp/cebo-release
cat /tmp/cebo-release/image.env   # solo referencia pública, sin credenciales
```

Conserva las imágenes previamente utilizadas en GHCR para rollback. No usar `latest` ni inventar digests. GHCR puede crear el paquete privado inicialmente: dale al NUC acceso de solo lectura a paquetes, o configura explícitamente su visibilidad pública si procede. Un token privado se introduce únicamente en el NUC por stdin:

```bash
read -rsp 'Token GHCR de solo lectura: ' CEBO_GHCR_TOKEN; echo
printf '%s' "$CEBO_GHCR_TOKEN" | sudo docker login ghcr.io --username aculledor --password-stdin
unset CEBO_GHCR_TOKEN
```

El token no va en Git, `.env` de la aplicación, argumentos ni Actions. La autenticación Git del usuario `servidor` para `fetch` es separada; preferir clave de despliegue de solo lectura cuando el repositorio lo requiera.

## 3. Instalación nueva (no sobre una instalación existente)

```bash
cd /opt/cebo-pemento
test ! -e /opt/servicios/cebo-pemento   # si existe, revisar la instalación; no seguir este bloque
sudo install -d -o root -g root -m 0755 /opt/servicios/cebo-pemento/deploy
sudo install -o root -g root -m 0644 compose.yaml /opt/servicios/cebo-pemento/compose.yaml
sudo install -o root -g root -m 0644 deploy/Caddyfile /opt/servicios/cebo-pemento/deploy/Caddyfile
sudo install -o root -g root -m 0600 deploy/compose.env.example /opt/servicios/cebo-pemento/.env
sudo install -o root -g root -m 0600 /tmp/cebo-release/image.env /opt/servicios/cebo-pemento/image.env
sudoedit /opt/servicios/cebo-pemento/.env
```

Confirma `LAN_IP=192.168.1.145`, `HTTPS_PORT=8444` y el volumen correcto. Esa IP procede del inventario; verifica la reserva actual. El actualizador admite entorno simple KEY=value sin comillas, duplicados ni interpolaciones. No hay secretos de sesión/contraseñas iniciales que inventar: los tokens se generan aleatoriamente y las contraseñas se piden de forma oculta.

Define esta función para los siguientes comandos de la sesión SSH:

```bash
dc() {
  sudo docker compose --project-directory /opt/servicios/cebo-pemento \
    --env-file /opt/servicios/cebo-pemento/.env \
    --env-file /opt/servicios/cebo-pemento/image.env \
    -p cebo-pemento -f /opt/servicios/cebo-pemento/compose.yaml "$@"
}
```

Solo para instalación sin datos previos:

```bash
sudo docker volume create cebo_pemento_data
dc config --quiet
dc pull app caddy
dc up -d --no-build --wait --wait-timeout 150
dc exec app node apps/api/dist/cli.js admin admin
```

El último comando pide contraseña por entrada oculta; no hay cuenta predeterminada. Si migras una instalación existente, omite la creación de administrador y restaura antes de permitir el uso.

SQLite, fotos, cachés de importación bajo `data/imports` y snapshots persisten en `DATA_VOLUME`, externo al ciclo Compose. Caddy conserva su CA/estado en `cebo_pemento_caddy_data` y `cebo_pemento_caddy_config`. No ejecutar `down -v`, `prune`, `--remove-orphans` ni borrados de volúmenes. El original del catálogo incluido en la imagen se copia solamente si el destino no existe. Actualizar imagen no reemplaza la base existente.

## 4. HTTPS y móvil

Caddy genera una CA local privada persistente; no solicita certificados públicos ni abre puertos 80/443. Distribuye únicamente su certificado **público**, nunca `root.key`:

```bash
dc cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/cebo-root.crt
sudo install -o root -g root -m 0644 /tmp/cebo-root.crt /opt/servicios/cebo-pemento/ca.crt
openssl x509 -in /tmp/cebo-root.crt -noout -fingerprint -sha256
curl --fail --cacert /opt/servicios/cebo-pemento/ca.crt https://192.168.1.145:8444/api/health
dc ps
```

Instala esa CA en los dispositivos de confianza comprobando la huella por un canal conocido. En iOS instala el perfil y activa confianza completa para la CA en Ajustes; en Android instala certificado CA según la versión/dispositivo; en Windows importa el certificado en raíces de confianza del usuario. No continúes ignorando advertencias TLS. Prueba **https://192.168.1.145:8444** desde el móvil en Wi-Fi: acceso, invitación, catálogo, sesión/captura, fotos y clasificación. Las cookies son Secure/HttpOnly/SameSite; cada escritura exige origen exacto y CSRF.

Para acceso remoto conserva la configuración existente de Tailscale. El teléfono puede usar esa IP LAN si ya existe un subnet router autorizado; de otro modo prepara aparte un proxy HTTPS privado/nombre Tailscale y el origen correspondiente. **Esta instalación no modifica Tailscale Serve ni sus rutas**. No se garantiza acceso remoto hasta probar esa ruta real. Si tienes un proxy con dominio/certificado público, configura un virtual host dedicado y `PUBLIC_ORIGINS` exacto mediante una revisión independiente; no reutilices ni reinicies a ciegas el Caddy de Soularr. No publicar Vite ni Fastify directamente.

## 5. Migración y restauración manual

En Windows: `npm run db:backup`. Transfiere la carpeta completa del snapshot (SQLite verificado y `photos`) al NUC por SCP, fuera de Git. No copiar en caliente solo el `.sqlite` sin WAL.

Con el snapshot en `/tmp/cebo-transfer/snapshot`, detén únicamente el acceso a pesca y restaura en destinos nuevos:

```bash
dc stop caddy app
CEBO_HELPER=$(dc run -d --no-deps --cap-add CHOWN --entrypoint node app -e 'setInterval(()=>{},10000)')
sudo docker cp /tmp/cebo-transfer/snapshot "$CEBO_HELPER:/app/data/transferencia"
sudo docker exec --user 0 "$CEBO_HELPER" chown -R 1000:1000 /app/data/transferencia
sudo docker exec "$CEBO_HELPER" node --input-type=module -e "import {restoreSnapshot} from './apps/api/dist/restore.js'; await restoreSnapshot('data/transferencia','data/restored.sqlite','data/restored-photos');"
sudo docker rm -f "$CEBO_HELPER"    # solo el auxiliar creado en este bloque
sudoedit /opt/servicios/cebo-pemento/.env
```

Configura `DATABASE_PATH=data/restored.sqlite` y `PHOTO_DIRECTORY=data/restored-photos`, conserva el volumen y origen, después:

```bash
dc up -d --no-build --wait --wait-timeout 150 app caddy
curl --fail --cacert /opt/servicios/cebo-pemento/ca.crt https://192.168.1.145:8444/api/health
```

La restauración rechaza sobrescribir destinos. Usa nombres distintos para otro intento. El helper importa directamente la función de restauración para no ejecutar migraciones antiguas sobre una base más reciente.

## 6. GitOps opt-in, después de la primera validación manual

Los PR fusionados en main generan una imagen solo si pasan los checks. Un timer **instalado y activado manualmente** consulta GitHub por conexión saliente cada diez minutos; comprueba SHA de main, etiqueta OCI, arquitectura AMD64 y digest de la imagen propia antes de cambiar nada. Si Actions no ha publicado todavía, falla sin detener servicios y vuelve a probar después. No ejecuta scripts obtenidos de Git ni actualiza Compose/Caddy/env/unidades automáticamente.

Se alinea con el mecanismo del panel de `servidor-casa`. Para inventariarlo allí, se pueden copiar mediante **otro PR revisado** `compose.yaml` a `servicios/cebo-pemento/compose.yaml` y enlazar esta guía. No añadirlo sin revisión al ejecutor de música/AdGuard ni copiar `.env`, certificados privados o datos. La imagen por digest en `image.env` sigue siendo estado local generado desde la revisión main y GHCR.

Primero revisar los archivos y validar sin instalar:

```bash
cd /opt/cebo-pemento
python3 -m unittest discover -s tests -p test_nuc_deploy.py -v
sed -n '1,320p' deploy/nuc/deploy.py
sudo install -o root -g root -m 0755 deploy/nuc/deploy.py /usr/local/sbin/cebo-pemento-deploy
sudo /usr/local/sbin/cebo-pemento-deploy --check
sudo /usr/local/sbin/cebo-pemento-deploy --backup
```

Comprueba el snapshot exportado en `/var/backups/cebo-pemento-deploy`. Los snapshots de actualizaciones se toman con proxy/API de pesca detenidos. Las copias diarias pueden usar la API online consistente de SQLite; todos los archivos aprobados de fotos se conservan.

Tras autorizar localmente automatización y validar una restauración aislada:

```bash
sudo install -d -o root -g root -m 0755 /etc/cebo-pemento
sudo sh -c 'umask 077; printf "enabled\n" > /etc/cebo-pemento/auto.enabled'
sudo install -o root -g root -m 0644 deploy/nuc/cebo-pemento-update.service deploy/nuc/cebo-pemento-update.timer deploy/nuc/cebo-pemento-backup.service deploy/nuc/cebo-pemento-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cebo-pemento-update.timer cebo-pemento-backup.timer
systemctl list-timers cebo-pemento-update.timer cebo-pemento-backup.timer
```

Este bloque es una decisión de operación del administrador y **no se ha ejecutado**. Fusionar el PR no instala ni activa nada en el NUC. Para pausar solo estas actualizaciones:

```bash
sudo systemctl disable --now cebo-pemento-update.timer
```

## 7. Salud, rollback y límites

Antes de cambiar imagen, el actualizador guarda configuración previa 0600 y snapshot consistente de SQLite/fotos, también exportado fuera del volumen Docker. Cierra Caddy y API **solo de pesca**, crea la copia, migra/inicia el candidato y verifica API/frontend con Caddy aún cerrado. Si falla: detiene candidato, restaura el snapshot en **nuevos archivos/directorios**, cambia las rutas locales y arranca la imagen anterior por digest. Los archivos fallidos quedan disponibles para diagnóstico. `failed-release.json` bloquea reintentos automáticos de esa misma imagen hasta revisión manual.

Tras aceptar backend/frontend, reabre Caddy y valida HTTPS con la CA local. Si falla el proxy/TLS a partir de ese punto, se informa del fallo **sin revertir automáticamente datos**, pues podría haber escrituras confirmadas de usuarios. Una reversión tardía requiere parar pesca, hacer otro backup, valorar diferencias y restaurar conscientemente. No basta con volver a una imagen si hay migraciones nuevas. Una futura migración con cambio de semántica destructivo requiere procedimiento específico, no confiar en este rollback genérico.

```bash
sudo journalctl -u cebo-pemento-update.service -n 100 --no-pager
sudo journalctl -u cebo-pemento-backup.service -n 100 --no-pager
dc logs --tail=100 app caddy
dc ps
sudo docker stats --no-stream
sudo /usr/local/sbin/cebo-pemento-deploy --check
```

Una actualización/reversión manual debe utilizar un `image.env` archivado real y el snapshot correspondiente, siguiendo el procedimiento de restauración anterior con acceso cerrado. No borrar la base más reciente ni los backups. No reintentar una versión marcada fallida sin entender y corregir la causa.

## 8. Backup externo y recuperación de desastre

La aplicación genera snapshots diarios en `data/backups`; el timer opcional los exporta a `/var/backups/cebo-pemento-deploy`. No hay poda automática: vigilar espacio y definir retención después de una recuperación probada. El volumen de Caddy contiene clave privada de CA: respaldarlo privadamente si quieres conservar la confianza de los móviles, o emitir nueva CA y reinstalarla si se pierde. Los backups de pesca incluyen datos personales y hashes de contraseñas: no publicarlos ni adjuntarlos al PR.

El exportador **no modifica** `/srv/datos/copias-servidor-casa` ni su política. Prepara aparte una segunda copia cifrada fuera del NUC; guardar dos copias en el mismo servidor no cubre fallo/pérdida del equipo. Con el SSD correcto montado, un administrador puede copiar privadamente los snapshots exportados a su destino elegido y comprobar SHA-256. Verifica que el backup global de servidor-casa incluye el volumen de pesca o esta exportación: guardar solo `/opt/servicios` no incluye un volumen Docker nombrado.

Para desastre: instalar Docker en un host compatible; recuperar los manifiestos revisados y el digest archivado, credenciales de lectura GHCR, volumen nuevo y snapshot; restaurar con API/proxy cerrados; arrancar esa versión; importar la CA recuperada o distribuir una nueva. Probar login existente, capturas históricas, fotos, ranking, privacidad y un guardado confirmado desde móvil antes de habilitar timers. Guardar evidencia y fecha de la prueba. Las pruebas cloud de persistencia/restauración no equivalen a haber completado esta prueba en el NUC.

## Importación del catálogo en producción

Consultar [CATALOGO_IMPORT.md](CATALOGO_IMPORT.md). La CLI compilada y cachés persistentes se usan así:

```bash
dc exec app node apps/api/dist/pescaderias/cli.js inspect --cache data/imports/revision-1
# Revisar páginas/condiciones reales y aportar policy.json válido antes de importar.
dc exec app node apps/api/dist/pescaderias/cli.js import --resume data/imports/revision-1 --policy data/imports/revision-1/policy.json --category fish --limit 3 --dry-run
```

El sistema permanece exclusivamente online. No existen sincronización diferida, service worker ni guardados optimistas durante una actualización o caída del servidor.
