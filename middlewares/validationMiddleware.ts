import { Request, Response, NextFunction } from 'express';
import { ObjectSchema } from 'yup';

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
    } catch (error: any) {
      res.status(400).send({ error: error.message });
    }
  };
