import { Component, Input, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { ModalController } from '@ionic/angular';
import * as QRCode from 'qrcode';

@Component({
  selector: 'app-qr-display-modal',
  templateUrl: './qr-display-modal.component.html',
  styleUrls: ['./qr-display-modal.component.scss'],
  standalone: false,
})
export class QrDisplayModalComponent implements AfterViewInit {
  @Input() deviceId = '';
  @ViewChild('qrCanvas') qrCanvas!: ElementRef<HTMLCanvasElement>;

  constructor(private modalController: ModalController) {}

  ngAfterViewInit(): void {
    QRCode.toCanvas(this.qrCanvas.nativeElement, this.deviceId, {
      width: 280,
      margin: 2,
    });
  }

  dismiss(): void {
    this.modalController.dismiss();
  }
}
