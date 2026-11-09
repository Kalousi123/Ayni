import type { Alert } from '../db/types';

export interface AlertDensityCell {
  id: string;
  lat: number;
  lng: number;
  count: number;
  critical: number;
  high: number;
  medium: number;
}

const CELL_SIZE=0.003;

export function aggregateAlertDensity(alerts:Alert[]):AlertDensityCell[]{
  const cells=new Map<string,AlertDensityCell>();
  for(const alert of alerts){
    const row=Math.floor(alert.lat/CELL_SIZE);
    const column=Math.floor(alert.lng/CELL_SIZE);
    const id=`${row}:${column}`;
    let cell=cells.get(id);
    if(!cell){
      cell={id,lat:(row+0.5)*CELL_SIZE,lng:(column+0.5)*CELL_SIZE,count:0,critical:0,high:0,medium:0};
      cells.set(id,cell);
    }
    cell.count++;
    cell[alert.severity]++;
  }
  return [...cells.values()].sort((a,b)=>b.count-a.count);
}
