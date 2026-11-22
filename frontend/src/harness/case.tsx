/**
 * Keys ko'rinishini serversiz ko'rish (dizayn tekshiruvi).
 *
 * `case-harness.html` faqat `npm run dev` da ochiladi, `vite build` uni
 * yig'maydi. HAQIQIY `CaseScenarioView` / `CaseAnswerView` chiziladi;
 * keys matni to'qima — haqiqiy bemor yoki ism yo'q.
 */
import { createRoot } from 'react-dom/client';
import '../index.css';
import CaseScenarioView from '../components/staff/CaseScenarioView';
import CaseAnswerView from '../components/staff/CaseAnswerView';

const SCENARIO = [
  '### Bemor',
  "58 yoshli erkak, haydovchi. Tez yordam bilan qabul bo'limiga keltirilgan.",
  '',
  '### Shikoyatlar',
  "**To'sh ortida siquvchi og'riq**, chap qo'lga tarqaladi, 40 daqiqadan beri; sovuq ter, havo yetishmasligi. Nitroglitserindan keyin og'riq **kamaymagan**.",
  '',
  '### Anamnez',
  "10 yil davomida arterial gipertenziya, dorini nomuntazam ichadi. 2 hafta oldin zinadan chiqqanda qisqa og'riq bo'lgan. Kuniga 20 dona sigaret chekadi.",
  '',
  '### Hayot tarzi',
  "Kam harakat, ovqatlanishda tuz va yog' ko'p. Otasi 55 yoshida to'satdan vafot etgan.",
  '',
  "### Obyektiv ko'rik",
  "Holati og'ir. Teri oqargan, nam. AB 90/60 mm Hg, puls 112/min, nafas 24 marta/daq, SpO2 91%. Yurak tonlari bo'g'iq, o'pkaning pastki qismlarida mayda pufakchali xirillashlar.",
  '',
  '### Laboratoriya',
  "EKG: II, III, aVF da ST ko'tarilishi 3 mm. Troponin I 2,8 ng/ml. Glyukoza 9,4 mmol/l, kreatinin 118 mkmol/l.",
  '',
  '### Topshiriq',
  "1) Dastlabki tashxisni asoslang. 2) Birinchi soatdagi davolash rejasini tuzing. 3) Qaysi asorat xavfi eng yuqori?",
].join('\n');

const ANSWER = [
  'Tashxis',
  "O'tkir koronar sindrom: **pastki devor ST elevatsiyali miokard infarkti**, Killip II. Asos: EKG da II, III, aVF da ST ko'tarilishi, troponin oshgan, o'pkada xirillashlar.",
  '',
  'Davolash',
  "Darhol reperfuziya — **birlamchi PCI 90 daqiqa ichida**. Aspirin 300 mg chaynab, P2Y12 ingibitori, antikoagulyant. Gipotenziya sababli nitratlar **ehtiyotkorlik bilan**.",
].join('\n');

function App() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-xl font-bold text-slate-900">Keys savoli — yangi ko'rinish</h1>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Savol 1</p>
          <CaseScenarioView text={SCENARIO} focus="tashxis" />
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-4 py-4 sm:px-5">
            <CaseAnswerView text={ANSWER} />
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
