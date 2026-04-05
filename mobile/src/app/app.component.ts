import { Component, OnInit } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { TranslocoService } from '@jsverse/transloco';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(private transloco: TranslocoService) {}

  async ngOnInit(): Promise<void> {
    const { value: deviceId } = await Preferences.get({ key: 'deviceId' });
    if (!deviceId) {
      await Preferences.set({ key: 'deviceId', value: crypto.randomUUID() });
    }

    const { value: ttsLang } = await Preferences.get({ key: 'ttsLang' });
    if (ttsLang) {
      const langCode = ttsLang.split('-')[0].toLowerCase();
      this.transloco.setActiveLang(langCode);
    }
  }
}
