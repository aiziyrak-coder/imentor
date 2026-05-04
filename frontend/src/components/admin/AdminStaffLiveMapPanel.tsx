import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './AdminStaffLiveMapPanel.css';
import type { CampusBuildingDto, StaffLocationPingDto } from '../../utils/staffLocationApi';
import type { LocalStaffUser } from '../../utils/localStaffAuth';

const DEFAULT_CENTER: [number, number] = [41.3111, 69.2797];

/** Oddiy odam silueti (SVG) */
const PERSON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="white" d="M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/>
  <path fill="white" d="M4 20.5v-1.2c0-2.8 4.2-4.3 8-4.3s8 1.5 8 4.3v1.2H4z"/>
</svg>
`.trim();

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

function findStaffProfile(ownerKey: string, directory: LocalStaffUser[]): LocalStaffUser | undefined {
  return directory.find((u) => u.phoneDigits === ownerKey);
}

function initialsFromProfile(u: LocalStaffUser | undefined, fallbackKey: string): string {
  if (u) {
    const a = (u.firstName || '').trim().charAt(0);
    const b = (u.lastName || '').trim().charAt(0);
    if (a || b) return (a + b).toUpperCase();
    const n = (u.displayName || '').trim();
    if (n.length >= 2) return n.slice(0, 2).toUpperCase();
  }
  return fallbackKey.slice(-2);
}

/**
 * Pin: dumaloq ichida odam ikonkasi + kichik uchburchak.
 */
function buildStaffPinHtml(accentColor: string): string {
  return `
<div style="display:flex;flex-direction:column;align-items:center;width:52px;margin-left:-26px;margin-top:-56px;">
  <div class="staff-pin-head" style="width:46px;height:46px;border-radius:50%;background:${accentColor};border:3px solid #fff;display:flex;align-items:center;justify-content:center;">
    ${PERSON_SVG}
  </div>
  <div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:11px solid ${accentColor};margin-top:-3px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.3));"></div>
</div>`.trim();
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

type StaffMarkerProps = {
  ping: StaffLocationPingDto;
  profile?: LocalStaffUser;
};

function StaffMarker({ ping, profile }: StaffMarkerProps) {
  const accent = hueForOwner(ping.owner_key);
  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'staff-leaflet-marker',
        html: buildStaffPinHtml(accent),
        iconSize: [52, 56],
        iconAnchor: [26, 56],
        popupAnchor: [0, -54],
      }),
    [accent],
  );

  const title = profile?.displayName?.trim() || 'Hodim';
  const subtitle = profile?.jobTitle?.trim() || profile?.department?.trim() || '';

  return (
    <Marker position={[ping.latitude, ping.longitude]} icon={icon}>
      <Popup maxWidth={340}>
        <div className="min-w-[260px] max-w-[300px] space-y-3 text-[13px] text-black/90">
          <div className="flex gap-3 border-b border-black/10 pb-3">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-md"
              style={{ background: `linear-gradient(145deg, ${accent}, #0f172a)` }}
              aria-hidden
            >
              {initialsFromProfile(profile, ping.owner_key)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold leading-tight text-black/95">{title}</div>
              {subtitle ? <div className="mt-0.5 text-[12px] text-black/55">{subtitle}</div> : null}
              <div className="mt-1 font-mono text-[12px] text-sky-700">{profile?.phoneDisplay ?? ping.owner_key}</div>
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 text-[12px]">
            {profile?.faculty ? (
              <>
                <dt className="text-black/45">Fakultet</dt>
                <dd className="font-medium text-black/80">{profile.faculty}</dd>
              </>
            ) : null}
            {profile?.department ? (
              <>
                <dt className="text-black/45">Kafedra</dt>
                <dd className="font-medium text-black/80">{profile.department}</dd>
              </>
            ) : null}
            {profile?.direction ? (
              <>
                <dt className="text-black/45">Yo‘nalish</dt>
                <dd className="text-black/80">{profile.direction}</dd>
              </>
            ) : null}
            <dt className="text-black/45">GPS vaqt</dt>
            <dd className="font-medium text-black/85">{formatAgeUz(ping.recorded_at)}</dd>
            <dt className="text-black/45">Koordinata</dt>
            <dd className="font-mono text-[11px] text-black/70">
              {ping.latitude.toFixed(5)}, {ping.longitude.toFixed(5)}
            </dd>
            <dt className="text-black/45">Aniqlik</dt>
            <dd className="text-black/80">
              {ping.accuracy_m != null ? `±${Math.round(ping.accuracy_m)} m` : '—'}
            </dd>
            <dt className="text-black/45">Backend ID</dt>
            <dd className="font-mono text-[11px] text-black/55">{ping.owner_key}</dd>
          </dl>
        </div>
      </Popup>
    </Marker>
  );
}

