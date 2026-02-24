declare module '@novnc/novnc/lib/rfb.js' {
  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: Record<string, unknown>);
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    qualityLevel: number;
    compressionLevel: number;
    disconnect(): void;
    sendCredentials(credentials: { password: string }): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    sendCtrlAltDel(): void;
    focus(): void;
    blur(): void;
    machineShutdown(): void;
    machineReboot(): void;
    machineReset(): void;
    clipboardPasteFrom(text: string): void;
    get capabilities(): { power: boolean };
    addEventListener(event: string, handler: (...args: unknown[]) => void): void;
    removeEventListener(event: string, handler: (...args: unknown[]) => void): void;
  }
}

declare module '@novnc/novnc/core/rfb.js' {
  export { default } from '@novnc/novnc/lib/rfb.js';
}

declare module '@novnc/novnc' {
  export { default as RFB } from '@novnc/novnc/lib/rfb.js';
}
