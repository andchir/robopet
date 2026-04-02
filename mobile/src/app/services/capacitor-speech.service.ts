import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

@Injectable({ providedIn: 'root' })
export class CapacitorSpeechService {
  private readonly listening$ = new BehaviorSubject<boolean>(false);
  private readonly processing$ = new BehaviorSubject<boolean>(false);
  private listenPromise: Promise<string> | null = null;

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
   * @param language BCP-47 tag, e.g. "en-US" or "ru-RU".
   */
  startListening(language: string): Promise<string> {
    if (this.listenPromise) {
      return this.listenPromise;
    }

    this.listenPromise = (async () => {
      await SpeechRecognition.addListener('listeningState', ({ status }) => {
        this.listening$.next(status === 'started');
        if (status === 'stopped') {
          this.processing$.next(false);
        }
      });

      try {
        this.listening$.next(true);
        const result = await SpeechRecognition.start({
          language,
          maxResults: 1,
          partialResults: false,
          popup: false,
        });
        return result.matches?.[0] ?? '';
      } finally {
        await SpeechRecognition.removeAllListeners();
        this.listening$.next(false);
        this.processing$.next(false);
        this.listenPromise = null;
      }
    })();

    return this.listenPromise;
  }

  /** Stop listening and wait for final result. */
  stopListening(): void {
    if (this.listenPromise) {
      this.processing$.next(true);
      this.listening$.next(false);
      void SpeechRecognition.stop();
    }
  }
}
