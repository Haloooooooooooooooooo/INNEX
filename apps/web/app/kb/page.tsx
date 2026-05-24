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
    confidenceStats?: { high: number; mid: number; low: number; unknown: number };
  };
};

type NoteDetailResponse = {
  note: { id: string; title: string; summary: string | null; source: string | null; created_at: string; concepts: string[] };
  relations: Array<{ id: string; source_note_id: string; target_note_id: string; relation_type: string }>;
};

const RELATION_COLORS: Record<string, string> = { related: "#6B7280", extends: "#2563EB", contradicts: "#DC2626", derives_from: "#16A34A" };
const relationColor = (t: string) => RELATION_COLORS[t] || "#6B7280";
const fmt = (v?: string) => (v ? `${String(new Date(v).getMonth() + 1).padStart(2, "0")}-${String(new Date(v).getDate()).padStart(2, "0")}` : "-");

function spreadNodes(nodes: GraphNode[], width: number, height: number) {
  const count = Math.max(nodes.length, 1);
  const cx = Math.max(120, Math.floor(width / 2));
  const cy = Math.max(120, Math.floor(height / 2));
  return nodes.map((n, i) => {
    const angle = i * 0.62;
    const radius = 160 + 36 * Math.sqrt(i + 1);
    return { ...n, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, id: n.id };
  });
}

