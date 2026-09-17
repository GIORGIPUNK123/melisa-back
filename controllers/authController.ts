import { Response } from 'express';
import { supabase } from '..';
import { userExists, userNameExists } from '../functions/getUserInfo';
import { box_keyPair, encodeBase64 } from 'tweetnacl-ts';
import { randomBytes } from 'crypto';
import { argon2id, hash } from 'argon2';
import { AESGCMEncrypt } from '../functions/cryptoFunctions';

const frontendOrigin = (
  process.env.FRONTEND_URL || 'https://melisa-phi.vercel.app'
).replace(/\/+$/, '');

const emailRedirectTo = `${frontendOrigin}/`;

export const emailOtpController = async (req: any, res: Response) => {
  const { email } = req.body;

  try {
    const { data: userData, error: authError }: { data: any; error: any } =
      await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo,
        },
      });
    if (authError) {
      throw authError;
    }
    userData.user;
    res.send(`Link was sent to ${email}. Please authenticate.`);
  } catch (error) {
    console.error('Error in OTP:', error);
    res.status(400).send({
      message: 'Error sending OTP. Please try again.',
    });
  }
};

export const registerController = async (req: any, res: Response) => {
  const {
    email,
    password,
    username,
    nickname,
    public_key,
    encrypted_private_key,
    iv,
    salt,
  } = <
    {
      email: string;
      password: string;
      username: string;
      nickname: string;
      public_key: string;
      encrypted_private_key: string;
      iv: string;
      salt: string;
    }
  >req.body;
  try {
    // Check if user already exists

    const existingUser = await userExists(supabase, email);

    if (existingUser) {
      return res.status(400).send({ error: 'User already exists' });
    }
    console.log('No existing user found, proceeding with registration');
    // Create auth user
    const { data: userData, error: authError } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        emailRedirectTo,
      },
    });
    if (authError) {
      throw new Error(authError.message);
    }

    if (!userData.user) {
      return res.status(400).send({ error: 'Failed to create user' });
    }

    const keyPair = box_keyPair();
    const publicKey = encodeBase64(keyPair.publicKey);
    const privateKey = encodeBase64(keyPair.secretKey);
    const salt = randomBytes(16);
    const iv = randomBytes(12);

    const passwordKey = await hash(password, {
      type: argon2id,
      salt: salt, // random salt specific for encryption
      hashLength: 32, // 32 bytes for AES/ChaCha20 key
      raw: true, // returns raw bytes suitable for encryption
    });
    const passwordKeyArray = new Uint8Array(passwordKey); // convert Buffer -> Uint8Array
    const ivArray = new Uint8Array(iv); // convert Buffer -> Uint8Array

    const EncryptedPrivateKey = await AESGCMEncrypt(
      privateKey,
      passwordKeyArray,
      ivArray,
    );

    // Insert into users table (service_role key bypasses RLS)
    const { error: insertError } = await supabase.from('users').insert({
      id: userData.user.id,
      email: email,
      username: username,
      nickname: nickname,
      status: 'offline',
      encrypted_private_key: EncryptedPrivateKey,
      public_key: publicKey,
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
    });

    if (insertError) {
      console.error('User table error:', insertError);
      return res.status(400).send({ error: insertError.message });
    }

    res.status(200).send({ message: 'Please confirm your email' });
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(400).send({ error: err.message || 'Registration failed' });
  }
};
export const checkUsernameController = async (req: any, res: Response) => {
  const { username } = req.query;
  try {
    const userNameExistsBool = await userNameExists(
      supabase,
      username as string,
    );

    res.status(200).send({ exists: userNameExistsBool });
  } catch (err: any) {
    res.status(400).send({ error: err.message });
  }
};

export const loginController = async (req: any, res: Response) => {
  const { email, password } = req.body;
  try {
    const { data: userData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });
    if (authError) {
      console.error('Login error:', authError);
      return res.status(400).send({ error: authError.message });
    }

    if (!userData.session) {
      return res.status(400).send({ error: 'Failed to create session' });
    }

    res.status(200).send({
      access_token: userData.session.access_token,
      refresh_token: userData.session.refresh_token,
      user: userData.user,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(400).send({ error: err.message || 'Login failed' });
  }
};
