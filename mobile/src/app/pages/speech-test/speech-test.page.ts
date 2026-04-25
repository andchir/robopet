import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { PluginListenerHandle } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { TranslocoService } from '@jsverse/transloco';
import { ChatService, SttMode } from '../../services/chat.service';
import { CapacitorSpeechService } from '../../services/capacitor-speech.service';
import { VoiceService } from '../../services/voice.service';
import { WhisperService } from '../../services/whisper.service';

interface SpeechWord {
  id: number;
  text: string;
  rotation: number;
  hue: number;
}

type LogSeverity = 'info' | 'success' | 'warn' | 'error';

interface LogEntry {
  id: number;
  time: string;
  message: string;
  severity: LogSeverity;
}

/** Cap on log size — older entries are dropped FIFO. Keeps the panel snappy. */
const MAX_LOG_ENTRIES = 100;

/** Web Speech API constructor (Chrome / Android WebView). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionCtor = new () => any;

const FLIP_DURATION_MS = 750;
const FLIP_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
/** Tiny "drop" gesture played on the spotlight before it morphs into the transcript. */
const DROP_DIP_MS = 180;
/** After this much silence the spotlight word auto-drops into the transcript. */
const IDLE_COMMIT_MS = 1200;

function toLangCode(bcp47: string): string {
  return bcp47.split('-')[0].toLowerCase();
}

@Component({
  selector: 'app-speech-test',
  templateUrl: './speech-test.page.html',
  styleUrls: ['./speech-test.page.scss'],
  standalone: false,
})
export class SpeechTestPage implements OnInit, OnDestroy {
  sttMode: SttMode = 'native';
  ttsLang = 'en-US';

  isListening = false;
  isProcessing = false;
  /** i18n key for the current status banner, or empty string. */
  statusKey = '';

  /** The latest word, displayed big in the center stage. */
  currentWord: SpeechWord | null = null;
  /** All accumulated previous words, rendered as flowing small text. */
  transcript: SpeechWord[] = [];

  /** Whether the diagnostic log panel is visible. */
  showLog = false;
  /** Recent diagnostic events, newest at the bottom. Capped at MAX_LOG_ENTRIES. */
  logEntries: LogEntry[] = [];

  @ViewChild('transcriptContainer') transcriptContainer?: ElementRef<HTMLElement>;
  @ViewChild('logContainer') logContainer?: ElementRef<HTMLElement>;

  private nextWordId = 0;
  private nextLogId = 0;
  private spokenCount = 0;
  private permissionGranted = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Serializes word arrivals + idle commits so dip / FLIP animations don't race. */
  private commitChain: Promise<void> = Promise.resolve();

  // Native (Web Speech API) state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private nativeFinalText = '';
  /**
   * Resolves when the current Web Speech session fires `onend`. We always
   * await this before starting a new session — Android's WebView raises an
   * "aborted" error if `start()` is called while the previous recognizer is
   * still tearing down.
   */
  private nativeSessionEnd: Promise<void> = Promise.resolve();

  // Capacitor SpeechRecognition state
  private capacitorActive = false;
  private capacitorPartialHandle: PluginListenerHandle | null = null;
  private capacitorStateHandle: PluginListenerHandle | null = null;
  /** Set to true while we are intentionally restarting the recognizer. */
  private capacitorRestarting = false;

  constructor(
    private chatService: ChatService,
    private voiceService: VoiceService,
    private whisperService: WhisperService,
    private capacitorSpeechService: CapacitorSpeechService,
    private transloco: TranslocoService,
    private zone: NgZone,
    private cd: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    const sttMode = (await Preferences.get({ key: 'sttMode' })).value as SttMode | null;
    if (sttMode) this.sttMode = sttMode;

    const lang = (await Preferences.get({ key: 'ttsLang' })).value;
    if (lang) this.ttsLang = lang;

    if (this.sttMode === 'whisper') {
      this.whisperService.preload();
    }
  }

  ngOnDestroy(): void {
    this.clearIdleTimer();
    void this.stop(true);
  }

  trackById(_index: number, word: SpeechWord): number {
    return word.id;
  }

  trackByLogId(_index: number, entry: LogEntry): number {
    return entry.id;
  }

  // ── Public actions ────────────────────────────────────────────────────────

  async onModeChange(): Promise<void> {
    if (this.isListening || this.isProcessing) {
      await this.stop(true);
    }
    this.permissionGranted = false;
    this.statusKey = '';
    this.log('mode-changed', { mode: this.modeLabel(this.sttMode) });
    if (this.sttMode === 'whisper') {
      this.whisperService.preload();
    }
  }

