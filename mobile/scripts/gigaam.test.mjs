import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseVocabulary, decodeCtc, extractFeatures, chunkAudio} from '../src/assets/gigaam/core.mjs';
test('vocabulary preserves literal space and rejects missing / duplicate IDs', () => {
  assert.deepEqual(parseVocabulary('  0\na 1\n<blk> 2\n', 3), [' ', 'a', '<blk>']);
  assert.throws(() => parseVocabulary('a 0\nb 0\n<blk> 2', 3));
  assert.throws(() => parseVocabulary('a 0\n<blk> 2', 3));
});
test('CTC collapses repeats, resets on blank, joins word pieces', () => {
  const ids = [0,0,2,0,1,1,2];
  const logits = Float32Array.from(ids.flatMap(id => [0,1,2].map(k => k === id ? 10 : -10)));
  assert.equal(decodeCtc(logits,[1,7,3],['a','▁b','<blk>']), 'aa b');
});
test('silence produces finite log-mel floor with unpadded frame count', () => {
  const {features,frames} = extractFeatures(new Float32Array(16000));
  assert.equal(frames, 99); assert.equal(features.length, 64*99);
  assert.ok(features.every(v => Math.abs(v - Math.log(1e-9)) < 1e-5));
});
test('mel spectrum localizes a 1 kHz sine', () => {
  const {features,frames} = extractFeatures(Float32Array.from({length:1600},(_,i)=>Math.sin(2*Math.PI*1000*i/16000)));
  const energies=Array.from({length:64},(_,m)=>features[m*frames]);
  const peak=energies.indexOf(Math.max(...energies));
  assert.ok(peak >= 20 && peak <= 24);
});
test('long audio is split without loss and below 25 seconds', () => {
  const audio = new Float32Array(16000*65);
  const chunks=chunkAudio(audio);
  assert.equal(chunks.reduce((sum,c)=>sum+c.length,0),audio.length);
  assert.ok(chunks.every(c=>c.length<=24*16000 && c.length>0));
});
