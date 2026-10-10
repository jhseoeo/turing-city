import type { ServerToViewer, ViewerToServer } from '@turing-city/core';

/** The game server's socket: same origin when the server serves the page, port 7840 under Vite's dev server. */
export function gameSocketUrl(location: Location): string {
  if (location.port === '5173') return 'ws://127.0.0.1:7840/ws';
  return `ws://${location.host}/ws`;
}

/** A WebSocket that reconnects every second while the server is away. */
export class Connection {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly onMessage: (message: ServerToViewer) => void;
  private readonly onOpenChange: (open: boolean) => void;

  constructor(url: string, onMessage: (message: ServerToViewer) => void, onOpenChange: (open: boolean) => void) {
    this.url = url;
    this.onMessage = onMessage;
    this.onOpenChange = onOpenChange;
    this.open();
  }

  send(message: ViewerToServer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private open(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => this.onOpenChange(true));
    socket.addEventListener('message', (event: MessageEvent<string>) => this.onMessage(JSON.parse(event.data) as ServerToViewer));
    socket.addEventListener('close', () => {
      this.onOpenChange(false);
      setTimeout(() => this.open(), 1000);
    });
  }
}
