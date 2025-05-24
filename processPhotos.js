const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Configuration
//const inputDir = '/Volumes/Untitled/DCIM/100MSDCF';
const inputDir = '../inputDir/100MSDCF';
//const outputDir = '/Volumes/3207571629/18MAYO';
const outputDir = './salida';
const tempDir = './temp';
const watermark2Path = './watermark2.png';
const watermark3Path = './watermark3.png';

// Time slots configuration
const timeSlots = [];
let currentTime = new Date();
currentTime.setHours(6, 0, 0, 0);
while (currentTime.getHours() < 10 || (currentTime.getHours() === 10 && currentTime.getMinutes() === 0)) {
    const slotStart = new Date(currentTime);
    currentTime.setMinutes(currentTime.getMinutes() + 30);
    const slotEnd = new Date(currentTime);
    timeSlots.push({
        start: slotStart,
        end: slotEnd,
        folderName: `${slotStart.getHours().toString().padStart(2, '0')}-${slotStart.getMinutes().toString().padStart(2, '0')}_${slotEnd.getHours().toString().padStart(2, '0')}-${slotEnd.getMinutes().toString().padStart(2, '0')}`
    });
}

fs.ensureDirSync(outputDir);
fs.ensureDirSync(tempDir);

timeSlots.forEach(slot => {
    fs.ensureDirSync(path.join(outputDir, slot.folderName));
});
fs.ensureDirSync(path.join(outputDir, 'other'));

