import { LoginButton } from "@/components/auth/login-button";

export function Topbar() {
  return (
    <header className="relative z-40 flex h-14 items-center justify-between bg-white px-6 py-2 shadow-sm">
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-gray-500">MVP Portal CDE</h2>
      </div>

      <div className="ml-6 flex shrink-0 items-center">
        <LoginButton />
      </div>
    </header>
  );
}