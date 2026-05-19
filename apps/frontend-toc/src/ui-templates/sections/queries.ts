import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as CUI from "@thatopen/ui-obc"
import { loadModelBtnTemplate } from "../buttons";
import { queriesList } from "../tables/queries";
import { appIcons } from "../../globals";
import { SmartViews } from "../../bim-components/SmartViews";

export interface QueriesPanelState {
  components: OBC.Components;
}

export const queriesPanelTemplate: BUI.StatefullComponent<
  QueriesPanelState
> = (state) => {
  const { components } = state;

  const [modelsList] = queriesList({
    components,
  });

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    modelsList.queryString = input.value;
  };

  return BUI.html`
  <bim-panel-section fixed label="Queries List">
    <div style="display: flex; gap: 0.5rem;">
      <bim-text-input @input=${onSearch} placeholder="Search..." debounce="200"></bim-text-input>
    </div>
    ${modelsList}
  </bim-panel-section>`;
};