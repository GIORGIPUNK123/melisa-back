import { Response } from 'express';
import { supabase } from '..';
import {
  deleteRelationship,
  isUuid,
} from '../functions/blocks';

const resolveTargetUserId = async (body: {
  userId?: string;
  user_id?: string;
  username?: string;
}) => {
  const directId = body.userId || body.user_id;
  if (isUuid(directId)) return directId;

  const username = body.username?.trim();
  if (!username) return null;

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
};

export const blockUserController = async (req: any, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    const targetUserId = await resolveTargetUserId(req.body || {});

    if (!targetUserId) {
      return res.status(400).send({ error: 'User is required' });
    }

    if (targetUserId === userId) {
      return res.status(400).send({ error: 'Cannot block yourself' });
    }

    const { data: targetUser, error: targetError } = await supabase
      .from('users')
      .select('id')
      .eq('id', targetUserId)
      .maybeSingle();

    if (targetError) throw targetError;
    if (!targetUser) {
      return res.status(404).send({ error: 'User not found' });
    }

    const { error: insertError } = await supabase.from('blocks').insert({
      blocker_id: userId,
      blocked_user_id: targetUserId,
    });

    if (insertError && insertError.code !== '23505') {
      throw insertError;
    }

    await deleteRelationship(supabase, userId, targetUserId);

    res.status(200).send({ message: 'User blocked' });
  } catch (err: any) {
    console.error('Block user error:', err);
    res.status(500).send({ error: err.message || 'Failed to block user' });
  }
};

export const unblockUserController = async (req: any, res: Response) => {
  const userId = req.user?.id;
  const targetUserId = req.params.userId;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  if (!isUuid(targetUserId)) {
    return res.status(400).send({ error: 'User is required' });
  }

  try {
    const { error } = await supabase
      .from('blocks')
      .delete()
      .eq('blocker_id', userId)
      .eq('blocked_user_id', targetUserId);

    if (error) throw error;

    res.status(200).send({ message: 'User unblocked' });
  } catch (err: any) {
    console.error('Unblock user error:', err);
    res.status(500).send({ error: err.message || 'Failed to unblock user' });
  }
};
