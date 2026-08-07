import type { Metadata } from "next";
import "./globals.css";
import { AppSessionProvider } from "@/components/providers/session-provider";

export const metadata: Metadata = {
  title: "Create Portal",
  description: "CDE BIM Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="h-full flex flex-col overflow-hidden">
        <AppSessionProvider>{children}</AppSessionProvider>
      </body>
    </html>
  );
}
