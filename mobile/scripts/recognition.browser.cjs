const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'), http=require('node:http'), path=require('node:path');
const key=process.argv[2]||'ru';
const root=path.resolve(__dirname,'../www');
const fixtureDir=process.env.STT_FIXTURE_DIR;
if(!fixtureDir) throw Error('Set STT_FIXTURE_DIR with ru/en.onnx, ru/en-vocab.txt, ru/en.f32 (16 kHz mono float32).');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const fixtures={'/model':path.join(fixtureDir,`${key}.onnx`),'/vocab':path.join(fixtureDir,`${key}-vocab.txt`),'/speech':path.join(fixtureDir,`${key}.f32`)};
 const file=fixtures[url.pathname]||path.join(root,url.pathname==='/'?'index.html':url.pathname);
 res.setHeader('Access-Control-Allow-Origin','*');
 res.setHeader('Content-Type',(file.endsWith('.mjs')||file.endsWith('.js'))?'text/javascript':file.endsWith('.wasm')?'application/wasm':file.endsWith('.html')?'text/html':'application/octet-stream');
 res.setHeader('Content-Length',fs.statSync(file).size);
 fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(14201,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 try {
 const context=await browser.newContext();const page=await context.newPage();
 page.on('console',m=>{if(m.type()==='error')console.log('browser:',m.text());});
 await page.route('https://huggingface.co/**',route=>route.fulfill({status:307,headers:{location:'http://127.0.0.1:14201/'+(route.request().url().includes('.onnx')?'model':'vocab'),'access-control-allow-origin':'*'}}));
 await page.goto('http://127.0.0.1:14201/');
 await page.evaluate(()=>{
 window.testWorker=new Worker('/assets/gigaam/worker.mjs',{type:'module'}); window.seq=0;window.pending=new Map();window.progress=[];
 window.testWorker.onmessage=({data})=>{
 if(data.progress!==undefined){window.progress.push(data.progress);return;}
 const p=window.pending.get(data.id);window.pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);
 };
 window.call=(type,key,audio)=>new Promise((resolve,reject)=>{const id=++window.seq;window.pending.set(id,{resolve,reject});window.testWorker.postMessage({id,type,key,audio});});
 });
 console.time(`${key} download + verify + persist`);
 await page.evaluate(key=>window.call('download',key),key);
 console.timeEnd(`${key} download + verify + persist`);
 await page.unroute('https://huggingface.co/**');
 await page.route('https://**',route=>route.abort());
 console.time(`${key} offline inference`);
 const result=await page.evaluate(async key=>{
 const audio=new Float32Array(await (await fetch('/speech')).arrayBuffer());
 return await window.call('transcribe',key,audio);
 },key);
 console.timeEnd(`${key} offline inference`);
 if(!result)throw Error('Empty transcript for speech sample');
 if(key==='en' && !/[a-z]/i.test(result))throw Error('English fixture did not produce Latin text');
 console.log('OFFLINE TRANSCRIPT:',result);
 // New worker, same browser storage: session may reopen offline without downloading.
 await page.evaluate(()=>{window.testWorker.terminate();});
 const saved=await page.evaluate(async key=>{
 const {hasModel}=await import('/assets/gigaam/models.mjs');return hasModel(key);
 },key);
 if(!saved)throw Error('Model not persisted');
 console.log('PASS persistence and real WASM inference:',key);
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
