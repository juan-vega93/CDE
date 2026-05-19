import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

type PortalShellProps = {
  children: ReactNode;
};

export function PortalShell({ children }: PortalShellProps) {
  return (
    <div className="h-screen overflow-hidden bg-gray-50">
      <div className="flex h-full min-h-0">
        <Sidebar />

        <div className="flex min-h-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 min-h-0 overflow-hidden p-3">{children}</main>
        </div>
      </div>
    </div>
  );
}