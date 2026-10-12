# Web de pesca: requisitos consolidados (12/10/2026)

## Entorno y acceso
Aplicación web **mobile first** (prioridad absoluta a uso en smartphone), React + TypeScript (Vite), backend Node.js/TypeScript (Fastify), SQLite (Drizzle ORM), Mapas Leaflet + OpenStreetMap. Primero Windows 11 sin herramientas instaladas; posteriormente servidor Linux doméstico. Objetivo de 10–20 usuarios concurrentes. Una aplicación pequeña, sin microservicios. Solo funcionamiento online. Interfaz en castellano y gallego.

Usuario y contraseña. Registro por invitación de un solo uso generada por el administrador. Recuperación mediante enlace temporal de un solo uso entregado por el administrador; no requiere correo automático inicialmente. Desde la primera versión con acceso externo: hash Argon2id de contraseñas, cookies HttpOnly/Secure/SameSite con protección CSRF cuando proceda, permisos aplicados en backend, invitaciones y recuperación con caducidad y límites de intentos. Inicio de sesión con Google opcional como ampliación posterior.

Todos los usuarios registrados ven perfiles, estadísticas, historial y ligas de otros usuarios. La ubicación respeta la elección por sesión: privada, zona general o exacta. No exponer coordenadas privadas mediante API, mapa, fotos con EXIF o estadísticas agregadas. No hay páginas públicas de datos personales.

## Idiomas
Interfaz y contenido en gallego y castellano desde el principio, selector persistente. Búsqueda simultánea en todos los nombres comunes y científicos. Ficha con nombres de ambos idiomas y científico en pequeño. No duplicar especies por alias o variantes de color. Traducciones faltantes explícitas durante la edición; no inventarlas.

## Sesiones y capturas
Sesiones individuales: propietario, inicio y fin con fecha y hora, zona o zona no indicada, privacidad, observaciones y capturas. Horario obligatorio; fin pendiente solo mientras la sesión está activa. Puede atravesar medianoche o varias jornadas. Cerrar navegador no cierra sesión. Sesiones sin capturas permitidas.

Cada lote pertenece a una sola sesión: especie o categoría sin identificar, timestamp real, cantidad positiva, cuántos dan talla, cuántos retenidos, peso total de todo lo capturado, longitud del mayor y peso individual del más pesado. Medidas y varias fotos opcionales por lote de captura. Mayor y más pesado pueden ser individuos diferentes. Validar cantidades contra el total y coherencia de medidas. Los retenidos pueden ser un subconjunto cualquiera: la aplicación no convierte un error o captura incidental en autorización legal.

Si la ficha tiene talla mínima/referencia registrada y revisada, al declarar captura es obligatorio indicar cuántos ejemplares cumplen esa talla; el usuario puede consultar el valor y marcar cuántos cumplen. Si se ha confirmado que no existe talla mínima aplicable para el criterio de la competición, el valor de esa especie será único según la liga. Si la talla todavía se desconoce, no se asumirá que no existe: se usará exclusivamente el valor básico configurado para la liga, sin bonificación por talla. Si la identificación es genérica o incierta, valor básico cuando la liga admita esa categoría; por defecto 1 punto. El catálogo de tallas no se presentará como una recopilación de normativa actualizada.

Capturas liberadas y retenidas puntúan igual. Registro retrospectivo permitido con fecha/hora reales y fecha de declaración separadas. Al añadir capturas olvidadas, vincular a sesión existente o crear sesión pasada, sin inventar horarios. Agrupar solo capturas cuya fecha/hora permita asignar correctamente jornada y competición; dividir lotes que crucen un límite relevante.

## Jornadas
Europe/Madrid. Jornada D desde D 06:00 inclusive hasta D+1 06:00 exclusive. Guardar instantes y conservar zona horaria. Construir límites de calendario local, no sumar siempre 24 horas: los cambios de hora requieren tratamiento correcto. Una liga del 1 al 31 incluye desde el 1 a las 06:00 hasta antes del día 1 del mes siguiente a las 06:00. Guardar además la fecha civil real.

## Ligas
Cualquier usuario crea ligas abiertas o por invitación. Fechas inicial/final, categorías biológicas y/o especies admitidas, participantes y reglas propias. Peces, cefalópodos y crustáceos se filtran por separado.

Simple: 1 por ejemplar admitido. Personalizada: grupos de especies y dos valores (sin talla/con talla) cuando corresponda; valor único por especie sin mínimo. Valor predeterminado para especies sin grupo y opción de admitirlas o excluirlas. Una especie no pertenece a dos grupos de puntuación en la misma liga. Ámbito de admisión y grupos de puntos son independientes.

Morralla/común/especial son plantillas, no categorías fijas. Cambiar plantilla no cambia ligas existentes. Una captura puntúa en todas las ligas aplicables de su propietario. Unirse más tarde incluye capturas anteriores dentro del periodo. Reglas y sesiones pueden corregirse incluso tras el cierre; recalcular resultados. Mantener historial de modificaciones para explicar cambios de puntos, sin moderación obligatoria de capturas propias.

## Sesiones para otro usuario
Se pueden presentar sesiones para otro usuario. Pendientes hasta que el propietario apruebe o deniegue; no suman puntos ni estadísticas mientras están pendientes. Propuesta de funcionamiento: propietario revisa/corrige al aprobar y controla ediciones posteriores. Autoría y aprobación auditables. No duplicar sesión entre cuentas.

