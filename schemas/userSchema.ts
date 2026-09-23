import * as yup from 'yup';
import { passwordError, passwordRuleMessage } from '../functions/passwordPolicy';
export const emailOtpSchema = yup.object().shape({
  body: yup.object().shape({
    email: yup
      .string()
      .email('Please write correct email')
      .required('Email is required'),
  }),
});
export const loginSchema = yup.object().shape({
  body: yup.object().shape({
    email: yup.string().email().required(),
    password: yup.string().required(),
  }),
});
export const registerSchema = yup.object().shape({
  body: yup.object().shape({
    email: yup
      .string()
      .email('Please write correct email')
      .required('Email is required'),
    password: yup
      .string()
      .required('Password is required')
      .test('password-rule', passwordRuleMessage, (value) => {
        if (!value) return true;
        return passwordError(value) === null;
      }),
    username: yup.string().min(2).required('Username is required'),
    nickname: yup.string().min(2).required('Nickname is required'),
  }),
});
