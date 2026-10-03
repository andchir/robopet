import { Injectable, NgZone } from '@angular/core';

@Injectable({providedIn: 'root'})
export class SupertonicService {
  dialogOpen = false;
  downloading = false;
  installed = false;
  progress = 0;
  error = '';
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<number, {resolve: (v: any) => void; reject: (e: Error) => void}>();
  constructor(private zone: NgZone) {}
  private request(type: string, values = {}): Promise<any> {
    if (!this.worker) {
      this.worker = new Worker(new URL('assets/supertonic/worker.mjs', document.baseURI), {type: 'module'});
      this.worker.onmessage = ({data}) => this.zone.run(() => {
        if (data.progress !== undefined) { this.progress = data.progress; return; }
        const task = this.pending.get(data.id); this.pending.delete(data.id);
        if (data.error) task?.reject(new Error(data.error)); else task?.resolve(data.result);
      });
      this.worker.onerror = () => this.zone.run(() => {
        this.worker?.terminate(); this.worker = undefined;
        for (const task of this.pending.values()) task.reject(new Error('WORKER_FAILED'));
        this.pending.clear();
      });
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {this.pending.set(id, {resolve, reject}); this.worker!.postMessage({id, type, ...values});});
  }
  async openModels(): Promise<void> {
    this.error = ''; this.dialogOpen = true;
    try {this.installed = await this.request('status');} catch {this.error = 'supertonic.failed';}
  }
  async download(): Promise<void> {
    if (this.downloading) return;
    this.downloading = true; this.error = ''; this.progress = 0;
    try {
      await navigator.storage?.persist?.();
      this.installed = await this.request('download'); this.progress = 1;
    } catch (e) {this.error = (e as Error).message === 'CANCELLED' ? '' : 'supertonic.failed';}
    finally {this.downloading = false;}
  }
  cancelDownload(): void {this.worker?.postMessage({type: 'cancel'});}
  cancelSynthesis(): void {
    if (this.downloading || !this.pending.size) return;
    this.worker?.terminate(); this.worker = undefined;
    for (const task of this.pending.values()) task.reject(new Error('CANCELLED'));
    this.pending.clear();
  }
  async synthesize(text: string, lang: string, voice: string): Promise<{audio: Float32Array; sampleRate: number} | null> {
    if (this.downloading) {this.dialogOpen = true; return null;}
    this.installed = await this.request('status');
    if (!this.installed) {this.dialogOpen = true; return null;}
    try {return await this.request('synthesize', {text, lang, voice});}
    catch (e) {
      if ((e as Error).message !== 'CANCELLED') {this.error = 'supertonic.synthesis-failed'; this.dialogOpen = true;}
      throw e;
    }
  }
}
