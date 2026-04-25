import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { SpeechStreamService } from './speech-stream.service';

/** Speech recognition constructor available in Android WebView / Chrome. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionCtor = new () => any;

@Injectable({ providedIn: 'root' })
export class NativeSpeechService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private resultResolve: ((text: string) => void) | null = null;
  private resultReject: ((err: Error) => void) | null = null;

  /**
   * Resolves when the current recognition session fires `onend`.
   * Awaited at the top of {@link startListening} so that a new session
   * never starts while the browser is still tearing down the old one
   * (which would cause an immediate "aborted" error).
   */
  private sessionEndPromise: Promise<void> = Promise.resolve();

  private readonly listening$ = new BehaviorSubject<boolean>(false);
  private readonly processing$ = new BehaviorSubject<boolean>(false);

  constructor(private speechStream: SpeechStreamService) {}

  get isListening$(): Observable<boolean> {
    return this.listening$.asObservable();
  }

  get isProcessing$(): Observable<boolean> {
    return this.processing$.asObservable();
  }

  get isBusy$(): Observable<boolean> {
    return combineLatest([this.listening$, this.processing$]).pipe(
      map(([l, p]) => l || p),
    );
  }

  isSupported(): boolean {
    const w = window as Window & typeof globalThis & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
  }

  /**
   * Start continuous speech recognition.
   * Returns a Promise that resolves with the full transcript once
   * {@link stopListening} is called (or recognition ends on its own).
   *
   * @param language BCP-47 tag, e.g. "en-US" or "ru-RU".
   */
  async startListening(language: string): Promise<string> {
    await this.sessionEndPromise;

    return new Promise<string>((resolve, reject) => {
      const w = window as Window & typeof globalThis & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
      const SR: SpeechRecognitionCtor | undefined = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      if (!SR) {
        reject(new Error('Web Speech API не поддерживается на этом устройстве'));
        return;
      }

      this.resultResolve = resolve;
      this.resultReject = reject;

      const rec = new SR();
      rec.lang = language;
      rec.continuous = true;
      // Interim results let us stream words to the visualization layer as
      // they're recognized — the final transcript still aggregates only the
      // `isFinal` chunks, so the chat side of the app is unaffected.
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      this.recognition = rec;

      const transcripts: string[] = [];
      let finalText = '';

      let resolveSessionEnd!: () => void;
      this.sessionEndPromise = new Promise<void>(r => { resolveSessionEnd = r; });

      this.speechStream.startSession();

      rec.onstart = () => {
        console.log('[NativeSpeech] Recognition started, lang=', language);
        this.listening$.next(true);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript as string;
          if (event.results[i].isFinal) {
            console.log(`[NativeSpeech] Chunk: "${chunk}"`);
            transcripts.push(chunk);
            finalText += (finalText ? ' ' : '') + chunk.trim();
          } else {
            interim += chunk + ' ';
          }
        }
        const cumulative = (finalText + (interim ? ' ' + interim : '')).trim();
        this.speechStream.feedCumulative(cumulative);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onerror = (event: any) => {
        console.error('[NativeSpeech] Error:', event.error);
        this.listening$.next(false);
        this.processing$.next(false);
        this.recognition = null;

        if (event.error === 'no-speech' || event.error === 'aborted') {
          // Don't resolve the main promise here — let onend handle it.
          // Resolving here would let the caller start a new session before
          // the browser fully tears down this one (onend hasn't fired yet).
        } else {
          if (this.resultReject) {
            this.resultReject(new Error(`Ошибка распознавания: ${event.error}`));
            this.resultResolve = null;
            this.resultReject = null;
          }
        }
      };

      rec.onend = () => {
        this.listening$.next(false);
        this.processing$.next(false);
        this.recognition = null;

        if (this.resultResolve) {
          const text = transcripts.join(' ').trim();
          console.log(`[NativeSpeech] Result: "${text}"`);
          this.resultResolve(text);
          this.resultResolve = null;
          this.resultReject = null;
        }

        resolveSessionEnd();
      };

      try {
        rec.start();
      } catch (err) {
        this.resultResolve = null;
        this.resultReject = null;
        resolveSessionEnd();
        reject(err);
      }
    });
  }

  /**
   * Stop listening and trigger result processing.
   * The Promise returned by {@link startListening} will resolve shortly after.
   */
  stopListening(): void {
    if (this.recognition) {
      console.log('[NativeSpeech] Stopping recognition…');
      this.listening$.next(false);
      this.processing$.next(true);
      this.recognition.stop();
    }
  }
}
