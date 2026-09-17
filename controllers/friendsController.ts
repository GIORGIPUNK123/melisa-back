import { Response } from 'express';
import { supabase } from '..';
import { FriendshipT, FriendT, PublicProfileT } from '../types';

export const addFriendController = async (req: any, res: Response) => {
  const { username } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    // Find the user by username
    const { data: targetUser, error: userError } = await supabase
      .from('users')
      .select('id, username, nickname')
      .eq('username', username)
      .single();

    if (userError || !targetUser) {
      return res.status(404).send({ error: 'User not found' });
    }

    // Prevent adding yourself
    if (targetUser.id === userId) {
      return res.status(400).send({ error: 'Cannot add yourself as a friend' });
    }

    // Check if friendship already exists
    const { data: existingFriendship } = (await supabase
      .from('friendships')
      .select('id, status')
      .or(
        `and(user_id.eq.${userId},receiver_id.eq.${targetUser.id}),and(user_id.eq.${targetUser.id},receiver_id.eq.${userId})`,
      )
      .maybeSingle()) as { data: FriendshipT | null; error: any };

    if (existingFriendship) {
      if (existingFriendship.status === 'pending') {
        return res
          .status(400)
          .send({ error: 'Friend request already pending' });
      } else if (existingFriendship.status === 'accepted') {
        return res.status(400).send({ error: 'Already friends' });
      }
    }

    // Create friendship
    const { data: friendship, error: friendshipError } = (await supabase
      .from('friendships')
      .insert({
        user_id: userId,
        receiver_id: targetUser.id,
        status: 'pending',
      })
      .select()
      .single()) as { data: FriendshipT; error: any };

    if (friendshipError) {
      throw friendshipError;
    }

    // Get sender info for notification
    const { data: sender } = await supabase
      .from('users')
      .select('username, nickname')
      .eq('id', userId)
      .single();

    // Create notification for the receiver
    await supabase.from('notifications').insert({
      user_id: targetUser.id,
      type: 'friend_request',
      title: 'New Friend Request',
      message: `${sender?.nickname || sender?.username || 'Someone'} sent you a friend request`,
      link: `/friends/requests`,
      is_read: false,
    });

    res.status(200).send({
      message: 'Friend request sent successfully',
      friendship,
    });
  } catch (err: any) {
    console.error('Add friend error:', err);
    res
      .status(500)
      .send({ error: err.message || 'Failed to send friend request' });
  }
};

