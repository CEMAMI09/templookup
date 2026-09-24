import { Router } from "express";
import type { AppConfig } from "../config.ts";
import { authenticateStaff, listStaff } from "../auth/staff-store.ts";
import { AppError } from "../errors.ts";
import { requireMutationHeader, requireStaff } from "../middleware/auth.ts";
import type { Crm } from "../coto/types.ts";

const attempts = new Map<string, { count: number; resetAt: number }>();

export function authRouter(config: AppConfig, crm: Crm) {
  const router = Router();

  router.get("/status", async (_req, res) => {
    const staff = await listStaff(config.staffFile);
    res.json({ staffConfigured: staff.length > 0 });
  });

  router.get("/me", async (req, res) => {
    if (!req.session.staffId) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Sign in to continue." } });
      return;
    }
    const catalog = await crm.getFieldCatalog();
    res.json({
      staff: {
        name: req.session.staffName,
        email: req.session.staffEmail,
      },
      crmMode: config.crmMode,
      fields: {
        title: Boolean(catalog.titleFieldId),
        npi: Boolean(catalog.npiFieldId),
      },
      staffConfigured: (await listStaff(config.staffFile)).length > 0,
    });
  });

  router.post("/login", requireMutationHeader, async (req, res, next) => {
    try {
      const ip = req.ip ?? "unknown";
      if (isLimited(ip)) {
        throw new AppError(429, "CRM_RATE_LIMIT", "Too many sign-in attempts. Wait a few minutes and try again.");
      }
      const email = typeof req.body?.email === "string" ? req.body.email : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const staff = await authenticateStaff(config.staffFile, email, password);
      if (!staff) {
        recordFailure(ip);
        throw new AppError(401, "UNAUTHORIZED", "Email or password is incorrect.");
      }
      attempts.delete(ip);
      req.session.staffId = staff.id;
      req.session.staffName = staff.name;
      req.session.staffEmail = staff.email;
      res.json({ staff: { name: staff.name, email: staff.email }, crmMode: config.crmMode });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", requireStaff, requireMutationHeader, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        next(new AppError(500, "CRM_UNAVAILABLE", "Sign out did not complete. Try again."));
        return;
      }
      res.clearCookie("aaoptom.sid");
      res.json({ ok: true });
    });
  });

  return router;
}

function isLimited(ip: string): boolean {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= 8;
}

function recordFailure(ip: string) {
  const current = attempts.get(ip);
  if (!current || current.resetAt < Date.now()) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
    return;
  }
  current.count += 1;
}
