import { Injectable } from '@angular/core';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class VoiceService {
  private readonly speaking$ = new BehaviorSubject<boolean>(false);
  private readonly recording$ = new BehaviorSubject<boolean>(false);

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
    console.log(`[Voice] TTS start  lang=${lang}  text="${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`);
    this.speaking$.next(true);
    // Safety timeout: ~90 ms per character + 2 s buffer, minimum 3 s
    const safetyMs = Math.max(text.length * 90, 3000) + 2000;
    const safetyTimer = setTimeout(() => {
      console.warn('[Voice] TTS safety timeout fired — forcing isSpeaking=false');
      this.speaking$.next(false);
    }, safetyMs);
    try {
      await TextToSpeech.speak({ text, lang, rate: 1.0 });
      console.log('[Voice] TTS finished');
    } finally {
      clearTimeout(safetyTimer);
      this.speaking$.next(false);
    }
  }

  async stopSpeaking(): Promise<void> {
    console.log('[Voice] TTS stopped manually');
    await TextToSpeech.stop();
    this.speaking$.next(false);
  }
}
