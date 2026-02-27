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
    private url: string = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`,
    private token: string = '',
  ) {}

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    // Close existing connection to prevent duplicates (React StrictMode calls this twice)
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    // If no token yet, try to auto-fetch from localhost /auth/token endpoint
    if (!this.token) {
      fetch('/auth/token')
        .then(r => r.ok ? r.json() : null)
        .then((data: { token?: string } | null) => {
          if (data?.token) {
            this.token = data.token;
            localStorage.setItem('jarvis_gateway_token', data.token);
          }
          this.openWebSocket();
        })
        .catch(() => {
          // Fallback: connect without token (will fail on hardened gateway)
          this.openWebSocket();
        });
      return;
    }

    this.openWebSocket();
  }

  private openWebSocket(): void {
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
      // Reject all pending requests immediately instead of letting them hang 30s
      const disconnectError = new Error('WebSocket disconnected');
      for (const cb of this.pending.values()) {
        cb.reject(disconnectError);
      }
      this.pending.clear();
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

  /** Unsubscribe from an event */
  off(event: string, handler: EventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
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

// Resolve auth token: URL param > localStorage > env var > empty (will fail on hardened gateway)
function resolveToken(): string {
  try {
    // 1. Check URL query param (?token=xxx)
    const url = new URL(window.location.href);
    const urlToken = url.searchParams.get('token');
    if (urlToken) {
      // Store for reconnections and remove from URL bar
      localStorage.setItem('jarvis_gateway_token', urlToken);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
      return urlToken;
    }

    // 2. Check localStorage
    const storedToken = localStorage.getItem('jarvis_gateway_token');
    if (storedToken) return storedToken;

    // 3. Check Vite env var (build-time injection)
    if (typeof import.meta !== 'undefined' && (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_GATEWAY_TOKEN) {
      return (import.meta as unknown as Record<string, Record<string, string>>).env.VITE_GATEWAY_TOKEN;
    }
  } catch {
    // Ignore errors in token resolution
  }
  return '';
}

// Singleton instance with auto-resolved token
export const gateway = new GatewayClient(undefined, resolveToken());

/** Update the auth token (e.g., from a login prompt) and reconnect */
export function setGatewayToken(token: string): void {
  localStorage.setItem('jarvis_gateway_token', token);
  gateway.disconnect();
  // Re-create connection with new token
  (gateway as unknown as { token: string }).token = token;
  gateway.connect();
}

/** Authenticated fetch wrapper — adds Bearer token to requests to /api/* */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('jarvis_gateway_token') || '';
  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
