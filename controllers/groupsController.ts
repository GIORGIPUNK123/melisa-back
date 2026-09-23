import { Response } from 'express';
import { supabase } from '..';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getBlockedUserIds, isUuid } from '../functions/blocks';
import {
  filePathFromMessage,
  removeConversationMedia,
  removeStoredPaths,
} from '../functions/chatMedia';

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

const columnMissing = (
  error: { code?: string; message?: string } | null,
  column: string,
) => {
  if (!error) return false;
  const message = error.message || '';
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    (message.toLowerCase().includes(column.toLowerCase()) &&
      /does not exist|schema cache/i.test(message))
  );
};

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

    const memberRows = memberIds.map((id) => ({
      conversation_id: conversation.id,
      user_id: id,
      role: id === userId ? 'admin' : 'member',
    }));

    let { error: memberError } = await supabase
      .from('conversation_members')
      .insert(memberRows);

    if (memberError && columnMissing(memberError, 'role')) {
      ({ error: memberError } = await supabase.from('conversation_members').insert(
        memberIds.map((id) => ({
          conversation_id: conversation.id,
          user_id: id,
        })),
      ));
    }

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

const ROLE_SETUP_ERROR =
  'Group roles are not ready yet. Run the group settings SQL in Supabase, then try again.';

type GroupRoleName = 'admin' | 'moderator' | 'member';

type GroupMember = {
  userId: string;
  role: GroupRoleName;
  canKick: boolean;
  canChangePhoto: boolean;
  canChangeName: boolean;
  canClearMessages: boolean;
};

type GroupRecord = {
  id: string | number;
  name: string;
  createdBy: string;
  avatarUrl: string | null;
  members: GroupMember[];
};

const parseEnvelopes = (value: unknown) => {
  const rawEnvelopes: EnvelopeInput[] = Array.isArray(value) ? value : [];
  const envelopes = new Map<
    string,
    { userId: string; nonce: string; keyBox: string }
  >();

  for (const envelope of rawEnvelopes) {
    const envelopeUserId = String(envelope?.userId || '');
    if (!isUuid(envelopeUserId) || !isKeyText(envelope?.nonce)) continue;
    if (!isKeyText(envelope?.keyBox)) continue;
    envelopes.set(envelopeUserId, {
      userId: envelopeUserId,
      nonce: envelope.nonce,
      keyBox: envelope.keyBox,
    });
  }

  return envelopes;
};

const memberFromRow = (
  row: {
    user_id: string;
    role?: string | null;
    can_kick?: boolean | null;
    can_change_photo?: boolean | null;
    can_change_name?: boolean | null;
    can_clear_messages?: boolean | null;
  },
  creatorId: string,
): GroupMember => {
  const role: GroupRoleName =
    row.user_id === creatorId || row.role === 'admin'
      ? 'admin'
      : row.role === 'moderator'
        ? 'moderator'
        : 'member';

  return {
    userId: row.user_id,
    role,
    canKick: role === 'admin' || row.can_kick === true,
    canChangePhoto: role === 'admin' || row.can_change_photo === true,
    canChangeName: role === 'admin' || row.can_change_name === true,
    canClearMessages: role === 'admin' || row.can_clear_messages === true,
  };
};

