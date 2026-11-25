# DEV aislado (PC local, WSL2/Docker Desktop)
Propuesta para revisar. No ejecutar en servidor de producción ni contra un contexto Docker remoto. No combinar este archivo con compose.yaml o compose.build.yaml de producción. Un único proyecto DEV por equipo, puerto loopback 18444; no acceder desde LAN/WAN. La red interna impide usar proveedores externos: usar fixtures para integraciones y catálogo, no credenciales reales. El catálogo base viene de la imagen; crear solo usuarios ficticios. Los datos, CA y fotos se conservan en volúmenes DEV independientes.

Desde el repositorio raíz en WSL2, comprobar docker context show y docker context inspect (destino local), revisar DOCKER_HOST/DOCKER_CONTEXT y no continuar si apuntan a otro host. No copiar .env, image.env ni bases reales. Usar siempre los argumentos explícitos de proyecto y manifiesto:

```bash
docker build -t cebo-pemento:dev .
docker compose --env-file /dev/null -p cebo-pemento-dev -f deploy/dev/compose.yaml config --quiet
docker compose --env-file /dev/null -p cebo-pemento-dev -f deploy/dev/compose.yaml up -d --no-build --wait --wait-timeout 120
docker compose --env-file /dev/null -p cebo-pemento-dev -f deploy/dev/compose.yaml ps
```

Para QA del candidato OCI, exportar CEBO_DEV_IMAGE con la referencia completa por SHA@sha256 de un artefacto aprobado para QA, hacer pull explícito de esa referencia y ejecutar los mismos comandos con --pull never. No reconstruir ese candidato. Para edición rápida, seguir usando npm run dev con datos locales.

Crear un administrador **ficticio** (contraseña única DEV introducida de forma interactiva según CLI):
```bash
docker compose --env-file /dev/null -p cebo-pemento-dev -f deploy/dev/compose.yaml exec app node apps/api/dist/cli.js admin devadmin
mkdir -p work/dev-tls
docker compose --env-file /dev/null -p cebo-pemento-dev -f deploy/dev/compose.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt work/dev-tls/root.crt
curl --noproxy '*' --cacert work/dev-tls/root.crt https://127.0.0.1:18444/api/health
```
Abrir https://127.0.0.1:18444 tras confiar exclusivamente en la CA DEV en el almacén/perfil de navegador de pruebas; no importar CA PROD ni desactivar la verificación TLS. Si el navegador está en Windows, comprobar el forwarding loopback de Docker Desktop. Retirar la confianza cuando ya no se utilice.

Para logs y parada no destructiva:
```bash
docker compose --env-file /dev/null -p cebo-pemento-dev -f deploy/dev/compose.yaml logs --tail 50
docker compose --env-file /dev/null -p cebo-pemento-dev -f deploy/dev/compose.yaml stop
```
No subir logs, credenciales, CA privada ni datos. Para reset, un proyecto/volumen de ensayo nuevo y revisión explícita de recursos; no usar down -v ni limpiezas generales. Esta entrega no implementa OIDC ni promoción PROD; mantiene los manifiestos productivos y sus procedimientos intactos. La prueba CI usa datos efímeros y verifica la configuración efectiva, salud y TLS con la CA real de DEV.
