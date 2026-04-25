import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PluginListenerHandle } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { SpeechStreamService } from './speech-stream.service';

@Injectable({ providedIn: 'root' })
export class CapacitorSpeechService {
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

    this.listenPromise = (async () => {
      let latestTranscript = '';
      let stopRequested = false;
      let resolveResult!: (text: string) => void;

      const resultPromise = new Promise<string>(resolve => {
        resolveResult = resolve;
      });

      this.partialHandle = await SpeechRecognition.addListener(
        'partialResults',
        (data: { matches?: string[] }) => {
          const transcript = data.matches?.[0] ?? '';
          if (!transcript) return;
          latestTranscript = transcript;
          this.speechStream.feedCumulative(transcript);
        },
      );

      this.stateHandle = await SpeechRecognition.addListener(
        'listeningState',
        ({ status }) => {
          this.listening$.next(status === 'started');
          if (status === 'stopped') {
            this.processing$.next(false);
            // Only resolve when the caller actually asked us to stop —
            // Android's recognizer can briefly drop into "stopped" between
            // utterances even when continuous listening is desired.
            if (stopRequested) resolveResult(latestTranscript.trim());
          }
        },
      );

      this.speechStream.startSession();
      this.listening$.next(true);

      try {
        // With partialResults: true the plugin resolves immediately after
        // the recognizer kicks off; results arrive via the partialResults
        // listener until stopListening() is called.
        await SpeechRecognition.start({
          language,
          maxResults: 1,
          partialResults: true,
          popup: false,
        });
      } catch (err) {
        await this.cleanupListeners();
        this.listening$.next(false);
        this.processing$.next(false);
        this.listenPromise = null;
        throw err;
      }

      // Expose a way for stopListening() to mark the next "stopped" event
      // as the terminal one.
      this.markStopRequested = () => { stopRequested = true; };

      try {
        return await resultPromise;
      } finally {
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
    void SpeechRecognition.stop();
  }

  private async cleanupListeners(): Promise<void> {
    try { await this.partialHandle?.remove(); } catch { /* ignore */ }
    try { await this.stateHandle?.remove(); } catch { /* ignore */ }
    this.partialHandle = null;
    this.stateHandle = null;
  }
}
