import { Injectable, NgZone } from '@angular/core';
import { CameraPreview, CameraPreviewOptions } from '@capacitor-community/camera-preview';

@Injectable({ providedIn: 'root' })
export class CameraService {
  private capturing = false;
  private captureInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private zone: NgZone) {}

  async start(options?: Partial<CameraPreviewOptions>): Promise<void> {
    await CameraPreview.start({
      position: 'front',
      toBack: true,
      storeToFile: false,
      disableAudio: true,
      ...options,
    });
  }

  async stop(): Promise<void> {
    this.stopCapture();
    await CameraPreview.stop();
  }

  startCapture(callback: (base64: string) => void, intervalMs = 300): void {
    if (this.capturing) return;
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
    await CameraPreview.flip();
  }
}
