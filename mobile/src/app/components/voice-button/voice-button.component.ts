import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { Observable, Subscription, combineLatest, map } from 'rxjs';
import { VoiceService } from '../../services/voice.service';
import { normalizeSttMode, ChatService } from '../../services/chat.service';
import { GigaAmService } from '../../services/gigaam.service';
import { NativeSpeechService } from '../../services/native-speech.service';
import { CapacitorSpeechService } from '../../services/capacitor-speech.service';
import { VadService } from '../../services/vad.service';
import { SpeechStreamService } from '../../services/speech-stream.service';

@Component({
  selector: 'app-voice-button',
  templateUrl: './voice-button.component.html',
  styleUrls: ['./voice-button.component.scss'],
  standalone: false,
})
export class VoiceButtonComponent implements OnInit, OnDestroy {
  isRecording$: Observable<boolean>;
  isLoading$: Observable<boolean>;
  isTranscribing$: Observable<boolean>;

  /** True while the button should be disabled (model loading or STT running). */
  isDisabled$: Observable<boolean>;

  /** Visual state label for template logic. */
  state$: Observable<'idle' | 'recording' | 'loading' | 'transcribing'>;

  /** Exposed so the template can react to robot speaking state. */
  readonly isSpeaking$ = this.voiceService.isPlaying$;
  readonly isPreparingReply$ = this.voiceService.isPreparing$;

  /** Whether auto (VAD-triggered) mode is active. */
  autoMode = false;

  private recording = false;
  starting = false;
  releasing = false;
  private stopping: Promise<void> = Promise.resolve();
  private autoTransition = 0;
  private autoSetup: Promise<void> = Promise.resolve();
  private releasePromise: Promise<void> = Promise.resolve();
  private generation = 0;
  private streamRecording = false;
  voiceError = '';
  private pointerId: number | null = null;

