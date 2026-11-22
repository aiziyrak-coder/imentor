/**
 * Bitta fani bor o'qituvchi o'z fanining ichiga QAMALIB qolmasligi kerak
 * (2026-09-29). Dastur uni avtomatik ochadi, shuning uchun "Fanlar" tugmasi
 * yagona chiqish yo'li — u orqali "Fanlarim" ro'yxatiga yetib boradi.
 *
 * 2026-11-17 (D5): fanni faqat administrator biriktiradi — "Fan qo'shish"
 * tugmasi yo'q, fani yo'q o'qituvchi aniq bo'sh holatni ko'radi.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnlineTeacherCabinet from './OnlineTeacherCabinet';
import { fetchTeacherMe, type TeacherMe } from './onlineTeacherApi';

const ONE_COURSE: TeacherMe = {
  is_online_teacher: true,
  full_name: 'Tursinoy Qaxorova',
  courses: [
    {
      syllabus_id: 12,
      subject_name: 'Maxsus pedagogika (Tibbiy pedagogika)',
      subject_code: 'malaka-tibbiy-pedagogika',
      department_name: 'Malaka oshirish va qayta tayyorlash',
      variant_label: '',
      topic_count: 18,
      instruction_language: 'uz',
      program: 'malaka',
    },
  ],
};

vi.mock('./onlineTeacherApi', async (orig) => ({
  ...(await orig<typeof import('./onlineTeacherApi')>()),
  fetchTeacherMe: vi.fn(async () => ONE_COURSE),
  fetchTeacherTopics: vi.fn(async () => []),
}));

describe('OnlineTeacherCabinet', () => {
  beforeEach(() => {
    vi.mocked(fetchTeacherMe).mockImplementation(async () => ONE_COURSE);
  });

  it('lets a teacher with a single course get back to the course list', async () => {
    render(<OnlineTeacherCabinet onUnauthorized={vi.fn()} program="malaka" />);

    // Yagona fan avtomatik ochiladi.
    await screen.findByRole('heading', { name: 'Maxsus pedagogika (Tibbiy pedagogika)' });

    // Ortga qaytish tugmasi ishlashi SHART — ilgari u o'chirilgan edi.
    const back = screen.getByRole('button', { name: /Fanlar/ });
    expect(back).not.toBeDisabled();
    fireEvent.click(back);

    // "Fanlarim" ro'yxati — fan bor, lekin o'zi fan qo'shish tugmasi YO'Q.
    await screen.findByRole('heading', { name: 'Fanlarim' });
    expect(screen.getByText('Maxsus pedagogika (Tibbiy pedagogika)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fan qo/ })).toBeNull();
  });

  it('shows a clear empty state when no course is assigned', async () => {
    vi.mocked(fetchTeacherMe).mockImplementation(async () => ({
      is_online_teacher: false,
      courses: [],
    }));
    render(<OnlineTeacherCabinet onUnauthorized={vi.fn()} program="online" />);

    await screen.findByText('Sizga hali fan biriktirilmagan.');
    expect(screen.getByText('Fanni administrator biriktiradi.')).toBeInTheDocument();
    // Fan tanlash ro'yxati va tugmalari yo'q.
    expect(screen.queryByRole('button', { name: /Tanlash|Fan qo/ })).toBeNull();
  });
});
