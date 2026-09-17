import { Router } from 'express';
import {
  addFriendController,
  updateUserSettingsController,
  getPendingRequestsController,
  cancelFriendRequestController,
  acceptFriendRequestController,
  rejectFriendRequestController,
  removeFriendController,
  getUserProfileController,
  getCurrentUserController,
  getFriendsListController,
  getOrCreateConversationController,
  getConversationMembersController,
} from '../controllers/friendsController';
import { authMiddleware } from '../middlewares/authMiddleware';

export const friendsRouter = Router();

friendsRouter.get('/me', authMiddleware, getCurrentUserController);

friendsRouter.get('/list', authMiddleware, getFriendsListController);

friendsRouter.delete(
  '/with/:friendUserId',
  authMiddleware,
  removeFriendController,
);

friendsRouter.get(
  '/conversation/:friendUserId',
  authMiddleware,
  getOrCreateConversationController,
);

friendsRouter.get(
  '/conversation/:conversationId/members',
  authMiddleware,
  getConversationMembersController,
);

friendsRouter.post('/add', authMiddleware, addFriendController);

friendsRouter.get('/pending', authMiddleware, getPendingRequestsController);

friendsRouter.delete(
  '/request/:friendshipId',
  authMiddleware,
  cancelFriendRequestController,
);

friendsRouter.post(
  '/request/:friendshipId/accept',
  authMiddleware,
  acceptFriendRequestController,
);

friendsRouter.delete(
  '/request/:friendshipId/reject',
  authMiddleware,
  rejectFriendRequestController,
);

friendsRouter.get('/profile/:username', getUserProfileController);

friendsRouter.put('/settings', authMiddleware, updateUserSettingsController);
