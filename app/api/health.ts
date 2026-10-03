// API routes are server-only. GET /api/health (used by Render's health check)
import { publicRoute } from "@aixjs/aix";

export const GET = publicRoute(() => ({ ok: true, time: new Date().toISOString() }), {
  reason: "Liveness check for the hosting platform; returns no user data.",
});
