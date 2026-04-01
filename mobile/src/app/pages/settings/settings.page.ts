import { Component, OnInit } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage implements OnInit {
  serverHost = '192.168.1.100';
  serverPort = 8000;
  cameraPosition: 'front' | 'rear' = 'front';
  ttsLang = 'ru-RU';

  async ngOnInit(): Promise<void> {
    const host = await Preferences.get({ key: 'serverHost' });
    const port = await Preferences.get({ key: 'serverPort' });
    const camera = await Preferences.get({ key: 'cameraPosition' });
    const lang = await Preferences.get({ key: 'ttsLang' });

    if (host.value) this.serverHost = host.value;
    if (port.value) this.serverPort = parseInt(port.value, 10);
    if (camera.value) this.cameraPosition = camera.value as 'front' | 'rear';
    if (lang.value) this.ttsLang = lang.value;
  }

  async save(): Promise<void> {
    await Preferences.set({ key: 'serverHost', value: this.serverHost });
    await Preferences.set({ key: 'serverPort', value: String(this.serverPort) });
    await Preferences.set({ key: 'cameraPosition', value: this.cameraPosition });
    await Preferences.set({ key: 'ttsLang', value: this.ttsLang });
  }
}
