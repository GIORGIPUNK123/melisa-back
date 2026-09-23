export const userExists = async (supabase: any, email: string) => {
  try {
    const { data, error: userExistsError } = await supabase
      .from('users')
      .select('email')
      .eq('email', email);
    if (userExistsError) {
      throw userExistsError;
    }

    return !!data.length;
  } catch (err) {
    console.error(err);
    return false;
  }
};
export const userNameExists = async (supabase: any, username: string) => {
  try {
    const { data, error: userExistsError } = await supabase
      .from('users')
      .select('username')
      .eq('username', username);
    if (userExistsError) {
      throw userExistsError;
    }

    return !!data.length;
  } catch (err) {
    console.error(err);
    return false;
  }
};
