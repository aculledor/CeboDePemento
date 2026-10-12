# Catálogo inicial de la web de pesca

Este paquete contiene una base SQLite real y su volcado SQL reproducible. Es una base de referencia inicial, NO un inventario exhaustivo validado de todas las especies de las rías y ríos gallegos. La aplicación web todavía no está implementada.

## Contenido y alcance

- `catalogo.sqlite`: base SQLite, sin usuarios ni capturas.
- `seed.sql`: estructura y datos, importables con SQLite.
- `schema.sql`: estructura vacía.
- `referencia_xunta.json`: 926 entradas comerciales de peces, cefalópodos y crustáceos de la guía oficial, sin filtrar geográficamente.
- `referencia_continental.json`: 22 entradas del anexo II de la ley de pesca continental de 2021, en castellano y gallego. Referencia de nombres, NO permiso vigente de pesca.
- `resumen.json`: recuentos comprobados.
- `REQUISITOS.md`: decisiones funcionales confirmadas.

Hay 932 entradas normalizadas de referencia (incluyendo categorías agregadas y nombres pendientes de revisión), no 932 especies locales verificadas. La vista `initial_catalog` selecciona 62 entradas iniciales procedentes de los requisitos, del PDF y de la referencia continental. La selección no garantiza presencia en cada ría o río, ni autorización para capturar. Las 870 restantes están en `pending_catalog`, separadas para revisión antes de mostrarlas como fauna local.

La categoría `fish` incluye peces continentales y marinos; `cephalopod` y `crustacean` están separadas. Son categorías de navegación, no tres rangos taxonómicos equivalentes. El catálogo puede ampliarse conservando identificadores internos.

## Nombres y búsquedas

La tabla `names` admite varios nombres por idioma. `search_key` está normalizado sin tildes y en minúsculas. Buscar en todos los idiomas, no solamente en el idioma de interfaz. No usar el nombre común como identificador: un mismo nombre puede referirse a varias especies.

La selección inicial tiene nombres gl/es. Hay 73 entradas de referencia con algún idioma sin nombre en la fuente; permanecen pendientes y NO se han completado con traducciones inventadas. Los nombres científicos importados pueden contener sinónimos o errores del catálogo original; `review_status=pending` deja explícita esa revisión pendiente. No usar `species_name` como garantía de nombre taxonómico aceptado: solo clasifica la forma del nombre importado.

Se conservan las grafías de fuente en `evidence`. Las equivalencias Liza aurata/Chelon auratus y Liza ramada/Chelon ramada, y la corrección de la errata «Dicentrarchus puntactus», están registradas para revisión. Maragota y pinto se vinculan a una sola entrada Labrus bergylta. Choupa a Spondyliosoma cantharus y rapante/meiga a Lepidorhombus whiffiagonis, según confirmación del usuario. Las entradas comerciales agregadas no se eliminan ni se hacen equivalentes a una especie concreta.

Lorcho, raya sin identificar, tiburón pequeño sin identificar y escacho sin identificar son categorías de registro. No cuentan como especies distintas en diversidad ni en especies exclusivas. No se ha identificado por defecto «tiburón pequeño» con un melgacho: eso necesita identificación del ejemplar.

## Puntuación

Las tablas scoring_templates y template_members son plantillas, no ligas activas. Cada liga debe copiar y gestionar sus propias reglas. Morralla 1/1, comunes 1/2, especiales 2/4. Lorcho, xarda y faneca son morralla. Choco y calamar usan la plantilla común; su categoría biológica sigue siendo cefalópodos.

Las reglas por ausencia de talla mínima son configuraciones de liga, no inferencias a partir de la base. `minimum_size_status=not_reviewed` NO significa que una especie no tenga talla mínima. No hay tallas ni autorizaciones legales verificadas en este paquete. Tampoco se han asignado puntos específicos no solicitados a raya, tiburón o crustáceos; usar las reglas predeterminadas de la liga cuando corresponda.

## Fuentes y pendientes

Guía oficial: https://www.pescadegalicia.gal/gl/guia-especies
Datos de esa guía: https://www.pescadegalicia.gal/rest/especies
Nombres continentales: https://www.xunta.gal/dog/Publicados/2021/20210115/AnuncioC3B0-110121-0002_gl.html y versión _es.html.

La guía oficial incluye comercialización de especies de otras regiones. No usar su disponibilidad, código comercial o ficha ampliada como prueba de presencia en Galicia. El anexo continental tampoco recoge toda la biodiversidad, solo un listado legislativo original. No se han descargado imágenes de terceros ni copiado descripciones de especies.

Para completar el encargo del catálogo local faltan: contrastar inventarios marinos y continentales, incorporar especies no comerciales, delimitar presencia en rías/ríos frente a mar abierto, revisar nomenclatura científica y nombres comunes, y comprobar legislación por zona, modalidad y fecha. Esto incluye crustáceos pequeños y otras especies que no aparecen en una guía comercial. No declarar el catálogo completo hasta realizar esas tareas.

## Uso técnico

SQLite puede abrir `catalogo.sqlite` directamente. Como alternativa, importar `seed.sql` en una base vacía. El usuario no necesita ejecutar ambos. Los datos pueden consumirse desde un backend Node.js; no exponer el archivo de base de datos al navegador.

Ejemplo de consulta:

```sql
SELECT DISTINCT t.id, t.scientific_name, t.category
FROM initial_catalog t JOIN names n ON n.taxon_id=t.id
WHERE n.search_key LIKE '%pinto%';
```

Validaciones realizadas: integridad SQLite, claves foráneas, pertenencia única a plantilla de puntuación, bilingüismo de la selección inicial y ausencia de duplicación de Labrus bergylta. Los recuentos incluyen agregados y nombres pendientes; no son estadísticas de biodiversidad.
