import { Component, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { ModalController } from '@ionic/angular';
import jsQR from 'jsqr';

@Component({
  selector: 'app-qr-scanner-modal',
  templateUrl: './qr-scanner-modal.component.html',
  styleUrls: ['./qr-scanner-modal.component.scss'],
  standalone: false,
})
export class QrScannerModalComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasEl!: ElementRef<HTMLCanvasElement>;

  scanning = false;
  error = '';

  private stream: MediaStream | null = null;
  private animationId: number | null = null;

  constructor(private modalController: ModalController) {}

  async ngAfterViewInit(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      const video = this.videoEl.nativeElement;
      video.srcObject = this.stream;
      await video.play();
      this.scanning = true;
      this.scanFrame();
    } catch {
      this.error = 'Camera access denied';
    }
  }

  private scanFrame(): void {
    const video = this.videoEl.nativeElement;
    const canvas = this.canvasEl.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });
      if (code) {
        this.dismiss(code.data);
        return;
      }
    }

    this.animationId = requestAnimationFrame(() => this.scanFrame());
  }

  private stopStream(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  dismiss(data?: string): void {
    this.stopStream();
    this.modalController.dismiss(data);
  }

  ngOnDestroy(): void {
    this.stopStream();
  }
}
