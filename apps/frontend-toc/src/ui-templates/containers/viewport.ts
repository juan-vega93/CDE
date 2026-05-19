import * as BUI from "@thatopen/ui";

export interface ViewportContainerState {
  viewport?: BUI.Viewport;
}

export const viewportContainerTemplate: BUI.StatefullComponent<ViewportContainerState> = (state) => {
  let content: HTMLElement | undefined = state.viewport;
  if (!content) {
    content = BUI.Component.create(() => BUI.html`
        <bim-label>No viewer viewport has been defined.</bim-label>
      `,)
  }
  return BUI.html`<div class="viewport-container">${content}</div>`;
};