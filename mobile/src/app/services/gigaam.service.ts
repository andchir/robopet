import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, combineLatest, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class GigaAmService {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private readonly loading = new BehaviorSubject(false);
  private readonly transcribing = new BehaviorSubject(false);
  readonly isLoading$ = this.loading.asObservable();
  readonly isTranscribing$ = this.transcribing.asObservable();
  readonly isBusy$ = combineLatest([this.loading, this.transcribing]).pipe(map(values => values.some(Boolean)));
  dialogOpen = false;
  downloading = false;
  progress = 0;
  error = '';
  private modelLanguage = 'en';
  private requestedLanguage = 'en';
  private languageCheck = 0;
  get selectedLanguage(): string { return this.modelLanguage; }
  installed: Record<string, boolean> = {ru: false, en: false};

  constructor(private zone: NgZone) {}

  private request(type: string, key: string, audio?: Float32Array): Promise<any> {
    if (!this.worker) {
      this.worker = new Worker(new URL('assets/gigaam/worker.mjs', document.baseURI), {type: 'module'});
      this.worker.onmessage = ({data}) => this.zone.run(() => {
        if (data.progress !== undefined) { this.progress = data.progress; return; }
        const pending = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) pending?.reject(new Error(data.error)); else pending?.resolve(data.result);
      });
      this.worker.onerror = () => this.zone.run(() => {
        for (const pending of this.pending.values()) pending.reject(new Error('GigaAM worker failed. Reload the app.'));
        this.pending.clear(); this.worker?.terminate(); this.worker = null;
      });
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.worker!.postMessage({id, type, key, audio}, audio ? [audio.buffer] : []);
    });
  }

  /** Resolve the model from the application's speech language, never from a model selector. */
  async checkLanguage(language: string, showInstalled = false): Promise<boolean> {
    const key = language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
    this.requestedLanguage = key;
    const check = ++this.languageCheck;
    if (this.downloading) return false;
    this.modelLanguage = key;
    this.error = '';
    try {
      const available: boolean = await this.request('status', key);
      if (check !== this.languageCheck) return false;
      this.installed[key] = available;
      this.dialogOpen = showInstalled || !available;
      return available;
    } catch (error) {
      if (check === this.languageCheck) {
        this.error = String(error);
        this.dialogOpen = true;
      }
      return false;
    }
  }

  async openModels(language: string): Promise<void> {
    await this.checkLanguage(language, true);
  }

  async download(): Promise<void> {
    if (this.downloading) return;
    this.downloading = true; this.progress = 0; this.error = '';
    const key = this.selectedLanguage;
    try {
      await navigator.storage?.persist?.();
      await this.request('download', key);
      this.installed[key] = true;
    } catch (error) { this.error = String(error); }
    finally {
      this.downloading = false;
      if (this.requestedLanguage !== key) await this.checkLanguage(this.requestedLanguage);
    }
  }

  cancelDownload(): void { this.worker?.postMessage({type: 'cancel'}); }

  preload(): void {
    // No automatic network access or model download.
  }

  async initialize(language = 'ru'): Promise<void> {
    const key = language.startsWith('en') ? 'en' : 'ru';
    if (!await this.request('status', key)) {
      await this.openModels(key);
      throw new Error('Download the GigaAM model first / Сначала скачайте модель GigaAM');
    }
    this.loading.next(true);
    try { await this.request('initialize', key); }
    finally { this.loading.next(false); }
  }

  async transcribe(audioBase64: string, language = 'ru'): Promise<string> {
    await this.initialize(language);
    this.transcribing.next(true);
    try {
      const audio = await this.decodeToFloat32(audioBase64);
      return await this.request('transcribe', language.startsWith('en') ? 'en' : 'ru', audio);
    } finally { this.transcribing.next(false); }
  }

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

    // Resample to 16000 using OfflineAudioContext.
    const frameCount = Math.ceil(audioBuffer.duration * 16000);
    const offlineCtx = new OfflineAudioContext(1, frameCount, 16000);
    const src = offlineCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offlineCtx.destination);
    src.start(0);
    const resampled = await offlineCtx.startRendering();

    return resampled.getChannelData(0);
  }
}
