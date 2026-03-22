import { useEffect, useState } from 'react';

const API_BASE = 'http://localhost:5001';

interface AdminStory {
  story_id: string;
  title: string;
  authors: string[];
  content_type: string;
  series_title: string | null;
  created_at: string;
  chapter_count: number;
  block_count: number;
  embedding_count: number;
  asset_count: number;
}

export default function AdminPage() {
  const [stories, setStories] = useState<AdminStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const fetchStories = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/admin/stories`)
      .then(res => { if (!res.ok) throw new Error('Failed'); return res.json(); })
      .then((data: AdminStory[]) => { setStories(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(fetchStories, []);

  const handleDelete = async (storyId: string, title: string) => {
    if (!confirm(`Delete "${title}"? This removes all chapters, embeddings, and assets.`)) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/stories/${storyId}`, { method: 'DELETE' });
      if (res.ok) {
        setStories(prev => prev.filter(s => s.story_id !== storyId));
      }
    } catch {
      alert('Failed to delete story');
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || uploading) return;

    setUploading(true);
    setUploadStatus('Uploading and processing...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/api/admin/ingest`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setUploadStatus(`Ingestion complete! Story ID: ${data.storyId || 'unknown'}`);
        setFile(null);
        fetchStories();
      } else {
        setUploadStatus(`Error: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      setUploadStatus(`Upload failed: ${error}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="admin-page">
      <h2>Story Management</h2>

      <div className="admin-upload">
        <h3>Ingest New Story</h3>
        <form onSubmit={handleUpload} className="upload-form">
          <input
            type="file"
            accept=".epub,.cbz,.cbr"
            onChange={e => setFile(e.target.files?.[0] || null)}
            disabled={uploading}
          />
          <button type="submit" disabled={!file || uploading}>
            {uploading ? 'Processing...' : 'Upload & Ingest'}
          </button>
        </form>
        {uploadStatus && <p className="upload-status">{uploadStatus}</p>}
        <p className="upload-hint">
          Full pipeline: extract → embed → tag images → enrich with story context
        </p>
      </div>

      <div className="admin-stories">
        <h3>Stories ({stories.length})</h3>
        {loading ? (
          <p>Loading...</p>
        ) : stories.length === 0 ? (
          <p>No stories ingested yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Chapters</th>
                <th>Blocks</th>
                <th>Embeddings</th>
                <th>Assets</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {stories.map(story => (
                <tr key={story.story_id}>
                  <td className="story-title-cell">
                    <span>{story.title}</span>
                    {story.series_title && (
                      <span className="series-badge">{story.series_title}</span>
                    )}
                  </td>
                  <td><span className={`type-tag type-${story.content_type}`}>{story.content_type}</span></td>
                  <td>{story.chapter_count}</td>
                  <td>{story.block_count}</td>
                  <td>{story.embedding_count}</td>
                  <td>{story.asset_count}</td>
                  <td>
                    <button
                      className="delete-btn"
                      onClick={() => handleDelete(story.story_id, story.title)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
