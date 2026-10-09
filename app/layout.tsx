import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Discord Grok Bridge",
  description: "Admin console for the Discord to Grok slash-command bridge.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
