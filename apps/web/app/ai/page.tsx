import { AppLayout } from "@/components/layout/app-layout";

export default function AiPage() {
  return (
    <AppLayout>
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <p className="text-lg font-medium">AI 助手</p>
          <p className="text-sm mt-2">第二阶段实现 — 基于笔记的 RAG 问答</p>
        </div>
      </div>
    </AppLayout>
  );
}
