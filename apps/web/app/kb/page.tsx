"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useRef, useState } from "react";

type GraphNode = { id: string; label: string; source?: string | null; createdAt?: string; concepts?: string[] };
type GraphEdge = { id: string; source: string; target: string; type: string; confidence: number | null; evidence: Record<string, unknown> | null };
type GraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    nodeCount: number; edgeCount: number; durationMs?: number;
  };
};

type NoteDetailResponse = {
  note: { id: string; title: string; summary: string | null; source: string | null; created_at: string; concepts: string[] };
  relations: Array<{ id: string; source_note_id: string; target_note_id: string; relation_type: string }>;
};

const RELATION_COLORS: Record<string, string> = { related: "#6B7280", supports: "#2563EB", example_of: "#16A34A" };
const relationColor = (t: string) => RELATION_COLORS[t] || "#6B7280";
const fmtDate = (value?: string) => (value ? new Date(value).toLocaleDateString("zh-CN") : "-");

function spreadNodes(nodes: GraphNode[], width: number, height: number) {
  const count = Math.max(nodes.length, 1);
  const cx = Math.max(120, Math.floor(width / 2));
  const cy = Math.max(120, Math.floor(height / 2));
  const maxR = Math.max(220, Math.min(width, height) * 0.42);
  return nodes.map((n, i) => {
    const angle = i * 2.399963229728653;
    const radius = Math.min(maxR, 80 + Math.sqrt((i + 1) / count) * maxR);
    return {
      ...n,
      id: n.id,
      style: {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      },
    };
  });
}

const FORCE_LAYOUT = {
  type: "force" as const,
  preventOverlap: true,
  preventOverlapPadding: 24,
  nodeSize: 22,
  nodeSpacing: 14,
  linkDistance: 240,
  nodeStrength: -950,
  edgeStrength: 0.05,
  gravity: 0.05,
};

