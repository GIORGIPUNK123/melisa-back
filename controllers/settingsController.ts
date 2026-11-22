import { Response } from 'express';
import { supabase } from '..';
import { passwordError } from '../functions/passwordPolicy';
import { sendApiError } from '../functions/apiErrors';

// Temporarily disabled: email changes only update Supabase Auth and are not
// synchronized with public.users.email. Re-enable after both are updated
// atomically.
const EMAIL_UPDATES_ENABLED = false;

export const updateUserSettingsController = async (req: any, res: Response) => {
  const { username, nickname, avatarUrl, email, password, appearOffline } =
    req.body;
  const userId = req.user?.id;

  if (!userId) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
  }

  if (email !== undefined && !EMAIL_UPDATES_ENABLED) {
    return sendApiError(
      res,
      400,
      'EMAIL_UPDATE_DISABLED',
      'Email updates are temporarily disabled',
      { field: 'email' },
    );
  }

  try {
    const updates: Record<string, unknown> = {};
    let previousKeyMaterial: {
      encrypted_private_key: string | null;
      iv: string | null;
      salt: string | null;
    } | null = null;

    // Validate and prepare user table updates
    if (username !== undefined) {
      if (typeof username !== 'string') {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'Username must be a string',
          { field: 'username' },
        );
      }

      const nextUsername = username.trim();

      if (nextUsername.length < 3 || nextUsername.length > 50) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'Username must be between 3 and 50 characters',
          { field: 'username' },
        );
      }

      // Check if username is taken
      const { data: existingUser, error: existingUserError } = await supabase
        .from('users')
        .select('id')
        .eq('username', nextUsername)
        .neq('id', userId)
        .maybeSingle();

      if (existingUserError) throw existingUserError;

      if (existingUser) {
        return sendApiError(
          res,
          409,
          'USERNAME_TAKEN',
          'Username already taken',
          { field: 'username' },
        );
      }

      // Check if user has updated username in the last 7 days
      const { data: currentUser } = await supabase
        .from('users')
        .select('username, updated_at')
        .eq('id', userId)
        .single();

      if (
        currentUser &&
        currentUser.username !== nextUsername &&
        currentUser.updated_at
      ) {
        const lastUpdate = new Date(currentUser.updated_at);
        const now = new Date();
        const daysSinceUpdate =
          (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceUpdate < 7) {
          const daysRemaining = Math.ceil(7 - daysSinceUpdate);
          return sendApiError(
            res,
            400,
            'USERNAME_COOLDOWN',
            `You can only change your username once every 7 days. Please wait ${daysRemaining} more day(s)`,
            { field: 'username' },
          );
        }
      }

      updates.username = nextUsername;
    }

    if (nickname !== undefined) {
      if (typeof nickname !== 'string') {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'Nickname must be a string',
          { field: 'nickname' },
        );
      }

      const nextNickname = nickname.trim();

      if (nextNickname.length < 2 || nextNickname.length > 100) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'Nickname must be between 2 and 100 characters',
          { field: 'nickname' },
        );
      }
      updates.nickname = nextNickname;
    }

    if (avatarUrl !== undefined) {
      if (avatarUrl !== null && typeof avatarUrl !== 'string') {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'Avatar URL must be a string',
          { field: 'avatarUrl' },
        );
      }
      updates.avatar_url = avatarUrl || null;
    }

    if (appearOffline !== undefined) {
      updates.appear_offline = !!appearOffline;
    }

    // Update users table
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          const detail = `${error.message} ${error.details ?? ''}`.toLowerCase();

          if (detail.includes('username')) {
            return sendApiError(
              res,
              409,
              'USERNAME_TAKEN',
              'Username already taken',
              { field: 'username' },
            );
          }

          if (detail.includes('email')) {
            return sendApiError(
              res,
              409,
              'EMAIL_TAKEN',
              'Email is already in use',
              { field: 'email' },
            );
          }
        }

        throw error;
      }
    }

    // Update auth email
    if (EMAIL_UPDATES_ENABLED && email) {
      if (typeof email !== 'string' || !email.trim()) {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'Email must be a valid email address',
          { field: 'email' },
        );
      }

      const { error: emailError } = await supabase.auth.admin.updateUserById(
        userId,
        { email: email.trim() },
      );

      if (emailError) {
        const emailTaken = /already|exists|registered|duplicate/i.test(
          emailError.message,
        );

        return sendApiError(
          res,
          emailTaken ? 409 : 400,
          emailTaken ? 'EMAIL_TAKEN' : 'EMAIL_UPDATE_FAILED',
          emailTaken ? 'Email is already in use' : emailError.message,
          { field: 'email' },
        );
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
      if (typeof password !== 'string') {
        return sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'Password must be a string',
          { field: 'password' },
        );
      }

      const passwordProblem = passwordError(password);
      if (passwordProblem) {
        return sendApiError(res, 400, 'WEAK_PASSWORD', passwordProblem, {
          field: 'password',
        });
      }
      if (!encrypted_private_key || !iv || !salt) {
        return sendApiError(
          res,
          400,
          'MISSING_KEY_MATERIAL',
          'Changing password requires re-encrypted private key material (encrypted_private_key, iv, salt)',
          { field: 'password' },
        );
      }
    }

    if (encrypted_private_key || iv || salt) {
      if (!encrypted_private_key || !iv || !salt) {
        return sendApiError(
          res,
          400,
          'INCOMPLETE_KEY_MATERIAL',
          'encrypted_private_key, iv, and salt must be sent together',
          { field: 'password' },
        );
      }
      const { data: existingKeyMaterial, error: keyReadError } = await supabase
        .from('users')
        .select('encrypted_private_key, iv, salt')
        .eq('id', userId)
        .single();

      if (keyReadError) throw keyReadError;
      previousKeyMaterial = existingKeyMaterial;

      const { error: keyError } = await supabase
        .from('users')
        .update({ encrypted_private_key, iv, salt })
        .eq('id', userId);
      if (keyError) {
        throw keyError;
      }
    }

    if (password) {
      let passwordUpdateError: { message: string } | null = null;

      try {
        const { error } = await supabase.auth.admin.updateUserById(userId, {
          password,
        });
        passwordUpdateError = error;
      } catch (error) {
        passwordUpdateError = {
          message:
            error instanceof Error ? error.message : 'Failed to update password',
        };
      }

      if (passwordUpdateError) {
        // Supabase rejected the new login password after the re-wrapped key
        // material was already stored. Restore the old material so the
        // account cannot end up with a key encrypted by a password that was
        // never accepted.
        if (previousKeyMaterial) {
          const { error: rollbackError } = await supabase
            .from('users')
            .update(previousKeyMaterial)
            .eq('id', userId);

          if (rollbackError) {
            console.error(
              'Failed to restore key material after password update failure:',
              rollbackError,
            );
            return sendApiError(
              res,
              500,
              'INTERNAL_ERROR',
              'Failed to update password safely. Please try again or contact support.',
              { field: 'password' },
            );
          }
        }

        return sendApiError(
          res,
          400,
          'PASSWORD_UPDATE_FAILED',
          passwordUpdateError.message,
          { field: 'password' },
        );
      }
    }

    // Get updated user data
    const { data: updatedUser } = await supabase
      .from('users')
      .select('id,email,username,nickname,avatar_url,status,appear_offline,created_at')
      .eq('id', userId)
      .single();

    res.status(200).send({
      message: 'Settings updated successfully',
      user: updatedUser,
    });
  } catch (err: any) {
    console.error('Update settings error:', err);
    sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to update settings');
  }
};