export const updateUserSettingsController = async (req: any, res: Response) => {
  const { username, nickname, avatarUrl, email, password, appearOffline } =
    req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    const updates: any = {};

    // Validate and prepare user table updates
    if (username !== undefined) {
      if (username.length < 3 || username.length > 50) {
        return res
          .status(400)
          .send({ error: 'Username must be between 3 and 50 characters' });
      }

      // Check if username is taken
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .neq('id', userId)
        .maybeSingle();

      if (existingUser) {
        return res.status(400).send({ error: 'Username already taken' });
      }

      // Check if user has updated username in the last 7 days
      const { data: currentUser } = await supabase
        .from('users')
        .select('username, updated_at')
        .eq('id', userId)
        .single();

      if (
        currentUser &&
        currentUser.username !== username &&
        currentUser.updated_at
      ) {
        const lastUpdate = new Date(currentUser.updated_at);
        const now = new Date();
        const daysSinceUpdate =
          (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceUpdate < 7) {
          const daysRemaining = Math.ceil(7 - daysSinceUpdate);
          return res.status(400).send({
            error: `You can only change your username once every 7 days. Please wait ${daysRemaining} more day(s)`,
          });
        }
      }

      updates.username = username;
    }

    if (nickname !== undefined) {
      if (nickname.length < 2 || nickname.length > 100) {
        return res
          .status(400)
          .send({ error: 'Nickname must be between 2 and 100 characters' });
      }
      updates.nickname = nickname;
    }

    if (avatarUrl !== undefined) {
      updates.avatar_url = avatarUrl || null;
    }

    if (appearOffline !== undefined) {
      updates.appear_offline = !!appearOffline;
    }

    // Update users table
    if (Object.keys(updates).length > 0) {
      const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        throw error;
      }
    }

    // Update auth email
    if (email) {
      const { error: emailError } = await supabase.auth.admin.updateUserById(
        userId,
        { email },
      );
      if (emailError) {
        throw emailError;
      }
    }

    const {
      encrypted_private_key,
      iv,
      salt,
    }: {
      encrypted_private_key?: string;
      iv?: string;
      salt?: string;
    } = req.body;

    // Password change must include re-wrapped key material, validated first
    if (password) {
      if (password.length < 6) {
        return res
          .status(400)
          .send({ error: 'Password must be at least 6 characters' });
      }
      if (!encrypted_private_key || !iv || !salt) {
        return res.status(400).send({
          error:
            'Changing password requires re-encrypted private key material (encrypted_private_key, iv, salt)',
        });
      }
    }

    if (encrypted_private_key || iv || salt) {
      if (!encrypted_private_key || !iv || !salt) {
        return res.status(400).send({
          error: 'encrypted_private_key, iv, and salt must be sent together',
        });
      }
      const { error: keyError } = await supabase
        .from('users')
        .update({ encrypted_private_key, iv, salt })
        .eq('id', userId);
      if (keyError) {
        throw keyError;
      }
    }

    if (password) {
      const { error: passwordError } = await supabase.auth.admin.updateUserById(
        userId,
        { password },
      );
      if (passwordError) {
        throw passwordError;
      }
    }

    // Get updated user data
    const { data: updatedUser } = await supabase
      .from('users')
      .select(
        'id,email,username,nickname,avatar_url,status,appear_offline,created_at',
      )
      .eq('id', userId)
      .single();

    res.status(200).send({
      message: 'Settings updated successfully',
      user: updatedUser,
    });
  } catch (err: any) {
    console.error('Update settings error:', err);
    res.status(500).send({ error: err.message || 'Failed to update settings' });
  }
};

export const getPendingRequestsController = async (req: any, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    // Get requests sent by user
    const { data: sentRequests, error: sentError } = await supabase
      .from('friendships')
      .select(
        `
        id, 
        receiver_id, 
        created_at,
        receiver:users!receiver_id(username, nickname, avatar_url, status)
      `,
      )
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (sentError) throw sentError;

    // Get requests received by user
    const { data: receivedRequests, error: receivedError } = await supabase
      .from('friendships')
      .select(
        `
        id, 
        user_id, 
        created_at,
        sender:users!user_id(username, nickname, avatar_url, status)
      `,
      )
      .eq('receiver_id', userId)
      .eq('status', 'pending');

    if (receivedError) throw receivedError;

    // Format the response without IDs
    const sent = (sentRequests || []).map((req: any) => ({
      friendshipId: req.id,
      username: req.receiver?.username,
      nickname: req.receiver?.nickname,
      avatarUrl: req.receiver?.avatar_url,
      status: req.receiver?.status,
      createdAt: req.created_at,
    }));

    const received = (receivedRequests || []).map((req: any) => ({
      friendshipId: req.id,
      username: req.sender?.username,
      nickname: req.sender?.nickname,
      avatarUrl: req.sender?.avatar_url,
      status: req.sender?.status,
      createdAt: req.created_at,
    }));

    res.status(200).send({
      sent,
      received,
    });
  } catch (err: any) {
    console.error('Get pending requests error:', err);
    res
      .status(500)
      .send({ error: err.message || 'Failed to get pending requests' });
  }
};

