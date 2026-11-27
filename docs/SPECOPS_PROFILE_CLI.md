# Issue #42: escritura privada y exclusiva de perfiles

Corrección de mantenimiento desde main: Servidor Casa
`9895f7db332fbd1af53a9f81af37ea2b0088c0d7` y CeboDePemento
`322bf7de9d324c2da621a90628ba33f68d4edfca`. No se instala nada ni se accede al NUC.

## Fallo y corrección

Las CLI llegaban al resultado de `prepare()` o `source_policy()` pero fallaban con
`TypeError: Path.open() got an unexpected keyword argument 'opener'`. Path.open no
admite ese argumento, a diferencia del open integrado. La ejecución anterior al
fix se reprodujo en ambos repositorios, con salida no cero y sin fichero creado.

Se corrigen las tres llamadas: `scripts/portal-dev-profile.py` de Servidor Casa y
`specops_delivery/profile.py` de ambos repositorios. Usan `open(..., 'x',
encoding='utf-8', opener=...)`, cuyo opener llama a `os.open(..., mode=0o600)`.
El modo x proporciona creación exclusiva O_CREAT/O_EXCL: el destino existente,
incluido un enlace simbólico válido o roto, falla sin sobrescribirlo ni abrir su
target. El fichero nuevo nace privado, sin ventana previa a un chmod posterior.
No se crean directorios automáticamente.

Se extrae únicamente `main(argv=None)` para poder ejecutar/probar el parser y la
escritura de cada CLI. Los flags y el guard `__main__` siguen operativos. Las
funciones `prepare()` y `source_policy()`, sus firmas y resultados no cambian;
Portal sigue generando un perfil disabled y el otro generador solo la sección
source. No cambia ninguna validación, workflow, scope o blob de confianza.

## Regresión ejecutable y revisión Claude

`tests/test_specops_profile_cli.py`, idéntico en ambos repositorios, cubre:

- Subproceso real `python -m specops_delivery.profile` para Portal y Cebo; compara
  el JSON escrito con el resultado existente de source_policy.
- CLI Portal en un subproceso con parser/escritura reales; solo prepare se sustituye
  por un Mock y se comprueba la llamada con sus argumentos. No se consulta /opt ni
  Docker. Este caso se ejecuta donde existe el generador Portal (Servidor Casa).
- Archivos nuevos regulares 0600/propietario actual con umask000 y umask077, incluida
  una ruta con espacios. Pruebas de permisos POSIX correspondientes al host Ubuntu.
- Segundo intento FileExistsError, contenido/inodo/mtime y permisos conservados.
- Enlaces de destino a un fichero existente y a un target inexistente: rechazo,
  enlace conservado, contenido ajeno intacto y target roto sin crear.
- Padre inexistente e inputs source inválidos: sin directorios ni salida parcial.
- Los paths de mantenimiento no afectan al scope de ninguna app; con identidad/CI
  válidas, la procedencia del publicador los rechaza por source-outside-scope antes
  de leer artefactos. El motor central usa el mismo criterio de alcance.

Los archivos modificados son únicamente los generadores anteriores, este documento
y la prueba. No se añaden jobs ni se cambian permisos/condiciones CI. Las suites
existentes comprueban además render idéntico; se verifican los blobs de **todos**
los workflows frente a main y la igualdad de todos los módulos compartidos.

```bash
python3 -m unittest discover -s tests -p 'test_specops_profile_cli.py' -v
python3 -m unittest discover -s tests -p 'test_specops*.py' -v
python3 -m py_compile specops_delivery/profile.py
# Solo Servidor Casa:
python3 -m py_compile scripts/portal-dev-profile.py
git diff --check
```

Claude debe revisar en particular que x sigue pasando O_EXCL al opener, el modo
0600 se aplica al crear, no hay unlink/reintento que sustituya un destino, las
pruebas ejecutan la ruta CLI y las funciones de preparación quedan idénticas.
Los dos PR de mantenimiento parten de main y no califican como nuevos candidatos.
La comprobación de sus diff reales y el resultado de CI quedan en ambos PR.

## Continuidad del bootstrap mediante las funciones existentes

Esta corrección no exige parar el bootstrap ya autorizado. Dirección puede seguir
invocando `prepare()` o `source_policy()` del código revisado disponible, obtener
su resultado sin modificar checkout/ejecutables instalados y evitar **solo** la
llamada defectuosa de escritura. Para guardar ese resultado `value` en un destino
nuevo elegido en un directorio privado:

```python
import json
import os

# value: resultado real de prepare(...) o source_policy(...), ya revisado.
# destination: archivo nuevo dentro del directorio temporal privado elegido.
with open(destination, 'x', encoding='utf-8',
          opener=lambda path, flags: os.open(path, flags, 0o600)) as output:
    json.dump(value, output, indent=2)
```

No usar un perfil activo como destino ni inventar IDs/digests. Esta escritura no
instala el perfil ni activa ningún servicio/timer; la validación/instalación real
sigue en la sesión operativa autorizada. Aquí no se invocan las funciones contra
el host, no se cambian publicadores/blobs/scopes/variables, candidatos iniciales
#39 y Cebo #5 ni ramas de promoción. No hay merge, despliegue o cambios PROD.
