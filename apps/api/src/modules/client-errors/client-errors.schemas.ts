import { CLIENT_APPS, CLIENT_ERROR_KINDS, CLIENT_ERROR_LIMITS } from '@masar/shared';
import { z } from 'zod';

export const clientErrorSchema = z.object({
  app: z.enum(CLIENT_APPS),
  kind: z.enum(CLIENT_ERROR_KINDS),
  message: z.string().min(1).max(CLIENT_ERROR_LIMITS.message),
  stack: z.string().max(CLIENT_ERROR_LIMITS.stack).optional(),
  path: z.string().min(1).max(CLIENT_ERROR_LIMITS.path),
});
export type ClientErrorInput = z.infer<typeof clientErrorSchema>;
