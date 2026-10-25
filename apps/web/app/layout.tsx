import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { ServiceWorker } from "@/components/service-worker";
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
  // Installed to the Home Screen (iOS needs this for push notifications).
  appleWebApp: { capable: true, title: "Synapse", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F4F1EA",
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
        <ServiceWorker />
      </body>
    </html>
  );
}
