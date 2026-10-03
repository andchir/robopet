import * as ort from '../gigaam/ort/ort.wasm.min.mjs';
import {UnicodeProcessor} from './text.mjs';
import {FILES, REVISION, TOTAL} from './manifest.mjs';
ort.env.wasm.wasmPaths = new URL('../gigaam/ort/', import.meta.url).href;
ort.env.wasm.numThreads = 1;
let controller, sessions, cfg, processor;
async function dbOp(path, value, count = false) {
  const db = await new Promise((resolve,reject) => {
    const r=indexedDB.open('robopet-supertonic',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('files');
    r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
  });
  try { return await new Promise((resolve,reject)=>{
    const tx=db.transaction('files',value === undefined?'readonly':'readwrite');
    const store=tx.objectStore('files'), key=REVISION+'/'+path;
    const r=value === undefined?(count?store.count(key):store.get(key)):store.put(value,key);
    tx.oncomplete=()=>resolve(r.result); tx.onerror=tx.onabort=()=>reject(tx.error);
  }); } finally {db.close();}
}
async function installed() {
  for (const f of FILES) if (!await dbOp(f.path,undefined,true)) return false;
  return true;
}
async function download(id) {
  controller=new AbortController(); let loaded=0;
  for (const f of FILES) {
    controller.signal.throwIfAborted();
    if (await dbOp(f.path,undefined,true)) {loaded+=f.size; continue;}
    const r=await fetch(`https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/${REVISION}/${f.path}`,{signal:controller.signal});
    if (!r.ok || !r.body) throw Error(`HTTP ${r.status}`);
    const bytes=new Uint8Array(f.size), reader=r.body.getReader(); let offset=0;
    while (true) {
      const {done,value}=await reader.read(); if(done) break;
      if(offset+value.length>f.size) {await reader.cancel(); throw Error('Invalid file size');}
      bytes.set(value,offset); offset+=value.length;
      postMessage({id,progress:(loaded+offset)/TOTAL});
    }
    if(offset!==f.size) throw Error('Incomplete download');
    // Verify LFS SHA256 or the Git blob SHA1 for small JSON files.
    let input=bytes;
    if(!f.sha) {const prefix=new TextEncoder().encode(`blob ${bytes.length}\0`); input=new Uint8Array(prefix.length+bytes.length); input.set(prefix);input.set(bytes,prefix.length);}
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest(f.sha?'SHA-256':'SHA-1',input)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==(f.sha||f.blob)) throw Error('Checksum mismatch');
    controller.signal.throwIfAborted();
    await dbOp(f.path,bytes.buffer); loaded+=f.size;
  }
}
async function json(path) {const b=await dbOp(path);if(!b)throw Error('MODEL_MISSING');return JSON.parse(new TextDecoder().decode(b));}
async function initialize() {
  if(sessions) return;
  if(!await installed()) throw Error('MODEL_MISSING');
  cfg=await json('onnx/tts.json'); processor=new UnicodeProcessor(await json('onnx/unicode_indexer.json'));
  const created=[];
  try {
    for(const name of ['duration_predictor','text_encoder','vector_estimator','vocoder']) created.push(await ort.InferenceSession.create(await dbOp(`onnx/${name}.onnx`),{executionProviders:['wasm']}));
    sessions=created;
  } catch(e) {for(const s of created)await s.release();throw e;}
}
async function synthesize(text,lang,voice) {
  await initialize();
  if(!/^[MF][1-5]$/.test(voice)) throw Error('Invalid voice');
  const style=await json(`voice_styles/${voice}.json`), all=[], keep=[];
  const tensor=(type,data,dims)=>{const t=new ort.Tensor(type,data,dims);keep.push(t);return t;};
  const ttl=tensor('float32',Float32Array.from(style.style_ttl.data.flat(Infinity)),style.style_ttl.dims);
  const dp=tensor('float32',Float32Array.from(style.style_dp.data.flat(Infinity)),style.style_dp.dims);
  try {
    // Bound each inference even for long sentences without punctuation.
    const chunks=text.match(/.{1,220}(?:\s|$)|.{1,220}/gs)||[];
    for(const chunk of chunks) {
      const local=[];
      const t=(type,data,dims)=>{const v=new ort.Tensor(type,data,dims);local.push(v);return v;};
      const run=async(s,feeds)=>{const result=await s.run(feeds);local.push(...Object.values(result));return result;};
      try {
        const {textIds,textMask}=processor.call([chunk],[lang.startsWith('ru')?'ru':'en']);
        const ids=t('int64',BigInt64Array.from(textIds[0],BigInt),[1,textIds[0].length]);
        const mask=t('float32',Float32Array.from(textMask.flat(2)),[1,1,textIds[0].length]);
        const duration=(await run(sessions[0],{text_ids:ids,style_dp:dp,text_mask:mask})).duration.data[0]/1.05;
        if(!Number.isFinite(duration)||duration<=0||duration>60)throw Error('Invalid duration');
        const emb=(await run(sessions[1],{text_ids:ids,style_ttl:ttl,text_mask:mask})).text_emb;
        const n=Math.ceil(Math.floor(duration*cfg.ae.sample_rate)/(cfg.ae.base_chunk_size*cfg.ttl.chunk_compress_factor));
        const dims=[1,cfg.ttl.latent_dim*cfg.ttl.chunk_compress_factor,n];
        let latent=t('float32',Float32Array.from({length:dims[1]*n},()=>Math.sqrt(-2*Math.log(Math.max(.0001,Math.random())))*Math.cos(2*Math.PI*Math.random())),dims);
        const lm=t('float32',new Float32Array(n).fill(1),[1,1,n]);
        const steps=t('float32',Float32Array.of(5),[1]);
        for(let i=0;i<5;i++) {
          const step=t('float32',Float32Array.of(i),[1]);
          latent=(await run(sessions[2],{noisy_latent:latent,text_emb:emb,style_ttl:ttl,latent_mask:lm,text_mask:mask,current_step:step,total_step:steps})).denoised_latent;
        }
        const wav=(await run(sessions[3],{latent})).wav_tts;
        all.push(new Float32Array(wav.data.slice(0,Math.floor(duration*cfg.ae.sample_rate))));
        all.push(new Float32Array(Math.floor(.15*cfg.ae.sample_rate)));
      } finally {for(const v of local)v.dispose();}
    }
    const audio=new Float32Array(all.reduce((n,a)=>n+a.length,0));let offset=0;
    for(const a of all){audio.set(a,offset);offset+=a.length;}
    return {audio,sampleRate:cfg.ae.sample_rate};
  } finally {for(const v of keep)v.dispose();}
}
let queue=Promise.resolve();
self.onmessage=({data})=>{
  if(data.type==='cancel'){controller?.abort();return;}
  queue=queue.then(async()=>{
    try {
      let result;
      if(data.type==='status')result=await installed();
      else if(data.type==='download'){await download(data.id);result=true;}
      else if(data.type==='synthesize')result=await synthesize(data.text,data.lang,data.voice);
      else throw Error('Unknown command');
      postMessage({id:data.id,result},result?.audio?[result.audio.buffer]:[]);
    } catch(e){postMessage({id:data.id,error:e.name==='AbortError'?'CANCELLED':e.message});}
    finally{controller=undefined;}
  });
};
