import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { TranslocoModule } from '@jsverse/transloco';
import { HomePage } from './home.page';
import { HomePageRoutingModule } from './home-routing.module';
import { RobotFaceComponent } from '../components/robot-face/robot-face.component';
import { CameraViewComponent } from '../components/camera-view/camera-view.component';
import { VoiceButtonComponent } from '../components/voice-button/voice-button.component';
import { SpeechWordsComponent } from '../components/speech-words/speech-words.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HomePageRoutingModule,
    TranslocoModule,
  ],
  declarations: [
    HomePage,
    RobotFaceComponent,
    CameraViewComponent,
    VoiceButtonComponent,
    SpeechWordsComponent,
  ],
})
export class HomePageModule {}
