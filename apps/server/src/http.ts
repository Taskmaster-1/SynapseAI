import { ConflictError, ForbiddenError, NotFoundError } from "@synapse/db";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { ZodError, type z } from "zod";
import { log } from "./log";
import type { Services } from "./services";

export interface AppEnv {
  Variables: {
    services: Services;
    user: { id: string; name: string; email: string };
  };
}

export function apiError(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500,
  code: string,
  message: string,
): never {
  throw new HTTPException(status, { res: Response.json({ error: { code, message } }, { status }) });
}

/** Requires a Better Auth session; exposes the user on the context. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = await c.var.services.auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) apiError(401, "unauthorized", "Sign in to continue.");
  c.set("user", { id: session.user.id, name: session.user.name, email: session.user.email });
  await next();
});

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    apiError(400, "invalid_json", "Request body must be JSON.");
  }
  return schema.parse(raw);
}

export function onError(err: Error, c: Context): Response {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "invalid_request",
          message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        },
      },
      422,
    );
  }
  if (err instanceof NotFoundError)
    return c.json({ error: { code: "not_found", message: err.message } }, 404);
  // e.g. a member deciding a call their team reserved for an admin.
  if (err instanceof ForbiddenError)
    return c.json({ error: { code: "forbidden", message: err.message } }, 403);
  if (err instanceof ConflictError)
    return c.json({ error: { code: "conflict", message: err.message } }, 409);
  log.error("unhandled", { path: c.req.path, error: err.stack ?? String(err) });
  return c.json({ error: { code: "internal", message: "Something went wrong." } }, 500);
}
