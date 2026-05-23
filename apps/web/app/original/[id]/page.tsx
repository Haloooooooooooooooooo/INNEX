import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function OriginalPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { id } = await params;
  const { data: item } = await supabase
    .from("capture_items")
    .select("*, attachments(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!item) {
    return <div className="p-6 text-sm">未找到原笔记</div>;
  }

  if (item.source_url && item.type === "url") {
    redirect(item.source_url);
  }

  const firstAttachment = Array.isArray(item.attachments) ? item.attachments[0] : null;
  const sourceUrl = typeof item.source_url === "string" ? item.source_url : "";
  const fileType = (firstAttachment?.file_type || "").toLowerCase();
  const storagePath = firstAttachment?.storage_path || "";

  const imageLike = item.type === "image" || fileType.startsWith("image/");
  const documentLike =
    item.type === "document" ||
    fileType.includes("pdf") ||
    fileType.includes("word") ||
    fileType.includes("text") ||
    fileType.includes("officedocument");

  const candidateUrl =
    sourceUrl ||
    (storagePath.startsWith("http://") || storagePath.startsWith("https://")
      ? storagePath
      : "");

  const canEmbedImage = imageLike && candidateUrl;
  const canEmbedDoc = documentLike && candidateUrl;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-bold">原笔记</h1>
      <div className="text-sm text-gray-600">{item.title}</div>

      {canEmbedImage && (
        <div className="rounded-lg border p-4 bg-white">
          <h2 className="font-semibold mb-3">原图片</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={candidateUrl} alt={item.title || "原图"} className="max-w-full h-auto rounded border" />
        </div>
      )}

      {canEmbedDoc && (
        <div className="rounded-lg border p-4 bg-white">
          <h2 className="font-semibold mb-3">原文档</h2>
          <div className="mb-3">
            <a className="text-sm text-blue-600 underline" href={candidateUrl} target="_blank" rel="noreferrer">
              在新窗口打开原文档
            </a>
          </div>
          <iframe src={candidateUrl} className="w-full h-[70vh] border rounded" title="原文档预览" />
        </div>
      )}

      {!canEmbedImage && !canEmbedDoc && (
        <div className="rounded-lg border p-4 bg-white">
          <h2 className="font-semibold mb-2">原始内容</h2>
          <pre className="whitespace-pre-wrap text-sm leading-7">
            {item.raw_content || "暂无可展示原文。当前记录可能只保存了解析文本或附件元信息。"}
          </pre>
        </div>
      )}

      <div className="rounded-lg border p-4 bg-white">
        <h2 className="font-semibold mb-2">附件列表</h2>
        {Array.isArray(item.attachments) && item.attachments.length > 0 ? (
          <ul className="list-disc pl-5 text-sm space-y-1">
            {item.attachments.map((att: { id: string; file_name: string; file_type?: string | null }) => (
              <li key={att.id}>
                {att.file_name}
                {att.file_type ? ` (${att.file_type})` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">暂无附件</p>
        )}
      </div>
    </main>
  );
}
