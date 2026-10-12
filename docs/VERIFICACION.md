# Verificación de la entrega

Fecha: 12 de octubre de 2026. Entorno de ejecución Linux, Node 24.19.0, npm 11.9.0; Docker con Node 24 LTS. No se ejecutó sobre un equipo físico Windows/iPhone/Android.

## Comandos realmente ejecutados

- `npm install` y actualizaciones concretas de dependencias; lockfile incluido.
- `npm run build`, `npm run typecheck`, `npm test`, `npm run db:migrate`.
- `npm run dev` y consultas HTTP a React, al proxy y al catálogo real.
- `PLAYWRIGHT_CHROMIUM=/usr/bin/chromium npx playwright test` (tras compilar).
- `npm audit --json`: **0 vulnerabilidades conocidas** al terminar; se actualizaron Fastify Static y Drizzle para resolver dos avisos.
- `docker build` de la imagen final, con CA del proxy del entorno montada como secreto de build; no incluida en la imagen.
- `docker compose config --quiet` con dominio reservado de prueba para validar la configuración, sin publicar certificados o DNS.
- Contenedor de prueba ligado solo a localhost, bootstrap de administrador por CLI, login con Argon2 y cookies de producción.
- Recreación del contenedor usando el mismo volumen; acceso de nuevo con el usuario persistido y backup mediante CLI compilada.

## Resultado

**19 pruebas unitarias/integración aprobadas**, sin fallos. Comprueban:

- Copia segura, integridad/FK, checksum de migraciones y hash del original intacto.
- Búsqueda gl/es/científico con tildes, ID único, carga de las 932 fichas, alias sin pérdida y permisos de edición.
- CSRF/origen, invitaciones caducadas/de un solo uso, recuperación/revocación de sesiones e idempotencia por actor.
- Cambios simultáneos, auditoría, desactivación y duplicados científicos/alias.
- Fotografías reales convertidas a WebP, EXIF eliminado, aprobación/créditos, permisos y rechazo de URL privadas/SVG.
- Día 22:00–04:00, límites de 06:00 y días de 23/25 horas; duración histórica anterior a 1970.
- Lote de siete xurelos: 12 puntos personalizados y 7 simples, una captura en SQLite, entrada tardía y reglas corregidas.
- Aprobación de propuestas, edición retrospectiva, archivo lógico y recálculo.
- Referencia de talla histórica conservada salvo corrección explícita y puntuaciones decimales sin residuos.
- Horas solapadas, pesos desconocidos, especies exclusivas, zonas y privacidad del mapa.
- Bloqueo de escrituras tras timeout/fallo, backups de WAL y restauración de SQLite/fotos en destinos nuevos.

**1 prueba funcional de navegador aprobada** en Chromium, viewport **390 × 844**. Flujos: login, selector de idioma, catálogo, alias «xúrelo», sesión/lote, respuesta perdida después de escribir en servidor, reconciliación sin duplicados, cierre, clasificación simple, perfil, mapa y código de invitación. No hubo errores JavaScript ni desbordamiento horizontal en inicio/perfil. Se utilizó una base aislada; no se incorporaron registros de prueba a la base de uso.

**Docker final construido y arrancado**. API `/api/health` correcta, seis migraciones, catálogo 932/62/870. El login de prueba verificó `Secure`, `HttpOnly`, `SameSite=Strict` y ausencia de hash en la respuesta. El usuario siguió disponible después de recrear el contenedor con el volumen. El volumen/cuenta se usaron únicamente para QA y no forman parte del paquete entregado.

Base original SHA-256:

```text
ca421f5e08634e5293c0234c915ecb8aac4dde7141111059215d03762498f796
```

La copia de uso pasa integridad/FK y queda sin usuarios o capturas de prueba. SQL, JSON y PDF originales se conservaron.

## Archivos y decisiones

`apps/web`, `apps/api`, `packages/shared`: implementación funcional; seis migraciones; pruebas API y Playwright; scripts portables; `.env.example`, README y documentación; Dockerfile/Compose/Caddy. Git incluye commits locales de fase 0 e implementación, más documentación/despliegue. No se envió el código automáticamente al remoto.

Los avisos de anotaciones de comentarios de Zod durante build no impidieron compilar. La división por rutas evita un único bundle grande. No se instaló un servicio cloud obligatorio.

## Límites de esta verificación

- Las APIs Commons/iNaturalist devuelven bloqueo de política de red en este entorno. Se probaron sus adaptadores con fixtures y la subida manual con archivos; las imágenes reales iniciales siguen pendientes de aprobación/importación.
- Se verificó Leaflet y las fichas, no la disponibilidad externa de todos los tiles desde tu conexión.
- Las 21 zonas no recibieron coordenadas inventadas: la posición se añade mediante administración tras revisión.
- Windows 11, Safari/iPhone, Android real, DNS, HTTPS del dominio doméstico, router/túnel y acceso desde Internet requieren prueba en tu infraestructura. La imagen/guías están preparadas; no se declara ese despliegue efectuado.
