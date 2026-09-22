import { Response } from 'express';
import { supabase } from '..';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getBlockedUserIds, isUuid } from '../functions/blocks';

const MAX_GROUP_MEMBERS = 50;
const KEY_TEXT = /^[A-Za-z0-9+/]+=*$/;

type EnvelopeInput = {
  userId?: unknown;
  nonce?: unknown;
  keyBox?: unknown;
};

const cleanName = (value: unknown) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);

const isKeyText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 500 &&
  KEY_TEXT.test(value);

const missingGroupTable = (error: { code?: string; message?: string } | null) => {
  if (!error) return false;
  const message = error.message || '';
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /conversation_key_envelopes/i.test(message)
  );
};

export const createGroupController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  const name = cleanName(req.body?.name);
  if (name.length < 1) {
    return res.status(400).send({ error: 'Group name is required' });
  }

  const rawMemberIds: unknown[] = Array.isArray(req.body?.memberIds)
    ? req.body.memberIds
    : [];
  const memberIds = [...new Set(rawMemberIds.map((id) => String(id)))].filter(
    (id) => isUuid(id),
  );

  if (!memberIds.includes(userId)) {
    memberIds.push(userId);
  }

  if (memberIds.length < 2) {
    return res.status(400).send({ error: 'Add at least one friend' });
  }

  if (memberIds.length > MAX_GROUP_MEMBERS) {
    return res
      .status(400)
      .send({ error: `Groups can have up to ${MAX_GROUP_MEMBERS} people` });
  }

  const rawEnvelopes: EnvelopeInput[] = Array.isArray(req.body?.envelopes)
    ? req.body.envelopes
    : [];
  const envelopes = new Map<
    string,
    { userId: string; nonce: string; keyBox: string }
  >();

  for (const envelope of rawEnvelopes) {
    const envelopeUserId = String(envelope?.userId || '');
    if (!isUuid(envelopeUserId) || !isKeyText(envelope?.nonce)) continue;
    if (!isKeyText(envelope?.keyBox) || envelope.keyBox.length > 500) continue;
    envelopes.set(envelopeUserId, {
      userId: envelopeUserId,
      nonce: envelope.nonce,
      keyBox: envelope.keyBox,
    });
  }

  const missingEnvelope = memberIds.some((id) => !envelopes.has(id));
  if (missingEnvelope || envelopes.size !== memberIds.length) {
    return res.status(400).send({ error: 'Group key is incomplete' });
  }

  let conversationId: number | string | null = null;

  const removeConversation = async (id: number | string) => {
    await supabase
      .from('conversation_key_envelopes')
      .delete()
      .eq('conversation_id', id);
    await supabase.from('conversation_members').delete().eq('conversation_id', id);
    await supabase.from('conversations').delete().eq('id', id);
  };

  try {
    const otherIds = memberIds.filter((id) => id !== userId);
    const blockedIds = await getBlockedUserIds(supabase, userId);
    if (otherIds.some((id) => blockedIds.has(id))) {
      return res.status(403).send({ error: 'Cannot add a blocked user' });
    }

    const { data: friendships, error: friendshipError } = await supabase
      .from('friendships')
      .select('user_id, receiver_id')
      .eq('status', 'accepted')
      .or(`user_id.eq.${userId},receiver_id.eq.${userId}`);

    if (friendshipError) throw friendshipError;

    const friendIds = new Set(
      (friendships || []).map((friendship) =>
        friendship.user_id === userId
          ? friendship.receiver_id
          : friendship.user_id,
      ),
    );

    if (otherIds.some((id) => !friendIds.has(id))) {
      return res
        .status(403)
        .send({ error: 'You can only add friends to a group' });
    }

    const { data: profiles, error: profileError } = await supabase
      .from('public_profiles')
      .select('id, public_key')
      .in('id', memberIds);

    if (profileError) throw profileError;

    const keyedIds = new Set(
      (profiles || [])
        .filter((profile) => profile.public_key)
        .map((profile) => profile.id),
    );
    if (memberIds.some((id) => !keyedIds.has(id))) {
      return res
        .status(400)
        .send({ error: 'Every member needs an encryption key' });
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .insert({ type: 'group', name, created_by: userId })
      .select('id, name')
      .single();

    if (conversationError) throw conversationError;
    conversationId = conversation.id;

    const { error: memberError } = await supabase
      .from('conversation_members')
      .insert(
        memberIds.map((id) => ({
          conversation_id: conversation.id,
          user_id: id,
        })),
      );

    if (memberError) throw memberError;

    const { error: envelopeError } = await supabase
      .from('conversation_key_envelopes')
      .insert(
        memberIds.map((id) => {
          const envelope = envelopes.get(id)!;
          return {
            conversation_id: conversation.id,
            user_id: id,
            wrapped_by: userId,
            nonce: envelope.nonce,
            key_box: envelope.keyBox,
          };
        }),
      );

    if (envelopeError) {
      if (missingGroupTable(envelopeError)) {
        await removeConversation(conversation.id);
        return res.status(503).send({
          error:
            'Group chats are not ready yet. Add the group key table in Supabase, then try again.',
        });
      }
      throw envelopeError;
    }

    res.status(201).send({
      conversationId: conversation.id,
      name: conversation.name,
    });
  } catch (err: any) {
    if (conversationId != null) {
      await removeConversation(conversationId);
    }
    console.error('Create group error:', err);
    res.status(500).send({ error: err.message || 'Failed to create group' });
  }
};
