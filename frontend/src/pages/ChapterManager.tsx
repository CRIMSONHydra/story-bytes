/**
 * ChapterManager (M13): rename chapters, toggle front-matter, delete (with annotation-count confirm),
 * reorder (up/down), and paste-append a new chapter with a pre-flight cost estimate. Mutations hit
 * admin-gated endpoints; the reader reaches this from the Admin page.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  listChapters, updateChapter, deleteChapter, reorderChapters, appendChapter, estimateAppend,
  type AdminChapter, type AppendEstimate,
} from '../api/chapters';
import './ChapterManager.css';

export default function ChapterManager() {
  const { storyId } = useParams<{ storyId: string }>();
  const [chapters, setChapters] = useState<AdminChapter[]>([]);
  const [status, setStatus] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [estimate, setEstimate] = useState<AppendEstimate | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!storyId) return;
    listChapters(storyId).then((d) => setChapters(d.chapters)).catch(() => setStatus('Failed to load chapters'));
  }, [storyId]);

  useEffect(refresh, [refresh]);

  const rename = async (c: AdminChapter) => {
    const title = prompt('New title', c.title ?? '');
    if (title === null || title.trim() === (c.title ?? '')) return;
    await updateChapter(c.chapterId, { title: title.trim() }).catch(() => setStatus('Rename failed'));
    refresh();
  };

  const toggleFrontMatter = async (c: AdminChapter) => {
    await updateChapter(c.chapterId, { isFrontMatter: !c.isFrontMatter }).catch(() => setStatus('Update failed'));
    refresh();
  };

  const remove = async (c: AdminChapter) => {
    if (!confirm(`Delete "${c.title ?? 'Untitled'}"? Its blocks and embeddings are removed.`)) return;
    const res = await deleteChapter(c.chapterId).catch(() => null);
    if (res) setStatus(`Deleted (${res.annotationCount} annotation(s) were attached)`);
    refresh();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (!storyId || next < 0 || next >= chapters.length) return;
    const ids = chapters.map((c) => c.chapterId);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    await reorderChapters(storyId, ids).catch(() => setStatus('Reorder failed'));
    refresh();
  };

  const runEstimate = async () => {
    if (!storyId || !pasteText.trim()) return;
    setEstimate(await estimateAppend(storyId, pasteText).catch(() => null));
  };

  const submitAppend = async () => {
    if (!storyId || !pasteTitle.trim() || !pasteText.trim()) return;
    setBusy(true);
    try {
      const res = await appendChapter(storyId, { title: pasteTitle.trim(), text: pasteText });
      setStatus(`Appended chapter ${res.order} (${res.blocks} block(s) embedded)`);
      setPasteTitle(''); setPasteText(''); setEstimate(null);
      refresh();
    } catch {
      setStatus('Append failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chapter-manager">
      <p><Link to="/admin">&larr; Admin</Link></p>
      <h2>Manage chapters</h2>
      {status && <p className="cm-status" role="status">{status}</p>}

      <ul className="cm-list">
        {chapters.map((c, i) => (
          <li key={c.chapterId} className={`cm-row${c.isFrontMatter ? ' cm-front' : ''}`}>
            <span className="cm-order">{c.order}</span>
            <span className="cm-title">{c.title ?? 'Untitled'}</span>
            <span className="cm-blocks">{c.blockCount} blocks</span>
            <span className="cm-actions">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === chapters.length - 1} aria-label="Move down">↓</button>
              <button type="button" onClick={() => rename(c)}>Rename</button>
              <button type="button" onClick={() => toggleFrontMatter(c)}>
                {c.isFrontMatter ? 'Unmark front-matter' : 'Mark front-matter'}
              </button>
              <button type="button" className="cm-del" onClick={() => remove(c)}>Delete</button>
            </span>
          </li>
        ))}
      </ul>

      <div className="cm-append">
        <h3>Append a chapter (paste)</h3>
        <input aria-label="New chapter title" placeholder="Chapter title" value={pasteTitle}
               onChange={(e) => setPasteTitle(e.target.value)} />
        <textarea aria-label="New chapter text" placeholder="Paste chapter text…" rows={8} value={pasteText}
                  onChange={(e) => { setPasteText(e.target.value); setEstimate(null); }} />
        <div className="cm-append-actions">
          <button type="button" onClick={runEstimate} disabled={!pasteText.trim()}>Estimate cost</button>
          <button type="button" onClick={submitAppend} disabled={busy || !pasteTitle.trim() || !pasteText.trim()}>
            {busy ? 'Appending…' : 'Append + embed'}
          </button>
          {estimate && (
            <span className="cm-estimate">
              ~{estimate.chunks} block(s), {estimate.estimatedTokens.toLocaleString()} tokens, ${estimate.estimatedCostUsd.toFixed(4)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
