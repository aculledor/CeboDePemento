# Importador incremental de pescadeRías

## Auditoría y límite de la verificación

Se han leído LEEME, requisitos/plan actualizados, esquema, seed y ambos JSON, y recuperado la implementación de `codex/web-pesca-v0.1.0` sobre una rama creada desde `origin/main` (`eb94532`). No existía AGENTS.md en este proyecto. Se reutilizan el editor, las revisiones, permisos, auditoría y almacenamiento de fotos existentes. La rama es `feat/catalogo-pescaderias-xunta`; no se ha fusionado ni desplegado.

El SQLite original conserva su hash `ca421f5e08634e5293c0234c915ecb8aac4dde7141111059215d03762498f796`: 932 taxones, 2.821 nombres, 1.003 evidencias y 37 asociaciones de plantillas. Se abre solo en lectura y se migra una copia de trabajo. La migración 0006 añade tablas, sin modificar tablas originales ni migraciones aplicadas. No se ejecuta seed.sql sobre una base existente.

El 29/10/2026 el proxy del entorno devolvió **403 CONNECT** al solicitar `https://deondesenon.xunta.gal/robots.txt`. La política observada seguía restringida, aunque el usuario comunicó haber habilitado Internet. No se obtuvo robots, aviso legal, HTML de fichas ni permisos verificables; **no se ejecutó una importación real ni se descargaron imágenes de esta fuente**. No se eludió el bloqueo. Los fixtures HTML del repositorio están identificados como sintéticos: validan el contrato del parser, no compatibilidad comprobada con el sitio real. La primera ejecución autorizada debe revisar y ajustar selectores contra las páginas reales antes de una importación completa. No declarar completo el catálogo ni autorizada una ilustración.

## Fases implementadas

1. Auditoría y protección de originales.
2. Modelo: ejecuciones, observaciones, versiones inmutables, IDs externos, conflictos, campos manuales, referencias de medidas, textos con permisos y candidatas de imágenes.
3. HTTP/HTML: Cheerio, descubrimiento desde categorías/paginación, enlaces de idioma descubiertos, robots-parser, pausas mínimas 1,5 s, timeout 20 s, tres intentos con backoff para fallos transitorios, límite 2 MB por página. 401/403/CAPTCHA paran sin insistir; las redirecciones exigen revisión. Solo HTTPS en el dominio exacto, sin puertos ni credenciales. Nunca se automatiza un navegador para eludir restricciones.
4. Conciliación y transacción con backup consistente previo. Los nombres comunes solo generan candidatos. Científico/FAO/sinónimos deben ser inequívocos y coherentes con categoría e identidad. `spp.`, lorcho y otros genéricos no se convierten en una especie. Los IDs internos no se reemplazan; una asociación existente no se reasigna silenciosamente.
5. Revisión administrativa gl/es: filtros por coincidencia/estado, versiones, errores, diferencias, asociación explícita, nuevas especies, permisos de imágenes y referencias de medidas. El editor existente permite alias, taxonomía, textos y fotos; conserva prioridad manual. Las nuevas entradas permanecen ocultas hasta su activación editorial.
6. Pruebas aisladas y documentación. Pendientes: HTML real, condiciones y una ejecución real con comparación posterior.

## Primer uso autorizado desde Windows o Linux

Preparación de desarrollo: Node 24, `npm ci`, `npm run setup`. No hace falta crear un usuario para importar metadatos por CLI. Sí hace falta un administrador para descargar imágenes autorizadas. En Docker se usa la CLI compilada: `node apps/api/dist/pescaderias/cli.js` en lugar de `npm run catalog:import --`.

Inspección sin abrir ni modificar SQLite:

```bash
npm run catalog:import -- inspect --cache work/pescaderias/revision
```

Guarda robots, página de entrada y avisos legales enlazados. Revisa `inspection.json` y los archivos privados `pages/*.json`. Cada página conserva URL, fecha y SHA-256. Si la página no enlaza condiciones suficientes, obtén la autorización del titular antes de continuar. No basta con que robots permita acceso: tampoco concede derechos de reutilización.

`policy.example.json` se genera **sin permisos**. Tras verificar realmente las condiciones, cópialo a `policy.json` y completa:

```json
{
  "reviewedBy": "Nombre de quien ha comprobado las condiciones",
  "reviewedAt": "2026-10-29T12:00:00.000Z",
  "automatedAccessAllowed": true,
  "metadataReuseAllowed": true,
  "descriptionsReuseAllowed": false,
  "imagesReuseAllowed": false,
  "evidence": [{"url": "URL HTTPS real del aviso", "sha256": "HASH REAL DE 64 CARACTERES"}],
  "notes": "Fundamento y alcance concreto de la autorización verificada."
}
```

Este ejemplo no constituye permiso y sus marcadores no pasan la validación. Usa las URL y hashes reales de la inspección. Sin permiso de textos no se guardan ni publican los textos descriptivos extraídos, solo metadatos/enlaces. El HTML de consulta se conserva privadamente para reproducibilidad, nunca se sirve por la API. No subas cachés, políticas privadas o backups a Git.

