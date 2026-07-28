import { z } from "zod";
import type { AnonymousSessionManager } from "../lib/anonymous-session.js";
import { DeviceIdSchema } from "../lib/anonymous-session.js";
import { AppError } from "../lib/errors.js";
import { corsHeaders, validateSiteOrigin, type OriginPolicy } from "../lib/origin.js";
import { withSecurityHeaders } from "../lib/security-headers.js";

const SessionRequestSchema = z.object({ deviceId: DeviceIdSchema }).strict();

export async function postSession(
  request: Request,
  dependencies: { sessions: AnonymousSessionManager; originPolicy: OriginPolicy },
): Promise<Response> {
  try {
    const { origin } = validateSiteOrigin(request, dependencies.originPolicy);
    const input = SessionRequestSchema.parse(await request.json());
    const created = dependencies.sessions.create(input.deviceId);
    return Response.json(
      {
        csrfToken: created.csrfToken,
        sessionExpiresAt: new Date(created.session.expiresAt * 1_000).toISOString(),
      },
      {
        status: 201,
        headers: withSecurityHeaders({
          ...corsHeaders(origin, dependencies.originPolicy),
          "set-cookie": created.cookie,
        }),
      },
    );
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : 400;
    const message =
      error instanceof AppError ? error.userMessage : "The request could not be completed.";
    return Response.json(
      { error: { code: "REQUEST_REJECTED", message } },
      { status, headers: withSecurityHeaders() },
    );
  }
}
