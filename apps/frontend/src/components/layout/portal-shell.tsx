import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

type PortalShellProps = {
  children: ReactNode;
};

export function PortalShell({ children }: PortalShellProps) {
  return (
    <div className="h-screen overflow-hidden bg-slate-100 text-slate-900">
      <Topbar />

      <div className="flex h-[calc(100vh-4rem)] min-h-0">
        <Sidebar />

        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1500px] px-8 py-7">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}