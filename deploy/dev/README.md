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
servidor de 30 días y su clave, de solo lectura, emitidos por una CA offline con
`nameConstraints` crítico para `cebo-dev.home.arpa` y exclusión de IPs.
La raíz tiene `pathlen:0`: no puede emitir intermediarias. La clave raíz nunca
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

Renovación: emitir una nueva hoja offline antes de 30 días, validar y reemplazar
solo los archivos revisados; actualizar sellos/reiniciar gateway mediante una
operación local autorizada. Es mantenimiento privilegiado de TLS, no un comando
por release de aplicación. No activar el entorno sin responsable de renovación.

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

El helper usa `/run/lock/cebo-pemento-dev.lock`. El contrato central todavía
coordina también el lock GitOps global: se conserva, sin editar PR #34 durante
su revisión. Para evitar backups perdidos por contención se corrige la copia de
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
`d91fa23f1a731aeef7c4129fce0553b1313a1e50`, **solo lectura**. El perfil futuro usa
app `cebo`, proyecto `cebo-pemento-dev`, servicio `app-dev`, esquema conservado,
seals/compose_hash locales, redes/subredes de esta tabla y volumen prefijado.
El publicador confiable de `specops-candidate-v1`, actor/workflow SHA fijados,
prueba del digest publicado, atestación del workflow y PR de promoción siguen
pendientes en #3 hasta concluir la revisión central. No activar ni simular una
publicación de candidatos desde este PR.
