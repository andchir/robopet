const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'../www');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/slow-model'){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Content-Type','application/octet-stream');
  const timer=setInterval(()=>res.write(Buffer.alloc(65536)),100);
  req.on('close',()=>clearInterval(timer));return;
 }
 const file=path.join(root,url.pathname==='/'?'index.html':url.pathname);
 const target=fs.existsSync(file)&&fs.statSync(file).isFile()?file:path.join(root,'index.html');
 const ext=path.extname(target);
 res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json','.css':'text/css'})[ext]||'application/octet-stream');
 fs.createReadStream(target).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(14200,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 let modelRequests=0, slow=false;
 await page.route('https://huggingface.co/**',route=>{modelRequests++;return slow ? route.fulfill({status:307,headers:{location:'http://127.0.0.1:14200/slow-model','access-control-allow-origin':'*'}}) : route.abort();});
 await page.goto('http://127.0.0.1:14200/settings');
 await page.getByText('Download model',{exact:true}).waitFor();
 await page.getByText('Language: English',{exact:true}).waitFor();
 if(await page.locator('ion-modal ion-button').filter({hasText:'Multilingual'}).count())throw Error('Model selector still present');
 await page.waitForTimeout(1500);
 if(modelRequests)throw Error('Model downloaded automatically');
 await page.getByText('Download model',{exact:true}).click();
 await page.locator('ion-modal [role="alert"]').waitFor();
 slow=true;
 await page.getByText('Download model',{exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('ion-progress-bar')?.value > 0);
 await page.getByText('Cancel',{exact:true}).click();
 await page.locator('ion-modal [role="alert"]').waitFor();
 await page.getByText('Close',{exact:true}).click();
 await page.locator('ion-modal ion-content').waitFor({state:'hidden'});
 const status=await page.evaluate(()=>new Promise((resolve,reject)=>{
 const worker=new Worker('/assets/gigaam/worker.mjs',{type:'module'});
 worker.onmessage=({data})=>{worker.terminate();data.error?reject(data.error):resolve(data.result);};
 worker.onerror=e=>reject(e.message);worker.postMessage({id:1,type:'status',key:'en'});
 }));
 if(status!==false)throw Error('Failed download marked installed');
 const languageSelect=page.locator('ion-select').filter({has:page.locator('ion-select-option[value="ru-RU"]')});
 await languageSelect.evaluate(element=>{element.value='ru-RU';element.dispatchEvent(new CustomEvent('ionChange',{detail:{value:'ru-RU'},bubbles:true}));});
 await page.getByText('Language: Russian',{exact:true}).waitFor();
 await page.getByText('Close',{exact:true}).click();
 await page.locator('ion-modal ion-content').waitFor({state:'hidden'});
 await languageSelect.evaluate(element=>{element.value='en-US';element.dispatchEvent(new CustomEvent('ionChange',{detail:{value:'en-US'},bubbles:true}));});
 await page.getByText('Language: English',{exact:true}).waitFor();
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: automatic language model dialog on startup and language changes; no automatic download; network failure/retry; download progress/cancel; incomplete model not installed; bundled worker/runtime loads.');
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
