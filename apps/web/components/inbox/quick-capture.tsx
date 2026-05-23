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
    files?: File[];
  }) => Promise<{
    success?: boolean;
    error?: string;
    item?: {
      parse_debug?: {
        input_source?: string;
        readable?: boolean | "partial";
        extracted_chars?: number;
        model_summary_succeeded?: boolean;
        model_tags_succeeded?: boolean;
        notes?: string[];
      } | null;
    };
  }>;
}

export function QuickCapture({ onAdd }: QuickCaptureProps) {
  const [content, setContent] = useState("");
  const [myUnderstanding, setMyUnderstanding] = useState("");
  const [status, setStatus] = useState<"later" | "pending">("later");
  const [savingCount, setSavingCount] = useState(0);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [fetchedTitle, setFetchedTitle] = useState<string | null>(null);
  const [fetchedContent, setFetchedContent] = useState<string | null>(null);
  const [fetchingTitle, setFetchingTitle] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const urlTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleContentChange(val: string) {
    setContent(val);
    const urlMatch = val.trim().match(/(https?:\/\/[^\s]+)/i);
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
    const inputFiles = e.target.files;
    if (!inputFiles) return;
    addFiles(inputFiles);
    if (fileRef.current) fileRef.current.value = "";
  }

  function addFiles(fileList: FileList | File[]) {
    const list = Array.from(fileList);
    if (list.length === 0) return;
    for (const f of list) {
      setAttachments((prev) => [...prev, { name: f.name, size: f.size, type: f.type }]);
      setFiles((prev) => [...prev, f]);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const dropped = e.dataTransfer.files;
    if (!dropped || dropped.length === 0) return;
    addFiles(dropped);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragging(false);
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasContent = content.trim().length > 0;
    const hasAttachments = attachments.length > 0;
    if (!hasContent && !hasAttachments) return;

    const payload = {
      content: content.trim(),
      my_understanding: myUnderstanding.trim() || undefined,
      status,
      url_title: fetchedTitle || undefined,
      url_content: fetchedContent || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      files: files.length > 0 ? files : undefined,
    };

    setContent("");
    setMyUnderstanding("");
    setStatus("later");
    setFetchedTitle(null);
    setFetchedContent(null);
    setAttachments([]);
    setFiles([]);
    setSavingCount((n) => n + 1);

    const result = await onAdd(payload);

    if (result.success) {
      const notes = result.item?.parse_debug?.notes || [];
      const summaryErr = notes.find((n) => n.startsWith("summary_error:"));
      const tagsErr = notes.find((n) => n.startsWith("tags_error:"));
      if (summaryErr || tagsErr) {
        const reason = [summaryErr, tagsErr].filter(Boolean).join(" | ");
        setToastMessage(`已收录，摘要/标签稍后补全（${reason}）`);
      } else if (notes.some((n) => n.startsWith("pdf_likely_scanned:"))) {
        setToastMessage("已收录（检测到疑似扫描版 PDF，解析结果可能需要稍后补全）");
      } else {
        setToastMessage("收录成功");
      }
    } else {
      setToastMessage(result.error || "创建记录失败，请稍后重试");
    }
    setSavingCount((n) => Math.max(0, n - 1));
  }

  function dismissToast() {
    setToastMessage(null);
  }

  const hasContent = content.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const isUrl = /(https?:\/\/[^\s]+)/i.test(content.trim());
  const urlFetching = isUrl && fetchingTitle;
  const imageAttachmentCount = attachments.filter((a) => a.type.startsWith("image/")).length;
  const canSubmit = hasContent || hasAttachments;
  const showUrlTitle = fetchedTitle && hasContent;

  return (
    <form onSubmit={handleSubmit}>
      {toastMessage && (
        <div className="fixed right-6 top-6 z-[120] rounded-md bg-[#efe0c8] text-[#5a4630] text-[12px] px-3 py-2 shadow-lg flex items-center gap-2 border border-[#dcc6a1]">
          <span>{toastMessage}</span>
          <button type="button" onClick={dismissToast} className="text-[#7a6346] hover:text-[#4f3b23] cursor-pointer">×</button>
        </div>
      )}

      <div
        className="rounded-[12px] p-2.5 border shadow-[0_10px_22px_rgba(0,0,0,0.05)]"
        style={{
          background:
            "radial-gradient(circle at 20% 10%, rgba(241,90,36,0.05), transparent 30%), linear-gradient(180deg, #F8F4ED, #EFEAE2)",
          borderColor: "rgba(0,0,0,0.16)",
        }}
      >
        <div className="grid grid-cols-2 gap-2 mb-1.5">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            className={`rounded-[8px] transition-colors ${dragging ? "bg-[rgba(241,90,36,0.08)]" : ""}`}
          >
            <div className="text-[9px] font-semibold text-[--muted] tracking-[0.05em] uppercase mb-1">内容输入</div>
            <Textarea
              placeholder="粘贴链接 / 输入文本 / 拖拽文件..."
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              className="w-full border-[rgba(0,0,0,0.16)] rounded-[8px] px-[10px] py-[8px] font-sans text-[11px] text-[--ink] resize-none h-[68px] leading-relaxed bg-white/50 focus:bg-white focus:border-[--innex-accent] focus:shadow-[0_0_0_3px_rgba(241,90,36,0.08)] transition-all placeholder:text-gray-300"
            />
            {dragging && <p className="text-[10px] text-[--innex-accent] mt-1">松开即可添加附件</p>}
            {showUrlTitle && (
              <p className="text-[10px] text-[--text-secondary] mt-1">
                识别标题：<span className="font-medium text-[--ink]">{fetchedTitle}</span>
              </p>
            )}
          </div>

          <div>
            <div className="text-[9px] font-semibold text-[--muted] tracking-[0.05em] uppercase mb-1">
              我的理解 <span className="text-[--muted] font-normal normal-case text-[9px]">（选填）</span>
            </div>
            <Textarea
              placeholder="写下你对这条内容的理解，会用于后续内化..."
              value={myUnderstanding}
              onChange={(e) => setMyUnderstanding(e.target.value)}
              className="w-full border-[rgba(0,0,0,0.16)] rounded-[8px] px-[10px] py-[8px] font-sans text-[11px] text-[--ink] resize-none h-[68px] leading-relaxed bg-white/50 focus:bg-white focus:border-[--innex-accent] focus:shadow-[0_0_0_3px_rgba(241,90,36,0.08)] transition-all placeholder:text-gray-300"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          {attachments.map((att, i) => (
            <span
              key={i}
              className="flex items-center gap-1 bg-white/60 rounded-[6px] px-2 py-0.5 text-[10px] text-[--text-secondary] border border-[--border-light]"
            >
              <span className="text-[11px]">{att.type.startsWith("image/") ? "🖼" : "📄"}</span>
              <span className="max-w-[112px] overflow-hidden text-ellipsis whitespace-nowrap">{att.name}</span>
              <button type="button" onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-red-500 text-xs">×</button>
            </span>
          ))}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 border border-[rgba(0,0,0,0.16)] rounded-[6px] px-2 py-0.5 cursor-pointer text-[10px] text-[--text-muted] bg-white/45 hover:border-[--innex-accent] hover:text-[--innex-accent] transition-all"
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
            添加附件
          </button>

          <input ref={fileRef} type="file" multiple onChange={handleFileChange} className="hidden" />
        </div>

        {imageAttachmentCount > 10 && (
          <p className="text-[10px] text-[--text-secondary] mb-2">图片超过10张，本次录入不会读取图片内容，需内化后处理。</p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setStatus("later")}
              className={`flex items-center gap-1 px-2 py-1 rounded-[8px] border text-[10px] transition-all cursor-pointer ${
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
              className={`flex items-center gap-1 px-2 py-1 rounded-[8px] border text-[10px] transition-all cursor-pointer ${
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
            disabled={!canSubmit}
            className="bg-[--innex-accent] text-white border border-[--innex-accent] rounded-[9px] px-[16px] py-2 font-sans text-[12px] font-bold cursor-pointer transition-all duration-200 flex items-center gap-1 whitespace-nowrap shadow-[0_6px_14px_rgba(241,90,36,0.22)] hover:bg-white hover:text-[--innex-accent] hover:-translate-y-px hover:shadow-[0_9px_18px_rgba(241,90,36,0.28)] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {urlFetching ? "正在读取页面..." : savingCount > 0 ? "添加记录" : "添加记录"}
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
