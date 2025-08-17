import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext"; // <-- IMPORT THE PROVIDER

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
      <body className={inter.className}>
        {/* WRAP THE {children} WITH THE PROVIDER */}
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}