export const cancelFriendRequestController = async (
  req: any,
  res: Response,
) => {
  const { friendshipId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    // Verify the user owns this request
    const { data: friendship } = (await supabase
      .from('friendships')
      .select('user_id, receiver_id, status')
      .eq('id', friendshipId)
      .single()) as { data: FriendshipT | null; error: any };

    if (!friendship) {
      return res.status(404).send({ error: 'Friend request not found' });
    }

    if (friendship.user_id !== userId) {
      return res.status(403).send({ error: 'Cannot cancel this request' });
    }

    if (friendship.status !== 'pending') {
      return res.status(400).send({ error: 'Request is no longer pending' });
    }

    // Delete the request
    const { error: deleteError } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);

    if (deleteError) throw deleteError;

    res.status(200).send({ message: 'Friend request cancelled' });
  } catch (err: any) {
    console.error('Cancel friend request error:', err);
    res.status(500).send({ error: err.message || 'Failed to cancel request' });
  }
};

export const acceptFriendRequestController = async (
  req: any,
  res: Response,
) => {
  const { friendshipId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    // Verify the user is the receiver
    const { data: friendship } = (await supabase
      .from('friendships')
      .select('user_id, receiver_id, status')
      .eq('id', friendshipId)
      .single()) as { data: FriendshipT | null; error: any };

    if (!friendship) {
      return res.status(404).send({ error: 'Friend request not found' });
    }

    if (friendship.receiver_id !== userId) {
      return res.status(403).send({ error: 'Cannot accept this request' });
    }

    if (friendship.status !== 'pending') {
      return res.status(400).send({ error: 'Request is no longer pending' });
    }

    // Update to accepted
    const { data: updatedFriendship, error: updateError } = (await supabase
      .from('friendships')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', friendshipId)
      .select()
      .single()) as { data: FriendshipT; error: any };

    if (updateError) throw updateError;

    // Ensure conversation exists
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select(
        `
        id,
        type,
        conversation_members(user_id)
      `,
      )
      .eq('type', 'direct');

    if (convError) throw convError;

    // Find or create conversation with both members
    let conversation: any = conversations?.find((conv: any) => {
      const memberIds = conv.conversation_members.map((m: any) => m.user_id);
      return (
        memberIds.includes(friendship.user_id) &&
        memberIds.includes(userId) &&
        memberIds.length === 2
      );
    });

    // If no conversation exists, create one
    if (!conversation) {
      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({ type: 'direct', created_by: friendship.user_id })
        .select()
        .single();

      if (createError) throw createError;

      if (newConv) {
        // Add both users as members
        await supabase.from('conversation_members').insert([
          { conversation_id: newConv.id, user_id: friendship.user_id },
          { conversation_id: newConv.id, user_id: userId },
        ]);

        conversation = newConv;
      }
    }

    // Get sender info for notification
    const { data: receiver } = await supabase
      .from('users')
      .select('username, nickname')
      .eq('id', userId)
      .single();

    // Notify the sender
    await supabase.from('notifications').insert({
      user_id: friendship.user_id,
      type: 'friend_accepted',
      title: 'Friend Request Accepted',
      message: `${receiver?.nickname || receiver?.username} accepted your friend request`,
      link: `/friends`,
      is_read: false,
    });

    res.status(200).send({ message: 'Friend request accepted' });
  } catch (err: any) {
    console.error('Accept friend request error:', err);
    res.status(500).send({ error: err.message || 'Failed to accept request' });
  }
};

export const rejectFriendRequestController = async (
  req: any,
  res: Response,
) => {
  const { friendshipId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    // Verify the user is the receiver
    const { data: friendship } = (await supabase
      .from('friendships')
      .select('user_id, receiver_id, status')
      .eq('id', friendshipId)
      .single()) as { data: FriendshipT | null; error: any };

    if (!friendship) {
      return res.status(404).send({ error: 'Friend request not found' });
    }

    if (friendship.receiver_id !== userId) {
      return res.status(403).send({ error: 'Cannot reject this request' });
    }

    if (friendship.status !== 'pending') {
      return res.status(400).send({ error: 'Request is no longer pending' });
    }

    // Delete the request
    const { error: deleteError } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);

    if (deleteError) throw deleteError;

    res.status(200).send({ message: 'Friend request rejected' });
  } catch (err: any) {
    console.error('Reject friend request error:', err);
    res.status(500).send({ error: err.message || 'Failed to reject request' });
  }
};

