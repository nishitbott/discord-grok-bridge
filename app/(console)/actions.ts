"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { DETACH_HEADER } from "@/lib/gateway/constants";
import { productionOrigin } from "@/lib/gateway/origin";
import { SESSION_COOKIE, sha256Hex } from "@/lib/session";
import { createApiKey, isStoreConfigured, revokeApiKey } from "@/lib/store";
import { timingSafeEqualString } from "@/lib/timing";

export interface CreateKeyState {
  rawKey: string;
  error: string;
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  redirect("/login");
}

export async function createKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 64) {
    return { rawKey: "", error: "Enter a name up to 64 characters." };
  }
  if (!isStoreConfigured()) {
    return { rawKey: "", error: "Redis is not configured." };
  }

  try {
    const rawKey = await createApiKey(name);
    revalidatePath("/settings");
    return { rawKey, error: "" };
  } catch {
    return { rawKey: "", error: "Could not create the key." };
  }
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const hash = String(formData.get("hash") ?? "");
  await revokeApiKey(hash);
  revalidatePath("/settings");
}

export interface StartGatewayState {
  message: string;
}

async function isAdminSession(): Promise<boolean> {
  const adminKey = process.env.ADMIN_KEY ?? "";
  if (!adminKey) {
    return false;
  }
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value ?? "";
  const expected = await sha256Hex(adminKey);
  return timingSafeEqualString(session, expected);
}

async function gatewayRunUrl(): Promise<string> {
  const production = productionOrigin();
  if (production) {
    return `${production}/api/gateway/run`;
  }
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (!host) {
    return "http://localhost:3000/api/gateway/run";
  }
  const forwarded = headerStore.get("x-forwarded-proto");
  const proto =
    forwarded ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}/api/gateway/run`;
}

export async function startGatewayAction(
  prev: StartGatewayState,
  formData: FormData,
): Promise<StartGatewayState> {
  if (String(formData.get("intent") ?? "") !== "start") {
    return prev;
  }
  if (!(await isAdminSession())) {
    return { message: "Not authorized." };
  }
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!secret) {
    return { message: "CRON_SECRET is not set." };
  }
  if (!isStoreConfigured()) {
    return { message: "Redis is not configured." };
  }

  try {
    const response = await fetch(await gatewayRunUrl(), {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${secret}`,
        [DETACH_HEADER]: "1",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => null)) as {
      skipped?: boolean;
      accepted?: boolean;
    } | null;
    if (payload?.skipped) {
      revalidatePath("/");
      return { message: "Gateway is already running." };
    }
    if (response.ok && payload?.accepted) {
      revalidatePath("/");
      return {
        message: "Gateway started. This window runs for about five minutes, then starts the next one.",
      };
    }
    return { message: "Gateway did not start." };
  } catch {
    return { message: "Could not reach the gateway." };
  }
}
