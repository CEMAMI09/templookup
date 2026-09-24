import "express-session";

declare module "express-session" {
  interface SessionData {
    staffId: string;
    staffName: string;
    staffEmail: string;
  }
}
