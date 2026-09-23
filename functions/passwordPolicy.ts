// Signup and password changes use this rule.
// Login is not checked, so older passwords can still sign in.
export const MIN_PASSWORD_LENGTH = 6;

export const passwordRuleMessage =
  'Password must be at least 6 characters and include a number';

export const passwordError = (password: string) => {
  if (password.trim().length < MIN_PASSWORD_LENGTH || !/\d/.test(password)) {
    return passwordRuleMessage;
  }
  return null;
};
