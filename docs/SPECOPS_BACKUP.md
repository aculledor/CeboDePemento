# Backup diario de la versión PROD activa (#8)

Corrección desde Cebo main `041065e1d9b7439e7552224103d982bc9c6a1460`.
Contrato contrastado con `specops/host.py`, `engine.py`, `cli.py` y `policy.py`
de Servidor Casa main `6b8a65071e443155408a9fb1b960b939e28b69b0`.
No se ha accedido al NUC ni instalado este cambio.

## Selección y condiciones de seguridad

SpecOps aplica `APP_IMAGE` por override y conserva el `image.env` PROD sellado con
el baseline legacy. Por ello `--backup` ya no elige su imagen de ese archivo antes
del lock. Adquiere el mismo `/run/lock/servidor-casa-deploy.lock`, espera hasta
**300 segundos** y, si vence, falla visiblemente sin afirmar que existe copia.
La unidad conserva **TimeoutStartSec=900**, el calendario y su UMask. No se añaden
servicios ni locks que compitan con el orden de adquisición del reconciliador.

Dentro del lock, antes de ejecutar el snapshot:

1. Identifica exactamente un contenedor del servicio `app`, proyecto
   `cebo-pemento`, directorio `/opt/servicios/cebo-pemento`, no one-off. Exige
   Running, healthy, sin pausa/reinicio. Nunca selecciona Caddy ni el entorno DEV.
2. Lee su `Config.Image` exacto. Solo admite la referencia legacy
   `ghcr.io/aculledor/cebo-de-pemento:sha-COMMIT@sha256:DIGEST` o
   `ghcr.io/aculledor/cebo-de-pemento-dev@sha256:DIGEST`. Inspecciona la imagen ya
   local: ID coincidente con el contenedor, RepoDigest exacto, linux/amd64,
   OCI source del repositorio y revision SHA válida. El tag legacy debe coincidir
   con esa revisión; un candidato promovido debe coincidir con su evidencia local.
3. Obtiene Compose efectivo con ese override y verifica el único montaje de datos
   `/app/data`, el volumen externo exacto, driver local sin opciones y Mountpoint
   coincidente. Contrasta DATABASE_PATH/PHOTO_DIRECTORY con el contenedor. Rechaza
   build, otros montajes persistentes y rutas fuera de data/. La DB debe existir:
   no deja que la CLI inicialice un catálogo nuevo por pérdida de la base. Rechaza
   enlaces en las rutas de datos. Antes de la primera aceptación, el directorio
   de fotos aún puede faltar como permite el backup legacy; tras promoción o
   rollback registrado debe conservarse el directorio ya verificado por el motor.
4. Si existe cualquier registro Cebo PROD de SpecOps, exige perfil root privado
   `/etc/servidor-casa/specops/cebo-prod.json`, seals y compose_hash efectivos,
   baseline legacy y rutas DB/fotos correspondientes al volumen inspeccionado.
   No importa módulos desde `/opt/servidor-casa` ni requiere GitHub/red.
5. Contrasta `/var/lib/servidor-specops/cebo-prod-image.json` (`image`) y
   `cebo-prod.json` (`current`, `pending`). **Cualquier pending se rechaza**, incluso
   verifying entre adquisiciones del lock global. Un estado parcial, archivo
   enlazado/no privado, JSON ambiguo o discrepancia aborta antes del snapshot.
   Para refs promovidas verifica también accepted_candidate, su ID canónico y
   revision/digest/repositorio/plataforma. No usa selected_candidate, sha/digest
   históricos ni last_rollback para adivinar la imagen activa.

No se exige un status remoto listo: una espera de candidato o caída de GitHub no
impide respaldar la versión local coherente y sana. Tras rollback, current y el
registro image vuelven a la imagen anterior; la metadata OCI identifica esa
versión, aunque el diario retenga campos históricos. Antes de la primera promoción
se acepta el baseline con perfil instalado y current nulo: image record puede no
existir o contener el mismo baseline tras una recuperación local del motor. Sin
ningún registro SpecOps se exige la coincidencia exacta del baseline legacy.
La presencia del perfil no requiere activar el reconciliador para hacer backup.

## Snapshot, exportación y recuperación

