import { useMemo } from 'react';
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CheckCircle2, Circle, Loader2, Octagon, PauseCircle, XCircle } from 'lucide-react';

export type GraphNodeStatus = 'pending' | 'running' | 'passed' | 'failed' | 'halted';

export interface GraphNodeInput {
  id: string;
  levelIndex: number;
  method: string;
  path: string;
  status: GraphNodeStatus;
  detail?: string;
}
export interface GraphEdgeInput { from: string; to: string; label?: string }

const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 112;

const STATUS_STYLE: Record<GraphNodeStatus, { border: string; bg: string; text: string }> = {
  pending: { border: '#94a3b8', bg: 'rgba(148,163,184,0.10)', text: 'Đang chờ' },
  running: { border: '#0ea5e9', bg: 'rgba(14,165,233,0.12)', text: 'Đang chạy' },
  passed: { border: '#10b981', bg: 'rgba(16,185,129,0.14)', text: 'Pass' },
  failed: { border: '#f43f5e', bg: 'rgba(244,63,94,0.14)', text: 'Fail' },
  halted: { border: '#64748b', bg: 'rgba(100,116,139,0.12)', text: 'Halted' },
};

const METHOD_COLOR: Record<string, string> = {
  GET: '#0284c7', POST: '#059669', PUT: '#d97706', PATCH: '#7c3aed', DELETE: '#e11d48',
};

interface ApiNodeData extends Record<string, unknown> {
  method: string; path: string; status: GraphNodeStatus; levelIndex: number; detail?: string;
}

function StatusIcon({ status }: { status: GraphNodeStatus }) {
  const cls = 'w-4 h-4 flex-shrink-0';
  if (status === 'running') return <Loader2 className={`${cls} animate-spin text-sky-500`} />;
  if (status === 'passed') return <CheckCircle2 className={`${cls} text-emerald-500`} />;
  if (status === 'failed') return <XCircle className={`${cls} text-rose-500`} />;
  if (status === 'halted') return <PauseCircle className={`${cls} text-slate-500`} />;
  return <Circle className={`${cls} text-slate-400`} />;
}

function ApiNode({ data }: NodeProps<Node<ApiNodeData>>) {
  const style = STATUS_STYLE[data.status];
  return (
    <div
      className={`dep-node${data.status === 'running' ? ' dep-node-running' : ''}`}
      style={{ borderColor: style.border, background: style.bg, opacity: data.status === 'halted' ? 0.7 : 1 }}
      data-status={data.status}
    >
      <Handle type="target" position={Position.Left} style={{ background: style.border }} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Level {data.levelIndex}</span>
        <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: style.border }}>
          <StatusIcon status={data.status} /> {style.text}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-black text-white" style={{ background: METHOD_COLOR[data.method] ?? '#475569' }}>{data.method}</span>
        <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate" title={data.path}>{data.path}</span>
      </div>
      {data.detail && <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{data.detail}</div>}
      <Handle type="source" position={Position.Right} style={{ background: style.border }} />
    </div>
  );
}

const nodeTypes = { api: ApiNode };

export default function DependencyGraphView({ nodes, edges, height = 460 }: { nodes: GraphNodeInput[]; edges: GraphEdgeInput[]; height?: number }) {
  const { flowNodes, flowEdges, levelCount } = useMemo(() => {
    const byLevel = new Map<number, GraphNodeInput[]>();
    for (const node of nodes) byLevel.set(node.levelIndex, [...(byLevel.get(node.levelIndex) ?? []), node]);
    const tallest = Math.max(1, ...Array.from(byLevel.values()).map((items) => items.length));
    const statusById = new Map(nodes.map((node) => [node.id, node.status]));

    const flowNodes: Node<ApiNodeData>[] = nodes.map((node) => {
      const siblings = byLevel.get(node.levelIndex) ?? [];
      const index = siblings.findIndex((item) => item.id === node.id);
      const offset = ((tallest - siblings.length) * ROW_HEIGHT) / 2;
      return {
        id: node.id, type: 'api',
        position: { x: node.levelIndex * COLUMN_WIDTH, y: offset + index * ROW_HEIGHT },
        data: { method: node.method, path: node.path, status: node.status, levelIndex: node.levelIndex, detail: node.detail },
        draggable: false,
      };
    });

    const flowEdges: Edge[] = edges
      .filter((edge) => statusById.has(edge.from) && statusById.has(edge.to))
      .map((edge) => {
        const from = statusById.get(edge.from) as GraphNodeStatus;
        const to = statusById.get(edge.to) as GraphNodeStatus;
        const halted = to === 'halted' || from === 'halted' || (from === 'failed' && to === 'pending');
        const color = halted ? '#94a3b8' : from === 'passed' ? '#10b981' : from === 'failed' ? '#f43f5e' : '#64748b';
        return {
          id: `${edge.from}->${edge.to}`, source: edge.from, target: edge.to,
          animated: to === 'running' || (from === 'passed' && to === 'pending'),
          label: halted ? 'Halted' : edge.label,
          style: { stroke: color, strokeWidth: 2, strokeDasharray: halted ? '6 5' : undefined },
          labelStyle: { fill: halted ? '#64748b' : '#334155', fontSize: 10, fontWeight: 700 },
          labelBgStyle: { fill: halted ? '#e2e8f0' : '#f1f5f9', fillOpacity: 0.95 },
          labelBgPadding: [4, 2] as [number, number],
          markerEnd: { type: MarkerType.ArrowClosed, color },
        };
      });
    return { flowNodes, flowEdges, levelCount: byLevel.size };
  }, [nodes, edges]);

  if (!nodes.length) {
    return <div className="p-8 text-center text-xs text-slate-500">Chưa có dữ liệu sơ đồ phụ thuộc cho lượt chạy này.</div>;
  }

  return (
    <div>
      <style>{`
        .dep-node{width:250px;border:2px solid;border-radius:12px;padding:8px 10px;transition:all .3s ease;box-shadow:0 1px 3px rgba(0,0,0,.08)}
        .dep-node-running{animation:dep-pulse 1.1s ease-in-out infinite}
        @keyframes dep-pulse{0%,100%{box-shadow:0 0 0 0 rgba(14,165,233,.65)}50%{box-shadow:0 0 0 7px rgba(14,165,233,0)}}
      `}</style>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/[0.08]">
        <span className="font-semibold text-slate-700 dark:text-slate-200">{nodes.length} endpoint · {levelCount} tầng (Kahn)</span>
        {(['pending', 'running', 'passed', 'failed', 'halted'] as GraphNodeStatus[]).map((status) => (
          <span key={status} className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm border-2" style={{ borderColor: STATUS_STYLE[status].border, background: STATUS_STYLE[status].bg }} />
            {STATUS_STYLE[status].text}
          </span>
        ))}
        <span className="inline-flex items-center gap-1"><Octagon className="w-3 h-3" /> Mũi tên nét đứt: bị dừng an toàn</span>
      </div>
      <div style={{ height }} className="w-full">
        <ReactFlow
          nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes}
          fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.3} maxZoom={1.5}
          nodesConnectable={false} proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
