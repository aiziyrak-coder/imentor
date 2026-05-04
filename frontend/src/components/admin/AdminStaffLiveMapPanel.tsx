import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { CampusBuildingDto, StaffLocationPingDto } from '../../utils/staffLocationApi';

const DEFAULT_CENTER: [number, number] = [41.3111, 69.2797];

function latestPingByOwner(pings: StaffLocationPingDto[]): StaffLocationPingDto[] {
  const m = new Map<string, StaffLocationPingDto>();
  for (const p of pings) {
    const prev = m.get(p.owner_key);
    if (!prev || new Date(p.recorded_at).getTime() > new Date(prev.recorded_at).getTime()) {
      m.set(p.owner_key, p);
    }
  }
  return Array.from(m.values());
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6)
  );
}

function hueForOwner(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 72% 42%)`;
}

function formatAgeUz(recordedAt: string): string {
  const diff = Date.now() - new Date(recordedAt).getTime();
  if (diff < 60_000) return 'hozirgina';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} daq oldin`;
  return new Date(recordedAt).toLocaleString('uz-UZ');
}

function MapFitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    const valid = points.filter(([a, b]) => isValidLatLng(a, b));
    if (valid.length === 0) {
      map.setView(DEFAULT_CENTER, 12);
      return;
    }
    if (valid.length === 1) {
      map.setView(valid[0], 16);
      return;
    }
    const bounds = L.latLngBounds(valid);
    map.fitBounds(bounds, { padding: [56, 56], maxZoom: 17 });
  }, [map, points]);
  return null;
}

export type AdminStaffLiveMapPanelProps = {
  pings: StaffLocationPingDto[];
  buildings: CampusBuildingDto[];
  lastUpdated: Date | null;
  pollIntervalSec: number;
};

/**
 * OpenStreetMap + hodimlar oxirgi GPS pinglari (har hodimda bittadan) + kampus binolari radiuslari.
 */
export default function AdminStaffLiveMapPanel({
  pings,
  buildings,
  lastUpdated,
  pollIntervalSec,
}: AdminStaffLiveMapPanelProps) {
  const latest = useMemo(() => {
    return latestPingByOwner(pings)
      .filter((p) => isValidLatLng(p.latitude, p.longitude))
      .sort((a, b) => a.owner_key.localeCompare(b.owner_key));
  }, [pings]);

  const points = useMemo((): [number, number][] => {
    const pts: [number, number][] = latest.map((p) => [p.latitude, p.longitude]);
    for (const b of buildings) {
      if (b.is_active && isValidLatLng(b.latitude, b.longitude)) {
        pts.push([b.latitude, b.longitude]);
      }
    }
    return pts;
  }, [latest, buildings]);

  const center = useMemo((): [number, number] => (points.length > 0 ? points[0] : DEFAULT_CENTER), [points]);

  const activeBuildings = useMemo(
    () => buildings.filter((b) => b.is_active && isValidLatLng(b.latitude, b.longitude)),
    [buildings],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-black/65">
        <p>
          <strong className="text-black/90">{latest.length}</strong> hodimning oxirgi nuqtasi xaritada
          {lastUpdated ? (
            <span className="ml-2 text-black/55">· Maʼlumot: {lastUpdated.toLocaleTimeString('uz-UZ')}</span>
          ) : null}
        </p>
        <p className="text-emerald-800 font-semibold">Avto-yangilanish: {pollIntervalSec}s</p>
      </div>

      <div className="relative z-0 w-full overflow-hidden rounded-2xl border border-black/10 bg-sky-50/30 shadow-md h-[min(70vh,640px)] min-h-[420px]">
        <MapContainer
          center={center}
          zoom={13}
          scrollWheelZoom
          className="z-0 h-full w-full [&_.leaflet-control-attribution]:text-[10px]"
          style={{ height: '100%', width: '100%', minHeight: 420 }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapFitBounds points={points} />
          {activeBuildings.map((b) => (
            <Circle
              key={`b-${b.id}`}
              center={[b.latitude, b.longitude]}
              radius={b.radius_m}
              pathOptions={{
                color: '#0369a1',
                fillColor: '#7dd3fc',
                fillOpacity: 0.1,
                weight: 2,
              }}
            >
              <Popup>
                <div className="text-[13px] font-medium">
                  {b.name}
                  {b.short_code ? ` (${b.short_code})` : ''}
                </div>
                <div className="text-[11px] text-black/60">Ruxsat radiusi ≈ {b.radius_m} m</div>
              </Popup>
            </Circle>
          ))}
          {latest.map((p) => (
            <CircleMarker
              key={p.owner_key}
              center={[p.latitude, p.longitude]}
              radius={10}
              pathOptions={{
                color: '#0f172a',
                weight: 2,
                fillColor: hueForOwner(p.owner_key),
                fillOpacity: 0.92,
              }}
            >
              <Popup>
                <div className="min-w-[160px] text-[13px]">
                  <div className="font-mono font-semibold text-black/90">{p.owner_key}</div>
                  <div className="text-black/65">{formatAgeUz(p.recorded_at)}</div>
                  <div className="mt-1 font-mono text-[11px] text-black/50">
                    {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                  </div>
                  {p.accuracy_m != null ? (
                    <div className="text-[11px] text-black/55">Aniqlik: ±{Math.round(p.accuracy_m)} m</div>
                  ) : null}
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <div>
        <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-black/45">Hodimlar roʻyxati</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {latest.map((p) => (
            <div
              key={p.owner_key}
              className="flex items-start gap-2 rounded-xl border border-black/10 bg-white/95 px-3 py-2.5 text-[12px] shadow-sm"
            >
              <span
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
                style={{ background: hueForOwner(p.owner_key) }}
              />
              <div className="min-w-0">
                <div className="truncate font-mono font-semibold text-black/90">{p.owner_key}</div>
                <div className="text-black/55">{formatAgeUz(p.recorded_at)}</div>
              </div>
            </div>
          ))}
        </div>
        {latest.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/15 bg-black/[0.02] px-4 py-6 text-center text-[13px] text-black/45">
            Hozircha GPS ping yoʻq. Hodimlar ilovadan joylashuv yuborgan paytda bu yerda koʻrinadi.
          </p>
        ) : null}
      </div>
    </div>
  );
}
