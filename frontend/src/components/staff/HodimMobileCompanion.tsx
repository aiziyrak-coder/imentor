import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Loader2, LogOut, MapPin, QrCode, Shield, CheckCircle2 } from 'lucide-react';
import {
  confirmDevicePairing,
  parsePairingTokenFromScan,
} from '../../utils/devicePairingApi';
import {
  getCurrentLocalUser,
  logoutLocalStaff,
  type LocalStaffUser,
} from '../../utils/localStaffAuth';
import { clearBackendAuthTokens } from '../../utils/backendAuth';
import { clearDesktopPairedSession } from '../../utils/deviceSession';
import { useStaffLocationTracking } from '../../hooks/useStaffLocationTracking';
import HodimGpsPromptBar from './HodimGpsPromptBar';

const SCANNER_ID = 'hodim-qr-scanner-region';

export default function HodimMobileCompanion() {
  const user = getCurrentLocalUser();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useStaffLocationTracking(true);

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
      if (!token || !user) return;
      setBusy(true);
      setError(null);
      try {
        await stopScanner();
        await confirmDevicePairing(token, user);
        setMessage('Kompyuter ulandi. U yerda dars modullaridan foydalanishingiz mumkin. GPS shu telefondan yuboriladi.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ulashib bo‘lmadi. QR yangilab qayta skanerlang.');
      } finally {
        setBusy(false);
      }
    },
    [user, stopScanner],
  );

  const startScanner = useCallback(async () => {
    setError(null);
    setMessage(null);
    await stopScanner();
    setScanning(true);
    try {
      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 8, qrbox: { width: 240, height: 240 } },
        (text) => void onScanSuccess(text),
        () => {},
      );
    } catch {
      setScanning(false);
      setError('Kamera ochilmadi. Ruxsat bering yoki brauzer sozlamalarini tekshiring.');
    }
  }, [onScanSuccess, stopScanner]);

  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, [stopScanner]);

  const handleLogout = () => {
    void stopScanner();
    clearBackendAuthTokens();
    clearDesktopPairedSession();
    logoutLocalStaff();
  };

  if (!user) return null;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-gradient-to-br from-[#eef6ff] via-[#f5f8ff] to-[#f3f0ff] p-4 pb-8">
      <header className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-[#083047] truncate">iMentor — mobil</h1>
          <p className="text-[12px] text-black/50 truncate">{user.displayName}</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-600 bg-white/80 border border-rose-100 text-[12px] font-semibold"
        >
          <LogOut size={16} />
          Chiqish
        </button>
      </header>

      <div className="space-y-3 mb-4">
        <HodimGpsPromptBar />
        <div className="ios-glass rounded-2xl border border-emerald-200/80 bg-emerald-50/60 px-3 py-2.5 flex items-start gap-2">
          <MapPin size={18} className="text-emerald-700 shrink-0 mt-0.5" />
          <p className="text-[12px] text-emerald-900/85 leading-snug">
            Joylashuvingiz administrator xaritasiga <strong>shu telefon</strong> orqali yuboriladi.
            Kompyuter GPS yubormaydi.
          </p>
        </div>
      </div>

      <div className="flex-1 ios-glass rounded-3xl border border-white/70 p-4 flex flex-col items-center shadow-lg">
        <div className="flex items-center gap-2 text-[#083047] mb-3">
          <QrCode size={22} />
          <h2 className="text-[16px] font-bold">Kompyuterni ulash</h2>
        </div>
        <p className="text-[13px] text-black/55 text-center mb-4 leading-relaxed">
          Kompyuterdagi QR kodni skanerlang. Shundan keyin kompyuterda taqdimot va boshqa modullar ochiladi.
        </p>

        <div
          id={SCANNER_ID}
          className={`w-full max-w-sm aspect-square rounded-2xl overflow-hidden bg-black/5 border-2 border-dashed border-sky-200 ${
            scanning ? '' : 'hidden'
          }`}
        />

        {!scanning && (
          <div className="w-full max-w-sm aspect-square rounded-2xl bg-sky-50/50 border border-sky-100 flex flex-col items-center justify-center gap-2 text-black/40">
            <Shield size={40} className="opacity-40" />
            <span className="text-[13px] font-medium">Kamera hali yoqilmagan</span>
          </div>
        )}

        {message && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 w-full">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-[12px] text-emerald-900">{message}</p>
          </div>
        )}
        {error && (
          <p className="mt-3 text-[13px] text-rose-600 font-medium text-center">{error}</p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => (scanning ? void stopScanner() : void startScanner())}
          className="mt-5 w-full max-w-sm py-3.5 rounded-2xl bg-sky-600 text-white font-semibold text-[15px] shadow-md disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={20} className="animate-spin" /> : null}
          {scanning ? 'Skanerni to‘xtatish' : 'QR skanerni yoqish'}
        </button>
      </div>
    </div>
  );
}
