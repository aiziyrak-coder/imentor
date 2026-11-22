import type { ReactNode } from 'react';
import type { MonitorSlot } from './rectorApi';
import { useOpenTeacher } from './TeacherProfileContext';

/**
 * O'qituvchi ismi — bosilsa uning to'liq hisoboti ochiladi. Jadval qatori
 * ichida turgan bo'lsa ham qatorning o'z bosilishiga (masalan ochilish)
 * tegmaydi.
 */
export default function TeacherName({
  teacherKey,
  name,
  slots,
  className = '',
  children,
}: {
  teacherKey: string;
  name: string;
  slots?: MonitorSlot[];
  className?: string;
  children?: ReactNode;
}) {
  const open = useOpenTeacher();
  if (!open || !name) return <span className={className}>{children ?? name}</span>;
  return (
    <button
      type="button"
      title="To‘liq hisobotni ochish"
      onClick={(e) => {
        e.stopPropagation();
        open({ key: teacherKey, name, slots });
      }}
      className={`text-left underline decoration-slate-300 decoration-dotted underline-offset-2 hover:text-sky-700 hover:decoration-sky-500 ${className}`}
    >
      {children ?? name}
    </button>
  );
}
