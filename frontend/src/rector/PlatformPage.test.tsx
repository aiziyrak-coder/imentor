import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlatformPage from './PlatformPage';

vi.mock('./ControlReport', () => ({ default: () => <p>UMUMIY HISOBOT</p> }));
vi.mock('./rectorApi', async (orig) => ({
  ...(await orig<typeof import('./rectorApi')>()),
  fetchPlatforms: vi.fn(async () => ({ platforms: [], missing: [] })),
}));

const filters = { from: '2026-10-05', to: '2026-10-10' };

function page() {
  render(
    <PlatformPage platform="imentor" filters={filters} onUnauthorized={vi.fn()} onBack={vi.fn()} />,
  );
}

describe('PlatformPage — iMentor (2026-11-15: faqat hisobot)', () => {
  it('sarlavha, «Tizimlar» va bo‘lim tugmalari yo‘q — faqat umumiy hisobot', () => {
    page();
    expect(screen.getByText('UMUMIY HISOBOT')).toBeTruthy();
    for (const name of ['Tizimlar', 'Kun bo‘yicha', 'Monitor xonalari', 'Dars jadvali', 'AI tahlil']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByText('Darsga tayyorgarlik (iMentor)')).toBeNull();
  });
});