  onPointerDown(event: PointerEvent): void {
    if (this.autoMode || this.releasing || event.button !== 0 || event.isPrimary === false) return;
    // A new primary press can recover a hold whose release was lost by the OS.
    if (this.starting && this.pointerId === null) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Some WebViews reject capture; document listeners still handle release.
    }
    void this.onPress();
  }

  @HostListener('document:pointerup', ['$event'])
  onPointerUp(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = null;
    void this.onRelease();
  }

  @HostListener('document:pointercancel', ['$event'])
  onPointerCancel(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = null;
    this.discardActiveStt();
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    if (this.autoMode || this.pointerId === null) return;
    this.pointerId = null;
    this.discardActiveStt();
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.hidden) this.onWindowBlur();
  }

  private permissionGranted = false;
  private nativeListenPromise: Promise<string> | null = null;
  private capacitorListenPromise: Promise<string> | null = null;

  private autoModeSubs: Subscription[] = [];
  private speakingSub: Subscription | null = null;
  private currentlySpeaking = false;
  /** Guard: prevents concurrent speech-end processing in auto mode. */
  private isProcessingAutoSpeech = false;
  /** Tracks the running onPress() so onRelease() can wait for it to finish. */
  private pressPromise: Promise<void> = Promise.resolve();

  constructor(
    private voiceService: VoiceService,
    private chatService: ChatService,
    private gigaamService: GigaAmService,
    private nativeSpeechService: NativeSpeechService,
    private capacitorSpeechService: CapacitorSpeechService,
    private vadService: VadService,
    private speechStream: SpeechStreamService,
  ) {
    this.isRecording$ = combineLatest([
      this.voiceService.isRecording$,
      this.nativeSpeechService.isListening$,
      this.capacitorSpeechService.isListening$,
    ]).pipe(map(([rec, listen, capListen]) => rec || listen || capListen));

    this.isLoading$ = this.gigaamService.isLoading$;

    this.isTranscribing$ = combineLatest([
      this.gigaamService.isTranscribing$,
      this.nativeSpeechService.isProcessing$,
      this.capacitorSpeechService.isProcessing$,
    ]).pipe(map(([wt, np, cp]) => wt || np || cp));

    // isSpeaking$ intentionally excluded: pressing while robot speaks now interrupts it.
    this.isDisabled$ = combineLatest([
      this.gigaamService.isBusy$,
      this.nativeSpeechService.isProcessing$,
      this.capacitorSpeechService.isProcessing$,
    ]).pipe(map(([wb, np, cp]) => wb || np || cp));

    this.state$ = combineLatest([
      this.isRecording$,
      this.isLoading$,
      this.isTranscribing$,
    ]).pipe(
      map(([recording, loading, transcribing]) => {
        if (recording) return 'recording';
        if (loading) return 'loading';
        if (transcribing) return 'transcribing';
        return 'idle';
      }),
    );
  }

  async ngOnInit(): Promise<void> {
    const { value } = await Preferences.get({ key: 'sttMode' });
    const mode = normalizeSttMode(value) || 'gigaam';
    this.chatService.setSttMode(mode);

    if (mode === 'gigaam') {
      this.gigaamService.preload();
    }

    this.speakingSub = this.voiceService.isSpeaking$.subscribe(s => {
      this.currentlySpeaking = s;
    });
  }

  stopCapture(): void {
    ++this.autoTransition;
    this.autoMode = false;
    this.pointerId = null;
    this.stopAutoMode();
  }

  ngOnDestroy(): void {
    this.speakingSub?.unsubscribe();
    this.stopCapture();
  }

  // ── Auto mode ─────────────────────────────────────────────────────────────

  async onAutoModeChange(): Promise<void> {
    const transition = ++this.autoTransition;
    this.pointerId = null;
    this.stopAutoMode();
    if (!this.autoMode) return;
    await this.pressPromise;
    await this.releasePromise;
    await this.stopping;
    await this.autoSetup.catch(() => {});
    if (transition !== this.autoTransition) return;
    if (this.autoMode) {
      try {
        this.autoSetup = this.startAutoMode();
        await this.autoSetup;
      } catch (error) {
        if (transition !== this.autoTransition) return;
        this.voiceError = String(error);
        this.autoMode = false;
        this.stopAutoMode();
      }
    }
  }

  private async startAutoMode(): Promise<void> {
    const generation = this.generation;
    if (this.chatService.getSttMode() === 'gigaam') await this.gigaamService.initialize(this.chatService.getLanguage());
    if (!this.autoMode || generation !== this.generation) return;
    const granted = await this.ensurePermission();
    if (!granted) {
      console.error('[AutoMode] Permission denied — cannot start auto mode');
      this.autoMode = false;
      return;
    }

    if (!this.autoMode || generation !== this.generation) return;
    await this.vadService.start();
    if (!this.autoMode || generation !== this.generation) { this.vadService.stop(); return; }

    // Discard STT on every new TTS utterance, even if isSpeaking$ was already
    // true (e.g. thinking phrase immediately followed by LLM response).
    const ttsStartSub = this.voiceService.onTtsStart$.subscribe(() => {
      console.log('[AutoMode] TTS started — discarding STT');
      this.discardActiveStt();
    });

    // When robot finishes speaking, restart STT so the very first syllable of
    // the next user utterance is captured.
    let prevSpeaking = this.currentlySpeaking;
    const speakingTransitionSub = this.voiceService.isSpeaking$.subscribe(async (speaking) => {
      if (prevSpeaking && !speaking && this.autoMode) {
        console.log('[AutoMode] Robot stopped speaking — restarting STT');
        this.vadService.reset();
        if (!this.isProcessingAutoSpeech) await this.onPress();
      }
      prevSpeaking = speaking;
    });

    const speechEndSub = this.vadService.onSpeechEnd$.subscribe(async () => {
      console.log(`[AutoMode] onSpeechEnd$, currentlySpeaking=${this.currentlySpeaking}`);
      if (this.currentlySpeaking) {
        console.log('[AutoMode] Robot is speaking — ignoring');
        return;
      }
      if (this.isProcessingAutoSpeech) {
        console.log('[AutoMode] Already processing — skipping');
        return;
      }
      const transition = this.autoTransition;
      this.isProcessingAutoSpeech = true;
      try {
        console.log('[AutoMode] Stopping STT and processing…');
        await this.onRelease();
        if (transition === this.autoTransition && this.autoMode && !this.currentlySpeaking) {
          console.log('[AutoMode] Restarting STT for next utterance…');
          await this.onPress();
        }
      } finally {
        if (transition === this.autoTransition) this.isProcessingAutoSpeech = false;
      }
    });

    this.autoModeSubs.push(ttsStartSub, speakingTransitionSub, speechEndSub);
    if (!this.currentlySpeaking) await this.onPress();
    console.log('[AutoMode] Subscriptions set up, autoMode is active');
  }

  private stopAutoMode(): void {
    console.log('[AutoMode] stopAutoMode() called');
    this.discardActiveStt();
    this.vadService.stop();
    this.autoModeSubs.forEach(s => s.unsubscribe());
    this.autoModeSubs = [];
    this.isProcessingAutoSpeech = false;
    console.log('[AutoMode] Stopped, subs cleaned up');
  }

  /** Stop any running STT session without processing its results. */
  private discardActiveStt(): void {
    this.generation++;
    const wasRecording = this.recording;
    this.recording = false;
    const mode = this.chatService.getSttMode();
    if (mode === 'native') {
      this.nativeSpeechService.stopListening();
      if (this.nativeListenPromise) this.stopping = this.nativeListenPromise.then(() => {}, () => {});
      this.nativeListenPromise = null;
    } else if (mode === 'capacitor') {
      this.capacitorSpeechService.stopListening();
      if (this.capacitorListenPromise) this.stopping = this.capacitorListenPromise.then(() => {}, () => {});
      this.capacitorListenPromise = null;
    } else {
      // In auto mode gigaam uses the VAD stream via MediaRecorder; cancel it
      // without waiting for a result. Fall back to VoiceRecorder otherwise.
      if (this.streamRecording) {
        this.voiceService.cancelStreamRecording();
      } else if (wasRecording) {
        this.stopping = this.voiceService.stopRecording().then(() => {}, () => {});
      }
    }
  }

  // ── Button press / release ────────────────────────────────────────────────

  async onPress(): Promise<void> {
    if (this.recording || this.starting || this.releasing) return;
    this.starting = true;
    this.voiceError = '';
    const generation = this.generation;
    this.pressPromise = (async () => {
      try {
        await this.stopping;
        if (generation !== this.generation) return;
        await this.doPress(generation);
        if (generation !== this.generation) this.discardActiveStt();
      } catch (error) { this.voiceError = String(error); }
      finally { this.starting = false; }
    })();
    await this.pressPromise;
  }

  async onRelease(): Promise<void> {
    if (this.releasing) return;
    if (this.starting && !this.autoMode) {
      // Releasing during permission/model preparation must not start a take
      // later. If the recorder is already opening, discard it once it opens.
      this.discardActiveStt();
      await this.pressPromise;
      await this.stopping;
      return;
    }
    this.releasing = true;
    this.releasePromise = this.finishRelease();
    await this.releasePromise;
  }

  private async finishRelease(): Promise<void> {
    try {
      await this.pressPromise;
      if (!this.recording) return;
      this.recording = false;
      const mode = this.chatService.getSttMode();
      if (mode === 'native') await this.onReleaseNative();
      else if (mode === 'capacitor') await this.onReleaseCapacitor();
      else await this.onReleaseGigaAm();
    } catch (error) { this.voiceError = String(error); }
    finally { this.releasing = false; }
  }

  private async doPress(generation: number): Promise<void> {
    // When not in auto mode, pressing while robot speaks interrupts it.
    if (this.currentlySpeaking && !this.autoMode) {
      this.chatService.notifyInterrupted();
      await this.voiceService.stopSpeaking();
      await new Promise<void>(r => setTimeout(r, 150));
    }

    if (!await this.ensurePermission()) {
      throw new Error('Нет доступа к микрофону');
    }
    if (generation !== this.generation) return;

    const mode = this.chatService.getSttMode();
    if (this.autoMode && this.currentlySpeaking) return;
    if (mode === 'native') {
      await this.onPressNative();
    } else if (mode === 'capacitor') {
      await this.onPressCapacitor();
    } else {
      if (!await this.onPressGigaAm(generation)) return;
    }
    this.recording = true;
  }

  private async ensurePermission(): Promise<boolean> {
    if (this.permissionGranted) return true;

    const mode = this.chatService.getSttMode();
    if (mode === 'capacitor') {
      this.permissionGranted = await this.capacitorSpeechService.requestPermissions();
    } else {
      this.permissionGranted = await this.voiceService.requestPermission();
    }

    console.log(`[VoiceButton] Permission ${this.permissionGranted ? 'granted' : 'denied'}`);
    return this.permissionGranted;
  }

  // ── GigaAM (ONNX Runtime) mode ──────────────────────────────────────────────────

  private async onPressGigaAm(generation: number): Promise<boolean> {
    await this.gigaamService.initialize(this.chatService.getLanguage());
    if (generation !== this.generation) return false;
    // Clear the visualization at the start of a fresh utterance — words for
    // this take will be streamed once GigaAm finishes transcribing them.
    this.speechStream.startSession();
    // In auto mode the VAD already holds an open MediaStream — reuse it so
    // that MediaRecorder and the ScriptProcessorNode share a single capture
    // session. Opening a second getUserMedia on Android often fails silently.
    const vadStream = this.autoMode ? this.vadService.getStream() : null;
    this.streamRecording = !!vadStream;
    if (vadStream) {
      this.voiceService.startRecordingFromStream(vadStream);
    } else {
      await this.voiceService.startRecording();
    }
    return true;
  }

  private async onReleaseGigaAm(): Promise<void> {
    const generation = this.generation;
    let audioBase64: string;
    try {
      if (this.streamRecording) {
        audioBase64 = await this.voiceService.stopRecordingFromStream();
      } else {
        audioBase64 = await this.voiceService.stopRecording();
      }
    } catch {
      return;
    }
    if (!audioBase64) {
      console.warn('[VoiceButton] Empty audio — skipping');
      return;
    }

    const lang = this.chatService.getLanguage();
    let text = '';
    try {
      text = await this.gigaamService.transcribe(audioBase64, lang);
    } catch (err) {
      this.voiceError = String(err);
      console.error('[VoiceButton] Transcription error:', err);
      return;
    }

    if (generation !== this.generation) return;
    if (!text) {
      console.warn('[VoiceButton] Empty transcription — not sending');
      return;
    }

    // Stream the recognized words into the visualization — GigaAm produces
    // its transcript all at once, so we fan it out word-by-word with a small
    // delay to mimic the live experience of the streaming backends.
    void this.speechStream.streamFinalTranscript(text);
    this.chatService.processMessage(text);
  }

  // ── Native (Web Speech API) mode ──────────────────────────────────────────

  private async onPressNative(): Promise<void> {
    if (!this.nativeSpeechService.isSupported()) {
      throw new Error('Распознавание речи недоступно на этом устройстве');
    }

    const lang = this.chatService.getLanguage();
    const bcp47 = lang === 'ru' ? 'ru-RU' : 'en-US';

    console.log('[VoiceButton] Starting native recognition, lang=', bcp47);
    this.nativeListenPromise = this.nativeSpeechService.startListening(bcp47).catch(error => {
      this.voiceError = String(error);
      return '';
    });
  }

  private async onReleaseNative(): Promise<void> {
    if (!this.nativeListenPromise) return;
    const generation = this.generation;

    this.nativeSpeechService.stopListening();

    let text = '';
    try {
      text = await this.nativeListenPromise;
    } catch (err) {
      console.error('[VoiceButton] Native speech error:', err);
      return;
    } finally {
      this.nativeListenPromise = null;
    }

    if (!text) {
      console.warn('[VoiceButton] Empty native transcription — not sending');
      return;
    }

    if (generation !== this.generation) return;
    console.log(`[VoiceButton] Native result: "${text}"`);
    this.chatService.processMessage(text);
  }

  // ── Capacitor SpeechRecognition mode ──────────────────────────────────────

  private async onPressCapacitor(): Promise<void> {
    const available = await this.capacitorSpeechService.isAvailable();
    if (!available) {
      throw new Error('Распознавание речи недоступно на этом устройстве');
    }

    const lang = this.chatService.getLanguage();
    const bcp47 = lang === 'ru' ? 'ru-RU' : 'en-US';

    console.log('[VoiceButton] Starting Capacitor recognition, lang=', bcp47);
    this.capacitorListenPromise = this.capacitorSpeechService.startListening(bcp47).catch(error => {
      this.voiceError = String(error);
      return '';
    });
  }

  private async onReleaseCapacitor(): Promise<void> {
    if (!this.capacitorListenPromise) return;
    const generation = this.generation;

    this.capacitorSpeechService.stopListening();

    let text = '';
    try {
      text = await this.capacitorListenPromise;
    } catch (err) {
      console.error('[VoiceButton] Capacitor speech error:', err);
      return;
    } finally {
      this.capacitorListenPromise = null;
    }

    if (!text) {
      console.warn('[VoiceButton] Empty Capacitor transcription — not sending');
      return;
    }

    if (generation !== this.generation) return;
    console.log(`[VoiceButton] Capacitor result: "${text}"`);
    this.chatService.processMessage(text);
  }
}
