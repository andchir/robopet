import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslocoModule } from '@jsverse/transloco';

import { SettingsPageRoutingModule } from './settings-routing.module';
import { SettingsPage } from './settings.page';
import { QrDisplayModalComponent } from './qr-display-modal.component';
import { QrScannerModalComponent } from './qr-scanner-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslocoModule,
    SettingsPageRoutingModule,
  ],
  declarations: [SettingsPage, QrDisplayModalComponent, QrScannerModalComponent],
})
export class SettingsPageModule {}
