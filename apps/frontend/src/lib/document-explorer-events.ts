export const DOCUMENT_EXPLORER_REFRESH_EVENT = "document-explorer:refresh";

export function requestDocumentExplorerRefresh() {
  window.dispatchEvent(new Event(DOCUMENT_EXPLORER_REFRESH_EVENT));
}
