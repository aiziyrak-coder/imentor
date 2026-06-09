/** AI (DeepSeek proxy) xatolarini foydalanuvchi tilida ko‘rsatish */
export function messageFromAiError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (
    msg === 'no-backend-token' ||
    msg.includes('JWT') ||
    msg.includes('tizimga kirish') ||
    msg.includes('HTTP 401')
  ) {
    return 'AI uchun serverga kirish kerak. Chiqing va qayta kiring (hodim kompyuterda QR bilan kirgan bo‘lsa, telefonda qayta skanerlang).';
  }
  if (msg.includes('HTTP 403')) {
    return 'Bu modul uchun ruxsat yetarli emas. Hodim yoki tegishli rol bilan kiring.';
  }
  if (msg.includes('HTTP 503') || msg.includes('OpenAI') || msg.includes('sozlanmagan')) {
    return 'Taqdimot AI (OpenAI) serverda sozlanmagan. Administratorga murojaat qiling.';
  }
  return fallback;
}
