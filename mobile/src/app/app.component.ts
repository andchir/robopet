import { Component, OnInit } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor() {}

  async ngOnInit(): Promise<void> {
    const { value } = await Preferences.get({ key: 'deviceId' });
    if (!value) {
      await Preferences.set({ key: 'deviceId', value: crypto.randomUUID() });
    }
  }
}
