const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value);

export type BlockRelation = {
  blockedByMe: boolean;
  blockedMe: boolean;
};

export const getBlockRelation = async (
  supabase: any,
  userA: string,
  userB: string,
): Promise<BlockRelation> => {
  if (!isUuid(userA) || !isUuid(userB) || userA === userB) {
    return { blockedByMe: false, blockedMe: false };
  }

  const { data, error } = await supabase
    .from('blocks')
    .select('blocker_id, blocked_user_id')
    .or(
      `and(blocker_id.eq.${userA},blocked_user_id.eq.${userB}),and(blocker_id.eq.${userB},blocked_user_id.eq.${userA})`,
    );

  if (error) throw error;

  const rows = data || [];

  return {
    blockedByMe: rows.some(
      (row: { blocker_id: string; blocked_user_id: string }) =>
        row.blocker_id === userA && row.blocked_user_id === userB,
    ),
    blockedMe: rows.some(
      (row: { blocker_id: string; blocked_user_id: string }) =>
        row.blocker_id === userB && row.blocked_user_id === userA,
    ),
  };
};

export const usersAreBlocked = async (
  supabase: any,
  userA: string,
  userB: string,
) => {
  const relation = await getBlockRelation(supabase, userA, userB);
  return relation.blockedByMe || relation.blockedMe;
};

export const getBlockedUserIds = async (supabase: any, userId: string) => {
  const blockedIds = new Set<string>();
  if (!isUuid(userId)) return blockedIds;

  const { data, error } = await supabase
    .from('blocks')
    .select('blocker_id, blocked_user_id')
    .or(`blocker_id.eq.${userId},blocked_user_id.eq.${userId}`);

  if (error) throw error;

  for (const row of data || []) {
    blockedIds.add(
      row.blocker_id === userId ? row.blocked_user_id : row.blocker_id,
    );
  }

  return blockedIds;
};

export const deleteRelationship = async (
  supabase: any,
  userA: string,
  userB: string,
) => {
  if (!isUuid(userA) || !isUuid(userB)) return;

  const { error } = await supabase.from('friendships').delete().or(
    `and(user_id.eq.${userA},receiver_id.eq.${userB}),and(user_id.eq.${userB},receiver_id.eq.${userA})`,
  );

  if (error) throw error;
};
