import { WAKE_TIMEOUT_MS } from "./config.js";
import type { Config } from "./config.js";
import { logWarn, redact } from "./log.js";
import type { WakePayload } from "./types.js";

export interface WakePostResult {
  ok: boolean;
  status: number | null;
  retryable: boolean;
  error: string | null;
}

export function isRetryableStatus(status: number | null): boolean {
  if (status === null) {
    return true;
  }
  return status === 400 || status === 429 || status >= 500;
}

export async function postWake(payload: WakePayload, config: Config): Promise<WakePostResult> {
  if (!config.wakeUrl || !config.wakeKey) {
    return {
      ok: false,
      status: null,
      retryable: false,
      error: "wake endpoint is not configured",
    };
  }

  try {
    const response = await fetch(config.wakeUrl, {
      method: "POST",
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.wakeKey}`,
        "X-Automation-Key": config.wakeKey,
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.text()).slice(0, 8000);
    if (!response.ok) {
      logWarn("wake response", {
        messageId: payload.message_id,
        status: response.status,
        body: redact(body),
      });
      return {
        ok: false,
        status: response.status,
        retryable: isRetryableStatus(response.status),
        error: `HTTP ${response.status}`,
      };
    }

    return { ok: true, status: response.status, retryable: false, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    logWarn("wake request failed", {
      messageId: payload.message_id,
      error: redact(message),
    });
    return {
      ok: false,
      status: null,
      retryable: true,
      error: "network error",
    };
  }
}
