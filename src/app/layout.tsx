import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Workbench",
  description: "Localhost-per-project developer workbench on the Claude Agent SDK",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body className="flex h-screen bg-zinc-950 font-sans text-zinc-100 antialiased">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </body>
    </html>
  );
}
