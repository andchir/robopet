import { Injectable, NgZone } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CameraPreview, CameraPreviewOptions } from '@capacitor-community/camera-preview';

@Injectable({ providedIn: 'root' })
export class CameraService {
  private capturing = false;
  private captureInterval: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(private zone: NgZone) {}

  get isAvailable(): boolean {
    return Capacitor.isNativePlatform();
  }

  async start(options?: Partial<CameraPreviewOptions>): Promise<void> {
    if (!this.isAvailable) return;
    await CameraPreview.start({
      position: 'front',
      toBack: true,
      storeToFile: false,
      disableAudio: true,
      ...options,
    });
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopCapture();
    if (this.started) {
      await CameraPreview.stop();
      this.started = false;
    }
  }

  startCapture(callback: (base64: string) => void, intervalMs = 300): void {
    if (this.capturing || !this.started) return;
    this.capturing = true;

    this.captureInterval = setInterval(async () => {
      try {
        const result = await CameraPreview.capture({ quality: 60 });
        this.zone.run(() => callback(result.value));
      } catch {
        // frame skipped
      }
    }, intervalMs);
  }

  stopCapture(): void {
    this.capturing = false;
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
  }

  async flip(): Promise<void> {
    if (this.started) await CameraPreview.flip();
  }
}
