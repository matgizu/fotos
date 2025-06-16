const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const pLimit = require('p-limit');

// Configuration
const inputDir = '/Volumes/Untitled/DCIM/103MSDCF';
const outputDir = '/Volumes/3207571629/15JUNIO_LOW';
const tempDir = '/Volumes/3207571629/temp';
const watermark2Path = './watermark2.png';
const watermark3Path = './watermark3.png';

// Cache for watermark buffers
const watermarkCache = new Map();

// Ensure directories exist
fs.ensureDirSync(outputDir);
fs.ensureDirSync(tempDir);

async function getWatermarkBuffer(watermarkPath, width, height) {
    const cacheKey = `${watermarkPath}-${width}-${height}`;
    if (watermarkCache.has(cacheKey)) {
        return watermarkCache.get(cacheKey);
    }
    
    const watermark = await sharp(watermarkPath)
        .resize(width, height, { fit: 'fill' })
        .toBuffer();
    
    watermarkCache.set(cacheKey, watermark);
    return watermark;
}

async function convertRawToJpg(inputPath, outputPath) {
    try {
        // Usando -h para half-size y -q 3 para calidad
        const command = `dcraw -v -w -h -q 3 "${inputPath}"`;
        await execAsync(command);
        
        const jpgPath = inputPath.replace('.ARW', '.jpg');
        if (await fs.pathExists(jpgPath)) {
            await fs.move(jpgPath, outputPath, { overwrite: true });
            return true;
        }
        
        // Si falla la conversión directa, intentar con PPM
        const ppmCommand = `dcraw -v -w -h -q 3 "${inputPath}"`;
        await execAsync(ppmCommand);
        
        const ppmPath = inputPath.replace('.ARW', '.ppm');
        if (await fs.pathExists(ppmPath)) {
            const convertCommand = `convert "${ppmPath}" "${outputPath}"`;
            await execAsync(convertCommand);
            await fs.remove(ppmPath);
            return true;
        }
        
        return false;
    } catch (error) {
        console.error(`Error converting ${inputPath}:`, error);
        return false;
    }
}

async function processImage(filePath) {
    try {
        const fileName = path.basename(filePath);
        const tempArwPath = path.join(tempDir, fileName);
        const tempJpgPath = path.join(tempDir, fileName.replace('.ARW', '.jpg'));

        console.log(`\n🔄 Procesando: ${fileName}`);
        const startTime = Date.now();
        let stepTime;

        // Paso 1: Copiar archivo
        stepTime = Date.now();
        await fs.copy(filePath, tempArwPath);
        console.log(`📋 Copia de archivo: ${((Date.now() - stepTime) / 1000).toFixed(2)}s`);

        const finalOutputPath = path.join(outputDir, fileName.replace('.ARW', '.jpg'));

        // Paso 2: Conversión RAW a JPG
        stepTime = Date.now();
        const conversionSuccess = await convertRawToJpg(tempArwPath, tempJpgPath);
        console.log(`🖼️  Conversión RAW a JPG: ${((Date.now() - stepTime) / 1000).toFixed(2)}s`);

        if (!conversionSuccess) {
            console.error(`Failed to convert ${fileName}`);
            await fs.remove(tempArwPath);
            return;
        }

        // Paso 3: Procesamiento con Sharp
        stepTime = Date.now();
        const image = sharp(tempJpgPath);
        const metadata = await image.metadata();
        console.log(`📊 Lectura de metadata: ${((Date.now() - stepTime) / 1000).toFixed(2)}s`);

        // Calcular las nuevas dimensiones
        const newWidth = Math.floor(metadata.width * 0.5);
        const newHeight = Math.floor(metadata.height * 0.5);

        let selectedWatermark;
        if (metadata.width === 3376 && metadata.height === 6000) {
            selectedWatermark = watermark2Path;
        } else if (
            (metadata.width === 6024 && metadata.height === 4024) ||
            (metadata.width === 4024 && metadata.height === 6024)
        ) {
            selectedWatermark = watermark3Path;
        } else {
            selectedWatermark = watermark2Path;
        }

        // Paso 4: Preparación del watermark
        stepTime = Date.now();
        const watermark = await getWatermarkBuffer(selectedWatermark, newWidth, newHeight);
        console.log(`💧 Preparación del watermark: ${((Date.now() - stepTime) / 1000).toFixed(2)}s`);

        // Paso 5: Procesamiento final de la imagen
        stepTime = Date.now();
        await image
            .resize(newWidth, newHeight)
            .composite([{ input: watermark, top: 0, left: 0, blend: 'over' }])
            .jpeg({ quality: 30 })
            .toFile(finalOutputPath);
        console.log(`🎨 Procesamiento final de imagen: ${((Date.now() - stepTime) / 1000).toFixed(2)}s`);

        // Paso 6: Limpieza
        stepTime = Date.now();
        await fs.remove(tempArwPath);
        await fs.remove(tempJpgPath);
        console.log(`🧹 Limpieza de archivos temporales: ${((Date.now() - stepTime) / 1000).toFixed(2)}s`);

        const endTime = Date.now();
        const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`✅ Procesamiento completado: ${fileName} (Tiempo total: ${durationSeconds}s)`);

    } catch (error) {
        console.error(`❌ Error processing ${filePath}:`, error);
    }
}

async function processAllImages() {
    try {
        const startTotalTime = Date.now();
        console.log('\n🚀 Iniciando procesamiento de imágenes...');

        const files = await fs.readdir(inputDir);
        const arwFiles = files.filter(file => file.toLowerCase().endsWith('.arw'));

        console.log(`📸 Total de imágenes por procesar: ${arwFiles.length}`);

        let successCount = 0;
        let skippedCount = 0;
        let totalProcessingTime = 0;

        // Procesamiento paralelo de 2 imágenes
        const limit = pLimit(2);

        const tasks = arwFiles.map(file => limit(async () => {
            const filePath = path.join(inputDir, file);
            const startTime = Date.now();
            await processImage(filePath);
            const processTime = (Date.now() - startTime) / 1000;
            totalProcessingTime += processTime;
            successCount++;
        }));

        await Promise.allSettled(tasks);

        const endTotalTime = Date.now();
        const totalDurationSeconds = ((endTotalTime - startTotalTime) / 1000).toFixed(2);
        const averageTime = (totalProcessingTime / successCount).toFixed(2);

        console.log('\n📊 Resumen del procesamiento:');
        console.log(`✅ Imágenes procesadas: ${successCount}`);
        console.log(`⏭️  Imágenes omitidas: ${skippedCount}`);
        console.log(`📦 Total imágenes encontradas: ${arwFiles.length}`);
        console.log(`⏱️ Tiempo total de ejecución: ${totalDurationSeconds} segundos`);
        console.log(`📈 Tiempo promedio por imagen: ${averageTime} segundos`);

    } catch (error) {
        console.error('❌ Error en el procesamiento:', error);
    }
}

processAllImages(); 