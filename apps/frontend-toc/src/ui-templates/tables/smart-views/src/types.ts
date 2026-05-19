import * as OBC from "@thatopen/components";

export interface SmartViewsListState {
  components: OBC.Components;
}

export type SmartViewsListTableData = {
  guid: string;
  Name: string;
  Actions: string;
};