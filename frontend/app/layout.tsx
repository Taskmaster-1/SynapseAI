import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "SynapseAI — Your Intelligent Workspace Agent",
  description: "AI-powered agent that manages your email, calendar, Slack, GitHub and more. Work smarter, not harder.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" data-scroll-behavior="smooth">
      <body className={`${inter.variable} font-sans antialiased bg-[#030303] text-white`}>
        {children}
      </body>
    </html>
  );
}
