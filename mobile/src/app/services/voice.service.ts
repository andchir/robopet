import { Injectable } from '@angular/core';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class VoiceService {
  private readonly speaking$ = new BehaviorSubject<boolean>(false);
  private readonly recording$ = new BehaviorSubject<boolean>(false);
  private readonly ttsStart$ = new Subject<void>();
  private speakGeneration = 0;

  private mediaRecorder: MediaRecorder | null = null;
  private recordChunks: Blob[] = [];

  get isSpeaking$(): Observable<boolean> {
    return this.speaking$.asObservable();
  }

  /** Fires every time speak() is called, even if already speaking. */
  get onTtsStart$(): Observable<void> {
    return this.ttsStart$.asObservable();
  }

  get isRecording$(): Observable<boolean> {
    return this.recording$.asObservable();
  }

  async requestPermission(): Promise<boolean> {
    const result = await VoiceRecorder.requestAudioRecordingPermission();
    return result.value;
  }

  async startRecording(): Promise<void> {
    console.log('[Voice] Recording started');
    await VoiceRecorder.startRecording();
    this.recording$.next(true);
  }

  async stopRecording(): Promise<string> {
    const result = await VoiceRecorder.stopRecording();
    this.recording$.next(false);
    const audio = result.value.recordDataBase64 ?? '';
    const kb = ((audio.length * 3) / 4 / 1024).toFixed(1);
    console.log(`[Voice] Recording stopped — audio size≈${kb} KB`);
    return audio;
  }

  async speak(text: string, lang = 'ru-RU'): Promise<void> {
    const generation = ++this.speakGeneration;
    console.log(`[Voice] TTS start  gen=${generation}  lang=${lang}  text="${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`);

    // Notify listeners that a new TTS utterance is starting (fires before
    // isSpeaking$ changes, so auto-mode can discard any orphaned STT session
    // even when isSpeaking$ was already true from the previous utterance).
    this.ttsStart$.next();

    // Stop any currently playing TTS before starting a new one
    try { await TextToSpeech.stop(); } catch { /* ignore */ }

    // Another speak() was called while we were stopping — bail out
    if (generation !== this.speakGeneration) return;

    this.speaking$.next(true);

    // Safety timeout: ~90 ms per character + 2 s buffer, minimum 3 s
    const safetyMs = Math.max(text.length * 90, 3000) + 2000;
    const safetyTimer = setTimeout(() => {
      if (generation === this.speakGeneration) {
        console.warn('[Voice] TTS safety timeout fired — forcing isSpeaking=false');
        this.speaking$.next(false);
      }
    }, safetyMs);
    try {
      await TextToSpeech.speak({ text, lang, rate: 1.0 });
      console.log(`[Voice] TTS finished  gen=${generation}`);
    } catch (err: unknown) {
      const errObj = err as { error?: string };
      if (errObj?.error !== 'interrupted') {
        console.error('[Voice] TTS error:', err);
      }
    } finally {
      clearTimeout(safetyTimer);
      // Only mark as done if we are still the latest speak() call
      if (generation === this.speakGeneration) {
        this.speaking$.next(false);
      }
    }
  }

  async stopSpeaking(): Promise<void> {
    console.log('[Voice] TTS stopped manually');
    await TextToSpeech.stop();
    this.speaking$.next(false);
  }

  /**
   * Start recording from an existing MediaStream (e.g. the VAD stream) using
   * the browser's MediaRecorder API. Avoids opening a second mic capture
   * session on Android, where concurrent audio captures often conflict.
   */
  startRecordingFromStream(stream: MediaStream): void {
    if (this.mediaRecorder) {
      console.warn('[Voice] Stream recording already active');
      return;
    }

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''].find(
      t => !t || MediaRecorder.isTypeSupported(t),
    ) ?? '';

    this.recordChunks = [];
    try {
      this.mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      this.mediaRecorder = new MediaRecorder(stream);
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordChunks.push(e.data);
    };
    this.mediaRecorder.start();
    this.recording$.next(true);
    console.log('[Voice] Stream recording started, mimeType:', this.mediaRecorder.mimeType);
  }

  /** Stop stream recording and return the captured audio as a base64 string. */
  stopRecordingFromStream(): Promise<string> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        this.recording$.next(false);
        resolve('');
        return;
      }

      const mr = this.mediaRecorder;
      mr.onstop = () => {
        const blob = new Blob(this.recordChunks, { type: mr.mimeType });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1] ?? '';
          const kb = ((base64.length * 3) / 4 / 1024).toFixed(1);
          console.log(`[Voice] Stream recording stopped — audio size≈${kb} KB`);
          this.recording$.next(false);
          resolve(base64);
        };
        reader.readAsDataURL(blob);
      };
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    });
  }

  /** Discard any in-progress stream recording without processing the result. */
  cancelStreamRecording(): void {
    if (!this.mediaRecorder) return;
    this.mediaRecorder.ondataavailable = null;
    this.mediaRecorder.onstop = null;
    try { this.mediaRecorder.stop(); } catch { /* ignore */ }
    this.mediaRecorder = null;
    this.recordChunks = [];
    this.recording$.next(false);
    console.log('[Voice] Stream recording cancelled');
  }
}
