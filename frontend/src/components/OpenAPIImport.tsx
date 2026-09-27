import { DragEvent, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useMutation } from '@tanstack/react-query';
import { UploadCloud, FileJson, CheckCircle2, X, Sparkles, AlertCircle, FileText } from 'lucide-react';
import { openapiApi, type ImportSpecResult } from '../api/openapi.api';

interface OpenAPIImportProps {
  projectId: string;
  projectName: string;
  onSuccess: (result: ImportSpecResult) => void;
  onClose: () => void;
}
type TabMode = 'RAW' | 'FILE';
type ImportPhase = 'idle' | 'uploading' | 'parsing' | 'importing' | 'success' | 'validation-error' | 'network-error';
interface ImportErrorResponse { error?: { code?: string; message?: string }; }
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function OpenAPIImport({ projectId, projectName, onSuccess, onClose }: OpenAPIImportProps) {
  const [activeTab, setActiveTab] = useState<TabMode>('FILE');
  const [rawContent, setRawContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [importResult, setImportResult] = useState<ImportSpecResult | null>(null);
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (stageTimer.current) clearTimeout(stageTimer.current); }, []);

  const beginImportingStage = () => {
    if (stageTimer.current) clearTimeout(stageTimer.current);
    stageTimer.current = setTimeout(() => setPhase('importing'), 700);
  };

  const mutation = useMutation({
    mutationFn: async (): Promise<ImportSpecResult> => {
      if (activeTab === 'FILE') {
        if (!file) throw new Error('Select a .json, .yaml, or .yml file.');
        if (!isSupportedFile(file)) throw new Error('Choose a JSON or YAML file (.json, .yaml, or .yml).');
        if (file.size > MAX_FILE_SIZE) throw new Error('The file is larger than the 5 MB upload limit.');
        return openapiApi.importFile(projectId, file, (value) => {
          setProgress(Math.min(100, Math.round(value * 100)));
          if (value >= 0.99) { setPhase('parsing'); beginImportingStage(); }
        });
      }
      if (!rawContent.trim()) throw new Error('Paste an OpenAPI document first.');
      const firstCharacter = rawContent.trimStart().charAt(0);
      const isJson = firstCharacter === '{' || firstCharacter === '[';
      return openapiApi.importRaw(projectId, rawContent, isJson ? 'json' : 'yaml');
    },
    onSuccess: (result) => {
      if (stageTimer.current) clearTimeout(stageTimer.current);
      setProgress(100);
      setImportResult(result);
      setPhase('success');
      onSuccess(result);
    },
    onError: (error) => {
      if (stageTimer.current) clearTimeout(stageTimer.current);
      const translated = translateImportError(error);
      setErrorMessage(translated.message);
      setPhase(translated.network ? 'network-error' : 'validation-error');
    },
  });

  const handleImport = () => {
    setErrorMessage('');
    setProgress(0);
    setImportResult(null);
    setPhase(activeTab === 'FILE' ? 'uploading' : 'parsing');
    if (activeTab === 'RAW') beginImportingStage();
    mutation.mutate();
  };

  const chooseFile = (candidate: File | undefined) => {
    if (!candidate) return;
    setErrorMessage('');
    setPhase('idle');
    setFile(candidate);
    if (!isSupportedFile(candidate)) {
      setPhase('validation-error');
      setErrorMessage('Invalid file. Choose a .json, .yaml, or .yml OpenAPI file.');
    } else if (candidate.size > MAX_FILE_SIZE) {
      setPhase('validation-error');
      setErrorMessage('Invalid file. The maximum upload size is 5 MB.');
    }
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files.item(0) ?? undefined);
  };

  const busy = mutation.isPending;
  const phaseLabel: Record<ImportPhase, string> = {
    idle: 'Ready to import', uploading: `Uploading file… ${progress}%`, parsing: 'Parsing and validating OpenAPI document…',
    importing: 'Saving specification and endpoints…', success: 'Import complete', 'validation-error': 'Import needs attention', 'network-error': 'Connection failed',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white dark:bg-dark-900 border border-slate-200 dark:border-white/[0.1] rounded-2xl shadow-2xl relative overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between bg-slate-50/70 dark:bg-dark-900/80"><div className="flex items-center gap-3"><div className="p-2.5 rounded-xl bg-primary-100 dark:bg-primary-500/20 text-primary-600"><UploadCloud className="w-5 h-5" /></div><div><h2 className="text-base font-bold">Nạp tài liệu API (OpenAPI)</h2><p className="text-xs text-slate-500">Import into {projectName}</p></div></div><button onClick={onClose} disabled={busy} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 disabled:opacity-40" title="Close"><X className="w-5 h-5" /></button></div>
        <div className="p-6 space-y-5">
          {!importResult && <>
            <div className="flex space-x-1 p-1 bg-slate-100 dark:bg-dark-950 border border-slate-200 dark:border-white/[0.08] rounded-xl text-xs font-semibold">{([{ id: 'FILE', label: 'Upload file', icon: UploadCloud }, { id: 'RAW', label: 'Paste JSON / YAML', icon: FileJson }] as const).map((tab) => { const Icon = tab.icon; return <button key={tab.id} disabled={busy} onClick={() => { setActiveTab(tab.id); setErrorMessage(''); setPhase('idle'); }} className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50 ${activeTab === tab.id ? 'bg-white dark:bg-primary-600 text-primary-700 dark:text-white shadow-sm font-bold' : 'text-slate-600 dark:text-slate-400'}`}><Icon className="w-3.5 h-3.5" />{tab.label}</button>; })}</div>
            {activeTab === 'FILE' ? <label onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={onDrop} className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-slate-500 cursor-pointer transition-colors ${dragging ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10' : 'border-slate-300 dark:border-white/[0.15] hover:border-primary-500 bg-slate-50/50 dark:bg-dark-950/40'} ${busy ? 'pointer-events-none opacity-60' : ''}`}><FileText className="w-9 h-9 mb-2 text-primary-600" /><span className="text-xs font-bold">{file?.name ?? 'Drag and drop an OpenAPI file here'}</span><span className="text-[11px] text-slate-400 mt-1">or click to choose • JSON, YAML, YML • 5 MB maximum</span><input type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" disabled={busy} className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} /></label> : <div className="space-y-2"><label className="text-xs font-semibold block">Paste JSON or YAML content</label><textarea disabled={busy} value={rawContent} onChange={(event) => setRawContent(event.target.value)} placeholder={'openapi: 3.0.3\ninfo:\n  title: My API\n  version: 1.0.0\npaths: {}'} className="input-premium h-48 font-mono text-xs resize-y disabled:opacity-60" /></div>}
            {(phase === 'uploading' || phase === 'parsing' || phase === 'importing') && <div aria-live="polite" className="space-y-2"><p className="text-xs text-primary-700 dark:text-primary-300">{phaseLabel[phase]}</p>{phase === 'uploading' && <div className="h-1.5 rounded bg-slate-200 dark:bg-dark-950 overflow-hidden"><div className="h-full bg-primary-500 transition-all" style={{ width: `${progress}%` }} /></div>}<div className="flex gap-3 text-[10px] text-slate-400"><span className={phase === 'uploading' ? 'text-primary-600 font-bold' : ''}>Upload</span><span className={phase === 'parsing' ? 'text-primary-600 font-bold' : ''}>Parse & validate</span><span className={phase === 'importing' ? 'text-primary-600 font-bold' : ''}>Persist</span></div></div>}
            {(phase === 'validation-error' || phase === 'network-error') && <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2"><AlertCircle className="w-4 h-4" />{errorMessage}</div>}
          </>}
          {importResult && <div role="status" className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 space-y-3"><div className="flex items-center gap-2 text-sm font-bold"><CheckCircle2 className="w-5 h-5" />OpenAPI import succeeded</div><dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs"><div><dt className="opacity-70">Project</dt><dd className="font-semibold">{projectName}</dd></div><div><dt className="opacity-70">OpenAPI version</dt><dd className="font-semibold">{importResult.version}</dd></div><div><dt className="opacity-70">Imported endpoints</dt><dd className="font-semibold">{importResult.endpointCount}</dd></div><div><dt className="opacity-70">Spec ID</dt><dd className="font-mono break-all">{importResult.specId}</dd></div></dl><p className="text-xs">The project endpoint catalog has been refreshed.</p></div>}
        </div>
        <div className="p-4 px-6 border-t border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-dark-850 flex items-center justify-between"><button onClick={onClose} disabled={busy} className="btn-secondary py-2 px-4 text-xs font-semibold disabled:opacity-50">{importResult ? 'Done' : 'Cancel'}</button>{!importResult && <button onClick={handleImport} disabled={busy || (activeTab === 'FILE' && (!file || !isSupportedFile(file) || file.size > MAX_FILE_SIZE)) || (activeTab === 'RAW' && !rawContent.trim())} className="btn-primary py-2 px-5 text-xs font-bold flex items-center gap-2 disabled:opacity-50"><Sparkles className="w-4 h-4" />{busy ? phaseLabel[phase] : 'Import specification'}</button>}</div>
      </div>
    </div>
  );
}

function isSupportedFile(file: File): boolean {
  return /[.](json|yaml|yml)$/i.test(file.name);
}

function translateImportError(error: unknown): { message: string; network: boolean } {
  if (!axios.isAxiosError<ImportErrorResponse>(error)) {
    return { message: error instanceof Error ? error.message : 'The import could not be completed.', network: false };
  }
  if (!error.response) return { message: 'Could not reach the server. Check your connection and try again.', network: true };
  const code = error.response.data?.error?.code;
  if (error.response.status === 401 || code === 'UNAUTHENTICATED') return { message: 'Your session has expired. Sign in again to import this specification.', network: false };
  if (code === 'UNSUPPORTED_FILE_TYPE' || code === 'FILE_REQUIRED' || code === 'INVALID_MULTIPART' || code === 'FILE_TOO_LARGE') return { message: 'Invalid file. Choose a .json, .yaml, or .yml file smaller than 5 MB.', network: false };
  if (code === 'INVALID_YAML') return { message: 'Malformed YAML. Check indentation and YAML syntax, then try again.', network: false };
  if (code === 'UNSUPPORTED_OPENAPI_VERSION') return { message: 'Unsupported OpenAPI version. This project accepts OpenAPI 3.0.x and 3.1.x.', network: false };
  if (code === 'INVALID_JSON') return { message: 'Invalid JSON. Check the document syntax and try again.', network: false };
  if (code === 'INVALID_OPENAPI_DOCUMENT') return { message: 'Invalid OpenAPI document. Check its version, info, paths, and references.', network: false };
  if (error.response.status >= 500) return { message: 'The server could not import this specification. Try again later.', network: false };
  return { message: error.response.data?.error?.message ?? 'The specification could not be imported. Check the document and try again.', network: false };
}
