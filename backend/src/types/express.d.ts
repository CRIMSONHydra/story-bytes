/**
 * Express type augmentation (M4). `identity` middleware resolves the caller's profile from the
 * `x-user-id` header and stores it on `req.userId` for downstream user-scoped controllers.
 */

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
