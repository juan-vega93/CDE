"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IfcViewerClient } from "./ifc-viewer-client";
import { PortalShell } from "@/components/layout/portal-shell";
import {
  resolveViewerSource,
  type ViewerSource
} from "@/features/viewer-ifc/lib/resolve-viewer-source";

function toArray(value: string | null): string[] {
  if (!value) return [];
  return [value];
}

function cleanValue(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function isCurrentVersion(documentVersionId?: string) {
  const value = documentVersionId?.trim();
  return !value || value === "current";
}

function shouldRequireFrag(documentPath?: string, documentVersionId?: string) {
  const path = documentPath?.trim().toLowerCase();
  return Boolean(path?.endsWith(".ifc") && isCurrentVersion(documentVersionId));
}

function buildDocumentsHref(projectCode: string, documentPath?: string) {
  const params = new URLSearchParams({ projectCode });
  const cleanPath = documentPath?.trim();

  if (cleanPath) {
    const lastSlashIndex = cleanPath.lastIndexOf("/");
    const parentPath = lastSlashIndex > 0 ? cleanPath.slice(0, lastSlashIndex) : `/${projectCode}`;
    params.set("path", parentPath);
  }

  return `/documents?${params.toString()}`;
}

export function ViewerPageClient() {
  const searchParams = useSearchParams();
  const [sources, setSources] = useState<ViewerSource[]>([]);
  const [status, setStatus] = useState("Resolviendo modelo...");

  const documentPaths = useMemo(
    () => searchParams.getAll("documentPath").filter(Boolean),
    [searchParams]
  );
  const documentNames = useMemo(
    () => searchParams.getAll("documentName").filter(Boolean),
    [searchParams]
  );
  const documentIds = useMemo(
    () => searchParams.getAll("documentId").filter(Boolean),
    [searchParams]
  );
  const ifcUrls = useMemo(
    () => searchParams.getAll("ifcUrl").filter(Boolean),
    [searchParams]
  );
  const documentVersionIds = useMemo(
    () => searchParams.getAll("documentVersionId").filter(Boolean),
    [searchParams]
  );

  const firstDocumentPath = documentPaths[0]?.trim() || "";
  const projectCodeFromUrl = searchParams.get("projectCode")?.trim().toUpperCase() || "";
  const projectCodeFromPath =
    firstDocumentPath
      .split("/")
      .filter(Boolean)[0]
      ?.trim()
      .toUpperCase() || "";
  const projectCode = projectCodeFromUrl || projectCodeFromPath;

  useEffect(() => {
    let cancelled = false;

    async function resolveSources() {
      const hasViewerSource =
        documentPaths.length > 0 || documentIds.length > 0 || ifcUrls.length > 0;

      if (!hasViewerSource) {
        setSources([]);
        setStatus("");
        return;
      }

      setStatus("Resolviendo modelo...");

      try {
        const maxLength = Math.max(
          documentPaths.length,
          documentNames.length,
          documentIds.length,
          ifcUrls.length,
          documentVersionIds.length,
          1
        );

        const resolvedSources: ViewerSource[] = [];

        for (let index = 0; index < maxLength; index += 1) {
          if (cancelled) return;

          const documentPath = cleanValue(documentPaths[index]);
          const documentName = cleanValue(documentNames[index]);
          const documentVersionId = cleanValue(documentVersionIds[index]);
          const requireFrag = shouldRequireFrag(documentPath, documentVersionId);

          setStatus(
            maxLength > 1
              ? `Resolviendo modelo ${index + 1} de ${maxLength}...`
              : requireFrag
                ? "Preparando modelo FRAG..."
                : "Resolviendo modelo..."
          );

          const source = await resolveViewerSource({
            ...(cleanValue(documentIds[index])
              ? { documentId: cleanValue(documentIds[index]) }
              : {}),
            ...(cleanValue(ifcUrls[index])
              ? { ifcUrl: cleanValue(ifcUrls[index]) }
              : {}),
            ...(documentPath ? { documentPath } : {}),
            ...(documentName ? { documentName } : {}),
            ...(documentVersionId ? { documentVersionId } : {}),
            requireFrag
          });

          resolvedSources.push(source);
        }

        if (!cancelled) {
          setSources(resolvedSources);
          setStatus("");
        }
      } catch (error) {
        if (!cancelled) {
          setSources([]);
          setStatus(
            error instanceof Error
              ? `Error: ${error.message}`
              : "Error resolviendo modelo"
          );
        }
      }
    }

    void resolveSources();

    return () => {
      cancelled = true;
    };
  }, [documentIds, documentNames, documentPaths, documentVersionIds, ifcUrls]);

  if (status) {
    const isError = status.startsWith("Error:");

    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 px-6 text-slate-700">
        <section className="w-full max-w-xl rounded border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {isError ? "Visor BIM" : "Cargando"}
          </p>
          <h1 className="mt-2 text-xl font-semibold text-slate-950">
            {isError ? "No se pudo abrir el modelo" : status}
          </h1>
          {isError ? (
            <>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {status.replace(/^Error:\s*/, "")}
              </p>
              {projectCode ? (
                <Link
                  href={buildDocumentsHref(projectCode, firstDocumentPath)}
                  className="mt-5 inline-flex rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
                >
                  Volver a documentos
                </Link>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              Preparando fuentes del visor.
            </p>
          )}
        </section>
      </div>
    );
  }

  if (!projectCode) {
    return (
      <PortalShell>
        <section className="rounded border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Contexto requerido
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            Selecciona un proyecto
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            El visor BIM queda aislado por proyecto para federar modelos,
            incidencias y vistas sin contaminar otros contextos.
          </p>
          <Link
            href="/admin/project-cards"
            className="mt-5 inline-flex rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
          >
            Volver a proyectos
          </Link>
        </section>
      </PortalShell>
    );
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-slate-100">
      <IfcViewerClient
        sources={sources}
        documentNames={documentNames.length ? documentNames : toArray(searchParams.get("documentName"))}
        documentPaths={documentPaths.length ? documentPaths : toArray(searchParams.get("documentPath"))}
        projectCode={projectCode}
      />
    </div>
  );
}
