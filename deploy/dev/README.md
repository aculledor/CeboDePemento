# Cebo DEV aislado en NUC — propuesta sin activar

DEV y PROD residen en el NUC, con el PC apagado. Este PR prepara y prueba su
configuración; no instala unidades, firewall, certificados ni credenciales en
el host. No fusionar hasta revisión independiente y transición de actualizadores
main autorizada. No se publican todavía candidatos del issue #3.

## CI y permisos

`validate` y `test-image` solo tienen `contents: read`. Todos los checkout usan
`persist-credentials: false`. npm, Dockerfile y ambos smoke se ejecutan en esos
jobs, sin login GHCR ni permisos de paquetes. El job `publish` solo admite
`push` a `main`, depende de `test-image`, no hace checkout ni ejecuta código de
la imagen/repositorio. Solo usa acciones fijadas por SHA y comandos del workflow
para copiar el OCI probado con `skopeo --preserve-digests`, sin reconstrucción.
Su authfile efímero se elimina incluso si falla. `workflow_dispatch` solo prueba.

El OCI incluye procedencia/SBOM BuildKit. El smoke importa y prueba su manifiesto
AMD64; no se confunde el ImageID local con el digest del índice OCI. El publicador
compara el digest remoto con el de build. En PR `publish` queda skipped y ni el
OCI publicable se sube como artifact: no se introducen candidatos SpecOps, gate
PROD ni publicación PR. La publicación existente de main conserva su repositorio
legacy; su instalación/despliegue automático exige la transición revisada.

El aislamiento de jobs no sustituye proteger el workflow/main ni la configuración
de Actions: exigir aprobación de colaboradores externos y revisar cambios de
`.github/workflows`. No se modifican permisos/settings del repositorio en este PR.
No poner PAT, secretos PROD, Docker socket remoto ni claves NUC en Actions.

## Identidades, imagen y colisiones

| Recurso | DEV |
| --- | --- |
| Directorio instalado | `/opt/servicios-dev/cebo-pemento` |
| Proyecto requerido | `cebo-pemento-dev` |
| Servicios | `app-dev`, `gateway-dev` (distintos de PROD) |
| Volumen de datos fijo | `cebo-pemento-dev_fishing_data` |
| Redes fijas | `cebo-pemento-dev_internal`, `cebo-pemento-dev_ingress` |
| Subredes propuestas | `172.29.92.0/24`, `172.29.93.0/24` |
| URL privada | `https://cebo-dev.home.arpa:18444` |
| Bind LAN | `192.168.1.145` |

Todos llevan `com.servidor-casa.env: dev`. El validador rechaza otro proyecto,
labels, mounts, redes externas, nombres de volumen PROD y referencias mutables.
Aunque se sobrescriba `name:` con `-p`, los nombres de servicio DEV ya no pueden
recrear `app`/`caddy` PROD. Nunca usar `--remove-orphans`. La validación del
proyecto es obligatoria antes de operar; `name:` solo no es una barrera.

Si ya existía un DEV antiguo, conservar su volumen de datos y respaldarlo antes
del cambio de nombres de servicio. Detener solo sus contenedores identificados
como proyecto `cebo-pemento-dev`, con la plantilla antigua revisada; no usar
`--remove-orphans` ni detener el proyecto PROD. No borrar los volúmenes antiguos
de Caddy automáticamente. Tras verificar el TLS nuevo, retirar la CA anterior
únicamente del perfil de prueba donde se hubiera confiado.

`CEBO_DEV_IMAGE`, `CEBO_DEV_HOST` y `CEBO_DEV_BIND` son obligatorios. LAN exige
`ghcr.io/aculledor/cebo-de-pemento-dev@sha256:<64hex>`, hostname exacto y bind de
la tabla. CI usa explícitamente el mismo hostname, loopback e ImageID inmutable
`sha256:<64hex>` de la imagen construida; ese permiso no existe en modo LAN.
No hay valores por defecto independientes ni fallback a `cebo-pemento:dev`.
Resolver el hostname en dispositivos autorizados mediante hosts/DNS privado en
un cambio aprobado aparte. Las cookies no aíslan por puerto. No exponer WAN.

## TLS: clave emisora exclusivamente offline

