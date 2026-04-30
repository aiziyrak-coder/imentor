import React, { useState, useRef, useEffect } from 'react';
import { 
  Database, 
  Send, 
  Sparkles, 
  Bot, 
  User, 
  LineChart, 
  FileSearch, 
  Target,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Message {
  role: 'user' | 'ai';
  text: string;
}

export default function Analytics() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: "Assalomu alaykum! Men Salomatlik AI yordamchisiman. Jamoat salomatligi, ma'lumotlar tahlili yoki prognostik modellashtirish bo'yicha qanday savolingiz bor?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: userMsg,
        config: {
          systemInstruction: "Siz Farg'ona jamoat salomatlik instituti uchun ixtisoslashgan AI mutaxassisiz. Jamoat salomatligi, epidemiologiya va tibbiy ma'lumotlar tahlili bo'yicha chuqur bilimga egasiz. Javoblaringizni o'zbek tilida, ilmiy asoslangan va tushunarli tarzda bering."
        }
      });
      
      setMessages(prev => [...prev, { role: 'ai', text: response.text }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'ai', text: "Kechirasiz, tizimda xatolik yuz berdi. Iltimos, birozdan so'ng qayta urinib ko'ring." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-140px)] flex flex-col gap-5 pb-5">
      <header className="flex items-center justify-between pb-2 border-b border-black/5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-sky-500/10 border border-sky-500/20 rounded-[14px] flex items-center justify-center text-sky-600 backdrop-blur-md">
            <Database size={24} strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-black/90 tracking-tight">
               AI Tahlil va Maslahat
            </h2>
            <p className="text-[13px] text-black/50 font-medium">Katta hajmdagi ma'lumotlarni tahlil qilish va prognozlar olish uchun universal chat.</p>
          </div>
        </div>
        <div className="hidden md:flex gap-2">
           {[ 
             { icon: LineChart, label: 'Trendlar' },
             { icon: FileSearch, label: 'Tadqiqot' },
             { icon: Target, label: 'Prognoz' }
           ].map((item, i) => (
             <button key={i} className="flex items-center gap-2 px-4 py-2 bg-white/40 border border-white/60 shadow-sm hover:shadow-md rounded-xl text-[12px] font-semibold text-black/60 hover:text-black/80 transition-all">
               <item.icon size={14} /> {item.label}
             </button>
           ))}
        </div>
      </header>

      <div className="flex-1 ios-glass border border-white/60 rounded-[2rem] overflow-hidden flex flex-col relative shadow-sm">
        <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />
        
        {/* Chat log */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide relative z-10 w-full">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={`flex gap-3 w-full sm:w-[90%] md:w-[80%] ${msg.role === 'user' ? 'flex-row-reverse ml-auto' : 'mr-auto'}`}
            >
              <div className={`w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0 shadow-sm border
                ${msg.role === 'ai' ? 'bg-black/90 text-sky-400 border-black/10' : 'bg-white text-sky-600 border-white/60'}`}>
                {msg.role === 'ai' ? <Bot size={20} /> : <User size={20} />}
              </div>
              <div className={`p-4 rounded-2xl text-[14px] font-medium leading-relaxed shadow-sm
                ${msg.role === 'ai' 
                  ? 'bg-white/60 text-black/80 border border-white/40 rounded-tl-sm' 
                  : 'bg-black/90 text-white border border-black/10 rounded-tr-sm'}`}>
                {msg.text}
              </div>
            </motion.div>
          ))}
          {loading && (
            <div className="flex gap-3 w-full sm:w-[80%]">
              <div className="w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0 shadow-sm bg-black/90 text-sky-400 border border-black/10">
                <Bot size={20} />
              </div>
              <div className="p-4 bg-white/60 text-black/80 border border-white/40 rounded-2xl rounded-tl-sm shadow-sm flex items-center h-[52px]">
                <div className="flex gap-1.5">
                  <motion.div animate={{ opacity: [0.3, 1, 0.3], y: [0,-2,0] }} transition={{ repeat: Infinity, duration: 1 }} className="w-2 h-2 bg-sky-500 rounded-full" />
                  <motion.div animate={{ opacity: [0.3, 1, 0.3], y: [0,-2,0] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-2 h-2 bg-sky-500 rounded-full" />
                  <motion.div animate={{ opacity: [0.3, 1, 0.3], y: [0,-2,0] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-2 h-2 bg-sky-500 rounded-full" />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div className="p-5 border-t border-black/5 bg-white/40 backdrop-blur-xl relative z-20">
          <div className="relative flex items-end gap-3 max-w-4xl mx-auto">
            <div className="relative flex-1 group">
               <textarea
                 value={input}
                 onChange={(e) => setInput(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter' && !e.shiftKey) {
                     e.preventDefault();
                     handleSend();
                   }
                 }}
                 placeholder="Savolingizni bering yoki ma'lumotlarni kiriting..."
                 className="w-full p-4 pl-5 pr-14 bg-white/50 border border-white/60 rounded-2xl shadow-sm outline-none focus:bg-white/80 focus:border-sky-400 transition-all text-[15px] font-medium resize-none min-h-[56px] max-h-32 placeholder:text-black/30"
                 rows={1}
               />
               <div className="absolute right-3 bottom-0 h-full flex items-center">
                 <button
                   onClick={handleSend}
                   disabled={loading || !input.trim()}
                   className="p-2.5 bg-sky-600 text-white rounded-[12px] hover:bg-sky-500 disabled:opacity-50 active:scale-95 transition-all shadow-md flex items-center justify-center"
                 >
                   <Send size={18} />
                 </button>
               </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between px-2 max-w-4xl mx-auto">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-black/30 uppercase tracking-widest leading-none">
              <Sparkles size={12} className="text-sky-500" /> Gemini AI
            </div>
            <div className="flex gap-2">
               <button className="text-[11px] px-2 py-1 rounded bg-black/5 text-black/40 font-semibold hover:bg-black/10 transition-colors">Yangi Chat</button>
               <button className="text-[11px] px-2 py-1 rounded bg-black/5 text-black/40 font-semibold hover:bg-black/10 transition-colors">Eksport</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
