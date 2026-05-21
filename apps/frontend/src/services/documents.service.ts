import type {
  DocumentsApiResponse,
  DocumentItem,
  FoldersApiResponse,
  SendToReviewInput,
  SendToReviewResponse,
  WorkPackage,
  WorkPackageLinkApiResponse,
  WorkPackageLinksApiResponse
} from "@/types/documents";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL;

if (!BFF_URL) {
  throw new Error("Falta definir NEXT_PUBLIC_BFF_URL en .env.local");
}

export async function getDocuments(
  path = "/SHARED/ARQ"
): Promise<DocumentsApiResponse> {
  const res = await fetch(`${BFF_URL}/api/documents?path=${encodeURIComponent(path)}`, {
  cache: "no-store"
});

  if (!res.ok) {
    throw new Error("No se pudo obtener la lista de documentos");
  }

  return res.json();
}

export async function getFolders(
  path = "/"
): Promise<FoldersApiResponse> {
  const res = await fetch(`${BFF_URL}/api/folders?path=${encodeURIComponent(path)}`, {
  cache: "no-store"
});

  if (!res.ok) {
    throw new Error("No se pudo obtener la lista de carpetas");
  }

  return res.json();
}

export async function getDocumentById(
  id: string,
  path = "/SHARED/ARQ"
): Promise<DocumentItem> {
  const res = await fetch(
  `${BFF_URL}/api/documents/${id}?path=${encodeURIComponent(path)}`,
  {
    cache: "no-store"
  }
);

  if (!res.ok) {
    throw new Error("No se pudo obtener el documento");
  }

  const json = await res.json();
  return json.data;
}

export async function sendToReview(
  input: SendToReviewInput
): Promise<SendToReviewResponse> {
  const res = await fetch(`${BFF_URL}/api/reviews/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const payload = await res.json();

  if (!res.ok || !payload.success) {
    throw new Error(
      payload.message || payload.error || "No se pudo enviar el documento a revisión"
    );
  }

  return payload;
}
export async function updateWorkPackageStatus(
  id: number,
  status: string
): Promise<WorkPackage> {
  const res = await fetch(`${BFF_URL}/api/work-packages/${id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(
      payload.message || payload.error || "No se pudo actualizar el estado"
    );
  }

  const json = await res.json();
  return json.data;
}

export async function getWorkPackageLinkByDocumentId(
  documentId: string
) {
  const res = await fetch(
  `${BFF_URL}/api/work-package-links/document/${documentId}`,
  {
    cache: "no-store"
  }
);

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error("No se pudo obtener el vínculo del documento");
  }

  const json: WorkPackageLinkApiResponse = await res.json();
  return json.data;
}
export async function getWorkPackageById(
  id: number
): Promise<WorkPackage> {
  const res = await fetch(`${BFF_URL}/api/work-packages/${id}`, {
  cache: "no-store"
});

  if (!res.ok) {
    throw new Error("No se pudo obtener el workflow");
  }

  const json = await res.json();
  return json.data;
}

export async function getWorkPackageLinks() {
  const res = await fetch(`${BFF_URL}/api/work-package-links`, {
  cache: "no-store"
});

  if (!res.ok) {
    throw new Error("No se pudo obtener la lista de vínculos");
  }

  const json: WorkPackageLinksApiResponse = await res.json();
  return json.data;
}
export async function uploadDocument(
  file: File,
  targetFolderPath: string
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("targetFolderPath", targetFolderPath);

  const res = await fetch(`${BFF_URL}/api/documents/upload`, {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    let errorMessage = "No se pudo subir el archivo";

    try {
      const errorJson = await res.json();
      if (errorJson?.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // mantener mensaje genérico
    }

    throw new Error(errorMessage);
  }

  return res.json();
}
export async function createFolder(
  parentPath: string,
  folderName: string
) {
  const res = await fetch(`${BFF_URL}/api/folders`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    parentPath,
    folderName
  })
});

  if (!res.ok) {
    let errorMessage = "No se pudo crear la carpeta";

    try {
      const errorJson = await res.json();
      if (errorJson?.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // mantener mensaje genérico
    }

    throw new Error(errorMessage);
  }

  return res.json();
}
export async function deleteDocument(documentPath: string) {
  const res = await fetch(`${BFF_URL}/api/documents`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      documentPath
    })
  });

  const payload = await res.json();

  if (!res.ok || !payload.success) {
    throw new Error(
      payload.message || payload.error || "No se pudo eliminar el archivo"
    );
  }

  return payload.data;
}
export async function deleteFolder(folderPath: string) {
  const res = await fetch(`${BFF_URL}/api/folders`, {
  method: "DELETE",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    folderPath
  })
});

  if (!res.ok) {
    let errorMessage = "No se pudo eliminar la carpeta";

    try {
      const errorJson = await res.json();
      if (errorJson?.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // mantener mensaje genérico
    }

    throw new Error(errorMessage);
  }

  return res.json();
}
export async function renameDocument(
  documentPath: string,
  newName: string
) {
  const res = await fetch(`${BFF_URL}/api/documents/rename`, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    documentPath,
    newName
  })
});

  if (!res.ok) {
    let errorMessage = "No se pudo renombrar el documento";

    try {
      const errorJson = await res.json();
      if (errorJson?.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // mantener mensaje genérico
    }

    throw new Error(errorMessage);
  }

  return res.json();
}

export async function moveDocument(
  documentPath: string,
  destinationFolderPath: string
): Promise<void> {
  const response = await fetch(
  `${process.env.NEXT_PUBLIC_BFF_URL}/api/documents/move`,
  {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      documentPath,
      destinationFolderPath
    })
  }
);

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "No se pudo mover el documento");
  }
}
export async function moveFolder(
  folderPath: string,
  destinationFolderPath: string
): Promise<void> {
  const response = await fetch(
  `${process.env.NEXT_PUBLIC_BFF_URL}/api/folders/move`,
  {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      folderPath,
      destinationFolderPath
    })
  }
);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "No se pudo mover la carpeta");
  }
}
export async function renameFolder(folderPath: string, newName: string) {
  const response = await fetch(
  `${process.env.NEXT_PUBLIC_BFF_URL}/api/folders/rename`,
  {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      folderPath,
      newName
    })
  }
);

  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(
      payload.message || payload.error || "No se pudo renombrar la carpeta"
    );
  }

  return payload.data;
}