const loadGroup = async (
  conversationId: string,
): Promise<GroupRecord | null> => {
  let { data: conversation, error } = await supabase
    .from('conversations')
    .select('id, type, name, created_by, avatar_url')
    .eq('id', conversationId)
    .maybeSingle();

  if (error && columnMissing(error, 'avatar_url')) {
    const fallback = await supabase
      .from('conversations')
      .select('id, type, name, created_by')
      .eq('id', conversationId)
      .maybeSingle();
    conversation = fallback.data
      ? { ...fallback.data, avatar_url: null }
      : null;
    error = fallback.error;
  }

  if (error) throw error;
  if (!conversation || conversation.type !== 'group') return null;

  const group = conversation;

  const membersWithName = await supabase
    .from('conversation_members')
    .select(
      'user_id, role, can_kick, can_change_photo, can_change_name, can_clear_messages',
    )
    .eq('conversation_id', conversationId);

  const memberQuery =
    membersWithName.error && columnMissing(membersWithName.error, 'can_change_name')
      ? await supabase
          .from('conversation_members')
          .select('user_id, role, can_kick, can_change_photo, can_clear_messages')
          .eq('conversation_id', conversationId)
      : membersWithName;

  let memberRows: {
    user_id: string;
    role?: string | null;
    can_kick?: boolean | null;
    can_change_photo?: boolean | null;
    can_change_name?: boolean | null;
    can_clear_messages?: boolean | null;
  }[] = memberQuery.data || [];
  let memberError = memberQuery.error;

  if (memberError && columnMissing(memberError, 'can_kick')) {
    const fallback = await supabase
      .from('conversation_members')
      .select('user_id, role')
      .eq('conversation_id', conversationId);
    memberRows = fallback.data || [];
    memberError = fallback.error;
  }

  if (memberError && columnMissing(memberError, 'role')) {
    const fallback = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId);
    if (fallback.error) throw fallback.error;
    memberRows = (fallback.data || []).map((row) => ({
      user_id: row.user_id,
      role: row.user_id === group.created_by ? 'admin' : 'member',
    }));
    memberError = null;
  }

  if (memberError) throw memberError;

  return {
    id: group.id,
    name: group.name?.trim() || 'Group',
    createdBy: group.created_by,
    avatarUrl: group.avatar_url || null,
    members: memberRows.map((row) => memberFromRow(row, group.created_by)),
  };
};

const eraseGroup = async (group: GroupRecord) => {
  await supabase.from('message_reactions').delete().eq('conversation_id', group.id);
  await supabase.from('messages').delete().eq('conversation_id', group.id);
  await supabase
    .from('conversation_key_envelopes')
    .delete()
    .eq('conversation_id', group.id);

  const otherMemberIds = group.members
    .map((member) => member.userId)
    .filter((id) => id !== group.createdBy);

  if (otherMemberIds.length > 0) {
    const { error: othersError } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', group.id)
      .in('user_id', otherMemberIds);
    if (othersError) throw othersError;
  }

  const { error: ownerError } = await supabase
    .from('conversation_members')
    .delete()
    .eq('conversation_id', group.id)
    .eq('user_id', group.createdBy);
  if (ownerError) throw ownerError;

  const { error } = await supabase.from('conversations').delete().eq('id', group.id);
  if (error) throw error;

  await removeConversationMedia(group.id);
};

const cleanAvatarUrl = (value: unknown) => {
  if (value == null || String(value).trim() === '') return { url: null as string | null };
  const url = String(value).trim();
  if (url.length > 500) return { error: 'Link is too long' };
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return { error: 'Use an http or https image link' };
  }
  return { url };
};

const friendIdsOf = async (userId: string) => {
  const { data, error } = await supabase
    .from('friendships')
    .select('user_id, receiver_id')
    .eq('status', 'accepted')
    .or(`user_id.eq.${userId},receiver_id.eq.${userId}`);

  if (error) throw error;

  return new Set(
    (data || []).map((friendship) =>
      friendship.user_id === userId
        ? friendship.receiver_id
        : friendship.user_id,
    ),
  );
};

const notifyUsers = async (
  userIds: string[],
  notification: { type: string; title: string; message: string },
) => {
  const rows = [...new Set(userIds)].filter(Boolean).map((userId) => ({
    user_id: userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    is_read: false,
  }));

  if (rows.length === 0) return;

  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.error('Failed to write group notification:', error);
};

const profileName = async (userId: string) => {
  const { data } = await supabase
    .from('public_profiles')
    .select('nickname, username')
    .eq('id', userId)
    .maybeSingle();

  return data?.nickname || data?.username || 'Someone';
};

const isAdminMember = (group: GroupRecord, userId: string) =>
  group.createdBy === userId ||
  group.members.some(
    (member) => member.userId === userId && member.role === 'admin',
  );

