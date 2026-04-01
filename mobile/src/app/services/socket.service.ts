import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { RobotResponse } from '../models/types';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;
  private readonly connected$ = new BehaviorSubject<boolean>(false);
  private readonly robotResponse$ = new Subject<RobotResponse>();

  get isConnected$(): Observable<boolean> {
    return this.connected$.asObservable();
  }

  get onRobotResponse$(): Observable<RobotResponse> {
    return this.robotResponse$.asObservable();
  }

  connect(host: string, port: number): void {
    this.disconnect();

    this.socket = io(`http://${host}:${port}`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    this.socket.on('connect', () => this.connected$.next(true));
    this.socket.on('disconnect', () => this.connected$.next(false));
    this.socket.on('robot_response', (data: RobotResponse) => {
      this.robotResponse$.next(data);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected$.next(false);
    }
  }

  sendVideoFrame(frameBase64: string): void {
    this.socket?.emit('video_frame', { image: frameBase64 });
  }

  sendAudioData(audioBase64: string): void {
    this.socket?.emit('audio_data', { audio: audioBase64 });
  }

  sendChatMessage(text: string): void {
    this.socket?.emit('chat_message', { text });
  }
}
