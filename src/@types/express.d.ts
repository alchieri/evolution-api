import { Multer } from 'multer';

declare global {
  namespace Express {
    interface Request {
      file?: Multer.File;
      authInfo?: {
        requestedBy: string;
        scope: 'global' | 'instance';
        instanceName?: string;
      };
    }
  }
}
