import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { ChatService, ChatMessage, VirtualMachineDto } from '../chat.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatSidenavModule,
    MatListModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule
  ],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss']
})
export class ChatComponent implements OnInit, OnDestroy {
  messages: ChatMessage[] = [];
  userInput: string = '';
  isLoading: boolean = false;
  useStreaming: boolean = true;
  private streamSubscription?: Subscription;

  vms: VirtualMachineDto[] = [];

  constructor(private chatService: ChatService) { }

  ngOnInit(): void {
    this.chatService.getVms().subscribe({
      next: (vms) => (this.vms = vms),
      error: (err) => console.error('Failed to load VMs', err)
    });
  }

  sendMessage(): void {
    if (!this.userInput.trim()) return;

    const userMessage: ChatMessage = { role: 'user', content: this.userInput };
    this.messages.push(userMessage);
    this.isLoading = true;

    const input = this.userInput;
    this.userInput = '';

    if (this.useStreaming) this.sendStreamingMessage(input);
    else this.sendNonStreamingMessage(input);
  }

  private sendStreamingMessage(input: string): void {
    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    this.messages.push(assistantMessage);
    const messageIndex = this.messages.length - 1;

    this.streamSubscription = this.chatService.sendMessageStream(input, this.messages).subscribe({
      next: (chunk: string) => {
        const cleaned = this.cleanupAssistantText(chunk);
        this.messages[messageIndex].content += cleaned;
        this.messages[messageIndex].content = this.prettifyVmDetails(this.messages[messageIndex].content);
      },
      error: (err) => {
        console.error('Stream error:', err);
        this.messages[messageIndex].content += '\n[Error: Failed to get response]';
        this.isLoading = false;
      },
      complete: () => (this.isLoading = false)
    });
  }

  private sendNonStreamingMessage(input: string): void {
    this.chatService.sendMessage(input, this.messages).subscribe({
      next: (response: ChatMessage) => {
        response.content = this.prettifyVmDetails(this.cleanupAssistantText(response.content));
        this.messages.push(response);
        this.isLoading = false;
      },
      error: (err) => {
        console.error(err);
        this.isLoading = false;
      }
    });
  }

  onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  ngOnDestroy(): void {
    this.streamSubscription?.unsubscribe();
  }

  private cleanupAssistantText(text: string): string {
    // Remove common markdown emphasis markers without affecting normal characters.
    return text
      .replaceAll('**', '')
      .replaceAll('__', '')
      .replaceAll('### ', '')
      .replaceAll('## ', '')
      .replaceAll('# ', '');
  }

  private prettifyVmDetails(text: string): string {
    let t = text.replace(/\r\n/g, '\n');

    // Remove markdown remnants
    t = t.replaceAll('**', '').replaceAll('__', '');

    // Convert " - " separators to newlines (your model uses these a lot)
    t = t.replace(/\s*-\s*/g, '\n');

    // Ensure header breaks into body: "...machines: 1." -> "...machines:\n\n1."
    t = t.replace(/:\s*(\d+)\s*\./g, ':\n\n$1.');

    // Normalize numbering "1." "2." and add blank line between VM blocks
    t = t.replace(/(\n|^)\s*(\d+)\s*\.\s*/g, (_m, p1, n) => `${p1}${n}. `);
    t = t.replace(/\n(\d+)\.\s/g, '\n\n$1. ');

    // Labels we expect (include variations seen in your screenshot)
    const labels = [
      'VM Name:',
      'Operating System:',
      'OS:',
      'OS Version:',
      'Power State:',
      'CPU Cores:',
      'Memory:',
      'Memory (GB):',
      'Disk Size:',
      'Disk Size (GB):',
      'IP Address:',
      'Owner:',
      'Environment:',
      'Tags:',
      'Last Boot:',
      'Last Boot Time:',
      'Last Boot Time (UTC):',
      'Notes:'
    ];

    // Force newline before any label if it's glued to previous text
    for (const label of labels) {
      const re = new RegExp(`(\\S)\\s*(${this.escapeRegExp(label)})`, 'g');
      t = t.replace(re, `$1\n$2`);
    }

    // Fix common glued patterns from the screenshot
    t = t.replace(/VM\s*\n?Name:\s*/g, 'VM Name: ');
    t = t.replace(/(DEV|QA)\s*\n\s*(W11\s*0?1|W11\s*EDGE)/g, (_m, a, b) => {
      const name = `${a}-${b.replace(/\s+/g, '')}`;
      return name.replace('W1101', 'W11-01').replace('W11EDGE', 'W11-EDGE');
    });
    t = t.replace(/(W11-01|W11-EDGE)Operating System:/g, '$1\nOperating System:');

    // Join broken owner/team lines
    t = t.replace(/\bOwner:\s*dev\s*\n\s*team\b/gi, 'Owner: dev-team');
    t = t.replace(/\bOwner:\s*qa\s*\n\s*team\b/gi, 'Owner: qa-team');

    // Fix glued Tags + Last Boot on same line
    t = t.replace(/(Tags:[^\n]*?)(Last Boot(?: Time)?(?: \(UTC\))?:)/g, '$1\n$2');

    // Normalize colon spacing
    t = t.replace(/:\s*/g, ': ');

    // Make "VM Name:" line act like a header if present
    // Example: "1. VM Name: DEV-W11-01" -> "\nVM 1 — DEV-W11-01"
    t = t.replace(/\n?(\d+)\.\s*VM Name:\s*(.+)\n/g, (_m, n, name) => `\n\nVM ${n} — ${name.trim()}\n`);

    // Also handle "1. DEV-W11-01" style
    t = t.replace(/\n?(\d+)\.\s*(DEV-W11-01|QA-W11-EDGE)\n/g, (_m, n, name) => `\n\nVM ${n} — ${name}\n`);

    // Indent fields under each VM header to look nicer
    t = t.replace(/\n(OS|Operating System|OS Version|Power State|CPU Cores|Memory|Disk Size|IP Address|Owner|Environment|Tags|Last Boot|Last Boot Time|Last Boot Time \(UTC\)|Notes):/g, '\n  $1:');

    // Try to normalize weird UTC timestamps like: 2026022604: 06: 02  -> 2026-02-26 04:06:02
    t = t.replace(
      /(Last Boot Time \(UTC\):\s*)(\d{4})(\d{2})(\d{2})(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})/g,
      '$1$2-$3-$4 $5:$6:$7'
    );

    // Separate footer
    t = t.replace(/\.\s*(If you need\b)/g, '.\n\n$1');

    // Cleanup whitespace
    t = t.replace(/[ \t]+\n/g, '\n');
    t = t.replace(/\n{3,}/g, '\n\n');

    return t.trim();
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

