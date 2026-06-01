// watermark-wm2-bulletproof.js
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const { exec } = require('child_process');
const { promisify } = require('util');
const pLimit = require('p-limit');
const execAsync = promisify(exec);

// ====== CONFIG ======
const inputDir  = '/Volumes/Untitled/DCIM/102MSDCF'; // CAMBIO AQUÍ: carpeta con las ARW originales
//const inputDir  = '/Volumes/3207571629/14FEBRERO/DCIM/100MSDCF';

const outputDir = '/Volumes/3207571629 1/31Mayo';
const tempDir   = '/Volumes/3207571629 1/temp';

//const watermark2Path = './watermark2.png'; // SIEMPRE esta
const watermark2Path = './watermark.png'; // SIEMPRE esta
const JPG_QUALITY = 70;
const CONCURRENCY = 2;

// >>> NUEVO: procesar desde esta foto hacia arriba <<<
const START_FROM_NAME = 'DSC0001.ARW';

// Franjas 06:00–10:00 cada 30 min (si no las necesitas, puedes colocar todo en una sola carpeta)
const timeSlots = [];
{
  let t = new Date();
  t.setHours(6, 0, 0, 0);
  while (t.getHours() < 10 || (t.getHours() === 10 && t.getMinutes() === 0)) {
    const start = new Date(t);
    t.setMinutes(t.getMinutes() + 30);
    const end = new Date(t);
    timeSlots.push({
      start, end,
      folderName: `${start.getHours().toString().padStart(2,'0')}-${start.getMinutes().toString().padStart(2,'0')}_${end.getHours().toString().padStart(2,'0')}-${end.getMinutes().toString().padStart(2,'0')}`
    });
  }
}

fs.ensureDirSync(outputDir);
fs.ensureDirSync(tempDir);
timeSlots.forEach(s => fs.ensureDirSync(path.join(outputDir, s.folderName)));
fs.ensureDirSync(path.join(outputDir, 'other'));

// ====== helpers ======
function findTimeSlot(imageDate) {
  const imageTime = new Date();
  imageTime.setHours(imageDate.getHours(), imageDate.getMinutes(), 0, 0);
  const slot = timeSlots.find(slot => {
    const s = new Date(); s.setHours(slot.start.getHours(), slot.start.getMinutes(), 0, 0);
    const e = new Date(); e.setHours(slot.end.getHours(),   slot.end.getMinutes(),   0, 0);
    return imageTime >= s && imageTime < e;
  });
  return slot ? slot.folderName : 'other';
}

async function getImageDateTime(filePath) {
  try {
    const st = await fs.stat(filePath);
    return st.birthtime || st.mtime;
  } catch { return new Date(); }
}

async function extractJpegFromRaw(inputArw, outJpg) {
  const dir = path.dirname(inputArw);
  const base = path.basename(inputArw).replace(/\.arw$/i,'');
  await execAsync(`dcraw -e "${inputArw}"`);
  const produced = path.join(dir, `${base}.thumb.jpg`);
  await fs.move(produced, outJpg, { overwrite: true });
}

let wm2SrcBuf;
async function loadWatermark() {
  wm2SrcBuf = await fs.readFile(watermark2Path);
}

// Extra: utilidad para obtener el número de DSC (p.ej. 5219)
function dscNumber(name) {
  const m = name.match(/^_?DSC0*(\d+)\.ARW$/i);
  return m ? Number(m[1]) : null;
}

// ====== core ======
async function processImage(inputArw, outFolder) {
  const fileName = path.basename(inputArw);
  const jpgName = fileName.replace(/\.arw$/i, '.jpg');
  const finalOut = path.join(outFolder, jpgName);
  const tmpJpg  = path.join(tempDir, `${jpgName}.tmp`);

  try {
    // 1) extraer JPG embebido
    await extractJpegFromRaw(inputArw, tmpJpg);

    // 2) autorotar y CONGELAR (buffer + dims exactas post-rotación)
    const { data: orientedBuf, info } = await sharp(tmpJpg).rotate().toBuffer({ resolveWithObject: true });
    let W = info.width  || 1;
    let H = info.height || 1;

    // Seguridad: que el watermark NUNCA sea mayor (restamos 1px si es posible)
    const wmW = Math.max(1, W - 1);
    const wmH = Math.max(1, H - 1);

    // 3) redimensionar watermark2 EXACTO al lienzo (menos 1px)
    const wmResized = await sharp(wm2SrcBuf).resize({ width: wmW, height: wmH, fit: 'fill' }).toBuffer();

    // 4) componer (wm en (0,0)); para ocupar todo, centramos dejando 0.5px de margen invisible
    await sharp(orientedBuf)
      .composite([{ input: wmResized, left: 0, top: 0 }])
      .withMetadata({ orientation: 1 }) // quita EXIF orientation
      .jpeg({ quality: JPG_QUALITY, progressive: true })
      .toFile(finalOut);

    await fs.remove(tmpJpg).catch(() => {});
    console.log(`✅ ${fileName} -> OK`);
  } catch (e) {
    console.error(`❌ Error en ${fileName}:`, e);
    await fs.remove(tmpJpg).catch(() => {});
  }
}

async function processAll() {
  await loadWatermark();

  const files = await fs.readdir(inputDir);

  // >>> NUEVO: calcular umbral desde START_FROM_NAME
  const START_FROM_NUM = dscNumber(START_FROM_NAME) ?? 0;

  // Filtra:
  // - Solo .ARW válidos tipo "DSCxxxxx.ARW"
  // - Desde START_FROM_NUM hacia arriba
  // - Orden ascendente por número
  const arwFiles = files
    .filter(f => /^_?DSC\d+\.ARW$/i.test(f)) // evita ._ prefijos y otros raros
    .map(f => ({ name: f, num: dscNumber(f) }))
    .filter(x => x.num !== null && x.num >= START_FROM_NUM)
    .sort((a, b) => a.num - b.num)
    .map(x => x.name);

  console.log(`📸 ARW encontrados desde ${START_FROM_NAME}: ${arwFiles.length}`);

  const limit = pLimit(CONCURRENCY);
  const tasks = arwFiles.map(file => limit(async () => {
    const filePath = path.join(inputDir, file);
    const date = await getImageDateTime(filePath);
    const slot = findTimeSlot(date);
    const outFolder = path.join(outputDir, slot);
    fs.ensureDirSync(outFolder);
    await processImage(filePath, outFolder);
  }));

  await Promise.allSettled(tasks);
  console.log('🏁 Listo');
}

processAll().catch(err => console.error('❌ Error general:', err));