Se elimina `tls internal` y sus volúmenes CA. Caddy solo recibe un certificado
servidor de 365 días (un año) y su clave, de solo lectura, emitidos por una CA offline con
`nameConstraints` crítico para `cebo-dev.home.arpa` y exclusión de IPs.
La raíz dura 1825 días (aproximadamente cinco años) y tiene `pathlen:0`: no puede emitir intermediarias. La clave raíz nunca
se copia al NUC, a la imagen, artifacts ni Git. Caddy funciona como UID/GID1000,
sin almacenamiento CA persistente; `/data`, `/config` y `/tmp` son tmpfs limitados.

Preparar en un equipo offline/de administración, después de autorización, dos
rutas **nuevas y separadas**, fuera de Git para la CA:

```bash
python3 scripts/dev-certificates.py --ca-dir /RUTA_OFFLINE_NUEVA/ca --tls-dir /RUTA_NUEVA/tls
```

El script no sobrescribe claves ni instala confianza. Transferir solo `tls/`
al directorio DEV instalado. Clave servidor root:1000 0640 y directorio 0750;
los certificados son públicos. Confiar la CA únicamente en perfil/navegador de
prueba; no instalarla globalmente. Verificar soporte de restricciones en cada
cliente antes de habilitarlo. Las pruebas OpenSSL comprueban que un certificado
firmado por esa CA para `example.com` se rechaza, además de SAN/hostname y TLS real
con curl. No usar `-k`, HTTP de sustitución ni desactivar CSRF.

### Renovación anual con la misma CA

Ejecutar el emisor en Linux/WSL con Python 3 y OpenSSL, desde el equipo de
administración donde se custodia la CA, nunca en el NUC. La renovación anual
offline es mantenimiento excepcional; ningún despliegue ordinario requiere
este paso. Guardar copia cifrada de la CA fuera del NUC y no subir sus claves
reales a CI, artifacts, Git ni contenedores. CI crea únicamente raíces sintéticas
y desechables para las pruebas, sin recibir esa CA real.

Conservar el paquete TLS público/clave de hoja actual en el equipo de
administración para comprobar identidad. Se renueva así:

```bash
python3 scripts/dev-certificates.py --renew \
  --ca-dir /RUTA_OFFLINE/ca \
  --tls-dir /RUTA_ADMIN/tls-actual \
  --output-dir /RUTA_ADMIN/tls-renovado
```

El destino tiene que ser nuevo/vacío y separado. **No se sobrescribe el paquete
activo**: primero genera y verifica los tres archivos en un staging privado,
luego publica el directorio completo con rename y fsync. Un fallo no deja una
pareja nueva a medias. Cambian clave, serial y hoja; `root.crt` conserva su huella
y `root.key` no se modifica. No se reinstala confianza en móviles al renovar.

Antes de firmar se comprueban propietario/permisos, ausencia de symlinks y
hardlinks, correspondencia CA/clave, raíz autofirmada vigente, restricciones
críticas exactas y SAN exclusivo de DEV; se compara la raíz con la del paquete
actual. Se admite renovar una hoja ya caducada, con CA todavía válida. La raíz
debe cubrir toda la nueva hoja de 365 días: si queda menos de un año más margen,
se rechaza la operación y hay que planificar un rollover explícito con una nueva
CA y volver a confiarla. No se alarga silenciosamente la raíz ni se amplían sus
nombres. Una raíz antigua de 365 días no se convierte mágicamente en una de cinco
años: al no estar este DEV activado, preparar la nueva CA antes del bootstrap.

### Aviso 30 días antes, sin otro servicio

El drop-in de `servidor-specops@cebo-dev.service` añade un `ExecStartPre` de
`validate-dev.py --tls-only`. Se ejecuta en cada tick ya existente, aunque el
preflight de arranque tenga `RemainAfterExit`. Solo lee hoja/clave y raíz
pública; nunca solicita la clave CA ni conexión de red. También lo comprueba el
preflight inicial. No hay otro daemon, timer ni proveedor de avisos.

A 30 días o menos de caducar **la hoja o la CA**, devuelve éxito mientras la
cadena siga siendo válida, publica advertencia de prioridad warning en journald
y guarda fechas/huellas públicas y estado en
`/var/lib/servidor-specops/cebo-dev-tls.json` root 0600. No repite el aviso en cada
tick ni reescribe el archivo si no cambia (solo refresco diario y transiciones).
Un certificado realmente caducado/incorrecto bloquea el tick antes del motor,
evita que recover intente recrear la app para corregir un certificado, y deja
el motivo en ese estado. No implica envío de correo/push: el aviso está en el
estado local y el journal existentes. Consultar mediante:

