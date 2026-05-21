"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { PortalShell } from "@/components/layout/portal-shell";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { getWorkPackageById, updateWorkPackageStatus } from "@/services/documents.service";
import type { WorkPackage } from "@/types/documents";

type StatusConfig = {
  label: string;
  color: string;
  dotColor: string;
  transitions: string[];
};

const STATUS_MAP: Record<string, StatusConfig> = {
  new: {
    label: "Nuevo",
    color: "bg-slate-100 text-slate-700 border-slate-300",
    dotColor: "bg-slate-400",
    transitions: ["in_progress", "in_review", "closed"]
  },
  in_progress: {
    label: "En progreso",
    color: "bg-blue-50 text-blue-700 border-blue-300",
    dotColor: "bg-blue-500",
    transitions: ["in_review", "closed"]
  },
  in_review: {
    label: "En revisión",
    color: "bg-amber-50 text-amber-700 border-amber-300",
    dotColor: "bg-amber-500",
    transitions: ["approved", "rejected"]
  },
  approved: {
    label: "Aprobado",
    color: "bg-green-50 text-green-700 border-green-300",
    dotColor: "bg-green-500",
    transitions: ["closed"]
  },
  rejected: {
    label: "Rechazado",
    color: "bg-red-50 text-red-700 border-red-300",
    dotColor: "bg-red-500",
    transitions: ["in_progress", "in_review"]
  },
  closed: {
    label: "Cerrado",
    color: "bg-purple-50 text-purple-700 border-purple-300",
    dotColor: "bg-purple-500",
    transitions: ["new"]
  }
};

export default function WorkflowDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const projectCode = searchParams.get("projectCode");

  const backUrl = projectCode
    ? `/workflows?projectCode=${encodeURIComponent(projectCode)}`
    : "/workflows";

  const [workflow, setWorkflow] = useState<WorkPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWorkflow = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getWorkPackageById(id);
      setWorkflow(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar el workflow");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      setUpdating(newStatus);
      setError(null);
      const updated = await updateWorkPackageStatus(id, newStatus);
      setWorkflow(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al actualizar el estado");
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <PortalShell>
        <div className="mx-auto max-w-5xl">
          <div className="mt-8 flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-red-700" />
            <span className="ml-3 text-sm text-slate-500">Cargando...</span>
          </div>
        </div>
      </PortalShell>
    );
  }

  if (error && !workflow) {
    return (
      <PortalShell>
        <div className="mx-auto max-w-5xl">
          <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-red-700">{error}</p>
            <button
              onClick={loadWorkflow}
              className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
            >
              Reintentar
            </button>
          </div>
        </div>
      </PortalShell>
    );
  }

  if (!workflow) {
    return (
      <PortalShell>
        <div className="mx-auto max-w-5xl">
          <div className="mt-8 text-center">
            <p className="text-slate-500">Work package no encontrado</p>
            <Link
              href="/workflows"
              className="mt-4 inline-block rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Volver a workflows
            </Link>
          </div>
        </div>
      </PortalShell>
    );
  }

  const currentStatus = STATUS_MAP[workflow.status] ?? STATUS_MAP.new;
  const possibleTransitions = currentStatus.transitions;

  return (
    <PortalShell>
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs
          items={[
            { label: "Inicio", href: "/" },
            { label: "Workflows", href: backUrl },
            { label: `WP #${workflow.id}` }
          ]}
        />

        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Detalle de workflow</h1>
            <p className="mt-1 text-sm text-gray-600">
              Work Package #{workflow.id}
            </p>
          </div>

          <Link
            href={backUrl}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Volver
          </Link>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Estado actual */}
        <div className="mt-6 rounded-xl border bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-slate-500">Estado actual</h2>
              <div className="mt-2 flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${currentStatus.dotColor}`} />
                <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${currentStatus.color}`}>
                  {currentStatus.label}
                </span>
              </div>
            </div>
          </div>

          {/* Transiciones disponibles */}
          {possibleTransitions.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-6">
              <h3 className="text-sm font-medium text-slate-500">
                Cambiar estado
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {possibleTransitions.map((nextStatus) => {
                  const nextCfg = STATUS_MAP[nextStatus];
                  const isUpdating = updating === nextStatus;

                  return (
                    <button
                      key={nextStatus}
                      onClick={() => handleStatusChange(nextStatus)}
                      disabled={updating !== null}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${nextCfg.color} hover:shadow-sm`}
                    >
                      {isUpdating && (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      )}
                      {isUpdating ? "Actualizando..." : `→ ${nextCfg.label}`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Información del Work Package */}
        <div className="mt-6 rounded-xl border bg-white p-6">
          <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <dt className="text-sm text-gray-500">ID</dt>
              <dd className="font-medium">#{workflow.id}</dd>
            </div>

            <div>
              <dt className="text-sm text-gray-500">Estado</dt>
              <dd className="font-medium">
                <span className={`inline-block h-2 w-2 rounded-full ${currentStatus.dotColor} mr-1.5`} />
                {currentStatus.label}
              </dd>
            </div>

            <div className="md:col-span-2">
              <dt className="text-sm text-gray-500">Asunto</dt>
              <dd className="font-medium">{workflow.subject}</dd>
            </div>

            {workflow.description && (
              <div className="md:col-span-2">
                <dt className="text-sm text-gray-500">Descripción</dt>
                <dd className="whitespace-pre-wrap text-sm text-slate-700">
                  {workflow.description}
                </dd>
              </div>
            )}

            {workflow.assigneeId && (
              <div>
                <dt className="text-sm text-gray-500">Responsable</dt>
                <dd>{workflow.assigneeId ?? "-"}</dd>
              </div>
            )}

            {workflow.dueDate && (
              <div>
                <dt className="text-sm text-gray-500">Fecha objetivo</dt>
                <dd>{new Date(workflow.dueDate).toLocaleDateString()}</dd>
              </div>
            )}

            <div>
              <dt className="text-sm text-gray-500">Creado</dt>
              <dd>{new Date(workflow.createdAt).toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      </div>
    </PortalShell>
  );
}