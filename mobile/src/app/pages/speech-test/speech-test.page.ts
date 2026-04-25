import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
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

/** Web Speech API constructor (Chrome / Android WebView). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionCtor = new () => any;

const FLIP_DURATION_MS = 750;
const FLIP_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
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

  @ViewChild('transcriptContainer') transcriptContainer?: ElementRef<HTMLElement>;

  private nextWordId = 0;
  private spokenCount = 0;
  private permissionGranted = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  // Native (Web Speech API) state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private nativeFinalText = '';

  // Capacitor SpeechRecognition state
  private capacitorActive = false;

  constructor(
    private chatService: ChatService,
    private voiceService: VoiceService,
    private whisperService: WhisperService,
    private capacitorSpeechService: CapacitorSpeechService,
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

  // ── Public actions ────────────────────────────────────────────────────────

  async onModeChange(): Promise<void> {
    if (this.isListening || this.isProcessing) {
      await this.stop(true);
    }
    this.permissionGranted = false;
    this.statusKey = '';
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

  // ── Word stage helpers ────────────────────────────────────────────────────

  private addWord(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Drop the existing spotlight (if any) into the transcript first, then
    // present the new word as the new spotlight.
    this.commitCurrentToTranscript();

    this.zone.run(() => {
      this.currentWord = {
        id: ++this.nextWordId,
        text: trimmed,
        rotation: this.randomBetween(-5, 5),
        hue: this.randomBetween(200, 340),
      };
      this.cd.detectChanges();
    });

    this.scheduleIdleCommit();
  }

  /**
   * Push the current spotlight word into the transcript and FLIP-animate it
   * into its new inline position. Safe to call even when no spotlight exists.
   */
  private commitCurrentToTranscript(): void {
    this.clearIdleTimer();

    const previous = this.currentWord;
    if (!previous) return;

    // Snapshot spotlight position BEFORE re-rendering.
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
      this.zone.run(() => this.commitCurrentToTranscript());
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
    } catch (err) {
      console.error('[SpeechTest] stop failed', err);
      if (!silent) this.statusKey = 'speech-test.status-error';
    }
  }

  // ── Native (Web Speech API) ───────────────────────────────────────────────

  private async startNative(): Promise<void> {
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

    this.nativeFinalText = '';
    this.recognition = rec;

    rec.onstart = () => {
      console.log('[SpeechTest] Native recognition started');
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
      this.emitNewWordsFrom(combined);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (event: any) => {
      console.warn('[SpeechTest] Native recognition error:', event.error);
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this.zone.run(() => {
          this.statusKey = 'speech-test.status-error';
        });
      }
    };

    rec.onend = () => {
      console.log('[SpeechTest] Native recognition ended');
      this.recognition = null;
      this.zone.run(() => {
        this.isListening = false;
      });
    };

    rec.start();
  }

  private stopNative(): void {
    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }
    this.isListening = false;
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

  private async startCapacitor(): Promise<void> {
    const { available } = await SpeechRecognition.available();
    if (!available) throw new Error('Capacitor SpeechRecognition unavailable');

    await SpeechRecognition.removeAllListeners();

    await SpeechRecognition.addListener('partialResults', (data: { matches?: string[] }) => {
      const transcript = data.matches?.[0] ?? '';
      if (transcript) this.emitNewWordsFrom(transcript);
    });

    await SpeechRecognition.addListener('listeningState', ({ status }) => {
      console.log('[SpeechTest] Capacitor listening state:', status);
      if (status === 'stopped') {
        this.zone.run(() => {
          this.isListening = false;
        });
      }
    });

    this.capacitorActive = true;
    try {
      const result = await SpeechRecognition.start({
        language: this.ttsLang,
        maxResults: 1,
        partialResults: true,
        popup: false,
      });
      // Final result may contain words we haven't streamed yet.
      const finalText = result.matches?.[0] ?? '';
      if (finalText) this.emitNewWordsFrom(finalText);
    } finally {
      this.capacitorActive = false;
      await SpeechRecognition.removeAllListeners();
      this.zone.run(() => {
        this.isListening = false;
      });
    }
  }

  private async stopCapacitor(): Promise<void> {
    if (!this.capacitorActive) {
      this.isListening = false;
      return;
    }
    await SpeechRecognition.stop();
    this.isListening = false;
  }

  // ── Whisper (record then stream words) ────────────────────────────────────

  private async startWhisper(): Promise<void> {
    await this.voiceService.startRecording();
  }

  private async stopWhisper(): Promise<void> {
    let audioBase64 = '';
    try {
      audioBase64 = await this.voiceService.stopRecording();
    } catch {
      this.isListening = false;
      return;
    }
    this.isListening = false;

    if (!audioBase64) return;

    this.isProcessing = true;
    this.statusKey = 'speech-test.status-processing';
    try {
      const langCode = toLangCode(this.ttsLang);
      const text = await this.whisperService.transcribe(audioBase64, langCode);
      this.statusKey = '';
      await this.streamWordsWithDelay(text);
    } catch (err) {
      console.error('[SpeechTest] Whisper transcription failed', err);
      this.statusKey = 'speech-test.status-error';
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
