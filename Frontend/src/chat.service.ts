import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface VirtualMachineDto {
  name: string;
  os: string;
  osVersion: string;
  powerState: 'Running' | 'Stopped' | string;
  cpuCores: number;
  memoryGb: number;
  diskGb: number;
  ipAddress: string;
  owner: string;
  environment: string;
  tags: string[];
  lastBoot: string;
  notes: string;
}

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private chatApiUrl = 'http://localhost:5000/api/chat';
  private vmApiUrl = 'http://localhost:5000/api/vms';

  constructor(private http: HttpClient, private ngZone: NgZone) { }

  getVms(): Observable<VirtualMachineDto[]> {
    return this.http.get<VirtualMachineDto[]>(this.vmApiUrl);
  }

  sendMessage(message: string, history: ChatMessage[]): Observable<ChatMessage> {
    return this.http.post<ChatMessage>(this.chatApiUrl, { message, history });
  }

  sendMessageStream(message: string, history: ChatMessage[]): Observable<string> {
    const subject = new Subject<string>();

    fetch(`${this.chatApiUrl}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('No reader available');

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            this.ngZone.run(() => subject.complete());
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
  
            const data = line.slice(6);
            if (data === '[DONE]') {
              this.ngZone.run(() => subject.complete());
              return;
            }

            // Optional: add spacing if backend streams without spaces
            this.ngZone.run(() => subject.next(data));
          }
        }
      })
      .catch((error) => this.ngZone.run(() => subject.error(error)));

    return subject.asObservable();
  }
}
