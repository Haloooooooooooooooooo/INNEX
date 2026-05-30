"use client";

import { useRef, useState } from "react";
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
  }>;
}

function splitBlocksByDashLine(raw: string): string[] {
  return raw
    .split(/\r?\n\s*----\s*\r?\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function QuickCapture({ onAdd }: QuickCaptureProps) {
  const [entryMode, setEntryMode] = useState<"single" | "batch">("single");
  const [batchMode, setBatchMode] = useState<"non_doc" | "doc">("non_doc");
  const [status, setStatus] = useState<"later" | "pending">("later");
  const [singleContent, setSingleContent] = useState("");
  const [singleUnderstanding, setSingleUnderstanding] = useState("");
  const [singleFiles, setSingleFiles] = useState<File[]>([]);
  const [bulkText, setBulkText] = useState("");
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const singleFileRef = useRef<HTMLInputElement>(null);
  const batchFileRef = useRef<HTMLInputElement>(null);

  const selectedBtnCls =
    "bg-[#FF5A00] text-[#FFFFFF] border-[#FF5A00] shadow-[0_6px_14px_rgba(255,90,0,0.32)]";
  const unselectedBtnCls =
    "bg-white/45 border-[rgba(0,0,0,0.16)] text-[--text-secondary] hover:border-[--innex-accent] hover:text-[--innex-accent]";

  function dismissToast() {
    setToastMessage(null);
  }

  function addBatchFiles(fileList: FileList | File[]) {
    const list = Array.from(fileList);
    if (!list.length) return;
    setDocFiles((prev) => [...prev, ...list]);
  }

  function removeBatchFile(index: number) {
    setDocFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function addSingleFiles(fileList: FileList | File[]) {
    const list = Array.from(fileList);
    if (!list.length) return;
    setSingleFiles((prev) => [...prev, ...list]);
  }

  function removeSingleFile(index: number) {
    setSingleFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function submitSingle() {
    const trimmed = singleContent.trim();
    if (!trimmed && !singleFiles.length) {
      setToastMessage("请先输入内容或上传附件。");
      return;
    }
    const submitPayload = {
      content: trimmed,
      my_understanding: singleUnderstanding.trim() || undefined,
      status,
      attachments: singleFiles.length
        ? singleFiles.map((f) => ({ name: f.name, size: f.size, type: f.type || "application/octet-stream" }))
        : undefined,
      files: singleFiles.length ? singleFiles : undefined,
    };

    // 先清空输入区，允许马上继续录入下一条
    setSingleContent("");
    setSingleUnderstanding("");
    setSingleFiles([]);
    if (singleFileRef.current) singleFileRef.current.value = "";

    const result = await onAdd(submitPayload);
    setToastMessage(result.success ? "单次录入成功" : (result.error || "单次录入失败"));
  }

  async function submitNonDocBatch() {
    const blocks = splitBlocksByDashLine(bulkText);
    if (!blocks.length) {
      setToastMessage("请先粘贴内容。每条记录之间用单独一行 ---- 分隔。");
      return;
    }

    setSubmitting(true);
    let success = 0;
    let failed = 0;
    for (const block of blocks) {
      const result = await onAdd({
        content: block,
        status,
      });
      if (result.success) success += 1;
      else failed += 1;
    }
    setSubmitting(false);
    setBulkText("");
    setToastMessage(`非文档批量完成：成功 ${success}，失败 ${failed}`);
  }

  async function submitDocBatch() {
    if (!docFiles.length) {
      setToastMessage("请先选择文档/图片附件。");
      return;
    }

    setSubmitting(true);
    let success = 0;
    let failed = 0;
    for (const file of docFiles) {
      const result = await onAdd({
        content: "",
        status,
        attachments: [{ name: file.name, size: file.size, type: file.type || "application/octet-stream" }],
        files: [file],
      });
      if (result.success) success += 1;
      else failed += 1;
    }
    setSubmitting(false);
    setDocFiles([]);
    if (batchFileRef.current) batchFileRef.current.value = "";
    setToastMessage(`文档批量完成：成功 ${success}，失败 ${failed}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting && entryMode === "batch") return;
    if (entryMode === "single") {
      await submitSingle();
      return;
    }
    if (batchMode === "non_doc") {
      await submitNonDocBatch();
      return;
    }
    await submitDocBatch();
  }

  return (
    <form onSubmit={handleSubmit}>
      {toastMessage && (
        <div className="fixed left-1/2 top-5 -translate-x-1/2 z-[120] rounded-md bg-[#efe0c8] text-[#5a4630] text-[12px] px-3 py-2 shadow-lg flex items-center gap-2 border border-[#dcc6a1]">
          <span>{toastMessage}</span>
          <button type="button" onClick={dismissToast} className="text-[#7a6346] hover:text-[#4f3b23] cursor-pointer">
            ×
          </button>
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
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setEntryMode("single")}
            className={`px-3 py-1 rounded-[8px] border text-[11px] transition-all ${
              entryMode === "single" ? selectedBtnCls : unselectedBtnCls
            }`}
          >
            单次录入
          </button>
          <button
            type="button"
            onClick={() => setEntryMode("batch")}
            className={`px-3 py-1 rounded-[8px] border text-[11px] transition-all ${
              entryMode === "batch" ? selectedBtnCls : unselectedBtnCls
            }`}
          >
            批量录入
          </button>
        </div>

        {entryMode === "batch" ? (
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              onClick={() => setBatchMode("non_doc")}
              className={`px-2 py-1 rounded-[7px] border text-[10px] transition-all ${
                batchMode === "non_doc" ? selectedBtnCls : unselectedBtnCls
              }`}
            >
              非文档批量
            </button>
            <button
              type="button"
              onClick={() => setBatchMode("doc")}
              className={`px-2 py-1 rounded-[7px] border text-[10px] transition-all ${
                batchMode === "doc" ? selectedBtnCls : unselectedBtnCls
              }`}
            >
              文档批量（含图片）
            </button>
          </div>
        ) : null}

        {entryMode === "single" ? (
          <div className="space-y-2">
            <Textarea
              placeholder="输入文本或粘贴链接（单次录入）"
              value={singleContent}
              onChange={(e) => setSingleContent(e.target.value)}
              className="w-full border-[rgba(0,0,0,0.16)] rounded-[8px] px-[10px] py-[8px] font-sans text-[11px] text-[--ink] resize-none h-[88px] leading-relaxed bg-white/50 focus:bg-white focus:border-[--innex-accent]"
            />
            <Textarea
              placeholder="我的理解（选填）"
              value={singleUnderstanding}
              onChange={(e) => setSingleUnderstanding(e.target.value)}
              className="w-full border-[rgba(0,0,0,0.16)] rounded-[8px] px-[10px] py-[8px] font-sans text-[11px] text-[--ink] resize-none h-[64px] leading-relaxed bg-white/50 focus:bg-white focus:border-[--innex-accent]"
            />
            <div className="flex items-center gap-2 flex-wrap">
              {singleFiles.map((f, i) => (
                <span key={`${f.name}-${i}`} className="flex items-center gap-1 bg-white/60 rounded-[6px] px-2 py-0.5 text-[10px] border border-[--border-light]">
                  <span>{f.type.startsWith("image/") ? "🖼" : "📄"}</span>
                  <span className="max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">{f.name}</span>
                  <button type="button" onClick={() => removeSingleFile(i)} className="text-xs text-red-500">×</button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => singleFileRef.current?.click()}
                className="flex items-center gap-1 border border-[rgba(0,0,0,0.16)] rounded-[6px] px-2 py-0.5 cursor-pointer text-[10px] text-[--text-muted] bg-white/45 hover:border-[--innex-accent] hover:text-[--innex-accent] transition-all"
              >
                添加附件
              </button>
              <input
                ref={singleFileRef}
                type="file"
                multiple
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files) return;
                  addSingleFiles(files);
                  if (singleFileRef.current) singleFileRef.current.value = "";
                }}
                className="hidden"
              />
            </div>
          </div>
        ) : batchMode === "non_doc" ? (
          <div className="space-y-2">
            <div className="text-[10px] text-[--text-secondary]">一次粘贴多条内容，每条记录之间用单独一行 ---- 分隔。</div>
            <Textarea
              placeholder={"示例：\nhttps://mp.weixin.qq.com/s/3Vs5uXwhJNUaPeRsN1E5cg\n----\nhttp://xhslink.com/o/6uleNhVzUyT"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              className="w-full border-[rgba(0,0,0,0.16)] rounded-[8px] px-[10px] py-[8px] font-sans text-[11px] text-[--ink] resize-none h-[120px] leading-relaxed bg-white/50 focus:bg-white focus:border-[--innex-accent]"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] text-[--text-secondary]">每个文档/图片作为一条记录批量创建。</div>
            <div className="flex items-center gap-2 flex-wrap">
              {docFiles.map((f, i) => (
                <span key={`${f.name}-${i}`} className="flex items-center gap-1 bg-white/60 rounded-[6px] px-2 py-0.5 text-[10px] border border-[--border-light]">
                  <span>{f.type.startsWith("image/") ? "🖼" : "📄"}</span>
                  <span className="max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">{f.name}</span>
                  <button type="button" onClick={() => removeBatchFile(i)} className="text-xs text-red-500">
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => batchFileRef.current?.click()}
                className="flex items-center gap-1 border border-[rgba(0,0,0,0.16)] rounded-[6px] px-2 py-0.5 cursor-pointer text-[10px] text-[--text-muted] bg-white/45 hover:border-[--innex-accent] hover:text-[--innex-accent] transition-all"
              >
                添加多个文件
              </button>
              <input
                ref={batchFileRef}
                type="file"
                multiple
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files) return;
                  addBatchFiles(files);
                  if (batchFileRef.current) batchFileRef.current.value = "";
                }}
                className="hidden"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-2">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setStatus("later")}
              className={`flex items-center gap-1 px-2 py-1 rounded-[8px] border text-[10px] transition-all cursor-pointer ${
                status === "later"
                  ? "bg-[--innex-accent-dim] border-[--innex-accent] text-[--innex-accent]"
                  : "bg-white/40 border-[rgba(0,0,0,0.16)] text-[--text-secondary]"
              }`}
            >
              稍后看
            </button>
            <button
              type="button"
              onClick={() => setStatus("pending")}
              className={`flex items-center gap-1 px-2 py-1 rounded-[8px] border text-[10px] transition-all cursor-pointer ${
                status === "pending"
                  ? "bg-[--innex-accent-dim] border-[--innex-accent] text-[--innex-accent]"
                  : "bg-white/40 border-[rgba(0,0,0,0.16)] text-[--text-secondary]"
              }`}
            >
              收藏
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="bg-[#FF5A00] text-[#FFFFFF] border border-[#FF5A00] rounded-[9px] px-[16px] py-2 font-sans text-[12px] font-black tracking-[0.015em] antialiased cursor-pointer transition-all duration-120 flex items-center gap-1 whitespace-nowrap shadow-[0_6px_14px_rgba(255,90,0,0.32)] disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {submitting ? (entryMode === "single" ? "单次录入中..." : "批量录入中...") : (entryMode === "single" ? "添加记录" : "开始批量录入")}
          </button>
        </div>
      </div>
    </form>
  );
}
