type EventHandler = (payload: unknown) => void;
type RequestFrame = { type: 'req'; id: string; method: string; params?: unknown };
type ResponseFrame = { type: 'res'; id: string; result?: unknown; error?: { code: number; message: string } };
type EventFrame = { type: 'event'; event: string; payload: unknown };
type Frame = RequestFrame | ResponseFrame | EventFrame;

let idCounter = 0;
function nextId(): string {
  return `req_${++idCounter}_${Date.now().toString(36)}`;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private _connected = false;

  constructor(
    private url: string = `ws://${window.location.host}/ws`,
    private token: string = '',
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    const wsUrl = this.token ? `${this.url}?token=${this.token}` : this.url;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectDelay = 1000;
      this.emit('_connected', null);
    };

    this.ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string) as Frame;
        this.handleFrame(frame);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.emit('_disconnected', null);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  /** Send a request and wait for response */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const id = nextId();
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });

      const frame: RequestFrame = { type: 'req', id, method, params };
      this.ws.send(JSON.stringify(frame));

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  /** Subscribe to an event */
  on(event: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  private handleFrame(frame: Frame): void {
    if (frame.type === 'res') {
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        if (frame.error) {
          pending.reject(new Error(frame.error.message));
        } else {
          pending.resolve(frame.result);
        }
      }
    } else if (frame.type === 'event') {
      this.emit(frame.event, frame.payload);
    }
  }

  private emit(event: string, payload: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch {
          // ignore handler errors
        }
      }
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10_000);
      this.connect();
    }, this.reconnectDelay);
  }
}

// Singleton instance
export const gateway = new GatewayClient();
