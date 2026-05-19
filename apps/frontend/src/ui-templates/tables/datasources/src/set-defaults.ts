import * as BUI from "@thatopen/ui";
import { DataSourcesListState } from "./types";
import { DataEnhancer } from "../../../../bim-components";

export const setDefaults = (
  state: DataSourcesListState,
  table: BUI.Table,
) => {
  const { components } = state

  table.noIndentation = true
  table.addEventListener("rowcreated", (e: CustomEvent<BUI.RowCreatedEventDetail>) => {
    const { row } = e.detail
    row.addEventListener("click", () => {
      const enhancer = components.get(DataEnhancer)
    })
  })
}