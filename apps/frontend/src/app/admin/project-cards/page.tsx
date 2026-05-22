"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  addProjectMember,
  createOrUpdateProjectCard,  
  getProjectCards,
  archiveProjectCard,
  getProjectMembers,
  provisionProjectCard,
  removeProjectMember,
  updateProjectMember,
  createProjectCardFromPortal,
  updateProjectCard,
  hardDeleteProjectCard,
  type ProjectStatus,
  type CreateProjectMemberInput,
  type ProjectCard,
  type ProjectMember,
  type PortalRoleKey
} from "@/services/project-cards.service";
import { useRouter, useSearchParams } from "next/navigation";

const ROLE_OPTIONS: Array<{ value: PortalRoleKey; label: string }> = [
  { value: "bim-manager", label: "BIM Manager" },
  { value: "bim-coordinator", label: "BIM Coordinator" },
  { value: "discipline-lead", label: "Discipline Lead" },
  { value: "doc-controller", label: "Document Controller" },
  { value: "viewer", label: "Viewer" }
];

const ENABLE_PROJECT_HARD_DELETE =
  process.env.NEXT_PUBLIC_ENABLE_PROJECT_HARD_DELETE === "true";

const DISCIPLINE_OPTIONS = ["ARQ", "EST", "IME", "IEL", "SAN", "COM"];

type MemberFormState = {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  roleKey: PortalRoleKey;
  disciplineKey: string;
};

const initialMemberForm: MemberFormState = {
  email: "",
  username: "",
  firstName: "",
  lastName: "",
  roleKey: "viewer",
  disciplineKey: "ARQ"
};

