import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Check, Loader2, LogOut } from 'lucide-react';
import {
  confirmDevicePairing,
  parsePairingTokenFromScan,
} from '../../utils/devicePairingApi';
import { getCurrentLocalUser, logoutLocalStaff } from '../../utils/localStaffAuth';
import { clearBackendAuthTokens } from '../../utils/backendAuth';
import { clearDesktopPairedSession } from '../../utils/deviceSession';
import { useStaffLocationTracking } from '../../hooks/useStaffLocationTracking';

const SCANNER_ID = 'hodim-qr-scanner-region';

export default function HodimMobileCompanion() {
  const user = getCurrentLocalUser();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startedRef = useRef(false);

  useStaffLocationTracking(true, { silent: true });

  const stopScanner = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (!s) return;
    try {
      if (s.isScanning) await s.stop();
      await s.clear();
    } catch {
      /* ignore */
    }
    setScanning(false);
  }, []);

  const onScanSuccess = useCallback(
    async (decoded: string) => {
      const token = parsePairingTokenFromScan(decoded);
      if (!token || !user || busy) return;
      setBusy(true);
      try {
        await stopScanner();
        await confirmDevicePairing(token, user);
        setLinked(true);
      } catch {
        setCameraError(true);
      } finally {
        setBusy(false);
      }
    },
    [user, busy, stopScanner],
  );

  const startScanner = useCallback(async () => {
    setCameraError(false);
    await stopScanner();
    setScanning(true);
    try {
      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.72, height: Math.min(w, h) * 0.72 }) },
        (text) => void onScanSuccess(text),
        () => {},
      );
    } catch {
      setScanning(false);
      setCameraError(true);
    }
  }, [onScanSuccess, stopScanner]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const t = window.setTimeout(() => void startScanner(), 400);
    return () => {
      window.clearTimeout(t);
      void stopScanner();
    };
  }, [startScanner, stopScanner]);

  const handleLogout = () => {
    void stopScanner();
    clearBackendAuthTokens();
    clearDesktopPairedSession();
    logoutLocalStaff();
  };

  if (!user) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <header
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <img src="/imentor-logo.png" alt="" className="w-9 h-9 rounded-xl object-cover opacity-90" />
        <button
          type="button"
          onClick={handleLogout}
          aria-label="Chiqish"
          className="w-11 h-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center active:bg-black/60"
        >
          <LogOut size={20} />
        </button>
      </header>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <div id={SCANNER_ID} className="absolute inset-0 w-full h-full [&_video]:object-cover" />

        {!scanning && !linked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 z-10">
            {busy ? (
              <Loader2 size={48} className="animate-spin text-white/80" />
            ) : cameraError ? (
              <button
                type="button"
                onClick={() => void startScanner()}
                className="px-6 py-3 rounded-full bg-white text-black font-semibold text-[15px]"
              >
                Kamerani yoqish
              </button>
            ) : (
              <Loader2 size={40} className="animate-spin text-white/60" />
            )}
          </div>
        )}

        {scanning && !linked && (
          <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
            <div className="w-[min(72vw,280px)] aspect-square rounded-3xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}

        {linked && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
              <Check size={44} strokeWidth={2.5} />
            </div>
          </div>
        )}
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 z-20 h-8 bg-gradient-to-t from-black/50 to-transparent pointer-events-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      />
    </div>
  );
}
