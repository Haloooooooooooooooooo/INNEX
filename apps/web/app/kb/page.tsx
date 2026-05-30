"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { StatusBadge } from "@/components/shared/status-badge";
import { WaveLoader } from "@/components/shared/wave-loader";
import type { CaptureItem } from "@/lib/supabase/types";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
  note: {
    id: string;
    title: string;
    content?: string | null;
    summary: string | null;
    source: string | null;
    source_url?: string | null;
    created_at: string;
    concepts: string[];
    tags?: string[];
    capture_item_id?: string | null;
  };
  relations: Array<{ id: string; source_note_id: string; target_note_id: string; relation_type: string }>;
};

const RELATION_COLORS: Record<string, string> = {
  related: "#6B7280",
  supports: "#2563EB",
  example_of: "#16A34A",
  weak_related: "#94A3B8",
  fallback: "#B8BCC5",
};
const relationColor = (t: string) => RELATION_COLORS[t] || "#6B7280";
function relationLineDash(type: string): number[] | undefined {
  if (type === "weak_related") return [6, 6];
  if (type === "fallback") return [3, 7];
  return undefined;
}
function hexToRgb(hex: string) {
  const cleaned = hex.replace("#", "");
  const full = cleaned.length === 3 ? cleaned.split("").map((x) => x + x).join("") : cleaned;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function relationColorByConfidence(type: string, confidence: number | null) {
  const base = relationColor(type);
  const { r, g, b } = hexToRgb(base);
  const c = typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0.55;
  const alpha = 0.35 + c * 0.55;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}
const CLUSTER_COLOR_FAMILIES = [
  // 🍊 orange
  { strong: "#FF7A00", midStrong: "#FF922B", mid: "#FFA94D", weak: "#FFC078" },
  // 🌸 pink
  { strong: "#FF4D8D", midStrong: "#FF6BAA", mid: "#FF85B8", weak: "#FFA8CF" },
  // 🌿 green
  { strong: "#00B96B", midStrong: "#20C97A", mid: "#4CD08A", weak: "#79DFA8" },
  // 🩵 blue
  { strong: "#2979FF", midStrong: "#4C8DFF", mid: "#69A1FF", weak: "#8BB7FF" },
  // 💜 purple
  { strong: "#7C4DFF", midStrong: "#9575FF", mid: "#A98EFF", weak: "#C0A8FF" },
  // ❤️ coral
  { strong: "#FF5A5F", midStrong: "#FF7276", mid: "#FF8D90", weak: "#FFADB0" },
  // 🌊 teal
  { strong: "#00AFAF", midStrong: "#19BDBD", mid: "#3CCACA", weak: "#7BDFDF" },
  // 🌻 sunflower
  { strong: "#D89A00", midStrong: "#E3AC1F", mid: "#EDBE42", weak: "#F4D27E" },
  // 🍇 grape
  { strong: "#6A3CF0", midStrong: "#7E57F4", mid: "#9574F7", weak: "#B49EF9" },
  // 🌹 rose
  { strong: "#E43F5A", midStrong: "#EB5D74", mid: "#F07A8C", weak: "#F6A8B2" },
  // 🪵 brown
  { strong: "#A06A3A", midStrong: "#B17C4F", mid: "#C29166", weak: "#D8B08E" },
  // 🟢 lime
  { strong: "#5BAF00", midStrong: "#71BE1E", mid: "#89CC3E", weak: "#AFDE7A" },
  // 🌌 indigo
  { strong: "#3F51B5", midStrong: "#5A6AC3", mid: "#7583D0", weak: "#A2ACE0" },
  // 🧊 cyan
  { strong: "#00A3D9", midStrong: "#1DB4E3", mid: "#45C5EC", weak: "#8EDDF4" },
  // 🍉 watermelon
  { strong: "#EF476F", midStrong: "#F26586", mid: "#F5839C", weak: "#F8AFC0" },
];

function mixHex(hexA: string, hexB: string, t: number) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(a.r + (b.r - a.r) * k);
  const g = Math.round(a.g + (b.g - a.g) * k);
  const b2 = Math.round(a.b + (b.b - a.b) * k);
  return `rgb(${r}, ${g}, ${b2})`;
}
function darkenHex(hex: string, amount: number) {
  return mixHex(hex, "#161616", amount);
}
function pickTierColor(
  palette: { strong: string; midStrong: string; mid: string; weak: string },
  strength: number
) {
  const s = Math.max(0, Math.min(1, strength));
  if (s >= 0.8) return palette.strong;
  if (s >= 0.7) return palette.midStrong;
  if (s >= 0.6) return palette.mid;
  return palette.weak;
}
function tierKeyFromStrength(strength: number): "strong" | "midStrong" | "mid" | "weak" {
  const s = Math.max(0, Math.min(1, strength));
  if (s >= 0.8) return "strong";
  if (s >= 0.7) return "midStrong";
  if (s >= 0.6) return "mid";
  return "weak";
}
const fmtDateTime = (value?: string) => {
  if (!value) return "-";
  const d = new Date(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
};

function truncateGraphLabel(input: string, maxUnits = 15): string {
  const text = String(input || "").trim();
  if (!text) return "";
  let units = 0;
  let idx = 0;
  let out = "";
  const isAsciiWordChar = (ch: string) => /[A-Za-z0-9]/.test(ch);
  while (idx < text.length) {
    const ch = text[idx];
    // Non-Chinese token (word/number) counts as 1 unit.
    if (isAsciiWordChar(ch)) {
      let j = idx + 1;
      while (j < text.length && isAsciiWordChar(text[j])) j += 1;
      if (units + 1 > maxUnits) break;
      out += text.slice(idx, j);
      units += 1;
      idx = j;
      continue;
    }
    // Chinese character and most symbols count as 1 unit.
    if (/\s/.test(ch)) {
      out += ch;
      idx += 1;
      continue;
    }
    if (units + 1 > maxUnits) break;
    out += ch;
    units += 1;
    idx += 1;
  }
  const normalizedOut = out.replace(/\s+/g, " ").trim();
  if (normalizedOut.length >= text.length) return normalizedOut;
  return `${normalizedOut}...`;
}

function renderRichMarkdown(content: string) {
  const cleanInline = (s: string) =>
    s
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/^#+\s*/g, "")
      .trim();
  const lines = content.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let listBuffer: string[] = [];
  let quoteBuffer: string[] = [];

  const flushList = () => {
    if (!listBuffer.length) return;
    nodes.push(
      <ol key={`ol-${nodes.length}`} className="list-decimal pl-5 space-y-1 text-[12px] text-[--text-secondary] leading-[1.8]">
        {listBuffer.map((item, i) => (
          <li key={`${item}-${i}`} className="font-medium">{item}</li>
        ))}
      </ol>
    );
    listBuffer = [];
  };

  const flushQuote = () => {
    if (!quoteBuffer.length) return;
    nodes.push(
      <blockquote key={`q-${nodes.length}`} className="border-l-2 border-[--innex-accent] bg-[--paper-light] px-2 py-1 text-[12px] text-[--text-secondary] leading-[1.7]">
        {quoteBuffer.join("\n")}
      </blockquote>
    );
    quoteBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushQuote();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      flushList();
      flushQuote();
      const level = heading[1].length;
      const text = cleanInline(heading[2]);
      nodes.push(
        level <= 1 ? (
          <h2 key={`h-${nodes.length}`} className="mt-2 mb-1.5 text-[18px] font-extrabold text-[--text-primary]">
            {text}
          </h2>
        ) : (
          <h3 key={`h-${nodes.length}`} className="mt-2 mb-1 text-[16px] font-extrabold text-[--text-primary]">
            {text}
          </h3>
        )
      );
      continue;
    }
    const ordered = line.match(/^\d+\.\s+(.+)/);
    if (ordered) {
      flushQuote();
      listBuffer.push(cleanInline(ordered[1]));
      continue;
    }
    const bullet = line.match(/^-\s+(.+)/);
    if (bullet) {
      flushQuote();
      listBuffer.push(cleanInline(bullet[1]));
      continue;
    }
    const quote = line.match(/^>\s*(.+)/);
    if (quote) {
      flushList();
      quoteBuffer.push(quote[1]);
      continue;
    }
    flushList();
    flushQuote();
    nodes.push(
      <p key={`p-${nodes.length}`} className="text-[12px] text-[--text-secondary] leading-[1.9]">
        {cleanInline(line)}
      </p>
    );
  }

  flushList();
  flushQuote();
  return <div className="space-y-2">{nodes}</div>;
}

