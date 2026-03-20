import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ChatInterface from '../components/ChatInterface';

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
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch chapter content
  useEffect(() => {
    // Note: In a real app, we'd first get the chapter ID from the order if needed, 
    // but for now we assume the URL param is the chapter ORDER or ID. 
    // The backend API expects ID. But our URL structure /chapter/:chapterId might be ambiguous.
    // Let's assume for this prototype we fetch chapters list first to find the ID for order X, 
    // OR we update the backend to support fetching by order.
    // For simplicity, let's fetch all chapters for the story and find the one matching the order.
    
    if (!storyId || !chapterId) return;

    fetch(`http://localhost:5001/api/stories/${storyId}/chapters`)
      .then(res => res.json())
      .then((chapters: { chapter_id: string; chapter_order: number }[]) => {
        const targetOrder = parseInt(chapterId, 10);
        const targetChapter = chapters.find(c => c.chapter_order === targetOrder);
        
        if (targetChapter) {
          return fetch(`http://localhost:5001/api/chapters/${targetChapter.chapter_id}`);
        }
        throw new Error('Chapter not found');
      })
      .then(res => res.json())
      .then(data => {
        setChapter(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load chapter:', err);
        setLoading(false);
      });
  }, [storyId, chapterId]);

  const handleNextChapter = () => {
    if (chapter) {
      navigate(`/story/${storyId}/chapter/${chapter.chapter_order + 1}`);
    }
  };

  const handlePrevChapter = () => {
    if (chapter && chapter.chapter_order > 1) {
      navigate(`/story/${storyId}/chapter/${chapter.chapter_order - 1}`);
    }
  };

  if (loading) return <div className="loading">Loading chapter...</div>;
  if (!chapter) return <div className="error">Chapter not found</div>;

  return (
    <div className="reader-container">
      <div className="reader-content">
        <header className="chapter-header">
          <button onClick={handlePrevChapter} disabled={chapter.chapter_order <= 1}>&larr; Prev</button>
          <h2>Chapter {chapter.chapter_order}: {chapter.title}</h2>
          <button onClick={handleNextChapter}>Next &rarr;</button>
        </header>
        
        <div className="chapter-text">
          {chapter.blocks.map(block => (
            <div key={block.block_id} className={`block ${block.block_type}`}>
              {block.block_type === 'text' ? (
                <p>{block.text_content}</p>
              ) : (
                <img src={block.image_src} alt="Chapter illustration" />
              )}
            </div>
          ))}
        </div>
      </div>
      
      <div className="reader-sidebar">
        <ChatInterface 
          storyId={storyId!} 
          currentChapter={chapter.chapter_order} 
        />
      </div>
    </div>
  );
}
