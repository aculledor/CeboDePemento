# Issue #40: verificación real de los publicadores

Implementación para revisión independiente de Claude. No se ha accedido al NUC,
fusionado PR, cambiado variables/secrets ni publicado candidatos reales. Servidor
Casa #39 y CeboDePemento #5 permanecen abiertos y con sus HEAD originales.

## Causa acreditada y reproducción

Los publicadores manuales Portal `45907738865` y Cebo `45907744235` fallaban en
`verify`, no llegaban a `publish` y solo emitían un mensaje genérico. La prueba
read-only de este cambio ejecuta **el código original** contra sus insumos reales:

| App | PR fuente abierto | CI origen | Artefacto ZIP | SHA-256 ZIP API y descargado |
| --- | --- | --- | --- | --- |
| Portal | #39, `081daae92adff6a31ef741e504aa589e6c04957f` | 45903242249 | 15157040790 | `0f499c31236ad94378218b2f9decbfbc9350348c9293b1d08aa0547c0ad8c621` |
| Cebo | #5, `894383e439633eb73f7e5341f1b2a995ed5b2983` | 45903253447 | 15156906792 | `c3e1febdf6a574fb9d37fa97cd0c62a1e805c91681130056ccbdb02e0abfa049` |

Se comprobaron identidad/repositorio/workflow/PR/SHA/tree y CI vigente; consulta
de candidatos (sin uno anterior), metadata de build, HTTP 302 de GitHub seguido
de 200 del almacenamiento autorizado, checksum, ZIP con un único `image.oci.tar`
e inspección OCI/plataforma/labels. Todos pasan en ambos repositorios. No se
atribuyó el problema a permisos GITHUB_TOKEN, procedencia ni checksum por conjetura.

