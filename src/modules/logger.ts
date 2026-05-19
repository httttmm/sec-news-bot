import type { RunSummary } from '../types/index.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  summary(summary: RunSummary): void;
}

export interface LoggerOptions {
  /** デバッグログを出力するかどうか */
  debug?: boolean;
}

/**
 * シンプルな構造化ロガー。
 * 1 行に JSON で `{ ts, level, msg, ... }` を出力する。
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const debugEnabled = options.debug ?? false;

  function emit(level: Level, message: string, meta?: Record<string, unknown>): void {
    if (level === 'debug' && !debugEnabled) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...meta,
    };
    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
    summary(summary: RunSummary) {
      emit('info', 'run_summary', { summary });
    },
  };
}
