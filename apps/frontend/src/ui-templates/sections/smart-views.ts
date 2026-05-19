import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import { smartViewsList } from "../tables/smart-views";
import { appIcons } from "../../globals";
import { SmartViews } from "../../bim-components";

export interface SmartViewsPanelState {
  components: OBC.Components;
}

export const smartViewsPanelTemplate: BUI.StatefullComponent<
  SmartViewsPanelState
> = (state) => {
  const { components } = state;

  const [smartViewsElement] = smartViewsList({
    components,
  });

  const onSearch = (e: Event) => {
    const input = e.target as BUI.TextInput;
    smartViewsElement.queryString = input.value;
  };

  let textInput: BUI.TextInput | undefined;
  const onTextInputCreated = (e?: Element) => {
    if (!e) return;
    textInput = e as BUI.TextInput;
  };

  const onCreateClick = () => {
    if (!textInput) return
    const name = textInput.value
    if (name.trim() === "") return
    const smartViews = components.get(SmartViews)
    smartViews.saveCurrentState(name)
  }

  const onReset = async ({target: button}: {target: BUI.Button}) => {
    button.loading = true
    const smartViews = components.get(SmartViews)
    await smartViews.reset()
    button.loading = false
  }

  return BUI.html`
  <bim-panel-section fixed label="Smart Views">
    <div style="display: flex; gap: 0.5rem;">
      <bim-text-input @input=${onSearch} placeholder="Search..." debounce="200"></bim-text-input>
      <bim-button @click=${onReset} icon=${appIcons.REFRESH} style="flex: 0"></bim-button>
      <bim-button style="flex: 0" icon=${appIcons.ADD}>
        <bim-context-menu>
          <div style="display: flex; gap: 0.5rem;">
            <bim-text-input ${BUI.ref(onTextInputCreated)} style="width: 10rem"></bim-text-input>
            <bim-button @click=${onCreateClick} style="flex: 0" label="Create"></bim-button>
          </div>
        </bim-context-menu>
      </bim-button>
    </div>
    ${smartViewsElement}
  </bim-panel-section>`;
};