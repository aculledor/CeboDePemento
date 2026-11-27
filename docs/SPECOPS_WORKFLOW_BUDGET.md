# P2: margen de mantenimiento de los workflows SpecOps

Responde a la revisión conjunta de Claude sobre Servidor Casa #41 (`98c5a7c`)
y CeboDePemento #6 (`923a74a`): publicadores a 291 y 159 bytes del límite root.
Se conservan ramas, bases `review/specops-issue-40` y PR en borrador. Este cambio
no fusiona, publica, cambia variables ni accede al NUC. La arquitectura y el wire
v1 siguen iguales; la publicación GHCR real sigue pendiente de autorización.

## Resultado (bytes UTF-8 del YAML completo)

| Publicador | Antes | Ahora | Reducción | Reducción % | Margen hasta 128 KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Portal | 130.781 | 72.468 | 58.313 | 44,59 % | 58.604 |
| Cebo | 130.913 | 72.600 | 58.313 | 44,54 % | 58.472 |

Presupuesto de mantenimiento: **96 KiB = 98.304 bytes**, comprobado al generar
y mediante pruebas automáticas para ambas apps. Una generación que lo supera se
rechaza antes de escribir el publicador. Quedan al menos 32 KiB hasta el límite
independiente de **128 KiB = 131.072 bytes** del reconciliador; no se modifica
`specops/github.py`, su límite, la comprobación del blob ni el resto del motor.

## Qué cambia y qué permanece idéntico

Antes, `render.inline(config, mode)` ignoraba mode e incluía tres veces el productor
completo en el publicador, con promoción/integración y las ramas de otros modos.
Ahora `specops_delivery/bundle.py`, **solo durante la generación**, selecciona:

| Modo | Caminos de protocolo incluidos |
| --- | --- |
| verify | Procedencia, consulta de candidato previo, descarga/checksum/ZIP, OCI y ensayo aislado |
| fetch | Nueva procedencia/descarga/checksum/OCI y vinculación a los outputs verificados |
| candidate | Nueva procedencia, comparación de digest remoto/verificado y wire estricto |
| prepare | Candidatos confiables, recibos y preparación idempotente de promoción |
| integrate | Gate administrativo, recibo/documento, procedencia e integración idempotente |

Se especializan únicamente los condicionales del dispatcher que se pueden resolver
con el modo fijo del step. Se exige que SPECOPS_MODE coincida antes de usarlo. No
se evalúa ningún código para decidir ramas: se analizan literales/comparaciones y
se conservan expresiones desconocidas y su cortocircuito. Los scopes internos no
se especializan; una reasignación de mode se rechaza durante generación. El AST
identifica las dependencias transitivas y symtable distingue nombres globales de
variables locales con igual nombre. Declaraciones/imports no soportados fallan.

Las funciones, clases y constantes conservadas se emiten directamente del texto
fuente original, incluidos sus decoradores y comentarios internos. Solo se imprime
el dispatcher especializado como Python normal. Se mantiene el orden de las
declaraciones, se deduplican imports y se incluyen las clases completas como unidad
auditable. **producer.py, diagnostics.py y ci.py no cambian.** El código fuente
completo sigue disponible y legible para revisión.

El YAML contiene Python plano autocontenido, con separadores que identifican su
fuente. No hay compresión, minificación, exec/eval/loader, código obtenido de GitHub
o imports de módulos locales durante la ejecución privilegiada. El compilador no
se incluye en el runtime. No se añade dependencia externa mutable: ast y symtable
son stdlib y se usan solo para generar. La configuración queda literal en el YAML.

La repetición necesaria de procedencia/metadata entre verify, fetch y candidate se
conserva: son revalidaciones de seguridad en sus fronteras, no se sustituyen por un
módulo mutable compartido entre steps/jobs. No se colapsan verify/publish ni se
traslada ejecución de imagen al job packages:write. Este último no contiene el
ensayo `test_digest`. Se conservan umask/authfiles, diagnósticos allowlist, actores,
repo/PR/SHA/tree/workflow/intento, freeze/scopes, checksums, digest, labels, salud,
aislamiento y límites de recursos. Las condiciones y permisos de los jobs no cambian.

## Pruebas y readback

`tests/test_specops_bundle.py` comprueba:

