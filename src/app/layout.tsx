import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Looptracker OS",
  description: "A Metacognitive Operating System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.className} app-shell antialiased bg-gray-950 text-gray-100 selection:bg-violet-500/30 selection:text-white`}
      >
        {/* Background: layered gradients + subtle vignette */}
        <div className="fixed inset-0 -z-10 overflow-hidden">
          {/* subtle radial glow */}
          <div className="absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-r from-cyan-500/10 via-violet-500/10 to-fuchsia-500/10 blur-3xl" />
          {/* vertical fade */}
          <div className="absolute inset-0 bg-gradient-to-b from-gray-900/40 via-gray-950 to-black" />
          {/* vignette mask */}
          <div className="absolute inset-0 [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)]" />
        </div>

        {/* App (flex column shell lives on body via .app-shell) */}
        <AppProvider>
          <div className="app-main">{children}</div>
        </AppProvider>
      </body>
    </html>
  );
}
