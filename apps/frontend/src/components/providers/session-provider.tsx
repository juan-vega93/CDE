"use client";

import { SessionProvider } from "next-auth/react";

export function AppSessionProvider({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider refetchInterval={240} refetchOnWindowFocus>
      {children}
    </SessionProvider>
  );
}