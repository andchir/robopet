export const MODELS = {
  ru: { name: 'GigaAM v3 · Русский', repo: 'istupakov/gigaam-v3-onnx', revision: '322c3b29492673eb7d0b434bfa9dfb8653e34d02', file: 'v3_e2e_ctc.int8.onnx', vocab: 'v3_e2e_ctc_vocab.txt', size: 224893347, sha: '2e3fcb7a7b66030336fd10c2fcfb033bd1dc7e1bf238fe5cfd83b1d0cfc9d28e', tokens: 257 },
  en: { name: 'GigaAM Multilingual · English', repo: 'i2z1/gigaam-multilingual-ctc-onnx-int8', revision: 'ba9011bfb2e52cacad5a12e5d9346392d7825c76', file: 'model.int8.onnx', vocab: 'tokens.txt', size: 224762512, sha: '5f584553e20db1af7e0fff98728b6904b670eb6488b88da8e87cda7870a6235f', tokens: 71 },
};
export async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('robopet-gigaam', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('models');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readModel(key) {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('models').objectStore('models').get(MODELS[key].sha);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function saveModel(key, value) {
  const db = await database();
  try { await new Promise((resolve, reject) => {
    const tx = db.transaction('models', 'readwrite');
    tx.objectStore('models').put(value, MODELS[key].sha);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}

export async function hasModel(key) {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('models').objectStore('models').count(MODELS[key].sha);
    request.onsuccess = () => resolve(request.result > 0); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
