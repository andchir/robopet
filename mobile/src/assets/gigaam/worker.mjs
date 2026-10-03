import * as ort from './ort/ort.wasm.min.mjs';
import { MODELS, readModel, saveModel, hasModel } from './models.mjs';
import { parseVocabulary, extractFeatures, decodeCtc, chunkAudio } from './core.mjs';
ort.env.wasm.wasmPaths = new URL('./ort/', import.meta.url).href;
ort.env.wasm.numThreads = 1; // Works without cross-origin isolation in Android WebView.
let session, activeKey, tokens, downloadController;
async function download(key, id) {
  const model = MODELS[key];
  downloadController = new AbortController();
  const url = file => `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file}`;
  const response = await fetch(url(model.file), {signal: downloadController.signal});
  if (!response.ok || !response.body) throw Error(`Download failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(model.size), reader = response.body.getReader();
  let loaded = 0;
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    if (loaded + value.length > bytes.length) { await reader.cancel(); throw Error('Unexpected model size'); }
    bytes.set(value, loaded); loaded += value.length;
    postMessage({id, progress: loaded / model.size * 0.95});
  }
  if (loaded !== model.size) throw Error('Incomplete model download');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== model.sha) throw Error('Model checksum mismatch');
  const vocabulary = await fetch(url(model.vocab), {signal: downloadController.signal});
  if (!vocabulary.ok) throw Error(`Vocabulary download failed: HTTP ${vocabulary.status}`);
  const text = await vocabulary.text(); parseVocabulary(text, model.tokens);
  downloadController.signal.throwIfAborted();
  await saveModel(key, {bytes: bytes.buffer, text});
  postMessage({id, progress: 1});
}
async function initialize(key) {
  if (session && activeKey === key) return;
  if (session) { await session.release(); session = null; }
  const saved = await readModel(key);
  if (!saved) throw Error('MODEL_MISSING');
  tokens = parseVocabulary(saved.text, MODELS[key].tokens);
  session = await ort.InferenceSession.create(saved.bytes, {executionProviders: ['wasm']});
  activeKey = key;
}
let queue = Promise.resolve();
self.onmessage = ({data}) => {
  if (data.type === 'cancel') { downloadController?.abort(); return; }
  queue = queue.then(async () => {
    const {id, key, type} = data;
    try {
      let result;
      if (type === 'status') result = await hasModel(key);
      else if (type === 'download') { await download(key, id); result = true; }
      else if (type === 'initialize') { await initialize(key); result = true; }
      else if (type === 'transcribe') {
        await initialize(key);
        const texts = [];
        for (const piece of chunkAudio(data.audio)) {
          if (piece.length < 1600) continue;
          const {features, frames} = extractFeatures(piece);
          const input = new ort.Tensor('float32', features, [1, 64, frames]);
          const length = new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]);
          let output;
          try {
            output = await session.run({features: input, feature_lengths: length});
            const logits = output[session.outputNames[0]];
            texts.push(decodeCtc(logits.data, logits.dims, tokens));
          } finally { input.dispose(); length.dispose(); if (output) Object.values(output).forEach(t => t.dispose()); }
        }
        result = texts.filter(Boolean).join(' ');
      } else throw Error('Unknown command');
      postMessage({id, result});
    } catch (error) { postMessage({id: data.id, error: error.message || String(error)}); }
    finally { downloadController = undefined; }
  });
};