  async toggle(): Promise<void> {
    if (this.isListening) {
      await this.stop(false);
    } else if (!this.isProcessing) {
      await this.start();
    }
  }

  clearLog(): void {
    this.logEntries = [];
    this.nextLogId = 0;
  }

  // ── Log helpers ───────────────────────────────────────────────────────────

  /**
   * Append one entry to the diagnostic log. Translates via transloco so the
   * panel matches the current UI locale. Always runs inside Angular zone so
   * native callbacks (Web Speech / Capacitor) update the view reliably.
   */
  private log(
    key: string,
    params: Record<string, string> = {},
    severity: LogSeverity = 'info',
  ): void {
    const message = this.transloco.translate(`speech-test.log.${key}`, params);
    const entry: LogEntry = {
      id: ++this.nextLogId,
      time: this.formatTime(new Date()),
      message,
      severity,
    };

    const append = () => {
      this.logEntries = [...this.logEntries, entry];
      // FIFO eviction once we exceed the cap.
      if (this.logEntries.length > MAX_LOG_ENTRIES) {
        this.logEntries = this.logEntries.slice(-MAX_LOG_ENTRIES);
      }
      if (this.showLog) this.scrollLogToEnd();
    };

    if (NgZone.isInAngularZone()) {
      append();
    } else {
      this.zone.run(append);
    }
  }

  private modeLabel(mode: SttMode): string {
    return this.transloco.translate(`speech-test.mode-${mode}`);
  }