Se conserva el snapshot de SQLite/fotos existente. Su helper Compose y el helper
de exportación usan **la misma referencia inmutable seleccionada**, sin pull ni
build. `compose run --no-deps --pull never` crea solo el auxiliar; el servicio app
no admite build. No se usa `--no-build` con run: esa opción no existe en dicho
subcomando ([referencia Docker](https://docs.docker.com/reference/cli/docker/compose/run/)).
El exportador monta el volumen verificado read-only y solo se elimina ese auxiliar.
No hay stop/up/recreate de PROD, fetch Git ni activación de timers.

En el directorio privado nuevo del backup se guardan `.env`, `compose.yaml` y
un **image.env generado exclusivamente para recuperación**, con
`APP_IMAGE=REFERENCIA_ACTIVA`. **Nunca se reemplaza el image.env de producción**.
La selección se vuelve a verificar al terminar la exportación. Solo entonces
se escribe `release.json`, manteniendo `image` y `snapshot` y añadiendo version=2
y runtime: imagen, revisión OCI, image ID, container ID, volumen, rutas relativas
DB/fotos y prueba mínima de coherencia SpecOps. No se copian tokens ni todo el
diario/perfil. Configuración/metadata nacen 0600, directorio 0700; los snapshots
siguen siendo privados y no se deben adjuntar a GitHub.

Sin release.json no hay exportación declarada verificada. Ante fallo se conserva
lo ya escrito para diagnóstico; no hay poda ni borrado de datos persistentes.
La salida del comando es no cero. El timeout systemd sigue limitando el proceso.

Para restaurar, usar **el digest del image.env archivado**, su `.env`, manifiesto
revisado y snapshot juntos, en un stack aislado/nuevo con destinos nuevos. Invocar
`restoreSnapshot` de esa imagen como en [NUC, recuperación](NUC.md), sin ejecutar un
migrador viejo sobre una base nueva. No copiar el image.env recuperado sobre el
baseline sellado de PROD ni reactivar el actualizador legacy. La restauración real
y cualquier cambio de perfiles deben autorizarse en la sesión operativa aparte.

## Pruebas y límites de la evidencia

```bash
python3 -m unittest discover -s tests -p 'test_nuc*.py' -v
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 -m py_compile deploy/nuc/deploy.py
git diff --check
```

Las pruebas ejecutan `main --backup` y el backup/export real del helper Python con
frontera Docker simulada, archivos/SQLite reales y flock real entre procesos.
Cubren baseline sin SpecOps, perfil previo a promoción, promoción, rollback a otra
DEV y a legacy, todos los pending, drift de journal/image/perfil/seals/DB/volumen/
identidad/OCI/salud, JSON inválido, symlinks/permisos, errores snapshot/create/cp/rm,
ausencia de mutaciones PROD y espera/timeout del lock. La exportación conserva
un commit presente en WAL y se restaura a otra SQLite verificable con sus fotos.
Después de npm build, CI también usa el **restoreSnapshot existente de Node**,
comprueba datos/fotos y rechazo de sobrescribir destinos. El CLI Docker real de
CI valida flags y consume el JSON efectivo del Compose de producción, sin pull
ni acceso al daemon para esta comprobación. Estos dos casos se omiten localmente
si no existe Docker CLI o la API compilada, y se ejecutan en el runner CI existente.
Los smoke Docker habituales de CI se conservan. No se afirma haber probado datos
reales del NUC ni una restauración de producción.

## Instalación root revisada y comprobación antes de activar PROD

Solo tras revisión de Claude, integración y autorización local. Un merge no
instala el helper. Mantener el backup diario existente; **no habilitar**
`cebo-pemento-update.timer` ni modificar unidades/perfiles/seals para esta corrección.

1. Obtener desde Git la versión exacta revisada de `deploy/nuc/deploy.py`, comprobar
   su SHA/diff y ejecutar las pruebas anteriores sin sudo. El fichero es autónomo
   y usa solo stdlib; no necesita instalar paquetes Python ni copiar el motor.
2. Preparar una copia root en un directorio privado y comprobarla allí con
   `/usr/bin/python3 -I COPIA_ROOT --check`. Este modo conserva su comprobación
   histórica de configuración legacy y no sustituye la inspección runtime del backup.
3. Guardar privadamente el helper instalado anterior y sus SHA-256. Instalar la
   copia revisada root:root 0755 fuera de Git, en
   `/usr/local/sbin/cebo-pemento-deploy`, preferiblemente por rename de un fichero
   vecino preparado root. No ejecutar Python privilegiado desde un checkout mutable.
   La unidad existente apunta a esa ruta; no requiere daemon-reload ni enable.
4. Antes de la primera promoción, ejecutar explícitamente el helper instalado
   `--backup`. El comando espera el lock; no detiene/recrea app ni lee GitHub.
   Comprobar privadamente la nueva release.json: image == runtime.image == APP_IMAGE
   del image.env **archivado**, runtime.volume y revisión correctos, snapshot completo
   y permisos. Registrar unidad TimeoutStartSec=900 y el resultado del ensayo de lock.
5. Completar la restauración aislada con esa imagen exacta y datos privados según
   la guía NUC antes de habilitar PROD. Después de promoción/rollback, una ejecución
   explícita o la siguiente copia diaria debe registrar el digest realmente activo.
   Fallos se diagnostican con journalctl del backup; no limpiar journals para pasarlos.

Reversión del helper: restaurar únicamente la copia root anterior, sin tocar datos,
imagen ni estado SpecOps. La versión anterior solo es correcta sobre baseline
legacy; si ya hubo promoción, no declararla apta para copias diarias. Mantener
congelada la versión sana y corregir el helper en una ventana autorizada.

No cambian publicadores, blobs de confianza, scopes, candidatos iniciales #39/#5,
ramas de promoción ni módulos compartidos. Los archivos de este mantenimiento
quedan fuera del scope de candidatos; no requiere rotación de confianza del motor.
