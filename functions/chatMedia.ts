import { supabase } from '..';

const CHAT_MEDIA_BUCKET = 'chat-media';

export const filePathFromMessage = (content: string) => {
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

export const removeStoredPaths = async (paths: string[]) => {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;

  for (let index = 0; index < unique.length; index += 100) {
    const batch = unique.slice(index, index + 100);
    const { error } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .remove(batch);
    if (error) {
      console.error('Failed to remove chat media:', error.message);
    }
  }
};

export const removeConversationMedia = async (conversationId: string | number) => {
  const folder = String(conversationId);
  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .list(folder, { limit: 100, offset });

    if (error) {
      console.error('Failed to list chat media:', error.message);
      return;
    }
    if (!data?.length) break;

    for (const item of data) {
      if (item.name) paths.push(`${folder}/${item.name}`);
    }

    if (data.length < 100) break;
    offset += data.length;
  }

  await removeStoredPaths(paths);
};
