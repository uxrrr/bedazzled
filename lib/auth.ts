import type { Handler, HandlerContext, HandlerEvent, HandlerResponse } from "@netlify/functions";

export interface IdentityUser {
  sub: string;
  email: string;
  app_metadata?: { roles?: string[] };
}

/**
 * Netlify Functions written with the v1 handler signature
 * (`exports.handler = async (event, context) => ...`) get a verified
 * Identity user attached to context.clientContext by the platform itself —
 * the token has already been checked before the function runs.
 * This is unreliable under the newer v2 Request/Response signature, so every
 * function in this project must use the v1 signature and call this helper
 * first, before touching any data.
 */
export function requireUser(context: HandlerContext): IdentityUser {
  const user = context.clientContext?.user as IdentityUser | undefined;
  if (!user || !user.sub || !user.email) {
    throw new AuthError();
  }
  return user;
}

export class AuthError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

export function unauthorizedResponse() {
  return {
    statusCode: 401,
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify({ error: "Unauthorized" }),
  };
}

export function errorResponse(statusCode: number, message: string): HandlerResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ error: message }),
  };
}

/** Every write function requires this header; centralized so none can forget it. */
export function requireIfMatch(event: HandlerEvent): string | HandlerResponse {
  const ifMatch = event.headers["if-match"] || event.headers["If-Match"];
  if (!ifMatch) {
    return errorResponse(428, "If-Match header required");
  }
  return ifMatch;
}

/**
 * Wraps a function handler so the auth check can't be forgotten — every
 * Netlify Function in this project should be defined via withAuth() rather
 * than repeating the requireUser()/try-catch boilerplate itself. Also catches
 * any error the wrapped handler throws (e.g. JSON.parse on a malformed body)
 * so it becomes a clean error response instead of an unhandled exception.
 */
export function withAuth(
  fn: (user: IdentityUser, event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>
): Handler {
  return async (event, context) => {
    let user: IdentityUser;
    try {
      user = requireUser(context);
    } catch {
      return unauthorizedResponse();
    }
    try {
      return await fn(user, event, context);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Invalid request";
      return errorResponse(400, message);
    }
  };
}
