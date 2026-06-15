import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { LeafletAttributionStrip } from '../map/LeafletAttributionStrip';
import { defaultRectBoundary, normalizeBoundary, type LatLngTuple } from '../../utils/staffLocationGeo';
import type { CampusBuildingDto } from '../../utils/staffLocationApi';

type Props = {
  building: CampusBuildingDto;
  saving?: boolean;
  onSave: (boundary: LatLngTuple[]) => void | Promise<void>;
  onCancel: () => void;
};

function MapCenter({ lat, lng, zoom }: { lat: number; lng: number; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], zoom);
  }, [map, lat, lng, zoom]);
  return null;
}

function MapClickAdd({ enabled, onAdd }: { enabled: boolean; onAdd: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      onAdd(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function CampusBuildingBoundaryEditor({ building, saving = false, onSave, onCancel }: Props) {
  const [points, setPoints] = useState<LatLngTuple[]>(() => normalizeBoundary(building.boundary));
  const [drawMode, setDrawMode] = useState(true);

  const closedRing = useMemo(() => {
    if (points.length < 3) return points;
    return [...points, points[0]];
  }, [points]);

  const addPoint = (lat: number, lng: number) => {
    setPoints((prev) => [...prev, [lat, lng]]);
  };

  const undo = () => setPoints((prev) => prev.slice(0, -1));
  const clear = () => setPoints([]);
  const useDefaultRect = () => setPoints(defaultRectBoundary(building.latitude, building.longitude, 55, 45));

  const save = () => {
    if (points.length < 3) return;
    void onSave(points);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-bold text-black/90">Bino chegarasi: {building.name}</h3>
          <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-black/55">
            Xaritada bino devorlari bo‘ylab bosib nuqtalar qo‘ying (kamida 3 ta). Yopiq hudud chiziladi — hodim faqat
            shu ichida bo‘lsa «ish joyida» deb hisoblanadi.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDrawMode((v) => !v)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
              drawMode ? 'bg-sky-700 text-white' : 'bg-white text-black/70 border border-black/10'
            }`}
          >
            {drawMode ? 'Chizish yoqilgan' : 'Chizish o‘chiq'}
          </button>
          <button
            type="button"
            onClick={undo}
            disabled={points.length === 0}
            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-[12px] font-semibold text-black/70 disabled:opacity-40"
          >
            Orqaga
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-[12px] font-semibold text-black/70"
          >
            Tozalash
          </button>
          <button
            type="button"
            onClick={useDefaultRect}
            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-[12px] font-semibold text-black/70"
          >
            Taxminiy to‘rtburchak
          </button>
        </div>
      </div>

      <div className="h-[min(50vh,420px)] min-h-[300px] overflow-hidden rounded-xl border border-black/10">
        <MapContainer
          center={[building.latitude, building.longitude]}
          zoom={17}
          scrollWheelZoom
          className="h-full w-full"
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <LeafletAttributionStrip />
          <MapCenter lat={building.latitude} lng={building.longitude} zoom={17} />
          <MapClickAdd enabled={drawMode} onAdd={addPoint} />
          <CircleMarker
            center={[building.latitude, building.longitude]}
            radius={6}
            pathOptions={{ color: '#0369a1', fillColor: '#0ea5e9', fillOpacity: 0.9, weight: 2 }}
          />
          {points.length >= 2 ? (
            <Polyline positions={points} pathOptions={{ color: '#0369a1', weight: 3, dashArray: '6 4' }} />
          ) : null}
          {points.length >= 3 ? (
            <Polygon
              positions={points}
              pathOptions={{ color: '#0369a1', fillColor: '#7dd3fc', fillOpacity: 0.35, weight: 2 }}
            />
          ) : null}
          {closedRing.length >= 2 ? (
            <Polyline positions={closedRing} pathOptions={{ color: '#0284c7', weight: 1, opacity: 0.5 }} />
          ) : null}
          {points.map((pt, i) => (
            <CircleMarker
              key={`${i}-${pt[0]}-${pt[1]}`}
              center={pt}
              radius={5}
              pathOptions={{ color: '#fff', fillColor: '#0369a1', fillOpacity: 1, weight: 2 }}
            />
          ))}
        </MapContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px]">
        <span className="text-black/55">
          Nuqtalar: <strong className="text-black/80">{points.length}</strong>
          {points.length < 3 ? ' (yana kamida ' + (3 - points.length) + ' ta kerak)' : ''}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-black/60">
            Bekor
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || points.length < 3}
            className="rounded-lg bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            Chegarani saqlash
          </button>
        </div>
      </div>
    </div>
  );
}