```bash
sudo journalctl -u servidor-specops@cebo-dev.service --priority=warning --since '31 days ago'
sudo cat /var/lib/servidor-specops/cebo-dev-tls.json
```

Instalar una vez la copia root actualizada de `validate-dev.py` (0644), el
preflight existente y ese drop-in únicamente durante el bootstrap autorizado.
La unidad central ya permite escribir en su directorio privado de estado con
`ProtectSystem=strict`: no se amplía el sandbox ni se cambia PR #34. Si falta el
drop-in instalado, la declaración en Git no constituye aviso automático activo.

### Sustitución de TLS y sellos SpecOps: ventana DEV autorizada

No ejecutar estos pasos desde un PR ni aplicarlos a PROD. El paquete renovado
se transfiere **solo a DEV**, sin `root.key`. Tras comprobar nueva hoja y misma
huella raíz en el equipo offline:

1. Parar el timer `servidor-specops@cebo-dev.timer` y esperar a que su servicio
   termine. Adquirir el lock **central por app**
   `/var/lib/servidor-specops/cebo.lock` (compartido con cebo-prod); no usar el
   antiguo lock GitOps global para DEV. Preparar copia privada del perfil root y
   directorio TLS anterior. No borrar journals, recibos ni cuarentenas.
2. Validar paquete, fechas, SAN y correspondencia clave/hoja; directorio nuevo
   root:1000 0750, hoja/raíz públicas 0644 y clave hoja root:1000 0640. Revisar
   que solo contiene `server.crt`, `server.key`, `root.crt` y ningún symlink.
   La CA privada permanece en el equipo offline. No cambiar trust store.
3. Detener **solo `gateway-dev`** con el Compose/env/proyecto DEV instalados.
   Renombrar `tls` a un respaldo y mover el nuevo directorio a la ruta fija
   `/opt/servicios-dev/cebo-pemento/tls`. No usar symlinks: el validador central
   los rechaza. Mantener rutas, Compose e imagen de la app; no tocar su volumen.
4. Arrancar el contenedor gateway existente con `compose start gateway-dev`
   para reabrir el bind del directorio nuevo; un simple reload tras cambiar el
   directorio no garantiza reabrir el bind Docker. Verificar por HTTPS con la
   **CA anterior ya confiada**, hostname/SAN y que el peer sirve la hoja nueva.
   El smoke prueba este stop/start conservando IDs de app y gateway.
5. En `/etc/servidor-casa/specops/cebo-dev.json`, actualizar de forma atómica
   **solo** los SHA-256 de los tres archivos TLS de `seals` (incluir los tres en
   bootstrap), leyendo bytes de archivos regulares root revisados. No recalcular
   ciegamente otros sellos ni relajar comprobaciones. `compose_hash` no cambia:
   solo cambiaron los bytes de TLS en las mismas rutas, no el manifiesto.
   El perfil debe seguir root 0600. Nunca subir el perfil o la clave a Git.
6. Ejecutar el guard TLS y el `--check` del motor instalado, aún con el timer
   parado y el lock. Si falla, detener solo gateway, restituir directorio TLS y
   perfil anteriores, arrancar gateway y validar antes de salir. La app y PROD
   no se recrean. Liberar lock y reactivar el mismo timer solo tras el éxito.

Estas acciones no están ejecutadas ni automatizadas como despliegue por este
PR. El reconciliador deliberadamente no instala certificados ni actualiza sus
propios sellos de confianza desde código del PR.

## Recursos, red y preflight

Cada contenedor tiene usuario1000, read_only, cap_drop ALL, no-new-privileges,
IPv6 desactivado, logs 2×5MiB, prioridad OOM500 y swap deshabilitado por
memswap_limit=mem_limit. App: 512MiB/0.5CPU/128PIDs; gateway: 128MiB/0.25CPU/64PIDs.
Ambos usan `cgroup_parent: servidor-dev.slice`. La referencia de slice fija el
presupuesto conjunto de todo DEV: MemoryMax1152MiB, MemoryHigh1024MiB,
MemorySwapMax0, CPUQuota175%, TasksMax512. El slice requiere Docker con driver
systemd y cgroupv2; limitar solamente la unidad que ejecuta Compose no basta.
El preflight comprueba archivos cgroup y pertenencia real de ambos contenedores.
Antes del arranque LAN exige además 1GiB disponible de RAM y 2GiB libres tanto en
la instalación DEV como en el almacenamiento Docker; un fallo bloquea solo DEV.

