# FamilyTree

Donde los abuelos florecen, los primos aparecen por sorpresa y el JSON sale del navegador con uniforme militar de fecha y hora para no volver a perderse en la carpeta de descargas.

![Estado](https://img.shields.io/badge/status-listo%20para%20ramificar-3b82f6) ![Estilo](https://img.shields.io/badge/look-Ntizar%20Aurora-f97316) ![Deploy](https://img.shields.io/badge/pages-GitHub%20Pages-1d4ed8)

## Que Es

`FamilyTree` es una aplicacion estatica en HTML, CSS y JavaScript para construir un arbol genealogico visual sin instalar nada raro.

- Creas personas en tarjetas.
- Las conectas como padres, hijos, hermanos o parejas.
- Guardas fotos, fechas, lugares, notas y profesiones.
- Exportas el arbol a `JSON` o `Excel`.
- Lo imprimes cuando te entra el espiritu archivista de monasterio premium.

La interfaz mantiene toda la funcionalidad original, pero ahora vestida con capa visual **Ntizar Aurora**: superficies suaves, acentos de marca y una atmosfera mas luminosa que una reunion familiar con canapes buenos.

## Como Se Usa

La propia app abre una ventana emergente al principio explicando el flujo.

Resumen rapido:

1. Pulsa `Añadir persona`.
2. Selecciona una tarjeta para editar su ficha lateral.
3. Usa los botones alrededor de la tarjeta para anadir relaciones.
4. Exporta en `JSON` si quieres conservar tambien las fotos.
5. Exporta en `Excel` si quieres una tabla comoda para revisar o compartir.

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
- Ntizar Aurora v5.1 como capa visual de marca.

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
