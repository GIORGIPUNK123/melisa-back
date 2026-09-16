import * as yup from 'yup';
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
    password: yup.string().min(8).required(),
  }),
});
export const registerSchema = yup.object().shape({
  body: yup.object().shape({
    email: yup
      .string()
      .email('Please write correct email')
      .required('Email is required'),
    password: yup.string().min(8).required('Password is required'),
    username: yup.string().min(2).required('Username is required'),
    nickname: yup.string().min(2).required('Nickname is required'),
  }),
});
