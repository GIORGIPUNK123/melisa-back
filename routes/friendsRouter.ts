import { Router } from 'express';
import {
  addFriendController,
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
import {
  blockUserController,
  unblockUserController,
} from '../controllers/blocksController';
import { authMiddleware } from '../middlewares/authMiddleware';
// Legacy alias for clients that still call the old URL. Remove once no
// deployed frontend uses it. The canonical route is PUT /settings.
import { updateUserSettingsController } from '../controllers/settingsController';

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

friendsRouter.post('/block', authMiddleware, blockUserController);

friendsRouter.delete(
  '/block/:userId',
  authMiddleware,
  unblockUserController,
);

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

friendsRouter.get(
  '/profile/:username',
  authMiddleware,
  getUserProfileController,
);

// Deprecated: kept only for backwards compatibility. New clients use PUT /settings.
friendsRouter.put('/settings', authMiddleware, updateUserSettingsController);
