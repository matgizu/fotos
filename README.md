# Procesador de Fotos

Este proyecto procesa fotos en formato ARW, añade una marca de agua y las convierte a formato JPG.

## Requisitos

- Node.js (versión 18.17.0 o superior)
- NPM (Node Package Manager)

## Instalación

1. Clona o descarga este repositorio
2. Instala las dependencias:
```bash
npm install
```

## Uso

1. Crea una carpeta llamada `input` en la raíz del proyecto
2. Coloca tus fotos en formato ARW dentro de la carpeta `input`
3. Coloca tu imagen de marca de agua (watermark) como `watermark.png` en la raíz del proyecto
4. Ejecuta el script:
```bash
node processPhotos.js
```

## Estructura de carpetas

- `input/`: Coloca aquí tus fotos ARW
- `output/`: Aquí se guardarán las fotos procesadas
- `watermark.png`: Tu imagen de marca de agua

## Notas

- La marca de agua se colocará en la esquina inferior derecha de cada foto
- El tamaño de la marca de agua será aproximadamente el 20% del ancho de la foto
- Las fotos se guardarán en formato JPG con una calidad del 90%
- Se mantendrá el nombre original del archivo, solo cambiando la extensión a .jpg 