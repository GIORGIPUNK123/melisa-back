import { Response } from 'express';

export type ApiErrorField =
  | 'username'
  | 'nickname'
  | 'email'
  | 'password'
  | 'avatarUrl';

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'USERNAME_TAKEN'
  | 'USERNAME_COOLDOWN'
  | 'EMAIL_TAKEN'
  | 'EMAIL_UPDATE_FAILED'
  | 'EMAIL_UPDATE_DISABLED'
  | 'WEAK_PASSWORD'
  | 'MISSING_KEY_MATERIAL'
  | 'INCOMPLETE_KEY_MATERIAL'
  | 'PASSWORD_UPDATE_FAILED'
  | 'REGISTRATION_FAILED'
  | 'INTERNAL_ERROR';

export type ApiErrorBody = {
  error: string;
  code: ApiErrorCode;
  field?: ApiErrorField;
};

type SendApiErrorOptions = {
  field?: ApiErrorField;
};

/**
 * Sends the standard API error shape:
 * { error, code, field? }
 *
 * `field` lets the client attach the message to the matching form input.
 */
export const sendApiError = (
  res: Response,
  status: number,
  code: ApiErrorCode,
  error: string,
  options: SendApiErrorOptions = {},
) => {
  const body: ApiErrorBody = { error, code };
  if (options.field) body.field = options.field;
  return res.status(status).send(body);
};
