import type { ViewerBimContext } from './viewer-bim-context';
export type ScheduleColumn={id:string;label:string;source:'stored_parameter';setName:string;propertyName:string};
export type ScheduleCell={status:'resolved'|'multiple'|'ambiguous'|'missing';value:string|null;observations:number};
export type ScheduleRow={key:string;identityKey:string;context:ViewerBimContext;representativeLocalId:number;
  memberLocalIds:number[];graphicalLocalIds:number[];modelName:string;name:string|null;logicalIfcClass:string|null;
  elementType:string|null;level:string|null;authoringElementId:string|null;sector:string|null;partida:string|null;cells:Record<string,ScheduleCell>};
export type ScheduleConfiguration={version:1;columns:ScheduleColumn[];filters:Record<string,string|boolean>};
export const scheduleBaseColumns=['Modelo','Clase IFC lógica','Elemento','Tipo','Nivel'] as const;
export function scheduleCellText(cell?:ScheduleCell) {
  return !cell||cell.status==='missing'?'—':cell.status==='multiple'?'Múltiple':cell.status==='ambiguous'?'Ambiguo':cell.value??'—';
}
export function scheduleValues(row:ScheduleRow,columns:ScheduleColumn[]) {
  return [row.modelName,row.logicalIfcClass??'—',row.name??row.identityKey,row.elementType??'—',row.level??'—',...columns.map(c=>scheduleCellText(row.cells[c.id]))];
}
export function scheduleCsv(rows:ScheduleRow[],columns:ScheduleColumn[]) {
  const escape=(v:string)=>`"${(/^[=+@\t\r-]/.test(v)?"'"+v:v).replaceAll('"','""')}"`;
  return '\ufeff'+[[...scheduleBaseColumns,...columns.map(c=>c.label)],...rows.map(r=>scheduleValues(r,columns))]
    .map(row=>row.map(escape).join(',')).join('\r\n');
}
