const fs = require('fs');
const { google } = require('googleapis');
const { PassThrough } = require('stream');
const sharp = require('sharp');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const KEYFILEPATH = './credentials.json'; // Debe existir en el servidor
const DRIVE_ROOT_FOLDER_ID = '1vve-NNSnxiuwVLsxQm_0WGWOjMdxf9FL'; // Cambia por tu carpeta

async function uploadBufferToDrive(buffer, fileName, folderId) {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEYFILEPATH,
        scopes: SCOPES,
    });
    const drive = google.drive({ version: 'v3', auth });
    const stream = new PassThrough();
    stream.end(buffer);
    const res = await drive.files.create({
        resource: {
            name: fileName,
            parents: [folderId],
        },
        media: {
            mimeType: 'image/jpeg',
            body: stream,
        },
        fields: 'id',
    });
    console.log('Subido a Drive con ID:', res.data.id);
}

async function convertRawToJpg(inputPath, outputPath) {
    try {
        const command = `dcraw -v -w -T -q 3 "${inputPath}"`;
        await execAsync(command);
        const tiffPath = inputPath.replace('.ARW', '.tiff');
        if (fs.existsSync(tiffPath)) {
            // Convertir TIFF a JPG
            await sharp(tiffPath).jpeg({ quality: 90 }).toFile(outputPath);
            fs.unlinkSync(tiffPath);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Error convirtiendo ${inputPath}:`, error);
        return false;
    }
}

async function main() {
    // Cambia la ruta a una imagen de prueba
    const arwPath = './input/DSC00001.ARW';
    const jpgPath = './output/DSC00001_test.jpg';
    if (!fs.existsSync(arwPath)) {
        console.error('No existe el archivo de prueba:', arwPath);
        return;
    }
    const ok = await convertRawToJpg(arwPath, jpgPath);
    if (!ok) {
        console.error('No se pudo convertir el ARW a JPG');
        return;
    }
    const buffer = fs.readFileSync(jpgPath);
    await uploadBufferToDrive(buffer, 'DSC00001_test.jpg', DRIVE_ROOT_FOLDER_ID);
    fs.unlinkSync(jpgPath);
}

main().catch(e => {
    console.error('Error en prueba de subida:', e);
    if (e.response && e.response.data) {
        console.error('Detalles:', e.response.data);
    }
});
