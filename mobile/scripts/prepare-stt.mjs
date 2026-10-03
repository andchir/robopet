// Runtime files ship with the app; model weights are downloaded only by the user.
import { access } from 'node:fs/promises';
await access(new URL('../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url));
