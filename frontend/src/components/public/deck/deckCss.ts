/**
 * Taqdimot uslublari (2026-11-13, v2 — yorug', jonli). Shrift va bo'shliqlar ramka eniga (cqw) bog'langan:
 * projektor, noutbuk va 4K da bir xil; telefonda bir ustun. `.deck-static` — animatsiyasiz rejim.
 */
export const DECK_CSS = `
.deck-root{--mx:0;--my:0;position:fixed;inset:0;display:flex;flex-direction:column;background:#eef2f8;color:#0f172a;
  font-family:Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
.deck-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.deck-mono{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em}

/* Fon: yumshoq, sekin suzuvchi rangli dog'lar (sichqonchaga biroz ergashadi). */
.deck-bg{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.deck-bg span{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;transition:transform .8s cubic-bezier(.2,.7,.2,1)}
.deck-bg .b1{width:46vw;height:46vw;left:-10vw;top:-16vw;background:radial-gradient(circle,#bfdbfe,transparent 70%);animation:deckFloat1 18s ease-in-out infinite;transform:translate(calc(var(--mx)*30px),calc(var(--my)*30px))}
.deck-bg .b2{width:40vw;height:40vw;right:-8vw;top:-10vw;background:radial-gradient(circle,#ddd6fe,transparent 70%);animation:deckFloat2 22s ease-in-out infinite}
.deck-bg .b3{width:44vw;height:44vw;right:10vw;bottom:-22vw;background:radial-gradient(circle,#a5f3fc,transparent 70%);animation:deckFloat1 26s ease-in-out infinite reverse}
.deck-bg .b4{width:30vw;height:30vw;left:18vw;bottom:-14vw;background:radial-gradient(circle,#bbf7d0,transparent 70%);animation:deckFloat2 20s ease-in-out infinite reverse}
@keyframes deckFloat1{0%,100%{translate:0 0}50%{translate:4vw 3vw}}
@keyframes deckFloat2{0%,100%{translate:0 0}50%{translate:-3vw 4vw}}

.deck-topline{position:relative;height:3px;z-index:2}
.deck-topline span{display:block;height:100%;background:linear-gradient(90deg,#2563eb,#06b6d4,#8b5cf6);transition:width .6s cubic-bezier(.2,.7,.2,1)}
.deck-stage{position:relative;z-index:1;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:1.2vh 1.6vw}
.deck-frame{position:relative;container-type:inline-size;width:min(100%,calc((100dvh - 92px) * 16 / 9));aspect-ratio:16/9;
  background:rgba(255,255,255,.86);border-radius:20px;overflow:hidden;
  border:1px solid rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(15,23,42,.05),0 30px 80px -30px rgba(30,64,175,.35);cursor:default}
@media (pointer:fine){.deck-frame{cursor:pointer}.deck-frame a,.deck-frame button{cursor:pointer}}
.deck-grid{position:absolute;inset:0;pointer-events:none;opacity:.5;
  background-image:radial-gradient(rgba(15,23,42,.09) 1px,transparent 1px);background-size:2.2cqw 2.2cqw;
  -webkit-mask-image:radial-gradient(ellipse at 70% 40%,#000 0%,transparent 70%);mask-image:radial-gradient(ellipse at 70% 40%,#000 0%,transparent 70%)}
.deck-slide{position:absolute;inset:0}
.deck-aura{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.deck-aura::before,.deck-aura::after{content:"";position:absolute;border-radius:50%;filter:blur(40px)}
.deck-aura::before{width:42cqw;height:42cqw;right:-10cqw;top:-14cqw;background:radial-gradient(circle,rgba(147,197,253,.55),transparent 70%);animation:deckFloat1 16s ease-in-out infinite}
.deck-aura::after{width:36cqw;height:36cqw;left:-12cqw;bottom:-16cqw;background:radial-gradient(circle,rgba(196,181,253,.45),transparent 70%);animation:deckFloat2 19s ease-in-out infinite}
.deck-watermark{position:absolute;right:3cqw;bottom:-4cqw;font-size:24cqw;line-height:1;font-weight:800;letter-spacing:-.04em;pointer-events:none;user-select:none;
  background:linear-gradient(180deg,rgba(37,99,235,.10),rgba(37,99,235,0));-webkit-background-clip:text;background-clip:text;color:transparent}
.deck-body{position:absolute;inset:0 0 7cqw 0;padding:5cqw 6cqw 0;display:flex;align-items:center;font-size:clamp(12px,1.35cqw,30px)}
.deck-body>*{width:100%}
.deck-foot{position:absolute;z-index:2;left:6cqw;right:6cqw;bottom:2.5cqw;display:flex;justify-content:space-between;align-items:center;
  font-family:"JetBrains Mono",ui-monospace,monospace;font-size:clamp(9px,.78cqw,16px);letter-spacing:.18em;text-transform:uppercase;color:#94a3b8;pointer-events:none}
.deck-foot-mid{position:absolute;left:50%;transform:translateX(-50%)}
.deck-autoplay-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,#2563eb,#06b6d4);transform-origin:left;z-index:3}

.deck-split-2{display:grid;grid-template-columns:1fr 1.02fr;gap:4.6cqw;align-items:center}
.deck-split-2>*{min-width:0}
.deck-col{display:flex;flex-direction:column;gap:1.5cqw;min-width:0}
.deck-kicker{display:flex;align-items:center;gap:1cqw;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:clamp(9px,.82cqw,17px);
  font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:#64748b;margin:0}
.deck-kicker>span:first-child{color:#2563eb}
.deck-kicker-line{display:inline-block;width:3.2cqw;height:2px;border-radius:2px;background:linear-gradient(90deg,#2563eb,#06b6d4);transform-origin:left}
.deck-title{font-size:clamp(26px,3.9cqw,88px);line-height:1.07;font-weight:800;letter-spacing:-.028em;color:#0b1220;text-wrap:balance;margin:0}
.deck-title-xl .deck-title{font-size:clamp(30px,5cqw,112px);line-height:1.03}
.deck-word{display:inline-block;will-change:transform}
.deck-accent{background:linear-gradient(90deg,#1d4ed8,#0891b2 45%,#7c3aed);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:deckShine 6s ease-in-out infinite}
@keyframes deckShine{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
.deck-lead{font-size:clamp(14px,1.55cqw,34px);line-height:1.45;color:#334155;max-width:40em;margin:0}
.deck-note{font-size:clamp(11px,.95cqw,20px);color:#64748b;margin:0}
.deck-thanks-wrap{position:relative;display:inline-block}
.deck-spark{position:absolute;width:.9cqw;height:.9cqw;border-radius:2px;transform:rotate(45deg);animation:deckSpark 2.4s ease-in-out infinite}
.deck-spark:nth-child(2){left:-3%;top:8%;background:#60a5fa;animation-delay:.2s}
.deck-spark:nth-child(3){right:-6%;top:-10%;background:#22d3ee;animation-delay:.7s}
.deck-spark:nth-child(4){right:12%;bottom:-12%;background:#a78bfa;animation-delay:1.2s}
.deck-spark:nth-child(5){left:38%;top:-22%;background:#34d399;animation-delay:1.7s;width:.6cqw;height:.6cqw}
@keyframes deckSpark{0%,100%{opacity:0;transform:rotate(45deg) scale(.3)}40%{opacity:1;transform:rotate(45deg) scale(1)}70%{opacity:0;transform:rotate(45deg) scale(.6) translateY(-6px)}}
.deck-thanks{margin:.6cqw 0 0;font-size:clamp(34px,5.4cqw,120px);font-weight:800;letter-spacing:-.03em;line-height:1;
  background:linear-gradient(90deg,#0b1220,#2563eb,#06b6d4,#0b1220);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:deckShine 5s linear infinite}
.deck-bullets{list-style:none;padding:0;margin:.4cqw 0 0;display:flex;flex-direction:column;gap:1.25cqw}
.deck-bullets li{display:flex;gap:1cqw;align-items:flex-start;font-size:clamp(14px,1.5cqw,32px);line-height:1.38;color:#1e293b}
.deck-tick{flex:none;display:inline-flex;align-items:center;justify-content:center;width:1.6em;height:1.6em;border-radius:.55em;background:linear-gradient(135deg,#dcfce7,#bbf7d0);color:#059669;margin-top:-.05em;box-shadow:0 4px 10px -6px rgba(5,150,105,.6)}
.deck-tick svg{width:.95em;height:.95em}

.deck-visual{position:relative;min-width:0}
.deck-stagepanel{position:relative;padding:2.2cqw 2.2cqw 1.6cqw;border-radius:2cqw;background:linear-gradient(135deg,rgba(219,234,254,.75) 0%,rgba(237,233,254,.65) 55%,rgba(207,250,254,.7) 100%);border:1px solid rgba(255,255,255,.95);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 24px 60px -40px rgba(30,64,175,.45)}
.deck-stagepanel::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background-image:radial-gradient(rgba(37,99,235,.12) 1px,transparent 1px);background-size:1.4cqw 1.4cqw;-webkit-mask-image:linear-gradient(180deg,#000,transparent 70%);mask-image:linear-gradient(180deg,#000,transparent 70%);opacity:.6}
.deck-stagepanel>*{position:relative;z-index:1}
.deck-mark{width:1.9em;height:auto;margin:-.4em 0}
.deck-mark-sm{width:1.6em}
.deck-caption{margin-top:1.1em;position:relative;z-index:1;display:flex;align-items:center;gap:.5em;font-size:.78em;color:#64748b;font-weight:600}
.deck-caption-dot{width:.5em;height:.5em;border-radius:99px;background:#06b6d4;box-shadow:0 0 0 .3em rgba(6,182,212,.15)}
.deck-card{position:relative;background:#fff;border:1px solid rgba(15,23,42,.07);border-radius:1.1em;padding:1.25em 1.35em;
  box-shadow:0 1px 2px rgba(15,23,42,.05),0 20px 44px -24px rgba(30,64,175,.35)}
.deck-card-glow::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;pointer-events:none;
  background:linear-gradient(135deg,rgba(37,99,235,.55),rgba(6,182,212,.35),rgba(139,92,246,.45));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
@media (pointer:fine){
  .deck-card,.deck-stat,.deck-pair,.deck-step,.deck-module,.deck-group,.deck-qr{transition:transform .3s cubic-bezier(.2,.7,.2,1),box-shadow .3s,border-color .3s}
  .deck-card:hover,.deck-stat:hover,.deck-pair:hover,.deck-step:hover,.deck-module:hover,.deck-qr:hover{transform:translateY(-4px);box-shadow:0 1px 2px rgba(15,23,42,.05),0 28px 50px -26px rgba(30,64,175,.5)}
}
.deck-label{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.72em;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#64748b;margin:0}
.deck-ic{width:1.05em;height:1.05em;flex:none}
.deck-ic-lg{width:1.5em;height:1.5em;flex:none}
.deck-chip{display:inline-flex;align-items:center;gap:.35em;border-radius:999px;padding:.28em .75em;font-size:.78em;font-weight:700;white-space:nowrap}
.deck-chip-green{background:#dcfce7;color:#047857}
.deck-chip-blue{background:#dbeafe;color:#1d4ed8}
.deck-chip-red{background:#e11d48;color:#fff}
.deck-chip-dark{background:#0f172a;color:#fff}
.deck-chip-soft{background:#f1f5f9;color:#334155}
.deck-spin{width:.8em;height:.8em;border-radius:99px;border:2px solid currentColor;border-right-color:transparent;animation:deckSpin .8s linear infinite}
@keyframes deckSpin{to{transform:rotate(360deg)}}
.deck-caret{display:inline-block;width:2px;height:1em;margin-left:2px;vertical-align:-.15em;background:#2563eb;animation:deckBlink 1s steps(1) infinite}
@keyframes deckBlink{50%{opacity:0}}
.deck-row{display:flex;align-items:center;gap:.7em;padding:.55em .7em;border-radius:.8em;background:#f8fafc;border:1px solid #eef2f7;transition:background .4s,border-color .4s}
.deck-row-done{background:#f0fdf4;border-color:#dcfce7}
.deck-row-ic{display:inline-flex;align-items:center;justify-content:center;width:2em;height:2em;border-radius:.6em;background:#eff6ff;color:#2563eb;flex:none}
.deck-check-slot{display:inline-flex;width:1.1em;justify-content:center}
.deck-track{position:relative;display:block;width:4.8em;height:.42em;border-radius:99px;background:#e2e8f0;overflow:hidden}
.deck-tile .deck-track,.deck-card>.deck-track,.deck-track-full{width:100%}
.deck-fill{position:absolute;left:0;top:0;bottom:0;border-radius:99px}
.deck-fill-green{background:linear-gradient(90deg,#34d399,#059669)}
.deck-fill-blue{background:linear-gradient(90deg,#3b82f6,#06b6d4)}
.deck-fill-red{background:linear-gradient(90deg,#fb7185,#e11d48)}
.deck-drain{width:100%;animation:deckDrain linear forwards}
@keyframes deckDrain{from{width:100%}to{width:0%}}
.deck-pin{position:absolute;display:inline-flex;align-items:center;gap:.5em;padding:.6em .9em;font-size:.82em;font-weight:700;color:#1e293b;white-space:nowrap;
  background:#fff;border:1px solid rgba(15,23,42,.07);border-radius:.9em;box-shadow:0 18px 40px -20px rgba(30,64,175,.45)}
.deck-pin-tl{left:-2.2em;top:-1.6em}
.deck-pin-br{right:-1.6em;bottom:-1.8em}
.deck-bob{animation:deckBob 4s ease-in-out infinite}
.deck-bob-2{animation:deckBob 4.6s ease-in-out .8s infinite}
@keyframes deckBob{0%,100%{translate:0 0}50%{translate:0 -6px}}
.deck-input{display:flex;align-items:center;gap:.35em;flex:1;min-width:0;border-radius:.7em;border:1.5px solid #bfdbfe;background:#f8fbff;padding:.55em .8em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.deck-btn-demo{position:relative;flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:.4em;border-radius:.7em;background:linear-gradient(135deg,#2563eb,#0891b2);color:#fff;font-weight:700;padding:.55em .9em;overflow:hidden;box-shadow:0 10px 20px -10px rgba(37,99,235,.8)}
.deck-ripple{position:absolute;left:50%;top:50%;width:.5em;height:.5em;border-radius:99px;background:rgba(255,255,255,.6);transform:translate(-50%,-50%);animation:deckRipple .6s ease-out forwards}
@keyframes deckRipple{to{width:12em;height:12em;opacity:0}}
.deck-tile{border-radius:.9em;border:1px solid #eef2f7;background:#f8fafc;padding:.8em}
.deck-hl{border-radius:.25em;transition:background-color .6s,box-shadow .6s}
.deck-hl-on{background:rgba(59,130,246,.12);box-shadow:0 0 0 .15em rgba(59,130,246,.12)}
.deck-hl-green.deck-hl-on{background:rgba(16,185,129,.12);box-shadow:0 0 0 .15em rgba(16,185,129,.12)}
.deck-cite{display:inline-block;border-radius:.4em;background:#dbeafe;color:#1d4ed8;font-size:.76em;font-weight:800;padding:.12em .5em;vertical-align:.1em}
.deck-cite-green{background:#d1fae5;color:#047857}
.deck-source{display:flex;align-items:center;gap:.7em;transition:transform .4s,box-shadow .4s,border-color .4s}
.deck-source-on{border-color:#93c5fd;box-shadow:0 0 0 .25em rgba(59,130,246,.12),0 20px 44px -24px rgba(30,64,175,.45);transform:translateY(-3px)}
.deck-source-green.deck-source-on{border-color:#6ee7b7;box-shadow:0 0 0 .25em rgba(16,185,129,.12),0 20px 44px -24px rgba(5,150,105,.45)}
.deck-skel{display:block;height:.55em;border-radius:99px;background:#e9eef5}
.deck-pulse{animation:deckPulse 1.1s ease-in-out infinite}
@keyframes deckPulse{0%,100%{box-shadow:0 0 0 0 rgba(225,29,72,.45)}50%{box-shadow:0 0 0 .5em rgba(225,29,72,0)}}
.deck-phone{width:9.8em;flex:none;border-radius:1.6em;background:#0f172a;padding:.55em;box-shadow:0 26px 50px -20px rgba(15,23,42,.55)}
.deck-phone-screen{height:13.5em;background:#fff;border-radius:1.1em;padding:.6em;overflow:hidden}
.deck-phone-mark{border-radius:.6em;background:#e11d48;color:#fff;text-align:center;font-size:.68em;font-weight:800;padding:.4em .5em}
.deck-opt{position:relative;display:flex;align-items:center;gap:.4em;border-radius:.55em;border:1px solid #e2e8f0;padding:.35em .45em;font-size:.72em;font-weight:700;color:#334155;transition:all .3s}
.deck-opt>span:first-child{display:inline-flex;width:1.5em;height:1.5em;align-items:center;justify-content:center;border-radius:.4em;background:#f1f5f9}
.deck-opt-on{border-color:#2563eb;background:#eff6ff;color:#1d4ed8;box-shadow:0 0 0 .2em rgba(37,99,235,.15)}
.deck-opt-on>span:first-child{background:#2563eb;color:#fff}
.deck-tap{position:absolute;right:.3em;bottom:-.5em;width:1.5em;height:1.5em;color:#0f172a;animation:deckTap .6s ease-out}
@keyframes deckTap{from{transform:translate(.6em,.6em) scale(1.3);opacity:0}to{transform:none;opacity:1}}
.deck-face{position:relative;display:flex;align-items:center;justify-content:center;width:5.4em;height:5.4em;border-radius:1.4em;background:#eff6ff;color:#2563eb;overflow:hidden;transition:background .4s,color .4s,box-shadow .4s}
.deck-face-ok{background:#ecfdf5;color:#059669;box-shadow:0 0 0 .3em rgba(16,185,129,.15)}
.deck-scanline{position:absolute;left:8%;right:8%;height:2px;background:linear-gradient(90deg,transparent,#06b6d4,transparent);box-shadow:0 0 12px #06b6d4;animation:deckScan 1.2s ease-in-out infinite alternate}
@keyframes deckScan{from{top:12%}to{top:86%}}
.deck-bubble{border-radius:1em 1em 1em .3em;background:#f1f5f9;padding:.9em 1em}
.deck-typing{display:inline-flex;gap:.3em;padding:.8em 1em}
.deck-typing span{width:.45em;height:.45em;border-radius:99px;background:#94a3b8;animation:deckDots 1s ease-in-out infinite}
.deck-typing span:nth-child(2){animation-delay:.15s}.deck-typing span:nth-child(3){animation-delay:.3s}
@keyframes deckDots{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(-.3em);opacity:1}}
.deck-live{display:inline-flex;align-items:center;gap:.4em;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.7em;font-weight:700;color:#e11d48;letter-spacing:.1em}
.deck-live span,.deck-live-dot{width:.55em;height:.55em;border-radius:99px;background:#e11d48;animation:deckPulse 1.4s infinite;display:inline-block}
.deck-toast{position:absolute;right:.6em;bottom:-1.6em;display:inline-flex;align-items:center;gap:.5em;padding:.6em .9em;border-radius:.9em;background:#0f172a;color:#fff;font-size:.8em;font-weight:700;white-space:nowrap;box-shadow:0 18px 40px -16px rgba(15,23,42,.6)}
.deck-rrow{margin:0 -.5em;padding:.15em .5em;border-radius:.5em;transition:background .5s}
.deck-rrow-on{background:#ecfdf5}
.deck-reason{display:flex;align-items:center;gap:.8em;padding:.65em .8em;border-radius:.8em;background:#f8fafc;border:1px solid #eef2f7}
.deck-reason-amber{background:#fffbeb;border-color:#fde68a}
.deck-dot{position:relative;width:.7em;height:.7em;border-radius:99px;flex:none}
.deck-dot-green{background:#22c55e}.deck-dot-amber{background:#f59e0b}.deck-dot-gray{background:#94a3b8}.deck-dot-red{background:#ef4444}
.deck-dot-amber::after{content:"";position:absolute;inset:-.35em;border-radius:99px;border:2px solid #f59e0b;animation:deckRing 1.6s ease-out infinite}
@keyframes deckRing{from{transform:scale(.6);opacity:1}to{transform:scale(1.6);opacity:0}}
.deck-hint{margin-top:.9em;display:flex;align-items:flex-start;gap:.5em;border-radius:.8em;background:linear-gradient(135deg,#fffbeb,#fef3c7);color:#92400e;padding:.7em .85em;font-size:.86em;font-weight:600;line-height:1.35}
.deck-lang-tab{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:3em;padding:.35em .7em;border-radius:.6em;font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:700;font-size:.82em;color:#64748b}
.deck-lang-pill{position:absolute;inset:0;border-radius:.6em;background:#0f172a}
.deck-lang-tab:has(.deck-lang-pill){color:#fff}
.deck-flow{display:flex;flex-direction:column;gap:0}
.deck-node{display:flex;align-items:center;gap:.8em;padding:.7em .9em;border-radius:.9em;background:#f8fafc;border:1px solid #eef2f7}
.deck-node b{display:block;font-size:.98em;color:#0f172a}
.deck-node span:not(.deck-node-ic){display:block;font-size:.78em;color:#64748b;line-height:1.3}
.deck-node-ic{display:inline-flex;align-items:center;justify-content:center;width:2.2em;height:2.2em;border-radius:.7em;background:#e2e8f0;color:#334155;flex:none}
.deck-node-ic-violet{background:#ede9fe;color:#7c3aed}
.deck-node-main{background:linear-gradient(135deg,#eff6ff,#ecfeff);border-color:#bfdbfe;box-shadow:0 0 0 .3em rgba(37,99,235,.08)}
.deck-node-main .deck-node-ic{background:#2563eb;color:#fff}
.deck-wire{position:relative;margin-left:1.95em;height:2.6em;width:2px;background:repeating-linear-gradient(180deg,#cbd5e1 0 5px,transparent 5px 10px)}
.deck-wire em{position:absolute;left:1.2em;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;gap:.35em;font-style:normal;font-size:.74em;font-weight:700;color:#475569;white-space:nowrap}
.deck-packet{position:absolute;left:50%;top:0;width:.6em;height:.6em;margin-left:-.3em;border-radius:99px;background:#2563eb;box-shadow:0 0 10px #3b82f6;animation:deckPacket 1.8s linear infinite}
.deck-packet-2{animation-delay:.9s}
.deck-packet-violet{background:#8b5cf6;box-shadow:0 0 10px #a78bfa;animation-duration:2.2s}
@keyframes deckPacket{from{top:0;opacity:0}15%{opacity:1}85%{opacity:1}to{top:calc(100% - .6em);opacity:0}}
.deck-blocked{position:relative;margin-left:.7em;display:inline-flex;align-items:center;gap:.4em;border-radius:999px;background:#fff1f2;color:#be123c;border:1px solid #fecdd3;padding:.32em .7em;font-size:.72em;font-weight:700;white-space:nowrap;animation:deckShake 3s ease-in-out infinite}
@keyframes deckShake{0%,82%,100%{translate:0 0}85%{translate:-4px 0}88%{translate:4px 0}91%{translate:-3px 0}94%{translate:2px 0}}
.deck-group{display:flex;align-items:center;justify-content:center;gap:.4em;padding:.6em .5em;border-radius:.8em;background:#fff;border:1px solid rgba(15,23,42,.07);font-size:.8em;font-weight:700;color:#64748b;transition:all .4s;white-space:nowrap}
.deck-group-on{background:#0f172a;color:#fff;border-color:#0f172a;transform:translateY(-3px);box-shadow:0 14px 26px -16px rgba(15,23,42,.6)}
.deck-split{display:flex;height:2em;border-radius:.6em;overflow:hidden;font-size:.78em;font-weight:700;background:#fef3c7}
.deck-split span{display:flex;align-items:center;padding:0 .8em;white-space:nowrap}
.deck-split span:first-child{background:#dbeafe;color:#1d4ed8}
.deck-split span:last-child{flex:1;color:#92400e}
.deck-site{display:inline-flex;align-items:center;gap:.4em;border-radius:999px;background:#0f172a;color:#fff;padding:.6em 1.1em;font-weight:700;text-decoration:none}
.deck-qr{display:flex;flex-direction:column;align-items:center;gap:.5em;padding:.8em;border-radius:1.2em;background:#fff;border:1px solid rgba(15,23,42,.07);box-shadow:0 20px 44px -24px rgba(30,64,175,.45)}
.deck-qr{animation:deckBreathe 2.8s ease-in-out infinite}
@keyframes deckBreathe{0%,100%{box-shadow:0 0 0 0 rgba(37,99,235,.0),0 20px 44px -24px rgba(30,64,175,.45)}50%{box-shadow:0 0 0 .55em rgba(37,99,235,.12),0 20px 44px -24px rgba(30,64,175,.45)}}
.deck-qr img,.deck-qr-empty{width:9em;height:9em;border-radius:.5em}
.deck-qr span{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.7em;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b}

.deck-stats-wrap{display:grid;grid-template-columns:auto 1fr;gap:4cqw;align-items:center;margin-top:.6cqw}
.deck-ring{position:relative;width:19cqw;height:19cqw}
.deck-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.deck-ring-bg{fill:none;stroke:#e2e8f0;stroke-width:10}
.deck-ring-fg{fill:none;stroke-width:10;stroke-linecap:round}
.deck-ring-center{position:absolute;inset:14%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.deck-ring-center b{font-size:clamp(28px,4.2cqw,96px);font-weight:800;letter-spacing:-.03em;line-height:1;background:linear-gradient(90deg,#1d4ed8,#0891b2);-webkit-background-clip:text;background-clip:text;color:transparent}
.deck-ring-center span{margin-top:.5cqw;font-size:clamp(10px,.92cqw,20px);line-height:1.3;color:#475569;max-width:13em}
.deck-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1.4cqw 2.2cqw}
.deck-stat{border-radius:1.1cqw;background:#fff;border:1px solid rgba(15,23,42,.06);padding:1.2cqw 1.3cqw;box-shadow:0 14px 30px -24px rgba(30,64,175,.45)}
.deck-stat-ic{display:inline-flex;align-items:center;justify-content:center;width:2.4cqw;height:2.4cqw;border-radius:.7cqw;background:#eff6ff;color:#2563eb;font-size:clamp(12px,1.2cqw,26px)}
.deck-stat-num{font-size:clamp(22px,3cqw,70px);font-weight:800;letter-spacing:-.03em;line-height:1;color:#0b1220;margin:.8cqw 0 0;font-variant-numeric:tabular-nums}
.deck-stat-label{margin:.5cqw 0 0;font-size:clamp(11px,1.02cqw,24px);line-height:1.3;color:#475569}
.deck-pairs{display:grid;grid-template-columns:repeat(3,1fr);gap:1.4cqw;margin-top:1.4cqw}
.deck-pair{border-radius:1.1cqw;background:#fff;border:1px solid rgba(15,23,42,.06);padding:1.3cqw 1.4cqw;box-shadow:0 14px 30px -24px rgba(30,64,175,.45)}
.deck-pair-ic{display:flex;align-items:center;justify-content:center;width:2.3cqw;height:2.3cqw;border-radius:.7cqw;background:#fff1f2;color:#e11d48;font-size:clamp(12px,1.1cqw,24px);margin-bottom:.8cqw}
.deck-problem{position:relative;display:inline-block;margin:0;font-size:clamp(12px,1.12cqw,26px);color:#be123c}
.deck-strike{position:absolute;left:-2%;right:-2%;top:52%;height:2px;border-radius:2px;background:rgba(190,18,60,.6);transform-origin:left}
.deck-answer{margin:.8cqw 0 0;display:flex;gap:.6cqw;align-items:flex-start;font-size:clamp(14px,1.38cqw,32px);font-weight:700;color:#0f172a;line-height:1.3}
.deck-answer svg{margin-top:.2em}
.deck-steps{position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:2cqw;margin-top:2.2cqw}
.deck-steps-line{position:absolute;left:3cqw;right:3cqw;top:3.05cqw;height:2px;background:#e2e8f0;border-radius:2px;z-index:0}
.deck-steps-line span:first-child{position:absolute;inset:0;background:linear-gradient(90deg,#2563eb,#06b6d4,#16a34a);transform-origin:left;border-radius:2px}
.deck-steps-dot{display:none}
.deck-step{position:relative;z-index:1;border-radius:1.3cqw;background:#fff;border:1px solid rgba(15,23,42,.07);padding:1.45cqw 1.5cqw 1.6cqw;
  box-shadow:0 16px 34px -26px rgba(30,64,175,.5);transition:border-color .45s,box-shadow .45s,transform .45s}
.deck-step-lit{border-color:#bfdbfe;box-shadow:0 0 0 .35cqw rgba(37,99,235,.08),0 22px 40px -26px rgba(30,64,175,.6);transform:translateY(-.3cqw)}
.deck-step-last.deck-step-lit{border-color:#bbf7d0;box-shadow:0 0 0 .35cqw rgba(22,163,74,.08),0 22px 40px -26px rgba(5,150,105,.55)}
.deck-step-ic{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:3.2cqw;height:3.2cqw;border-radius:99px;background:#fff;border:2px solid #cbd5e1;color:#94a3b8;font-size:clamp(12px,1.3cqw,28px);transition:all .4s}
.deck-step-ic-on{border-color:#2563eb;background:#2563eb;color:#fff;box-shadow:0 0 0 .5cqw rgba(37,99,235,.15)}
.deck-step-last .deck-step-ic-on{border-color:#16a34a;background:#16a34a;box-shadow:0 0 0 .5cqw rgba(22,163,74,.15)}
.deck-step-n{margin:1.1cqw 0 0;font-size:clamp(10px,.95cqw,20px);font-weight:600;color:#2563eb;letter-spacing:.14em}
.deck-step-last .deck-step-n,.deck-step-last .deck-step-value{color:#16a34a}
.deck-step-title{margin:.45cqw 0 0;font-size:clamp(16px,1.8cqw,40px);font-weight:800;color:#0b1220;letter-spacing:-.01em}
.deck-step-text{margin:.4cqw 0 0;font-size:clamp(12px,1.1cqw,24px);line-height:1.4;color:#64748b;min-height:2.8em}
.deck-step-value{margin:1cqw 0 0;font-size:clamp(22px,2.7cqw,60px);font-weight:800;letter-spacing:-.02em;color:#0b1220;line-height:1}
.deck-modules{display:grid;grid-template-columns:repeat(4,1fr);gap:1cqw;margin-top:1.6cqw}
.deck-module{display:flex;align-items:center;gap:.8cqw;padding:1.05cqw 1.1cqw;border-radius:1cqw;background:#fff;border:1px solid rgba(15,23,42,.07);
  font-size:clamp(12px,1.18cqw,26px);font-weight:700;color:#1e293b;box-shadow:0 10px 24px -20px rgba(15,23,42,.35);transition:transform .35s,box-shadow .35s,border-color .35s}
.deck-module .deck-row-ic{font-size:clamp(12px,1.18cqw,26px);transition:background .35s,color .35s}
.deck-module-on{transform:translateY(-4px);border-color:#93c5fd;box-shadow:0 0 0 .3cqw rgba(37,99,235,.12),0 18px 34px -20px rgba(30,64,175,.55)}
.deck-module-on .deck-row-ic{background:#2563eb;color:#fff}

.deck-nav{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 1.6vw 10px;font-size:13px;color:#475569}
.deck-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;min-width:34px;border-radius:10px;background:rgba(255,255,255,.9);
  border:1px solid rgba(15,23,42,.08);color:#0f172a;cursor:pointer;padding:0 8px;transition:background .2s,transform .2s}
.deck-btn:hover:not(:disabled){background:#fff;transform:translateY(-1px)}
.deck-btn:disabled{opacity:.35;cursor:default}
.deck-btn svg{width:17px;height:17px}
.deck-btn-on{background:#0f172a;color:#fff}
.deck-btn-text{padding:0 12px;font-weight:600}
@media (max-width:1499px){.deck-keys{display:none!important}}
.deck-keys{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;color:#94a3b8;margin-left:6px;white-space:nowrap}
.deck-dots{display:flex;align-items:center;gap:6px}
.deck-dots button{width:14px;height:5px;border-radius:99px;background:#cbd5e1;border:0;padding:0;cursor:pointer;transition:all .35s cubic-bezier(.2,.7,.2,1)}
.deck-dots button.past{background:#93c5fd}
.deck-dots button.on{width:32px;background:linear-gradient(90deg,#2563eb,#06b6d4)}
.deck-count{font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:600;color:#0f172a;margin-right:4px;white-space:nowrap}
.deck-langs{display:inline-flex;border-radius:10px;background:rgba(255,255,255,.9);border:1px solid rgba(15,23,42,.08);padding:2px}
.deck-langs button{border:0;background:transparent;padding:6px 9px;border-radius:8px;font-weight:700;text-transform:uppercase;font-size:11px;color:#64748b;cursor:pointer}
.deck-langs button.on{background:#0f172a;color:#fff}
.deck-enter{display:inline-flex;align-items:center;height:34px;padding:0 14px;border-radius:10px;background:linear-gradient(135deg,#2563eb,#0891b2);color:#fff;font-weight:700;text-decoration:none;box-shadow:0 10px 20px -12px rgba(37,99,235,.8)}

.deck-overview{position:absolute;inset:0;z-index:20;background:rgba(238,242,248,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:24px 3vw;overflow:auto}
.deck-overview-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.deck-overview-head p{display:flex;align-items:center;gap:8px;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#475569;margin:0}
.deck-overview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.deck-thumb{position:relative;aspect-ratio:16/10;display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left;padding:14px;border-radius:14px;background:#fff;border:1px solid rgba(15,23,42,.08);cursor:pointer;box-shadow:0 14px 30px -24px rgba(30,64,175,.5);transition:transform .25s,box-shadow .25s,border-color .25s;overflow:hidden}
.deck-thumb:hover{transform:translateY(-3px);border-color:#93c5fd}
.deck-thumb.on{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.2)}
.deck-thumb-n{position:absolute;right:10px;bottom:-14px;font-size:70px;font-weight:800;color:rgba(37,99,235,.08);line-height:1}
.deck-thumb-ic{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:#eff6ff;color:#2563eb;margin-bottom:4px}
.deck-thumb-sec{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#2563eb}
.deck-thumb-title{font-size:15px;font-weight:800;line-height:1.2;color:#0b1220}

.deck-root:fullscreen .deck-stage{padding:0}
.deck-root:fullscreen .deck-frame{width:min(100vw,calc((100dvh - 56px) * 16 / 9));border-radius:0}
.deck-static *,.deck-static *::before,.deck-static *::after{animation:none!important;transition:none!important}
.deck-btn-pdf{text-decoration:none}
.deck-static .deck-spark,.deck-static .deck-caret{display:none}
.deck-print .deck-aura,.deck-print .deck-grid,.deck-print .deck-stagepanel::after,.deck-print .deck-card-glow::before{display:none}
.deck-print .deck-watermark{background:none;color:rgba(37,99,235,.06)}
.deck-print .deck-card-glow{border-color:#bfdbfe}
.deck-print *{box-shadow:none!important;text-shadow:none!important;filter:none!important}
.deck-print .deck-accent,.deck-print .deck-thanks,.deck-print .deck-ring-center b{background:none!important;color:#1d4ed8!important;-webkit-text-fill-color:#1d4ed8}
.deck-print .deck-card,.deck-print .deck-stat,.deck-print .deck-pair,.deck-print .deck-step,.deck-print .deck-module{border-color:#dbe3ee}
.deck-print .deck-stagepanel{box-shadow:none}
.deck-print{position:static;background:#e9edf3;padding:16px;display:flex;flex-direction:column;align-items:center;gap:16px;font-family:Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#0f172a}
.deck-print .deck-print-page{width:min(1280px,100%);flex:none;cursor:default}
@page{size:13.333in 7.5in;margin:0}
@media print{
  html,body{background:#fff!important}
  .deck-print{padding:0;gap:0;background:#fff}
  .deck-print .deck-print-page{width:13.333in;height:7.5in;aspect-ratio:auto;border-radius:0;box-shadow:none;border:0;break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
.deck-intro{position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#fff}
.deck-intro-logo{width:min(520px,62vw);height:auto;mix-blend-mode:multiply}
.deck-intro b{font-size:clamp(40px,7vw,120px);font-weight:800;letter-spacing:-.04em;background:linear-gradient(90deg,#1d4ed8,#06b6d4,#7c3aed);-webkit-background-clip:text;background-clip:text;color:transparent}
.deck-intro i{display:block;width:min(260px,40vw);height:3px;border-radius:3px;background:linear-gradient(90deg,#2563eb,#06b6d4);transform-origin:left}
.deck-intro span{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#64748b}
.deck-tip{position:absolute;left:50%;top:14px;z-index:5;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:12px;background:#0f172a;color:#fff;font-size:13px;font-weight:600;white-space:nowrap;box-shadow:0 18px 40px -16px rgba(15,23,42,.6);pointer-events:none}
.deck-tip kbd{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:rgba(255,255,255,.16)}
.deck-tip kbd svg{width:14px;height:14px}
.deck-idle,.deck-idle *{cursor:none!important}
.deck-notes{position:absolute;left:1.6vw;bottom:58px;z-index:6;max-width:min(560px,46vw);padding:12px 16px;border-radius:14px;background:rgba(15,23,42,.94);color:#e2e8f0;box-shadow:0 20px 50px -20px rgba(15,23,42,.7)}
.deck-notes-head{margin:0 0 4px;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#7dd3fc}
.deck-notes-text{margin:0;font-size:14px;line-height:1.45}

/* Planshet va telefon: ramka bir ustunga o'tadi, slayd ichida aylantiriladi. */
@media screen and (max-width: 860px), screen and (max-aspect-ratio: 1/1){
  .deck-stage{align-items:stretch;padding:8px}
  .deck-frame{width:100%;aspect-ratio:auto;height:100%;border-radius:16px;cursor:default}
  .deck-slide{position:absolute;inset:0 0 44px 0;overflow-y:auto}
  .deck-body{position:relative;inset:auto;min-height:100%;padding:26px 20px 24px;align-items:flex-start;font-size:13px}
  .deck-foot{left:20px;right:20px;bottom:14px;font-size:9px}
  .deck-foot-mid{display:none}
  .deck-watermark{font-size:44vw;bottom:-6vw;position:fixed}
  .deck-split-2{grid-template-columns:1fr;gap:28px}
  .deck-stagepanel{padding:16px 14px 12px;border-radius:18px}
  .deck-phone{width:7.4em;padding:.45em}
  .deck-phone-screen{height:12.5em}
  .deck-col{gap:14px}
  .deck-kicker{gap:8px;font-size:10px}.deck-kicker-line{width:24px}
  .deck-title{font-size:clamp(26px,7.4vw,40px)}
  .deck-title-xl .deck-title{font-size:clamp(32px,9.5vw,52px)}
  .deck-lead{font-size:16px}.deck-note{font-size:12px}
  .deck-thanks{font-size:44px}
  .deck-spark{width:8px;height:8px}
  .deck-bullets{gap:12px}.deck-bullets li{font-size:16px;gap:10px}
  .deck-stats-wrap{grid-template-columns:1fr;gap:18px;justify-items:center}
  .deck-ring{width:200px;height:200px}.deck-ring-center b{font-size:44px}.deck-ring-center span{font-size:12px;margin-top:6px}
  .deck-stats{grid-template-columns:1fr 1fr;gap:10px;width:100%}
  .deck-stat{padding:12px;border-radius:12px}.deck-stat-ic{width:30px;height:30px;border-radius:8px;font-size:14px}
  .deck-stat-num{font-size:26px;margin-top:8px}.deck-stat-label{font-size:12px;margin-top:4px}
  .deck-pairs{grid-template-columns:1fr;gap:10px;margin-top:6px}.deck-pair{padding:12px 14px;border-radius:12px}
  .deck-pair-ic{width:28px;height:28px;border-radius:8px;font-size:14px;margin-bottom:8px}
  .deck-problem{font-size:13px}.deck-answer{font-size:15px;gap:8px;margin-top:6px}
  .deck-steps{grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}.deck-steps-line{display:none}
  .deck-step{padding:14px;border-radius:14px}
  .deck-tip{display:none}
  .deck-notes{left:10px;right:10px;max-width:none;bottom:54px}
  .deck-step-ic{width:36px;height:36px;font-size:15px}
  .deck-step-n{font-size:11px;margin-top:10px}.deck-step-title{font-size:18px;margin-top:4px}.deck-step-text{font-size:13px;margin-top:4px}
  .deck-step-value{font-size:26px;margin-top:10px}
  .deck-modules{grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}
  .deck-module{font-size:12.5px;padding:10px;gap:8px;border-radius:10px}
  .deck-pin{position:static;margin-top:10px}
  .deck-toast{position:static;margin-top:10px}
  .deck-keys,.deck-btn-text,.deck-btn-auto,.deck-btn-grid,.deck-btn-pdf{display:none!important}
  .deck-nav{padding:6px 8px 8px;gap:6px}
  .deck-dots{display:none}
  .deck-wire em{flex-wrap:wrap;white-space:normal;row-gap:.3em}
  .deck-blocked{margin-left:0}
  .deck-wire{height:auto;min-height:2.6em;display:flex;flex-direction:column;justify-content:center}
  .deck-wire em{position:static;transform:none;margin-left:1.2em}
}
`;