  private formatTime(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  private scrollLogToEnd(): void {
    requestAnimationFrame(() => {
      const el = this.logContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  // ── Word stage helpers ────────────────────────────────────────────────────

  private addWord(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    // For whisper we already logged the full transcript once — skip per-word
    // entries to avoid duplicating the same content in the diagnostic panel.
    if (this.sttMode !== 'whisper') {
      this.log('word', { text: trimmed }, 'success');
    }
    this.enqueue(() => this.processIncomingWord(trimmed));
  }

  /**
   * Serialize all stage mutations behind a single Promise chain so dip and
   * FLIP animations don't race when words arrive rapidly.
   */
  private enqueue(task: () => Promise<void>): void {
    this.commitChain = this.commitChain
      .then(task)
      .catch(err => console.error('[SpeechTest] queue task failed', err));
  }

  private async processIncomingWord(text: string): Promise<void> {
    // Drop the existing spotlight (if any) into the transcript first, then
    // present the new word as the new spotlight.
    await this.commitCurrentToTranscript();

    this.zone.run(() => {
      this.currentWord = {
        id: ++this.nextWordId,
        text,
        rotation: this.randomBetween(-5, 5),
        hue: this.randomBetween(200, 340),
      };
      this.cd.detectChanges();
    });

    this.scheduleIdleCommit();
  }

  /**
   * Play a small "drop" gesture on the spotlight and then move the word into
   * the transcript with a FLIP morph. Safe to call when no spotlight exists.
   */
  private async commitCurrentToTranscript(): Promise<void> {
    this.clearIdleTimer();

    const previous = this.currentWord;
    if (!previous) return;

    // Phase 1 — small downward dip on the spotlight to telegraph the drop.
    const spotlightEl = document.querySelector('.spotlight') as HTMLElement | null;
    if (spotlightEl) {
      try {
        await spotlightEl.animate(
          [
            { transform: 'translate3d(0, 0, 0) scale(1)', filter: 'brightness(1)' },
            {
              transform: 'translate3d(0, -3px, 0) scale(1.02)',
              filter: 'brightness(1.08)',
              offset: 0.3,
            },
            {
              transform: 'translate3d(0, 14px, 0) scale(0.96)',
              filter: 'brightness(0.95)',
            },
          ],
          {
            duration: DROP_DIP_MS,
            easing: 'cubic-bezier(0.55, 0.06, 0.68, 0.19)',
            fill: 'forwards',
          },
        ).finished;
      } catch {
        // Animation can be cancelled if the element is removed mid-animation.
      }
    }

    // Phase 2 — FLIP morph from the dipped position into the inline transcript.
    if (this.currentWord !== previous) return;

    const fromRect = (document.querySelector('.spotlight') as HTMLElement | null)
      ?.getBoundingClientRect() ?? null;

    this.zone.run(() => {
      this.transcript.push(previous);
      this.currentWord = null;
      this.cd.detectChanges();
    });

    if (fromRect) {
      this.flipPreviousIntoTranscript(previous, fromRect);
    }

    this.scrollTranscriptToEnd();
  }

  private scheduleIdleCommit(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.enqueue(() => this.commitCurrentToTranscript());
    }, IDLE_COMMIT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * FLIP-animate the {@param previous} word from its old spotlight position
   * into its new inline position inside the transcript flow. The element
   * starts visually transformed to look exactly where the spotlight was
   * (translation + scale), then animates to its natural identity transform.
   */
  private flipPreviousIntoTranscript(previous: SpeechWord, fromRect: DOMRect): void {
    requestAnimationFrame(() => {
      const newEl = document.querySelector(
        `.transcript-word[data-word-id="${previous.id}"]`,
      ) as HTMLElement | null;
      if (!newEl) return;

      const toRect = newEl.getBoundingClientRect();
      if (toRect.width === 0 || toRect.height === 0) return;

      const dx = fromRect.left - toRect.left;
      const dy = fromRect.top - toRect.top;
      const sx = fromRect.width / toRect.width;
      const sy = fromRect.height / toRect.height;
      const scale = Math.max(sx, sy);

      newEl.animate(
        [
          {
            transformOrigin: 'top left',
            transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
            opacity: 1,
            filter: 'blur(0px)',
            offset: 0,
          },
          {
            transformOrigin: 'top left',
            transform: `translate(${dx * 0.15}px, ${dy * 0.15 + 12}px) scale(${scale * 0.4 + 0.6})`,
            opacity: 1,
            filter: 'blur(0.5px)',
            offset: 0.6,
          },
          {
            transformOrigin: 'top left',
            transform: 'translate(0, 0) scale(1)',
            opacity: 1,
            filter: 'blur(0px)',
            offset: 1,
          },
        ],
        {
          duration: FLIP_DURATION_MS,
          easing: FLIP_EASING,
          fill: 'backwards',
        },
      );
    });
  }

  private scrollTranscriptToEnd(): void {
    requestAnimationFrame(() => {
      const el = this.transcriptContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private resetStage(): void {
    this.clearIdleTimer();
    this.commitChain = Promise.resolve();
    this.currentWord = null;
    this.transcript = [];
    this.spokenCount = 0;
    this.nextWordId = 0;
  }

  private randomBetween(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  // ── Permission ────────────────────────────────────────────────────────────

  private async ensurePermission(): Promise<boolean> {
    if (this.permissionGranted) return true;

    if (this.sttMode === 'capacitor') {
      this.permissionGranted = await this.capacitorSpeechService.requestPermissions();
    } else {
      this.permissionGranted = await this.voiceService.requestPermission();
    }
    this.log(
      this.permissionGranted ? 'permission-granted' : 'permission-denied',
      {},
      this.permissionGranted ? 'success' : 'error',
    );
    return this.permissionGranted;
  }

  // ── Lifecycle: start / stop ───────────────────────────────────────────────

  private async start(): Promise<void> {
    this.resetStage();
    this.statusKey = '';

    if (!(await this.ensurePermission())) {
      this.statusKey = 'speech-test.status-permission';
      return;
    }

    this.isListening = true;
    this.log('started', { mode: this.modeLabel(this.sttMode), lang: this.ttsLang }, 'success');
    try {
      if (this.sttMode === 'native') {
        await this.startNative();
      } else if (this.sttMode === 'capacitor') {
        await this.startCapacitor();
      } else {
        await this.startWhisper();
      }
    } catch (err) {
      console.error('[SpeechTest] start failed', err);
      this.isListening = false;
      this.statusKey = 'speech-test.status-error';
      this.log('error', { message: this.errorMessage(err) }, 'error');
    }
  }

  private async stop(silent: boolean): Promise<void> {
    if (!this.isListening && !this.isProcessing) return;

    try {
      if (this.sttMode === 'native') {
        this.stopNative();
      } else if (this.sttMode === 'capacitor') {
        await this.stopCapacitor();
      } else {
        await this.stopWhisper();
      }
      if (!silent) this.log('stopped', {}, 'info');
    } catch (err) {
      console.error('[SpeechTest] stop failed', err);
      if (!silent) {
        this.statusKey = 'speech-test.status-error';
        this.log('error', { message: this.errorMessage(err) }, 'error');
      }
    }
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return String(err ?? 'unknown');
  }

  // ── Native (Web Speech API) ───────────────────────────────────────────────

  private async startNative(): Promise<void> {
    // Wait for any previous session to fully tear down — required on Android
    // WebView, otherwise `rec.start()` throws "aborted".
    await this.nativeSessionEnd;

    const w = window as Window & typeof globalThis & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SR: SpeechRecognitionCtor | undefined = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) throw new Error('Web Speech API not supported');

    const rec = new SR();
    rec.lang = this.ttsLang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    // Each session emits its own transcript starting from word 0; wipe the
    // accumulator so emitNewWordsFrom() doesn't skip leading words.
    this.nativeFinalText = '';
    this.spokenCount = 0;
    this.recognition = rec;

    let resolveSessionEnd!: () => void;
    this.nativeSessionEnd = new Promise<void>(r => { resolveSessionEnd = r; });

    rec.onstart = () => {
      console.log('[SpeechTest] Native recognition started, lang=', this.ttsLang);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript as string;
        if (event.results[i].isFinal) {
          this.nativeFinalText += transcript + ' ';
        } else {
          interim += transcript + ' ';
        }
      }
      const combined = (this.nativeFinalText + interim).trim();
      // The browser fires this outside Angular's NgZone — wrap so isListening
      // and word-stage mutations propagate to the template.
      this.zone.run(() => this.emitNewWordsFrom(combined));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (event: any) => {
      console.warn('[SpeechTest] Native recognition error:', event.error);
      // "no-speech" / "aborted" are normal lifecycle events on Android; let
      // onend handle them and (if still listening) auto-restart.
      if (event.error === 'no-speech') {
        this.log('no-speech', {}, 'warn');
      } else if (event.error !== 'aborted') {
        this.log('error', { message: String(event.error) }, 'error');
        this.zone.run(() => {
          this.statusKey = 'speech-test.status-error';
          this.isListening = false;
        });
      }
    };

    rec.onend = () => {
      console.log('[SpeechTest] Native recognition ended');
      this.recognition = null;
      resolveSessionEnd();

      // Android WebView often ignores `continuous = true` and stops after
      // every utterance. Auto-restart so the test page stays "listening"
      // until the user explicitly taps stop.
      if (this.isListening && this.sttMode === 'native') {
        this.log('auto-restart', {}, 'info');
        this.startNative().catch(err => {
          console.error('[SpeechTest] Native auto-restart failed', err);
          this.log('error', { message: this.errorMessage(err) }, 'error');
          this.zone.run(() => {
            this.isListening = false;
            this.statusKey = 'speech-test.status-error';
          });
        });
      } else {
        this.zone.run(() => {
          this.isListening = false;
        });
      }
    };

    try {
      rec.start();
    } catch (err) {
      this.recognition = null;
      resolveSessionEnd();
      throw err;
    }
  }

  private stopNative(): void {
    // Flip isListening BEFORE stop() so onend doesn't auto-restart.
    this.zone.run(() => { this.isListening = false; });
    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }
  }

  /**
   * Append any words present in {@param transcript} that haven't been emitted
   * yet. Streams them out one-by-one so each triggers its own animation.
   */
  private emitNewWordsFrom(transcript: string): void {
    const words = transcript.split(/\s+/).filter(Boolean);
    while (this.spokenCount < words.length) {
      this.addWord(words[this.spokenCount]);
      this.spokenCount++;
    }
  }

  // ── Capacitor SpeechRecognition (with partial results) ────────────────────
  //
  // When `partialResults: true`, the @capacitor-community/speech-recognition
  // plugin resolves `start()` IMMEDIATELY after the recognizer kicks off
  // (Android: SpeechRecognition.java line 198-199; iOS: Plugin.swift line
  // 133-135). Results arrive asynchronously via the `partialResults` listener,
  // so we must NOT tear down listeners right after `start()` returns —
  // otherwise no recognized text ever reaches the page.

  private async startCapacitor(): Promise<void> {
    const { available } = await SpeechRecognition.available();
    if (!available) throw new Error('Capacitor SpeechRecognition unavailable');

    // Defensive: drop any stale listeners from a previous (interrupted) run.
    await this.cleanupCapacitorListeners();

    this.capacitorPartialHandle = await SpeechRecognition.addListener(
      'partialResults',
      (data: { matches?: string[] }) => {
        const transcript = data.matches?.[0] ?? '';
        if (!transcript) return;
        // Plugin invokes listeners outside Angular's NgZone.
        this.zone.run(() => this.emitNewWordsFrom(transcript));
      },
    );

    this.capacitorStateHandle = await SpeechRecognition.addListener(
      'listeningState',
      ({ status }) => {
        console.log('[SpeechTest] Capacitor listening state:', status);
        if (status !== 'stopped') return;

        this.capacitorActive = false;

        // Android's SpeechRecognizer fires onEndOfSpeech after every pause,
        // so the plugin's listening state goes back to "stopped" between
        // utterances. While the user still wants to listen, transparently
        // restart a new session so the test page stays "live".
        if (this.isListening && this.sttMode === 'capacitor' && !this.capacitorRestarting) {
          this.log('auto-restart', {}, 'info');
          void this.restartCapacitorSession();
        }
      },
    );

    await this.startCapacitorSession();
  }

  /** Issue the actual `SpeechRecognition.start({...})` call. */
  private async startCapacitorSession(): Promise<void> {
    // New session emits its transcript starting from word 0 — reset counters
    // so emitNewWordsFrom() doesn't skip the first words.
    this.spokenCount = 0;
    this.capacitorActive = true;

    // With partialResults=true the plugin resolves this promise immediately
    // after the recognizer starts; do NOT treat the resolution as "session
    // ended" or tear down listeners here.
    await SpeechRecognition.start({
      language: this.ttsLang,
      maxResults: 1,
      partialResults: true,
      popup: false,
    });
  }

  private async restartCapacitorSession(): Promise<void> {
    this.capacitorRestarting = true;
    try {
      // Brief delay so the previous SpeechRecognizer fully releases the mic
      // before we ask for a new one — back-to-back start() on Android can
      // fail with "client side error".
      await new Promise<void>(r => setTimeout(r, 200));
      if (!this.isListening || this.sttMode !== 'capacitor') return;
      await this.startCapacitorSession();
    } catch (err) {
      console.error('[SpeechTest] Capacitor auto-restart failed', err);
      this.log('error', { message: this.errorMessage(err) }, 'error');
      this.zone.run(() => {
        this.isListening = false;
        this.statusKey = 'speech-test.status-error';
      });
      await this.cleanupCapacitorListeners();
    } finally {
      this.capacitorRestarting = false;
    }
  }

  private async cleanupCapacitorListeners(): Promise<void> {
    try { await this.capacitorPartialHandle?.remove(); } catch { /* ignore */ }
    try { await this.capacitorStateHandle?.remove(); } catch { /* ignore */ }
    this.capacitorPartialHandle = null;
    this.capacitorStateHandle = null;
  }

  private async stopCapacitor(): Promise<void> {
    // Flip isListening BEFORE stopping so the listeningState handler doesn't
    // auto-restart the session.
    this.zone.run(() => { this.isListening = false; });

    if (this.capacitorActive) {
      try { await SpeechRecognition.stop(); } catch (err) {
        console.warn('[SpeechTest] Capacitor stop() failed', err);
      }
    }
    this.capacitorActive = false;
    await this.cleanupCapacitorListeners();
  }

  // ── Whisper (record then stream words) ────────────────────────────────────

  private async startWhisper(): Promise<void> {
    await this.voiceService.startRecording();
  }

  private async stopWhisper(): Promise<void> {
    let audioBase64 = '';
    try {
      audioBase64 = await this.voiceService.stopRecording();
    } catch (err) {
      this.isListening = false;
      this.log('error', { message: this.errorMessage(err) }, 'error');
      return;
    }
    this.isListening = false;

    if (!audioBase64) {
      this.log('no-speech', {}, 'warn');
      return;
    }

    this.isProcessing = true;
    this.statusKey = 'speech-test.status-processing';
    this.log('transcribing', {}, 'info');
    try {
      const langCode = toLangCode(this.ttsLang);
      const text = await this.whisperService.transcribe(audioBase64, langCode);
      this.statusKey = '';
      const trimmed = text.trim();
      if (trimmed) {
        this.log('transcript', { text: trimmed }, 'success');
      } else {
        this.log('no-speech', {}, 'warn');
      }
      await this.streamWordsWithDelay(text);
    } catch (err) {
      console.error('[SpeechTest] Whisper transcription failed', err);
      this.statusKey = 'speech-test.status-error';
      this.log('error', { message: this.errorMessage(err) }, 'error');
    } finally {
      this.isProcessing = false;
    }
  }

  private async streamWordsWithDelay(text: string): Promise<void> {
    const words = text.trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      this.addWord(word);
      await new Promise(r => setTimeout(r, 380));
    }
  }
}