function spreadNodes(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const nodeIds = nodes.map((n) => n.id);
  const adj = new Map<string, Set<string>>();
  for (const id of nodeIds) adj.set(id, new Set<string>());
  for (const e of edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const id of nodeIds) {
    if (visited.has(id)) continue;
    const comp: string[] = [];
    const queue = [id];
    visited.add(id);
    while (queue.length) {
      const cur = queue.shift()!;
      comp.push(cur);
      for (const nei of adj.get(cur) || []) {
        if (visited.has(nei)) continue;
        visited.add(nei);
        queue.push(nei);
      }
    }
    components.push(comp);
  }
  components.sort((a, b) => b.length - a.length);

  const cx = Math.max(120, Math.floor(width / 2));
  const cy = Math.max(120, Math.floor(height / 2));
  const compRing = Math.max(220, Math.min(width, height) * 0.42);
  const compCount = Math.max(components.length, 1);
  const compCenterByNode = new Map<string, { x: number; y: number }>();

  components.forEach((comp, idx) => {
    const angle = (idx / compCount) * Math.PI * 2 - Math.PI / 2;
    const ring = idx === 0 || compCount <= 1 ? 0 : compRing;
    const center = {
      x: cx + Math.cos(angle) * ring,
      y: cy + Math.sin(angle) * ring,
    };
    comp.forEach((id) => compCenterByNode.set(id, center));
  });

  const rankById = new Map<string, number>();
  components.forEach((comp) => comp.forEach((id, i) => rankById.set(id, i)));

  return nodes.map((n) => {
    const center = compCenterByNode.get(n.id) || { x: cx, y: cy };
    const rank = rankById.get(n.id) ?? 0;
    const angle = rank * 2.399963229728653;
    const localRadius = 22 + Math.sqrt(rank + 1) * 28;
    return {
      ...n,
      id: n.id,
      style: {
        x: center.x + Math.cos(angle) * localRadius,
        y: center.y + Math.sin(angle) * localRadius,
      },
    };
  });
}