- YAML de **ambos** publicadores <=96 KiB y margen >=32 KiB, más rechazo de una
  generación deliberadamente sobredimensionada. El límite root sigue en 128 KiB.
- Dependencias de cada modo: promoción/integración ausentes de los publicadores;
  ensayo de imagen solo en verify y wire/creación solo donde se utilizan.
- AST idéntico al fuente para cada función/clase/constante conservada, excluyendo
  CONFIG literal y main especializado. Sin imports relativos ni loader en runtime.
- Equivalencia de efectos, outputs, archivos y diagnósticos entre el main original
  y el generado para los cinco modos: despacho manual/workflow_run, duplicados,
  credenciales sintéticas, rechazo de repos/ref/intento/origen/digest incorrectos,
  preparación e integración por evento/periódica. Un modo distinto queda bloqueado.
- Conservación de cortocircuito/efectos de expresiones desconocidas y scopes con
  otro parámetro mode; rechazo de reasignaciones en el dispatcher.

Las suites existentes vuelven a cubrir procedencia, ZIP, checksum, digest, freeze,
redirecciones, aislamiento, redacción, permisos e idempotencia. Las pruebas de
render siguen exigiendo igualdad byte a byte con los YAML versionados.

`tests/specops_readback.py` carga **el mismo texto del bundle verify generado** en
el job de solo lectura y ejecuta sus funciones contra los ZIP reales disponibles
Portal `45903242249` y Cebo `45903253447`. Mantiene el control negativo del authfile
implícito, luego verifica digest/salud con el authfile privado explícito; no genera
candidato ni publica. No se falsean GITHUB_REF ni attempt. El ensayo sigue limitado
a las bases de revisión y a esos insumos de siete días. Los enlaces de CI de los
SHA finales y la respuesta individual al P2 quedan en ambos PR.

## Blobs propuestos finales de esta revisión

| Workflow | Blob tras issue #40, antes de P2 | Blob después de P2 |
| --- | --- | --- |
| portal-specops.yml | `8c453ca3f70f6623e4b96c19cdb8d2f835f72025` | `0776125b109c42732c14152486677c613dbafb04` |
| cebo-specops.yml | `a1b14a00b38a0fac5af2f46ce306afaeb3b3674f` | `5c5eac3fc1ef6700dde71aa34295ed0fc4aa3fcb` |
| specops-integrate.yml | `7fca7b9c35ce3a097e08e99bf54b7d64a1b0cc8a` | `3d323777cf4b771dc1c2f486f139f8f3808b053e` |

Se actualiza también la tabla de blobs propuestos del documento del incidente;
las copias actuales de las ramas de promoción no se modifican. La secuencia de
dirección sigue pendiente: desactivar REAL_PUBLICATION en ambos repos **antes**
de retargetar a main, conservar RELEASE_AUTOMATION desactivado, revisar/fusionar
solo con el propietario, recalcular blobs sobre el árbol final y usar esos blobs
auditados al crear los perfiles. Si ya existiera evidencia aceptada bajo una
allowlist anterior, conservarla conforme al contrato. Actualizar solo el integrador
en ambas bases de promoción preservando release/baseline; renovar HEAD y CI de #39
y Cebo #5 antes de la primera publicación autorizada. Este agente no realiza esos
pasos, no crea perfiles ni cambia flags. No se reabre esa decisión de arquitectura.

Para la última revisión diferencial de Claude: comenzar por bundle.py/render.py y
las pruebas de equivalencia; comparar que los módulos de protocolo no cambiaron,
comprobar las ausencias por modo y los YAML planos, tamaños/blobs y readback de los
SHA finales. Regeneración y comprobaciones:

```bash
python3 -m specops_delivery.render portal .   # servidor-casa
python3 -m unittest discover -s tests -p 'test_specops*.py' -v
wc -c .github/workflows/portal-specops.yml
git hash-object .github/workflows/portal-specops.yml .github/workflows/specops-integrate.yml
# En CeboDePemento:
python3 -m specops_delivery.render cebo .
python3 -m unittest discover -s tests -p 'test_specops*.py' -v
wc -c .github/workflows/cebo-specops.yml
git hash-object .github/workflows/cebo-specops.yml
```

No cambiar variables o bases para probarlo. Si la revisión cambia el contenido,
regenerar y actualizar tamaños/porcentajes/blobs antes de fijar confianza root.
