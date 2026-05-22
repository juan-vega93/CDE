import { LoginButton } from "@/components/auth/login-button";
import Image from "next/image";

export function Topbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5 shadow-sm">
      <div className="flex items-center gap-3">
        <Image
          src="/brand/typsa-logo.png"
          alt="TYPSA"
          width={44}
          height={44}
          className="h-11 w-11 rounded object-contain"
          priority
        />

        <div>
          <div className="text-lg font-semibold leading-tight text-slate-900">
            TYPSA Nexus
          </div>
          <div className="text-xs text-slate-500">
            Integrated BIM Collaboration Platform
          </div>
        </div>
      </div>

      <div className="ml-6 flex shrink-0 items-center">
        <LoginButton />
      </div>
    </header>
  );
}