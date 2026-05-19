"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "U";
  const parts = source.split(" ").filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

type CsrfResponse = {
  csrfToken?: string;
};

export function LoginButton() {
  const { data: session, status } = useSession();
  const [csrfToken, setCsrfToken] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    async function loadCsrfToken() {
      try {
        const response = await fetch("/api/auth/csrf", {
          method: "GET",
          credentials: "include"
        });

        const data = (await response.json()) as CsrfResponse;
        setCsrfToken(data.csrfToken || "");
      } catch (error) {
        console.error("[login-button] csrf load error:", error);
      }
    }

    void loadCsrfToken();
  }, []);

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
        className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-xs font-semibold text-gray-700 hover:bg-gray-200"
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
            className="fixed right-6 top-16 z-[2000] w-72 rounded-2xl border border-gray-200 bg-white shadow-2xl"
          >
            <div className="px-5 pt-5 pb-4">
              <p className="text-sm font-semibold text-gray-900">
                {fullName}
              </p>

              <p className="mt-1 text-xs text-gray-500">
                {email}
              </p>

              <div className="mt-3">
                <span className="inline-block rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                  {primaryRole}
                </span>
              </div>
            </div>
            <div className="mx-4 border-t border-gray-100" />

            <div className="p-4">
              <form method="POST" action="/api/auth/signout">
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="callbackUrl" value="/login" />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  Cerrar sesión
                </button>
              </form>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}