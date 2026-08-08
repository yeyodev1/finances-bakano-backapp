import { Request } from "express";

export type UserRole = "superadmin" | "admin" | "viewer";

export interface JwtPayload {
  _id: string;
  email: string;
  name?: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
  file?: Express.Multer.File;
  files?: Express.Multer.File[];
}
