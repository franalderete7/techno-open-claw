'use client';

import { useEffect, useState } from 'react';

interface Conversation {
  id: number;
  customer_id: number | null;
  channel: string;
  channel_thread_key: string;
  status: string;
  title: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  customer?: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  };
  last_message?: {
    text_body: string | null;
    direction: string;
    created_at: string;
  };
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/conversations?limit=50')
      .then(res => res.json())
      .then(data => {
        setConversations(data.items || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load conversations:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-8 text-center">Cargando conversaciones...</div>;
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Conversaciones ({conversations.length})</h2>
      
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Channel</th>
              <th className="px-4 py-2 text-left">Cliente</th>
              <th className="px-4 py-2 text-left">Último mensaje</th>
              <th className="px-4 py-2 text-left">Estado</th>
              <th className="px-4 py-2 text-left">Creada</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {conversations.map(conv => (
              <tr key={conv.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono">#{conv.id}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    conv.channel === 'telegram' ? 'bg-blue-100 text-blue-800' :
                    conv.channel === 'whatsapp' ? 'bg-green-100 text-green-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {conv.channel}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {conv.customer?.first_name || conv.customer?.last_name ? (
                      `${conv.customer.first_name || ''} ${conv.customer.last_name || ''}`.trim()
                    ) : (
                      <span className="text-gray-400">Anónimo</span>
                    )}
                  </div>
                  <div className="text-gray-500 text-xs">{conv.customer?.phone || '-'}</div>
                </td>
                <td className="px-4 py-3 max-w-md">
                  {conv.last_message?.text_body ? (
                    <div className="truncate text-gray-600">
                      <span className={`text-xs ${
                        conv.last_message.direction === 'inbound' ? 'text-blue-600' : 'text-green-600'
                      }`}>
                        {conv.last_message.direction === 'inbound' ? '←' : '→'}
                      </span>
                      {' '}{conv.last_message.text_body}
                    </div>
                  ) : (
                    <span className="text-gray-400">Sin mensajes</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    conv.status === 'open' ? 'bg-green-100 text-green-800' :
                    conv.status === 'closed' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {conv.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {new Date(conv.created_at).toLocaleDateString('es-AR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
