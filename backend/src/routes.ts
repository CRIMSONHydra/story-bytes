/**
 * API route definitions.
 * All routes are prefixed with '/api' when mounted in app.ts
 */

import { Router } from 'express';
import { handleChat } from './controllers/chat';
import { handleGetStories, handleGetStory } from './controllers/stories';
import { handleGetChapters, handleGetChapter } from './controllers/chapters';

const router = Router();

// Stories
router.get('/stories', handleGetStories);
router.get('/stories/:id', handleGetStory);
router.get('/stories/:storyId/chapters', handleGetChapters);

// Chapters
router.get('/chapters/:id', handleGetChapter);

// Chat
router.post('/chat', handleChat);

export default router;