export const inviteGroupMembersController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = req.user?.id;
  const conversationId = String(req.params.conversationId || '');
  if (!userId) return res.status(401).send({ error: 'Unauthorized' });

  const requestedIds = (
    Array.isArray(req.body?.memberIds)
      ? (req.body.memberIds as unknown[])
      : []
  ).map((id) => String(id));
  const inviteeIds = [...new Set(requestedIds)].filter(
    (id) => isUuid(id) && id !== userId,
  );

  if (inviteeIds.length === 0) {
    return res.status(400).send({ error: 'Choose at least one friend' });
  }

  const envelopes = parseEnvelopes(req.body?.envelopes);
  if (inviteeIds.some((id) => !envelopes.has(id))) {
    return res.status(400).send({ error: 'Group key is incomplete' });
  }

  try {
    const group = await loadGroup(conversationId);
    if (!group) return res.status(404).send({ error: 'Group not found' });

    const actor = group.members.find((member) => member.userId === userId);
    if (!actor) {
      return res.status(403).send({ error: 'You are not in this group' });
    }

    const currentIds = new Set(group.members.map((member) => member.userId));
    if (inviteeIds.some((id) => currentIds.has(id))) {
      return res.status(400).send({ error: 'That person is already in the group' });
    }

    if (group.members.length + inviteeIds.length > MAX_GROUP_MEMBERS) {
      return res
        .status(400)
        .send({ error: `Groups can have up to ${MAX_GROUP_MEMBERS} people` });
    }

    const blockedIds = await getBlockedUserIds(supabase, userId);
    if (inviteeIds.some((id) => blockedIds.has(id))) {
      return res.status(403).send({ error: 'Cannot add a blocked user' });
    }

    const friendIds = await friendIdsOf(userId);
    if (inviteeIds.some((id) => !friendIds.has(id))) {
      return res
        .status(403)
        .send({ error: 'You can only add your own friends' });
    }

    const { data: profiles, error: profileError } = await supabase
      .from('public_profiles')
      .select('id, public_key')
      .in('id', inviteeIds);

    if (profileError) throw profileError;
    const keyed = new Set(
      (profiles || [])
        .filter((profile) => profile.public_key)
        .map((profile) => profile.id),
    );
    if (inviteeIds.some((id) => !keyed.has(id))) {
      return res
        .status(400)
        .send({ error: 'Every member needs an encryption key' });
    }

    let { error: memberError } = await supabase
      .from('conversation_members')
      .insert(
        inviteeIds.map((id) => ({
          conversation_id: group.id,
          user_id: id,
          role: 'member',
        })),
      );

    if (memberError && columnMissing(memberError, 'role')) {
      const retry = await supabase.from('conversation_members').insert(
        inviteeIds.map((id) => ({
          conversation_id: group.id,
          user_id: id,
        })),
      );
      memberError = retry.error;
    }
    if (memberError) throw memberError;

    const { error: envelopeError } = await supabase
      .from('conversation_key_envelopes')
      .insert(
        inviteeIds.map((id) => {
          const envelope = envelopes.get(id)!;
          return {
            conversation_id: group.id,
            user_id: id,
            wrapped_by: userId,
            nonce: envelope.nonce,
            key_box: envelope.keyBox,
          };
        }),
      );

    if (envelopeError) {
      await supabase
        .from('conversation_members')
        .delete()
        .eq('conversation_id', group.id)
        .in('user_id', inviteeIds);
      throw envelopeError;
    }

    const inviter = await profileName(userId);
    await notifyUsers(inviteeIds, {
      type: 'group_added',
      title: 'Added to a group',
      message: `${inviter} added you to ${group.name}`,
    });

    res.status(200).send({ added: inviteeIds.length });
  } catch (err: any) {
    console.error('Invite group members error:', err);
    res.status(500).send({ error: err.message || 'Failed to add members' });
  }
};