async function convertRawToJpg(inputPath, outputPath) {
    try {
        const command = `dcraw -v -w -T -q 3 "${inputPath}"`;
        await execAsync(command);
        const tiffPath = inputPath.replace('.ARW', '.tiff');
        if (await fs.pathExists(tiffPath)) {
            await fs.move(tiffPath, outputPath, { overwrite: true });
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Error converting ${inputPath}:`, error);
        return false;
    }
}

async function getImageDateTime(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return stats.birthtime || stats.mtime;
    } catch (error) {
        console.error(`Error reading file stats for ${filePath}:`, error);
        return new Date();
    }
}

function findTimeSlot(imageDate) {
    const imageTime = new Date();
    imageTime.setHours(imageDate.getHours());
    imageTime.setMinutes(imageDate.getMinutes());
    imageTime.setSeconds(0, 0);

    const slot = timeSlots.find(slot => {
        const slotStartTime = new Date();
        slotStartTime.setHours(slot.start.getHours());
        slotStartTime.setMinutes(slot.start.getMinutes());
        slotStartTime.setSeconds(0, 0);

        const slotEndTime = new Date();
        slotEndTime.setHours(slot.end.getHours());
        slotEndTime.setMinutes(slot.end.getMinutes());
        slotEndTime.setSeconds(0, 0);

        return imageTime >= slotStartTime && imageTime < slotEndTime;
    });

    return slot ? slot.folderName : 'other';
}

async function getAlreadyProcessedFiles() {
    const processedFiles = new Set();
    const folders = await fs.readdir(outputDir);
    for (const folder of folders) {
        const fullPath = path.join(outputDir, folder);
        if (!(await fs.stat(fullPath)).isDirectory()) continue;

        const files = await fs.readdir(fullPath);
        files
            .filter(file => file.toLowerCase().endsWith('.jpg'))
            .forEach(file => processedFiles.add(file.toLowerCase()));
    }
    return processedFiles;
}

async function processImage(filePath) {
    try {
        const fileName = path.basename(filePath);
        const tempArwPath = path.join(tempDir, fileName);
        const tempJpgPath = path.join(tempDir, fileName.replace('.ARW', '.jpg'));

        //console.log(`🚀 Iniciando procesamiento de ${fileName}`);
        const startTime = Date.now(); // ⏱️ Inicia conteo

        // Copiar archivo a tempDir antes de procesar
        await fs.copy(filePath, tempArwPath);
        const imageDateTime = await getImageDateTime(filePath);
        const timeSlotFolder = findTimeSlot(imageDateTime);
        //console.log(imageDateTime, "=>>hora de toma");

        const outputFolderPath = path.join(outputDir, timeSlotFolder);
        fs.ensureDirSync(outputFolderPath);
        const finalOutputPath = path.join(outputFolderPath, fileName.replace('.ARW', '.jpg'));

        //console.log(`Converting ${fileName}... Will be placed in ${timeSlotFolder}`);
        const conversionSuccess = await convertRawToJpg(tempArwPath, tempJpgPath);
        if (!conversionSuccess) {
            console.error(`Failed to convert ${fileName}`);
            await fs.remove(tempArwPath);
            return;
        }

        const image = sharp(tempJpgPath);
        const metadata = await image.metadata();

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

        const watermark = await sharp(selectedWatermark)
            .resize(metadata.width, metadata.height, { fit: 'fill' })
            .toBuffer();

        await image
            .composite([{ input: watermark, top: 0, left: 0, blend: 'over' }])
            .jpeg({ quality: 90 })
            .toFile(finalOutputPath);

        // Limpieza
        await fs.remove(tempArwPath);
        await fs.remove(tempJpgPath);

        const endTime = Date.now(); // ⏱️ Finaliza conteo
        const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`✅ Successfully processed: ${fileName} -> ${timeSlotFolder} (${durationSeconds}s)`);

    } catch (error) {
        console.error(`❌ Error processing ${filePath}:`, error);
    }
}

const pLimit = require('p-limit');
/*
async function processAllImages() {
    try {
        const files = await fs.readdir(inputDir);
        const arwFiles = files.filter(file => file.toLowerCase().endsWith('.arw'));

        const alreadyProcessed = await getAlreadyProcessedFiles();
        //console.log(`🔍 Imágenes ya procesadas: ${alreadyProcessed.size}`);
        console.log(`📸 Imágenes por procesar: ${arwFiles.length}`);

        let successCount = 0;
        let skippedCount = 0;

        for (const file of arwFiles) {
            const jpgName = file.replace('.ARW', '.jpg').toLowerCase();

            if (alreadyProcessed.has(jpgName)) {
                console.log(`⏭️  Saltando ${file}, ya procesado`);
                skippedCount++;
                continue;
            }

            const filePath = path.join(inputDir, file);
            await processImage(filePath);

            const imageDateTime = await getImageDateTime(filePath);
            const timeSlotFolder = findTimeSlot(imageDateTime);
            const outputPath = path.join(outputDir, timeSlotFolder, jpgName);
            if (await fs.pathExists(outputPath)) {
                successCount++;
            }

            //console.log(`✅ ${successCount} procesadas | ⏭️ ${skippedCount} omitidas`);
        }

        console.log('🏁 Procesamiento finalizado');
        console.log(`✅ Marca de agua aplicada: ${successCount}`);
        console.log(`⏭️  Imágenes omitidas: ${skippedCount}`);
        console.log(`📦 Total imágenes encontradas: ${arwFiles.length}`);
    } catch (error) {
        console.error('❌ Error procesando imágenes:', error);
    }
}
    */
   async function processAllImages() {
    try {
        const files = await fs.readdir(inputDir);
        const arwFiles = files.filter(file => file.toLowerCase().endsWith('.arw'));

        const alreadyProcessed = await getAlreadyProcessedFiles();
        console.log(`📸 Imágenes por procesar: ${arwFiles.length}`);

        let successCount = 0;
        let skippedCount = 0;

        const limit = pLimit(8); // Cambia el número si quieres más/menos paralelo

        const tasks = arwFiles.map(file => limit(async () => {
            const jpgName = file.replace('.ARW', '.jpg').toLowerCase();

            if (alreadyProcessed.has(jpgName)) {
                console.log(`⏭️  Saltando ${file}, ya procesado`);
                skippedCount++;
                return;
            }

            const filePath = path.join(inputDir, file);
            await processImage(filePath);

            const imageDateTime = await getImageDateTime(filePath);
            const timeSlotFolder = findTimeSlot(imageDateTime);
            const outputPath = path.join(outputDir, timeSlotFolder, jpgName);
            if (await fs.pathExists(outputPath)) {
                successCount++;
            }
        }));

        await Promise.allSettled(tasks);

        console.log('🏁 Procesamiento finalizado');
        console.log(`✅ Marca de agua aplicada: ${successCount}`);
        console.log(`⏭️  Imágenes omitidas: ${skippedCount}`);
        console.log(`📦 Total imágenes encontradas: ${arwFiles.length}`);
    } catch (error) {
        console.error('❌ Error procesando imágenes:', error);
    }
}


processAllImages();
