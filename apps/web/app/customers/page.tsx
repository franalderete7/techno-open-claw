'use client';

import { useEffect, useState } from 'react';

interface Customer {
  id: number;
  external_ref: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/customers?limit=50')
      .then(res => res.json())
      .then(data => {
        setCustomers(data.items || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load customers:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-8 text-center">Cargando clientes...</div>;
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Clientes ({customers.length})</h2>
      
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Nombre</th>
              <th className="px-4 py-2 text-left">Teléfono</th>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Source</th>
              <th className="px-4 py-2 text-left">Notes</th>
              <th className="px-4 py-2 text-left">Creado</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {customers.map(customer => (
              <tr key={customer.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono">#{customer.id}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {customer.first_name || customer.last_name ? (
                      `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
                    ) : (
                      <span className="text-gray-400">Anónimo</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">{customer.phone || '-'}</td>
                <td className="px-4 py-3">{customer.email || '-'}</td>
                <td className="px-4 py-3 text-xs font-mono">
                  {customer.external_ref?.split(':')[0] || '-'}
                </td>
                <td className="px-4 py-3 max-w-xs truncate text-xs text-gray-500">
                  {customer.notes || '-'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {new Date(customer.created_at).toLocaleDateString('es-AR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
