const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

// Obtener la ruta absoluta del directorio actual
const currentDir = process.cwd();

// Directorios de entrada y salida usando rutas absolutas
const inputDir = path.join(currentDir, 'input');
const outputDir = path.join(currentDir, 'output');

// Asegurarse de que los directorios existan
if (!fs.existsSync(inputDir)) {
    console.log('Creando directorio de entrada...');
    fs.mkdirSync(inputDir);
}

if (!fs.existsSync(outputDir)) {
    console.log('Creando directorio de salida...');
    fs.mkdirSync(outputDir);
}

// Función para convertir una imagen RAW a JPG usando exiftool
async function convertRawToJpg(inputPath, outputPath) {
    try {
        // Usar exiftool para convertir el archivo RAW a JPG
        const command = `exiftool -b -JpgFromRaw "${inputPath}" > "${outputPath}"`;
        await execPromise(command);
        console.log(`Convertida: ${path.basename(inputPath)}`);
    } catch (error) {
        console.error(`Error al convertir ${path.basename(inputPath)}:`, error.message);
    }
}

// Función principal para procesar todas las imágenes
async function processAllImages() {
    try {
        console.log('Buscando archivos en:', inputDir);
        const files = fs.readdirSync(inputDir);
        console.log('Archivos encontrados:', files);
        
        const rawFiles = files.filter(file => 
            file.toLowerCase().endsWith('.arw') ||  // Sony RAW
            file.toLowerCase().endsWith('.cr2') ||  // Canon RAW
            file.toLowerCase().endsWith('.nef') ||  // Nikon RAW
            file.toLowerCase().endsWith('.dng') ||  // Adobe/Leica RAW
            file.toLowerCase().endsWith('.raf')     // Fujifilm RAW
        );

        if (rawFiles.length === 0) {
            console.log('No se encontraron archivos RAW en el directorio de entrada.');
            console.log('Por favor, coloca tus archivos RAW en el directorio:', inputDir);
            return;
        }

        console.log(`Encontrados ${rawFiles.length} archivos RAW para convertir.`);

        for (const file of rawFiles) {
            const inputPath = path.join(inputDir, file);
            const outputPath = path.join(outputDir, `${path.parse(file).name}-preview.jpg`);
            await convertRawToJpg(inputPath, outputPath);
        }

        console.log('¡Conversión completada!');
    } catch (error) {
        console.error('Error durante el procesamiento:', error.message);
    }
}

// Ejecutar el script
processAllImages(); 