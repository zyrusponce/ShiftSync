import { Router } from "express";
import type { Deps } from "../app";
import { parse, rateLimit } from "../http";
import { credentialsSchema, refreshSchema, signUpSchema } from "../schemas";

export function authRoutes(deps: Deps) {
  const router = Router();
  const limit = rateLimit(10, 60_000);
  router.post("/signup", limit, async (req, res) => {
    const body = parse(signUpSchema, req.body);
    const result = await deps.auth.signUp(
      body.email,
      body.password,
      body.displayName,
    );
    res.status(result.status === "signed_in" ? 201 : 202).json(result);
  });
  router.post("/login", limit, async (req, res) => {
    const body = parse(credentialsSchema, req.body);
    res.json(await deps.auth.signIn(body.email, body.password));
  });
  router.post("/refresh", rateLimit(30, 60_000), async (req, res) => {
    const body = parse(refreshSchema, req.body);
    res.json(await deps.auth.refresh(body.refreshToken));
  });
  router.post("/logout", async (req, res) => {
    const token = req.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (token) await deps.auth.signOut(token);
    res.status(204).end();
  });
  return router;
}
