import { Router } from 'express';
import { getConversationMembersController } from '../controllers/conversationsController';
import {
  clearGroupMessagesController,
  createGroupController,
  deleteGroupController,
  inviteGroupMembersController,
  kickGroupMemberController,
  leaveGroupController,
  setGroupAdminController,
  updateGroupNameController,
  updateGroupPhotoController,
} from '../controllers/groupsController';
import { authMiddleware } from '../middlewares/authMiddleware';

export const conversationsRouter = Router();

conversationsRouter.post('/group', authMiddleware, createGroupController);
conversationsRouter.post(
  '/group/:conversationId/members',
  authMiddleware,
  inviteGroupMembersController,
);
conversationsRouter.delete(
  '/group/:conversationId/members/:userId',
  authMiddleware,
  kickGroupMemberController,
);
conversationsRouter.put(
  '/group/:conversationId/admins/:userId',
  authMiddleware,
  setGroupAdminController,
);
conversationsRouter.put(
  '/group/:conversationId/photo',
  authMiddleware,
  updateGroupPhotoController,
);
conversationsRouter.put(
  '/group/:conversationId/name',
  authMiddleware,
  updateGroupNameController,
);
conversationsRouter.post(
  '/group/:conversationId/leave',
  authMiddleware,
  leaveGroupController,
);
conversationsRouter.delete(
  '/group/:conversationId/messages',
  authMiddleware,
  clearGroupMessagesController,
);
conversationsRouter.delete(
  '/group/:conversationId',
  authMiddleware,
  deleteGroupController,
);

conversationsRouter.get(
  '/members/:conversationId',
  authMiddleware,
  getConversationMembersController,
);
