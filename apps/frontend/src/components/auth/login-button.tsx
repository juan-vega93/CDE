"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "U";
  const parts = source.split(" ").filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}


export function LoginButton() {
  const { data: session, status } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  async function handleLogout() {
    setIsOpen(false);

    const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL;
    const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM;
    const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID;

    const idToken =
      typeof session?.idToken === "string" ? session.idToken : "";

    const redirectUrl = `${window.location.origin}/login`;

    if (!keycloakUrl || !realm || !clientId || !idToken) {
      await signOut({
        callbackUrl: "/login"
      });

      return;
    }

    const logoutUrl = new URL(
      `${keycloakUrl}/realms/${realm}/protocol/openid-connect/logout`
    );

    logoutUrl.searchParams.set("id_token_hint", idToken);
    logoutUrl.searchParams.set("post_logout_redirect_uri", redirectUrl);

    await signOut({
      redirect: false
    });

    window.location.href = logoutUrl.toString();
  }

 

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node;

      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;

      setIsOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleMouseDown);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 animate-pulse rounded-full bg-gray-200" />
      </div>
    );
  }

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => signIn("keycloak")}
        className="rounded-lg bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
      >
        Iniciar sesión
      </button>
    );
  }

  const fullName = session.user?.name || "Usuario autenticado";
  const email = session.user?.email || "";
  const roles = session.roles || [];
  const primaryRole =
    roles.find((role: string) =>
      [
        "bim-manager",
        "bim-coordinator",
        "discipline-lead",
        "doc-controller",
        "viewer"
      ].includes(role)
    ) || "sin rol";

  const initials = getInitials(session.user?.name, session.user?.email);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-red-700 text-xs font-semibold text-white shadow-sm hover:bg-red-800"
        style={{ lineHeight: 1 }}
        aria-label="Abrir menú de usuario"
        aria-expanded={isOpen}
      >
        {initials}
      </button>

      {isOpen ? (
        <>
          <div className="fixed inset-0 z-[1990] bg-transparent" />

          <div
            ref={panelRef}
            className="fixed right-5 top-16 z-[2000] w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center gap-3 border-b border-slate-100 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-700 text-sm font-semibold text-white">
                {initials}
              </div>

              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {fullName}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {email}
                </div>
              </div>
            </div>

            <div className="space-y-2 p-4 text-sm">
              <div className="flex items-center justify-between gap-3 rounded bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Rol</span>
                <span className="truncate font-semibold text-slate-800">
                  {primaryRole}
                </span>
              </div>

              <button
                type="button"
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Mi perfil
              </button>

              <button
                type="button"
                onClick={() => void handleLogout()}
                className="w-full rounded bg-red-700 px-3 py-2 text-left text-sm font-semibold text-white hover:bg-red-800"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
