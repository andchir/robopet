import { Injectable } from '@angular/core';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class VoiceService {
  private readonly speaking$ = new BehaviorSubject<boolean>(false);
  private readonly recording$ = new BehaviorSubject<boolean>(false);
  private speakGeneration = 0;

  get isSpeaking$(): Observable<boolean> {
    return this.speaking$.asObservable();
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
}
