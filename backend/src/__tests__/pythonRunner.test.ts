/**
 * pythonRunner tests (M3 JSONL contract). Uses Node itself as the subprocess (via `process.execPath`
 * + `-e`) rather than python3 — the runner's job is streaming/parsing/exit handling, and the backend
 * test job in CI runs before Python is installed, so depending on python3 here would be flaky.
 */

import { describe, expect, it } from 'vitest';
import { runPythonJson } from '../services/pythonRunner';

const node = process.execPath;

describe('runPythonJson', () => {
  it('parses JSONL events, forwards progress, and returns the terminal result', async () => {
    const emit = [
      '-e',
      `console.log(JSON.stringify({event:'progress',stage:'a'}));
       console.log(JSON.stringify({event:'progress',stage:'b'}));
       console.log(JSON.stringify({event:'result',status:'ok',story_id:'s1'}));
       console.error('a human log line');`,
    ];
    const progress: unknown[] = [];
    const res = await runPythonJson(process.cwd(), emit, { command: [node], onProgress: (e) => progress.push(e) });

    expect(res.result).toMatchObject({ event: 'result', story_id: 's1' });
    expect(res.events).toHaveLength(3);
    expect(progress).toHaveLength(2);
    expect(res.stderrTail).toContain('a human log line');
  });

  it('ignores non-JSON lines on stdout', async () => {
    const emit = [
      '-e',
      `console.log('not json at all');
       console.log(JSON.stringify({event:'result',status:'ok'}));`,
    ];
    const res = await runPythonJson(process.cwd(), emit, { command: [node] });
    expect(res.events).toHaveLength(1);
    expect(res.result).toMatchObject({ event: 'result' });
  });

  it('flushes a final line without a trailing newline', async () => {
    const emit = ['-e', `process.stdout.write(JSON.stringify({event:'result',status:'ok',n:1}))`];
    const res = await runPythonJson(process.cwd(), emit, { command: [node] });
    expect(res.result).toMatchObject({ event: 'result', n: 1 });
  });

  it('rejects on a non-zero exit, surfacing the stderr tail', async () => {
    const emit = ['-e', `process.stderr.write('boom happened'); process.exit(3);`];
    await expect(
      runPythonJson(process.cwd(), emit, { command: [node] }),
    ).rejects.toThrow(/exited 3.*boom happened/s);
  });

  it('rejects when the process exceeds the timeout', async () => {
    const emit = ['-e', `setTimeout(() => {}, 10000)`];
    await expect(
      runPythonJson(process.cwd(), emit, { command: [node], timeoutMs: 200 }),
    ).rejects.toThrow(/timed out/);
  });
});
