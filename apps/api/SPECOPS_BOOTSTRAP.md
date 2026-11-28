# Primer candidato SpecOps — cebo

Este documento pertenece al contexto de construcción para validar el primer candidato del entorno DEV persistente del NUC. No cambia lógica de aplicación, datos, esquema, migraciones, permisos, secretos ni configuración de producción.

Mantener este PR abierto mientras CI y el publicador preparan el digest inmutable. El bootstrap local debe verificar aislamiento, TLS, salud y recibo real de DEV. La promoción a PROD queda desactivada hasta completar los requisitos operativos y, después, requiere exclusivamente el merge administrativo del PR dedicado de promoción en servidor-casa.
