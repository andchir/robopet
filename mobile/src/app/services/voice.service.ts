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
    await VoiceRecorder.startRecording();
    this.recording$.next(true);
  }

  async stopRecording(): Promise<string> {
    const result = await VoiceRecorder.stopRecording();
    this.recording$.next(false);
    return result.value.recordDataBase64 ?? '';
  }

  async speak(text: string, lang = 'ru-RU'): Promise<void> {
    this.speaking$.next(true);
    try {
      await TextToSpeech.speak({ text, lang, rate: 1.0 });
    } finally {
      this.speaking$.next(false);
    }
  }

  async stopSpeaking(): Promise<void> {
    await TextToSpeech.stop();
    this.speaking$.next(false);
  }
}
