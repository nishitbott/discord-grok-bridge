"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, sha256Hex } from "@/lib/session";
import { timingSafeEqualString } from "@/lib/timing";

export interface LoginState {
  error: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const submitted = String(formData.get("key") ?? "");
  const adminKey = process.env.ADMIN_KEY ?? "";

  if (!adminKey || !timingSafeEqualString(submitted, adminKey)) {
    return { error: "Invalid admin key" };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, await sha256Hex(adminKey), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  redirect("/");
}
