import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';

/** Speech recognition constructor available in Android WebView / Chrome. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionCtor = new () => any;

@Injectable({ providedIn: 'root' })
export class NativeSpeechService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private resultResolve: ((text: string) => void) | null = null;
  private resultReject: ((err: Error) => void) | null = null;

  private readonly listening$ = new BehaviorSubject<boolean>(false);
  private readonly processing$ = new BehaviorSubject<boolean>(false);

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
  startListening(language: string): Promise<string> {
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
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      this.recognition = rec;

      const transcripts: string[] = [];

      rec.onstart = () => {
        console.log('[NativeSpeech] Recognition started, lang=', language);
        this.listening$.next(true);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            const chunk = event.results[i][0].transcript;
            console.log(`[NativeSpeech] Chunk: "${chunk}"`);
            transcripts.push(chunk);
          }
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onerror = (event: any) => {
        console.error('[NativeSpeech] Error:', event.error);
        this.listening$.next(false);
        this.processing$.next(false);
        this.recognition = null;

        if (event.error === 'no-speech' || event.error === 'aborted') {
          if (this.resultResolve) {
            this.resultResolve(transcripts.join(' ').trim());
            this.resultResolve = null;
            this.resultReject = null;
          }
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
      };

      try {
        rec.start();
      } catch (err) {
        this.resultResolve = null;
        this.resultReject = null;
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
