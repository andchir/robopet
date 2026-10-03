// MODEL_DIR points to the official pinned model bundle; weights stay outside Git.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../www');
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 const file=p.startsWith('/fixture/')?path.join(process.env.MODEL_DIR,p.split('/').pop()):path.join(root,p);
 const target=fs.existsSync(file)&&fs.statSync(file).isFile()?file:path.join(root,'index.html');
 res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.html':'text/html','.css':'text/css'})[path.extname(target)]||'application/octet-stream');
 res.setHeader('Access-Control-Allow-Origin','*');fs.createReadStream(target).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(14205,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 try{
 const page=await browser.newPage();
 await page.addInitScript(()=>localStorage.setItem('CapacitorStorage.sttMode','native'));
 await page.goto('http://127.0.0.1:14205/settings');
 await page.getByText('Listen',{exact:true}).click();
 await page.locator('ion-modal ion-title').filter({hasText:'Supertonic 3'}).waitFor();
 console.log('Missing model opens download modal');
 await page.getByText('Close',{exact:true}).click();
 await page.locator('ion-modal ion-content').waitFor({state:'hidden'});
 await page.evaluate(()=>{
  window.ttsWorker=new Worker('/assets/supertonic/worker.mjs',{type:'module'});
  let id=0;const pending=new Map();window.progress=[];
  window.ttsWorker.onmessage=({data})=>{if(data.progress!==undefined){window.progress.push(data.progress);return;}const p=pending.get(data.id);pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
  window.rpc=(type,values={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});window.ttsWorker.postMessage({id,type,...values});});
 });
 assert.equal(await page.evaluate(()=>window.rpc('status')),false);
 // Real download path and integrity validation, redirected to locally cached official files.
 await page.route('https://huggingface.co/**',route=>route.fulfill({status:307,headers:{location:'http://127.0.0.1:14205/fixture/'+route.request().url().split('/').pop(),'access-control-allow-origin':'*'}}));
 await page.evaluate(()=>window.rpc('download'));assert.equal(await page.evaluate(()=>window.rpc('status')),true);
 assert.ok(await page.evaluate(()=>window.progress.some(v=>v>0&&v<1)));
 console.log('Full download, checksums, persistence and progress passed');
 await page.unroute('https://huggingface.co/**');
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:14205)/, route => route.abort());
 for(const [lang,voice,text] of [['ru-RU','M1','Привет! Я Робопет.'],['en-US','F1','Hello! I am RoboPet.']]){
 const result=await page.evaluate(async values=>{const r=await window.rpc('synthesize',values);let energy=0;for(const x of r.audio){if(!Number.isFinite(x))throw Error('Non-finite PCM');energy+=x*x;}return {samples:r.audio.length,sampleRate:r.sampleRate,energy};},{lang,voice,text});
 assert.ok(result.samples>result.sampleRate);assert.ok(result.energy>0.01);console.log(lang,voice,result);
 }
 await page.context().setOffline(false);
 await page.evaluate(()=>window.ttsWorker.terminate());
 console.log('Offline real RU/EN synthesis passed');
 await page.getByText('Listen',{exact:true}).click();
 await page.getByText('Stop',{exact:true}).click();
 await page.getByText('Listen',{exact:true}).waitFor();
 console.log('Preview interruption passed');
 await page.getByText('Listen',{exact:true}).click();
 await page.getByText('Stop',{exact:true}).waitFor();
 await page.getByText('Listen',{exact:true}).waitFor({timeout:120000});
 assert.equal(await page.locator('ion-modal ion-content:visible').count(),0);
 console.log('Actual preview synthesis and playback passed');
 const presets=page.locator('ion-select').filter({has:page.locator('ion-select-option').filter({hasText:'Female 5'})});
 assert.equal(await presets.locator('ion-select-option').count(),10);
 await presets.evaluate(el=>{el.value='F5';el.dispatchEvent(new CustomEvent('ionChange',{detail:{value:'F5'},bubbles:true}));});
 await page.getByText('Save',{exact:true}).click();
 await page.waitForFunction(()=>localStorage.getItem('CapacitorStorage.ttsVoice')==='F5');
 await page.reload();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('ion-select')).some(el=>el.value==='F5'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('CapacitorStorage.ttsEngine')),'supertonic');
 console.log('All ten voices available; selected voice and engine persist after reload');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
