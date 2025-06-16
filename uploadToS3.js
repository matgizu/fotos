const AWS = require('aws-sdk');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');

// AWS Configuration
AWS.config.update({
    region: 'us-east-1', // Cambia esto a tu región
    credentials: new AWS.Credentials({
        accessKeyId: 'TU_ACCESS_KEY_ID',
        secretAccessKey: 'TU_SECRET_ACCESS_KEY'
    })
});

const s3 = new AWS.S3();

// Configuration
const inputDir = '/Volumes/3207571629/15JUNIO';
const bucketName = 'TU_BUCKET_NAME';
const prefix = 'fotos/'; // Prefijo para organizar las fotos en S3

async function uploadFile(filePath, key) {
    try {
        const fileContent = await fs.readFile(filePath);
        const params = {
            Bucket: bucketName,
            Key: key,
            Body: fileContent,
            ContentType: 'image/jpeg'
        };

        await s3.upload(params).promise();
        console.log(`✅ Uploaded: ${key}`);
        return true;
    } catch (error) {
        console.error(`❌ Error uploading ${filePath}:`, error);
        return false;
    }
}

async function uploadAllImages() {
    try {
        const startTotalTime = Date.now();
        let successCount = 0;
        let failedCount = 0;

        // Obtener todas las carpetas en el directorio de entrada
        const folders = await fs.readdir(inputDir);
        
        // Procesar una carpeta a la vez para evitar sobrecarga
        const limit = pLimit(1);

        for (const folder of folders) {
            const folderPath = path.join(inputDir, folder);
            const stats = await fs.stat(folderPath);
            
            if (!stats.isDirectory()) continue;

            console.log(`📁 Processing folder: ${folder}`);
            const files = await fs.readdir(folderPath);
            const jpgFiles = files.filter(file => file.toLowerCase().endsWith('.jpg'));

            const tasks = jpgFiles.map(file => limit(async () => {
                const filePath = path.join(folderPath, file);
                const key = `${prefix}${folder}/${file}`;
                
                const success = await uploadFile(filePath, key);
                if (success) {
                    successCount++;
                } else {
                    failedCount++;
                }
            }));

            await Promise.allSettled(tasks);
        }

        const endTotalTime = Date.now();
        const totalDurationSeconds = ((endTotalTime - startTotalTime) / 1000).toFixed(2);

        console.log('\n🏁 Upload process completed');
        console.log(`✅ Successfully uploaded: ${successCount}`);
        console.log(`❌ Failed uploads: ${failedCount}`);
        console.log(`⏱️ Total execution time: ${totalDurationSeconds} seconds`);

    } catch (error) {
        console.error('❌ Error in upload process:', error);
    }
}

// Ejecutar el script
uploadAllImages(); 