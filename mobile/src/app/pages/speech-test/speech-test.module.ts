import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslocoModule } from '@jsverse/transloco';

import { SpeechTestPageRoutingModule } from './speech-test-routing.module';
import { SpeechTestPage } from './speech-test.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslocoModule,
    SpeechTestPageRoutingModule,
  ],
  declarations: [SpeechTestPage],
})
export class SpeechTestPageModule {}