```bash
# Probar solo tres fichas de peces. SQLite permanece en solo lectura.
npm run catalog:import -- import --resume work/pescaderias/revision --policy work/pescaderias/revision/policy.json --category fish --limit 3 --dry-run

# Inspeccionar checkpoint.json, campos extraídos, medidas y propuestas antes de aplicar.
# Aplicar exactamente el lote guardado, sin nuevas consultas de las fichas:
npm run catalog:import -- import --resume work/pescaderias/revision --policy work/pescaderias/revision/policy.json --from work/pescaderias/revision/checkpoint.json

# Todas las categorías admitidas, usando el mismo cache para continuar:
npm run catalog:import -- import --resume work/pescaderias/revision --policy work/pescaderias/revision/policy.json --category all
npm run catalog:import -- results
npm run catalog:import -- conflicts
```

Categorías válidas: `fish`, `cephalopod`, `crustacean`, `all`. No se recorren bivalvos, gasterópodos, equinodermos, algas o antozoos. Las categorías son puntos de entrada; cada enlace de ficha se descubre del HTML. Límite de seguridad 1.000 fichas y 100 páginas de categoría. Cero fichas encontradas o campo científico no reconocido exige revisar el HTML, nunca se interpreta como catálogo vacío válido.

`--resume DIRECTORIO` reutiliza páginas completadas y checkpoints; una interrupción de red no modifica taxones. La aplicación del lote es atómica: un error SQL revierte el lote entero y marca la ejecución fallida. Se puede volver a aplicar el checkpoint. Un corte abrupto durante una transacción deja SQLite encargado del rollback. En una revisión posterior de la fuente usa una **nueva carpeta de inspección** para consultar páginas y condiciones de nuevo, en vez de reutilizar indefinidamente el cache anterior. Las observaciones conservan cuándo se consultó cada versión. Una segunda aplicación del mismo contenido no crea especies, referencias, conflictos ni cambios editoriales nuevos; sí registra la nueva ejecución/observación y su backup.

El resumen distingue encontradas, procesadas, nuevas, actualizadas, coincidencias, sin cambios, conflictos, errores, medidas e imágenes autorizadas/pendientes. `results` y `conflicts` consultan solo lectura. `--database RUTA` permite seleccionar otra base de trabajo sin tocar el original. Nunca se eliminan taxones porque desaparezca una ficha.

## Medidas, textos e imágenes

Las referencias conservan literal, valor nullable, unidad cm/mm/g/kg, método nullable, ámbito, URL, fecha, revisión y autor/editor. No se interpreta falta de dato como ausencia de mínimo. El mínimo en gramos del pulpo no se transforma en centímetros. Los métodos de manto y cefalotórax quedan separados de longitud total.

Aprobar una referencia no la aplica automáticamente a ligas. La opción explícita «aplicar como referencia actual» solo admite longitud total cm/mm, o ausencia de mínimo confirmada expresamente por el administrador. Otros métodos quedan disponibles como referencia pendiente de ampliación del motor. Se mantienen los snapshots de capturas y reglas históricas; no se alteran sus asociaciones o puntuaciones desde el importador.

Una imagen sin licencia/autoría verificables permanece candidata; el panel no la muestra remotamente ni descarga sus bytes. Cada archivo requiere evidencia concreta. Las que tienen autorización revisada y licencia abierta explícita pueden descargarse con:

```bash
npm run catalog:import -- images --actor admin
```

También `import --download-images --actor admin`. Se usa el pipeline existente Sharp (JPEG/PNG/WebP, máximo 8 MB/40 Mpx, sin animación): WebP de hasta 1.600 px, miniatura de 360 px y eliminación de EXIF. Se conserva atribución, licencia y procedencia. **Nunca se cambia la imagen principal**: se incorpora a la galería y un administrador elige. La selección manual existente continúa intacta. Para una candidata pendiente, el panel exige autor, URL de licencia abierta y evidencia del permiso. Si cambia la licencia/autor de origen, se genera un conflicto y se bloquea una descarga aún no aprobada.

El editor ofrece búsqueda real en Wikimedia Commons/iNaturalist y subida manual. No se inventan imágenes ni traducciones. El descargador solo admite hosts explícitos y rechaza redirecciones; si la fuente usa otro CDN, habrá que revisar y añadir ese host de forma expresa, sin ampliar indiscriminadamente la allowlist.

## Trazabilidad y API

`import_records` mantiene la versión actual; `import_record_versions` conserva contenidos anteriores y `import_observations` las consultas. `external_taxon_ids` conserva fuente/ID/FAO/URL → ID interno. `catalog_manual_fields` protege también vacíos intencionados; se inicializa conservadoramente con auditorías manuales anteriores. Los conflictos se cierran con decisión, motivo, actor y fecha. Los cambios aparecen también en el historial del taxón. Los textos permitidos quedan diferenciados del perfil editado manualmente.

Rutas nuevas: `GET /api/admin/imports/runs`, `GET /api/admin/imports/records`, `GET /api/admin/imports/records/:id`, `POST …/:id/review`, `POST /api/admin/imports/conflicts/:id/resolve`, `POST /api/admin/imports/sizes/:id/review`, `POST /api/admin/imports/images/:id/approve|reject`, y `GET /api/catalog/:id/size-references` / `POST /api/admin/catalog/:id/size-references`. Las escrituras aplican autenticación, rol, CSRF, revisiones e idempotencia del proyecto. La UI necesita confirmación del servidor, sin cola offline.

Pruebas: `npm test`, `npm run typecheck`, `npm run build` y `npm run test:browser`. Todos los datos de prueba usan bases temporales; los fixtures no se importan a la base de uso.