App pertenece solo a la red interna; gateway usa también ingress para DNAT.
Ambas redes son propias y sin `external` ni `driver_opts`, compatible con PR #34.
No añadimos `enable_ip_masquerade=false`: el validador central actual rechaza
cualquier driver_opts. En su lugar se exige el bloqueo más completo de ADR-004:
primer salto de FORWARD a DOCKER-USER, de DOCKER-USER a SPECOPS-DEV-FWD y de INPUT
a SPECOPS-DEV-HOST. Para cada subred DEV S, cadenas con reglas NEW DROP:

```text
-A SPECOPS-DEV-FWD -s S ! -d S -m conntrack --ctstate NEW -j DROP
-A SPECOPS-DEV-HOST -s S -m conntrack --ctstate NEW -j DROP
```

Ambas terminan en RETURN, sin ACCEPT previo. Se permiten respuestas a conexiones
entrantes y proxy dentro de la red propia; se bloquean conexiones nuevas a host,
PROD, LAN, otras redes e Internet. DNS externo también queda deshabilitado:
solo nombres locales Docker; no resolver proveedores mediante DNS del host.
El código operativo solo verifica guardias existentes: no cambia firewall.
Instalarlas/persistirlas exige una operación local revisada; no ejecutarlo desde
un PR. Comprobar antes subredes no solapadas, espacio, puertos y carga simultánea.

## Bootstrap y arranque persistente

La única autoridad ordinaria de arranque/reconciliación es SpecOps #34. Se
conserva `restart: "no"`: no se eluden guardias del host. No se añade otro timer.
Tras revisión del contrato y autorización local, instalar una vez las plantillas,
TLS, `dev.env` privado, slice y copias root de `validate-dev.py`/`preflight.sh`
fuera del clon. Las referencias systemd incluyen un preflight leído antes de
`servidor-specops@cebo-dev.service`; instalar su drop-in solo junto al controlador
revisado. El preflight comprueba recursos/egress, HDD UUID y DNS LAN sin montar,
arrancar ni modificar servicios críticos. Si falla, DEV no arranca.

El helper usa `/run/lock/cebo-pemento-dev.lock`. El contrato central revisado en `22a9d4e` separa DEV del lock GitOps global y
limita el global a mutaciones PROD; no se modifica PR #34 durante su revisión. Para evitar backups perdidos por contención se corrige la copia de
referencia de `deploy/nuc/deploy.py`: `--backup` espera hasta 300s, falla con error
visible al agotarlo y su unidad admite 900s. `--auto` conserva su skip/reintento.
Instalar ese helper root es una operación manual independiente; Git no lo cambia.

Bootstrap primero valida el JSON efectivo antes de `up`; las redes/sidecars deben
estar ya provisionadas cuando se habilite SpecOps. El controlador recupera los
contenedores existentes tras reinicio mediante `compose start`, conservando sus
IDs y sin PC. No afirmar persistencia instalada a partir del manifiesto de este PR.
Con `dev.env` ya preparado y plantilla/TLS revisados, renderizar de forma privada:

```bash
umask 077
docker compose --env-file dev.env -p cebo-pemento-dev -f compose.yaml config --format json > /RUTA_PRIVADA/config.json
python3 /usr/local/libexec/cebo-pemento-dev/validate-dev.py --config /RUTA_PRIVADA/config.json --directory /opt/servicios-dev/cebo-pemento --mode lan --guards
```

Solo después del bootstrap/gate autorizados arrancar los servicios DEV. Crear
cuentas ficticias con contraseña exclusiva mediante la CLI `exec app-dev … admin`.
Nunca copiar usuarios/bases/config PROD. Para diagnóstico usar `ps`, `logs --tail`
y `stop` de ese proyecto, sin `down -v`, prune o cambios de permisos masivos.

## Pruebas y compatibilidad futura

