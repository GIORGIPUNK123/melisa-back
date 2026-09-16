import { Router } from 'express';
import { supabase } from '..';
import { userExists } from '../functions/getUserInfo';
import {
  emailOtpController,
  registerController,
  loginController,
  checkUsernameController,
} from '../controllers/authController';
import {
  emailOtpSchema,
  loginSchema,
  registerSchema,
} from '../schemas/userSchema';
import { validation } from '../middlewares/validationMiddleware';
const router = Router();
router.post('/otp', validation(emailOtpSchema), emailOtpController);

router.get('/check-username', checkUsernameController);
router.post('/login', validation(loginSchema), loginController);
router.post('/register', validation(registerSchema), registerController);

export const authRouter = router;
