"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QuickCaptureProps {
  onAdd: (item: {
    type: string;
    title: string;
    source: string;
    source_url?: string;
    raw_content?: string;
    my_understanding?: string;
    tags?: string[];
    status: string;
  }) => Promise<{ success?: boolean; error?: string }>;
}

export function QuickCapture({ onAdd }: QuickCaptureProps) {
  const [expanded, setExpanded] = useState(false);
  const [type, setType] = useState("text");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [myUnderstanding, setMyUnderstanding] = useState("");
  const [status, setStatus] = useState("later");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !source.trim()) return;

    setSaving(true);
    await onAdd({
      type,
      title: title.trim(),
      source: source.trim(),
      source_url: type === "url" ? sourceUrl.trim() || undefined : undefined,
      raw_content: rawContent.trim() || undefined,
      my_understanding: myUnderstanding.trim() || undefined,
      status,
    });
    setTitle("");
    setSource("");
    setSourceUrl("");
    setRawContent("");
    setMyUnderstanding("");
    setStatus("later");
    setType("text");
    setExpanded(false);
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-[--border-light] p-5 shadow-sm">
      {!expanded ? (
        <div className="flex gap-3 items-center">
          <Input
            placeholder="快速录入：输入标题，回车展开…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => setExpanded(true)}
            className="flex-1 h-10 text-sm border-[--border-light]"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(true)}>
            展开
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Select value={type} onValueChange={(v) => v && setType(v)}>
              <SelectTrigger className="w-28 h-10 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">文字</SelectItem>
                <SelectItem value="url">链接</SelectItem>
                <SelectItem value="image">图片</SelectItem>
                <SelectItem value="document">文档</SelectItem>
                <SelectItem value="video">视频</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1 h-10 text-sm border-[--border-light]"
              required
            />
            <Select value={status} onValueChange={(v) => v && setStatus(v)}>
              <SelectTrigger className="w-28 h-10 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="later">稍后看</SelectItem>
                <SelectItem value="pending">待内化</SelectItem>
                <SelectItem value="crystallized">已沉淀</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-3">
            <Input
              placeholder="来源（如：微信公众号、B站…）"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="flex-1 h-10 text-sm border-[--border-light]"
              required
            />
            {type === "url" && (
              <Input
                placeholder="https://…"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                className="flex-1 h-10 text-sm border-[--border-light]"
              />
            )}
          </div>
          <Textarea
            placeholder="原始内容（可选）"
            value={rawContent}
            onChange={(e) => setRawContent(e.target.value)}
            className="text-sm border-[--border-light] min-h-[80px]"
          />
          <Textarea
            placeholder="我的理解（可选）"
            value={myUnderstanding}
            onChange={(e) => setMyUnderstanding(e.target.value)}
            className="text-sm border-[--border-light] min-h-[60px]"
          />
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              收起
            </Button>
            <Button type="submit" disabled={saving} size="sm">
              {saving ? "收录中…" : "收录"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
