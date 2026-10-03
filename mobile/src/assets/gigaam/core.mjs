// Feature contract and CTC decoding adapted from giga-pisar-android (MIT).
export function parseVocabulary(text, size) {
  const tokens = [];
  for (const line of text.split(/\r?\n/).filter(l => l.trim())) {
    const split = line.lastIndexOf(' ');
    const id = Number(line.slice(split + 1));
    if (split < 1 || !Number.isInteger(id) || id < 0 || id >= size || tokens[id] !== undefined) throw Error('Invalid vocabulary');
    tokens[id] = line.slice(0, split);
  }
  if (tokens.length !== size || Array.from(tokens).some(t => t === undefined) || tokens[size - 1] !== '<blk>') throw Error('Invalid vocabulary');
  return tokens;
}
export function decodeCtc(data, dims, tokens) {
  if (dims.length !== 3 || dims[0] !== 1 || dims[2] !== tokens.length) throw Error('Unexpected model output');
  let previous = -1, text = '';
  for (let t = 0; t < dims[1]; t++) {
    let best = 0;
    for (let k = 1; k < tokens.length; k++) if (data[t * tokens.length + k] > data[t * tokens.length + best]) best = k;
    if (best !== previous && best !== tokens.length - 1 && tokens[best] !== '<unk>') text += tokens[best];
    previous = best;
  }
  return text.replace(/▁/g, ' ').replace(/\s+/g, ' ').trim();
}
const N = 320, HOP = 160, BINS = 161, MELS = 64;
const window = Float32Array.from({length: N}, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N));
const cos = Float32Array.from({length: BINS * N}, (_, i) => Math.cos(2 * Math.PI * Math.floor(i / N) * (i % N) / N));
const sin = Float32Array.from({length: BINS * N}, (_, i) => Math.sin(2 * Math.PI * Math.floor(i / N) * (i % N) / N));
const points = Array.from({length: MELS + 2}, (_, i) => 700 * (Math.pow(1 + 8000 / 700, i / (MELS + 1)) - 1));
const filters = Float32Array.from({length: MELS * BINS}, (_, i) => {
  const m = Math.floor(i / BINS), hz = (i % BINS) * 50;
  return Math.max(0, Math.min((hz - points[m]) / (points[m+1] - points[m]), (points[m+2] - hz) / (points[m+2] - points[m+1])));
});
export function extractFeatures(audio) {
  if (audio.length < N) throw Error('Audio too short');
  const frames = Math.floor((audio.length - N) / HOP) + 1;
  const features = new Float32Array(MELS * frames), x = new Float32Array(N), power = new Float32Array(BINS);
  for (let t = 0; t < frames; t++) {
    for (let n = 0; n < N; n++) x[n] = audio[t * HOP + n] * window[n];
    for (let k = 0; k < BINS; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) { re += x[n] * cos[k * N + n]; im += x[n] * sin[k * N + n]; }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < MELS; m++) {
      let energy = 0;
      for (let k = 0; k < BINS; k++) energy += power[k] * filters[m * BINS + k];
      features[m * frames + t] = Math.log(Math.max(energy, 1e-9));
    }
  }
  return { features, frames };
}
// Cut near a quiet 100 ms window, with a hard limit below the model's 25 s.
export function chunkAudio(audio) {
  const chunks = [];
  let start = 0;
  while (start < audio.length) {
    let end = Math.min(start + 24 * 16000, audio.length);
    if (end < audio.length) {
      let best = Infinity;
      const limit = end;
      for (let at = limit - 3 * 16000; at <= limit - 1600; at += 1600) {
        let energy = 0;
        for (let n = at; n < at + 1600; n++) energy += audio[n] ** 2;
        if (energy < best) { best = energy; end = at + 800; }
      }
    }
    chunks.push(audio.subarray(start, end)); start = end;
  }
  return chunks;
}
