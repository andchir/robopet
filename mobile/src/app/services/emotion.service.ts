import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Emotion, EmotionParams } from '../models/types';

const EMOTION_PRESETS: Record<Emotion, EmotionParams> = {
  neutral:   { eyeWidth: 40, eyeHeight: 40, pupilSize: 12, mouthCurve: 0,   mouthOpen: 0,  browAngle: 0,   bgColor: '#1a1a2e' },
  happy:     { eyeWidth: 44, eyeHeight: 36, pupilSize: 14, mouthCurve: 20,  mouthOpen: 8,  browAngle: -5,  bgColor: '#1a2e1a' },
  sad:       { eyeWidth: 36, eyeHeight: 44, pupilSize: 10, mouthCurve: -15, mouthOpen: 0,  browAngle: 15,  bgColor: '#1a1a3e' },
  surprised: { eyeWidth: 50, eyeHeight: 50, pupilSize: 8,  mouthCurve: 0,   mouthOpen: 20, browAngle: -15, bgColor: '#2e1a2e' },
  angry:     { eyeWidth: 44, eyeHeight: 30, pupilSize: 10, mouthCurve: -10, mouthOpen: 5,  browAngle: 20,  bgColor: '#2e1a1a' },
  thinking:  { eyeWidth: 38, eyeHeight: 42, pupilSize: 11, mouthCurve: -3,  mouthOpen: 0,  browAngle: 10,  bgColor: '#1a1a2e' },
  excited:   { eyeWidth: 48, eyeHeight: 44, pupilSize: 16, mouthCurve: 25,  mouthOpen: 12, browAngle: -10, bgColor: '#2e2e1a' },
};

@Injectable({ providedIn: 'root' })
export class EmotionService {
  private readonly emotion$ = new BehaviorSubject<Emotion>('neutral');
  private readonly params$ = new BehaviorSubject<EmotionParams>(EMOTION_PRESETS['neutral']);

  get currentEmotion$(): Observable<Emotion> {
    return this.emotion$.asObservable();
  }

  get currentParams$(): Observable<EmotionParams> {
    return this.params$.asObservable();
  }

  setEmotion(emotion: Emotion): void {
    this.emotion$.next(emotion);
    this.params$.next(EMOTION_PRESETS[emotion]);
  }

  getPreset(emotion: Emotion): EmotionParams {
    return { ...EMOTION_PRESETS[emotion] };
  }
}
