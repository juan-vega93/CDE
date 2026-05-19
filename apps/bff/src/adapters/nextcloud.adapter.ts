import type { FolderItem } from "../types/folder.types";
import type { DocumentItem } from "../types/document.types";

type NextcloudConfig = {
  baseUrl: string;
  username: string;
  password: string;
  rootPath: string;
};

const HIDDEN_PORTAL_FOLDERS = new Set([
  "_meta",
  "_viewer"
]);

export class NextcloudAdapter {
  private config: NextcloudConfig;

  constructor() {
    this.config = {
      baseUrl: process.env.NEXTCLOUD_BASE_URL || "",
      username: process.env.NEXTCLOUD_USERNAME || "",
      password: process.env.NEXTCLOUD_PASSWORD || "",
      rootPath: process.env.NEXTCLOUD_ROOT_PATH || ""
    };
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(
      `${this.config.username}:${this.config.password}`
    ).toString("base64")}`;
  }

  private getNormalizedRootPath(): string {
    const root = this.config.rootPath.trim();
    if (!root) return "";
    return root.startsWith("/") ? root.replace(/\/$/, "") : `/${root.replace(/\/$/, "")}`;
  }

  private buildWebDavUrl(portalPath: string): string {
    const cleanBaseUrl = this.config.baseUrl.replace(/\/$/, "");
    const root = this.getNormalizedRootPath();

    let relativePath = portalPath || "/";
    if (!relativePath.startsWith("/")) {
      relativePath = `/${relativePath}`;
    }

    const fullPath = relativePath === "/" ? root : `${root}${relativePath}`;

    const normalizedFullPath = fullPath.endsWith("/") ? fullPath : `${fullPath}/`;

    return `${cleanBaseUrl}/remote.php/dav/files/${this.config.username}${normalizedFullPath}`;
  }

  private mapNextcloudPathToPortalPath(nextcloudPath: string): string {
    const root = this.getNormalizedRootPath();

    if (nextcloudPath === root || nextcloudPath === `${root}/`) {
      return "/";
    }

    if (nextcloudPath.startsWith(root)) {
      const stripped = nextcloudPath.slice(root.length);
      return stripped || "/";
    }

    return nextcloudPath;
  }

  async testConnection() {
    const url = this.buildWebDavUrl("/");

    const response = await fetch(url, {
      method: "PROPFIND",
      headers: {
        Authorization: this.getAuthHeader(),
        Depth: "0"
      }
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Nextcloud testConnection failed: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }

    return {
      ok: true,
      status: response.status,
      preview: text.slice(0, 500)
    };
  }

  async listFolders(path: string): Promise<FolderItem[]> {
    const { xml } = await this.propfind(path, "1");
    return this.parseFoldersFromXml(xml, path);
  }

  async listDocuments(path: string): Promise<DocumentItem[]> {
    const { xml } = await this.propfind(path, "1");
    return this.parseDocumentsFromXml(xml, path);
  }

  private async propfind(path: string, depth: "0" | "1") {
    const url = this.buildWebDavUrl(path);

    console.log("[NextcloudAdapter] PROPFIND", {
      path,
      depth,
      url
    });

    const response = await fetch(url, {
      method: "PROPFIND",
      headers: {
        Authorization: this.getAuthHeader(),
        Depth: depth
      }
    });

    const xml = await response.text();

    if (!response.ok) {
      throw new Error(
        `Nextcloud PROPFIND failed: ${response.status} ${response.statusText} - ${xml.slice(0, 500)}`
      );
    }

    return { xml };
  }

  private parseFoldersFromXml(xml: string, currentPath: string): FolderItem[] {
    const responses = xml.match(/<d:response[\s\S]*?<\/d:response>/g) || [];
    const folders: FolderItem[] = [];

    for (const responseBlock of responses) {
      const hrefMatch = responseBlock.match(/<d:href>(.*?)<\/d:href>/);
      const resourceTypeMatch = responseBlock.match(
        /<d:resourcetype>[\s\S]*?<d:collection\/>[\s\S]*?<\/d:resourcetype>/
      );

      if (!hrefMatch || !resourceTypeMatch) continue;

      const rawHref = hrefMatch[1];
      const decodedHref = decodeURIComponent(rawHref);

      const davPrefix = `/remote.php/dav/files/${this.config.username}`;
      const nextcloudRelativePath = decodedHref
        .replace(davPrefix, "")
        .replace(/\/$/, "");

      if (!nextcloudRelativePath) continue;

      const portalPath = this.mapNextcloudPathToPortalPath(nextcloudRelativePath);

      if (portalPath === currentPath) continue;

      const currentDepth =
        currentPath === "/" ? 0 : currentPath.split("/").filter(Boolean).length;

      const folderDepth =
        portalPath === "/" ? 0 : portalPath.split("/").filter(Boolean).length;

      if (folderDepth !== currentDepth + 1) continue;

      const segments = portalPath.split("/").filter(Boolean);
      const name = segments[segments.length - 1];

      if (!name) continue;

      if (HIDDEN_PORTAL_FOLDERS.has(name)) {
        continue;
      }

      folders.push({
        name,
        path: portalPath,
        type: "folder"
      });
    }

    return folders;
  }

  private parseDocumentsFromXml(xml: string, currentPath: string): DocumentItem[] {
    const responses = xml.match(/<d:response[\s\S]*?<\/d:response>/g) || [];
    const documents: DocumentItem[] = [];

    for (const responseBlock of responses) {
      const hrefMatch = responseBlock.match(/<d:href>(.*?)<\/d:href>/);

      if (!hrefMatch) continue;

      const rawHref = hrefMatch[1];

      // 1. limpiar entidades XML básicas
      const xmlCleaned = rawHref
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

      // 2. decode seguro
      let decodedHref = xmlCleaned;
      try {
        decodedHref = decodeURIComponent(xmlCleaned);
      } catch {
        // si falla, usa el valor limpio sin romper
        decodedHref = xmlCleaned;
      }

      const isFolder = decodedHref.endsWith("/");

      // Si es carpeta, no es documento
      if (isFolder) continue;

      const davPrefix = `/remote.php/dav/files/${this.config.username}`;
      const nextcloudRelativePath = decodedHref.replace(davPrefix, "");

      if (!nextcloudRelativePath) continue;

      const portalPath = this.mapNextcloudPathToPortalPath(nextcloudRelativePath);

      // excluir si no es hijo directo del currentPath
      const normalizedCurrentPath =
        currentPath === "/" ? "/" : currentPath.replace(/\/$/, "");
      const expectedPrefix =
        normalizedCurrentPath === "/" ? "/" : `${normalizedCurrentPath}/`;

      if (!portalPath.startsWith(expectedPrefix)) continue;

      const remainingPath = portalPath.slice(expectedPrefix.length);

      // si hay más subniveles, no es hijo directo
      if (!remainingPath || remainingPath.includes("/")) continue;

      const name = remainingPath;
      const pathSegments = portalPath.split("/").filter(Boolean);

      if (pathSegments.some((segment) => HIDDEN_PORTAL_FOLDERS.has(segment))) {
        continue;
      }
      const extension = (() => {
        const parts = name.split(".");
        if (parts.length <= 1) return "";
        return parts.pop()?.toLowerCase() || "";
      })();

      const sizeMatch = responseBlock.match(
        /<d:getcontentlength>(.*?)<\/d:getcontentlength>/
      );
      const modifiedMatch = responseBlock.match(
        /<d:getlastmodified>(.*?)<\/d:getlastmodified>/
      );

      const size = sizeMatch ? Number(sizeMatch[1]) : 0;
      const rawDate = modifiedMatch ? modifiedMatch[1] : null;

      const modifiedAt = rawDate
        ? new Date(rawDate).toISOString()
        : new Date().toISOString();

      // 👉 NUEVO (para UI)
      const modifiedAtLocal = rawDate
        ? new Date(rawDate).toLocaleString("es-PE", {
            timeZone: "America/Lima",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          })
        : null;

      console.log("[NextcloudAdapter] FILE FOUND", {
        currentPath,
        portalPath,
        name,
        extension,
        size
      });

      documents.push({
        id: `nc-${Buffer.from(portalPath).toString("base64url")}`,
        name,
        path: portalPath,
        extension,
        size,
        modifiedAt,
        modifiedAtLocal,
        workflowStatus: null,
        uiStatus: "pending"
      });
    }

    return documents;
  }
  async uploadFile(
  targetPath: string,
  fileBuffer: Buffer,
  contentType?: string
): Promise<void> {
  const cleanPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  const url = this.buildWebDavUrl(cleanPath).replace(/\/$/, "");

  console.log("[NextcloudAdapter] PUT", {
    targetPath: cleanPath,
    url,
    size: fileBuffer.length
  });

  const now = new Date();

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: this.getAuthHeader(),
      "Content-Type": contentType || "application/octet-stream",

      // 🔥 CLAVE → fija correctamente la fecha en Nextcloud
      "X-OC-Mtime": Math.floor(now.getTime() / 1000).toString()
    },
    body: new Uint8Array(fileBuffer)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Nextcloud PUT failed: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
    );
  }
  }
  
  async createFolder(folderPath: string): Promise<void> {
  const cleanPath = folderPath.startsWith("/") ? folderPath : `/${folderPath}`;
  const url = this.buildWebDavUrl(cleanPath);

  console.log("[NextcloudAdapter] MKCOL", {
    folderPath: cleanPath,
    url
  });

  const response = await fetch(url, {
    method: "MKCOL",
    headers: {
      Authorization: this.getAuthHeader()
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Nextcloud MKCOL failed: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
    );
  }
  }
  async deletePath(targetPath: string): Promise<void> {
    const cleanPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
    const url = this.buildWebDavUrl(cleanPath).replace(/\/$/, "");

    console.log("[NextcloudAdapter] DELETE", {
      targetPath: cleanPath,
      url
    });

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: this.getAuthHeader()
      }
    });

    const text = await response.text();

    if (response.status === 404) {
      return;
    }

    if (!response.ok && response.status !== 204) {
      throw new Error(
        `Nextcloud DELETE failed: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }
  }

  async renamePath(oldPath: string, newName: string): Promise<void> {
  const cleanOldPath = oldPath.startsWith("/") ? oldPath : `/${oldPath}`;

  const basePath = cleanOldPath.substring(0, cleanOldPath.lastIndexOf("/"));
  const newPath = `${basePath}/${newName}`;

  const sourceUrl = this.buildWebDavUrl(cleanOldPath).replace(/\/$/, "");
  const destinationUrl = this.buildWebDavUrl(newPath).replace(/\/$/, "");

  console.log("[NextcloudAdapter] MOVE", {
    from: cleanOldPath,
    to: newPath
  });

  const response = await fetch(sourceUrl, {
    method: "MOVE",
    headers: {
      Authorization: this.getAuthHeader(),
      Destination: destinationUrl,
      Overwrite: "T"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Nextcloud MOVE failed: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
    );
  }
  }

  async movePath(sourcePath: string, destinationPath: string): Promise<void> {
  const cleanSourcePath = sourcePath.startsWith("/")
    ? sourcePath
    : `/${sourcePath}`;

  const cleanDestinationPath = destinationPath.startsWith("/")
    ? destinationPath
    : `/${destinationPath}`;

  const sourceUrl = this.buildWebDavUrl(cleanSourcePath).replace(/\/$/, "");
  const destinationUrl = this.buildWebDavUrl(cleanDestinationPath).replace(/\/$/, "");

  console.log("[NextcloudAdapter] MOVE", {
    sourcePath: cleanSourcePath,
    destinationPath: cleanDestinationPath
  });

  const response = await fetch(sourceUrl, {
    method: "MOVE",
    headers: {
      Authorization: this.getAuthHeader(),
      Destination: destinationUrl,
      Overwrite: "F"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Nextcloud MOVE failed: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
    );
  }
  }

  async fileExists(path: string): Promise<boolean> {
      const cleanPath = path.startsWith("/") ? path : `/${path}`;

      try {
        await this.propfind(cleanPath, "0");
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";

        if (
          message.includes("404") ||
          message.includes("Not Found")
        ) {
          return false;
        }

        throw error;
      }
  }

  async downloadTextFile(filePath: string): Promise<string> {
    const { buffer } = await this.downloadFile(filePath);
    return buffer.toString("utf8");
  }

  async uploadTextFile(
    targetPath: string,
    content: string,
    contentType = "application/json; charset=utf-8"
  ): Promise<void> {
    await this.uploadFile(targetPath, Buffer.from(content, "utf8"), contentType);
  }

  async ensureFolderExists(folderPath: string): Promise<void> {
    const cleanPath = folderPath.startsWith("/")
      ? folderPath
      : `/${folderPath}`;

    const segments = cleanPath.split("/").filter(Boolean);

    let currentPath = "";

    for (const segment of segments) {
      currentPath += `/${segment}`;

      try {
        await this.createFolder(currentPath);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";

        // Si ya existe, seguimos.
        if (
          message.includes("405") ||
          message.includes("Method Not Allowed") ||
          message.includes("already exists")
        ) {
          continue;
        }

        throw error;
      }
    }
  }
  

  async downloadFile(filePath: string): Promise<{
    buffer: Buffer;
    contentType: string;
    fileName: string;
    size?: number;
  }> {
    const cleanPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
    const url = this.buildWebDavUrl(cleanPath).replace(/\/$/, "");

    console.log("[NextcloudAdapter] GET FILE", {
      filePath: cleanPath,
      url
    });

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: this.getAuthHeader()
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Nextcloud GET failed: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";

    const sizeHeader = response.headers.get("content-length");
    const size = sizeHeader ? Number(sizeHeader) : undefined;

    const fileName = cleanPath.split("/").pop() || "document.ifc";

    return {
      buffer,
      contentType,
      fileName,
      size
    };
  }



}