import { Router } from 'express';
import { supabase } from '..';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

const PUBLIC_USER_COLUMNS =
  'id, username, nickname, avatar_url, status, created_at, updated_at, public_key, last_seen_at, appear_offline';

const PRIVATE_USER_COLUMNS = `${PUBLIC_USER_COLUMNS}, email, encrypted_private_key, iv, salt`;

router.get(`/:id`, authMiddleware, async (req, res) => {
  const id = req.params.id;
  const requesterId = (req as any).user?.id as string | undefined;

  try {
    const isSelf = Boolean(requesterId && requesterId === id);
    const { data, error } = await supabase
      .from('users')
      .select(isSelf ? PRIVATE_USER_COLUMNS : PUBLIC_USER_COLUMNS)
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ result: data });
  } catch (error: any) {
    console.error('userInfoRoute error:', error);
    res.status(400).json({ error: error?.message || 'Failed to fetch user' });
  }
});

export { router as userInfoRoute };
