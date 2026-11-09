import { mobileBridge, nativeRequest } from './native';
export interface LatLng {
  lat: number;
  lng: number;
}

export const DEFAULT_DEMO_CENTER = { lat: -12.083, lng: -77.051 };
export const DEMO_DISTRICT = 'Zona de demostración';
export const DEMO_CENTER: LatLng = { ...DEFAULT_DEMO_CENTER };

export const DISTRICTS = [
  { name: 'Jesús María', lat: -12.083, lng: -77.051 },
  { name: 'Pueblo Libre', lat: -12.076, lng: -77.063 },
  { name: 'Breña', lat: -12.058, lng: -77.05 },
  { name: 'Magdalena del Mar', lat: -12.09, lng: -77.07 },
  { name: 'San Miguel', lat: -12.077, lng: -77.085 },
  { name: 'Lince', lat: -12.085, lng: -77.035 },
  { name: 'San Isidro', lat: -12.097, lng: -77.036 },
  { name: DEMO_DISTRICT, ...DEMO_CENTER },
];

export function setDemoCenter(point: LatLng) {
  DEMO_CENTER.lat = point.lat;
  DEMO_CENTER.lng = point.lng;
  const district = DISTRICTS.find(item => item.name === DEMO_DISTRICT);
  if (district) {
    district.lat = point.lat;
    district.lng = point.lng;
  }
}

export function translateLocation(point: LatLng, from: LatLng, to: LatLng): LatLng {
  const metersPerDegree = 111_320;
  const north = (point.lat - from.lat) * metersPerDegree;
  const east = (point.lng - from.lng) * metersPerDegree * Math.cos(from.lat * Math.PI / 180);
  return {
    lat: to.lat + north / metersPerDegree,
    lng: to.lng + east / (metersPerDegree * Math.cos(to.lat * Math.PI / 180)),
  };
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

export function distanceWeight(meters: number): number {
  if (meters <= 200) return 1;
  if (meters <= 500) return 0.75;
  if (meters <= 800) return 0.5;
  return 0.25;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatCuadras(meters: number): string {
  const cuadras = Math.max(1, Math.round(meters / 100));
  return `${cuadras} ${cuadras === 1 ? 'cuadra' : 'cuadras'}`;
}

export function nearestDistrict(coords: LatLng): string {
  let best = DISTRICTS[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const district of DISTRICTS) {
    const distance = distanceMeters(coords, district);
    if (distance < bestDistance) {
      best = district;
      bestDistance = distance;
    }
  }

  return best.name;
}

export function getCurrentPosition(): Promise<{
  coords: LatLng;
  source: 'gps' | 'demo';
}> {
  if (typeof window !== 'undefined' && mobileBridge()) return nativeRequest('location').then(({lat,lng})=>{
    if(typeof lat!=='number' || typeof lng!=='number')throw new Error('No se recibió la ubicación.');
    return {coords:{lat,lng},source:'gps' as const};
  });
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ coords: DEMO_CENTER, source: 'demo' });
      return;
    }

    const timeout = window.setTimeout(() => {
      resolve({ coords: DEMO_CENTER, source: 'demo' });
    }, 13000);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timeout);
        resolve({
          coords: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          source: 'gps',
        });
      },
      () => {
        window.clearTimeout(timeout);
        resolve({ coords: DEMO_CENTER, source: 'demo' });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

export async function getDeviceLocation(): Promise<LatLng> {
  if (typeof window !== 'undefined' && mobileBridge()) {
    const {lat,lng}=await nativeRequest('location');
    if(typeof lat!=='number' || typeof lng!=='number')throw new Error('No se recibió la ubicación del teléfono.');
    return {lat,lng};
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new Error('El GPS requiere una conexión segura (HTTPS). Abre Ayni por HTTPS y permite la ubicación.');
  }
  if (!navigator.geolocation) throw new Error('Este navegador no permite obtener la ubicación.');
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(
    ({coords})=>resolve({lat:coords.latitude,lng:coords.longitude}),
    error=>reject(new Error(
      error.code === 1
        ? 'El permiso de ubicación está denegado. Actívalo en los permisos del navegador y vuelve a intentar.'
        : error.code === 2
          ? 'El dispositivo no pudo determinar la ubicación. Revisa que el GPS esté activado y vuelve a intentar.'
          : 'La solicitud de ubicación tardó demasiado. Reintenta en un lugar con mejor señal.',
    )),
    {enableHighAccuracy:true,timeout:15000,maximumAge:0},
  ));
}

export function tileFor(lat: number, lng: number, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y, z: zoom };
}

export function isNearby(a: LatLng, b: LatLng, radiusM = 800): boolean {
  return distanceMeters(a, b) <= radiusM;
}

export async function gpsPoint() {
 const result=await getCurrentPosition();
 if(result.source!=='gps')throw new Error('Activa la ubicación en los permisos del navegador y vuelve a intentarlo.');
 return result.coords;
}
