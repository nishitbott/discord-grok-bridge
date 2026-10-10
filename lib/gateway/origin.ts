export function productionOrigin(): string | null {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (!production) {
    return null;
  }
  const host = production.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!host) {
    return null;
  }
  return `https://${host}`;
}

export function originFromRequest(request: Request): string {
  return productionOrigin() ?? new URL(request.url).origin;
}
