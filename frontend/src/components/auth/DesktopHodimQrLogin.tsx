import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import {
  createDevicePairingSession,
  pollDevicePairingStatus,
} from '../../utils/devicePairingApi';
import { writeBackendTokensFromPair } from '../../utils/backendAuth';
import {
  establishLocalSessionFromProfile,
  type LocalStaffUser,
} from '../../utils/localStaffAuth';
import { markDesktopPairedSession } from '../../utils/deviceSession';

type Props = {
  onOtherRoles: () => void;
};

export default function DesktopHodimQrLogin({ onOtherRoles }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expiresLabel, setExpiresLabel] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPairing = useCallback(async () => {
    stopPoll();
    setLoading(true);
    setError(null);
    try {
      const created = await createDevicePairingSession();
      setPairingToken(created.pairing_token);
      const url = await QRCode.toDataURL(created.qr_payload, {
        width: 280,
        margin: 2,
        color: { dark: '#083047', light: '#ffffff' },
      });
      setQrDataUrl(url);
      const exp = new Date(created.expires_at);
      setExpiresLabel(exp.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }));

      pollRef.current = setInterval(async () => {
        try {
          const st = await pollDevicePairingStatus(created.pairing_token);
          if (st.status !== 'confirmed' || !st.access || !st.refresh) return;
          stopPoll();
          const profile = st.profile as LocalStaffUser | undefined;
          if (!profile?.phoneDigits || !profile.password) {
            setError('Telefon tasdiqladi, lekin profil maʼlumoti yetarli emas. Qayta skanerlang.');
            return;
          }
          writeBackendTokensFromPair({
            access: st.access,
            refresh: st.refresh,
            role: (st.role as 'hodim') || 'hodim',
            username: st.username || profile.phoneDigits,
          });
          establishLocalSessionFromProfile({ ...profile, role: 'hodim' });
          markDesktopPairedSession();
        } catch {
          /* polling */
        }
      }, 2000);
    } catch {
      setError('QR yaratib bo‘lmadi. Internetni tekshirib, yangilang.');
    } finally {
      setLoading(false);
    }
  }, [stopPoll]);

  useEffect(() => {
    void startPairing();
    return () => stopPoll();
  }, [startPairing, stopPoll]);

  return (
    <div className="w-full max-w-md mx-auto space-y-5">
      <div className="text-center space-y-2">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-sky-600 text-white flex items-center justify-center shadow-lg">
          <Monitor size={28} />
        </div>
        <h2 className="text-2xl font-bold text-[#083047] tracking-tight">Kompyuter orqali kirish</h2>
        <p className="text-[14px] text-black/55 leading-relaxed">
          Telefoningizda iMentor ga <strong>login / parol</strong> bilan kiring, keyin shu QR kodni skanerlang.
          Joylashuv (GPS) faqat telefondan yuboriladi.
        </p>
      </div>

      <div className="rounded-3xl border border-white/80 bg-white/90 p-6 shadow-xl flex flex-col items-center gap-4">
        {loading && !qrDataUrl ? (
          <div className="py-16 flex flex-col items-center gap-3 text-black/50">
            <Loader2 className="animate-spin text-sky-600" size={36} />
            <span className="text-sm font-medium">QR tayyorlanmoqda…</span>
          </div>
        ) : qrDataUrl ? (
          <>
            <img src={qrDataUrl} alt="Kirish QR kodi" className="w-[280px] h-[280px] rounded-2xl" />
            {expiresLabel && (
              <p className="text-[12px] text-black/45">Amal qilish: ~{expiresLabel} gacha</p>
            )}
          </>
        ) : null}

        <div className="flex items-start gap-2 text-left w-full rounded-xl bg-sky-50/80 border border-sky-100 px-3 py-2.5">
          <Smartphone size={18} className="text-sky-700 shrink-0 mt-0.5" />
          <p className="text-[12px] text-sky-900/80 leading-snug">
            1) Telefon brauzerida kirish → 2) «Kompyuterni ulash» → 3) Shu kodni skanerlash
          </p>
        </div>

        {error && (
          <p className="text-[13px] text-rose-600 font-medium text-center">{error}</p>
        )}

        <button
          type="button"
          onClick={() => void startPairing()}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-sky-200 bg-white text-sky-800 font-semibold text-[14px] hover:bg-sky-50 transition-colors"
        >
          <RefreshCw size={18} />
          Yangi QR kod
        </button>
      </div>

      <button
        type="button"
        onClick={onOtherRoles}
        className="w-full text-center text-[13px] font-semibold text-black/50 hover:text-sky-700 underline underline-offset-2"
      >
        Administrator / tarjimon / startuper kirishi
      </button>
    </div>
  );
}
