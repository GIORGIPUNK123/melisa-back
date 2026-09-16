import { Request } from 'express';

export interface UserT extends PublicProfileT {
  email: string;
  iv: string;
  salt: string;
  encrypted_private_key: string;
  public_key: string;
}
export interface PublicProfileT {
  id: string;
  username: string;
  nickname: string;
  avatar_url?: string;
  status: 'online' | 'offline' | 'away';
  created_at: string;
  updated_at: string;
  public_key?: string;
  last_seen_at?: string | null;
  appear_offline?: boolean;
}
export interface FriendshipT {
  id: string;
  user_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  updated_at: string;
}
export interface FriendT {
  friendshipId: string;
  userId: string;
  username: string;
  nickname: string;
  avatarUrl?: string;
  status: 'online' | 'offline' | 'away';
  last_seen_at?: string | null;
  appear_offline?: boolean;
  conversationId?: string | null;
}
export interface ConversationMemberT {
  id: string;
  conversation_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string;
}
export interface registerRequestT extends Request {
  body: {
    email: string;
    password: string;
    username: string;
    nickname: string;
  };
}
