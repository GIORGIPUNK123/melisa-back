export const userExists = async (supabase: any, email: string) => {
  const { data, error } = await supabase
    .from('users')
    .select('email')
    .eq('email', email);

  if (error) {
    throw error;
  }

  return !!data?.length;
};

export const userNameExists = async (supabase: any, username: string) => {
  const { data, error } = await supabase
    .from('users')
    .select('username')
    .eq('username', username);

  if (error) {
    throw error;
  }

  return !!data?.length;
};
