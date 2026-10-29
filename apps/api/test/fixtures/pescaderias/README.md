# Fixtures de contrato, no HTML descargado

El proxy devolvió HTTP 403 para `deondesenon.xunta.gal` al consultar robots.txt el 29/10/2026. Estos documentos HTML **sintéticos** ejercitan estructuras semánticas habituales (dl, tabla y campos), sin atribuirlas a la web real. Las medidas y licencias son exclusivamente entradas de prueba, no referencias verificadas.

No se han utilizado estos documentos para poblar la aplicación. Antes de una primera importación real es obligatorio ejecutar `inspect`, revisar condiciones, guardar HTML real en una carpeta privada y contrastar los selectores. Añadir fixtures reales redistribuibles con URL, fecha y SHA-256 cuando exista acceso y permiso. La prueba de compatibilidad con el HTML real sigue pendiente.
