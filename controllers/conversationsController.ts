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
