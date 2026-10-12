# Cebo de Pemento

Aplicación online de pesca para un grupo de amigos. React + TypeScript + Vite, Fastify, SQLite y Drizzle. Interfaz gallega/castellana. El catálogo original se conserva: 932 entradas de referencia, 62 en selección inicial y 870 pendientes, no un inventario validado de fauna gallega.

## Windows 11: primera instalación

En PowerShell, instala Node.js 24 LTS y Git:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Cierra y abre PowerShell. Comprueba `node --version` (24.x) y `git --version`. Si el instalador LTS ofrece una versión mayor, instala Node 24 desde https://nodejs.org/en/download.

```powershell
git clone https://github.com/aculledor/CeboDePemento.git
cd CeboDePemento
Copy-Item .env.example .env
npm ci
npm run setup
npm run dev
```

Abre http://localhost:5173. Vite envía `/api` a Fastify en `127.0.0.1:3001`. `npm run setup` copia el catálogo únicamente si la base de trabajo no existe, compila tipos compartidos y aplica migraciones. No importes además `seed.sql`. Los paquetes SQLite/Argon2 usan binarios para Windows x64; si Node informa de compilación nativa, comprueba que estás utilizando Node 24 x64 antes de instalar herramientas adicionales.

## Probar desde un móvil en la misma Wi-Fi

Ejecuta `ipconfig`, busca la IPv4 del PC y añade su origen exacto a `.env`:

```dotenv
APP_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.50:5173
```

Sustituye la IP por la tuya, reinicia `npm run dev` y abre `http://TU_IP:5173` en el móvil. Permite Node en el firewall de Windows únicamente en la red privada. Fastify escucha en localhost; el móvil usa el proxy de Vite. El HTTP de desarrollo es para la LAN de confianza. No abras esos puertos en el router.

## Comandos

```text
npm run dev          React y API; prepara la base al arrancar
npm run db:migrate   Copia inicial y migraciones pendientes
npm run db:backup    Copia SQLite consistente y comprobada
npm run typecheck    TypeScript
npm test             Pruebas con copia temporal del catálogo real
npm run build        Compilación frontend, API y tipos compartidos
npm start            API compilada que también sirve React
```

Para probar el build: `npm run build` y `npm start`, después http://localhost:3001. Añade ese origen a `APP_ORIGINS` para los formularios. En Linux se pueden ejecutar los mismos comandos con Node 24; la configuración Docker/HTTPS se incorporará en la fase de despliegue.

## Estructura y datos

- `apps/web`: frontend, datos recibidos de la API, sin guardados optimistas ni cola offline.
- `apps/api`: servidor, acceso Drizzle/SQLite y migraciones versionadas.
- `packages/shared`: contratos y validación compartida.
- `catalogo.sqlite`, SQL y JSON originales: fuentes conservadas.
- `data/catalogo.sqlite`: copia de trabajo, ignorada por Git.
- `data/backups`: copias comprobadas antes de migrar y a petición.
- `docs`: inspección, estado de fases y API.

Las migraciones se aplican en transacción y registran checksum. No edites una migración ya aplicada; crea otra. El servidor se niega a abrir la base original para escritura. Cada lectura de la aplicación necesita servidor: respuestas `no-store`, sin service worker ni IndexedDB.

El PDF `Guia_pesca_Arousa_campo_alta_calidad.pdf` se usa como referencia editorial. Sus imágenes tienen atribuciones individuales: no se importan automáticamente por estar dentro del PDF. Los requisitos actualizados prevalecen sobre `REQUISITOS.md`: se excluyen normativa y modo offline.

Consulta `docs/ESTADO.md` para saber qué está implementado y qué queda pendiente. No existen usuarios o capturas ficticios.