export default function KbPage() {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"note" | "entity">("note");
  const [graphData, setGraphData] = useState<GraphResponse>({ nodes: [], edges: [], meta: { nodeCount: 0, edgeCount: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<NoteDetailResponse["note"] | null>(null);
  const [relationTypes, setRelationTypes] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [onlyHighConfidence, setOnlyHighConfidence] = useState(false);
  const [onlyNeighborhood, setOnlyNeighborhood] = useState(false);
  const [localExpand, setLocalExpand] = useState(false);
  const [hops, setHops] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedLowIds, setSelectedLowIds] = useState<string[]>([]);
  const [bulkType, setBulkType] = useState("related");
  const [reloadKey, setReloadKey] = useState(0);

  const graphWrapRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);

  const filteredEdges = useMemo(() => {
    const allow = new Set(selectedTypes.length ? selectedTypes : relationTypes);
    return graphData.edges.filter((e) => allow.has(e.type)).filter((e) => !onlyHighConfidence || (typeof e.confidence === "number" && e.confidence >= 0.75));
  }, [graphData.edges, selectedTypes, relationTypes, onlyHighConfidence]);

  const lowEdges = useMemo(() => filteredEdges.filter((e) => typeof e.confidence === "number" && e.confidence < 0.75), [filteredEdges]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const p = new URLSearchParams();
        if (search.trim()) p.set("search", search.trim());
        p.set("mode", mode);
        p.set("limit", "300");
        if (localExpand && activeNoteId) { p.set("centerNoteId", activeNoteId); p.set("hops", String(hops)); }
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
  }, [search, mode, localExpand, hops, activeNoteId, reloadKey]);

  useEffect(() => {
    if (mode !== "note" || !activeNoteId || activeNoteId.startsWith("ent:")) { setActiveNote(null); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/notes/${activeNoteId}`);
      if (!res.ok) return;
      const data = (await res.json()) as NoteDetailResponse;
      if (!cancelled) setActiveNote(data.note);
    })();
    return () => { cancelled = true; };
  }, [mode, activeNoteId, reloadKey]);

  useEffect(() => {
    if (!graphWrapRef.current) return;
    let disposed = false;
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
          layout: { type: "force", preventOverlap: true, preventOverlapPadding: 18, linkDistance: 180, nodeStrength: -260, edgeStrength: 0.08, gravity: 0.12 },
          behaviors: ["drag-canvas", "zoom-canvas", "drag-element", "hover-activate"],
        });
        graphRef.current.on("node:click", (evt: any) => evt?.target?.id && setActiveNoteId(evt.target.id));
      }
      const graph = graphRef.current;
      const rect = graphWrapRef.current.getBoundingClientRect();
      const edges = filteredEdges;
      const nodes = graphData.nodes;
      if (typeof graph.resize === "function") {
        graph.resize(rect.width, rect.height);
      }
      graph.setData({ nodes: spreadNodes(nodes, rect.width, rect.height), edges: edges.map((e) => ({ ...e, id: e.id })) });
      if (typeof graph.draw === "function") graph.draw(); else graph.render();
      graph.fitView({ padding: [24, 24, 24, 24] });
      if (typeof graph.fitCenter === "function") {
        graph.fitCenter();
      }

      if (activeNoteId) {
        const ns = new Set<string>();
        const es = new Set<string>();
        edges.forEach((e) => { if (e.source === activeNoteId) { ns.add(e.target); es.add(e.id); } if (e.target === activeNoteId) { ns.add(e.source); es.add(e.id); } });
        nodes.forEach((n) => {
          const dim = onlyNeighborhood ? !(n.id === activeNoteId || ns.has(n.id)) : false;
          graph.setElementState(n.id, "inactive", dim);
          graph.setElementState(n.id, "selected", n.id === activeNoteId);
        });
        edges.forEach((e) => graph.setElementState(e.id, "inactive", onlyNeighborhood ? !es.has(e.id) : false));
        graph.focusElement(activeNoteId, true);
        graph.zoomTo(Math.max(1.25, Number(graph.getZoom?.() || 1)), { duration: 250 });
      }
    })();
    return () => { disposed = true; };
  }, [graphData, filteredEdges, activeNoteId, onlyNeighborhood]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), graph: { nodes: graphData.nodes, edges: filteredEdges, meta: graphData.meta } }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `innex-graph-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const batchDelete = async () => {
    if (!selectedLowIds.length) return setToast("请先选择关系");
    const res = await fetch("/api/note-relations/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", relationIds: selectedLowIds }) });
    if (!res.ok) return setToast("批量删除失败");
    setSelectedLowIds([]); setReloadKey((k) => k + 1); setToast("批量删除完成");
  };

  const batchRetag = async () => {
    if (!selectedLowIds.length) return setToast("请先选择关系");
    const res = await fetch("/api/note-relations/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retag", relationIds: selectedLowIds, relationType: bulkType }) });
    if (!res.ok) return setToast("批量改类型失败");
    setReloadKey((k) => k + 1); setToast("批量改类型完成");
  };

  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 1800); return () => window.clearTimeout(t); }, [toast]);

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        {toast && <div className="absolute right-5 top-5 z-50 px-3 py-2 rounded-md text-xs shadow-md border bg-emerald-50 text-emerald-700 border-emerald-200">{toast}</div>}

        <div className="px-5 pt-10 pb-6 shrink-0">
          <div className="flex items-center gap-2.5"><div className="w-[3px] h-[18px] bg-[--innex-accent] rounded-sm shrink-0" /><span className="text-xl font-[850] text-[--ink] tracking-[-0.2px]">知识图谱</span><span className="text-[11px] text-[#8A8278] font-semibold tracking-[0.12em] uppercase ml-1">KNOWLEDGE GRAPH</span></div>
          <p className="text-xs text-[--text-secondary] mt-1">支持性能统计、局部展开、关系证据、低置信批处理与导出。</p>
        </div>

        <div className="px-5 pb-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative"><Input placeholder="搜索节点标题或摘要..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64 h-8 text-xs border-[--border-light] rounded-md pl-7" /><span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs opacity-40">🔍</span></div>
            <select value={mode} onChange={(e) => { setMode(e.target.value as "note" | "entity"); setActiveNoteId(null); setReloadKey((k) => k + 1); }} className="h-8 text-xs border border-[--border-light] rounded-md px-2 bg-white"><option value="note">笔记图谱</option><option value="entity">实体图谱</option></select>
          </div>
        </div>

        <div className="flex-1 min-h-0 px-5 pb-8">
          {loading ? <p className="text-sm text-muted-foreground">图谱加载中...</p> : (
            <div className="grid grid-cols-[1.5fr_0.7fr] gap-4 h-full min-h-0">
              <div className="bg-white rounded-xl border border-[--border-light] min-h-[460px] h-full overflow-hidden relative">
                {error ? <div className="p-4 text-sm text-red-500">{error}</div> : filteredEdges.length === 0 && graphData.nodes.length === 0 ? <div className="h-full flex items-center justify-center text-sm text-muted-foreground">知识库为空</div> : <div ref={graphWrapRef} className="w-full h-full" />}
                <div className="absolute right-3 top-3 flex items-center gap-2 bg-white/90 border border-[--border-light] rounded-lg p-1.5 shadow-sm">
                  <button onClick={() => graphRef.current?.zoomBy(1.2)} className="text-xs px-2 py-1 rounded hover:bg-[--innex-accent-dim]">+</button>
                  <button onClick={() => graphRef.current?.zoomBy(0.85)} className="text-xs px-2 py-1 rounded hover:bg-[--innex-accent-dim]">-</button>
                  <button onClick={() => graphRef.current?.fitView()} className="text-xs px-2 py-1 rounded hover:bg-[--innex-accent-dim]">适配</button>
                  <button onClick={exportJson} className="text-xs px-2 py-1 rounded hover:bg-[--innex-accent-dim]">JSON</button>
                </div>
              </div>

              <div className="bg-white border border-[--border-light] rounded-xl p-4 h-full overflow-auto">
                <div className="mb-3 pb-3 border-b border-[--border-light] text-[10px] text-[--text-secondary] leading-5">
                  <div>节点: {graphData.meta.nodeCount} ｜ 边: {filteredEdges.length}</div>
                  <div>接口耗时: {graphData.meta.durationMs ?? "-"}ms</div>
                  <div>高/中/低/未知: {graphData.meta.confidenceStats?.high ?? 0}/{graphData.meta.confidenceStats?.mid ?? 0}/{graphData.meta.confidenceStats?.low ?? 0}/{graphData.meta.confidenceStats?.unknown ?? 0}</div>
                  <label className="mt-2 flex items-center gap-2 text-[11px]"><input type="checkbox" checked={localExpand} onChange={(e) => setLocalExpand(e.target.checked)} className="w-3.5 h-3.5" />局部展开</label>
                  {localExpand && <select value={hops} onChange={(e) => setHops(Number(e.target.value))} className="h-7 text-[10px] border border-[--border-light] rounded px-1 bg-white"><option value={1}>1-hop</option><option value={2}>2-hop</option><option value={3}>3-hop</option></select>}
                </div>

                <div className="mb-3 pb-3 border-b border-[--border-light]">
                  <p className="text-[11px] font-semibold text-[--text-muted] mb-2">关系类型</p>
                  <div className="flex flex-wrap gap-1.5">{relationTypes.map((t) => <button key={t} onClick={() => setSelectedTypes((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])} className={`text-[10px] px-2 py-1 rounded border ${selectedTypes.includes(t) ? "border-[--innex-accent] text-[--innex-accent] bg-[--innex-accent-dim]" : "border-[--border-light]"}`}>{t}</button>)}</div>
                  <label className="mt-2 flex items-center gap-2 text-[11px]"><input type="checkbox" checked={onlyNeighborhood} onChange={(e) => setOnlyNeighborhood(e.target.checked)} className="w-3.5 h-3.5" />仅显示邻接高亮</label>
                  <label className="mt-1 flex items-center gap-2 text-[11px]"><input type="checkbox" checked={onlyHighConfidence} onChange={(e) => setOnlyHighConfidence(e.target.checked)} className="w-3.5 h-3.5" />仅显示高置信（≥0.75）</label>
                </div>

                {mode === "entity" ? <p className="text-xs text-muted-foreground">实体模式：展示 concepts/tags 的实体连接网络。</p> : (
                  <div className="space-y-3">
                    {!activeNote ? <p className="text-xs text-muted-foreground">点击节点查看详情</p> : <>
                      <div><h3 className="font-semibold text-[13px]">{activeNote.title}</h3><p className="text-[10px] text-muted-foreground">{activeNote.source || "未知来源"} · {fmt(activeNote.created_at)}</p></div>
                      <div className="flex gap-1.5 flex-wrap">{(activeNote.concepts || []).slice(0, 6).map((c) => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-[--innex-accent-dim] text-[--innex-accent]">{c}</span>)}</div>
                    </>}

                    <div className="pt-2 border-t border-[--border-light]">
                      <p className="text-[11px] font-semibold mb-2">低置信待处理</p>
                      {lowEdges.length === 0 ? <p className="text-xs text-muted-foreground">暂无低置信关系</p> : <>
                        {lowEdges.slice(0, 15).map((e) => <label key={e.id} className="flex items-center gap-2 text-[10px]"><input type="checkbox" checked={selectedLowIds.includes(e.id)} onChange={() => setSelectedLowIds((p) => p.includes(e.id) ? p.filter((x) => x !== e.id) : [...p, e.id])} className="w-3 h-3" /><span className="flex-1 truncate">{e.source} → {e.target}</span><span>{typeof e.confidence === "number" ? e.confidence.toFixed(2) : "-"}</span></label>)}
                        <div className="flex items-center gap-2 mt-2"><select value={bulkType} onChange={(e) => setBulkType(e.target.value)} className="h-7 text-[10px] border border-[--border-light] rounded px-1 bg-white"><option value="related">related</option><option value="extends">extends</option><option value="contradicts">contradicts</option><option value="derives_from">derives_from</option></select><button onClick={batchRetag} className="text-[10px] px-2 py-1 rounded border border-blue-200 text-blue-600">批量改类型</button><button onClick={batchDelete} className="text-[10px] px-2 py-1 rounded border border-red-200 text-red-600">批量删除</button></div>
                      </>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
