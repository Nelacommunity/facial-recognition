// API routes are server-only. GET /api/health
export function GET() {
  return { ok: true, time: new Date().toISOString() };
}