`python3 -m unittest discover -s tests -p 'test_*.py' -v` cubre workflow/permisos,
mutaciones de proyecto/volúmenes, recursos, imagen, host/bind, guardias, CA y lock.
El smoke hosted prueba Docker real, TLS desde host, SAN incorrecto, budgets
cgroup reales, rechazo de conexiones a un servicio PROD sintético/host/Internet,
DNS externo y parada/arranque completo preservando IDs y el servicio sintético.
No modifica NUC ni usa datos privados. El job publish debe permanecer skipped.

Referencia consultada: servidor-casa PR #34, ADR-004 y host.py del SHA
`22a9d4e94184b83b0b07d28b26919bfc00d7a27f`, **solo lectura**. El perfil futuro usa
app `cebo`, proyecto `cebo-pemento-dev`, servicio `app-dev`, esquema conservado,
seals/compose_hash locales, redes/subredes de esta tabla y volumen prefijado.
El publicador confiable de `specops-candidate-v1`, actor/workflow SHA fijados,
prueba del digest publicado, atestación del workflow y PR de promoción siguen
pendientes en #3 hasta concluir la revisión central. No activar ni simular una
publicación de candidatos desde este PR.

## P2 de Claude: alcance y riesgo residual

**Workflow editable por un PR interno (4702647005).** La separación de jobs y
credenciales protege frente a dependencias/scripts comprometidos dentro del
workflow revisado. Un commit interno malicioso puede editar el propio YAML,
quitar el if/guard o pedir packages:write: este PR no constituye una barrera
contra ese cambio. En el modelo doméstico, autores internos son el administrador
y sus agentes, y ese riesgo residual se documenta; revisar cambios de workflows
con cuidado. Recomendar aprobación de ejecución de colaboradores externos y
protección de ramas/workflows si disponibles, sin afirmar que se hayan aplicado
settings ni exigir otro servicio/plan. La aprobación PROD por cuenta GitHub del
administrador es la decisión vigente; no prueba presencia humana independiente.

Durante la transición, el actualizador legacy consulta la etiqueta sha-main y
puede consumir una publicación adelantada. Antes de integrar/activar, pausar y
enmascarar `cebo-pemento-update.timer` con autorización local, conservar el backup
diario con espera/fallo visible y completar transición SpecOps. **No reactivar
el timer de imágenes antiguo después de la transición.** SpecOps selecciona
por digest y evidencia del publicador fijado en root; esto evita depender de
etiquetas, no convierte en infalible a un administrador/workflow malicioso.
ADR-004 se ha consultado solo en lectura; su actualización central corresponde
a #34 cuando termine la revisión, no a este PR. No se inicia #3.

**Publicación no ejecutada en PR (4702647018).** Ahora test-image hace la misma
copia `skopeo copy --all --preserve-digests` a `registry:2.8.3` efímero en loopback,
sin login ni credenciales. Verifica digest del índice remoto, manifest AMD64 y
manifests de atestación/SBOM. El registro usa tmpfs y se elimina al terminar; no
hay servicio nuevo persistente. `publish` sigue skipped, sin escritura GHCR ni
artifact candidato en PR. No se prueba con ello autenticación/ACL ni el servicio
GHCR real: esa parte sigue pendiente de la publicación main autorizada.

## Entrega para revisión independiente

Claude debe obtener el HEAD real del PR #2, revisar el diff y ejecutar:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 -m compileall -q scripts/dev-certificates.py scripts/validate-dev.py tests
for script in scripts/*.sh deploy/dev/preflight.sh; do bash -n "$script"; done
npm run typecheck && npm test && npm run build
npx playwright test
```

Revisar CI del **mismo SHA**: renovación TLS realmente servida por Caddy usando
la CA anterior, IDs/imagen/volumen conservados, guardias/cgroups, OCI remoto con
mismos digests y publish skipped. Comprobar 30 días de aviso sin fallo temprano,
aviso de CA, expiración real, renovación de hoja caducada y ausencia de claves
CA en bundle/contexto/artifacts. Ataques: CA ajena, key mismatch, restricciones
ampliadas/ausentes, SAN ajeno, symlink/hardlink, permisos inseguros, firma fallida
y destino existente. Solo revisar #34/ADR-004: no editar esa rama, no instalar,
no fusionar ni desplegar. Este PR sigue draft hasta revisión y transición local.
