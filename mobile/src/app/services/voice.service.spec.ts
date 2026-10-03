import { VoiceService } from './voice.service';
import { SupertonicService } from './supertonic.service';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { Preferences } from '@capacitor/preferences';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => resolve = r);
  return {promise, resolve};
}

describe('VoiceService offline speech lifecycle', () => {
  let service: VoiceService;
  let supertonic: jasmine.SpyObj<SupertonicService>;
  let source: any;
  let context: any;
  let speaking: boolean;
  let preparing: boolean;
  let playing: boolean;
  beforeEach(async () => {
    supertonic = jasmine.createSpyObj('SupertonicService', ['synthesize', 'cancelSynthesis']);
    source = {connect: jasmine.createSpy(), disconnect: jasmine.createSpy(), start: jasmine.createSpy(), stop: jasmine.createSpy(), onended: null};
    context = {resume: () => Promise.resolve(), createBuffer: () => ({copyToChannel: jasmine.createSpy()}), createBufferSource: jasmine.createSpy().and.returnValue(source), destination: {}};
    spyOn(window, 'AudioContext').and.returnValue(context);
    spyOn(window.speechSynthesis, 'cancel');
    spyOn(window.speechSynthesis, 'speak').and.callFake(utterance => {utterance.dispatchEvent(new Event('end'));});
    await TextToSpeech.stop();
    await Preferences.set({key: 'ttsEngine', value: 'supertonic'});
    await Preferences.set({key: 'ttsVoice', value: 'F3'});
    service = new VoiceService(supertonic);
    service.isSpeaking$.subscribe(value => speaking = value);
    service.isPreparing$.subscribe(value => preparing = value);
    service.isPlaying$.subscribe(value => playing = value);
  });
  afterEach(async () => {
    await Preferences.remove({key: 'ttsEngine'});
    await Preferences.remove({key: 'ttsVoice'});
  });
  it('keeps automatic microphone capture suppressed until synthesis AND playback finish', async () => {
    const synthesis = deferred<{audio: Float32Array; sampleRate: number}>();
    supertonic.synthesize.and.returnValue(synthesis.promise);
    const done = service.speak('Привет', 'ru-RU');
    await new Promise(r => setTimeout(r));
    expect(speaking).toBeTrue();
    expect(preparing).toBeTrue();
    expect(playing).toBeFalse();
    expect(supertonic.synthesize).toHaveBeenCalledWith('Привет', 'ru-RU', 'F3');
    synthesis.resolve({audio: new Float32Array(20), sampleRate: 44100});
    await new Promise(r => setTimeout(r));
    expect(source.start).toHaveBeenCalled(); expect(speaking).toBeTrue();
    expect(preparing).toBeFalse();
    expect(playing).toBeTrue();
    source.onended(); await done;
    expect(playing).toBeFalse();
    expect(speaking).toBeFalse();
  });
  it('does not play a synthesis result that arrives after Stop', async () => {
    const synthesis = deferred<{audio: Float32Array; sampleRate: number}>();
    supertonic.synthesize.and.returnValue(synthesis.promise);
    const done = service.speak('Hello', 'en-US', 'supertonic', 'M2');
    await new Promise(r => setTimeout(r));
    await service.stopSpeaking();
    expect(preparing).toBeFalse();
    synthesis.resolve({audio: new Float32Array(20), sampleRate: 44100});
    await done;
    expect(source.start).not.toHaveBeenCalled(); expect(speaking).toBeFalse();
    expect(playing).toBeFalse();
  });
  it('clears the spinner when the model download is required', async () => {
    supertonic.synthesize.and.resolveTo(null);
    await service.speak('Hello', 'en-US', 'supertonic', 'M1');
    expect(preparing).toBeFalse(); expect(speaking).toBeFalse();
    expect(source.start).not.toHaveBeenCalled();
  });
  it('uses the system engine when explicitly selected for preview', async () => {
    await service.speak('Hello', 'en-US', 'system', 'M1');
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
    const utterance = (window.speechSynthesis.speak as jasmine.Spy).calls.mostRecent().args[0];
    expect(utterance.text).toBe('Hello'); expect(utterance.lang).toBe('en-US');
    expect(supertonic.synthesize).not.toHaveBeenCalled(); expect(speaking).toBeFalse();
  });
  it('waits for browser speech to actually start before animating', async () => {
    (window.speechSynthesis.speak as jasmine.Spy).and.stub();
    const done = service.speak('Hello', 'en-US', 'system');
    await new Promise(r => setTimeout(r));
    const utterance = (window.speechSynthesis.speak as jasmine.Spy).calls.mostRecent().args[0];
    expect(speaking).toBeTrue(); expect(preparing).toBeTrue(); expect(playing).toBeFalse();
    utterance.dispatchEvent(new Event('start'));
    expect(playing).toBeTrue(); expect(preparing).toBeFalse();
    utterance.dispatchEvent(new Event('end')); await done;
    expect(playing).toBeFalse(); expect(speaking).toBeFalse();
  });
  it('does not animate while the audio context is waiting to resume', async () => {
    const resumed = deferred<void>();
    context.resume = () => resumed.promise;
    supertonic.synthesize.and.resolveTo({audio: new Float32Array(20), sampleRate: 44100});
    const done = service.speak('Hello');
    await new Promise(r => setTimeout(r));
    expect(playing).toBeFalse(); expect(source.start).not.toHaveBeenCalled();
    resumed.resolve(); await new Promise(r => setTimeout(r));
    expect(playing).toBeTrue();
    await service.stopSpeaking(); await done;
    expect(playing).toBeFalse();
  });
  it('ignores a delayed browser start event after cancellation', async () => {
    (window.speechSynthesis.speak as jasmine.Spy).and.stub();
    const done = service.speak('Hello', 'en-US', 'system');
    await new Promise(r => setTimeout(r));
    const utterance = (window.speechSynthesis.speak as jasmine.Spy).calls.mostRecent().args[0];
    await service.stopSpeaking(); await done;
    utterance.dispatchEvent(new Event('start'));
    expect(playing).toBeFalse(); expect(preparing).toBeFalse();
  });

});
