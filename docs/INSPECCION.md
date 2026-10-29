# Inspección inicial

Repositorio base `5c26938`, actualizado mediante fast-forward al commit del usuario `eb94532` (PDF y requisitos históricos). No había código de aplicación.

## Archivos inspeccionados

Se leyeron los cuatro documentos iniciales (LEEME, encargo, requisitos actualizados, plan), los requisitos históricos añadidos y los JSON completos mediante parseo. Se inspeccionaron todas las tablas/vistas de SQLite, el esquema y el volcado SQL, importado en memoria para verificarlo. El PDF de 22 páginas se inspeccionó mediante metadatos y extracción completa de texto, conservada como trabajo temporal. Contiene 21 sectores editoriales (15 generales y 6 de A Illa), especies, montajes, nudos y créditos de imágenes. No se infieren coordenadas exactas a partir del texto.

SQLite: integridad `ok`, cero errores de claves foráneas; 932 taxa, 2821 nombres, 1003 evidencias, 4 fuentes, 3 plantillas, 37 asignaciones. 62 seleccionados / 870 pendientes. El SQL importado reproduce 932 entradas. Se preservan IDs, alias, niveles de identificación y grafías de fuente.

SHA-256 del original: `ca421f5e08634e5293c0234c915ecb8aac4dde7141111059215d03762498f796`.

No hay fotos importadas. No se inventan imágenes, traducciones, presencias locales, tallas o coordenadas. `REQUISITOS.md` pide offline/normativa, pero queda supersedido por los requisitos actualizados.

## Decisiones

Node 24 LTS, npm workspaces y scripts portables. `better-sqlite3` como driver de Drizzle, FK/WAL/busy timeout; copia inicial mediante VACUUM INTO desde conexión de solo lectura. Migraciones SQL con checksum, transacción y backup previo. API y frontend en el mismo origen (proxy Vite en desarrollo). Idioma como única preferencia local, sin almacenar registros de pesca en el navegador.

La máquina de ejecución es Linux. Se comprueban comandos portables y arranque aquí; la ejecución física en Windows 11 y en un móvil necesita verificarse en los dispositivos del usuario.
