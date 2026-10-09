import Link from "next/link";

import { logoutAction } from "@/app/(console)/actions";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <p className="text-sm font-semibold tracking-tight">Discord Grok Bridge</p>
          <nav className="flex items-center gap-1" aria-label="Console">
            <Button asChild variant="ghost" size="sm">
              <Link href="/">Status</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings">Settings</Link>
            </Button>
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm">
                Log out
              </Button>
            </form>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6">{children}</div>
    </div>
  );
}
