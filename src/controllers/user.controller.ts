import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { userService, UserInput, UserListQuery } from "../services/user.service";
import { AuthRequest } from "../types/AuthRequest";
import { param } from "../utils/expressHandler.util";

export const directory = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.status(200).json({ items: await userService.directory() });
});

export const list = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await userService.list(req.query as UserListQuery);
  res.status(200).json(result);
});

export const getById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await userService.getById(param(req, "id"));
  res.status(200).json(user);
});

export const create = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await userService.create(req.body as UserInput);
  res.status(201).json(user);
});

export const update = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await userService.update(param(req, "id"), req.body as Partial<UserInput>);
  res.status(200).json(user);
});

export const toggleActive = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await userService.toggleActive(param(req, "id"), req.body.isActive, req.user?._id);
  res.status(200).json(user);
});

export const remove = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await userService.remove(param(req, "id"), req.user?._id);
  res.status(200).json(result);
});
