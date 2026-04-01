import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { EmotionService } from '../../services/emotion.service';
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
  private params: EmotionParams = {
    eyeWidth: 40, eyeHeight: 40, pupilSize: 12,
    mouthCurve: 0, mouthOpen: 0, browAngle: 0,
    bgColor: '#1a1a2e',
  };
  private targetParams: EmotionParams = { ...this.params };
  private sub!: Subscription;

  constructor(private emotionService: EmotionService) {}

  ngOnInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.resizeCanvas();

    this.sub = this.emotionService.currentParams$.subscribe(p => {
      this.targetParams = { ...p };
    });

    this.animate();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.sub?.unsubscribe();
  }

  private resizeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement!;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private animate = (): void => {
    const t = 0.08;
    this.params = {
      eyeWidth: this.lerp(this.params.eyeWidth, this.targetParams.eyeWidth, t),
      eyeHeight: this.lerp(this.params.eyeHeight, this.targetParams.eyeHeight, t),
      pupilSize: this.lerp(this.params.pupilSize, this.targetParams.pupilSize, t),
      mouthCurve: this.lerp(this.params.mouthCurve, this.targetParams.mouthCurve, t),
      mouthOpen: this.lerp(this.params.mouthOpen, this.targetParams.mouthOpen, t),
      browAngle: this.lerp(this.params.browAngle, this.targetParams.browAngle, t),
      bgColor: this.targetParams.bgColor,
    };

    this.draw();
    this.animationId = requestAnimationFrame(this.animate);
  };

  private draw(): void {
    const { ctx } = this;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.fillStyle = this.params.bgColor;
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const eyeSpacing = w * 0.18;
    const eyeY = cy - h * 0.08;

    this.drawEye(cx - eyeSpacing, eyeY);
    this.drawEye(cx + eyeSpacing, eyeY);
    this.drawMouth(cx, cy + h * 0.12);
  }

  private drawEye(x: number, y: number): void {
    const { ctx, params } = this;
    const scale = ctx.canvas.width / 320;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x, y, params.eyeWidth * scale, params.eyeHeight * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#222222';
    ctx.beginPath();
    ctx.arc(x, y, params.pupilSize * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawMouth(x: number, y: number): void {
    const { ctx, params } = this;
    const scale = ctx.canvas.width / 320;
    const mouthWidth = 50 * scale;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - mouthWidth, y);
    ctx.bezierCurveTo(
      x - mouthWidth / 2, y + params.mouthCurve * scale,
      x + mouthWidth / 2, y + params.mouthCurve * scale,
      x + mouthWidth, y,
    );
    ctx.stroke();

    if (params.mouthOpen > 1) {
      ctx.fillStyle = '#111111';
      ctx.beginPath();
      ctx.ellipse(x, y + params.mouthCurve * scale * 0.3, mouthWidth * 0.5, params.mouthOpen * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
