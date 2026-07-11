/**
 * TheorySubmit (M19): paste a fan theory for a story; it's classified server-side so only
 * spoiler-safe chunks (≤ the reader's chapter) are ever retrievable in theory-mode chat. Submits
 * async (202 + submissionId) and polls until the classify job settles.
 */

import { useEffect, useRef, useState } from 'react';
import { submitTheory, getSubmission, isTerminal } from '../api/theories';
import './TheorySubmit.css';

interface Props {
  storyId: string;
}

export function TheorySubmit({ storyId }: Props) {
  const [text, setText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const poll = (submissionId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const s = await getSubmission(submissionId);
        if (isTerminal(s.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setBusy(false);
          setStatus(s.status === 'completed'
            ? `Done — ${s.chunksKept ?? 0} spoiler-safe snippet(s) added.`
            : `Failed: ${s.error ?? 'unknown error'}`);
          if (s.status === 'completed') setText('');
        } else if (attempts > 90) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setBusy(false);
          setStatus('Still processing — check back later.');
        }
      } catch { /* transient — keep polling */ }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), 2000);
  };

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setStatus('Classifying…');
    try {
      const res = await submitTheory(storyId, text, sourceUrl.trim() || undefined);
      poll(res.submissionId);
    } catch (err) {
      setBusy(false);
      setStatus(`Submission failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="theory-submit">
      <h4>Share a fan theory</h4>
      <p className="theory-hint">
        Paste a theory or discussion. It's classified so only parts about chapters you've read can ever
        surface — future spoilers are dropped.
      </p>
      <textarea aria-label="Fan theory text" rows={5} placeholder="Paste theory text…" value={text}
                onChange={(e) => setText(e.target.value)} />
      <input aria-label="Source URL (optional)" placeholder="Source URL (optional)" value={sourceUrl}
             onChange={(e) => setSourceUrl(e.target.value)} />
      <div className="theory-actions">
        <button type="button" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? 'Classifying…' : 'Submit theory'}
        </button>
        {status && <span className="theory-status" role="status">{status}</span>}
      </div>
    </div>
  );
}
