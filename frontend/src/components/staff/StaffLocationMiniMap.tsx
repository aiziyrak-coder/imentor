import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { LeafletAttributionStrip } from '../map/LeafletAttributionStrip';
import './StaffLocationMiniMap.css';
import { type StaffGeoDetail, subscribeStaffGeoUpdate } from '../../utils/staffLocationGeo';

const DEFAULT_CENTER: [number, number] = [41.3111, 69.2797];

function MapRecenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: true });
  }, [map, center, zoom]);
  return null;
}

function buildYouAreHereIcon(): L.DivIcon {
  return L.divIcon({
    className: 'staff-mini-map-marker',
    html: `
<div style="margin-left:-20px;margin-top:-44px;width:40px;">
  <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(145deg,#0ea5e9,#0369a1);border:3px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;">
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M4 20.5v-1.2c0-2.8 4.2-4.3 8-4.3s8 1.5 8 4.3v1.2H4z"/></svg>
  </div>
</div>`.trim(),
    iconSize: [40, 44],
    iconAnchor: [20, 44],
    popupAnchor: [0, -40],
  });
}

/**
 * Joriy telefon joylashuvi (serverga yuborilgan GPS bilan bir xil `app:staff-geo-update` oqimi).
 */
export default function StaffLocationMiniMap() {
  const [geo, setGeo] = useState<StaffGeoDetail | null>(null);

  useEffect(() => {
    return subscribeStaffGeoUpdate(setGeo);
  }, []);

  const center: [number, number] = useMemo(
    () => (geo ? [geo.latitude, geo.longitude] : DEFAULT_CENTER),
    [geo],
  );
  const zoom = geo ? 16 : 12;
  const icon = useMemo(() => buildYouAreHereIcon(), []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-black/10 bg-sky-50/40 shadow-inner h-[220px] sm:h-[260px]">
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        className="z-0 h-full w-full min-h-[220px] [&_.leaflet-control-attribution]:text-[9px]"
        style={{ height: '100%', width: '100%', minHeight: 220 }}
      >
        <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <LeafletAttributionStrip />
        <MapRecenter center={center} zoom={zoom} />
        {geo ? (
          <>
            {geo.accuracy_m != null && geo.accuracy_m > 5 && geo.accuracy_m < 500 ? (
              <Circle
                center={[geo.latitude, geo.longitude]}
                radius={geo.accuracy_m}
                pathOptions={{
                  color: '#0ea5e9',
                  fillColor: '#7dd3fc',
                  fillOpacity: 0.18,
                  weight: 1,
                }}
              />
            ) : null}
            <Marker position={[geo.latitude, geo.longitude]} icon={icon}>
              <Popup>
                <div className="text-[12px] leading-snug">
                  <strong className="text-black/90">Sizning joyingiz</strong>
                  <div className="mt-1 font-mono text-[11px] text-black/60">
                    {geo.latitude.toFixed(5)}, {geo.longitude.toFixed(5)}
                  </div>
                  {geo.accuracy_m != null ? (
                    <div className="mt-1 text-[11px] text-black/50">Taxminiy aniqlik: ±{Math.round(geo.accuracy_m)} m</div>
                  ) : null}
                </div>
              </Popup>
            </Marker>
          </>
        ) : null}
      </MapContainer>

      {!geo ? (
        <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center bg-black/10 px-4 backdrop-blur-[1px]">
          <p className="pointer-events-auto rounded-xl bg-white/95 px-4 py-3 text-center text-[12px] font-medium text-black/75 shadow-lg">
            GPS joylashuvi hali kelmayapti. Yuqoridagi{' '}
            <strong className="text-sky-800">«Joylashuv ruxsatini berish»</strong> tugmasini bosing yoki biroz kutib
            turing.
          </p>
        </div>
      ) : null}
    </div>
  );
}
