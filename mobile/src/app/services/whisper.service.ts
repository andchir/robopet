import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';

type Pipeline = (
  audio: Float32Array,
  options: { language: string; task: string },
) => Promise<{ text: string }>;

/** Whisper model to use. Smaller → faster but less accurate. */
const MODEL_ID = 'Xenova/whisper-base';

/** Target sample rate required by Whisper. */
const WHISPER_SR = 16000;

@Injectable({ providedIn: 'root' })
export class WhisperService {
  private pipe: Pipeline | null = null;
  private initPromise: Promise<void> | null = null;

  private readonly loading$ = new BehaviorSubject<boolean>(false);
  private readonly transcribing$ = new BehaviorSubject<boolean>(false);

  get isLoading$(): Observable<boolean> {
    return this.loading$.asObservable();
  }

  get isTranscribing$(): Observable<boolean> {
    return this.transcribing$.asObservable();
  }

  get isBusy$(): Observable<boolean> {
    return combineLatest([this.loading$, this.transcribing$]).pipe(
      map(([loading, transcribing]) => loading || transcribing),
    );
  }

  /**
   * Pre-load the model in the background.
   * Call this early (e.g. on app start) so that the first transcription
   * does not block the user.
   */
  preload(): void {
    this.initialize().catch(err => console.error('[Whisper] Preload failed:', err));
  }

  async initialize(): Promise<void> {
    if (this.pipe) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    console.log(`[Whisper] Loading model "${MODEL_ID}"…`);
    this.loading$.next(true);
    try {
      // Dynamic import keeps the library out of the initial bundle.
      const { pipeline, env } = await import('@xenova/transformers');
      // Capacitor intercepts https://localhost/* as local asset requests.
      // Disable local model lookup so the library fetches from HuggingFace CDN
      // instead of trying https://localhost/models/… (which has no bundled files).
      env.allowLocalModels = false;
      this.pipe = (await pipeline('automatic-speech-recognition', MODEL_ID, {
        progress_callback: (p: { status: string; name?: string; progress?: number }) => {
          if (p.status === 'progress' && p.name && p.progress !== undefined) {
            console.log(`[Whisper] ↓ ${p.name}  ${Math.round(p.progress)}%`);
          }
        },
      })) as unknown as Pipeline;
      console.log('[Whisper] Model ready');
    } catch (err) {
      this.initPromise = null; // allow retry
      throw err;
    } finally {
      this.loading$.next(false);
    }
  }

  /**
   * Transcribe base64-encoded audio (any browser-decodable format).
   * @param audioBase64 Raw base64 string (no data-URL prefix).
   * @param language    BCP-47 language tag, e.g. "en" or "ru".
   */
  async transcribe(audioBase64: string, language = 'en'): Promise<string> {
    await this.initialize();
    if (!this.pipe) throw new Error('[Whisper] Pipeline not initialized');

    this.transcribing$.next(true);
    try {
      const audio = await this.decodeToFloat32(audioBase64);
      const result = await this.pipe(audio, { language, task: 'transcribe' });
      const text = result.text?.trim() ?? '';
      console.log(`[Whisper] Result: "${text}"`);
      return text;
    } finally {
      this.transcribing$.next(false);
    }
  }

  /**
   * Decode any browser-supported audio format from base64, resample to
   * 16 kHz mono, and return a raw Float32Array (what Whisper expects).
   */
  private async decodeToFloat32(base64: string): Promise<Float32Array> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const decodeCtx = new AudioContext();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await decodeCtx.decodeAudioData(bytes.buffer.slice(0));
    } finally {
      await decodeCtx.close();
    }

    // Resample to WHISPER_SR using OfflineAudioContext.
    const frameCount = Math.ceil(audioBuffer.duration * WHISPER_SR);
    const offlineCtx = new OfflineAudioContext(1, frameCount, WHISPER_SR);
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start(0);
    const resampled = await offlineCtx.startRendering();

    return resampled.getChannelData(0);
  }
}
