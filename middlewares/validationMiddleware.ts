import { Request, Response, NextFunction } from 'express';
import { ObjectSchema, ValidationError } from 'yup';
import { ApiErrorField, sendApiError } from '../functions/apiErrors';

export const validation =
  (
    schema: ObjectSchema<{
      body: {
        email: string;
        password?: string;
        username?: string;
        nickname?: string;
      };
    }>,
  ) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.validate({
        body: req.body,
      });
      next();
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        const field = error.path?.split('.').pop() as
          | ApiErrorField
          | undefined;

        return sendApiError(res, 400, 'VALIDATION_ERROR', error.message, {
          field,
        });
      }

      return sendApiError(
        res,
        400,
        'VALIDATION_ERROR',
        'Invalid request body',
      );
    }
  };