export default function KbPage() {
  const [search, setSearch] = useState("");
  const [graphData, setGraphData] = useState<GraphResponse>({ nodes: [], edges: [], meta: { nodeCount: 0, edgeCount: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<NoteDetailResponse["note"] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [relationTypes, setRelationTypes] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  const graphWrapRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);

  const filteredEdges = useMemo(() => {
    const allow = new Set(selectedTypes.length ? selectedTypes : relationTypes);
    return graphData.edges.filter((e) => allow.has(e.type));
  }, [graphData.edges, selectedTypes, relationTypes]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const p = new URLSearchParams();
        if (search.trim()) p.set("search", search.trim());
        p.set("limit", "300");
        const res = await fetch(`/api/graph?${p.toString()}`);
        if (!res.ok) throw new Error("图谱加载失败");
        const data = (await res.json()) as GraphResponse;
        if (cancelled) return;
        setGraphData(data);
        const types = Array.from(new Set((data.edges || []).map((e) => e.type || "related")));
        setRelationTypes(types);
        if (!selectedTypes.length) setSelectedTypes(types);
        if (!activeNoteId && data.nodes.length) setActiveNoteId(data.nodes[0].id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "图谱加载失败");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [search]);

  useEffect(() => {
    if (!activeNoteId) {
      setActiveNote(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/notes/${activeNoteId}`);
        if (!res.ok) throw new Error("详情加载失败");
        const data = (await res.json()) as NoteDetailResponse;
        if (cancelled) return;
        setActiveNote(data.note);
        setDrawerOpen(true);
      } catch {
        if (!cancelled) setActiveNote(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeNoteId]);

  useEffect(() => {
    if (!graphWrapRef.current) return;
    let disposed = false;
    const safeRun = async (fn: () => unknown | Promise<unknown>) => {
      try {
        await fn();
      } catch {
        // graph may be not ready / disposed during rapid state changes
      }
    };
    (async () => {
      const { Graph } = await import("@antv/g6");
      if (disposed || !graphWrapRef.current) return;
      if (!graphRef.current) {
        graphRef.current = new Graph({
          container: graphWrapRef.current,
          autoFit: "view",
          animation: false,
          data: { nodes: [], edges: [] },
          node: { style: { labelText: (d: any) => String(d.label || "").slice(0, 12), labelPlacement: "bottom", labelFontSize: 9, fill: "#F15A24", fillOpacity: 0.2, stroke: "#F15A24", lineWidth: 1.5, size: (d: any) => 16 + Math.min((d.degree || 0) * 2, 18) } },
          edge: { style: { stroke: (d: any) => relationColor(d.type || "related"), strokeOpacity: (d: any) => (typeof d.confidence === "number" ? Math.max(0.25, Math.min(0.9, d.confidence)) : 0.35), lineWidth: 1 } },
          layout: FORCE_LAYOUT,
          behaviors: ["drag-canvas", "zoom-canvas", "drag-element", "hover-activate"],
        });
        graphRef.current.on("node:click", (evt: any) => evt?.target?.id && setActiveNoteId(evt.target.id));
      }
      const graph = graphRef.current;
      if (!graph || disposed || graphRef.current !== graph) return;
      const rect = graphWrapRef.current.getBoundingClientRect();
      const edges = filteredEdges;
      const nodes = graphData.nodes;
      const hasEdges = edges.length > 0;
      if (typeof graph.resize === "function") {
        await safeRun(() => graph.resize(rect.width, rect.height));
      }
      await safeRun(() =>
        graph.setOptions?.({
          layout: hasEdges
            ? FORCE_LAYOUT
            : {
                type: "grid",
                preventOverlap: true,
                nodeSize: 22,
                begin: [80, 80],
                sortBy: "id",
              },
        })
      );
      await safeRun(() =>
        graph.setData({
          nodes: hasEdges
            ? spreadNodes(nodes, rect.width, rect.height)
            : spreadNodes(nodes, rect.width, rect.height),
          edges: edges.map((e) => ({ ...e, id: e.id })),
        })
      );
      if (typeof graph.draw === "function") await safeRun(() => graph.draw()); else await safeRun(() => graph.render());
      await safeRun(() => graph.fitView({ padding: [24, 24, 24, 24] }));
      if (typeof graph.fitCenter === "function") {
        await safeRun(() => graph.fitCenter());
      }

      if (!activeNoteId) return;
      for (const n of nodes) {
        await safeRun(() => graph.setElementState(n.id, "selected", n.id === activeNoteId));
      }
  })();
    return () => { disposed = true; };
  }, [graphData, filteredEdges, activeNoteId]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), graph: { nodes: graphData.nodes, edges: filteredEdges, meta: graphData.meta } }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `innex-graph-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        <div className="px-5 pt-10 pb-6 shrink-0">
          <div className="flex items-center gap-2.5"><div className="w-[3px] h-[18px] bg-[--innex-accent] rounded-sm shrink-0" /><span className="text-xl font-[850] text-[--ink] tracking-[-0.2px]">知识图谱</span><span className="text-[11px] text-[#8A8278] font-semibold tracking-[0.12em] uppercase ml-1">KNOWLEDGE GRAPH</span></div>
          <p className="text-xs text-[--text-secondary] mt-1">支持性能统计、局部展开、关系证据、低置信批处理与导出。</p>
        </div>

        <div className="px-5 pb-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative"><Input placeholder="搜索节点标题或摘要..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64 h-8 text-xs border-[--border-light] rounded-md pl-7" /><span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs opacity-40">🔍</span></div>
            <div className="flex flex-wrap gap-1.5">{relationTypes.map((t) => <button key={t} onClick={() => setSelectedTypes((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])} className={`text-[10px] px-2 py-1 rounded border ${selectedTypes.includes(t) ? "border-[--innex-accent] text-[--innex-accent] bg-[--innex-accent-dim]" : "border-[--border-light]"}`}>{t}</button>)}</div>
          </div>
        </div>

        <div className="flex-1 min-h-0 px-5 pb-8">
          {loading ? <p className="text-sm text-muted-foreground">图谱加载中...</p> : (
            <div className="h-full min-h-0 flex gap-3">
              <div className="bg-white rounded-xl border border-[--border-light] min-h-[460px] h-full overflow-hidden relative flex-1">
                {error ? <div className="p-4 text-sm text-red-500">{error}</div> : filteredEdges.length === 0 && graphData.nodes.length === 0 ? <div className="h-full flex items-center justify-center text-sm text-muted-foreground">知识库为空</div> : <div ref={graphWrapRef} className="w-full h-full" />}
                <div className="absolute right-3 top-3 flex items-center gap-2 bg-white/90 border border-[--border-light] rounded-lg p-1.5 shadow-sm z-10">
                  <button onClick={() => graphRef.current?.zoomBy(1.2)} className="text-xs px-2 py-1 rounded hover:bg-[--innex-accent-dim]">+</button>
                  <button onClick={() => graphRef.current?.zoomBy(0.85)} className="text-xs px-2 py-1 rounded hover:bg-[--innex-accent-dim]">-</button>
                  <button onClick={() => graphRef.current?.fitView()} className="text-xs px-2 py-1 rounded hover:bg-[--innex-accent-dim]">适配</button>
                  <button onClick={exportJson} className="text-xs px-2 py-1 rounded hover:bg-[--innex-accent-dim]">JSON</button>
                </div>
                <div className="absolute left-3 bottom-3 text-[11px] text-[--text-secondary] bg-white/90 border border-[--border-light] rounded-md px-2 py-1 shadow-sm">
                  节点数: {graphData.meta.nodeCount}
                </div>
              </div>

              <div className={`h-full transition-all duration-200 overflow-hidden ${drawerOpen ? "w-[360px]" : "w-0"}`}>
                <div className="h-full bg-white rounded-xl border border-[--border-light]">
                  <div className="px-4 py-3 border-b border-[--border-light] flex items-center justify-between">
                    <div className="text-sm font-semibold text-[--ink]">节点详情</div>
                    <button onClick={() => setDrawerOpen(false)} className="text-xs px-2 py-1 rounded border border-[--border-light] hover:bg-[--innex-accent-dim]">关闭</button>
                  </div>
                  <div className="p-4 space-y-3 text-xs">
                    {detailLoading ? <div className="text-muted-foreground">加载中...</div> : !activeNote ? <div className="text-muted-foreground">点击节点查看详情</div> : <>
                      <div>
                        <div className="text-[15px] font-semibold leading-6 text-[--ink]">{activeNote.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">{activeNote.source || "未知来源"} · {fmtDate(activeNote.created_at)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[--text-secondary] font-semibold mb-1">摘要</div>
                        <div className="text-[12px] leading-5 text-[--ink]">{activeNote.summary || "暂无摘要"}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[--text-secondary] font-semibold mb-1">概念标签</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(activeNote.concepts || []).length ? activeNote.concepts.map((c) => <span key={c} className="text-[10px] px-2 py-0.5 rounded bg-[--innex-accent-dim] text-[--innex-accent]">{c}</span>) : <span className="text-muted-foreground">暂无</span>}
                        </div>
                      </div>
                    </>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
