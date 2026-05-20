"use client";

import { useState, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";

interface AttachmentDraft {
  name: string;
  size: number;
  type: string;
}

interface QuickCaptureProps {
  onAdd: (item: {
    content: string;
    my_understanding?: string;
    status: string;
    url_title?: string;
    url_content?: string;
    attachments?: AttachmentDraft[];
  }) => Promise<{ success?: boolean; error?: string }>;
}

export function QuickCapture({ onAdd }: QuickCaptureProps) {
  const [content, setContent] = useState("");
  const [myUnderstanding, setMyUnderstanding] = useState("");
  const [status, setStatus] = useState<"later" | "pending">("later");
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [fetchedTitle, setFetchedTitle] = useState<string | null>(null);
  const [fetchedContent, setFetchedContent] = useState<string | null>(null);
  const [fetchingTitle, setFetchingTitle] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const urlTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleContentChange(val: string) {
    setContent(val);
    // Try fetching title from URL
    const urlMatch = val.trim().match(/^(https?:\/\/[^\s]+)/);
    if (urlMatch) {
      const url = urlMatch[1];
      if (urlTimeoutRef.current) clearTimeout(urlTimeoutRef.current);
      urlTimeoutRef.current = setTimeout(async () => {
        setFetchingTitle(true);
        try {
          const res = await fetch("/api/parse-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = await res.json();
          if (data.title) setFetchedTitle(data.title);
          if (data.content) setFetchedContent(data.content);
        } catch {
          // ignore
        } finally {
          setFetchingTitle(false);
        }
      }, 600);
    } else {
      setFetchedTitle(null);
      setFetchedContent(null);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setAttachments((prev) => [
        ...prev,
        { name: f.name, size: f.size, type: f.type },
      ]);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasContent = content.trim().length > 0;
    const hasAttachments = attachments.length > 0;
    if (!hasContent && !hasAttachments) return;

    setSaving(true);
    await onAdd({
      content: content.trim(),
      my_understanding: myUnderstanding.trim() || undefined,
      status,
      url_title: fetchedTitle || undefined,
      url_content: fetchedContent || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    setContent("");
    setMyUnderstanding("");
    setStatus("later");
    setFetchedTitle(null);
    setFetchedContent(null);
    setAttachments([]);
    setSaving(false);
  }

  const hasContent = content.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const isUrl = /^https?:\/\/[^\s]+/.test(content.trim());
  const urlFetching = isUrl && fetchingTitle;
  const canSubmit = (hasContent || hasAttachments) && !urlFetching;
  const showUrlTitle = fetchedTitle && hasContent;

  return (
    <form onSubmit={handleSubmit}>
      <div
        className="rounded-xl p-3 border shadow-[0_12px_28px_rgba(0,0,0,0.06)]"
        style={{
          background:
            "radial-gradient(circle at 20% 10%, rgba(241,90,36,0.05), transparent 30%), linear-gradient(180deg, #F8F4ED, #EFEAE2)",
          borderColor: "rgba(0,0,0,0.16)",
        }}
      >
        <div className="grid grid-cols-2 gap-2.5 mb-2">
          <div>
            <div className="text-[10px] font-semibold text-[--muted] tracking-[0.05em] uppercase mb-1">
              内容输入
            </div>
            <Textarea
              placeholder="粘贴链接 / 输入文本 / 拖拽文件..."
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              className="w-full border-[rgba(0,0,0,0.16)] rounded-md px-[11px] py-[9px] font-sans text-xs text-[--ink] resize-none h-[66px] leading-relaxed bg-white/50 focus:bg-white focus:border-[--innex-accent] focus:shadow-[0_0_0_3px_rgba(241,90,36,0.08)] transition-all placeholder:text-gray-300"
            />
            {fetchingTitle && (
              <p className="text-[10px] text-[--text-secondary] mt-1">⏳ 正在获取标题…</p>
            )}
            {showUrlTitle && (
              <p className="text-[10px] text-[--text-secondary] mt-1">
                📄 识别标题：<span className="font-medium text-[--ink]">{fetchedTitle}</span>
              </p>
            )}
          </div>
          <div>
            <div className="text-[10px] font-semibold text-[--muted] tracking-[0.05em] uppercase mb-1">
              我的理解{" "}
              <span className="text-[--muted] font-normal normal-case text-[10px]">
                （选填）
              </span>
            </div>
            <Textarea
              placeholder="写下你对这条内容的理解，会用于后续内化..."
              value={myUnderstanding}
              onChange={(e) => setMyUnderstanding(e.target.value)}
              className="w-full border-[rgba(0,0,0,0.16)] rounded-md px-[11px] py-[9px] font-sans text-xs text-[--ink] resize-none h-[66px] leading-relaxed bg-white/50 focus:bg-white focus:border-[--innex-accent] focus:shadow-[0_0_0_3px_rgba(241,90,36,0.08)] transition-all placeholder:text-gray-300"
            />
          </div>
        </div>

        {/* Attachments */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {attachments.map((att, i) => (
            <span
              key={i}
              className="flex items-center gap-1 bg-white/60 rounded-md px-2 py-1 text-[11px] text-[--text-secondary] border border-[--border-light]"
            >
              <span className="text-[11px]">{att.type.startsWith("image/") ? "🖼" : "📄"}</span>
              <span className="max-w-[112px] overflow-hidden text-ellipsis whitespace-nowrap">
                {att.name}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="text-muted-foreground hover:text-red-500 text-xs"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 border border-[rgba(0,0,0,0.16)] rounded-md px-2 py-1 cursor-pointer text-[11px] text-[--text-muted] bg-white/45 hover:border-[--innex-accent] hover:text-[--innex-accent] transition-all"
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
            添加附件
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
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
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
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
            disabled={saving || !canSubmit}
            className="bg-[--innex-accent] text-white border-0 rounded-md px-[17px] py-2 font-sans text-xs font-bold cursor-pointer transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap shadow-[0_6px_14px_rgba(241,90,36,0.22)] hover:bg-[--innex-accent-hover] hover:-translate-y-px hover:shadow-[0_9px_18px_rgba(241,90,36,0.28)] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {urlFetching ? "正在读取页面…" : saving ? "正在解析…" : "添加记录"}
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}
