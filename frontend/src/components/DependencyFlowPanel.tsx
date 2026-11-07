import { useMemo } from 'react';
import { ArrowRight, Database, GitMerge, Workflow } from 'lucide-react';
import type { SpecFlowResponse } from '@shared/types';
import type { TestCaseDto } from '../api/testcases.api';

interface ContextBindingInfo { path: string; sourceNodeId: string; sourcePath: string; fallbackValue?: unknown }

function findContextBindings(obj: unknown, path = ''): ContextBindingInfo[] {
  const bindings: ContextBindingInfo[] = [];
  const walk = (val: unknown, currentPath: string) => {
    if (!val || typeof val !== 'object') return;
    const rec = val as Record<string, unknown>;
    if (rec._type === 'CONTEXT_BINDING' && typeof rec.sourceNodeId === 'string') {
      bindings.push({ path: currentPath, sourceNodeId: rec.sourceNodeId, sourcePath: typeof rec.sourcePath === 'string' ? rec.sourcePath : 'body.id', fallbackValue: rec.fallbackValue });
      return;
    }
    if (Array.isArray(val)) val.forEach((item, idx) => walk(item, `${currentPath}[${idx}]`));
    else Object.entries(val).forEach(([k, v]) => walk(v, currentPath ? `${currentPath}.${k}` : k));
  };
  walk(obj, path);
  return bindings;
}

type EndpointFlow = SpecFlowResponse['endpointFlows'][number];

