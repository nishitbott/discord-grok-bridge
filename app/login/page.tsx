import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { constantTimeEqual, SESSION_COOKIE, sha256Hex } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const adminKey = process.env.ADMIN_KEY;
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (adminKey && session && constantTimeEqual(session, await sha256Hex(adminKey))) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Discord Mention Bridge</CardTitle>
          <CardDescription>Sign in with the admin key to view the console.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
