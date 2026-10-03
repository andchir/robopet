const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'../www');
const fixtureDir=process.env.STT_FIXTURE_DIR;
if(!fixtureDir) throw Error('Set STT_FIXTURE_DIR containing ru.onnx, ru-vocab.txt and microphone.wav.');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/slow-model'){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Content-Type','application/octet-stream');
  const timer=setInterval(()=>res.write(Buffer.alloc(65536)),100);
  req.on('close',()=>clearInterval(timer));return;
 }
 const file=url.pathname==='/fixture-model'?path.join(fixtureDir,'ru.onnx'):url.pathname==='/fixture-vocab'?path.join(fixtureDir,'ru-vocab.txt'):path.join(root,url.pathname==='/'?'index.html':url.pathname);
 const target=fs.existsSync(file)&&fs.statSync(file).isFile()?file:path.join(root,'index.html');
 const ext=path.extname(target);
 res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json','.css':'text/css'})[ext]||'application/octet-stream');
 fs.createReadStream(target).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(14200,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+path.join(fixtureDir,'microphone.wav')]});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.addInitScript(()=>{window.recordedStreams=[]; const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await gum(constraints);window.recordedStreams.push(stream);return stream;};localStorage.setItem('CapacitorStorage.ttsLang','ru-RU');localStorage.setItem('CapacitorStorage.sttMode','gigaam');});
 page.on('pageerror',e=>console.error('PAGE ERROR',e));
 page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
 await page.goto('http://127.0.0.1:14200/');
 await page.evaluate(async()=>{const {saveModel}=await import('/assets/gigaam/models.mjs');await saveModel('ru',{bytes:await(await fetch('/fixture-model')).arrayBuffer(),text:await(await fetch('/fixture-vocab')).text()});});
 await page.route('https://**',route=>route.abort());
 await page.goto('http://127.0.0.1:14200/speech-test');
 await page.locator('.rec-btn').click();
 await page.locator('.rec-btn.active').waitFor({timeout:60000});
 console.log('PASS initialized model before showing recording');
 await page.waitForTimeout(6500);
 await page.locator('.rec-btn').click();
 await page.waitForFunction(()=>document.querySelector('.transcript')?.textContent.trim(),{},{timeout:90000});
 await page.locator('.rec-btn:not([disabled])').waitFor({timeout:90000});
 console.log('TRANSCRIPT:',await page.locator('.transcript').innerText());

 await page.locator('.rec-btn').click();await page.locator('.rec-btn.active').waitFor();
 await page.locator('ion-back-button').click();
 await page.waitForURL('**/settings');
 await page.waitForFunction(()=>window.recordedStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
 console.log('PASS leaving during recording releases all microphone tracks');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
