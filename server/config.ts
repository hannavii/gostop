type Environment = Record<string, string | undefined>;

export function readServerConfig(env: Environment = process.env) {
  const production = env.NODE_ENV === "production";
  const rawPort = env.PORT ?? "3001";
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const rawOrigins = env.ALLOWED_ORIGINS ?? (production ? "" : "http://localhost:5173,http://127.0.0.1:5173");
  const allowedOrigins = rawOrigins.split(",").map(value => value.trim());
  if (allowedOrigins.some(value => {
    try {
      const url = new URL(value);
      return !["http:", "https:"].includes(url.protocol) || url.origin !== value || value.includes("*");
    } catch { return true; }
  })) throw new Error("ALLOWED_ORIGINS must contain exact HTTP(S) origins separated by commas (no paths or wildcards)");
  return {
    port,
    host: env.HOST?.trim() || (production ? "0.0.0.0" : "127.0.0.1"),
    allowedOrigins,
    allowMissingOrigin: !production,
  };
}
