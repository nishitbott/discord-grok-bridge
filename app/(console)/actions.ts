"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE } from "@/lib/session";
import { createApiKey, isStoreConfigured, revokeApiKey } from "@/lib/store";

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
