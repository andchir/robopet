import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PluginListenerHandle } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { SpeechStreamService } from './speech-stream.service';

@Injectable({ providedIn: 'root' })
export class CapacitorSpeechService {
  private readonly recognition = SpeechRecognition;
  private readonly listening$ = new BehaviorSubject<boolean>(false);
  private readonly processing$ = new BehaviorSubject<boolean>(false);
  private listenPromise: Promise<string> | null = null;
  private partialHandle: PluginListenerHandle | null = null;
  private stateHandle: PluginListenerHandle | null = null;

  constructor(private speechStream: SpeechStreamService) {}

  get isListening$(): Observable<boolean> {
    return this.listening$.asObservable();
  }

  get isProcessing$(): Observable<boolean> {
    return this.processing$.asObservable();
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { available } = await SpeechRecognition.available();
      return available;
    } catch {
      return false;
    }
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const status = await SpeechRecognition.requestPermissions();
      return status.speechRecognition === 'granted';
    } catch {
      return false;
    }
  }

  /**
   * Start recognition. Returns a Promise that resolves with the transcript
   * once {@link stopListening} is called (or recognition ends on its own).
   *
   * Uses `partialResults: true` so partial transcripts can be streamed to
   * the visualization layer via {@link SpeechStreamService}. The promise
   * resolves with the latest accumulated transcript on stop.
   *
   * @param language BCP-47 tag, e.g. "en-US" or "ru-RU".
   */
  startListening(language: string): Promise<string> {
    if (this.listenPromise) {
      return this.listenPromise;
    }

    let latestTranscript = '';
    let stopRequested = false;
    let ready = false;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveResult!: (text: string) => void;
    let rejectResult!: (error: unknown) => void;
    const resultPromise = new Promise<string>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    // Android can emit "stopped" before release, without emitting it again
    // for stop(). Allow final results to arrive, then finish independently.
    const stop = () => {
      if (!ready) return;
      finishTimer ??= setTimeout(() => resolveResult(latestTranscript.trim()), 500);
      void this.recognition.stop().catch(rejectResult);
    };
    this.markStopRequested = () => {
      if (stopRequested) return;
      stopRequested = true;
      stop();
    };

    this.listenPromise = (async () => {
      try {
        this.partialHandle = await this.recognition.addListener('partialResults', data => {
          const transcript = data.matches?.[0] ?? '';
          if (!transcript) return;
          latestTranscript = transcript;
          this.speechStream.feedCumulative(transcript);
        });
        this.stateHandle = await this.recognition.addListener('listeningState', ({ status }) => {
          this.listening$.next(!stopRequested && status === 'started');
        });
        this.speechStream.startSession();
        await this.recognition.start({language, maxResults: 1, partialResults: true, popup: false});
        ready = true;
        if (stopRequested) stop();
        else this.listening$.next(true);
        return await resultPromise;
      } finally {
        clearTimeout(finishTimer);
        await this.cleanupListeners();
        this.listening$.next(false);
        this.processing$.next(false);
        this.listenPromise = null;
        this.markStopRequested = null;
      }
    })();

    return this.listenPromise;
  }

  /** Set by {@link startListening} so {@link stopListening} can flip it. */
  private markStopRequested: (() => void) | null = null;

  /** Stop listening and wait for final result. */
  stopListening(): void {
    if (!this.listenPromise) return;
    this.processing$.next(true);
    this.listening$.next(false);
    this.markStopRequested?.();

  }

  private async cleanupListeners(): Promise<void> {
    try { await this.partialHandle?.remove(); } catch { /* ignore */ }
    try { await this.stateHandle?.remove(); } catch { /* ignore */ }
    this.partialHandle = null;
    this.stateHandle = null;
  }
}
