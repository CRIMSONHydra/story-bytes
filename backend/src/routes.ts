import { Router } from 'express';
import { handleChat } from './controllers/chat';

const router = Router();

router.post('/chat', handleChat);

export default router;
