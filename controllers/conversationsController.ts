import { Response } from 'express';
import { supabase } from '..';
import { ConversationMemberT, PublicProfileT } from '../types';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export const getConversationMembersController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const conversationId = req.params.conversationId;

  const userId: string = req.user!.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  if (!conversationId) {
    return res.status(401).send({ error: 'Conversation Id is needed' });
  }

  try {
    // Get all conversation members
    const { data: members, error } = (await supabase
      .from('conversation_members')
      .select('*')
      .eq('conversation_id', conversationId)) as {
      data: ConversationMemberT[];
      error: any;
    };
    if (error) throw error;

    const publicProfiles: PublicProfileT[] = await Promise.all(
      members.map(async (member) => {
        const { data: publicProfile } = (await supabase
          .from('public_profiles')
          .select('*')
          .eq('id', member.user_id)
          .single()) as { data: PublicProfileT; error: any };

        if (!publicProfile) throw new Error('Profile not found');

        return publicProfile;
      }),
    );
    res.status(200).send({ conversationMembers: publicProfiles });
  } catch (err: any) {
    console.error('Get friends list error:', err);
    res
      .status(500)
      .send({ error: err.message || 'Failed to get friends list' });
  }
};

const filePathFromMessage = (content: string) => {
  if (!content.startsWith('file:v1:')) return null;
  try {
    const payload = JSON.parse(content.slice('file:v1:'.length)) as {
      path?: string;
    };
    return typeof payload.path === 'string' ? payload.path : null;
  } catch {
    return null;
  }
};

export const deleteMyMessageController = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const userId = req.user?.id;
  const { conversationId, messageId } = req.params;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  if (!conversationId || !messageId) {
    return res.status(400).send({ error: 'Message not found' });
  }

  try {
    const { data: message, error } = await supabase
      .from('messages')
      .select('id, sender_id, conversation_id, content')
      .eq('id', messageId)
      .maybeSingle();

    if (error) throw error;
    if (!message || String(message.conversation_id) !== String(conversationId)) {
      return res.status(404).send({ error: 'Message not found' });
    }
    if (message.sender_id !== userId) {
      return res.status(403).send({ error: 'You can only delete your own messages' });
    }

    await supabase.from('message_reactions').delete().eq('message_id', messageId);

    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)
      .eq('sender_id', userId);

    if (deleteError) throw deleteError;

    const path = filePathFromMessage(message.content || '');
    if (path?.startsWith(`${conversationId}/`)) {
      await supabase.storage.from('chat-media').remove([path]);
    }

    res.status(200).send({ message: 'Message deleted' });
  } catch (err: any) {
    console.error('Delete message error:', err);
    res.status(500).send({ error: err.message || 'Failed to delete message' });
  }
};
