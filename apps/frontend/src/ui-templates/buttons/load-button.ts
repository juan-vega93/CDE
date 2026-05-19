import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components"
import { appIcons } from "../../globals";

export interface LoadModelBtnState {
  components: OBC.Components
}

export const loadModelBtnTemplate: BUI.StatefullComponent<LoadModelBtnState> = (
  state,
) => {
  const { components } = state
  const onLoadIfc = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = false;
    input.accept = ".ifc";

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;

      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const ifcLoader = components.get(OBC.IfcLoader)
      await ifcLoader.load(
        bytes,
        true, // instructs the loader to automatically coordinate (position) the model relative to others loaded
        file.name.replace(".ifc", ""), // ID with which the model will be loaded into memory
      );
    })

    input.click();
  }

  const onLoadFrag = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = false;
    input.accept = ".frag";

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const buffer = await file.arrayBuffer();

      const fragments = components.get(OBC.FragmentsManager)
      fragments.core.load(buffer, {
        modelId: file.name.replace(".frag", "")
      })
    });

    input.click();
  }

  return BUI.html`<bim-button icon=${appIcons.ADD}>
    <bim-context-menu>
      <bim-button class="transparent" @click=${onLoadFrag} label="Load FRAG"></bim-button>
      <bim-button class="transparent" @click=${onLoadIfc} label="Load IFC"></bim-button>
    </bim-context-menu>
  </bim-button>`
}