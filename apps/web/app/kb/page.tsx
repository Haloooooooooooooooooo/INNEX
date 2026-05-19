import { AppLayout } from "@/components/layout/app-layout";

export default function KbPage() {
  return (
    <AppLayout>
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <p className="text-lg font-medium">知识库</p>
          <p className="text-sm mt-2">第二阶段实现</p>
        </div>
      </div>
    </AppLayout>
  );
}
