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
  private readonly THRESHOLD = 0.015;
  /** Accumulated sound must cover this window before speech-start fires (ms). */
  private readonly ONSET_MS = 280;
  /**
   * During onset accumulation, brief dips below threshold are tolerated for
   * up to this long before the onset timer resets. Handles natural speech gaps.
   */
  private readonly ONSET_GRACE_MS = 200;
  /** Sound must stay below threshold for this long before speech-end fires (ms). */
  private readonly RELEASE_MS = 800;

  private tickCount = 0;

  private readonly speechStartSubject = new Subject<void>();
  private readonly speechEndSubject = new Subject<void>();

  readonly onSpeechStart$ = this.speechStartSubject.asObservable();
  readonly onSpeechEnd$ = this.speechEndSubject.asObservable();

  constructor(private ngZone: NgZone) {}

  async start(): Promise<void> {
    console.log('[VAD] start() called, stream already exists:', !!this.stream);
    if (this.stream) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      console.error('[VAD] navigator.mediaDevices.getUserMedia is NOT available');
      return;
    }

    try {
      console.log('[VAD] Requesting microphone…');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log('[VAD] Microphone granted, tracks:', this.stream.getTracks().map(t => `${t.kind}:${t.label}:${t.readyState}`));

      this.audioContext = new AudioContext();
      console.log('[VAD] AudioContext created, state:', this.audioContext.state, 'sampleRate:', this.audioContext.sampleRate);

      // AudioContext may start suspended — resume it explicitly
      if (this.audioContext.state === 'suspended') {
        console.log('[VAD] AudioContext is suspended, resuming…');
        await this.audioContext.resume();
        console.log('[VAD] AudioContext state after resume:', this.audioContext.state);
      }

      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0;
      this.dataArray = new Float32Array(this.analyser.fftSize) as Float32Array<ArrayBuffer>;
      source.connect(this.analyser);

      this.isSpeechActive = false;
      this.aboveThresholdSince = null;
      this.belowThresholdSince = null;
      this.tickCount = 0;

      console.log(`[VAD] Analyser ready — fftSize=${this.analyser.fftSize}, threshold=${this.THRESHOLD}, onset=${this.ONSET_MS}ms, release=${this.RELEASE_MS}ms`);

      this.intervalId = setInterval(() => this.tick(), 50);
      console.log('[VAD] Polling started (50 ms interval)');
    } catch (err) {
      console.error('[VAD] Failed to start:', err);
    }
  }

  stop(): void {
    console.log('[VAD] stop() called');
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.stream?.getTracks().forEach(t => { t.stop(); console.log('[VAD] Track stopped:', t.label); });
    this.stream = null;
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.analyser = null;
    this.isSpeechActive = false;
    this.aboveThresholdSince = null;
    this.belowThresholdSince = null;
    console.log('[VAD] Stopped and cleaned up');
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
    this.tickCount++;

    // Log RMS every ~1 second (20 ticks × 50 ms)
    if (this.tickCount % 20 === 0) {
      const bar = '█'.repeat(Math.min(Math.round(rms * 400), 30));
      console.log(`[VAD] RMS=${rms.toFixed(4)} ${bar}  speaking=${this.isSpeechActive}  ctx=${this.audioContext?.state}`);
    }

    const isSound = rms > this.THRESHOLD;

    if (!this.isSpeechActive) {
      // ── Onset phase: accumulate sound, tolerate brief dips ──────────────
      if (isSound) {
        if (!this.aboveThresholdSince) {
          this.aboveThresholdSince = now;
          this.belowThresholdSince = null;
          console.log(`[VAD] Onset started (RMS=${rms.toFixed(4)}), need ${this.ONSET_MS}ms…`);
        } else {
          // Brief dip ended — clear it, continue accumulating
          this.belowThresholdSince = null;
          const onsetMs = now - this.aboveThresholdSince;
          if (onsetMs >= this.ONSET_MS) {
            this.isSpeechActive = true;
            this.aboveThresholdSince = null;
            this.belowThresholdSince = null;
            console.log(`[VAD] >>> SPEECH START (RMS=${rms.toFixed(4)})`);
            this.ngZone.run(() => this.speechStartSubject.next());
          }
        }
      } else {
        // Below threshold during onset — allow a grace period before resetting
        if (this.aboveThresholdSince !== null) {
          if (!this.belowThresholdSince) {
            this.belowThresholdSince = now;
          } else if (now - this.belowThresholdSince >= this.ONSET_GRACE_MS) {
            console.log(`[VAD] Onset reset after ${this.ONSET_GRACE_MS}ms silence (RMS=${rms.toFixed(4)})`);
            this.aboveThresholdSince = null;
            this.belowThresholdSince = null;
          }
        }
      }
    } else {
      // ── Speech active: detect end ────────────────────────────────────────
      if (isSound) {
        this.belowThresholdSince = null;
      } else {
        if (!this.belowThresholdSince) {
          this.belowThresholdSince = now;
          console.log(`[VAD] Silence detected (RMS=${rms.toFixed(4)}), waiting ${this.RELEASE_MS}ms…`);
        } else if (now - this.belowThresholdSince >= this.RELEASE_MS) {
          this.isSpeechActive = false;
          this.belowThresholdSince = null;
          this.aboveThresholdSince = null;
          console.log(`[VAD] <<< SPEECH END`);
          this.ngZone.run(() => this.speechEndSubject.next());
        }
      }
    }
  }
}