const FORCE_LAYOUT = {
  type: "force" as const,
  preventOverlap: true,
  preventOverlapPadding: 46,
  nodeSize: 22,
  nodeSpacing: 34,
  linkDistance: 240,
  nodeStrength: -980,
  edgeStrength: 0.07,
  gravity: 0.05,
};

function linkDistanceByRelation(edge: { relationType?: string; type?: string; confidence?: number | null }) {
  const type = edge.relationType || edge.type || "related";
  const c = typeof edge.confidence === "number" ? Math.max(0, Math.min(1, edge.confidence)) : 0.55;
  const baseByType: Record<string, number> = {
    supports: 190,
    example_of: 205,
    related: 260,
    weak_related: 320,
    fallback: 360,
  };
  const base = baseByType[type] ?? 220;
  // 置信度越高，距离越短；越低，距离越长
  return Math.max(150, Math.min(430, base + (1 - c) * 90 - c * 35));
}

function edgeStrengthByRelation(edge: { relationType?: string; type?: string; confidence?: number | null }) {
  const type = edge.relationType || edge.type || "related";
  const c = typeof edge.confidence === "number" ? Math.max(0, Math.min(1, edge.confidence)) : 0.55;
  const baseByType: Record<string, number> = {
    supports: 0.2,
    example_of: 0.17,
    related: 0.1,
    weak_related: 0.06,
    fallback: 0.04,
  };
  const base = baseByType[type] ?? 0.1;
  return Math.max(0.03, Math.min(0.3, base + c * 0.06));
}