export const kickGroupMemberController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = req.user?.id;
  const conversationId = String(req.params.conversationId || '');
  const targetId = String(req.params.userId || '');
  if (!userId) return res.status(401).send({ error: 'Unauthorized' });
  if (!isUuid(targetId)) {
    return res.status(400).send({ error: 'Member not found' });
  }

  try {
    const group = await loadGroup(conversationId);
    if (!group) return res.status(404).send({ error: 'Group not found' });

    const actor = group.members.find((member) => member.userId === userId);
    if (!actor?.canKick) {
      return res.status(403).send({ error: 'You cannot remove people from this group' });
    }
    if (targetId === userId) {
      return res.status(400).send({ error: 'Leave the group instead of removing yourself' });
    }
    if (targetId === group.createdBy) {
      return res.status(403).send({ error: 'The group creator cannot be removed' });
    }

    const target = group.members.find((member) => member.userId === targetId);
    if (!target) return res.status(404).send({ error: 'Member not found' });

    const actorIsAdmin = isAdminMember(group, userId);
    if (target.role !== 'member' && !actorIsAdmin) {
      return res.status(403).send({ error: 'Moderators can only remove members' });
    }

    const { error } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', group.id)
      .eq('user_id', targetId);

    if (error) throw error;

    await notifyUsers([targetId], {
      type: 'group_removed',
      title: 'Removed from group',
      message: `You were removed from ${group.name}`,
    });

    res.status(200).send({ removed: targetId });
  } catch (err: any) {
    console.error('Kick group member error:', err);
    res.status(500).send({ error: err.message || 'Failed to remove member' });
  }
};

export const setGroupAdminController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = req.user?.id;
  const conversationId = String(req.params.conversationId || '');
  const targetId = String(req.params.userId || '');
  const requestedRole = req.body?.role;
  const role: GroupRoleName =
    requestedRole === 'admin' ||
    requestedRole === 'moderator' ||
    requestedRole === 'member'
      ? requestedRole
      : req.body?.admin === true
        ? 'admin'
        : 'member';
  if (!userId) return res.status(401).send({ error: 'Unauthorized' });
  if (!isUuid(targetId)) {
    return res.status(400).send({ error: 'Member not found' });
  }

  try {
    const group = await loadGroup(conversationId);
    if (!group) return res.status(404).send({ error: 'Group not found' });
    if (!isAdminMember(group, userId)) {
      return res.status(403).send({ error: 'Only an admin can change roles' });
    }
    if (targetId === group.createdBy) {
      return res.status(400).send({ error: 'The group creator stays an admin' });
    }

    const target = group.members.find((member) => member.userId === targetId);
    if (!target) return res.status(404).send({ error: 'Member not found' });

    const wantsNameChange =
      role === 'moderator' && req.body?.canChangeName === true;
    const permissions =
      role === 'moderator'
        ? {
            can_kick: req.body?.canKick === true,
            can_change_photo: req.body?.canChangePhoto === true,
            can_change_name: wantsNameChange,
            can_clear_messages: req.body?.canClearMessages === true,
          }
        : {
            can_kick: false,
            can_change_photo: false,
            can_change_name: false,
            can_clear_messages: false,
          };

    let { error } = await supabase
      .from('conversation_members')
      .update({ role, ...permissions })
      .eq('conversation_id', group.id)
      .eq('user_id', targetId);

    if (error && columnMissing(error, 'can_change_name')) {
      if (wantsNameChange) {
        return res.status(503).send({
          error:
            'Renaming is not ready yet. Add can_change_name in Supabase, then try again.',
        });
      }
      const { can_change_name: _ignored, ...withoutName } = permissions;
      ({ error } = await supabase
        .from('conversation_members')
        .update({ role, ...withoutName })
        .eq('conversation_id', group.id)
        .eq('user_id', targetId));
    }

    if (error && columnMissing(error, 'can_kick') && role !== 'moderator') {
      ({ error } = await supabase
        .from('conversation_members')
        .update({ role })
        .eq('conversation_id', group.id)
        .eq('user_id', targetId));
    }

    if (
      error &&
      (columnMissing(error, 'role') ||
        columnMissing(error, 'can_kick') ||
        /role_check|check constraint/i.test(error.message || ''))
    ) {
      return res.status(503).send({ error: ROLE_SETUP_ERROR });
    }
    if (error) throw error;

    res.status(200).send({ userId: targetId, role, ...permissions });
  } catch (err: any) {
    console.error('Set group admin error:', err);
    res.status(500).send({ error: err.message || 'Failed to update admin' });
  }
};

