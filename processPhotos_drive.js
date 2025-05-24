const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { google } = require('googleapis');
const pLimit = require('p-limit');
const { PassThrough } = require('stream');

// Configuración de Google Drive
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const KEYFILEPATH = './credentials.json'; // Cambia por tu ruta de credenciales
const DRIVE_ROOT_FOLDER_ID = '1vve-NNSnxiuwVLsxQm_0WGWOjMdxf9FL'; // <-- Pega aquí el ID de tu carpeta de Drive

// Busca o crea una carpeta en Drive y retorna su ID
async function getOrCreateDriveFolder(drive, folderName, parentId = null) {
    // Buscar carpeta existente
    let query = `name = '${folderName.replace("'", "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (parentId) query += ` and '${parentId}' in parents`;
    const res = await drive.files.list({
        q: query,
        fields: 'files(id, name)',
        spaces: 'drive',
    });
    if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id;
    }
    // Crear carpeta si no existe
    const fileMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) fileMetadata.parents = [parentId];
    const folder = await drive.files.create({
        resource: fileMetadata,
        fields: 'id',
    });
    return folder.data.id;
}

async function uploadFolderToDrive(folderPath, folderNameOnDrive = null) {
    try {
        console.log(`Intentando subir carpeta a Drive: ${folderPath} como ${folderNameOnDrive || path.basename(folderPath)}`);
        const auth = new google.auth.GoogleAuth({
            keyFile: KEYFILEPATH,
            scopes: SCOPES,
        });
        const drive = google.drive({ version: 'v3', auth });

        // Usar la carpeta raíz proporcionada por el usuario
        const rootFolderId = DRIVE_ROOT_FOLDER_ID;
        // Buscar o crear subcarpeta de la hora
        const subFolderName = folderNameOnDrive || path.basename(folderPath);
        const subFolderId = await getOrCreateDriveFolder(drive, subFolderName, rootFolderId);

        // Sube todos los archivos JPG de la carpeta
        const files = await fs.readdir(folderPath);
        let uploadedCount = 0;
        for (const file of files) {
            if (!file.toLowerCase().endsWith('.jpg')) continue;
            const fileMetadata = {
                name: file,
                parents: [subFolderId],
            };
            const media = {
                mimeType: 'image/jpeg',
                body: fs.createReadStream(path.join(folderPath, file)),
            };
            try {
                await drive.files.create({
                    resource: fileMetadata,
                    media: media,
                    fields: 'id',
                });
                uploadedCount++;
                console.log(`  ✔️ Subido: ${file}`);
            } catch (err) {
                console.error(`  ❌ Error subiendo ${file}:`, err.message);
            }
        }
        if (uploadedCount === 0) {
            console.log('  ⚠️  No se encontraron archivos JPG para subir en esta carpeta.');
        } else {
            console.log(`🚀 Carpeta subida a Drive: ${subFolderName} (${uploadedCount} archivos)`);
            console.log(`  📂 Enlace: https://drive.google.com/drive/folders/${subFolderId}`);
        }
    } catch (error) {
        console.error(`❌ Error subiendo carpeta ${folderPath} a Drive:`, error.message);
    }
}

//const inputDir = '/Volumes/Untitled/DCIM/100MSDCF';
const inputDir = '../inputDir/24MAYO';
const tempDir = '../temp';
//const tempDir = '/Volumes/3207571629/PRUEBA_DRIVE/temp';

//const tempDir = './temp';
const watermark2Path = './watermark2.png';
const watermark3Path = './watermark3.png';

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

