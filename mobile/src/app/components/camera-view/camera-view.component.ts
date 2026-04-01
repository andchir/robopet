import { Component, OnDestroy, OnInit } from '@angular/core';
import { CameraService } from '../../services/camera.service';
import { SocketService } from '../../services/socket.service';

@Component({
  selector: 'app-camera-view',
  templateUrl: './camera-view.component.html',
  standalone: false,
})
export class CameraViewComponent implements OnInit, OnDestroy {
  active = false;

  constructor(
    private cameraService: CameraService,
    private socketService: SocketService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.cameraService.start({ position: 'front', toBack: true });
      this.active = true;
      this.cameraService.startCapture((base64) => {
        this.socketService.sendVideoFrame(base64);
      });
    } catch {
      this.active = false;
    }
  }

  async ngOnDestroy(): Promise<void> {
    await this.cameraService.stop();
  }
}
