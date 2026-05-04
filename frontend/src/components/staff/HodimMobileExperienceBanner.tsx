import React, { useMemo, useState } from 'react';
import { Copy, Smartphone, X, QrCode } from 'lucide-react';
import {
  dismissHodimMobileHint,
  isHodimMobileHintDismissed,
  isLikelyPhoneOrSmallTablet,
} from '../../utils/deviceDetection';

function pageUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.href.split('#')[0];
}

/**
 * Kompyuter/katta ekranda hodimga: telefonda ochish foydasi + havola + QR.
 * Majburiyat emas — o‘qituvchi o‘zi telefonni afzal ko‘radi (GPS, mobil UX).
 */
export default function HodimMobileExperienceBanner() {
  const [dismissed, setDismissed] = useState(() => isHodimMobileHintDismissed());

  const url = useMemo(() => pageUrl(), []);
  const qrSrc = useMemo(() => {
    if (!url) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=168x168&margin=8&data=${encodeURIComponent(url)}`;
  }, [url]);

  if (dismissed || isLikelyPhoneOrSmallTablet()) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Havolani nusxalang:', url);
    }
  };

  const close = () => {
    dismissHodimMobileHint();
    setDismissed(true);
  };

  return (
    <div className="ios-glass rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50/95 via-white/90 to-sky-50/90 px-4 py-3 shadow-sm print:hidden">
      <div className="flex gap-3">
        <div className="hidden sm:flex shrink-0 w-11 h-11 rounded-2xl bg-emerald-600 text-white items-center justify-center">
          <Smartphone size={22} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[14px] font-bold text-black/90 leading-snug">Telefonda iMentor — to‘liq ish rejimi</p>
              <p className="text-[12px] text-black/60 mt-1 leading-relaxed">
                Dars joylashuvi (GPS), haftalik jadval va bildirishnomalar telefon brauzerida barqarorroq ishlaydi.
                Istalgan vaqtda pastdagi QR orqali telefoningizda oching — majburiy emas, tavsiya etiladi.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="shrink-0 p-2 rounded-xl text-black/40 hover:bg-black/5 hover:text-black/70"
              aria-label="Yopish"
            >
              <X size={18} />
            </button>
          </div>
          <ul className="text-[11px] text-black/55 space-y-1 list-disc list-inside">
            <li>Bosh ekranga qo‘shing (Chrome / Safari: «Uyga qo‘shish») — ilova kabi tez ochiladi</li>
            <li>Joylashuv ruxsati telefonda odatda ishonchliroq beriladi</li>
          </ul>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2.5 text-[13px] font-semibold shadow-md shadow-emerald-600/20"
            >
              <Copy size={16} />
              Havolani nusxalash
            </button>
            {qrSrc ? (
              <div className="flex items-center gap-3">
                <div className="rounded-xl border border-black/10 bg-white p-2 shrink-0">
                  <img src={qrSrc} alt="" width={120} height={120} className="w-[120px] h-[120px]" loading="lazy" />
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-black/45">
                  <QrCode size={14} />
                  <span>Telefon kamerasi bilan skanerlang</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
