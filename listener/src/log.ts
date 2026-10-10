const secrets: string[] = [];

export function registerSecrets(values: Array<string | null | undefined>): void {
  for (const value of values) {
    if (!value || value.length < 8) {
      continue;
    }
    if (!secrets.includes(value)) {
      secrets.push(value);
    }
  }
}

export function redact(value: string): string {
  let out = value.replace(/\s+/g, " ").trim();
  for (const secret of secrets) {
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  if (out.length > 1000) {
    return `${out.slice(0, 1000)}…`;
  }
  return out;
}

export function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return "unknown error";
}

function format(
  level: string,
  message: string,
  fields?: Record<string, string | number | boolean | null>,
): string {
  const parts = ["[listener]", level, redact(message)];
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      const rendered = typeof value === "string" ? redact(value) : String(value);
      parts.push(`${key}=${rendered}`);
    }
  }
  return parts.join(" ");
}

export function logInfo(
  message: string,
  fields?: Record<string, string | number | boolean | null>,
): void {
  console.log(format("info", message, fields));
}

export function logWarn(
  message: string,
  fields?: Record<string, string | number | boolean | null>,
): void {
  console.warn(format("warn", message, fields));
}

export function logError(message: string, error?: unknown): void {
  if (error === undefined) {
    console.error(format("error", message));
    return;
  }
  console.error(format("error", message, { error: errorText(error) }));
}