## Funcionamiento exclusivamente online
No hay modo offline, cola de operaciones, IndexedDB para registros, sincronización diferida, service worker con lógica de guardado, ni edición de datos sin respuesta del servidor. Todas las operaciones de lectura y escritura necesitan conexión real con el backend. Una acción de guardado/edición/borrado/aprobación solo aparece como finalizada cuando la API responde confirmando el resultado. Si no hay respuesta o se detecta caída de conexión, mostrar aviso claro y bloquear nuevas acciones hasta recuperar conectividad y consultar el estado real del servidor. No usar únicamente `navigator.onLine` para determinar si la API está accesible.

Cuando el servidor haya podido guardar pero se pierda su respuesta, usar identificadores idempotentes por operación para no duplicar capturas durante una repetición manual tras verificar el resultado. No mostrar éxitos optimistas ni contabilizar puntos desde formularios sin confirmar.

## Catálogo editable y fotografías
El administrador puede crear, editar, activar/ocultar y revisar fichas de especies o categorías agregadas, sin alterar las claves/IDs usadas por capturas históricas. Campos editables: nombres principales y alias en gallego/castellano, nombre científico y sinónimos, grupo biológico, taxonomía de clase/orden/familia cuando esté disponible, identificación pendiente/resuelta, descripción de identificación y consejos, talla mínima/referencia en centímetros, estado de revisión de la talla (`pendiente`, `tiene valor`, `confirmada sin mínimo`), información adicional, foto principal, galería y referencias de procedencia. La aplicación no incluye un apartado de normativa.

El tamaño mínimo introducido manualmente se utiliza como referencia para la dinámica de puntuación y deberá conservar fecha/fuente/autor del cambio si se conocen, sin presentarlo como garantía de legalidad vigente. No inferir talla desde datos faltantes. Un cambio posterior de talla no cambia silenciosamente los datos que usuarios habían declarado; mostrar las modificaciones y permitir corregir los registros cuando proceda.

Fuentes recomendadas de imágenes: Wikimedia Commons como primera opción, iNaturalist como segunda, Openverse/GBIF como auxiliares, siempre con revisión de coincidencia taxonómica y licencia por archivo. Buscar por nombre científico aceptado y sinónimos; mostrar candidatos para aprobación manual; generar copias locales optimizadas (WebP y miniatura) y guardar `taxon_id`, `url_fuente`, `autor`, `licencia`, `url_licencia`, `fecha_descarga`, `estado_revision`, `es_principal` y cualquier modificación aplicada. Las imágenes subidas manualmente también requieren comprobación de derechos y atribución cuando corresponda. La imagen faltante se sustituye temporalmente por un marcador genérico, sin inventar una fotografía. No copiar indiscriminadamente imágenes del PDF (puede haber derechos de terceros).

## Mapa e información práctica
Mapas online con Leaflet + OpenStreetMap. Zonas y consejos de pesca a partir de la guía PDF como referencia editorial, adaptados a fichas de zona. Las zonas son editables desde administración. Sin mapas offline. Las coordenadas personales se ocultan o publican según privacidad por sesión; eliminar EXIF/GPS de fotos subidas antes de servirlas.

## Exclusiones expresas de la primera versión
No se desarrolla apartado de normativa, recopilación legal de vedas/cupos/autorizaciones, ni sistema de actualización normativa. No hay modo offline o sincronización de operaciones. No se exige autenticación con Google inicialmente: usuario y contraseña por invitación. No se declara que los 932 registros de referencia sean especies gallegas verificadas.

## Estadísticas
Perfil propio detallado y página comunitaria: cantidades, pesos declarados, especies identificadas, evolución por jornada/temporada, longitud y peso récord, horas pescadas, jornadas, capturas/hora y especies exclusivas del grupo. Exclusiva significa registrada por un único usuario, no rareza biológica. No sumar doble tiempo de sesiones solapadas. No convertir medidas desconocidas en cero. Las categorías sin identificar no cuentan como especies únicas. Separar récords generales y por especie; indicar cobertura de pesos declarados.

## Pantallas
Inicio con accesos rápidos, acceso/registro, perfil, ligas propias/disponibles, detalle/ranking, crear/editar liga, catálogo/buscador, ficha de especie, sesiones activas/pasadas, registro/cierre, pendientes de aprobar, estadísticas comunitarias, mapa con fichas de zona y administración de invitaciones/catálogo/fotos/tallas/zonas. Navegación principal inferior en móvil: Inicio, Sesión, Ligas, Especies, Perfil. Administradores: herramientas específicas de revisión. La pantalla de normativa se elimina.

## Pendientes de implementación
A fecha de actualización, el paquete solo implementa el catálogo inicial y sus plantillas. No contiene aún frontend, autenticación, sesiones, ligas, motor de puntos, buscador con fotografías, edición administrativa ni despliegue. Completar y revisar el inventario de especies y sus fotos es un trabajo independiente y paralelo al desarrollo de estas funciones. El fichero SQLite original no ha sido modificado por este documento.

## Decisiones de diseño adicionales aceptadas
- La taxonomía conserva la pertenencia básica pez/cefalópodo/crustáceo y admite familia, orden y clase para filtros futuros, sin exigir completar esos niveles inicialmente.
- Fotografías de capturas: cero, una o varias por lote; conservan autor/fecha y sin ubicación EXIF pública.
- Las ligas deciden si admiten taxones genéricos; si se admiten y no existe regla específica, se usa el valor básico predeterminado (inicialmente 1) sin bonificación por talla. Los taxones sin identificación específica no computan como especies únicas o exclusivas.
- En la liga simple, 1 punto por ejemplar admitido sin excepción. Las plantillas Morralla 1/1, Comunes 1/2, Especiales 2/4 solo se usan en ligas personalizadas.
- La información sobre zonas y especies es orientativa y editorial; no se añade módulo de normativa.