export default function KbPage() {
  const [search, setSearch] = useState("");
  const [graphData, setGraphData] = useState<GraphResponse>({ nodes: [], edges: [], meta: { nodeCount: 0, edgeCount: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<NoteDetailResponse["note"] | null>(null);
  const [activeCaptureItem, setActiveCaptureItem] = useState<CaptureItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [relationTypes, setRelationTypes] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [minConfidence, setMinConfidence] = useState<number>(0.55);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [noteHistory, setNoteHistory] = useState<string[]>([]);
  const [pulseTick, setPulseTick] = useState(0);
  const [drawerView, setDrawerView] = useState<"detail" | "ai">("detail");

  const graphWrapRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);
  const didAutoFitRef = useRef(false);
  const lastGraphShapeRef = useRef<string>("");
  const nodeColorProfileRef = useRef<Map<string, { family: number; tier: "strong" | "midStrong" | "mid" | "weak" }>>(new Map());
  const nextColorFamilyRef = useRef(0);

  const filteredEdges = useMemo(() => {
    const allow = new Set(selectedTypes.length ? selectedTypes : relationTypes);
    return graphData.edges.filter((e) => {
      if (!allow.has(e.type)) return false;
      if (typeof e.confidence !== "number") return minConfidence <= 0;
      return e.confidence >= minConfidence;
    });
  }, [graphData.edges, selectedTypes, relationTypes, minConfidence]);

  const hoverContext = useMemo(() => {
    if (!hoverNodeId) return { relatedNodeIds: new Set<string>(), relatedEdgeIds: new Set<string>() };
    const relatedNodeIds = new Set<string>([hoverNodeId]);
    const relatedEdgeIds = new Set<string>();
    for (const e of filteredEdges) {
      if (e.source === hoverNodeId || e.target === hoverNodeId) {
        relatedNodeIds.add(e.source);
        relatedNodeIds.add(e.target);
        relatedEdgeIds.add(e.id);
      }
    }
    return { relatedNodeIds, relatedEdgeIds };
  }, [hoverNodeId, filteredEdges]);


  useEffect(() => {
    if (!hoverNodeId && !activeNoteId) return;
    const timer = setInterval(() => setPulseTick((x) => x + 1), 120);
    return () => clearInterval(timer);
  }, [hoverNodeId, activeNoteId]);

  const nodeById = useMemo(() => {
    return new Map(graphData.nodes.map((n) => [n.id, n]));
  }, [graphData.nodes]);

  const relatedNotes = useMemo(() => {
    if (!activeNoteId) return [] as Array<{ id: string; title: string; relationType: string; confidence: number | null }>;
    const items: Array<{ id: string; title: string; relationType: string; confidence: number | null }> = [];
    for (const e of filteredEdges) {
      const peerId = e.source === activeNoteId ? e.target : e.target === activeNoteId ? e.source : null;
      if (!peerId) continue;
      const peer = nodeById.get(peerId);
      if (!peer) continue;
      items.push({
        id: peerId,
        title: peer.label || "未命名笔记",
        relationType: e.type || "related",
        confidence: typeof e.confidence === "number" ? e.confidence : null,
      });
    }
    const seen = new Set<string>();
    return items
      .filter((x) => {
        if (seen.has(x.id)) return false;
        seen.add(x.id);
        return true;
      })
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  }, [activeNoteId, filteredEdges, nodeById]);

  const nodeStrengthMap = useMemo(() => {
    const stats = new Map<string, { sum: number; count: number }>();
    for (const n of graphData.nodes) stats.set(n.id, { sum: 0, count: 0 });
    for (const e of filteredEdges) {
      const conf = typeof e.confidence === "number" ? Math.max(0, Math.min(1, e.confidence)) : 0.45;
      for (const id of [e.source, e.target]) {
        const cur = stats.get(id) || { sum: 0, count: 0 };
        cur.sum += conf;
        cur.count += 1;
        stats.set(id, cur);
      }
    }
    const out = new Map<string, number>();
    for (const [id, v] of stats.entries()) {
      out.set(id, v.count > 0 ? v.sum / v.count : 0);
    }
    return out;
  }, [graphData.nodes, filteredEdges]);

  useEffect(() => {
    const profiles = nodeColorProfileRef.current;
    const existingNodeIds = new Set(graphData.nodes.map((n) => n.id));
    const neighborById = new Map<string, string[]>();
    for (const n of graphData.nodes) neighborById.set(n.id, []);
    for (const e of filteredEdges) {
      if (neighborById.has(e.source)) neighborById.get(e.source)!.push(e.target);
      if (neighborById.has(e.target)) neighborById.get(e.target)!.push(e.source);
    }

    for (const n of graphData.nodes) {
      if (profiles.has(n.id)) continue;
      const neighbors = neighborById.get(n.id) || [];
      const familyCount = new Map<number, number>();
      for (const neighborId of neighbors) {
        const p = profiles.get(neighborId);
        if (!p) continue;
        familyCount.set(p.family, (familyCount.get(p.family) || 0) + 1);
      }
      let family: number;
      if (familyCount.size > 0) {
        family = Array.from(familyCount.entries()).sort((a, b) => b[1] - a[1])[0][0];
      } else {
        family = nextColorFamilyRef.current % CLUSTER_COLOR_FAMILIES.length;
        nextColorFamilyRef.current += 1;
      }
      profiles.set(n.id, {
        family,
        tier: tierKeyFromStrength(nodeStrengthMap.get(n.id) ?? 0),
      });
    }

    for (const nodeId of Array.from(profiles.keys())) {
      if (!existingNodeIds.has(nodeId)) profiles.delete(nodeId);
    }
  }, [graphData.nodes, filteredEdges, nodeStrengthMap]);

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
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "图谱加载失败");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [search]);

  useEffect(() => {
    if (!activeNoteId) {
      setActiveNote(null);
      setActiveCaptureItem(null);
      setDrawerView("detail");
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
        setDrawerView("detail");
        if (data.note.capture_item_id) {
          const capRes = await fetch(`/api/capture-items/${data.note.capture_item_id}`);
          if (capRes.ok) {
            const capData = (await capRes.json()) as CaptureItem;
            if (!cancelled) setActiveCaptureItem(capData);
          } else if (!cancelled) {
            setActiveCaptureItem(null);
          }
        } else {
          setActiveCaptureItem(null);
        }
        setDrawerOpen(true);
      } catch {
        if (!cancelled) {
          setActiveNote(null);
          setActiveCaptureItem(null);
        }
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
      const getEventNodeId = (evt: any): string | null => {
        const id =
          evt?.data?.id ||
          evt?.item?.getID?.() ||
          evt?.item?.id ||
          evt?.target?.id ||
          evt?.target?.attributes?.id ||
          evt?.target?.config?.id ||
          evt?.target?.context?.model?.id ||
          null;
        return typeof id === "string" ? id : null;
      };
      if (disposed || !graphWrapRef.current) return;
      if (!graphRef.current) {
        graphRef.current = new Graph({
          container: graphWrapRef.current,
          autoFit: "view",
          animation: false,
          data: { nodes: [], edges: [] },
          node: { style: { labelText: (d: any) => truncateGraphLabel(String(d.label || ""), 15), labelPlacement: "bottom", labelFontSize: 8, labelFill: (d: any) => d.labelFill || "#2f2f2f", labelFontWeight: (d: any) => d.labelFontWeight || 400, fill: (d: any) => d.nodeFill || "#F15A24", fillOpacity: (d: any) => d.nodeFillOpacity ?? 0.2, stroke: (d: any) => d.nodeStroke || "#F15A24", lineWidth: (d: any) => d.nodeLineWidth ?? 1.5, shadowColor: (d: any) => d.shadowColor || "transparent", shadowBlur: (d: any) => d.shadowBlur ?? 0, size: (d: any) => 16 + Math.min((d.degree || 0) * 2, 18) } },
          edge: { style: { stroke: (d: any) => d.edgeStroke || relationColorByConfidence(d.relationType || "related", d.confidence), strokeOpacity: (d: any) => d.edgeOpacity ?? 0.65, lineWidth: (d: any) => d.edgeLineWidth ?? 1.4, lineDash: (d: any) => d.edgeLineDash } },
          layout: FORCE_LAYOUT,
          behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
        });
        graphRef.current.on("node:click", (evt: any) => {
          const id = getEventNodeId(evt);
          if (id) {
            setDrawerOpen(true);
            setDetailLoading(true);
            setActiveNote(null);
            setActiveCaptureItem(null);
            setSelectedNoteId(id);
            setActiveNoteId(id);
          }
        });
        graphRef.current.on("node:mouseenter", (evt: any) => {
          const id = getEventNodeId(evt);
          if (id) setHoverNodeId(id);
        });
        graphRef.current.on("node:pointerenter", (evt: any) => {
          const id = getEventNodeId(evt);
          if (id) setHoverNodeId(id);
        });
        graphRef.current.on("node:mouseleave", () => setHoverNodeId(null));
        graphRef.current.on("node:pointerleave", () => setHoverNodeId(null));
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
            ? {
                ...FORCE_LAYOUT,
                linkDistance: (d: any) => linkDistanceByRelation(d),
                edgeStrength: (d: any) => edgeStrengthByRelation(d),
                nodeStrength: (d: any) => {
                  const degree = Number(d?.degree || 0);
                  if (degree <= 0) return -220;
                  if (degree <= 1) return -360;
                  return -620;
                },
              }
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
            ? spreadNodes(nodes, edges, rect.width, rect.height).map((n: any) => {
              const highlightedByHover = hoverNodeId ? hoverContext.relatedNodeIds.has(n.id) : false;
              const highlightedBySelect = selectedNoteId === n.id;
              const highlighted = highlightedByHover || highlightedBySelect;
              const isActive = activeNoteId === n.id;
              const pulse = 0.5 + 0.5 * Math.sin(pulseTick * 0.5);
              const strength = nodeStrengthMap.get(n.id) ?? 0;
              const profile = nodeColorProfileRef.current.get(n.id);
              const family = profile?.family ?? 0;
              const palette = CLUSTER_COLOR_FAMILIES[family % CLUSTER_COLOR_FAMILIES.length];
              const baseColor = profile
                ? palette[profile.tier]
                : pickTierColor(palette, strength);
              const deepColor = darkenHex(baseColor, 0.25);
              const selectedGlow = darkenHex(baseColor, 0.1);
              return {
                ...n,
                nodeFill: highlightedByHover ? deepColor : baseColor,
                nodeStroke: highlightedBySelect ? "#111111" : "transparent",
                labelFill: highlightedByHover || highlightedBySelect ? "#111111" : "#3f3f3f",
                labelFontWeight: highlightedByHover || highlightedBySelect ? 700 : 400,
                nodeFillOpacity: highlightedByHover ? 0.98 : Math.max(0.62, 0.78 + strength * 0.2),
                nodeLineWidth: highlightedBySelect ? 2.2 : 0,
                shadowColor: highlightedBySelect
                  ? selectedGlow
                  : highlightedByHover
                    ? darkenHex(baseColor, 0.35)
                    : "rgba(80,80,80,0.20)",
                shadowBlur: highlightedBySelect
                  ? 24 + pulse * 12
                  : highlightedByHover
                    ? 16
                    : 7 + strength * 7,
                size: highlightedBySelect ? 28 + pulse * 2 : highlightedByHover ? 24 : 20,
              };
            })
            : spreadNodes(nodes, edges, rect.width, rect.height).map((n: any) => ({
                ...n,
                nodeFill: "#F15A24",
                nodeStroke: "transparent",
                nodeFillOpacity: 0.95,
                nodeLineWidth: 0,
                shadowColor: "rgba(241,90,36,0.35)",
                shadowBlur: 18,
              })),
          edges: edges.map((e) => ({
            ...e,
            id: e.id,
            relationType: e.type || "related",
            type: "line",
            edgeStroke: relationColorByConfidence(e.type || "related", e.confidence),
            edgeLineDash: relationLineDash(e.type || "related"),
            edgeOpacity: hoverNodeId
              ? (hoverContext.relatedEdgeIds.has(e.id)
                ? (0.95 + 0.05 * (0.5 + 0.5 * Math.sin(pulseTick * 0.5)))
                : 0.52)
              : 0.52,
            edgeLineWidth: hoverNodeId
              ? (hoverContext.relatedEdgeIds.has(e.id)
                ? ((e.type === "supports" || e.type === "example_of" ? 3.4 : 2.8) + 0.8 * (0.5 + 0.5 * Math.sin(pulseTick * 0.5)))
                : (e.type === "supports" || e.type === "example_of" ? 2.2 : 1.8))
              : (e.type === "supports" || e.type === "example_of" ? 2.2 : 1.8),
          })),
        })
      );
      if (typeof graph.draw === "function") await safeRun(() => graph.draw()); else await safeRun(() => graph.render());
      const shapeKey = `${nodes.length}-${edges.length}`;
      const shouldAutoFit = !didAutoFitRef.current || lastGraphShapeRef.current !== shapeKey;
      if (shouldAutoFit) {
        await safeRun(() => graph.fitView({ padding: [24, 24, 24, 24] }));
        didAutoFitRef.current = true;
        lastGraphShapeRef.current = shapeKey;
      }

  })();
    return () => { disposed = true; };
  }, [graphData, filteredEdges, activeNoteId, selectedNoteId, hoverNodeId, hoverContext, pulseTick, nodeStrengthMap]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), graph: { nodes: graphData.nodes, edges: filteredEdges, meta: graphData.meta } }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `innex-graph-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const handleViewOriginal = () => {
    if (!activeCaptureItem) {
      const url = activeNote?.source_url;
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      window.alert("暂无可打开的原始来源。");
      return;
    }

    const openTextInBrowser = (title: string, text: string) => {
      const safeTitle = title.replace(/[<>&"]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[m] || m));
      const safeText = text.replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m] || m));
      const html = `<!doctype html><html><head><meta charset="UTF-8"/><title>${safeTitle}</title><style>body{margin:0;padding:20px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#222;background:#fff}pre{white-space:pre-wrap;line-height:1.7;font-size:14px}</style></head><body><pre>${safeText}</pre></body></html>`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    };

    if (activeCaptureItem.type === "text") {
      openTextInBrowser(activeCaptureItem.title || "原笔记内容", activeCaptureItem.raw_content || "暂无原文内容");
      return;
    }

    const url = activeCaptureItem.source_url || activeNote?.source_url;
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    const firstAttachment = Array.isArray(activeCaptureItem.attachments) ? activeCaptureItem.attachments[0] : null;
    const storagePath = firstAttachment?.storage_path || "";
    if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
      window.open(storagePath, "_blank", "noopener,noreferrer");
      return;
    }

    window.alert("暂无可打开的原始来源。");
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setDetailLoading(false);
    setSelectedNoteId(null);
    setActiveNoteId(null);
    setActiveNote(null);
    setActiveCaptureItem(null);
    setDrawerView("detail");
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
            <select value={String(minConfidence)} onChange={(e) => setMinConfidence(Number(e.target.value))} className="h-8 text-xs border border-[--border-light] rounded-md px-2 bg-white">
              <option value="0">显示全部</option>
              <option value="0.5">{"\u2265 0.50"}</option>
              <option value="0.6">{"\u2265 0.60"}</option>
              <option value="0.75">{"\u2265 0.75"}</option>
            </select>
          </div>
        </div>

        <div className="flex-1 min-h-0 px-5 pb-4">
          {loading ? <WaveLoader label="图谱加载中..." size="xl" fullHeight className="min-h-[520px]" /> : (
            <div className="h-full min-h-0 flex gap-3">
              <div className="bg-white rounded-xl border border-[--border-light] min-h-[560px] h-full overflow-hidden relative flex-1">
                {error ? <div className="p-4 text-sm text-red-500">{error}</div> : filteredEdges.length === 0 && graphData.nodes.length === 0 ? <div className="h-full flex items-center justify-center text-sm text-muted-foreground">知识库为空</div> : <div ref={graphWrapRef} className="w-full h-full" />}
                <div className="absolute left-3 top-3 bg-white/92 border border-[--border-light] rounded-lg px-2.5 py-2 shadow-sm z-10 min-w-[168px]">
                  <div className="text-[10px] font-semibold text-[--text-secondary] mb-1">关系图例</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[10px] text-[--ink]">
                      <span className="inline-block w-7 border-t-2 border-[#2563EB]" />
                      <span>supports</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-[--ink]">
                      <span className="inline-block w-7 border-t-2 border-[#16A34A]" />
                      <span>example_of</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-[--ink]">
                      <span className="inline-block w-7 border-t-2 border-[#6B7280]" />
                      <span>related</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-[--ink]">
                      <span className="inline-block w-7 border-t-2 border-[#94A3B8] border-dashed" />
                      <span>weak_related</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-[--ink]">
                      <span className="inline-block w-7 border-t-2 border-[#B8BCC5] border-dashed" />
                      <span>fallback</span>
                    </div>
                  </div>
                </div>
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

              <div className={`h-full transition-all duration-200 overflow-hidden ${drawerOpen ? "w-[460px]" : "w-0"}`}>
                <div className="h-full bg-white rounded-xl border border-[--border-light]">
                  <div className="px-4 py-3 border-b border-[--border-light] flex items-center justify-between bg-[--paper-light]">
                    <div className="text-sm font-semibold text-[--ink]">笔记详情</div>
                    <button onClick={closeDrawer} className="text-xs px-2 py-1 rounded border border-[--border-light] hover:bg-white">关闭</button>
                  </div>
                  <div className={`p-4 space-y-4 text-xs h-[calc(100%-56px)] ${drawerView === "ai" ? "overflow-hidden" : "overflow-auto"}`}>
                    {detailLoading ? <WaveLoader label="详情加载中..." fullHeight className="min-h-[320px]" /> : !activeNote ? <div className="text-muted-foreground">点击节点查看详情</div> : drawerView === "ai" ? (
                      <div className="space-y-3 h-full pb-4">
                        <div className="flex items-center justify-between">
                          <div className="text-[13px] font-semibold text-[--ink]">AI笔记</div>
                          <button
                            onClick={() => setDrawerView("detail")}
                            className="text-[10px] px-3 py-1.5 rounded border border-[#F15A24] bg-[#F15A24] text-white hover:bg-[#d94a16]"
                          >
                            返回详情
                          </button>
                        </div>
                        <div className="list-scrollbar h-[calc(100%-48px)] overflow-auto rounded-md border border-[--border-light] bg-white px-3 py-2">
                          {activeNote.content?.trim() ? (
                            renderRichMarkdown(activeNote.content)
                          ) : (
                            <div className="text-[12px] text-muted-foreground">暂无AI笔记正文</div>
                          )}
                        </div>
                      </div>
                    ) : <>
                      <div className="space-y-1 border-b border-[--border-light] pb-3">
                        <div className="text-[15px] font-semibold leading-6 text-[--ink]">{activeCaptureItem?.title || activeNote.title}</div>
                      </div>
                      <div className="space-y-2 text-[12px] border-b border-[--border-light] pb-3">
                        <div className="flex items-start gap-2">
                          <span className="w-[60px] shrink-0 text-[11px] text-[--text-muted]">来源</span>
                          <span className="text-[--text-primary]">{activeCaptureItem?.source || activeNote.source || "-"}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="w-[60px] shrink-0 text-[11px] text-[--text-muted]">收录时间</span>
                          <span className="text-[--text-primary]">{fmtDateTime(activeCaptureItem?.created_at || activeNote.created_at)}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="w-[60px] shrink-0 text-[11px] text-[--text-muted]">状态</span>
                          <span>
                            <StatusBadge status={activeCaptureItem?.status || "crystallized"} />
                          </span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="w-[60px] shrink-0 text-[11px] text-[--text-muted]">标签</span>
                          <span className="flex-1">
                            {(activeCaptureItem?.tags?.length ? activeCaptureItem.tags : activeNote.tags || []).length ? (
                              (activeCaptureItem?.tags?.length ? activeCaptureItem.tags : activeNote.tags || []).map((t) => (
                                <span
                                  key={t}
                                  className="inline-block text-[11px] px-2 py-0.5 rounded-[5px] bg-[--paper-light] border border-[--border-light] text-[--text-secondary] mr-1"
                                >
                                  {t}
                                </span>
                              ))
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </span>
                        </div>
                        <button
                          onClick={handleViewOriginal}
                          className="mt-1 w-full px-[10px] py-[7px] rounded-[6px] border border-[--border-medium] bg-transparent text-[11px] text-[--text-secondary] font-medium hover:border-[--innex-accent] hover:text-[--innex-accent] hover:bg-[--innex-accent-dim] transition-all text-center cursor-pointer"
                        >
                          查看原笔记
                        </button>
                        <button
                          onClick={() => setDrawerView("ai")}
                          className="w-full px-[10px] py-[7px] rounded-[6px] border border-[--border-medium] bg-transparent text-[11px] text-[--text-secondary] font-medium hover:border-[--innex-accent] hover:text-[--innex-accent] hover:bg-[--innex-accent-dim] transition-all text-center cursor-pointer"
                        >
                          查看AI笔记
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-[--innex-accent] uppercase tracking-[0.06em]">摘要</div>
                        <div className="text-[12px] leading-5 text-[--ink] bg-[--paper-light] border border-[--border-light] rounded-md px-2.5 py-2">
                          {activeNote.summary || "暂无摘要"}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-[--innex-accent] uppercase tracking-[0.06em]">概念标签</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(activeNote.concepts || []).length ? activeNote.concepts.map((c) => <span key={c} className="text-[10px] px-2 py-0.5 rounded bg-[--innex-accent-dim] text-[--innex-accent]">{c}</span>) : <span className="text-muted-foreground">暂无</span>}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-[--innex-accent] uppercase tracking-[0.06em] flex items-center justify-between">
                          <span>关联笔记</span>
                          {noteHistory.length > 0 ? (
                            <button
                              onClick={() => {
                                const prevId = noteHistory[noteHistory.length - 1];
                                setNoteHistory((h) => h.slice(0, -1));
                                setActiveNoteId(prevId);
                              }}
                              className="text-[10px] px-2 py-1 rounded border border-[--border-light] hover:bg-[--innex-accent-dim]"
                            >
                              返回上一个
                            </button>
                          ) : null}
                        </div>
                        <div className="space-y-1.5 max-h-56 overflow-auto pr-1">
                          {relatedNotes.length ? relatedNotes.map((x) => (
                            <button
                              key={x.id}
                              onClick={() => {
                                if (!activeNoteId || activeNoteId === x.id) return;
                                setNoteHistory((h) => [...h, activeNoteId]);
                                setSelectedNoteId(x.id);
                                setActiveNoteId(x.id);
                              }}
                              className="w-full text-left px-2 py-1.5 rounded border border-[--border-light] bg-white hover:bg-[--innex-accent-dim]"
                            >
                              <div className="text-[11px] text-[--ink] truncate">{x.title}</div>
                              <div className="text-[10px] text-[--text-secondary]">
                                {x.relationType}
                                {typeof x.confidence === "number" ? ` · ${(x.confidence * 100).toFixed(0)}%` : ""}
                              </div>
                            </button>
                          )) : <span className="text-muted-foreground">暂无关联</span>}
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
