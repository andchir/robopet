import { BehaviorSubject, Subject, of } from 'rxjs';
import { VoiceButtonComponent } from './voice-button.component';

describe('Voice button and auto conversation', () => {
  let component: VoiceButtonComponent;
  let voice: any, chat: any, gigaam: any, vad: any;
  let speaking: BehaviorSubject<boolean>, speechEnd: Subject<void>, ttsStart: Subject<void>;
  const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
  beforeEach(() => {
    speaking = new BehaviorSubject(false); speechEnd = new Subject(); ttsStart = new Subject();
    voice = {
      isSpeaking$: speaking, isRecording$: of(false), onTtsStart$: ttsStart,
      requestPermission: jasmine.createSpy().and.resolveTo(true),
      startRecording: jasmine.createSpy().and.resolveTo(), stopRecording: jasmine.createSpy().and.resolveTo('audio'),
      startRecordingFromStream: jasmine.createSpy(), stopRecordingFromStream: jasmine.createSpy().and.resolveTo('audio'),
      cancelStreamRecording: jasmine.createSpy(), stopSpeaking: jasmine.createSpy().and.resolveTo(),
    };
    chat = {getSttMode: () => 'gigaam', getLanguage: () => 'ru', processMessage: jasmine.createSpy(), notifyInterrupted: jasmine.createSpy()};
    gigaam = {isLoading$: of(false),isTranscribing$: of(false),isBusy$: of(false),initialize:jasmine.createSpy().and.resolveTo(),transcribe:jasmine.createSpy().and.resolveTo('Привет')};
    vad = {start:jasmine.createSpy().and.resolveTo(),stop:jasmine.createSpy(),reset:jasmine.createSpy(),getStream:()=>({}),onSpeechEnd$:speechEnd};
    const native = {isListening$:of(false),isProcessing$:of(false)};
    component = new VoiceButtonComponent(voice,chat,gigaam,native as any,native as any,vad,{startSession:()=>{},streamFinalTranscript:async()=>{}} as any);
    (component as any).permissionGranted = true;
    speaking.subscribe(value => (component as any).currentlySpeaking = value);
  });
  it('a quick release waits for start; duplicate events transcribe exactly once', async () => {
    let finish!: () => void;
    voice.startRecording.and.returnValue(new Promise<void>(resolve=>finish=resolve));
    const start=component.onPress(); await flush();
    const end=component.onRelease(); const duplicate=component.onRelease();
    expect(voice.stopRecording).not.toHaveBeenCalled();
    finish(); await Promise.all([start,end,duplicate]);
    expect(voice.startRecording).toHaveBeenCalledTimes(1);
    expect(gigaam.transcribe).toHaveBeenCalledTimes(1);
    expect(chat.processMessage).toHaveBeenCalledOnceWith('Привет');
  });
  it('auto pause answers once and restarts listening', async () => {
    component.autoMode=true; await component.onAutoModeChange();
    speechEnd.next(); speechEnd.next(); await flush();
    expect(chat.processMessage).toHaveBeenCalledOnceWith('Привет');
    expect(voice.startRecordingFromStream).toHaveBeenCalledTimes(2);
    component.autoMode=false; await component.onAutoModeChange();
    expect(voice.cancelStreamRecording).toHaveBeenCalled();
  });
  it('does not record the robot reply; resumes after TTS', async () => {
    chat.processMessage.and.callFake(()=>{ ttsStart.next(); speaking.next(true); });
    component.autoMode=true; await component.onAutoModeChange();
    speechEnd.next(); await flush();
    expect(voice.startRecordingFromStream).toHaveBeenCalledTimes(1);
    speechEnd.next(); await flush(); expect(chat.processMessage).toHaveBeenCalledTimes(1);
    speaking.next(false); await flush();
    expect(voice.startRecordingFromStream).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });
  it('turning Auto off during recognition discards stale text', async () => {
    let finish!: (text:string)=>void;
    gigaam.transcribe.and.returnValue(new Promise<string>(resolve=>finish=resolve));
    component.autoMode=true; await component.onAutoModeChange(); speechEnd.next(); await flush();
    component.autoMode=false; await component.onAutoModeChange();
    finish('stale'); await flush(); expect(chat.processMessage).not.toHaveBeenCalled();
  });
  it('missing model leaves Auto off and does not capture audio', async () => {
    gigaam.initialize.and.rejectWith(new Error('MODEL_MISSING'));
    component.autoMode=true; await component.onAutoModeChange();
    expect(component.autoMode).toBeFalse(); expect(vad.start).not.toHaveBeenCalled();
    await component.onPress(); await component.onRelease();
    expect(voice.startRecording).not.toHaveBeenCalled(); expect(gigaam.transcribe).not.toHaveBeenCalled();
  });
});