function ProjectCardsAdminPageContent() {
  const [projectToDelete, setProjectToDelete] = useState<ProjectCard | null>(
    null
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState<
    "visible" | "all" | ProjectStatus
  >("visible");
  const [editingProject, setEditingProject] = useState<ProjectCard | null>(null);
  const [projectToArchive, setProjectToArchive] = useState<ProjectCard | null>(
    null
  );
  const [projectCards, setProjectCards] = useState<ProjectCard[]>([]);
  const [selectedProjectCode, setSelectedProjectCode] = useState<string>("");
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [memberFormErrors, setMemberFormErrors] = useState<Record<string, string>>({});
  const [memberStatusFilter, setMemberStatusFilter] = useState<
    "active" | "inactive" | "all"
  >("active");
  const [activeSection, setActiveSection] = useState<"projects" | "users" | "documents" | "workflows" | "bim" | "dashboard">(
  "projects"
  );
  const [projectSearch, setProjectSearch] = useState("");
  const [showProjectFormModal, setShowProjectFormModal] = useState(false);
  const [coverImagePreview, setCoverImagePreview] = useState<string>("");
  const [showMemberFormModal, setShowMemberFormModal] = useState(false);

  const [memberForm, setMemberForm] =
    useState<MemberFormState>(initialMemberForm);

  const [projectForm, setProjectForm] = useState({
    code: "TESTCDE04",
    name: "Proyecto de prueba CDE 04",
    description: "Proyecto creado desde el portal CDE",
    status: "planning" as ProjectStatus,
    startDate: "",
    endDate: "",
    budget: "0",
    currency: "PEN" as "PEN" | "USD" | "EUR",
    coverImageUrl: ""
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [showUserMenu, setShowUserMenu] = useState(false);
  function handleLogout() {
    setShowUserMenu(false);
    window.location.href = "/api/auth/logout";
  }

  const selectedProject = useMemo(
    () =>
      projectCards.find(
        (projectCard) => projectCard.code === selectedProjectCode
      ) ?? null,
    [projectCards, selectedProjectCode]
  );

  const filteredProjectCards = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();

    return projectCards.filter((projectCard) => {
      const matchesStatus =
        projectStatusFilter === "all"
          ? true
          : projectStatusFilter === "visible"
            ? projectCard.status !== "closed"
            : projectCard.status === projectStatusFilter;

      const matchesQuery =
        !query ||
        projectCard.code.toLowerCase().includes(query) ||
        projectCard.name.toLowerCase().includes(query);

      return matchesStatus && matchesQuery;
    });
  }, [projectCards, projectSearch, projectStatusFilter]);

  function getStatusLabel(status?: ProjectCard["status"]) {
    const labels: Record<string, string> = {
      planning: "Planificación",
      active: "Activo",
      paused: "Pausado",
      closed: "Cerrado"
    };

    return labels[status || "planning"] || "Planificación";
  }

  function formatDate(value?: string) {
    if (!value) return "Sin fecha";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Sin fecha";

    return date.toLocaleDateString("es-PE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  }

  function formatCurrency(value?: number, currency?: string) {
    const amount = Number(value || 0);

    return new Intl.NumberFormat("es-PE", {
      style: "currency",
      currency: currency || "PEN",
      maximumFractionDigits: 2
    }).format(amount);
  }
  async function loadProjectCards() {
    setIsLoading(true);
    setMessage("");

    try {
      const data = await getProjectCards();
      setProjectCards(data);

      const projectCodeFromUrl = searchParams
        .get("projectCode")
        ?.trim()
        .toUpperCase();

      const sectionFromUrl = searchParams.get("section");

      if (projectCodeFromUrl) {
        const exists = data.some(
          (projectCard) => projectCard.code.toUpperCase() === projectCodeFromUrl
        );

        if (exists) {
          setSelectedProjectCode(projectCodeFromUrl);
        }
      } else if (sectionFromUrl !== "users" && data.length > 0 && !selectedProjectCode) {
        setSelectedProjectCode(data[0].code);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudieron cargar proyectos"
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function loadMembers(projectCode: string, status = memberStatusFilter) {
    if (!projectCode) return;

    setMessage("");

    try {
      const data = await getProjectMembers(projectCode, status);
      setMembers(data);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los miembros"
      );
    }
  }

  useEffect(() => {
    void loadProjectCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProjectCode) return;

    let cancelled = false;

    async function run() {
      try {
        const data = await getProjectMembers(
          selectedProjectCode,
          memberStatusFilter
        );

        if (!cancelled) {
          setMembers(data);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los miembros"
          );
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [selectedProjectCode, memberStatusFilter]);

  useEffect(() => {
    const section = searchParams.get("section");
    const projectCodeFromUrl = searchParams.get("projectCode")?.trim().toUpperCase();

    if (projectCodeFromUrl) {
      setSelectedProjectCode(projectCodeFromUrl);
    }

    if (section === "users") {
      setActiveSection("users");
    }

    if (section === "projects") {
      setActiveSection("projects");
    }
  }, [searchParams]);

  async function handleCreateProjectCard() {
    setIsLoading(true);
    setMessage("");

    try {
      const code = projectForm.code.trim().toUpperCase();

      if (!code || !projectForm.name.trim()) {
        setMessage("Código y nombre del proyecto son obligatorios.");
        return;
      }

      // MODO EDITAR
      if (editingProject) {
        const updatedProject = await updateProjectCard(editingProject.code, {
          name: projectForm.name.trim(),
          description: projectForm.description.trim(),
          status: projectForm.status,
          startDate: projectForm.startDate || undefined,
          endDate: projectForm.endDate || undefined,
          budget: Number(projectForm.budget || 0),
          currency: projectForm.currency,
          coverImageUrl: projectForm.coverImageUrl.trim() || undefined
        });

        setProjectCards((prev) =>
          prev.map((projectCard) =>
            projectCard.code === updatedProject.code
              ? updatedProject
              : projectCard
          )
        );

        setSelectedProjectCode(updatedProject.code);
        setShowProjectFormModal(false);
        setCoverImagePreview("");
        setEditingProject(null);

        setProjectForm({
          code: "",
          name: "",
          description: "",
          status: "planning" as ProjectStatus,
          startDate: "",
          endDate: "",
          budget: "0",
          currency: "PEN" as "PEN" | "USD" | "EUR",
          coverImageUrl: ""
        });

        setMessage("");
        return;
      }

      // MODO CREAR
      const result = await createProjectCardFromPortal({
        code,
        name: projectForm.name.trim(),
        description: projectForm.description.trim(),
        status: projectForm.status,
        startDate: projectForm.startDate || undefined,
        endDate: projectForm.endDate || undefined,
        budget: Number(projectForm.budget || 0),
        currency: projectForm.currency,
        coverImageUrl: projectForm.coverImageUrl.trim() || undefined
      });

      const createdProject = result.projectCard;

      setProjectCards((prev) => {
        const exists = prev.some(
          (projectCard) => projectCard.code === createdProject.code
        );

        if (exists) {
          return prev.map((projectCard) =>
            projectCard.code === createdProject.code
              ? createdProject
              : projectCard
          );
        }

        return [createdProject, ...prev];
      });

      setSelectedProjectCode(createdProject.code);
      setMemberStatusFilter("active");
      setMembers([]);
      setShowProjectFormModal(false);
      setCoverImagePreview("");
      setEditingProject(null);

      setProjectForm({
        code: "",
        name: "",
        description: "",
        status: "planning" as ProjectStatus,
        startDate: "",
        endDate: "",
        budget: "0",
        currency: "PEN" as "PEN" | "USD" | "EUR",
        coverImageUrl: ""
      });

      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : editingProject
            ? "No se pudo actualizar el proyecto"
            : "No se pudo crear el proyecto desde el portal"
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleProvisionProject() {
    if (!selectedProjectCode) return;

    setIsProvisioning(true);
    setMessage("");

    try {
      await provisionProjectCard(selectedProjectCode);
      setMessage(`Proyecto ${selectedProjectCode} provisionado correctamente.`);
      await loadProjectCards();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo provisionar el proyecto"
      );
    } finally {
      setIsProvisioning(false);
    }
  }
  function validateMemberForm() {
    const errors: Record<string, string> = {};

    const email = memberForm.email.trim();
    const username = memberForm.username.trim();
    const firstName = memberForm.firstName.trim();
    const lastName = memberForm.lastName.trim();

    if (!email) {
      errors.email = "El correo es obligatorio.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Ingresa un correo válido.";
    }

    if (!username) {
      errors.username = "El usuario es obligatorio.";
    } else if (username.length < 3) {
      errors.username = "El usuario debe tener al menos 3 caracteres.";
    }

    if (!firstName) {
      errors.firstName = "El nombre es obligatorio.";
    } else if (firstName.length < 2) {
      errors.firstName = "El nombre debe tener al menos 2 letras.";
    }

    if (!lastName) {
      errors.lastName = "El apellido es obligatorio.";
    } else if (lastName.length < 2) {
      errors.lastName = "El apellido debe tener al menos 2 letras.";
    }

    if (!memberForm.roleKey) {
      errors.roleKey = "Selecciona un rol.";
    }

    if (!memberForm.disciplineKey) {
      errors.disciplineKey = "Selecciona una disciplina.";
    }

    setMemberFormErrors(errors);

    return Object.keys(errors).length === 0;
  }

  async function handleAddMember() {
    if (!selectedProjectCode) return;

    setIsLoading(true);
    setMessage("");
    setMemberFormErrors({});

    if (!validateMemberForm()) {
      setIsLoading(false);
      return;
    }

    try {
      const normalizedEmail = memberForm.email.trim().toLowerCase();

      const existingMember = members.find(
        (member) => member.email.toLowerCase() === normalizedEmail
      );

      if (existingMember && existingMember.status === "active") {
        const confirmed = window.confirm(
          "Este usuario ya existe en el proyecto. ¿Deseas actualizar su rol y disciplina?"
        );

        if (!confirmed) {
          setIsLoading(false);
          return;
        }
      }
      const input: CreateProjectMemberInput = {
        email: memberForm.email.trim(),
        username: memberForm.username.trim(),
        firstName: memberForm.firstName.trim(),
        lastName: memberForm.lastName.trim(),
        roleKey: memberForm.roleKey,
        disciplineKey: memberForm.disciplineKey.trim().toUpperCase()
      };

      await addProjectMember(selectedProjectCode, input);
      setShowMemberFormModal(false);
      setMemberForm(initialMemberForm);

      await loadMembers(selectedProjectCode);

      setMessage("Miembro agregado y sincronizado correctamente.");
      setMemberForm(initialMemberForm);
      await loadMembers(selectedProjectCode);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo agregar el miembro"
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleChangeRole(member: ProjectMember, roleKey: PortalRoleKey) {
    setIsLoading(true);
    setMessage("");

    try {
      await updateProjectMember(selectedProjectCode, member.id, {
        roleKey,
        disciplineKey: member.disciplineKey
      });

      setMessage("Rol actualizado correctamente.");
      await loadMembers(selectedProjectCode);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo actualizar el rol"
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRemoveMember(member: ProjectMember) {
    const confirmed = window.confirm(
      `¿Retirar a ${member.email} del proyecto ${member.projectCode}?`
    );

    if (!confirmed) return;

    setIsLoading(true);
    setMessage("");

    try {
      await removeProjectMember(selectedProjectCode, member.id);
      setMessage("Miembro retirado correctamente.");
      await loadMembers(selectedProjectCode);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo retirar el miembro"
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleArchiveProject(projectCard: ProjectCard) {
    setIsLoading(true);
    setMessage("");

    try {
      const archivedProject = await archiveProjectCard(projectCard.code);

      setProjectCards((prev) =>
        prev.map((item) =>
          item.code === archivedProject.code ? archivedProject : item
        )
      );

      if (selectedProjectCode === archivedProject.code) {
        setSelectedProjectCode("");
        setMembers([]);
        setActiveSection("projects");
      }

      setProjectToArchive(null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo archivar el proyecto"
      );
    } finally {
      setIsLoading(false);
    }
  }
  function ProjectCardTile({ projectCard }: { projectCard: ProjectCard }) {
    const isSelected = selectedProjectCode === projectCard.code;
    const progress = Math.max(
      0,
      Math.min(100, Number(projectCard.estimatedProgress || 0))
    );

    return (
      <article
        onClick={() => {
          setSelectedProjectCode(projectCard.code);
          router.push(
            `/documents?projectCode=${encodeURIComponent(projectCard.code)}`
          );
        }}
        className={`relative overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
          isSelected ? "border-red-600 ring-2 ring-red-100" : "border-slate-200"
        }`}
      >
        <div className="h-36 w-full bg-slate-200">
          {projectCard.coverImageUrl ? (
            <img
              src={projectCard.coverImageUrl}
              alt={projectCard.name}              
              className="h-full w-full object-cover"              
            />
            
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 text-3xl font-bold text-slate-500">
              {projectCard.code.slice(0, 2)}
            </div>
            
          )}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openEditProjectModal(projectCard);
          }}
          className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow hover:bg-white"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setProjectToArchive(projectCard);
          }}
          className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow hover:bg-white"
        >
          Archivar
        </button>
        {ENABLE_PROJECT_HARD_DELETE && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setProjectToDelete(projectCard);
              setDeleteConfirmationName("");
            }}
            className="absolute bottom-3 right-3 rounded-full bg-red-700/95 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-red-800"
          >
            Eliminar
          </button>
        )}
        

        <div className="space-y-3 p-4">
          <div>
            <div className="text-sm font-bold text-slate-900">
              {projectCard.code}
            </div>
            <div className="mt-1 line-clamp-2 text-sm text-slate-600">
              {projectCard.name}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-slate-400">Estado</div>
              <div className="font-semibold text-slate-800">
                {getStatusLabel(projectCard.status)}
              </div>
            </div>

            <div>
              <div className="text-slate-400">Miembros</div>
              <div className="font-semibold text-slate-800">
                {selectedProjectCode === projectCard.code
                  ? members.filter((member) => member.status === "active").length
                  : "-"}
              </div>
            </div>

            <div>
              <div className="text-slate-400">Inicio</div>
              <div className="font-semibold text-slate-800">
                {formatDate(projectCard.startDate)}
              </div>
            </div>

            <div>
              <div className="text-slate-400">Fin</div>
              <div className="font-semibold text-slate-800">
                {formatDate(projectCard.endDate)}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-slate-400">Progreso</span>
              <span className="font-semibold text-slate-800">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-red-600"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs text-slate-400">Costo</div>
            <div className="text-sm font-bold text-slate-900">
              {formatCurrency(projectCard.budget, projectCard.currency)}
            </div>
          </div>
        </div>
      </article>
    );
  }
  function openEditProjectModal(projectCard: ProjectCard) {
    setEditingProject(projectCard);

    setProjectForm({
      code: projectCard.code,
      name: projectCard.name,
      description: projectCard.description || "",
      status: projectCard.status || "planning",
      startDate: projectCard.startDate || "",
      endDate: projectCard.endDate || "",
      budget: String(projectCard.budget ?? 0),
      currency: projectCard.currency || "PEN",
      coverImageUrl: projectCard.coverImageUrl || ""
    });

    setCoverImagePreview(projectCard.coverImageUrl || "");
    setShowProjectFormModal(true);
  }
  async function handleHardDeleteProject() {
    if (!projectToDelete) return;

    const expectedName = projectToDelete.name.trim();
    const receivedName = deleteConfirmationName.trim();

    if (receivedName !== expectedName) {
      setMessage("El nombre ingresado no coincide con el nombre del proyecto.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      await hardDeleteProjectCard(projectToDelete.code, {
        confirmationName: receivedName
      });

      setProjectCards((prev) =>
        prev.filter((projectCard) => projectCard.code !== projectToDelete.code)
      );

      if (selectedProjectCode === projectToDelete.code) {
        setSelectedProjectCode("");
        setMembers([]);
        setActiveSection("projects");
      }

      setProjectToDelete(null);
      setDeleteConfirmationName("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar definitivamente el proyecto"
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5 shadow-sm">
        <div className="flex items-center gap-3">
          <img
            src="/brand/typsa-logo.png"
            alt="TYPSA"            
            className="h-11 w-11 rounded object-contain"
            
          />
          <div>
            <div className="text-lg font-semibold leading-tight">
              TYPSA Nexus
            </div>
            <div className="text-xs text-slate-500">
              Integrated BIM Collaboration Platform
            </div>
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowUserMenu((prev) => !prev)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-red-700 text-sm font-semibold text-white shadow-sm hover:bg-red-800"
          >
            JJ
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-12 z-50 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-700 text-sm font-semibold text-white">
                  JJ
                </div>

                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    Juan Jesús Vega More
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    jjvega@typsa.es
                  </div>
                </div>
              </div>

              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between rounded bg-slate-50 px-3 py-2">
                  <span className="text-slate-500">Rol</span>
                  <span className="font-semibold text-slate-800">BIM Manager</span>
                </div>

                <button
                  type="button"
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Mi perfil
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full rounded bg-red-700 px-3 py-2 text-left text-sm font-semibold text-white hover:bg-red-800"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-4rem)]">
        <aside className="w-60 border-r border-red-900 bg-red-800 text-white">
          <nav className="flex flex-col gap-1 p-3 text-sm">
            <button
              type="button"
              onClick={() => setActiveSection("projects")}
              className={`rounded px-3 py-2 text-left font-medium ${
                activeSection === "projects"
                  ? "bg-white text-red-800"
                  : "hover:bg-red-700"
              }`}
            >
              Proyecto
            </button>

            <button
              type="button"
              disabled={!selectedProjectCode}
              onClick={() => setActiveSection("users")}
              className={`rounded px-3 py-2 text-left font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                activeSection === "users"
                  ? "bg-white text-red-800"
                  : "hover:bg-red-700"
              }`}
            >
              Usuarios
            </button>
            <button
              type="button"
              disabled={!selectedProjectCode}
              onClick={() => {
                if (!selectedProjectCode) return;

                router.push(
                  `/documents?projectCode=${encodeURIComponent(selectedProjectCode)}`
                );
              }}
              className="rounded px-3 py-2 text-left font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-red-700"
            >
              Documentos
            </button>

            <button
              type="button"
              className="rounded px-3 py-2 text-left font-medium opacity-70"
            >
              Dashboard
            </button>
            

            
          </nav>          
        </aside>

        <section className="h-[calc(100vh-4rem)] flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1600px] px-8 py-7">
            {activeSection === "projects" && (  
              <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold">Proyectos</h1>
                  <p className="text-sm text-slate-500">
                    Administra tarjetas de proyecto, equipos y datos generales.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={projectSearch}
                    onChange={(event) => setProjectSearch(event.target.value)}
                    placeholder="Buscar proyecto por código o nombre..."
                    className="h-10 w-80 rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:border-red-600"
                  />
                  <select
                    value={projectStatusFilter}
                    onChange={(event) =>
                      setProjectStatusFilter(
                        event.target.value as "visible" | "all" | ProjectStatus
                      )
                    }
                    className="h-10 rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:border-red-600"
                  >
                    <option value="visible">No cerrados</option>
                    <option value="all">Todos</option>
                    <option value="planning">Planificación</option>
                    <option value="active">Activo</option>
                    <option value="paused">Pausado</option>
                    <option value="closed">Cerrado</option>
                  </select>

                  <button
                    type="button"
                    className="h-10 rounded border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"
                  >
                    Importar
                  </button>

                  <button
                    type="button"
                    className="h-10 rounded border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"
                  >
                    Exportar
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowProjectFormModal(true)}
                    className="h-10 rounded bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800"
                  >
                    Nuevo proyecto
                  </button>
                </div>
              </div>
            )}
            {message && (
              <div className="mb-4 rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                {message}
              </div>
            )}

            {activeSection === "projects" && (
              <div className="space-y-6">                

                <section className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
                  {filteredProjectCards.map((projectCard) => (
                    <ProjectCardTile
                      key={projectCard.id}
                      projectCard={projectCard}
                    />
                  ))}

                  {filteredProjectCards.length === 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                      No se encontraron proyectos.
                    </div>
                  )}
                </section>
              </div>
            )}

            {activeSection === "users" && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">
                      Usuarios {selectedProject ? `- ${selectedProject.code}` : ""}
                    </h2>
                    <p className="text-sm text-slate-500">
                      Gestiona miembros, roles y disciplinas del proyecto.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={memberStatusFilter}
                      onChange={(event) =>
                        setMemberStatusFilter(
                          event.target.value as "active" | "inactive" | "all"
                        )
                      }
                      className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
                    >
                      <option value="active">Activos</option>
                      <option value="inactive">Inactivos</option>
                      <option value="all">Todos</option>
                    </select>

                    <button
                      type="button"
                      disabled={!selectedProjectCode}
                      onClick={() => setShowMemberFormModal(true)}
                      className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Agregar usuario
                    </button>
                  </div>
                </div>          
                
                <div className="overflow-hidden rounded border border-slate-200">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-3">Usuario</th>
                        <th className="px-3 py-3">Rol</th>
                        <th className="px-3 py-3">Disciplina</th>
                        <th className="px-3 py-3">Estado</th>
                        <th className="px-3 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>

                    <tbody>
                      {members.map((member) => (
                        <tr key={member.id} className="border-t border-slate-200">
                          <td className="px-3 py-3">
                            <div className="font-medium">
                              {member.firstName} {member.lastName}
                            </div>
                            <div className="text-xs text-slate-500">
                              {member.email}
                            </div>
                          </td>

                          <td className="px-3 py-3">
                            <select
                              value={member.roleKey}
                              disabled={member.status !== "active"}
                              onChange={(event) =>
                                void handleChangeRole(
                                  member,
                                  event.target.value as PortalRoleKey
                                )
                              }
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-red-600 disabled:opacity-50"
                            >
                              {ROLE_OPTIONS.map((role) => (
                                <option key={role.value} value={role.value}>
                                  {role.label}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="px-3 py-3">
                            {member.disciplineKey || "-"}
                          </td>

                          <td className="px-3 py-3">
                            <span
                              className={`rounded-full px-2 py-1 text-xs ${
                                member.status === "active"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {member.status}
                            </span>
                          </td>

                          <td className="px-3 py-3 text-right">
                            <button
                              disabled={member.status !== "active" || isLoading}
                              onClick={() => void handleRemoveMember(member)}
                              className="rounded border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Retirar
                            </button>
                          </td>
                        </tr>
                      ))}

                      {members.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-8 text-center text-sm text-slate-500"
                          >
                            No hay usuarios para este filtro.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        </section>
      </div>
    {showProjectFormModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Nuevo proyecto
              </h2>
              <p className="text-sm text-slate-500">
                Registra los datos generales del proyecto.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowProjectFormModal(false)}
              className="rounded px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
            >
              Cerrar
            </button>
          </div>

          <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
            <input
              value={projectForm.code}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  code: event.target.value.toUpperCase()
                }))
              }
              placeholder="Código del proyecto"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            />

            <input
              value={projectForm.name}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  name: event.target.value
                }))
              }
              placeholder="Nombre del proyecto"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            />

            <select
              value={projectForm.status}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  status: event.target.value as ProjectStatus
                }))
              }
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            >
              <option value="planning">Planificación</option>
              <option value="active">Activo</option>
              <option value="paused">Pausado</option>
              <option value="closed">Cerrado</option>
            </select>

            <div className="rounded border border-slate-300 bg-white px-3 py-2 text-sm">
              <label className="block cursor-pointer text-slate-500">
                Imagen del proyecto
                <input
                  type="file"
                  accept="image/*"
                  className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-red-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-red-800"
                  onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (!file) return;

                    const reader = new FileReader();

                    reader.onload = () => {
                      const result = String(reader.result || "");

                      setCoverImagePreview(result);
                      setProjectForm((prev) => ({
                        ...prev,
                        coverImageUrl: result
                      }));
                    };

                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            </div>

            <input
              type="date"
              value={projectForm.startDate}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  startDate: event.target.value
                }))
              }
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            />

            <input
              type="date"
              value={projectForm.endDate}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  endDate: event.target.value
                }))
              }
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            />

            <input
              type="number"
              min="0"
              value={projectForm.budget}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  budget: event.target.value
                }))
              }
              placeholder="Costo"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            />

            <select
              value={projectForm.currency}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  currency: event.target.value as "PEN" | "USD" | "EUR"
                }))
              }
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            >
              <option value="PEN">S/ PEN</option>
              <option value="USD">$ USD</option>
              <option value="EUR">€ EUR</option>
            </select>

            {coverImagePreview && (
              <div className="md:col-span-2">
                <div className="mb-2 text-sm font-medium text-slate-700">
                  Vista previa
                </div>
                <img
                  src={coverImagePreview}
                  alt="Vista previa del proyecto"
                  className="h-44 w-full rounded-lg object-cover"
                />
              </div>
            )}

            <textarea
              value={projectForm.description}
              onChange={(event) =>
                setProjectForm((prev) => ({
                  ...prev,
                  description: event.target.value
                }))
              }
              placeholder="Descripción"
              className="min-h-24 rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600 md:col-span-2"
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              onClick={() => setShowProjectFormModal(false)}
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>

            <button
              disabled={isLoading}
              onClick={() => void handleCreateProjectCard()}
              className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Creando..." : "Crear proyecto"}
            </button>
          </div>
        </div>
      </div>
    )}
    {showMemberFormModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Agregar usuario
              </h2>
              <p className="text-sm text-slate-500">
                Asigna un usuario al proyecto {selectedProjectCode}.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowMemberFormModal(false);
                setMemberForm(initialMemberForm);
                setMemberForm(initialMemberForm);
              }}
              className="rounded px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
            >
              Cerrar
            </button>
          </div>

          <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
            <input
              value={memberForm.email}
              onChange={(event) =>
                setMemberForm((prev) => ({
                  ...prev,
                  email: event.target.value,
                  username:
                    prev.username || event.target.value.split("@")[0] || ""
                }))
              }
              placeholder="Correo electrónico"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            />
            {memberFormErrors.email && (
              <p className="mt-1 text-xs text-red-600">{memberFormErrors.email}</p>
            )}

            <input
              value={memberForm.username}
              onChange={(event) =>
                setMemberForm((prev) => ({
                  ...prev,
                  username: event.target.value
                }))
              }
              placeholder="Usuario"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            />
            {memberFormErrors.username && (
                <p className="mt-1 text-xs text-red-600">{memberFormErrors.username}</p>
              )}

            <input
              value={memberForm.firstName}
              onChange={(event) =>
                setMemberForm((prev) => ({
                  ...prev,
                  firstName: event.target.value
                }))
              }
              placeholder="Nombre"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            />
            {memberFormErrors.firstName && (
                <p className="mt-1 text-xs text-red-600">{memberFormErrors.firstName}</p>
              )}

            <input
              value={memberForm.lastName}
              onChange={(event) =>
                setMemberForm((prev) => ({
                  ...prev,
                  lastName: event.target.value
                }))
              }
              placeholder="Apellido"
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            />
            {memberFormErrors.lastName && (
                <p className="mt-1 text-xs text-red-600">{memberFormErrors.lastName}</p>
              )}

            <select
              value={memberForm.roleKey}
              onChange={(event) =>
                setMemberForm((prev) => ({
                  ...prev,
                  roleKey: event.target.value as PortalRoleKey
                }))
              }
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>

            <select
              value={memberForm.disciplineKey}
              onChange={(event) =>
                setMemberForm((prev) => ({
                  ...prev,
                  disciplineKey: event.target.value
                }))
              }
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            >
              {DISCIPLINE_OPTIONS.map((discipline) => (
                <option key={discipline} value={discipline}>
                  {discipline}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              onClick={() => {
                setShowMemberFormModal(false);
                setMemberForm(initialMemberForm);
                setEditingProject(null);
              }}
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>

            <button
              disabled={!selectedProjectCode || isLoading}
              onClick={() => void handleAddMember()}
              className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Agregando..." : "Agregar usuario"}
            </button>
          </div>
        </div>
      </div>
    )}
    {projectToArchive && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Archivar proyecto
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              El proyecto dejará de aparecer en la vista principal, pero su
              información no será eliminada.
            </p>
          </div>

          <div className="px-6 py-5">
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="text-sm text-slate-500">Proyecto</div>
              <div className="mt-1 font-semibold text-slate-900">
                {projectToArchive.code}
              </div>
              <div className="text-sm text-slate-600">
                {projectToArchive.name}
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-600">
              Podrás conservar sus documentos, usuarios históricos y datos
              asociados. Esta acción no borra carpetas ni información.
            </p>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => setProjectToArchive(null)}
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => void handleArchiveProject(projectToArchive)}
              className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Archivando..." : "Archivar"}
            </button>
          </div>
        </div>
      </div>
    )}
    {projectToDelete && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-red-700">
              Eliminar definitivamente
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Esta acción eliminará el proyecto y sus recursos asociados. No se
              debe usar en proyectos reales salvo autorización administrativa.
            </p>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="text-sm text-slate-500">Proyecto</div>
              <div className="mt-1 font-semibold text-slate-900">
                {projectToDelete.code}
              </div>
              <div className="text-sm text-slate-700">
                {projectToDelete.name}
              </div>
            </div>

            <p className="text-sm text-slate-600">
              Para confirmar, escribe exactamente el nombre del proyecto:
            </p>

            <div className="rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">
              {projectToDelete.name}
            </div>

            <input
              value={deleteConfirmationName}
              onChange={(event) => setDeleteConfirmationName(event.target.value)}
              placeholder="Escribe el nombre exacto del proyecto"
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
            />

            {deleteConfirmationName &&
              deleteConfirmationName.trim() !== projectToDelete.name.trim() && (
                <p className="text-xs text-red-600">
                  El nombre no coincide exactamente.
                </p>
              )}
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                setProjectToDelete(null);
                setDeleteConfirmationName("");
              }}
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={
                isLoading ||
                deleteConfirmationName.trim() !== projectToDelete.name.trim()
              }
              onClick={() => void handleHardDeleteProject()}
              className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Eliminando..." : "Eliminar definitivamente"}
            </button>
          </div>
        </div>
      </div>
    )}

    </main>
  );
}

export default function ProjectCardsAdminPage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}>Cargando administración de proyectos...</main>}>
      <ProjectCardsAdminPageContent />
    </Suspense>
  );
}
