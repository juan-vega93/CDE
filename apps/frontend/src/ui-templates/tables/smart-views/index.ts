import * as BUI from "@thatopen/ui";
import { SmartViewsListState, SmartViewsListTableData } from "./src/types";
import { smartViewsListTemplate } from "./src/template";
import { setDefaults } from "./src/set-defaults";
import { SmartViews } from "../../../bim-components";

export const smartViewsList = (state: SmartViewsListState) => {
  const component = BUI.Component.create<BUI.Table<SmartViewsListTableData>, SmartViewsListState>(smartViewsListTemplate, state);

  const [table, updateTable] = component;
  setDefaults(state, table)

  const { components } = state;
  const smartViews = components.get(SmartViews);
  const updateFunction = () => updateTable();
  smartViews.list.onItemSet.add(updateFunction);
  smartViews.list.onItemUpdated.add(updateFunction);
  smartViews.list.onItemDeleted.add(updateFunction);
  smartViews.list.onCleared.add(updateFunction);

  return component
};