export const clearGroupMessagesController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = req.user?.id;
  const conversationId = String(req.params.conversationId || '');
  if (!userId) return res.status(401).send({ error: 'Unauthorized' });

  try {
    const group = await loadGroup(conversationId);
    if (!group) return res.status(404).send({ error: 'Group not found' });
    const actor = group.members.find((member) => member.userId === userId);
    if (!actor?.canClearMessages) {
      return res.status(403).send({ error: 'You cannot clear messages in this group' });
    }

    const clearedAt = new Date().toISOString();
    const { error: stampError } = await supabase
      .from('conversations')
      .update({ history_cleared_at: clearedAt })
      .eq('id', group.id);

    if (stampError && columnMissing(stampError, 'history_cleared_at')) {
      return res.status(503).send({
        error:
          'Clearing messages is not ready yet. Add history_cleared_at in Supabase, then try again.',
      });
    }
    if (stampError) throw stampError;

    const { error: reactionError } = await supabase
      .from('message_reactions')
      .delete()
      .eq('conversation_id', group.id)
      .lte('created_at', clearedAt);
    if (reactionError) throw reactionError;

    const { data: doomed, error: doomedError } = await supabase
      .from('messages')
      .select('content')
      .eq('conversation_id', group.id)
      .lte('created_at', clearedAt);
    if (doomedError) throw doomedError;

    const mediaPaths = (doomed || [])
      .map((row) => filePathFromMessage(row.content || ''))
      .filter((path): path is string =>
        Boolean(path?.startsWith(`${group.id}/`)),
      );

    const { error: messageError } = await supabase
      .from('messages')
      .delete()
      .eq('conversation_id', group.id)
      .lte('created_at', clearedAt);
    if (messageError) throw messageError;

    await removeStoredPaths(mediaPaths);

    res.status(200).send({ clearedAt });
  } catch (err: any) {
    console.error('Clear group messages error:', err);
    res.status(500).send({ error: err.message || 'Failed to clear messages' });
  }
};

export const deleteGroupController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = req.user?.id;
  const conversationId = String(req.params.conversationId || '');
  if (!userId) return res.status(401).send({ error: 'Unauthorized' });

  try {
    const group = await loadGroup(conversationId);
    if (!group) return res.status(404).send({ error: 'Group not found' });
    if (!isAdminMember(group, userId)) {
      return res.status(403).send({ error: 'Only an admin can delete the group' });
    }

    const memberIds = group.members.map((member) => member.userId);
    const groupName = group.name;
    await eraseGroup(group);

    await notifyUsers(
      memberIds.filter((id) => id !== userId),
      {
        type: 'group_deleted',
        title: 'Group deleted',
        message: `${groupName} was deleted`,
      },
    );

    res.status(200).send({ deleted: true });
  } catch (err: any) {
    console.error('Delete group error:', err);
    res.status(500).send({ error: err.message || 'Failed to delete group' });
  }
};

export const updateGroupPhotoController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = req.user?.id;
  const conversationId = String(req.params.conversationId || '');
  if (!userId) return res.status(401).send({ error: 'Unauthorized' });

  const cleaned = cleanAvatarUrl(req.body?.avatarUrl);
  if ('error' in cleaned && cleaned.error) {
    return res.status(400).send({ error: cleaned.error });
  }

  try {
    const group = await loadGroup(conversationId);
    if (!group) return res.status(404).send({ error: 'Group not found' });
    const actor = group.members.find((member) => member.userId === userId);
    if (!actor?.canChangePhoto) {
      return res.status(403).send({ error: 'You cannot change the group photo' });
    }

    const { error } = await supabase
      .from('conversations')
      .update({ avatar_url: cleaned.url })
      .eq('id', group.id);

    if (error && columnMissing(error, 'avatar_url')) {
      return res.status(503).send({
        error: 'Group photos are not ready yet. Add avatar_url in Supabase, then try again.',
      });
    }
    if (error) throw error;

    res.status(200).send({ avatarUrl: cleaned.url });
  } catch (err: any) {
    console.error('Update group photo error:', err);
    res.status(500).send({ error: err.message || 'Failed to update the group photo' });
  }
};

