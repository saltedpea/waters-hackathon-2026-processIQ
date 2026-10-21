import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Nexora" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
