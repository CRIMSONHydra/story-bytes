/**
 * ComicViewer tests (M4 seed suite): empty state, page rendering, and prev/next paging with the
 * onPageChange callback. Exercises the RTL setup on real product code.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ComicViewer from './ComicViewer';

const imageBlocks = [
  { block_id: 'b1', block_type: 'image' as const, image_src: 'p1.jpg' },
  { block_id: 'b2', block_type: 'image' as const, image_src: 'p2.jpg' },
];

describe('ComicViewer', () => {
  it('renders an empty state when there are no image blocks', () => {
    render(<ComicViewer blocks={[{ block_id: 't', block_type: 'text', text_content: 'hi' }]} storyId="s1" />);
    expect(screen.getByText(/no images/i)).toBeInTheDocument();
  });

  it('shows the first page and total count', () => {
    render(<ComicViewer blocks={imageBlocks} storyId="s1" />);
    expect(screen.getByText('Page 1 / 2')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Page 1' })).toBeInTheDocument();
  });

  it('advances pages via Next and fires onPageChange', async () => {
    const onPageChange = vi.fn();
    render(<ComicViewer blocks={imageBlocks} storyId="s1" onPageChange={onPageChange} />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText('Page 2 / 2')).toBeInTheDocument();
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('disables Prev on the first page and Next on the last', async () => {
    render(<ComicViewer blocks={imageBlocks} storyId="s1" />);
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});
