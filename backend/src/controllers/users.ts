/**
 * Users/profiles CRUD (M4). Local multi-profile switcher — no auth, so these are open reads/writes
 * of the `users` table behind the standard error envelope.
 */

import { Request, Response } from 'express';
import { z } from 'zod';

import { asyncHandler, fromZod, invalidId, notFound } from '../middleware/errors';
import { listUsers, getUser, createUser, updateUser, deleteUser } from '../services/users';

const uuidSchema = z.string().uuid();
const createSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  avatarColor: z.string().trim().max(32).optional(),
});
const updateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    avatarColor: z.string().trim().max(32).optional(),
  })
  .refine((v) => v.displayName !== undefined || v.avatarColor !== undefined, {
    message: 'At least one of displayName or avatarColor is required',
  });

export const handleListUsers = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ users: await listUsers() });
});

export const handleGetUser = asyncHandler(async (req: Request, res: Response) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) throw invalidId('Invalid user ID');
  const user = await getUser(id.data);
  if (!user) throw notFound('User not found');
  res.json(user);
});

export const handleCreateUser = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  const user = await createUser(parsed.data.displayName, parsed.data.avatarColor);
  res.status(201).json(user);
});

export const handleUpdateUser = asyncHandler(async (req: Request, res: Response) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) throw invalidId('Invalid user ID');
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw fromZod(parsed.error);
  const user = await updateUser(id.data, parsed.data);
  if (!user) throw notFound('User not found');
  res.json(user);
});

export const handleDeleteUser = asyncHandler(async (req: Request, res: Response) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) throw invalidId('Invalid user ID');
  const deleted = await deleteUser(id.data);
  if (!deleted) throw notFound('User not found');
  res.status(204).send();
});
