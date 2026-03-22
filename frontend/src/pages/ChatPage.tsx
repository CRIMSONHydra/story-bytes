import { useEffect, useState } from 'react';
import ChatInterface from '../components/ChatInterface';

const API_BASE = 'http://localhost:5001';

interface Story {
  story_id: string;
  title: string;
}

interface Chapter {
  chapter_id: string;
  chapter_order: number;
  title: string;
}

export default function ChatPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState<string | undefined>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<number | undefined>();

  useEffect(() => {
    fetch(`${API_BASE}/api/stories`)
      .then(res => { if (!res.ok) throw new Error('Failed'); return res.json(); })
      .then((data: unknown) => { if (Array.isArray(data)) setStories(data as Story[]); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedStoryId) return;
    fetch(`${API_BASE}/api/stories/${selectedStoryId}/chapters`)
      .then(res => { if (!res.ok) throw new Error('Failed'); return res.json(); })
      .then((data: Chapter[]) => {
        setChapters(data);
        if (data.length > 0) setSelectedChapter(data[data.length - 1].chapter_order);
      })
      .catch(() => {});
  }, [selectedStoryId]);

  const handleStoryChange = (storyId: string | undefined) => {
    setSelectedStoryId(storyId);
    if (!storyId) {
      setChapters([]);
      setSelectedChapter(undefined);
    }
  };

  return (
    <div className="chat-page">
      <div className="chat-page-selectors">
        <select
          value={selectedStoryId || ''}
          onChange={e => handleStoryChange(e.target.value || undefined)}
        >
          <option value="">General chat (no story)</option>
          {stories.map(s => (
            <option key={s.story_id} value={s.story_id}>{s.title}</option>
          ))}
        </select>
        {selectedStoryId && chapters.length > 0 && (
          <select
            value={selectedChapter ?? ''}
            onChange={e => setSelectedChapter(Number(e.target.value))}
          >
            {chapters.map(ch => (
              <option key={ch.chapter_order} value={ch.chapter_order}>
                {ch.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="chat-page-body">
        <ChatInterface
          storyId={selectedStoryId}
          currentChapter={selectedChapter}
          totalChapters={chapters.length}
        />
      </div>
    </div>
  );
}
