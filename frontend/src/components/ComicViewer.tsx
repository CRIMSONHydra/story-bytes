import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';

interface Block {
  block_id: string;
  block_type: 'text' | 'image';
  text_content?: string;
  image_src?: string;
}

interface ComicViewerProps {
  blocks: Block[];
  storyId: string;
  onPageChange?: (pageIndex: number) => void;
}

export default function ComicViewer({ blocks, storyId, onPageChange }: ComicViewerProps) {
  const imageBlocks = blocks.filter(b => b.block_type === 'image' && b.image_src);
  const [currentPage, setCurrentPage] = useState(0);
  const [fitMode, setFitMode] = useState<'width' | 'height'>('width');

  const goToPage = useCallback((page: number) => {
    const clamped = Math.max(0, Math.min(page, imageBlocks.length - 1));
    setCurrentPage(clamped);
    onPageChange?.(clamped);
  }, [imageBlocks.length, onPageChange]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goToPage(currentPage + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goToPage(currentPage - 1);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentPage, goToPage]);

  if (imageBlocks.length === 0) {
    return <div className="comic-viewer-empty">No images in this chapter.</div>;
  }

  const current = imageBlocks[currentPage];

  return (
    <div className="comic-viewer">
      <div className="comic-toolbar">
        <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 0}>
          &larr; Prev
        </button>
        <span className="comic-page-info">
          Page {currentPage + 1} / {imageBlocks.length}
        </span>
        <button onClick={() => setFitMode(fitMode === 'width' ? 'height' : 'width')}>
          Fit {fitMode === 'width' ? 'Height' : 'Width'}
        </button>
        <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= imageBlocks.length - 1}>
          Next &rarr;
        </button>
      </div>
      <div className="comic-page-container" onClick={() => goToPage(currentPage + 1)}>
        <img
          src={`${API_BASE}/api/stories/${storyId}/image?path=${encodeURIComponent(current.image_src || '')}`}
          alt={`Page ${currentPage + 1}`}
          className={`comic-page comic-fit-${fitMode}`}
        />
      </div>
    </div>
  );
}
