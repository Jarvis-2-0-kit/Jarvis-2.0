export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

const RESET = '\x1b[0m';

const SENSITIVE_KEY_RE = /key|token|password|secret|auth|credential/i;

/** Max recursion depth for redactSensitiveFields to prevent stack overflow */
const MAX_REDACT_DEPTH = 10;

/** Recursively redact values whose keys match sensitive patterns */
function redactSensitiveFields(data: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth >= MAX_REDACT_DEPTH) {
    return { __truncated: 'max redaction depth reached' };
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      result[k] = '***REDACTED***';
    } else if (Array.isArray(v)) {
      result[k] = v.map(item =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? redactSensitiveFields(item as Record<string, unknown>, depth + 1)
          : item,
      );
    } else if (v !== null && typeof v === 'object') {
      result[k] = redactSensitiveFields(v as Record<string, unknown>, depth + 1);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(subsystem: string): Logger;
}

const currentLevel = LOG_LEVEL_PRIORITY[(process.env['LOG_LEVEL']?.toLowerCase() ?? 'debug') as LogLevel] ?? 0;

export function createLogger(subsystem: string, minLevel: LogLevel = 'info'): Logger {
  const minPriority = LOG_LEVEL_PRIORITY[minLevel];

  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < currentLevel) return;
    if (LOG_LEVEL_PRIORITY[level] < minPriority) return;

    const timestamp = new Date().toISOString();
    const color = LOG_COLORS[level];
    const prefix = `${color}[${timestamp}] [${level.toUpperCase()}] [${subsystem}]${RESET}`;

    const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

    if (data && Object.keys(data).length > 0) {
      out(`${prefix} ${message}`, redactSensitiveFields(data));
    } else {
      out(`${prefix} ${message}`);
    }
  }

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
    child: (childSubsystem) => createLogger(`${subsystem}:${childSubsystem}`, minLevel),
  };
}
