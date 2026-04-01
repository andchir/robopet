import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { EmotionService } from '../../services/emotion.service';
import { VoiceService } from '../../services/voice.service';
import { EmotionParams } from '../../models/types';

@Component({
  selector: 'app-robot-face',
  templateUrl: './robot-face.component.html',
  styleUrls: ['./robot-face.component.scss'],
  standalone: false,
})
export class RobotFaceComponent implements OnInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private ctx!: CanvasRenderingContext2D;
  private animationId = 0;
  private dpr = 1;

  private params: EmotionParams = {
    eyeWidth: 40, eyeHeight: 40, pupilSize: 12,
    mouthCurve: 0, mouthOpen: 0, browAngle: 0,
    bgColor: '#1a1a2e',
  };
  private targetParams: EmotionParams = { ...this.params };
  private subs: Subscription[] = [];
  private resizeObserver: ResizeObserver | null = null;

  private nextBlinkTime = 0;
  private blinkProgress = -1;
  private blinkStartTime = 0;
  private readonly blinkDurationMs = 160;

  private gazeX = 0;
  private gazeY = 0;
  private targetGazeX = 0;
  private targetGazeY = 0;
  private nextGazeTime = 0;

  private isSpeaking = false;
  private speakPhase = 0;
  private lastFrameTime = 0;
  private elapsed = 0;

  constructor(
    private emotionService: EmotionService,
    private voiceService: VoiceService,
  ) {}

  ngOnInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.dpr = window.devicePixelRatio || 1;
    this.resizeCanvas();

    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(canvas.parentElement!);

    this.scheduleNextBlink();
    this.scheduleGazeShift();

    this.subs.push(
      this.emotionService.currentParams$.subscribe(p => {
        this.targetParams = { ...p };
      }),
      this.voiceService.isSpeaking$.subscribe(s => {
        this.isSpeaking = s;
        if (!s) this.speakPhase = 0;
      }),
    );

    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame(this.tick);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.subs.forEach(s => s.unsubscribe());
    this.resizeObserver?.disconnect();
  }

  private resizeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement!;
    this.dpr = window.devicePixelRatio || 1;
    canvas.width = parent.clientWidth * this.dpr;
    canvas.height = parent.clientHeight * this.dpr;
    canvas.style.width = `${parent.clientWidth}px`;
    canvas.style.height = `${parent.clientHeight}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private scheduleNextBlink(): void {
    this.nextBlinkTime = performance.now() + 2500 + Math.random() * 3500;
    this.blinkProgress = -1;
  }

  private scheduleGazeShift(): void {
    this.targetGazeX = (Math.random() - 0.5) * 0.5;
    this.targetGazeY = (Math.random() - 0.5) * 0.3;
    this.nextGazeTime = performance.now() + 1500 + Math.random() * 2500;
  }

  private tick = (now: number): void => {
    const dt = Math.min(now - this.lastFrameTime, 50);
    this.lastFrameTime = now;
    this.elapsed += dt;

    this.update(now, dt);
    this.render();
    this.animationId = requestAnimationFrame(this.tick);
  };

  private update(now: number, dt: number): void {
    const t = 1 - Math.pow(0.002, dt / 16.67);

    this.params = {
      eyeWidth: this.lerp(this.params.eyeWidth, this.targetParams.eyeWidth, t),
      eyeHeight: this.lerp(this.params.eyeHeight, this.targetParams.eyeHeight, t),
      pupilSize: this.lerp(this.params.pupilSize, this.targetParams.pupilSize, t),
      mouthCurve: this.lerp(this.params.mouthCurve, this.targetParams.mouthCurve, t),
      mouthOpen: this.lerp(this.params.mouthOpen, this.targetParams.mouthOpen, t),
      browAngle: this.lerp(this.params.browAngle, this.targetParams.browAngle, t),
      bgColor: this.targetParams.bgColor,
    };

    if (this.blinkProgress >= 0) {
      this.blinkProgress = (now - this.blinkStartTime) / this.blinkDurationMs;
      if (this.blinkProgress >= 1) this.scheduleNextBlink();
    } else if (now >= this.nextBlinkTime) {
      this.blinkProgress = 0;
      this.blinkStartTime = now;
    }

    if (now >= this.nextGazeTime) this.scheduleGazeShift();
    const gt = 1 - Math.pow(0.005, dt / 16.67);
    this.gazeX = this.lerp(this.gazeX, this.targetGazeX, gt);
    this.gazeY = this.lerp(this.gazeY, this.targetGazeY, gt);

    if (this.isSpeaking) this.speakPhase += dt * 0.015;
  }

  private getBlinkFactor(): number {
    if (this.blinkProgress < 0) return 1;
    const p = Math.min(this.blinkProgress, 1);
    if (p < 0.5) {
      const c = p * 2;
      return 1 - 0.95 * c * c;
    }
    const o = (p - 0.5) * 2;
    return 0.05 + 0.95 * (1 - (1 - o) * (1 - o));
  }

  private render(): void {
    const { ctx, dpr } = this;
    const w = ctx.canvas.width / dpr;
    const h = ctx.canvas.height / dpr;
    const scale = Math.min(w, h) / 320;
    const cx = w / 2;
    const cy = h / 2;
    const blink = this.getBlinkFactor();

    const idleY = Math.sin(this.elapsed * 0.001) * 2 * scale;

    ctx.fillStyle = this.params.bgColor;
    ctx.fillRect(0, 0, w, h);

    this.drawFacePlate(w, h, scale);

    const eyeSpacing = 55 * scale;
    const eyeY = cy - 20 * scale + idleY;

    const browY = eyeY - this.params.eyeHeight * scale * blink - 10 * scale;
    this.drawBrow(cx - eyeSpacing, browY, scale, true);
    this.drawBrow(cx + eyeSpacing, browY, scale, false);

    this.drawEye(cx - eyeSpacing, eyeY, scale, blink);
    this.drawEye(cx + eyeSpacing, eyeY, scale, blink);

    this.drawMouth(cx, cy + 40 * scale + idleY, scale);
  }

  private drawRoundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  private drawFacePlate(w: number, h: number, scale: number): void {
    const { ctx } = this;
    const margin = 20 * scale;
    const radius = 24 * scale;

    this.drawRoundRect(margin, margin, w - margin * 2, h - margin * 2, radius);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private drawBrow(x: number, y: number, scale: number, isLeft: boolean): void {
    const { ctx, params } = this;
    const halfLen = 14 * scale;
    const rad = params.browAngle * (Math.PI / 180);
    const tiltY = Math.sin(rad) * halfLen;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 3.5 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();

    if (isLeft) {
      ctx.moveTo(x - halfLen, y + tiltY);
      ctx.lineTo(x + halfLen, y - tiltY);
    } else {
      ctx.moveTo(x - halfLen, y - tiltY);
      ctx.lineTo(x + halfLen, y + tiltY);
    }
    ctx.stroke();
  }

  private drawEye(x: number, y: number, scale: number, blinkFactor: number): void {
    const { ctx, params } = this;
    const ew = params.eyeWidth * scale;
    const eh = params.eyeHeight * scale * blinkFactor;

    const breathe = 0.85 + Math.sin(this.elapsed * 0.002) * 0.15;
    const glowAlpha = (0.07 * breathe).toFixed(3);
    const glow = ctx.createRadialGradient(x, y, ew * 0.3, x, y, ew * 1.8);
    glow.addColorStop(0, `rgba(80, 180, 255, ${glowAlpha})`);
    glow.addColorStop(1, 'rgba(80, 180, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x, y, ew * 1.8, Math.max(eh * 1.8, 2), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e8f0ff';
    ctx.beginPath();
    ctx.ellipse(x, y, ew, Math.max(eh, 1), 0, 0, Math.PI * 2);
    ctx.fill();

    if (eh < 3) return;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, ew, eh, 0, 0, Math.PI * 2);
    ctx.clip();

    const px = x + this.gazeX * ew * 0.35;
    const py = y + this.gazeY * eh * 0.35;
    const ps = params.pupilSize * scale;

    const irisR = ps * 1.6;
    const irisGrad = ctx.createRadialGradient(px, py, ps * 0.3, px, py, irisR);
    irisGrad.addColorStop(0, '#1e3d5f');
    irisGrad.addColorStop(0.6, '#2a6896');
    irisGrad.addColorStop(1, '#5aa0d0');
    ctx.fillStyle = irisGrad;
    ctx.beginPath();
    ctx.arc(px, py, irisR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#080810';
    ctx.beginPath();
    ctx.arc(px, py, ps, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.arc(px - ps * 0.35, py - ps * 0.35, ps * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(px + ps * 0.3, py + ps * 0.3, ps * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawMouth(x: number, y: number, scale: number): void {
    const { ctx, params } = this;
    const mw = 42 * scale;
    const curve = params.mouthCurve * scale;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = 'round';

    if (this.isSpeaking) {
      const w1 = Math.sin(this.speakPhase);
      const w2 = Math.sin(this.speakPhase * 2.3) * 0.4;
      const w3 = Math.sin(this.speakPhase * 0.7) * 0.3;
      const openAmount = Math.max(2, 7 + (w1 + w2 + w3) * 6);
      const oh = openAmount * scale;
      const openY = y + Math.max(curve * 0.35, 0);

      ctx.fillStyle = '#0d0d1a';
      ctx.beginPath();
      ctx.ellipse(x, openY, mw * 0.55, oh, 0, 0, Math.PI * 2);
      ctx.fill();

      const tongueH = Math.max(oh * 0.3, 4 * scale);
      ctx.fillStyle = '#c04060';
      ctx.beginPath();
      ctx.ellipse(x, openY + oh * 0.35, mw * 0.25, tongueH, 0, 0, Math.PI);
      ctx.fill();
    } else {
      // Closed mouth: bezier smile line only
      ctx.beginPath();
      ctx.moveTo(x - mw, y);
      ctx.bezierCurveTo(x - mw * 0.35, y + curve, x + mw * 0.35, y + curve, x + mw, y);
      ctx.stroke();
    }
  }
}
