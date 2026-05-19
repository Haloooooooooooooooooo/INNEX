"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";

interface QuickCaptureProps {
  onAdd: (item: {
    type: string;
    title: string;
    source: string;
    source_url?: string;
    raw_content?: string;
    my_understanding?: string;
    status: string;
  }) => Promise<{ success?: boolean; error?: string }>;
}

function detectType(content: string): { type: string; title: string; source: string; source_url?: string } {
  const trimmed = content.trim();

  // URL detection
  const urlMatch = trimmed.match(/^(https?:\/\/[^\s]+)/);
  if (urlMatch) {
    const url = urlMatch[1];
    // Detect platform
    if (/bilibili\.com|b23\.tv/i.test(url)) return { type: "video", title: trimmed.replace(url, "").trim() || "B站视频", source: "B站", source_url: url };
    if (/youtube\.com|youtu\.be/i.test(url)) return { type: "video", title: trimmed.replace(url, "").trim() || "YouTube视频", source: "YouTube", source_url: url };
    if (/mp\.weixin\.qq\.com/i.test(url)) return { type: "url", title: trimmed.replace(url, "").trim() || "公众号文章", source: "微信公众号", source_url: url };
    if (/zhihu\.com/i.test(url)) return { type: "url", title: trimmed.replace(url, "").trim() || "知乎", source: "知乎", source_url: url };
    if (/xiaohongshu\.com|xhslink\.com/i.test(url)) return { type: "url", title: trimmed.replace(url, "").trim() || "小红书", source: "小红书", source_url: url };
    return { type: "url", title: trimmed.replace(url, "").trim() || "链接", source: "链接", source_url: url };
  }

  // Short text
  if (trimmed.length <= 10) {
    return { type: "text", title: trimmed, source: "文字" };
  }

  // Longer text — use first ~5 chars as title fallback
  const title = trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed;
  return { type: "text", title, source: "文字" };
}

export function QuickCapture({ onAdd }: QuickCaptureProps) {
  const [content, setContent] = useState("");
  const [myUnderstanding, setMyUnderstanding] = useState("");
  const [status, setStatus] = useState<"later" | "pending">("later");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    setSaving(true);
    const detected = detectType(content);
    await onAdd({
      type: detected.type,
      title: detected.title,
      source: detected.source,
      source_url: detected.source_url,
      raw_content: content.trim(),
      my_understanding: myUnderstanding.trim() || undefined,
      status,
    });
    setContent("");
    setMyUnderstanding("");
    setStatus("later");
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit}>
      <div
        className="rounded-xl p-3 border shadow-[0_12px_28px_rgba(0,0,0,0.06)]"
        style={{
          background: "radial-gradient(circle at 20% 10%, rgba(241,90,36,0.05), transparent 30%), linear-gradient(180deg, #F8F4ED, #EFEAE2)",
          borderColor: "rgba(0,0,0,0.16)",
        }}
      >
        <div className="grid grid-cols-2 gap-2.5 mb-2">
          <div>
            <div className="text-[10px] font-semibold text-[--muted] tracking-[0.05em] uppercase mb-1">
              内容输入
            </div>
            <Textarea
              placeholder="粘贴链接 / 输入文本 / 粘贴图片 / 拖拽文件..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full border-[rgba(0,0,0,0.16)] rounded-md px-[11px] py-[9px] font-sans text-xs text-[--ink] resize-none h-[66px] leading-relaxed bg-white/50 focus:bg-white focus:border-[--innex-accent] focus:shadow-[0_0_0_3px_rgba(241,90,36,0.08)] transition-all placeholder:text-gray-300"
            />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-[--muted] tracking-[0.05em] uppercase mb-1">
              我的理解 <span className="text-[--muted] font-normal normal-case text-[10px]">（选填）</span>
            </div>
            <Textarea
              placeholder="写下你对这条内容的理解，会用于后续内化..."
              value={myUnderstanding}
              onChange={(e) => setMyUnderstanding(e.target.value)}
              className="w-full border-[rgba(0,0,0,0.16)] rounded-md px-[11px] py-[9px] font-sans text-xs text-[--ink] resize-none h-[66px] leading-relaxed bg-white/50 focus:bg-white focus:border-[--innex-accent] focus:shadow-[0_0_0_3px_rgba(241,90,36,0.08)] transition-all placeholder:text-gray-300"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setStatus("later")}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-[11px] transition-all ${
                status === "later"
                  ? "bg-[--innex-accent-dim] border-[--innex-accent] text-[--innex-accent]"
                  : "bg-white/40 border-[rgba(0,0,0,0.16)] text-[--text-secondary] hover:border-[--innex-accent] hover:text-[--innex-accent]"
              }`}
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              稍后看
            </button>
            <button
              type="button"
              onClick={() => setStatus("pending")}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-[11px] transition-all ${
                status === "pending"
                  ? "bg-[--innex-accent-dim] border-[--innex-accent] text-[--innex-accent]"
                  : "bg-white/40 border-[rgba(0,0,0,0.16)] text-[--text-secondary] hover:border-[--innex-accent] hover:text-[--innex-accent]"
              }`}
            >
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              收藏
            </button>
          </div>
          <button
            type="submit"
            disabled={saving || !content.trim()}
            className="bg-[--innex-accent] text-white border-0 rounded-md px-[17px] py-2 font-sans text-xs font-bold cursor-pointer transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap shadow-[0_6px_14px_rgba(241,90,36,0.22)] hover:bg-[--innex-accent-hover] hover:-translate-y-px hover:shadow-[0_9px_18px_rgba(241,90,36,0.28)] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "收录中…" : "添加记录"}
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}
