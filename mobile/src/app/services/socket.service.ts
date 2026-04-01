import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { RobotResponse } from '../models/types';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;
  private readonly connected$ = new BehaviorSubject<boolean>(false);
  private readonly robotResponse$ = new Subject<RobotResponse>();
  private language = 'en';
  private robotName = 'RoboPet';

  get isConnected$(): Observable<boolean> {
    return this.connected$.asObservable();
  }

  get onRobotResponse$(): Observable<RobotResponse> {
    return this.robotResponse$.asObservable();
  }

  setLanguage(lang: string): void {
    this.language = lang;
  }

  setRobotName(name: string): void {
    this.robotName = name;
  }

  connect(host: string, port: number): void {
    this.disconnect();

    const url = `http://${host}:${port}`;
    console.log(`[Socket] Connecting to ${url}…`);

    this.socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    this.socket.on('connect', () => {
      console.log(`[Socket] Connected (id=${this.socket?.id})`);
      this.connected$.next(true);
    });

    this.socket.on('disconnect', (reason: string) => {
      console.warn(`[Socket] Disconnected — reason: ${reason}`);
      this.connected$.next(false);
    });

    this.socket.on('connect_error', (err: Error) => {
      console.error(`[Socket] Connection error: ${err.message}`);
    });

    this.socket.on('reconnect_attempt', (attempt: number) => {
      console.log(`[Socket] Reconnect attempt #${attempt}`);
    });

    this.socket.on('reconnect', (attempt: number) => {
      console.log(`[Socket] Reconnected after ${attempt} attempt(s)`);
    });

    this.socket.on('robot_response', (data: RobotResponse) => {
      console.log(`[Socket] ← robot_response  emotion="${data.emotion}"  text="${data.text.slice(0, 80)}${data.text.length > 80 ? '…' : ''}"`);
      this.robotResponse$.next(data);
    });
  }

  disconnect(): void {
    if (this.socket) {
      console.log('[Socket] Disconnecting…');
      this.socket.disconnect();
      this.socket = null;
      this.connected$.next(false);
    }
  }

  sendVideoFrame(frameBase64: string): void {
    this.socket?.emit('video_frame', { image: frameBase64 });
  }

  sendAudioData(audioBase64: string): void {
    const kb = ((audioBase64.length * 3) / 4 / 1024).toFixed(1);
    console.log(`[Socket] → audio_data  size≈${kb} KB  lang=${this.language}  robot=${this.robotName}`);
    this.socket?.emit('audio_data', { audio: audioBase64, language: this.language, robot_name: this.robotName });
  }

  sendChatMessage(text: string): void {
    console.log(`[Socket] → chat_message  text="${text}"`);
    this.socket?.emit('chat_message', { text, language: this.language, robot_name: this.robotName });
  }
}
