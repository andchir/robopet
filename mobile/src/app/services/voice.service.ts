import { SupertonicService } from './supertonic.service';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { Injectable } from '@angular/core';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class VoiceService {
  private readonly preparing$ = new BehaviorSubject<boolean>(false);
  readonly isPreparing$ = this.preparing$.asObservable();
  /** The response is active (including synthesis); used to pause auto capture. */
  private readonly speaking$ = new BehaviorSubject<boolean>(false);
  private readonly playing$ = new BehaviorSubject<boolean>(false);
  /** Only actual playback should animate the character's mouth. */
  readonly isPlaying$ = this.playing$.asObservable();
  private readonly recording$ = new BehaviorSubject<boolean>(false);
  private readonly ttsStart$ = new Subject<void>();
  private speakGeneration = 0;
  private audioContext?: AudioContext;
  private source?: AudioBufferSourceNode;
  private finishPlayback?: () => void;
  constructor(private supertonic: SupertonicService) {}
  private stopPlayback(): void {
    this.playing$.next(false);
    this.source?.stop(); this.source = undefined;
    this.finishPlayback?.(); this.finishPlayback = undefined;
  }


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
    if (!Capacitor.isNativePlatform()) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({audio: true});
        stream.getTracks().forEach(track => track.stop());
        return true;
      } catch { return false; }
    }
    const result = await VoiceRecorder.requestAudioRecordingPermission();
    return result.value;
  }

  async startRecording(): Promise<void> {
    console.log('[Voice] Recording started');
    await VoiceRecorder.startRecording();
    this.recording$.next(true);
  }

  async stopRecording(): Promise<string> {
    // Capture ends on release; retrieving/encoding the audio can take longer.
    this.recording$.next(false);
    const result = await VoiceRecorder.stopRecording();
    const audio = result.value.recordDataBase64 ?? '';
    const kb = ((audio.length * 3) / 4 / 1024).toFixed(1);
    console.log(`[Voice] Recording stopped — audio size≈${kb} KB`);
    return audio;
  }

  async speak(text: string, lang = 'ru-RU', engineOverride?: string, voiceOverride?: string): Promise<void> {
    const generation = ++this.speakGeneration;
    this.stopPlayback();
    this.supertonic.cancelSynthesis();
    this.ttsStart$.next();
    this.speaking$.next(true);
    this.preparing$.next(true);
    try {
      // Resume before asynchronous model loading, without treating a blocked
      // audio context as successful playback.
      this.audioContext ??= new AudioContext();
      const resumed = this.audioContext.resume().then(() => true, () => false);
      await TextToSpeech.stop();
      const engine = engineOverride ?? (await Preferences.get({key: 'ttsEngine'})).value ?? 'supertonic';
      const voice = voiceOverride ?? (await Preferences.get({key: 'ttsVoice'})).value ?? 'M1';
      if (generation !== this.speakGeneration) return;
      if (engine === 'system') {
        await this.speakSystem(text, lang, generation);
      } else {
        const result = await this.supertonic.synthesize(text, lang, voice);
        if (!result || generation !== this.speakGeneration) return;
        const ready = await resumed;
        if (generation !== this.speakGeneration) return;
        if (!ready) throw new Error('Audio playback is unavailable');
        const buffer = this.audioContext.createBuffer(1, result.audio.length, result.sampleRate);
        buffer.copyToChannel(new Float32Array(result.audio), 0);
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer; source.connect(this.audioContext.destination); this.source = source;
        await new Promise<void>(resolve => {
          this.finishPlayback = resolve;
          source.onended = () => {source.disconnect(); resolve();};
          source.start();
          this.preparing$.next(false);
          this.playing$.next(true);
        });
      }
    } catch (error) {
      if ((error as Error).message !== 'CANCELLED') console.error('[Voice] TTS error', error);
    } finally {
      if (generation === this.speakGeneration) {this.playing$.next(false); this.preparing$.next(false); this.source = undefined; this.finishPlayback = undefined; this.speaking$.next(false);}
    }
  }

  private async speakSystem(text: string, lang: string, generation: number): Promise<void> {
    const started = () => {
      if (generation !== this.speakGeneration) return;
      this.preparing$.next(false);
      this.playing$.next(true);
    };
    if (!Capacitor.isNativePlatform()) {
      // The plugin's web implementation does not expose utterance.onstart.
      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = 1;
        utterance.onstart = started;
        utterance.onend = () => resolve();
        utterance.onerror = event => reject(new Error(event.error));
        this.finishPlayback = resolve;
        window.speechSynthesis.speak(utterance);
      });
      return;
    }
    // Native engines report the first spoken text range after synthesis.
    const listener = await TextToSpeech.addListener('onRangeStart', started);
    try {
      if (generation !== this.speakGeneration) return;
      await TextToSpeech.speak({text, lang, rate: 1.0});
    } finally {
      await listener.remove();
    }
  }

  async stopSpeaking(): Promise<void> {
    ++this.speakGeneration;
    this.stopPlayback(); this.supertonic.cancelSynthesis();
    this.speaking$.next(false);
    this.preparing$.next(false);
    try {await TextToSpeech.stop();} catch { /* Already stopped. */ }
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
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        this.recording$.next(false);
        resolve('');
        return;
      }

      const mr = this.mediaRecorder;
      const chunks = this.recordChunks;
      mr.onerror = () => { this.recording$.next(false); reject(new Error("Recording failed")); };
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: mr.mimeType });
        const reader = new FileReader();
        reader.onerror = () => { this.recording$.next(false); reject(new Error("Audio read failed")); };
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
      this.recording$.next(false);
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
