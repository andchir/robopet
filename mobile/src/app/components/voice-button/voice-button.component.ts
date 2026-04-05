import { Component, OnDestroy, OnInit } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { Observable, Subscription, combineLatest, firstValueFrom, map } from 'rxjs';
import { VoiceService } from '../../services/voice.service';
import { ChatService, SttMode } from '../../services/chat.service';
import { WhisperService } from '../../services/whisper.service';
import { NativeSpeechService } from '../../services/native-speech.service';
import { CapacitorSpeechService } from '../../services/capacitor-speech.service';
import { VadService } from '../../services/vad.service';

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
  readonly isSpeaking$ = this.voiceService.isSpeaking$;

  /** Whether auto (VAD-triggered) mode is active. */
  autoMode = false;

  private permissionGranted = false;
  private nativeListenPromise: Promise<string> | null = null;
  private capacitorListenPromise: Promise<string> | null = null;

  private autoModeSubs: Subscription[] = [];
  private speakingSub: Subscription | null = null;
  private currentlySpeaking = false;
  /** Guard: prevents re-triggering VAD start while already handling a phrase. */
  private isHandlingVadSpeech = false;

  constructor(
    private voiceService: VoiceService,
    private chatService: ChatService,
    private whisperService: WhisperService,
    private nativeSpeechService: NativeSpeechService,
    private capacitorSpeechService: CapacitorSpeechService,
    private vadService: VadService,
  ) {
    this.isRecording$ = combineLatest([
      this.voiceService.isRecording$,
      this.nativeSpeechService.isListening$,
      this.capacitorSpeechService.isListening$,
    ]).pipe(map(([rec, listen, capListen]) => rec || listen || capListen));

    this.isLoading$ = this.whisperService.isLoading$;

    this.isTranscribing$ = combineLatest([
      this.whisperService.isTranscribing$,
      this.nativeSpeechService.isProcessing$,
      this.capacitorSpeechService.isProcessing$,
    ]).pipe(map(([wt, np, cp]) => wt || np || cp));

    // isSpeaking$ intentionally excluded: pressing while robot speaks now interrupts it.
    this.isDisabled$ = combineLatest([
      this.whisperService.isBusy$,
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
    const mode = (value as SttMode) || 'native';
    this.chatService.setSttMode(mode);

    if (mode === 'whisper') {
      this.whisperService.preload();
    }

    this.speakingSub = this.voiceService.isSpeaking$.subscribe(s => {
      this.currentlySpeaking = s;
    });
  }

  ngOnDestroy(): void {
    this.speakingSub?.unsubscribe();
    this.stopAutoMode();
  }

  // ── Auto mode ─────────────────────────────────────────────────────────────

  async onAutoModeChange(): Promise<void> {
    console.log('[AutoMode] Toggle changed → autoMode =', this.autoMode);
    if (this.autoMode) {
      await this.startAutoMode();
    } else {
      this.stopAutoMode();
    }
  }

  private async startAutoMode(): Promise<void> {
    console.log('[AutoMode] startAutoMode() — calling vadService.start()');
    await this.vadService.start();
    console.log('[AutoMode] VAD started, subscribing to events');

    const speechStartSub = this.vadService.onSpeechStart$.subscribe(async () => {
      console.log(`[AutoMode] onSpeechStart$ received — isHandlingVadSpeech=${this.isHandlingVadSpeech}`);
      if (this.isHandlingVadSpeech) {
        console.log('[AutoMode] Already handling speech, skipping');
        return;
      }

      const recording = await firstValueFrom(this.isRecording$);
      console.log(`[AutoMode] isRecording=${recording}`);
      if (recording) {
        console.log('[AutoMode] Already recording, skipping');
        return;
      }

      this.isHandlingVadSpeech = true;
      console.log('[AutoMode] isHandlingVadSpeech = true');

      if (this.currentlySpeaking) {
        console.log('[AutoMode] Robot is speaking — interrupting TTS…');
        await this.voiceService.stopSpeaking();
        await new Promise<void>(r => setTimeout(r, 150));
      }

      console.log('[AutoMode] Calling onPress()…');
      await this.onPress();
      console.log('[AutoMode] onPress() done');
    });

    const speechEndSub = this.vadService.onSpeechEnd$.subscribe(async () => {
      console.log(`[AutoMode] onSpeechEnd$ received — isHandlingVadSpeech=${this.isHandlingVadSpeech}`);
      if (!this.isHandlingVadSpeech) {
        console.log('[AutoMode] Not handling speech, skipping release');
        return;
      }
      console.log('[AutoMode] Calling onRelease()…');
      await this.onRelease();
      this.isHandlingVadSpeech = false;
      console.log('[AutoMode] onRelease() done, isHandlingVadSpeech = false');
    });

    this.autoModeSubs.push(speechStartSub, speechEndSub);
    console.log('[AutoMode] Subscriptions set up, autoMode is active');
  }

  private stopAutoMode(): void {
    console.log('[AutoMode] stopAutoMode() called');
    this.vadService.stop();
    this.autoModeSubs.forEach(s => s.unsubscribe());
    this.autoModeSubs = [];
    this.isHandlingVadSpeech = false;
    console.log('[AutoMode] Stopped, subs cleaned up');
  }

  // ── Button press / release ────────────────────────────────────────────────

  async onPress(): Promise<void> {
    // When not in auto mode, pressing while robot speaks interrupts it.
    if (this.currentlySpeaking && !this.autoMode) {
      await this.voiceService.stopSpeaking();
      await new Promise<void>(r => setTimeout(r, 150));
    }

    const mode = this.chatService.getSttMode();
    if (mode === 'native') {
      await this.onPressNative();
    } else if (mode === 'capacitor') {
      await this.onPressCapacitor();
    } else {
      await this.onPressWhisper();
    }
  }

  async onRelease(): Promise<void> {
    const mode = this.chatService.getSttMode();
    if (mode === 'native') {
      await this.onReleaseNative();
    } else if (mode === 'capacitor') {
      await this.onReleaseCapacitor();
    } else {
      await this.onReleaseWhisper();
    }
  }

  // ── Whisper (Xenova) mode ──────────────────────────────────────────────────

  private async onPressWhisper(): Promise<void> {
    if (!this.permissionGranted) {
      console.log('[VoiceButton] Requesting microphone permission…');
      this.permissionGranted = await this.voiceService.requestPermission();
      console.log(`[VoiceButton] Permission ${this.permissionGranted ? 'granted' : 'denied'}`);
      if (!this.permissionGranted) return;
    }
    await this.voiceService.startRecording();
  }

  private async onReleaseWhisper(): Promise<void> {
    const audioBase64 = await this.voiceService.stopRecording();
    if (!audioBase64) {
      console.warn('[VoiceButton] Empty audio — skipping');
      return;
    }

    const lang = this.chatService.getLanguage();
    let text = '';
    try {
      text = await this.whisperService.transcribe(audioBase64, lang);
    } catch (err) {
      console.error('[VoiceButton] Transcription error:', err);
      return;
    }

    if (!text) {
      console.warn('[VoiceButton] Empty transcription — not sending');
      return;
    }

    this.chatService.processMessage(text);
  }

  // ── Native (Web Speech API) mode ──────────────────────────────────────────

  private async onPressNative(): Promise<void> {
    if (!this.nativeSpeechService.isSupported()) {
      console.error('[VoiceButton] Web Speech API not supported on this device');
      return;
    }

    const lang = this.chatService.getLanguage();
    const bcp47 = lang === 'ru' ? 'ru-RU' : 'en-US';

    console.log('[VoiceButton] Starting native recognition, lang=', bcp47);
    this.nativeListenPromise = this.nativeSpeechService.startListening(bcp47);
  }

  private async onReleaseNative(): Promise<void> {
    if (!this.nativeListenPromise) return;

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

    console.log(`[VoiceButton] Native result: "${text}"`);
    this.chatService.processMessage(text);
  }

  // ── Capacitor SpeechRecognition mode ──────────────────────────────────────

  private async onPressCapacitor(): Promise<void> {
    const available = await this.capacitorSpeechService.isAvailable();
    if (!available) {
      console.error('[VoiceButton] Capacitor SpeechRecognition not available on this device');
      return;
    }

    if (!this.permissionGranted) {
      console.log('[VoiceButton] Requesting speech recognition permission…');
      this.permissionGranted = await this.capacitorSpeechService.requestPermissions();
      console.log(`[VoiceButton] Permission ${this.permissionGranted ? 'granted' : 'denied'}`);
      if (!this.permissionGranted) return;
    }

    const lang = this.chatService.getLanguage();
    const bcp47 = lang === 'ru' ? 'ru-RU' : 'en-US';

    console.log('[VoiceButton] Starting Capacitor recognition, lang=', bcp47);
    this.capacitorListenPromise = this.capacitorSpeechService.startListening(bcp47);
  }

  private async onReleaseCapacitor(): Promise<void> {
    if (!this.capacitorListenPromise) return;

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

    console.log(`[VoiceButton] Capacitor result: "${text}"`);
    this.chatService.processMessage(text);
  }
}
