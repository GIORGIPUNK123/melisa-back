import { Router } from 'express';
import { updateUserSettingsController } from '../controllers/settingsController';
import { authMiddleware } from '../middlewares/authMiddleware';

export const settingsRouter = Router();

settingsRouter.put('/', authMiddleware, updateUserSettingsController);
