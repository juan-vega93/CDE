import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as CUI from "@thatopen/ui-obc"
import { loadModelBtnTemplate } from "../buttons";

export interface ModelsPanelState {
  components: OBC.Components;
}

export const modelsPanelTemplate: BUI.StatefullComponent<
  ModelsPanelState
> = (state) => {
  const { components } = state;

  const [modelsList] = CUI.tables.modelsList({
    components,
  });

  const [loadModelsBtn] = BUI.Component.create(loadModelBtnTemplate, { components })
  loadModelsBtn.style.flex = "0"

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    modelsList.queryString = input.value;
  };

  return BUI.html`
  <bim-panel-section fixed label="Models List">
    <div style="display: flex; gap: 0.5rem;">
      <bim-text-input @input=${onSearch} placeholder="Search..." debounce="200"></bim-text-input>
      ${loadModelsBtn}
    </div>
    ${modelsList}
  </bim-panel-section>`;
};