export default function DependencyFlowPanel({ endpointFlow, selectedEndpoint, activeCases, activeCase }: {
  endpointFlow: EndpointFlow | undefined;
  selectedEndpoint: { method: string; path: string } | undefined;
  activeCases: TestCaseDto[];
  activeCase: TestCaseDto | undefined;
}) {
  const contextBindings = useMemo(() => {
    if (!activeCase) return [];
    const fromPayload = findContextBindings(activeCase.payload, 'body');
    const fromOriginal = activeCase.originalPayload ? findContextBindings(activeCase.originalPayload, '') : [];
    const merged = [...fromPayload];
    fromOriginal.forEach((o) => { if (!merged.some((m) => m.path === o.path)) merged.push(o); });
    return merged;
  }, [activeCase]);

  return (
                <div className="space-y-4 text-xs">
                  <div className="p-4 rounded-xl bg-gradient-to-r from-sky-500/10 via-indigo-500/10 to-transparent border border-sky-500/20">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Workflow className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                        <div>
                          <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                            Đồ thị Luồng Phụ thuộc (Dependency Test Flow — DAG)
                          </h4>
                          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                            Thứ tự thực thi được sắp xếp tự động bằng thuật toán Kahn (Topological Sort) dựa trên quan hệ Producer - Consumer.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-lg font-black text-xs bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/30 whitespace-nowrap">
                          THỨ TỰ: LEVEL {endpointFlow?.levelIndex ?? 0}
                        </span>
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap ${(endpointFlow?.levelIndex ?? 0) === 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300'}`}>
                          {(endpointFlow?.levelIndex ?? 0) === 0 ? 'Level 0 — Producer (Khởi tạo độc lập)' : `Level ${endpointFlow?.levelIndex} — Consumer (Tiêu thụ dữ liệu)`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.08]">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-3">
                      Sơ đồ chuỗi gọi trực quan (Execution Pipeline):
                    </span>
                    {(endpointFlow?.levelIndex ?? 0) === 0 ? (
                      /* LEVEL 0: PRODUCER PIPELINE */
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="p-3 rounded-xl border-2 border-primary-500 bg-primary-50 dark:bg-primary-500/20 text-xs shadow-md">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-primary-600 text-white">HIỆN TẠI (PRODUCER)</span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-600 text-white">LEVEL 0</span>
                          </div>
                          <span className="font-mono font-bold text-primary-900 dark:text-white text-sm">
                            {selectedEndpoint?.method} {selectedEndpoint?.path}
                          </span>
                          <span className="block text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
                            ★ Sinh ra: id, response body ({activeCases.length} kịch bản)
                          </span>
                        </div>

                        <div className="flex items-center text-primary-600 dark:text-primary-400 font-bold text-xs gap-1 px-1">
                          <span>CUNG CẤP DỮ LIỆU ĐẦU VÀO</span>
                          <ArrowRight className="w-4 h-4" />
                        </div>

                        {endpointFlow?.downstreamConsumers && endpointFlow.downstreamConsumers.length > 0 ? (
                          endpointFlow.downstreamConsumers.map((consumer, idx) => (
                            <div key={idx} className="p-2.5 rounded-xl border bg-sky-50 dark:bg-sky-950/30 border-sky-300 dark:border-sky-800 text-xs shadow-sm">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-sky-600 text-white">CONSUMER #{idx + 1}</span>
                                <span className="font-mono text-[10px] text-sky-800 dark:text-sky-300 font-bold">{consumer.targetMethod}</span>
                              </div>
                              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{consumer.targetPath}</span>
                              <span className="block text-[10px] text-sky-600 dark:text-sky-400 mt-1">
                                Nhận biến: <span className="font-mono font-bold">{'{' + consumer.consumedParam + '}'}</span>
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="p-3 rounded-lg border border-dashed border-slate-300 dark:border-white/10 text-slate-400 text-xs">
                            Endpoint gốc độc lập, không có API phía sau phụ thuộc.
                          </div>
                        )}
                      </div>
                    ) : (
                      /* LEVEL >= 1: CONSUMER PIPELINE */
                      <div className="flex flex-wrap items-center gap-3">
                        {endpointFlow?.prerequisites && endpointFlow.prerequisites.length > 0 ? (
                          endpointFlow.prerequisites.map((edge, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="p-2.5 rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-xs">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-600 text-white mr-1.5">TIỀN ĐỀ</span>
                                <span className="font-mono font-bold text-emerald-800 dark:text-emerald-300">{edge.from}</span>
                                <span className="block text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">Sinh: {edge.source.replace(/^.*: /, '')}</span>
                              </div>
                              <div className="flex items-center text-slate-400 text-[10px] font-mono">
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                                  {edge.source.replace(/^.*: /, '')}
                                </span>
                                <ArrowRight className="w-3.5 h-3.5 mx-1 text-primary-500" />
                              </div>
                            </div>
                          ))
                        ) : null}

                        <div className="p-2.5 rounded-lg border-2 border-primary-500 bg-primary-50 dark:bg-primary-500/20 text-xs shadow-md">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary-600 text-white mr-1.5">HIỆN TẠI</span>
                          <span className="font-mono font-bold text-primary-900 dark:text-white">
                            {selectedEndpoint?.method} {selectedEndpoint?.path}
                          </span>
                          <span className="block text-[10px] text-primary-600 dark:text-primary-300 mt-0.5">
                            Level {endpointFlow?.levelIndex ?? 0} • {activeCases.length} kịch bản
                          </span>
                        </div>

                        {endpointFlow?.dependents && endpointFlow.dependents.length > 0 && (
                          endpointFlow.dependents.map((edge, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="flex items-center text-slate-400 text-[10px] font-mono">
                                <ArrowRight className="w-3.5 h-3.5 mx-1 text-primary-500" />
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                                  {edge.source.replace(/^.*: /, '')}
                                </span>
                              </div>
                              <div className="p-2.5 rounded-lg border bg-sky-50 dark:bg-sky-950/30 border-sky-300 dark:border-sky-800 text-xs">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-600 text-white mr-1.5">PHỤ THUỘC</span>
                                <span className="font-mono font-bold text-sky-800 dark:text-sky-300">{edge.to}</span>
                                <span className="block text-[10px] text-sky-600 dark:text-sky-400 mt-0.5">Nhận biến: {edge.source.replace(/^.*: /, '')}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* DATA FLOW BINDINGS TABLE */}
                  <div className="glass-panel overflow-hidden">
                    <div className="p-3 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-primary-600" />
                        {(endpointFlow?.levelIndex ?? 0) === 0
                          ? 'Bảng API phụ thuộc phía sau (Downstream Consumers — Danh sách các API nhận dữ liệu từ Endpoint này)'
                          : 'Bảng ánh xạ dữ liệu động từ API tiền đề (Data Flow Bindings — Upstream Prerequisites)'}
                      </span>
                      <span className="text-[10px] text-slate-500">Trích xuất tự động từ OpenAPI Schema</span>
                    </div>

                    {(endpointFlow?.levelIndex ?? 0) === 0 ? (
                      /* LEVEL 0 DOWNSTREAM TABLE */
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b bg-slate-50 dark:bg-dark-900/50 text-slate-500 uppercase text-[10px]">
                            <th className="py-2.5 px-3">API Phụ thuộc (Consumer Endpoint)</th>
                            <th className="py-2.5 px-3">Thuộc tính cung cấp</th>
                            <th className="py-2.5 px-3">Vị trí truyền vào (Target Parameter)</th>
                            <th className="py-2.5 px-3">Cơ chế truyền dữ liệu (Runtime Mechanism)</th>
                            <th className="py-2.5 px-3">Độ tin cậy</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                          {endpointFlow?.downstreamConsumers && endpointFlow.downstreamConsumers.length > 0 ? (
                            endpointFlow.downstreamConsumers.map((consumer, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                                <td className="py-2.5 px-3 font-mono font-bold text-slate-700 dark:text-slate-300">
                                  <span className="px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300 mr-2 text-[10px]">
                                    {consumer.targetMethod}
                                  </span>
                                  {consumer.targetPath}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                                  response.body.id
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold text-primary-600 dark:text-primary-400">
                                  {'{'}{consumer.consumedParam}{'}'} (Path/Query)
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300">
                                    ContextBinding (Redis / In-Memory RAM Fallback)
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                                    {consumer.confidence ?? 'HIGH'}
                                  </span>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="p-4 text-center text-slate-400 text-xs">
                                Endpoint gốc (Level 0) độc lập, không có API nào trong đặc tả phụ thuộc vào nó.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    ) : (
                      /* LEVEL >= 1 UPSTREAM TABLE */
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b bg-slate-50 dark:bg-dark-900/50 text-slate-500 uppercase text-[10px]">
                            <th className="py-2.5 px-3">Tham số / Thuộc tính đích</th>
                            <th className="py-2.5 px-3">API Tiền đề (Producer)</th>
                            <th className="py-2.5 px-3">Trường trích xuất nguồn</th>
                            <th className="py-2.5 px-3">Cơ chế gán (Runtime Binding)</th>
                            <th className="py-2.5 px-3">Độ tin cậy</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                          {endpointFlow?.prerequisites && endpointFlow.prerequisites.length > 0 ? (
                            endpointFlow.prerequisites.map((edge, idx) => {
                              const paramName = edge.source.replace(/^.*: /, '');
                              return (
                                <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                                  <td className="py-2.5 px-3 font-mono font-bold text-primary-600 dark:text-primary-400">
                                    {'{'}{paramName}{'}'}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 font-bold">
                                      {edge.from}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-emerald-600 dark:text-emerald-400">
                                    response.body.id
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300">
                                      ContextBinding (Redis Key at Runtime)
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                                      {edge.confidence ?? 'HIGH'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={5} className="p-4 text-center text-slate-400 text-xs">
                                Endpoint này là điểm bắt đầu (Root API), không yêu cầu trường dữ liệu phụ thuộc từ API khác.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* JSON CONTEXT BINDING INSPECTOR */}
                  <div className="p-3.5 rounded-xl bg-slate-900 text-slate-200 border border-slate-700 text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-sky-400 flex items-center gap-1.5 font-mono">
                        <GitMerge className="w-3.5 h-3.5 text-sky-400" />
                        {contextBindings.length > 0
                          ? 'Minh chứng cấu hình ContextBinding lưu trong TestCase:'
                          : 'Đặc tả xuất biến ngữ cảnh sang bộ nhớ đệm DAG (Runtime Context Export):'}
                      </span>
                      <span className="text-[10px] text-slate-400">Phục vụ tự động trích xuất lúc chạy Test Run</span>
                    </div>
                    <pre className="p-3 bg-slate-950 rounded-lg overflow-x-auto font-mono text-[11px] text-emerald-400 leading-relaxed border border-slate-800">
                      {JSON.stringify(
                        contextBindings.length > 0
                          ? contextBindings
                          : {
                              producerEndpoint: `${selectedEndpoint?.method} ${selectedEndpoint?.path}`,
                              executionLevel: endpointFlow?.levelIndex ?? 0,
                              role: 'UPSTREAM_PRODUCER',
                              exportedContextKeys: ['response.body.id', 'response.body.userId', 'response.body.token'],
                              storageKeyPattern: `run:{testRunId}:execution:${selectedEndpoint?.method} ${selectedEndpoint?.path}:context`,
                              downstreamConsumersCount: endpointFlow?.downstreamConsumers?.length ?? 0,
                              downstreamConsumers: (endpointFlow?.downstreamConsumers ?? []).map((c) => ({
                                consumer: `${c.targetMethod} ${c.targetPath}`,
                                injectedParameter: c.consumedParam,
                                mechanism: 'ContextBinding (Redis / RAM Fallback)',
                              })),
                            },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </div>
  );
}
