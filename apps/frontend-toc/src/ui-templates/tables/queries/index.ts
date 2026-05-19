import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { QueriesListState, QueriesListTableData } from "./src/types";
import { queriesListTemplate } from "./src/template";
import { setDefaults } from "./src/set-defaults";

export const queriesList = (state: QueriesListState) => {
  const component = BUI.Component.create<BUI.Table<QueriesListTableData>, QueriesListState>(queriesListTemplate, state);

  const [table, updateTable] = component;

  setDefaults(state, table)

  const { components } = state;
  const finder = components.get(OBC.ItemsFinder);
  const updateFunction = () => updateTable();
  finder.list.onItemSet.add(updateFunction);
  finder.list.onItemUpdated.add(updateFunction);
  finder.list.onItemDeleted.add(updateFunction);
  finder.list.onCleared.add(updateFunction);

  return component
};
