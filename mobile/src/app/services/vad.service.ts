import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class VadService {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray!: Float32Array<ArrayBuffer>;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private isSpeechActive = false;
  private aboveThresholdSince: number | null = null;
  private belowThresholdSince: number | null = null;

  /** RMS energy threshold — values above this are considered "sound". */
  private readonly THRESHOLD = 0.02;
  /** Sound must stay above threshold for this long before speech-start fires (ms). */
  private readonly ONSET_MS = 400;
  /** Sound must stay below threshold for this long before speech-end fires (ms). */
  private readonly RELEASE_MS = 700;

  private readonly speechStartSubject = new Subject<void>();
  private readonly speechEndSubject = new Subject<void>();

  readonly onSpeechStart$ = this.speechStartSubject.asObservable();
  readonly onSpeechEnd$ = this.speechEndSubject.asObservable();

  constructor(private ngZone: NgZone) {}

  async start(): Promise<void> {
    if (this.stream) return; // already running
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.dataArray = new Float32Array(this.analyser.fftSize) as Float32Array<ArrayBuffer>;
      source.connect(this.analyser);

      this.isSpeechActive = false;
      this.aboveThresholdSince = null;
      this.belowThresholdSince = null;

      this.intervalId = setInterval(() => this.tick(), 50);
    } catch (err) {
      console.error('[VAD] Failed to start:', err);
    }
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.analyser = null;
    this.isSpeechActive = false;
    this.aboveThresholdSince = null;
    this.belowThresholdSince = null;
  }

  private tick(): void {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.dataArray);

    let sumSq = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sumSq += this.dataArray[i] ** 2;
    }
    const rms = Math.sqrt(sumSq / this.dataArray.length);
    const now = Date.now();

    if (rms > this.THRESHOLD) {
      this.belowThresholdSince = null;
      if (!this.isSpeechActive) {
        if (!this.aboveThresholdSince) {
          this.aboveThresholdSince = now;
        } else if (now - this.aboveThresholdSince >= this.ONSET_MS) {
          this.isSpeechActive = true;
          this.aboveThresholdSince = null;
          this.ngZone.run(() => this.speechStartSubject.next());
        }
      }
    } else {
      this.aboveThresholdSince = null;
      if (this.isSpeechActive) {
        if (!this.belowThresholdSince) {
          this.belowThresholdSince = now;
        } else if (now - this.belowThresholdSince >= this.RELEASE_MS) {
          this.isSpeechActive = false;
          this.belowThresholdSince = null;
          this.ngZone.run(() => this.speechEndSubject.next());
        }
      }
    }
  }
}
