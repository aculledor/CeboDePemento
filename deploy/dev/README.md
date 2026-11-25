# DEV persistente en NUC (propuesta, instalación autorizada aparte)
DEV y PROD deben estar disponibles con el PC apagado. El NUC aloja ambos, pero este manifiesto autónomo nunca se combina con el Compose productivo. Instalación DEV propuesta: /opt/servicios-dev/cebo-pemento; no usar /opt/servicios/cebo-pemento ni su .env. Redes, volúmenes SQLite/fotos, CA y usuarios exclusivamente DEV. No montar HDD multimedia ni Docker socket. No dar acceso Docker a usuarios de prueba. CI hosted construye imágenes y ejecuta pruebas pesadas; no compilar en el NUC por defecto.

## Acceso
Puerto LAN propuesto 18444. El host de navegador DEV debe ser distinto del productivo: cebo-dev.home.arpa (propuesta). Las cookies no distinguen puertos; no iniciar sesión en DEV mediante la IP productiva. Resolver ese hostname hacia la IP LAN del NUC mediante archivo hosts del dispositivo de pruebas o DNS privado aprobado posteriormente; no cambiar AdGuard/router sin autorización. CA exclusiva DEV, confiar únicamente en el perfil/dispositivo de prueba. No exponer WAN. Acceso remoto privado sujeto a revisión de Tailscale; no cambiar sus reglas desde este PR.

## Instalación (solo después de autorización y revisión)
Comprobar memoria/CPU, espacio, puertos y redes existentes; presupuesto inicial máximo Cebo 640 MiB y 0.75 CPU más overhead. Usar un digest de candidato verificado obtenido desde CI. No ejecutar comandos con contexto Docker remoto ni reutilizar configuraciones o imágenes privadas de producción. Copiar compose.yaml y Caddyfile revisados al directorio DEV. Crear allí un archivo dev.env privado, con CEBO_DEV_BIND igual a la IP LAN del NUC, CEBO_DEV_HOST=cebo-dev.home.arpa y CEBO_DEV_IMAGE igual a la referencia OCI completa SHA@sha256 autorizada. No versionar dev.env. Defaults loopback únicamente para CI/local. Verificar que el hostname no sea el de producción y que la imagen y puerto sean los previstos antes de arrancar.
```bash
cd /opt/servicios-dev/cebo-pemento
docker compose --env-file dev.env -p cebo-pemento-dev -f compose.yaml config --quiet
docker compose --env-file dev.env -p cebo-pemento-dev -f compose.yaml pull
docker compose --env-file dev.env -p cebo-pemento-dev -f compose.yaml up -d --no-build --pull never --wait --wait-timeout 120
docker compose --env-file dev.env -p cebo-pemento-dev -f compose.yaml ps
```
Crear solo administrador ficticio con contraseña exclusiva DEV mediante la CLI interactiva:
```bash
docker compose --env-file dev.env -p cebo-pemento-dev -f compose.yaml exec app node apps/api/dist/cli.js admin devadmin
mkdir -p work/dev-tls
docker compose --env-file dev.env -p cebo-pemento-dev -f compose.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt work/dev-tls/root.crt
curl --noproxy '*' --cacert work/dev-tls/root.crt https://cebo-dev.home.arpa:18444/api/health
```
La última prueba requiere resolución del nombre en el NUC; alternativamente usar curl --resolve con IP LAN verificada. Comprobar desde otro dispositivo LAN tras confiar en CA DEV. No usar -k. La API solo pertenece a la red interna, sin salida a proveedores externos; usar fixtures. Caddy pertenece también a un bridge de entrada independiente para publicar HTTPS; esa red permite salida del gateway, no de la API. No conectar ninguna red PROD. El catálogo base procede de la imagen, no de la base real.

## Operación
```bash
docker compose --env-file dev.env -p cebo-pemento-dev -f compose.yaml logs --tail 50
docker compose --env-file dev.env -p cebo-pemento-dev -f compose.yaml stop
```
No subir logs, secretos, CA privada ni datos. Para reset usar un proyecto/volumen nuevo revisado; no down -v ni limpiezas generales. Arranque al reiniciar: unidad systemd DEV independiente pendiente de revisión e instalación autorizada; este manifiesto conserva restart:no hasta validar convivencia. No tocar timers ni unidades PROD. No implica promoción, OIDC ni instalación real. CI prueba loopback con CA real; la accesibilidad LAN, recursos simultáneos y arranque tras reinicio se verifican posteriormente en NUC.

CI inicial: app y Caddy healthy pero curl al puerto publicado falló (run 45686126222). Se separa bridge de ingreso de red interna; pendiente confirmar corrección en CI.
