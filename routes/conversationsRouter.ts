import { Router } from 'express';
import { getConversationMembersController } from '../controllers/conversationsController';
import { createGroupController } from '../controllers/groupsController';
import { authMiddleware } from '../middlewares/authMiddleware';

export const conversationsRouter = Router();

conversationsRouter.post('/group', authMiddleware, createGroupController);

conversationsRouter.get(
  '/members/:conversationId',
  authMiddleware,
  getConversationMembersController,
);
