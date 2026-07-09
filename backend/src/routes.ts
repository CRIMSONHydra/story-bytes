/**
 * API route definitions.
 * All routes are prefixed with '/api' when mounted in app.ts
 */

import { Router } from 'express';
import { handleChat } from './controllers/chat';
import { handleGetStories, handleGetStory } from './controllers/stories';
import { handleGetChapters, handleGetChapter } from './controllers/chapters';
import { handleSummarize } from './controllers/summary';
import { handleGetRecap } from './controllers/recap';
import { handleGetStoryGraph, handleSearchEntities, handleGetEntity, handleGetThreads } from './controllers/graph';
import { handleGetAssetImage, handleGetStoryImage } from './controllers/assets';
import { handleGetProgress, handleUpdateProgress } from './controllers/progress';
import { handleAdminGetStories, handleAdminDeleteStory, handleAdminIngest, handleGetSeries, handleGetTrace } from './controllers/admin';
import { upload } from './middleware/upload';
import { getSeriesChapters } from './services/db';

const router = Router();

// Stories
router.get('/stories', handleGetStories);
router.get('/stories/:id', handleGetStory);
router.get('/stories/:storyId/chapters', handleGetChapters);

// Chapters
router.get('/chapters/:id', handleGetChapter);

// Chat (RAG)
router.post('/chat', handleChat);

// Summarization (Phase 4)
router.post('/stories/:storyId/summarize', handleSummarize);

// Recap — catch-me-up composition with opt-in foreshadowing emphasis (Improvement Plan §2.12, §2.14)
router.get('/stories/:storyId/recap', handleGetRecap);

// Knowledge graph (M15) — upToChapter required on all; spoiler-gated
router.get('/stories/:storyId/graph', handleGetStoryGraph);
router.get('/stories/:storyId/entities', handleSearchEntities);
router.get('/entities/:entityId', handleGetEntity);
router.get('/stories/:storyId/threads', handleGetThreads);

// Assets (Phase 5)
router.get('/assets/:assetId/image', handleGetAssetImage);
router.get('/stories/:storyId/image', handleGetStoryImage);

// Series chapters (cross-volume spoiler selector)
router.get('/stories/:storyId/series-chapters', async (req, res) => {
  try {
    const data = await getSeriesChapters(req.params.storyId as string);
    res.json(data);
  } catch (error) {
    console.error('Series chapters error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reading Progress (Phase 5)
router.get('/stories/:storyId/progress', handleGetProgress);
router.put('/stories/:storyId/progress', handleUpdateProgress);

// Series
router.get('/series', handleGetSeries);

// Admin
router.get('/admin/stories', handleAdminGetStories);
router.delete('/admin/stories/:storyId', handleAdminDeleteStory);
router.post('/admin/ingest', upload.single('file'), handleAdminIngest);
router.get('/admin/traces/:traceId', handleGetTrace);

export default router;
