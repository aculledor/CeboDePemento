# Web de pesca: decisiones confirmadas

## Entorno y acceso
React, TypeScript, backend Node.js y SQLite propuestos. Primero Windows 11 sin herramientas instaladas; posteriormente servidor Linux doméstico. Objetivo de 10–20 usuarios concurrentes. Una aplicación pequeña, sin microservicios.

Usuario y contraseña. Registro por invitación de un solo uso generada por el administrador. Recuperación mediante enlace temporal de un solo uso entregado por el administrador; no requiere correo automático inicialmente. Implementación futura: hash de contraseñas apropiado, cookies seguras, comprobación de permisos en backend, caducidad de invitaciones y recuperación y límites de intentos.

Todos los usuarios registrados ven perfiles, estadísticas, historial y ligas de otros usuarios. La ubicación respeta la elección por sesión: privada, zona general o exacta. No exponer coordenadas privadas mediante API, mapa, fotos con EXIF o estadísticas agregadas. No hay páginas públicas de datos personales.

## Idiomas
Interfaz y contenido en gallego y castellano desde el principio, selector persistente. Búsqueda simultánea en todos los nombres comunes y científicos. Ficha con nombres de ambos idiomas y científico en pequeño. No duplicar especies por alias o variantes de color. Traducciones faltantes explícitas durante la edición; no inventarlas.

## Sesiones y capturas
Sesiones individuales: propietario, inicio y fin con fecha y hora, zona o zona no indicada, privacidad, observaciones y capturas. Horario obligatorio; fin pendiente solo mientras la sesión está activa. Puede atravesar medianoche o varias jornadas. Cerrar navegador no cierra sesión. Sesiones sin capturas permitidas.

Cada lote pertenece a una sola sesión: especie o categoría sin identificar, timestamp real, cantidad positiva, cuántos dan talla, cuántos retenidos, peso total de todo lo capturado, longitud del mayor y peso individual del más pesado. Medidas y fotos opcionales. Mayor y más pesado pueden ser individuos diferentes. Validar cantidades contra el total y coherencia de medidas. Los retenidos pueden ser un subconjunto cualquiera: la aplicación no convierte un error o captura incidental en autorización legal.

Si hay talla mínima aplicable, es obligatorio indicar cuántos la cumplen. Si se ha verificado que no la hay, valor único definido en la liga. Si falta identificación suficiente, valor básico sin bonificación hasta identificar. Regla legal desconocida no equivale a ausencia de talla.

Capturas liberadas y retenidas puntúan igual. Registro retrospectivo permitido con fecha/hora reales y fecha de declaración separadas. Al añadir capturas olvidadas, vincular a sesión existente o crear sesión pasada, sin inventar horarios. Agrupar solo capturas cuya fecha/hora permita asignar correctamente jornada y competición; dividir lotes que crucen un límite relevante.

## Jornadas
Europe/Madrid. Jornada D desde D 06:00 inclusive hasta D+1 06:00 exclusive. Guardar instantes y conservar zona horaria. Construir límites de calendario local, no sumar siempre 24 horas: los cambios de hora requieren tratamiento correcto. Una liga del 1 al 31 incluye desde el 1 a las 06:00 hasta antes del día 1 del mes siguiente a las 06:00. Guardar además la fecha civil real.

## Ligas
Cualquier usuario crea ligas abiertas o por invitación. Fechas inicial/final, categorías biológicas y/o especies admitidas, participantes y reglas propias. Peces, cefalópodos y crustáceos se filtran por separado.

Simple: 1 por ejemplar admitido. Personalizada: grupos de especies y dos valores (sin talla/con talla) cuando corresponda; valor único por especie sin mínimo. Valor predeterminado para especies sin grupo y opción de admitirlas o excluirlas. Una especie no pertenece a dos grupos de puntuación en la misma liga. Ámbito de admisión y grupos de puntos son independientes.

Morralla/común/especial son plantillas, no categorías fijas. Cambiar plantilla no cambia ligas existentes. Una captura puntúa en todas las ligas aplicables de su propietario. Unirse más tarde incluye capturas anteriores dentro del periodo. Reglas y sesiones pueden corregirse incluso tras el cierre; recalcular resultados. Mantener historial de modificaciones para explicar cambios de puntos, sin moderación obligatoria de capturas propias.

## Sesiones para otro usuario
Se pueden presentar sesiones para otro usuario. Pendientes hasta que el propietario apruebe o deniegue; no suman puntos ni estadísticas mientras están pendientes. Propuesta de funcionamiento: propietario revisa/corrige al aprobar y controla ediciones posteriores. Autoría y aprobación auditables. No duplicar sesión entre cuentas.

## Sin conexión
Intentar enviar; si no hay conexión, cola local persistente y visible. Reintentar al recuperar conexión, al abrir la web y manualmente. No prometer ejecución mientras navegador esté cerrado. Identificador único por operación y deduplicación en servidor. Aislar cola por usuario; nunca enviar datos pendientes bajo otra cuenta. No eliminar operación hasta confirmación. Conflictos entre ediciones no se sobrescriben silenciosamente. Acceso inicial y recuperación de contraseña necesitan servidor.

## Estadísticas
Perfil propio detallado y página comunitaria: cantidades, pesos declarados, especies identificadas, evolución por jornada/temporada, longitud y peso récord, horas pescadas, jornadas, capturas/hora y especies exclusivas del grupo. Exclusiva significa registrada por un único usuario, no rareza biológica. No sumar doble tiempo de sesiones solapadas. No convertir medidas desconocidas en cero. Las categorías sin identificar no cuentan como especies únicas. Separar récords generales y por especie; indicar cobertura de pesos declarados.

## Pantallas
Acceso, perfil, ligas propias/disponibles, detalle/ranking, crear/editar liga, catálogo/buscador, ficha de especie, sesiones activas/pasadas, registro/cierre, pendientes de aprobar, estadísticas comunitarias, mapa, normativa y administración de invitaciones/catálogo.

## Pendientes de implementación
Este paquete solo implementa el catálogo inicial y sus plantillas. No contiene aún frontend, autenticación, sesiones, ligas, motor de puntos, sincronización ni despliegue. Completar inventario de especies y revisión normativa es trabajo independiente de construir esas funciones.
