import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA, Pipe } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VoiceService } from '../../services/voice.service';
import { ChatService } from '../../services/chat.service';
import { GigaAmService } from '../../services/gigaam.service';
import { NativeSpeechService } from '../../services/native-speech.service';
import { CapacitorSpeechService } from '../../services/capacitor-speech.service';
import { VadService } from '../../services/vad.service';
import { SpeechStreamService } from '../../services/speech-stream.service';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { VoiceButtonComponent } from './voice-button.component';

@Pipe({name: 'transloco', standalone: false})
class TranslationStub { transform(value: string): string { return value; } }

describe('Voice button and auto conversation', () => {
  let component: VoiceButtonComponent;
  let voice: any, chat: any, gigaam: any, vad: any;
  let speaking: BehaviorSubject<boolean>, speechEnd: Subject<void>, ttsStart: Subject<void>;
  const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
  beforeEach(() => {
    speaking = new BehaviorSubject(false); speechEnd = new Subject(); ttsStart = new Subject();
    voice = {
      isSpeaking$: speaking, isPlaying$: speaking, isPreparing$: of(false), isRecording$: of(false), onTtsStart$: ttsStart,
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
  it('release while the microphone opens discards the take without answering', async () => {
    let finish!: () => void;
    voice.startRecording.and.returnValue(new Promise<void>(resolve=>finish=resolve));
    const start=component.onPress(); await flush();
    const end=component.onRelease(); const duplicate=component.onRelease();
    expect(voice.stopRecording).not.toHaveBeenCalled();
    finish(); await Promise.all([start,end,duplicate]);
    expect(voice.startRecording).toHaveBeenCalledTimes(1);
    expect(voice.stopRecording).toHaveBeenCalledTimes(1);
    expect(gigaam.transcribe).not.toHaveBeenCalled();
    expect(chat.processMessage).not.toHaveBeenCalled();
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
  it('records on the first press after microphone permission is granted', async () => {
    (component as any).permissionGranted = false;
    await component.onPress();
    expect(voice.startRecording).toHaveBeenCalledTimes(1);
    expect(chat.processMessage).not.toHaveBeenCalled();
    await component.onRelease();
    expect(chat.processMessage).toHaveBeenCalledOnceWith('Привет');
  });
  it('cancelling a touch during permission request never starts recording', async () => {
    let grant!: (value: boolean) => void;
    (component as any).permissionGranted = false;
    voice.requestPermission.and.returnValue(new Promise<boolean>(resolve => grant = resolve));
    const event = {button: 0, pointerId: 1, preventDefault() {}, currentTarget: {setPointerCapture() {}}} as any;
    component.onPointerDown(event); await flush();
    component.onPointerCancel(event);
    grant(true); await flush();
    expect(voice.startRecording).not.toHaveBeenCalled();
    expect(chat.processMessage).not.toHaveBeenCalled();
  });
  it('switching to Auto discards manual recording before starting stream capture', async () => {
    await component.onPress();
    let stopped!: (audio: string) => void;
    voice.stopRecording.and.returnValue(new Promise<string>(resolve => stopped = resolve));
    component.autoMode = true;
    const change = component.onAutoModeChange(); await flush();
    expect(voice.startRecordingFromStream).not.toHaveBeenCalled();
    stopped('discard'); await change;
    expect(voice.startRecordingFromStream).toHaveBeenCalledTimes(1);
    expect(chat.processMessage).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });
  it('switching to Auto during transcription waits and ignores the old result', async () => {
    let finish!: (text: string) => void;
    gigaam.transcribe.and.returnValue(new Promise<string>(resolve => finish = resolve));
    await component.onPress(); const release = component.onRelease(); await flush();
    component.autoMode = true; const change = component.onAutoModeChange(); await flush();
    finish('old'); await Promise.all([release, change]);
    expect(chat.processMessage).not.toHaveBeenCalled();
    expect(voice.startRecordingFromStream).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  });
  it('ignores manual pointer input in Auto', async () => {
    component.autoMode = true; await component.onAutoModeChange();
    component.onPointerDown({button: 0, pointerId: 1} as PointerEvent);
    component.onPointerUp({pointerId: 1} as PointerEvent); await flush();
    expect(chat.processMessage).not.toHaveBeenCalled();
    expect(voice.startRecording).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it('renders status colors and a spinner, including when Auto disables the button', async () => {
    const recording = new BehaviorSubject(false);
    const loading = new BehaviorSubject(false);
    const transcribing = new BehaviorSubject(false);
    const preparingReply = new BehaviorSubject(false);
    voice.isPreparing$ = preparingReply;
    voice.isRecording$ = recording;
    gigaam.isLoading$ = loading;
    gigaam.isTranscribing$ = transcribing;
    const recognition = {isListening$: of(false), isProcessing$: of(false)};
    await TestBed.configureTestingModule({
      imports: [CommonModule], declarations: [VoiceButtonComponent, TranslationStub],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        {provide: VoiceService, useValue: voice}, {provide: ChatService, useValue: chat},
        {provide: GigaAmService, useValue: gigaam}, {provide: VadService, useValue: vad},
        {provide: NativeSpeechService, useValue: recognition},
        {provide: CapacitorSpeechService, useValue: recognition},
        {provide: SpeechStreamService, useValue: {startSession() {}, async streamFinalTranscript() {}}},
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VoiceButtonComponent);
    spyOn(fixture.componentInstance, 'ngOnInit').and.resolveTo();
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('ion-button');
    expect(button.color).toBe('primary');
    expect(fixture.nativeElement.querySelector('[role=status]').textContent).toContain('voice-button.ready');
    loading.next(true); fixture.detectChanges();
    expect(button.color).toBe('warning');
    expect(button.querySelector('ion-spinner')).not.toBeNull();
    expect(button.querySelector('ion-icon')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role=status]').textContent).toContain('voice-button.preparing');
    loading.next(false); recording.next(true); fixture.componentInstance.autoMode = true;
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();
    expect(button.color).toBe('danger');
    expect(button.querySelector('ion-spinner')).toBeNull();
    fixture.componentInstance.releasing = true; fixture.detectChanges();
    expect(button.color).toBe('warning');
    expect(button.querySelector('ion-spinner')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role=status]').textContent).toContain('voice-button.processing');
    fixture.componentInstance.releasing = false;
    recording.next(false); transcribing.next(true); fixture.detectChanges();
    expect(button.color).toBe('warning');
    expect(button.querySelector('ion-spinner')).not.toBeNull();
    transcribing.next(false); preparingReply.next(true); fixture.detectChanges();
    expect(button.color).toBe('warning');
    expect(button.querySelector('ion-spinner')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role=status]').textContent).toContain('voice-button.preparingReply');
    preparingReply.next(false); speaking.next(true); fixture.detectChanges();
    expect(button.color).toBe('medium');
    expect(fixture.nativeElement.querySelector('[role=status]').textContent).toContain('voice-button.speaking');
    expect(button.querySelector('ion-spinner')).toBeNull();
    // Use DOM events as well: capture may be unavailable, but document release
    // must still end the hold when the pointer is no longer over the button.
    speaking.next(false); fixture.componentInstance.autoMode = false;
    fixture.detectChanges();
    button.dispatchEvent(new PointerEvent('pointerdown', {button: 0, pointerId: 7, isPrimary: true, bubbles: true}));
    await flush();
    expect(voice.startRecording).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new PointerEvent('pointerup', {pointerId: 7}));
    await flush();
    expect(chat.processMessage).toHaveBeenCalledOnceWith('Привет');
    fixture.destroy();
  });

  it('serializes rapid Auto toggles while microphone setup is pending', async () => {
    let started!: () => void;
    vad.start.and.returnValue(new Promise<void>(resolve => started = resolve));
    component.autoMode = true; const first = component.onAutoModeChange(); await flush();
    component.autoMode = false; await component.onAutoModeChange();
    component.autoMode = true; const second = component.onAutoModeChange(); await flush();
    expect(vad.start).toHaveBeenCalledTimes(1);
    started(); await Promise.all([first, second]);
    expect(vad.start).toHaveBeenCalledTimes(2);
    expect(voice.startRecordingFromStream).toHaveBeenCalledTimes(1);
    speechEnd.next(); await flush();
    expect(chat.processMessage).toHaveBeenCalledOnceWith('Привет');
    component.ngOnDestroy();
  });

  it('release during preparation leaves the microphone idle until another hold', async () => {
    let ready!: () => void;
    gigaam.initialize.and.returnValue(new Promise<void>(resolve => ready = resolve));
    const event = {button: 0, isPrimary: true, pointerId: 1, preventDefault() {}, currentTarget: {setPointerCapture() {}}} as any;
    component.onPointerDown(event); await flush();
    expect(component.starting).toBeTrue();
    component.onPointerUp(event);
    ready(); await flush();
    expect(component.starting).toBeFalse();
    expect(voice.startRecording).not.toHaveBeenCalled();
    expect(voice.stopRecording).not.toHaveBeenCalled();
    expect(chat.processMessage).not.toHaveBeenCalled();
    component.onPointerDown(event); await flush();
    expect(voice.startRecording).toHaveBeenCalledTimes(1);
    component.onPointerUp(event); component.onPointerUp(event); await flush();
    expect(chat.processMessage).toHaveBeenCalledOnceWith('Привет');
  });
  it('release during the permission prompt never opens the microphone afterwards', async () => {
    let grant!: (value: boolean) => void;
    (component as any).permissionGranted = false;
    voice.requestPermission.and.returnValue(new Promise<boolean>(resolve => grant = resolve));
    const press = component.onPress(); await flush();
    const release = component.onRelease();
    grant(true); await Promise.all([press, release]);
    expect(voice.startRecording).not.toHaveBeenCalled();
    expect(chat.processMessage).not.toHaveBeenCalled();
  });
  it('a new primary hold recovers a missed release, and secondary touches are ignored', async () => {
    const event = {button: 0, isPrimary: true, pointerId: 1, preventDefault() {}, currentTarget: {setPointerCapture() {}}} as any;
    component.onPointerDown(event); await flush();
    component.onPointerDown({...event, pointerId: 2, isPrimary: false});
    component.onPointerUp({...event, pointerId: 2}); await flush();
    expect(voice.stopRecording).not.toHaveBeenCalled();
    component.onPointerDown(event);
    component.onPointerUp(event); await flush();
    expect(voice.startRecording).toHaveBeenCalledTimes(1);
    expect(chat.processMessage).toHaveBeenCalledOnceWith('Привет');
  });
  it('losing window focus cancels manual capture without sending a question', async () => {
    const event = {button: 0, isPrimary: true, pointerId: 1, preventDefault() {}, currentTarget: {setPointerCapture() {}}} as any;
    component.onPointerDown(event); await flush();
    component.onWindowBlur(); await flush();
    expect(voice.stopRecording).toHaveBeenCalledTimes(1);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

});
