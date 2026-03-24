'use client';

import { useEffect, useState } from 'react';

interface StockUnit {
  id: number;
  serial_number: string | null;
  color: string | null;
  battery_health: number | null;
  status: string;
  product_id: number;
  product: {
    sku: string;
    brand: string;
    model: string;
    title: string;
  } | null;
}

export default function StockPage() {
  const [stock, setStock] = useState<StockUnit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stock?limit=100')
      .then(res => res.json())
      .then(data => {
        setStock(data.items || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load stock:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-8 text-center">Cargando stock...</div>;
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Stock ({stock.length} unidades)</h2>
      
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Producto</th>
              <th className="px-4 py-2 text-left">Serial</th>
              <th className="px-4 py-2 text-left">Color</th>
              <th className="px-4 py-2 text-left">Batería</th>
              <th className="px-4 py-2 text-left">Estado</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {stock.map(unit => (
              <tr key={unit.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono">#{unit.id}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{unit.product?.sku}</div>
                  <div className="text-gray-500 text-xs">{unit.product?.title}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{unit.serial_number || '-'}</td>
                <td className="px-4 py-3">{unit.color || '-'}</td>
                <td className="px-4 py-3">
                  {unit.battery_health ? (
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            unit.battery_health > 80 ? 'bg-green-500' :
                            unit.battery_health > 60 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${unit.battery_health}%` }}
                        />
                      </div>
                      <span>{unit.battery_health}%</span>
                    </div>
                  ) : '-'}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    unit.status === 'in_stock' ? 'bg-green-100 text-green-800' :
                    unit.status === 'reserved' ? 'bg-yellow-100 text-yellow-800' :
                    unit.status === 'sold' ? 'bg-gray-100 text-gray-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {unit.status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