fs.ensureDirSync(tempDir);
timeSlots.forEach(slot => {
    fs.ensureDirSync(path.join(tempDir, slot.folderName));
});
fs.ensureDirSync(path.join(tempDir, 'other'));

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
        const command = `exiftool -DateTimeOriginal -d "%Y:%m:%d %H:%M:%S" "${filePath}"`;
        const { stdout } = await execAsync(command);
        const dateMatch = stdout.match(/Date\/Time Original\s*:\s*(.+)/);
        if (dateMatch && dateMatch[1]) {
            return new Date(dateMatch[1].replace(':', '-').replace(':', '-'));
        }
        // Fallback to file stats if no EXIF data
        const stats = fs.statSync(filePath);
        return stats.birthtime || stats.mtime;
    } catch (error) {
        console.error(`Error reading EXIF data for ${filePath}:`, error);
        // Fallback to file stats if exiftool fails
        const stats = fs.statSync(filePath);
        return stats.birthtime || stats.mtime;
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

async function processImage(filePath, slotName) {
    try {
        const fileName = path.basename(filePath);
        const tempArwPath = path.join(tempDir, fileName);
        const tempJpgPath = path.join(tempDir, fileName.replace('.ARW', '.jpg'));
        const startTime = Date.now();
        await fs.copy(filePath, tempArwPath);
        const conversionSuccess = await convertRawToJpg(tempArwPath, tempJpgPath);
        if (!conversionSuccess) {
            console.error(`Failed to convert ${fileName}`);
            await fs.remove(tempArwPath);
            return null;
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
        const finalBuffer = await image
            .composite([{ input: watermark, top: 0, left: 0, blend: 'over' }])
            .jpeg({ quality: 90 })
            .toBuffer();
        await fs.remove(tempArwPath);
        await fs.remove(tempJpgPath);
        const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Procesada: ${fileName} (${durationSeconds}s)`);
        return { buffer: finalBuffer, name: fileName.replace('.ARW', '.jpg'), slotName };
    } catch (error) {
        console.error(`❌ Error procesando ${filePath}:`, error);
        return null;
    }
}

async function uploadJpgBuffersToDrive(jpgBuffers, slotName) {
    if (!jpgBuffers.length) return;
    const auth = new google.auth.GoogleAuth({
        keyFile: KEYFILEPATH,
        scopes: SCOPES,
    });
    const drive = google.drive({ version: 'v3', auth });
    const subFolderId = await getOrCreateDriveFolder(drive, slotName, DRIVE_ROOT_FOLDER_ID);
    let uploadedCount = 0;
    for (const jpg of jpgBuffers) {
        try {
            // Convertir buffer a stream
            const stream = new PassThrough();
            stream.end(jpg.buffer);
            await drive.files.create({
                resource: {
                    name: jpg.name,
                    parents: [subFolderId],
                },
                media: {
                    mimeType: 'image/jpeg',
                    body: stream,
                },
                fields: 'id',
            });
            uploadedCount++;
            console.log(`  ✔️ Subido: ${jpg.name}`);
        } catch (err) {
            console.error(`  ❌ Error subiendo ${jpg.name}:`, err.message);
        }
    }
    if (uploadedCount === 0) {
        console.log('  ⚠️  No se subió ningún JPG a Drive para este slot.');
    } else {
        console.log(`🚀 Slot subido a Drive: ${slotName} (${uploadedCount} archivos)`);
    }
}

async function processAllImages() {
    try {
        const startTotalTime = Date.now();
        const files = await fs.readdir(inputDir);
        const arwFiles = files.filter(file => file.toLowerCase().endsWith('.arw'));
        const arwFilesWithDates = await Promise.all(arwFiles.map(async file => {
            const filePath = path.join(inputDir, file);
            const stats = await fs.stat(filePath);
            return { file, date: stats.birthtime || stats.mtime };
        }));
        arwFilesWithDates.sort((a, b) => a.date - b.date);
        const sortedArwFiles = arwFilesWithDates.map(f => f.file);
        console.log(`📸 Imágenes por procesar: ${sortedArwFiles.length}`);
        let successCount = 0;
        let skippedCount = 0;
        const limit = pLimit(12);
        // Agrupar archivos por slot
        const slotGroups = {};
        for (const file of sortedArwFiles) {
            const filePath = path.join(inputDir, file);
            const imageDateTime = await getImageDateTime(filePath);
            const timeSlotFolder = findTimeSlot(imageDateTime);
            if (!slotGroups[timeSlotFolder]) slotGroups[timeSlotFolder] = [];
            slotGroups[timeSlotFolder].push(file);
        }
        // Procesar slot por slot, imágenes en paralelo, y subir directamente a Drive
        for (const slotName of Object.keys(slotGroups)) {
            const filesInSlot = slotGroups[slotName];
            const jpgBuffers = (await Promise.all(filesInSlot.map(file => limit(() => processImage(path.join(inputDir, file), slotName))))).filter(Boolean);
            await uploadJpgBuffersToDrive(jpgBuffers, slotName);
            successCount += jpgBuffers.length;
        }
        const endTotalTime = Date.now();
        const totalDurationSeconds = ((endTotalTime - startTotalTime) / 1000).toFixed(2);
        console.log('🏁 Procesamiento finalizado');
        console.log(`✅ Marca de agua aplicada y subidas: ${successCount}`);
        console.log(`⏱️ Tiempo total de ejecución: ${totalDurationSeconds} segundos`);
    } catch (error) {
        console.error('❌ Error procesando imágenes:', error);
    }
}

processAllImages();