export const removeFriendController = async (req: any, res: Response) => {
  const { friendUserId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  if (!friendUserId) {
    return res.status(400).send({ error: 'Friend user id is required' });
  }

  if (friendUserId === userId) {
    return res.status(400).send({ error: 'Cannot remove yourself' });
  }

  try {
    const { data: friendship, error: findError } = (await supabase
      .from('friendships')
      .select('id, user_id, receiver_id, status')
      .eq('status', 'accepted')
      .or(
        `and(user_id.eq.${userId},receiver_id.eq.${friendUserId}),and(user_id.eq.${friendUserId},receiver_id.eq.${userId})`,
      )
      .maybeSingle()) as { data: FriendshipT | null; error: any };

    if (findError) throw findError;

    if (!friendship) {
      return res.status(404).send({ error: 'Friendship not found' });
    }

    const { error: deleteError } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendship.id);

    if (deleteError) throw deleteError;

    res.status(200).send({ message: 'Friend removed' });
  } catch (err: any) {
    console.error('Remove friend error:', err);
    res.status(500).send({ error: err.message || 'Failed to remove friend' });
  }
};

export const getUserProfileController = async (req: any, res: Response) => {
  const { username } = req.params;

  try {
    // Get public profile (no ID exposed)
    const { data: user, error } = await supabase
      .from('users')
      .select(
        'id, username, nickname, avatar_url, status, appear_offline, last_seen_at, created_at',
      )
      .eq('username', username)
      .single();

    if (error || !user) {
      return res.status(404).send({ error: 'User not found' });
    }

    res.status(200).send({ user });
  } catch (err: any) {
    console.error('Get user profile error:', err);
    res.status(500).send({ error: err.message || 'Failed to get profile' });
  }
};

export const getFriendsListController = async (req: any, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    // Get all accepted friendships where user is either sender or receiver
    const { data: friendships, error } = (await supabase
      .from('friendships')
      .select('*')
      .eq('status', 'accepted')
      .or(`user_id.eq.${userId},receiver_id.eq.${userId}`)) as {
      data: FriendshipT[];
      error: any;
    };
    if (error) throw error;

    const friends: FriendT[] = await Promise.all(
      (friendships || []).map(async (f) => {
        const isUserSender = f.user_id === userId;
        const { data: friendInfo } = (await supabase
          .from('public_profiles')
          .select('*')
          .eq('id', isUserSender ? f.receiver_id : f.user_id)
          .single()) as { data: PublicProfileT; error: any };

        if (!friendInfo) throw new Error('Friend profile not found');

        return {
          friendshipId: f.id,
          userId: friendInfo.id,
          username: friendInfo.username,
          nickname: friendInfo.nickname,
          avatarUrl: friendInfo.avatar_url,
          status: friendInfo.status,
          last_seen_at: friendInfo.last_seen_at,
          appear_offline: friendInfo.appear_offline,
        };
      }),
    );

    const { data: directConversations, error: conversationError } =
      await supabase
        .from('conversations')
        .select(
          `
        id,
        conversation_members(user_id)
      `,
        )
        .eq('type', 'direct');

    if (conversationError) throw conversationError;

    const conversationIdByFriendId = new Map<string, string>();

    (directConversations || []).forEach((conversation: any) => {
      const memberIds = (conversation.conversation_members || []).map(
        (member: any) => member.user_id,
      );

      if (!memberIds.includes(userId) || memberIds.length !== 2) return;

      const friendId = memberIds.find((memberId: string) => memberId !== userId);
      if (friendId) {
        conversationIdByFriendId.set(friendId, conversation.id);
      }
    });

    const friendsWithConversationId = friends.map((friend) => ({
      ...friend,
      conversationId: conversationIdByFriendId.get(friend.userId) || null,
    }));

    res.status(200).send({ friends: friendsWithConversationId });
  } catch (err: any) {
    console.error('Get friends list error:', err);
    res
      .status(500)
      .send({ error: err.message || 'Failed to get friends list' });
  }
};

