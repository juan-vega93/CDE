"use client";

import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded bg-red-700 text-sm font-bold text-white">
            TYPSA
          </div>

          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Portal CDE
            </h1>
            <p className="text-sm text-slate-500">
              Gestión de proyectos y equipos
            </p>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-6">
          <h2 className="text-2xl font-semibold text-slate-900">
            Acceso al portal
          </h2>

          <p className="mt-2 text-sm text-slate-600">
            Ingresa con tu cuenta corporativa para continuar.
          </p>

          <button
            type="button"
            onClick={() =>
              signIn("keycloak", {
                callbackUrl: "/admin/project-cards"
              })
            }
            className="mt-6 w-full rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
          >
            Ingresar
          </button>
        </div>
      </section>
    </main>
  );
}