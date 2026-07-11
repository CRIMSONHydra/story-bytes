/**
 * CastPage (M17): revealed characters at the reader's current chapter, each with a generated portrait
 * or a generate button. Boundary comes from the reader's saved progress, so no post-boundary
 * character (or appearance) is ever shown. Click a portrait to enlarge (lightbox).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiGet } from '../api/client';
import { listCast, generateEntityImage, generatedImageUrl, type CastMember } from '../api/cast';
import './CastPage.css';

export default function CastPage() {
  const { storyId } = useParams<{ storyId: string }>();
  const [boundary, setBoundary] = useState<number | null>(null);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the spoiler boundary from the reader's progress.
  useEffect(() => {
    if (!storyId) return;
    apiGet<{ lastChapterOrder: number }>(`/api/stories/${storyId}/progress`)
      .then((p) => setBoundary(p.lastChapterOrder ?? 0))
      .catch(() => setBoundary(0));
  }, [storyId]);

  const refresh = useCallback(() => {
    if (!storyId || boundary === null) return;
    listCast(storyId, boundary).then((d) => setCast(d.cast)).catch(() => setError('Failed to load cast'));
  }, [storyId, boundary]);

  useEffect(refresh, [refresh]);

  const generate = async (m: CastMember) => {
    if (!storyId || boundary === null) return;
    setBusy((b) => ({ ...b, [m.entityId]: 'Generating…' }));
    try {
      const res = await generateEntityImage(storyId, m.entityId, boundary);
      if (res.status === 'ready') refresh();
      else setBusy((b) => ({ ...b, [m.entityId]: res.reason ?? res.status }));
    } catch {
      setBusy((b) => ({ ...b, [m.entityId]: 'Failed' }));
    }
  };

  return (
    <div className="cast-page">
      <p><Link to="/">&larr; Home</Link></p>
      <h2>Cast {boundary !== null && <span className="cast-boundary">(as of chapter {boundary})</span>}</h2>
      {error && <p role="alert">{error}</p>}
      {cast.length === 0 && boundary !== null && <p>No characters revealed yet.</p>}

      <div className="cast-grid">
        {cast.map((m) => (
          <div key={m.entityId} className="cast-card">
            {m.hasImage && m.imageId ? (
              <img
                className="cast-portrait"
                src={generatedImageUrl(m.imageId)}
                alt={`Portrait of ${m.name}`}
                onClick={() => m.imageId && setLightbox(generatedImageUrl(m.imageId))}
              />
            ) : (
              <div className="cast-placeholder">
                <button type="button" onClick={() => generate(m)} disabled={busy[m.entityId] === 'Generating…'}>
                  {busy[m.entityId] ?? 'Generate portrait'}
                </button>
              </div>
            )}
            <span className="cast-name">{m.name}</span>
          </div>
        ))}
      </div>

      {lightbox && (
        <div className="cast-lightbox" role="dialog" aria-label="Enlarged portrait" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Enlarged portrait" />
        </div>
      )}
    </div>
  );
}