export const getOrCreateConversationController = async (
  req: any,
  res: Response,
) => {
  const userId = req.user?.id;
  const { friendUserId } = req.params;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  if (!friendUserId) {
    return res.status(400).send({ error: 'Friend user ID required' });
  }

  try {
    // Check if friendship exists and is accepted
    const { data: friendship, error: friendshipError } = (await supabase
      .from('friendships')
      .select('id, status')
      .or(
        `and(user_id.eq.${userId},receiver_id.eq.${friendUserId}),and(user_id.eq.${friendUserId},receiver_id.eq.${userId})`,
      )
      .eq('status', 'accepted')
      .maybeSingle()) as { data: FriendshipT | null; error: any };

    if (friendshipError) throw friendshipError;

    if (!friendship) {
      return res
        .status(403)
        .send({ error: 'You are not friends with this user' });
    }

    // Try to find existing direct conversation between these two users
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select(
        `
        id,
        type,
        conversation_members(user_id)
      `,
      )
      .eq('type', 'direct');

    if (convError) throw convError;

    // Find conversation with both members
    let conversation: any = conversations?.find((conv: any) => {
      const memberIds = conv.conversation_members.map((m: any) => m.user_id);
      return (
        memberIds.includes(userId) &&
        memberIds.includes(friendUserId) &&
        memberIds.length === 2
      );
    });

    // If no conversation exists, create one
    if (!conversation) {
      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({ type: 'direct', created_by: userId })
        .select()
        .single();

      if (createError) throw createError;

      if (!newConv) {
        throw new Error('Failed to create conversation');
      }

      // Add both users as members
      const { error: memberError } = await supabase
        .from('conversation_members')
        .insert([
          { conversation_id: newConv.id, user_id: userId },
          { conversation_id: newConv.id, user_id: friendUserId },
        ]);

      if (memberError) throw memberError;

      conversation = newConv;
    }

    if (!conversation || !conversation.id) {
      throw new Error('Conversation not found or could not be created');
    }

    res.status(200).send({ conversationId: conversation.id });
  } catch (err: any) {
    console.error('Get or create conversation error:', err);
    res
      .status(500)
      .send({ error: err.message || 'Failed to get or create conversation' });
  }
};

export const getConversationMembersController = async (
  req: any,
  res: Response,
) => {
  const userId = req.user?.id;
  const { conversationId } = req.params;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  if (!conversationId) {
    return res.status(400).send({ error: 'Conversation ID is required' });
  }

  try {
    const { data: memberRows, error: memberError } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId);

    if (memberError) throw memberError;

    const memberIds = (memberRows || []).map((m: any) => m.user_id);

    if (!memberIds.includes(userId)) {
      return res
        .status(403)
        .send({ error: 'You are not a member of this conversation' });
    }

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(
        'id, username, nickname, avatar_url, status, created_at, public_key',
      )
      .in('id', memberIds);

    if (usersError) throw usersError;

    res.status(200).send({ conversationMembers: users || [] });
  } catch (err: any) {
    console.error('Get conversation members error:', err);
    res
      .status(500)
      .send({ error: err.message || 'Failed to get conversation members' });
  }
};

export const getCurrentUserController = async (req: any, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send({ error: 'Unauthorized' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select(
        'id, email, username, nickname, avatar_url, status, created_at, updated_at',
      )
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(404).send({ error: 'User not found' });
    }

    res.status(200).send({ user });
  } catch (err: any) {
    console.error('Get current user error:', err);
    res.status(500).send({ error: err.message || 'Failed to get user' });
  }
};
