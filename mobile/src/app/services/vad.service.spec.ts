import { NgZone } from '@angular/core';
import { VadService } from './vad.service';

describe('Voice pause detection', () => {
  let vad: VadService;
  let now: number;
  let ends: number;
  const sound = new Float32Array(2048).fill(0.1);
  const silence = new Float32Array(2048);
  function tick(data: Float32Array, ms: number): void {
    now += ms;
    (vad as any).processAudio(data);
  }
  beforeEach(() => {
    now = 0; ends = 0;
    spyOn(Date, 'now').and.callFake(() => now);
    vad = new VadService({ run: (fn: () => void) => fn() } as NgZone);
    vad.onSpeechEnd$.subscribe(() => ends++);
  });
  it('emits once after speech followed by 800 ms silence', () => {
    tick(sound, 0); tick(sound, 300); tick(silence, 50);
    tick(silence, 799); expect(ends).toBe(0);
    tick(silence, 1); expect(ends).toBe(1);
    tick(silence, 2000); expect(ends).toBe(1);
  });
  it('does not answer silence, clicks or short pauses', () => {
    tick(silence, 1000); tick(sound, 10); tick(silence, 50); tick(silence, 210);
    expect(ends).toBe(0);
    tick(sound, 10); tick(sound, 300); tick(silence, 50); tick(silence, 400);
    tick(sound, 10); expect(ends).toBe(0);
    tick(silence, 10); tick(silence, 800); expect(ends).toBe(1);
  });
  it('reset prevents robot speech from triggering the next utterance', () => {
    tick(sound, 10); tick(sound, 300); vad.reset();
    tick(silence, 1000); tick(silence, 1000); expect(ends).toBe(0);
  });
});
