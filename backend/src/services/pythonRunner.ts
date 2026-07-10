/**
 * Python subprocess runner with the M3 JSONL stdout contract (Platform F6).
 *
 * Ingestion scripts emit newline-delimited JSON events on STDOUT (`progress` / `usage` / `result`)
 * and human logs on STDERR. This runner streams STDOUT line-by-line, parses each event, forwards
 * `progress` to an optional callback, and returns the terminal `result` event — so callers read
 * structured fields (e.g. `story_id`) instead of regex-scraping log text. STDERR is kept as a bounded
 * tail for diagnostics, and the whole run is bounded by a timeout.
 */

import { spawn } from 'child_process';
import { logger } from './logger';

export interface PyEvent {
  event: string;
  [key: string]: unknown;
}

export interface PyRunResult {
  /** The single terminal `result` event, or null if the script emitted none. */
  result: PyEvent | null;
  /** All parsed JSONL events, in order. */
  events: PyEvent[];
  /** Bounded tail of STDERR (human logs), for error reporting. */
  stderrTail: string;
}

export interface PyRunOptions {
  timeoutMs?: number;
  /** Called for each `progress` event as it streams in. */
  onProgress?: (event: PyEvent) => void;
  /** Command to run (default `uv run python`), split into argv. */
  command?: string[];
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const STDERR_TAIL_LIMIT = 16 * 1024; // keep the last 16 KB of stderr only

/**
 * Run a Python script and collect its JSONL events. Rejects on non-zero exit, spawn error, or
 * timeout — the rejection message carries the stderr tail so the caller can surface a useful error.
 */
export const runPythonJson = (
  cwd: string,
  scriptArgs: string[],
  options: PyRunOptions = {},
): Promise<PyRunResult> => {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onProgress,
    // Run under the locked ingestion project env (M3): `uv run --project ingestion python`.
    command = ['uv', 'run', '--project', 'ingestion', 'python'],
  } = options;
  const [cmd, ...cmdArgs] = command;

  return new Promise<PyRunResult>((resolve, reject) => {
    const proc = spawn(cmd, [...cmdArgs, ...scriptArgs], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    const events: PyEvent[] = [];
    let result: PyEvent | null = null;
    let stdoutBuffer = '';
    let stderrTail = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      reject(new Error(`Python process timed out after ${timeoutMs}ms: ${stderrTail.slice(-500)}`));
    }, timeoutMs);

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: PyEvent;
      try {
        parsed = JSON.parse(trimmed) as PyEvent;
      } catch {
        // Non-JSON on stdout (stray print) — log at debug and ignore; contract is JSONL only.
        logger.debug({ line: trimmed.slice(0, 200) }, 'Ignoring non-JSON line on python stdout');
        return;
      }
      events.push(parsed);
      if (parsed.event === 'result') result = parsed;
      else if (parsed.event === 'progress') onProgress?.(parsed);
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let nl = stdoutBuffer.indexOf('\n');
      while (nl !== -1) {
        handleLine(stdoutBuffer.slice(0, nl));
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
        nl = stdoutBuffer.indexOf('\n');
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer); // flush any tail without a trailing newline
      if (code === 0) {
        resolve({ result, events, stderrTail });
      } else {
        reject(new Error(`Python process exited ${code}: ${stderrTail.slice(-500)}`));
      }
    });
  });
};
