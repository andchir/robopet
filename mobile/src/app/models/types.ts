export type Emotion = 'happy' | 'sad' | 'surprised' | 'angry' | 'thinking' | 'neutral' | 'excited';

export interface EmotionParams {
  eyeWidth: number;
  eyeHeight: number;
  pupilSize: number;
  mouthCurve: number;
  mouthOpen: number;
  browAngle: number;
  bgColor: string;
}

export interface RobotResponse {
  text: string;
  emotion: Emotion;
}

export interface DetectedObject {
  label: string;
  confidence: number;
}

export interface DetectedGesture {
  name: string;
  confidence: number;
}

export interface VisionResult {
  gestures: DetectedGesture[];
  objects: DetectedObject[];
}

export interface ServerConfig {
  host: string;
  port: number;
}
