import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import "./globals.css";

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Synapse", template: "%s · Synapse" },
  description: "An agent workspace: hand off tasks, watch them happen, approve what acts.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F5F1" },
    { media: "(prefers-color-scheme: dark)", color: "#0F0F0E" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={serif.variable} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint so there's no flash. Static string. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant inline script */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
