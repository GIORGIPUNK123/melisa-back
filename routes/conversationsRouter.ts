import { Router } from 'express';
import { getConversationMembersController } from '../controllers/conversationsController';
import { authMiddleware } from '../middlewares/authMiddleware';

export const conversationsRouter = Router();

conversationsRouter.get(
  '/members/:conversationId',
  authMiddleware,
  getConversationMembersController,
);
