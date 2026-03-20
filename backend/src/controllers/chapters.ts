import { Request, Response } from 'express';
import { getChaptersByStoryId, getChapterById } from '../services/db';

export const handleGetChapters = async (req: Request, res: Response) => {
  const storyId = req.params.storyId as string;
  try {
    const chapters = await getChaptersByStoryId(storyId);
    res.json(chapters);
  } catch (error) {
    console.error('Error fetching chapters:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const handleGetChapter = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const chapter = await getChapterById(id);
    if (!chapter) {
      res.status(404).json({ error: 'Chapter not found' });
      return;
    }
    res.json(chapter);
  } catch (error) {
    console.error('Error fetching chapter:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
