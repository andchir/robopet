import { SpeechTestPage } from './speech-test.page';
import { Preferences } from '@capacitor/preferences';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => resolve = r);
  return {promise, resolve};
}
const settle = () => new Promise(r => setTimeout(r, 0));

describe('Speech test GigaAM recording lifecycle', () => {
  let page: SpeechTestPage;
  let voice: any;
  let gigaam: any;
  beforeEach(() => {
    voice = jasmine.createSpyObj('VoiceService', ['stopSpeaking', 'requestPermission', 'startRecording', 'stopRecording']);
    voice.stopSpeaking.and.resolveTo(); voice.requestPermission.and.resolveTo(true);
    voice.startRecording.and.resolveTo(); voice.stopRecording.and.resolveTo('audio');
    gigaam = jasmine.createSpyObj('GigaAmService', ['initialize', 'transcribe', 'preload']);
    gigaam.initialize.and.resolveTo(); gigaam.transcribe.and.resolveTo('');
    page = new SpeechTestPage({} as any, voice, gigaam, {} as any,
      {translate: (key: string) => key} as any, {run: (fn: () => void) => fn()} as any, {detectChanges: () => {}} as any);
  });
  afterEach(() => page.ngOnDestroy());
  it('waits for model initialization and ignores repeated taps while starting', async () => {
    const init = deferred<void>(); gigaam.initialize.and.returnValue(init.promise);
    const started = page.toggle(); await settle();
    expect(page.isStarting).toBeTrue(); expect(page.isListening).toBeFalse();
    await page.toggle(); expect(voice.stopRecording).not.toHaveBeenCalled();
    init.resolve(); await started;
    expect(voice.startRecording).toHaveBeenCalledTimes(1);
    expect(page.isStarting).toBeFalse(); expect(page.isListening).toBeTrue();
    await page.toggle();
    expect(gigaam.transcribe).toHaveBeenCalledWith('audio', 'en');
    expect(page.isProcessing).toBeFalse();
  });
  it('does not start the microphone after leaving during model loading', async () => {
    const init = deferred<void>(); gigaam.initialize.and.returnValue(init.promise);
    const started = page.toggle(); await settle(); page.ionViewWillLeave();
    init.resolve(); await started;
    expect(voice.startRecording).not.toHaveBeenCalled(); expect(page.isListening).toBeFalse();
  });
  it('releases a recording that starts after leaving the page', async () => {
    const record = deferred<void>(); voice.startRecording.and.returnValue(record.promise);
    const started = page.toggle(); await settle(); page.ionViewWillLeave();
    record.resolve(); await started;
    expect(voice.stopRecording).toHaveBeenCalledTimes(1); expect(gigaam.transcribe).not.toHaveBeenCalled();
  });
  it('stops recording without transcription on navigation', async () => {
    await page.toggle(); page.ionViewWillLeave(); await settle();
    expect(voice.stopRecording).toHaveBeenCalledTimes(1);
    expect(gigaam.transcribe).not.toHaveBeenCalled(); expect(page.isProcessing).toBeFalse();
  });
  it('discards transcription that finishes after leaving', async () => {
    const result = deferred<string>(); gigaam.transcribe.and.returnValue(result.promise);
    await page.toggle(); const stopped = page.toggle(); await settle();
    page.ionViewWillLeave(); result.resolve('stale words'); await stopped;
    expect(page.currentWord).toBeNull(); expect(page.transcript).toEqual([]);
    expect(page.isProcessing).toBeFalse();
  });
  it('shows permission and recording errors without getting stuck', async () => {
    voice.requestPermission.and.rejectWith(new Error('permission failed'));
    await page.toggle(); expect(page.statusKey).toBe('speech-test.status-error'); expect(page.isStarting).toBeFalse();
    voice.requestPermission.and.resolveTo(true); await page.toggle();
    voice.stopRecording.and.rejectWith(new Error('recorder failed')); await page.toggle();
    expect(page.statusKey).toBe('speech-test.status-error'); expect(page.isProcessing).toBeFalse();
  });
  it('reloads language when returning to the cached Ionic page', async () => {
    await Preferences.set({key: 'ttsLang', value: 'ru-RU'});
    await page.ionViewWillEnter(); expect(page.ttsLang).toBe('ru-RU');
    await Preferences.set({key: 'ttsLang', value: 'en-US'});
    await page.ionViewWillEnter(); expect(page.ttsLang).toBe('en-US');
    await Preferences.remove({key: 'ttsLang'});
  });
});
