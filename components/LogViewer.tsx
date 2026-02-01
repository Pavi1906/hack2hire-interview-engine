import React, { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

interface LogViewerProps {
  logs: string[];
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs }) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 h-full flex flex-col font-mono text-xs">
      <div className="flex items-center gap-2 text-slate-400 mb-2 border-b border-slate-700 pb-2">
        <Terminal size={14} />
        <span className="font-semibold uppercase tracking-wider">System Engine Logs</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin space-y-1 pr-2">
        {logs.length === 0 && <span className="text-slate-600 italic">No logs yet...</span>}
        {logs.map((log, i) => (
          <div key={i} className="text-slate-300 break-words">
            <span className="text-blue-500 mr-2">{log.substring(0, log.indexOf(']') + 1)}</span>
            <span className={log.includes('TERMINATION') || log.includes('WARNING') ? 'text-red-400' : 'text-slate-300'}>
              {log.substring(log.indexOf(']') + 1)}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};