export type AdminStaffLiveMapPanelProps = {
  pings: StaffLocationPingDto[];
  buildings: CampusBuildingDto[];
  lastUpdated: Date | null;
  pollIntervalSec: number;
  /** Mahalliy hodim roʻyxati — popup va pastki kartochkalarda F.I.O. */
  staffDirectory: LocalStaffUser[];
  /** Tanlangan filtr (12 raqam) — bo‘sh ping uchun aniqroq xabar */
  filterOwnerDigits?: string;
};

/**
 * OpenStreetMap + hodimlar oxirgi GPS pinglari (har hodimda bittadan) + kampus binolari radiuslari.
 */
export default function AdminStaffLiveMapPanel({
  pings,
  buildings,
  lastUpdated,
  pollIntervalSec,
  staffDirectory,
  filterOwnerDigits = '',
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

  const filterDigits = filterOwnerDigits.replace(/\D/g, '');
  const filteredSelectedNoData = filterDigits.length >= 12 && latest.length === 0;

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

      {filteredSelectedNoData ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
          <strong>Tanlangan hodim</strong> uchun hali GPS kelmayapti. Hodim{' '}
          <strong>telefonda ilovani ochib</strong>, joylashuv ruxsatini berishi va (mavjud bo‘lsa) hodim kabinetida GPS
          kuzatuvi yoqilgan bo‘lishi kerak; birinchi pingdan keyin xaritada odam belgisi paydo bo‘ladi.
        </div>
      ) : null}

      <div className="relative z-0 w-full overflow-hidden rounded-2xl border border-black/10 bg-sky-50/30 shadow-md h-[min(70vh,640px)] min-h-[420px]">
        <MapContainer
          center={center}
          zoom={13}
          scrollWheelZoom
          className="z-0 h-full w-full [&_.leaflet-control-attribution]:text-[10px] [&_.leaflet-popup-content]:m-3 [&_.leaflet-popup-content]:mr-6"
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
            <StaffMarker
              key={p.owner_key}
              ping={p}
              profile={findStaffProfile(p.owner_key, staffDirectory)}
            />
          ))}
        </MapContainer>
      </div>

      <div>
        <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-black/45">Hodimlar roʻyxati</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {latest.map((p) => {
            const profile = findStaffProfile(p.owner_key, staffDirectory);
            const accent = hueForOwner(p.owner_key);
            return (
              <div
                key={p.owner_key}
                className="flex items-start gap-3 rounded-xl border border-black/10 bg-white/95 px-3 py-2.5 text-[12px] shadow-sm"
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white shadow"
                  style={{
                    background: `linear-gradient(145deg, ${accent}, #0f172a)`,
                  }}
                  aria-hidden
                >
                  {initialsFromProfile(profile, p.owner_key)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-black/90">
                    {profile?.displayName ?? p.owner_key}
                  </div>
                  <div className="font-mono text-[11px] text-black/45">{p.owner_key}</div>
                  <div className="text-black/55">{formatAgeUz(p.recorded_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
        {latest.length === 0 ? (
          <div className="space-y-2 rounded-xl border border-dashed border-black/15 bg-black/[0.02] px-4 py-6 text-center text-[13px] text-black/50">
            <p>
              Hozircha xaritada <strong className="text-black/70">GPS ping yoʻq</strong> — markerlar paydo boʻlishi uchun
              hodimlar ilovadan joylashuv yuborishi kerak.
            </p>
            <p className="text-[12px] text-black/40">
              Masalan, hodim brauzerda tizimga kirgan boʻlsa, joylashuv kuzatuvi yoqilgan paytda ping ketadi.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
