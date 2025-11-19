import { Request, Response } from 'express';
import { getAllStories, getStoryById } from '../services/db';

export const handleGetStories = async (_req: Request, res: Response) => {
  try {
    const stories = await getAllStories();
    res.json(stories);
  } catch (error) {
    console.error('Error fetching stories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const handleGetStory = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const story = await getStoryById(id);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }
    res.json(story);
  } catch (error) {
    console.error('Error fetching story:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
