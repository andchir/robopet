import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SpeechTestPage } from './speech-test.page';

const routes: Routes = [
  {
    path: '',
    component: SpeechTestPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SpeechTestPageRoutingModule {}
