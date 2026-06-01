"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/inbox", cn: "收录箱", en: "Inbox" },
  { href: "/kb", cn: "知识库", en: "Knowledge Base" },
  { href: "/qa", cn: "AI 问答", en: "RAG QA" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav
      className="w-[220px] shrink-0 flex flex-col overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 100% 22%, rgba(241,90,36,0.16), transparent 30%), linear-gradient(180deg, #101310 0%, #070a09 100%)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="px-[30px] pt-[38px] pb-8 border-b border-white/6">
        <div
          className="text-[42px] font-black text-white tracking-tight leading-none scale-x-[0.94] origin-left"
          style={{ fontFamily: "'Arial Black', 'Bebas Neue', sans-serif" }}
        >
          INNEX<span className="text-[--innex-accent]">.</span>
        </div>
        <p className="text-[11px] text-[#b7b0a7] tracking-[0.03em] mt-3.5 leading-relaxed font-normal">
          个人知识内化助手
          <br />
          PERSONAL KNOWLEDGE
          <br />
          INTERNALIZATION ASSISTANT
        </p>
      </div>

      <div className="flex-1 py-[26px] flex flex-col gap-0.5">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-4 px-[30px] py-5 cursor-pointer transition-all duration-150 border-l-[4px] border-l-transparent relative ${
                isActive ? "border-l-[#ff6a2a]" : "hover:bg-white/[0.06]"
              }`}
              style={
                isActive
                  ? {
                      background:
                        "linear-gradient(90deg, rgba(255,106,42,0.42), rgba(68,36,20,0.78), rgba(255,255,255,0.03))",
                      boxShadow: "inset 0 0 0 1px rgba(255,106,42,0.22)",
                    }
                  : undefined
              }
            >
              <span className="flex flex-col">
                <span
                  className={`text-base font-[650] ${
                    isActive ? "text-[#fff4e8]" : "text-[#d7d2ca]"
                  }`}
                >
                  {item.cn}
                </span>
                <span
                  className={`text-[10px] tracking-[0.04em] font-normal uppercase ${
                    isActive ? "text-[#ffd9c3]" : "text-[#b8b1a6]"
                  }`}
                >
                  {item.en}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="px-[30px] pb-[30px] pt-6 border-t border-white/6">
        <p className="text-[10px] text-[#8d877f] tracking-[0.08em] uppercase leading-relaxed font-semibold">
          BUILDING KNOWLEDGE.
          <br />
          INTERNALIZING VALUE.
        </p>
        <div className="flex gap-1 mt-3">
          <span className="w-3 h-3 rounded-[2px] bg-[--innex-accent]" />
          <span className="w-3 h-3 rounded-[2px] bg-[--innex-accent]" />
          <span className="w-3 h-3 rounded-[2px] bg-white/20" />
        </div>
      </div>
    </nav>
  );
}
