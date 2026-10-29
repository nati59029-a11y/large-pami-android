const fs=require('fs'),path=require('path');
fs.copyFileSync('node_modules/xlsx/dist/xlsx.full.min.js','www/xlsx.full.min.js');
// לשונית "הזמנות אתר" (שלב 1): לאיזה שרת היא מחוברת. ברירת המחדל וכל בנייה מ-main: כבויה ('off').
{const v=process.env.SITE_BACKEND||'',isMain=process.env.GITHUB_REF==='refs/heads/main',sb=!isMain&&['emulator','test'].includes(v)?v:'off';
 fs.writeFileSync('www/orders/site-backend.js',"/* נכתב בבנייה (scripts/prepare.js). 'off' = הלשונית כבויה */\nwindow.LP_SITE_BACKEND = '"+sb+"';\n");console.log('SITE_BACKEND:',sb)}
// barcode decoder (ZXing)
try{const zd='node_modules/@zxing/library/umd';const zf=fs.existsSync(zd+'/index.min.js')?'index.min.js':fs.readdirSync(zd).find(f=>/\.min\.js$/.test(f));fs.copyFileSync(zd+'/'+zf,'www/zxing.min.js');console.log('zxing ok',zf)}catch(e){console.log('zxing missing, continuing',e.message)}
// OCR engine (Tesseract) -> www/tess
fs.mkdirSync('www/tess',{recursive:true});
fs.copyFileSync('node_modules/tesseract.js/dist/tesseract.min.js','www/tess/tesseract.min.js');
fs.copyFileSync('node_modules/tesseract.js/dist/worker.min.js','www/tess/worker.min.js');
const cd='node_modules/tesseract.js-core';
const core=fs.readdirSync(cd).filter(f=>/^tesseract-core.*lstm.*\.(js|wasm)$/.test(f));
if(core.length<2)throw new Error('tesseract core files not found: '+fs.readdirSync(cd).join(','));
core.forEach(f=>fs.copyFileSync(path.join(cd,f),path.join('www/tess',f)));
(async()=>{
  for(const l of ['heb','eng']){
    const repo=l==='heb'?'tessdata_best':'tessdata_fast';
    const r=await fetch('https://github.com/tesseract-ocr/'+repo+'/raw/main/'+l+'.traineddata');
    if(!r.ok)throw new Error('language data '+l+' http '+r.status);
    const b=Buffer.from(await r.arrayBuffer());
    if(b.length<500000)throw new Error('language data '+l+' too small: '+b.length);
    fs.writeFileSync('www/tess/'+l+'.traineddata',b);
  }
  console.log('OCR files:',fs.readdirSync('www/tess').join(' '));
})().catch(e=>{console.error(e);process.exit(1)});
