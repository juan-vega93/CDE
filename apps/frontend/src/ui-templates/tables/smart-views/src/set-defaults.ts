import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { SmartViewsListState, SmartViewsListTableData } from "./types";
import { appIcons } from "../../../../globals";
import { SmartViews } from "../../../../bim-components";

export const setDefaults = (
  state: SmartViewsListState,
  table: BUI.Table<SmartViewsListTableData>,
) => {
  const { components } = state

  table.noIndentation = true
  table.headersHidden = true
  table.columns = ["Name", { name: "Actions", width: "auto" }]
  table.hiddenColumns = ["guid"]
  table.dataTransform = {
    Actions: (cellValue, rowData) => {
      const { guid } = rowData
      if (!guid) return cellValue

      const smartViews = components.get(SmartViews)
      const view = smartViews.list.get(guid)
      if (!view) return cellValue

      const onClick = async ({target: button}: {target: BUI.Button}) => {
        button.loading = true
        await smartViews.apply(view)
        button.loading = false
      }
      return BUI.html`<bim-button @click=${onClick} style="flex: 0;" icon=${appIcons.APPLY}></bim-button>`
    }
  }
}