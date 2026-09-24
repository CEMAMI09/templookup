import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors.ts";

export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.staffId) {
    next(new AppError(401, "UNAUTHORIZED", "Sign in to continue."));
    return;
  }
  next();
}

export function requireMutationHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.get("x-requested-with") !== "evoq") {
    next(new AppError(400, "VALIDATION", "This action could not be verified. Reload the page and try again."));
    return;
  }
  next();
}
