import { describe, expect, it } from 'vitest';
import { aggregateAlertDensity } from '../src/lib/alert-density';
import type { Alert } from '../src/db/types';

const alert=(id:string,lat:number,lng:number,severity:Alert['severity']):Alert=>({
  id,severity,category:'incendio',title:'Alerta',description:'Prueba',authorId:'vecino',
  district:'Jesús María',lat,lng,status:'pending',createdAt:'2026-01-01',updatedAt:'2026-01-01',
  version:1,syncStatus:'synced',
});

describe('alert density',()=>{
  it('groups nearby alerts into approximate cells and counts severity',()=>{
    const cells=aggregateAlertDensity([
      alert('a',-12.0831,-77.0511,'critical'),
      alert('b',-12.0838,-77.0518,'high'),
      alert('c',-12.0731,-77.0411,'medium'),
    ]);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({count:2,critical:1,high:1,medium:0});
  });
});