La copia **skopeo → registro loopback** falla inmediatamente. Los ensayos sin
corrección clasifican su stderr solo en memoria como `credential-file` y
`permission-denied`, sin imprimirlo. La reproducción posterior identifica también
`default-runtime-credential-file`: búsqueda implícita de `auth.json` bajo
`/run/containers/`, no legible para el usuario no privilegiado. `run()` construye
un entorno mínimo sin XDG_RUNTIME_DIR; containers/image usa la ruta de runtime
por UID cuando falta esa variable. Véase el código primario
[containers/image, pkg/docker/config/config.go](https://github.com/containers/image/blob/main/pkg/docker/config/config.go),
`getAuthFilePaths`/`getPathToAuth` y `defaultPerUIDPathFormat`.

Las pruebas antiguas de loopback ejecutadas con sudo no detectaban esta dependencia:
root podía consultar el archivo. El job real de verify funciona como el usuario
del runner. Instalar skopeo no concede acceso a credenciales root ni debe hacerlo.

Evidencia saneada previa a la corrección:

- [Portal: reproducción read-only](https://github.com/aculledor/servidor-casa/actions/runs/45909205829),
  [subcomando aislado](https://github.com/aculledor/servidor-casa/actions/runs/45909408889),
  [clasificación de permisos](https://github.com/aculledor/servidor-casa/actions/runs/45909698225).
- [Cebo: reproducción read-only](https://github.com/aculledor/CeboDePemento/actions/runs/45909214561),
  [subcomando aislado](https://github.com/aculledor/CeboDePemento/actions/runs/45909414281),
  [clasificación de permisos](https://github.com/aculledor/CeboDePemento/actions/runs/45909705505).

Corrección comprobada con esos mismos ZIP, sin reconstruirlos:
[Portal](https://github.com/aculledor/servidor-casa/actions/runs/45910106790) y
[Cebo](https://github.com/aculledor/CeboDePemento/actions/runs/45910111348).
Los PR incluyen además el resultado de CI de sus SHA finales.

## Corrección y frontera de confianza

`test_digest()` crea `loopback-auth.json` exclusivo, 0600, dentro del directorio
privado del ensayo, con exactamente `{"auths":{}}`. **Ambos** comandos remotos
skopeo de la prueba (`copy` e `inspect`) reciben explícitamente `--authfile`.
La dirección del registro sigue limitada a `127.0.0.1:PUERTO`; TLS desactivado
solo en ese transporte loopback como antes. No se consultan credenciales implícitas,
no se lee/cambia/chmod el archivo del runner y no se eleva verify a root.

El authfile de GHCR en el job de copia con packages:write sigue separado e intacto:
login efímero, copia `--all --preserve-digests`, cotejo remoto del digest y borrado
de esa credencial. Nunca se ejecuta imagen/código PR en ese job. La aplicación de
prueba sigue sin red/capabilities, UID1000, raíz read-only y límites de recursos;
los subprocesos no heredan GH_TOKEN/GITHUB_TOKEN. Se vuelven a comprobar digest,
RepoDigests, plataforma, labels y salud. No cambia el wire v1, el freeze de esquema,
los scopes, intentos, identidades ni ninguna validación para aceptar el resultado.

Se revisó `specops/github.py`: su ruta de metadata/redirect/checksum equivale a
las etapas que la reproducción real demuestra correctas. El motor central no
utiliza este ensayo skopeo ni depende de ese authfile. **No se cambia su cliente
API ni el código root por una hipótesis equivalente no acreditada.** `ci.py` se
mantiene idéntico entre motor y productores.

## Diagnósticos seguros

`specops_delivery/diagnostics.py` contiene vocabularios explícitos de etapas y
rechazos, embebidos en cada workflow generado. Los errores Python exponen únicamente
`protocol`, `result`, `stage`, `context` y `code`. Se distinguen procedencia,
consulta API, candidatos, metadata/descarga/checksum/extracción, OCI index/config,
registro, pull/arranque/salud/identidad y promoción/integración. HTTP conserva solo
códigos numéricos de la allowlist. Un fallo de credenciales de runtime se clasifica
como `credential-file-permission` mediante coincidencias fijas en memoria.

JSON inválido, estructura inesperada, timeout, IO o excepciones desconocidas
obtienen códigos constantes. No se imprime la excepción, traceback, stderr/stdout
del subproceso, argumentos, headers, URL firmada, token, fichero, contenido del PR
ni de la aplicación. No se serializa una excepción para un artifact de diagnóstico.
Login/copy/inspect del job GHCR tampoco imprimen salidas de skopeo: emiten
solo stage/code fijos; el cotejo del digest remoto se mantiene y su JSON local
usa umask077. Una prueba ejecuta esos scripts con comandos sintéticos fallidos
y verifica redacción, rechazo y el digest de la ruta correcta.
Las pruebas introducen sentinelas privados en todos esos campos y verifican que
no aparecen en el registro emitido; comprueban también contexto/code falsificados.

## Regresión y CI sin publicación

Las suites normales de ambos repositorios ejecutan las nuevas pruebas offline:
authfile vacío/0600 en copy e inspect, digest y aislamiento conservados, permisos,
redirecciones sin Authorization fuera de GitHub, hosts prohibidos, checksums
incorrectos, timeout y redacción. Se mantienen los negativos de PR/SHA/repos/actor/
workflow, freeze, procedencia tras merge y repetición del integrador.

`specops-readback.yml` es un **ensayo de incidente** de solo lectura, activado solo
para PR con base `review/specops-issue-40`. Usa los dos artifacts reales de siete
días de este bootstrap; la expiración o cambio de su PR debe bloquear ese ensayo,
no omitirse ni usar evidencia falsa. No se convierte en una dependencia permanente
de todos los futuros PR tras caducar esos insumos. La regresión offline queda en
las suites normales. El driver nunca se hace pasar por un publisher de main ni
falsifica GITHUB_REF/attempt: llama funciones de lectura/ensayo, sin candidate.json.

Se ejecuta sin sudo, con contents/actions/pull-requests read y checkout sin
credenciales persistentes. Reproduce primero el acceso implícito fallido (incluido
un authfile sintético no legible en un HOME temporal propio) y exige ese rechazo;
después verifica el mismo OCI por el authfile explícito, salud y digest sin cambios.
Las pruebas de fallo, seguidas de éxito, no son una relajación de validaciones.
Los archivos compartidos y el driver/test son iguales byte por byte; regenerar con
`python3 -m specops_delivery.render portal .` o `cebo .` debe dejar los YAML limpios.
El límite root de 128 KiB por publicador sigue comprobado por las pruebas.

## Coordinación después de aceptación (no ejecutada)

Los PR de corrección salen del main real, pero se dirigen a ramas de revisión
copiadas de ese main: con REAL_PUBLICATION activo, un PR hacia main que cambia
el publicador pertenece al scope candidato. La base de revisión hace que el gate
existente `base=main` rechace su publicación; no se modifican flags. Dirección
retargetará/integrará cuando lo autorice, manteniendo #39 y Cebo #5 abiertos.

Los blobs Git propuestos son del **contenido completo** de cada YAML, no hashes
SHA-256 ni SHA de main:

| Fichero | Blob actual | Blob propuesto |
| --- | --- | --- |
| Portal `.github/workflows/portal-specops.yml` | `be84841ed312091b07129c526ffcb6ecfbd2c34c` | `8c453ca3f70f6623e4b96c19cdb8d2f835f72025` |
| Cebo `.github/workflows/cebo-specops.yml` | `6676cef09635ea672da40ba69e13a9751fde9e98` | `a1b14a00b38a0fac5af2f46ce306afaeb3b3674f` |
| Central `.github/workflows/specops-integrate.yml` | `f74c5bef9ead03587c05b548883a51fd08de8c83` | `7fca7b9c35ce3a097e08e99bf54b7d64a1b0cc8a` |

1. Claude revisa código, YAML inline, separación verify/publish y evidencia real.
   Dirección acepta y fusiona las correcciones; este trabajo no retargeta/fusiona.
2. En mantenimiento root autorizado posterior, **añadir** cada nuevo blob publicador
   auditado a `source.publisher_blob_shas` del perfil correspondiente. Conservar
   entradas antiguas que acrediten evidencia aceptada; no borrar journals/recibos
   ni sustituirlos por fixtures. No usar el SHA global de main. IDs/rutas y contrato
   permanecen iguales. No hace falta reemplazar el cliente API root por este fix.
3. Las dos ramas reales `specops-promotions/portal` y `specops-promotions/cebo`
   contienen todavía el integrador antiguo `f74c5b…` (comprobado por API). Preparar
   mantenimiento revisado de la **copia exacta** de `specops-integrate.yml` de main
   en ambas bases, antes de habilitar RELEASE_AUTOMATION. Conservar releases/baseline
   y demás datos; no sincronizar indiscriminadamente toda la rama ni crear una
   autorización de aplicación ficticia. Cambiar el HEAD de promoción revoca una
   autorización pendiente: comprobar ese estado en dicha ventana. Los preparadores
   portal/cebo también cambian de blob al incorporar diagnósticos; regenerarlos
   juntos, sin actualizar ramas de promoción desde este agente.
4. **Actualizar los HEAD de #39 y Cebo #5 al main corregido** mediante el mantenimiento
   autorizado de sus ramas abiertas, conservando sus números. El publicador está
   dentro de `candidate_paths`: reutilizar un candidato del árbol previo después
   de estos cambios daría `main-app-incompatible` al promover. No reducir scopes
   para eludir ese gate. El nuevo push generará otro CI/source SHA/tree/digest;
   no conservar etiquetas/recibos de un candidato anterior como si fueran nuevos.
5. Ese push, con REAL_PUBLICATION activo, puede iniciar la publicación real:
   realizarlo **solo cuando dirección lo autorice**. Exigir CI nuevo first-attempt
   de las nuevas cabezas. Tras cualquier cambio del publicador o required CI,
   crear un publisher run **nuevo**, attempt1, con el source_run vigente si hace
   falta despacho manual. No usar rerun/attempt2 de los fallidos ni el source_run
   viejo para fingir el árbol nuevo. No se despacha nada desde estos PR de corrección.
6. Revisar digest/candidate/recibo DEV con la nueva confianza antes de considerar
   promoción. RELEASE_AUTOMATION y PROD siguen desactivados en este trabajo.

Para comprobar blobs y coherencia sin credenciales ni NUC:

```bash
python3 -m specops_delivery.render portal .   # servidor-casa
python3 -m unittest discover -s tests -p 'test_specops*.py' -v
git diff --check
git hash-object .github/workflows/portal-specops.yml .github/workflows/specops-integrate.yml
# En CeboDePemento:
python3 -m specops_delivery.render cebo .
python3 -m unittest discover -s tests -p 'test_specops*.py' -v
git hash-object .github/workflows/cebo-specops.yml
```

Si los blobs cambian durante revisión, recalcular esta tabla antes de aceptar.
El rollback de código/allowlist requiere revisión del contenido anterior y conservar
la evidencia aceptada; no reactivar updaters legacy, borrar datos ni tocar PROD.
