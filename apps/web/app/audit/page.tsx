'use client';

import { useEffect, useState } from 'react';

interface AuditLog {
  id: number;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: any;
  created_at: string;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/audit?limit=100')
      .then(res => res.json())
      .then(data => {
        setLogs(data.items || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load audit logs:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-8 text-center">Cargando audit logs...</div>;
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Audit Logs ({logs.length})</h2>
      
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">Actor</th>
              <th className="px-3 py-2 text-left">Acción</th>
              <th className="px-3 py-2 text-left">Entidad</th>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">Metadata</th>
              <th className="px-3 py-2 text-left">Timestamp</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {logs.map(log => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-3 py-3 font-mono">#{log.id}</td>
                <td className="px-3 py-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    log.actor_type === 'admin' ? 'bg-purple-100 text-purple-800' :
                    log.actor_type === 'tool' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {log.actor_type}
                  </span>
                </td>
                <td className="px-3 py-3 font-mono">{log.action}</td>
                <td className="px-3 py-3">{log.entity_type}</td>
                <td className="px-3 py-3 font-mono">{log.entity_id}</td>
                <td className="px-3 py-3 max-w-xs truncate font-mono text-gray-500">
                  {log.metadata ? JSON.stringify(log.metadata).slice(0, 50) : '-'}
                </td>
                <td className="px-3 py-3 text-gray-500">
                  {new Date(log.created_at).toLocaleString('es-AR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
