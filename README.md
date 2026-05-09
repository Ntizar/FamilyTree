# FamilyTree

Donde los abuelos florecen, los primos aparecen por sorpresa y el JSON sale del navegador con uniforme militar de fecha y hora para no volver a perderse en la carpeta de descargas.

![Estado](https://img.shields.io/badge/status-listo%20para%20ramificar-3b82f6) ![Estilo](https://img.shields.io/badge/look-azules%20y%20dorados-f97316) ![Deploy](https://img.shields.io/badge/pages-GitHub%20Pages-1d4ed8)

## Que Es

`FamilyTree` es una aplicacion estatica en HTML, CSS y JavaScript para construir un arbol genealogico visual sin instalar nada raro.

- Creas personas en tarjetas.
- Las conectas como padres, hijos, hermanos o parejas.
- Guardas fotos, fechas, lugares, notas y profesiones.
- Exportas el arbol a `JSON` o `Excel`.
- Lo imprimes cuando te entra el espiritu archivista de monasterio premium.

La interfaz mantiene toda la funcionalidad original, pero ahora con una capa visual mas limpia en azules y dorados, sin meter un sistema CSS externo que altere el comportamiento del editor.

## Como Se Usa

La propia app abre una ventana emergente al principio explicando el flujo.

Resumen rapido:

1. Pulsa `Añadir persona`.
2. Selecciona una tarjeta para editar su ficha lateral.
3. Usa los botones alrededor de la tarjeta para anadir relaciones.
4. Diferencia `padre`, `madre`, parejas multiples y hermanos compartiendo progenitores.
5. Usa `Ver ramas` o doble clic en una tarjeta para alternar rama directa y arbol completo.
6. Exporta en `JSON` si quieres conservar tambien las fotos.
7. Exporta en `Excel` si quieres una tabla comoda para revisar o compartir.

## Truco Muy Importante

Los archivos `JSON` se descargan con **fecha y hora** en el nombre, por ejemplo:

```text
arbol-genealogico-2026-05-09_18-42-07.json
```

Eso permite ordenar copias por version sin tener que llamar a los archivos `final`, `final-bueno`, `final-bueno-ahora-si`, `final-bueno-ahora-si-2`.

## Tecnologia

- HTML, CSS y JavaScript vanilla.
- `xlsx` para importar y exportar Excel.
- GitHub Pages para desplegar la app.
- Capa visual local en `aurora.css`, centrada en colores y detalles de interfaz.

## Uso Local

Abre `index.html` directamente en el navegador o sirvelo como carpeta estatica.

```bash
npx serve .
```

## Deploy

El repo incluye workflow de GitHub Pages. Cada push a `main` publica la raiz del proyecto.

URL esperada:

```text
https://ntizar.github.io/FamilyTree/
```

## Autor

Hecho por **David Antizar**.
