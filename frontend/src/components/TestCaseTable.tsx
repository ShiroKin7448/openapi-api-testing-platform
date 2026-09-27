import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Archive, XCircle } from 'lucide-react';
import { testcasesApi, type TestCaseDto } from '../api/testcases.api';
import { queryKeys } from '../api/queryClient';

interface TestCaseTableProps {
  projectId: string;
  cases: TestCaseDto[];
}

export default function TestCaseTable({ projectId, cases }: TestCaseTableProps) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const bulkStatus = useMutation({
    mutationFn: (status: string) => testcasesApi.bulkStatus(Array.from(selectedIds), status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectCases(projectId) });
      setSelectedIds(new Set());
    },
  });

  const handleSelectAll = () => {
    if (selectedIds.size === filteredCases.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredCases.map(c => c.id)));
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulkAction = (action: string) => {
    if (selectedIds.size === 0) return;
    if (action === 'ARCHIVED' || action === 'DISABLED') {
      if (!window.confirm(`Are you sure you want to ${action.toLowerCase()} ${selectedIds.size} test cases?`)) return;
    }
    bulkStatus.mutate(action);
  };

  const filteredCases = cases.filter(c => {
    if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
    if (typeFilter !== 'ALL' && c.type !== typeFilter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
        <div className="flex items-center gap-3">
          <input type="text" placeholder="Search test cases..." value={search} onChange={e => setSearch(e.target.value)} className="input-text text-sm w-64" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-text text-sm">
            <option value="ALL">All Status</option>
            <option value="DRAFT">Draft</option>
            <option value="READY">Ready</option>
            <option value="DISABLED">Disabled</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input-text text-sm">
            <option value="ALL">All Types</option>
            <option value="VALID">Valid</option>
            <option value="BOUNDARY">Boundary</option>
            <option value="NEGATIVE">Negative</option>
          </select>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 mr-2">{selectedIds.size} selected</span>
          <button onClick={() => handleBulkAction('READY')} disabled={selectedIds.size === 0 || bulkStatus.isPending} className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Ready</button>
          <button onClick={() => handleBulkAction('DISABLED')} disabled={selectedIds.size === 0 || bulkStatus.isPending} className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Disable</button>
          <button onClick={() => handleBulkAction('ARCHIVED')} disabled={selectedIds.size === 0 || bulkStatus.isPending} className="btn-danger py-1.5 px-3 text-xs flex items-center gap-1"><Archive className="w-3.5 h-3.5" /> Archive</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-xs uppercase sticky top-0">
            <tr>
              <th className="py-3 px-4 font-medium border-b border-slate-200 dark:border-slate-800 w-12"><input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === filteredCases.length} onChange={handleSelectAll} className="rounded border-slate-300 text-primary-600 focus:ring-primary-600" /></th>
              <th className="py-3 px-4 font-medium border-b border-slate-200 dark:border-slate-800">Name</th>
              <th className="py-3 px-4 font-medium border-b border-slate-200 dark:border-slate-800 w-32">Type</th>
              <th className="py-3 px-4 font-medium border-b border-slate-200 dark:border-slate-800 w-32">Status</th>
              <th className="py-3 px-4 font-medium border-b border-slate-200 dark:border-slate-800 w-32">Modified</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredCases.map(testCase => (
              <tr key={testCase.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${selectedIds.has(testCase.id) ? 'bg-primary-50 dark:bg-primary-900/10' : ''}`}>
                <td className="py-3 px-4"><input type="checkbox" checked={selectedIds.has(testCase.id)} onChange={() => toggleSelect(testCase.id)} className="rounded border-slate-300 text-primary-600 focus:ring-primary-600" /></td>
                <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">{testCase.name}</td>
                <td className="py-3 px-4">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${testCase.type === 'VALID' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' : testCase.type === 'NEGATIVE' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'}`}>
                    {testCase.type}
                  </span>
                </td>
                <td className="py-3 px-4 text-xs font-semibold text-slate-600 dark:text-slate-400">{testCase.status || 'READY'}</td>
                <td className="py-3 px-4 text-xs text-slate-500">{new Date(testCase.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {filteredCases.length === 0 && (
              <tr>
                <td colSpan={5} className="py-12 text-center text-slate-500">No test cases found matching filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