export const updateGroupNameController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = req.user?.id;
  const conversationId = String(req.params.conversationId || '');
  if (!userId) return res.status(401).send({ error: 'Unauthorized' });

  const name = cleanName(req.body?.name);
  if (name.length < 1) {
    return res.status(400).send({ error: 'Group name is required' });
  }

  try {
    const group = await loadGroup(conversationId);
    if (!group) return res.status(404).send({ error: 'Group not found' });
    const actor = group.members.find((member) => member.userId === userId);
    if (!actor?.canChangeName) {
      return res.status(403).send({ error: 'You cannot rename this group' });
    }

    const { error } = await supabase
      .from('conversations')
      .update({ name })
      .eq('id', group.id)
      .eq('type', 'group');

    if (error) throw error;

    res.status(200).send({ name });
  } catch (err: any) {
    console.error('Update group name error:', err);
    res.status(500).send({ error: err.message || 'Failed to rename the group' });
  }
};

export const leaveGroupController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = req.user?.id;
  const conversationId = String(req.params.conversationId || '');
  if (!userId) return res.status(401).send({ error: 'Unauthorized' });

  try {
    const group = await loadGroup(conversationId);
    if (!group) return res.status(404).send({ error: 'Group not found' });

    const actor = group.members.find((member) => member.userId === userId);
    if (!actor) {
      return res.status(403).send({ error: 'You are not in this group' });
    }

    const others = group.members.filter((member) => member.userId !== userId);
    if (others.length === 0) {
      await eraseGroup(group);
      return res.status(200).send({ deleted: true });
    }

    const mustAppoint = isAdminMember(group, userId);

    let successorId = '';
    if (mustAppoint) {
      if (req.body?.random === true) {
        successorId = others[Math.floor(Math.random() * others.length)].userId;
      } else if (isUuid(req.body?.successorId)) {
        successorId = String(req.body.successorId);
      }

      if (!others.some((member) => member.userId === successorId)) {
        return res.status(409).send({
          error: 'Choose the next admin before leaving',
          needsSuccessor: true,
        });
      }

      let { error: promoteError } = await supabase
        .from('conversation_members')
        .update({
          role: 'admin',
          can_kick: false,
          can_change_photo: false,
          can_change_name: false,
          can_clear_messages: false,
        })
        .eq('conversation_id', group.id)
        .eq('user_id', successorId);

      if (promoteError && columnMissing(promoteError, 'can_change_name')) {
        const retry = await supabase
          .from('conversation_members')
          .update({
            role: 'admin',
            can_kick: false,
            can_change_photo: false,
            can_clear_messages: false,
          })
          .eq('conversation_id', group.id)
          .eq('user_id', successorId);
        promoteError = retry.error;
      }

      if (promoteError && columnMissing(promoteError, 'can_kick')) {
        const retry = await supabase
          .from('conversation_members')
          .update({ role: 'admin' })
          .eq('conversation_id', group.id)
          .eq('user_id', successorId);
        if (retry.error) throw retry.error;
      } else if (promoteError) {
        throw promoteError;
      }

      if (group.createdBy === userId) {
        const { error: ownerError } = await supabase
          .from('conversations')
          .update({ created_by: successorId })
          .eq('id', group.id);
        if (ownerError) throw ownerError;
      }
    }

    const { error } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', group.id)
      .eq('user_id', userId);
    if (error) throw error;

    res.status(200).send({ left: true, successorId: successorId || null });
  } catch (err: any) {
    console.error('Leave group error:', err);
    res.status(500).send({ error: err.message || 'Failed to leave the group' });
  }
};
