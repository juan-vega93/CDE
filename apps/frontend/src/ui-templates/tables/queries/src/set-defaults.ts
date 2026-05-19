import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import * as THREE from "three"
import { QueriesListState, QueriesListTableData } from "./types";
import { appIcons } from "../../../../globals";
import { SmartViews } from "../../../../bim-components/SmartViews";

export const setDefaults = (
  state: QueriesListState,
  table: BUI.Table<QueriesListTableData>,
) => {
  const { components } = state

  table.noIndentation = true
  table.headersHidden = true
  table.columns = ["Name", {name: "Actions", width: "auto"}] // auto just means it will take the lowest possible value to enclose the content... the buttons in this case.
  table.dataTransform = {
    Actions: (cellValue, rowData) => {
      const { Name } = rowData
      if (!Name) return cellValue

      const finder = components.get(OBC.ItemsFinder)
      const query = finder.list.get(Name)
      if (!query) return cellValue

      const onClick = async ({target: button}: {target: BUI.Button}) => {
        button.loading = true
        const items = await query.test()
        const highligher = components.get(OBF.Highlighter)
        await highligher.highlightByID("select", items)
        button.loading = false
      }

      let colorInput: BUI.ColorInput | undefined;
      const onColorInputCreated = (e?: Element) => {
        if (!e) return;
        colorInput = e as BUI.ColorInput;
      };

      const onApplyColor = async ({ target: button }: { target: BUI.Button }) => {
        if (!colorInput) return
        button.loading = true
        const items = await query.test()
        if (OBC.ModelIdMapUtils.isEmpty(items)) {
          button.loading = false
          return
        }

        const { color } = colorInput
        const highlighter = components.get(OBF.Highlighter)
        if (!highlighter.styles.has(color)) {
          highlighter.styles.set(color, {
            color: new THREE.Color(color),
            renderedFaces: 1,
            opacity: 1,
            transparent: false
          })
        }

        await highlighter.highlightByID(color, items)
        const smartViews = components.get(SmartViews)
        smartViews.addQueryColor(color, Name)
        button.loading = false
        BUI.ContextMenu.removeMenus()
      }

      return BUI.html`
        <bim-button style="flex: 0;" icon=${appIcons.SELECT} @click=${onClick}></bim-button>
        <bim-button style="flex: 0;" icon=${appIcons.CONTEXT}>
          <bim-context-menu>
            <bim-button style="flex: 0;" icon=${appIcons.COLORIZE} label="Colorize">
              <bim-context-menu>
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                  <bim-color-input ${BUI.ref(onColorInputCreated)}></bim-color-input>
                  <bim-button @click=${onApplyColor} icon=${appIcons.APPLY} label="Apply"></bim-button>
                </div>
              </bim-context-menu>
            </bim-button>
          </bim-context-menu>
        </bim-button>
      `
    }
  }
}