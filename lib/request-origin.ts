/** Next may reconstruct request.url with localhost; the Host header preserves the requested domain. */
export function isSameOrigin(request: Pick<Request, "url" | "headers">, env: NodeJS.ProcessEnv = process.env): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") || url.host;
    if (!/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::[0-9]+)?$/i.test(host)) return false;
    const forwarded = env.VERCEL ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : undefined;
    const protocol = forwarded === "https" || forwarded === "http" ? `${forwarded}:` : url.protocol;
    if (protocol !== "http:" && protocol !== "https:") return false;
    return origin === new URL(`${protocol}//${host}`).origin;
  } catch { return false; }
}
