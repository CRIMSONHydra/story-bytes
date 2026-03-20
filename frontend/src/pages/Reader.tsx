import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ChatInterface from '../components/ChatInterface';
import ComicViewer from '../components/ComicViewer';

const API_BASE = 'http://localhost:5001';

interface Story {
  story_id: string;
  title: string;
  content_type: 'novel' | 'comic' | 'manga';
}

interface Chapter {
  chapter_id: string;
  title: string;
  chapter_order: number;
  blocks: Block[];
}

interface Block {
  block_id: string;
  block_type: 'text' | 'image';
  text_content?: string;
  image_src?: string;
}

export default function Reader() {
  const { storyId, chapterId } = useParams();
  const navigate = useNavigate();
  const [story, setStory] = useState<Story | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [chapterList, setChapterList] = useState<{ chapter_id: string; chapter_order: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch story metadata
  useEffect(() => {
    if (!storyId) return;
    fetch(`${API_BASE}/api/stories/${storyId}`)
      .then(res => res.json())
      .then(setStory)
      .catch(err => console.error('Failed to load story:', err));
  }, [storyId]);

  // Fetch chapter content
  useEffect(() => {
    if (!storyId || !chapterId) return;

    fetch(`${API_BASE}/api/stories/${storyId}/chapters`)
      .then(res => res.json())
      .then((chapters: { chapter_id: string; chapter_order: number }[]) => {
        setChapterList(chapters);
        const targetOrder = parseInt(chapterId, 10);
        const targetChapter = chapters.find(c => c.chapter_order === targetOrder);

        if (targetChapter) {
          return fetch(`${API_BASE}/api/chapters/${targetChapter.chapter_id}`);
        }
        throw new Error('Chapter not found');
      })
      .then(res => res.json())
      .then(data => {
        setChapter(data);
        setLoading(false);
        // Track reading progress
        fetch(`${API_BASE}/api/stories/${storyId}/progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterOrder: data.chapter_order }),
        }).catch(() => { /* best effort */ });
      })
      .catch(err => {
        console.error('Failed to load chapter:', err);
        setLoading(false);
      });
  }, [storyId, chapterId]);

  const currentIdx = chapterList.findIndex(c => c.chapter_order === chapter?.chapter_order);
  const prevChapter = currentIdx > 0 ? chapterList[currentIdx - 1] : null;
  const nextChapter = currentIdx < chapterList.length - 1 ? chapterList[currentIdx + 1] : null;

  const handleNextChapter = useCallback(() => {
    if (nextChapter) {
      navigate(`/story/${storyId}/chapter/${nextChapter.chapter_order}`);
    }
  }, [nextChapter, storyId, navigate]);

  const handlePrevChapter = useCallback(() => {
    if (prevChapter) {
      navigate(`/story/${storyId}/chapter/${prevChapter.chapter_order}`);
    }
  }, [prevChapter, storyId, navigate]);

  // Keyboard navigation for prose mode (comic mode handles its own keys)
  useEffect(() => {
    if (story?.content_type !== 'novel') return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') handleNextChapter();
      else if (e.key === 'ArrowLeft') handlePrevChapter();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [story?.content_type, handleNextChapter, handlePrevChapter]);

  if (loading) return <div className="loading">Loading chapter...</div>;
  if (!chapter) return <div className="error">Chapter not found</div>;

  const isComicMode = story?.content_type === 'comic' || story?.content_type === 'manga';

  return (
    <div className="reader-container">
      <div className="reader-content">
        <header className="chapter-header">
          <button onClick={handlePrevChapter} disabled={!prevChapter}>&larr; Prev</button>
          <h2>{chapter.title}</h2>
          <button onClick={handleNextChapter} disabled={!nextChapter}>Next &rarr;</button>
        </header>

        {isComicMode ? (
          <ComicViewer blocks={chapter.blocks} />
        ) : (
          <div className="chapter-text">
            {chapter.blocks.map(block => (
              <div key={block.block_id} id={`block-${block.block_id}`} className={`block ${block.block_type}`}>
                {block.block_type === 'text' ? (
                  block.text_content?.split(/\n\n+/).map((para, i) =>
                    /^\s*\*{3,}\s*$/.test(para)
                      ? <hr key={i} className="scene-break" />
                      : <p key={i}>{para}</p>
                  )
                ) : block.image_src ? (
                  <img
                    src={`${API_BASE}/api/stories/${storyId}/image?path=${encodeURIComponent(block.image_src)}`}
                    alt="Chapter illustration"
                    className="chapter-image"
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="reader-sidebar">
        <ChatInterface
          storyId={storyId!}
          currentChapter={chapter.chapter_order}
          totalChapters={chapterList.length}
        />
      </div>
    </div>
  );
}
