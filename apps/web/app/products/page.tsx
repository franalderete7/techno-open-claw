'use client';

import { useEffect, useState } from 'react';

interface Product {
  id: number;
  sku: string;
  slug: string;
  brand: string;
  model: string;
  title: string;
  description: string | null;
  condition: string;
  price_amount: number | null;
  currency_code: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  image_url: string | null;
  ram_gb: number | null;
  storage_gb: number | null;
  network: string | null;
  color: string | null;
  battery_health: number | null;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/products?limit=100')
      .then(res => res.json())
      .then(data => {
        setProducts(data.items || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load products:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-8 text-center">Cargando productos...</div>;
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Productos ({products.length})</h2>
      
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">IMG</th>
              <th className="px-3 py-2 text-left">SKU</th>
              <th className="px-3 py-2 text-left">Producto</th>
              <th className="px-3 py-2 text-left">RAM</th>
              <th className="px-3 py-2 text-left">Storage</th>
              <th className="px-3 py-2 text-left">Network</th>
              <th className="px-3 py-2 text-left">Color</th>
              <th className="px-3 py-2 text-left">Battery</th>
              <th className="px-3 py-2 text-left">Cond</th>
              <th className="px-3 py-2 text-left">Precio</th>
              <th className="px-3 py-2 text-left">Estado</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {products.map(product => (
              <tr key={product.id} className="hover:bg-gray-50">
                <td className="px-3 py-3">
                  {product.image_url ? (
                    <img src={product.image_url} alt="" className="w-8 h-8 rounded object-cover" />
                  ) : (
                    <span className="text-gray-400">📱</span>
                  )}
                </td>
                <td className="px-3 py-3 font-mono">{product.sku}</td>
                <td className="px-3 py-3">
                  <div className="font-medium">{product.brand} {product.model}</div>
                  <div className="text-gray-500 text-xs">{product.title}</div>
                </td>
                <td className="px-3 py-3">{product.ram_gb || '-'}</td>
                <td className="px-3 py-3">{product.storage_gb || '-'}</td>
                <td className="px-3 py-3">{product.network || '-'}</td>
                <td className="px-3 py-3">{product.color || '-'}</td>
                <td className="px-3 py-3">{product.battery_health ? `${product.battery_health}%` : '-'}</td>
                <td className="px-3 py-3">
                  <span className={`px-2 py-1 rounded text-xs ${
                    product.condition === 'new' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {product.condition}
                  </span>
                </td>
                <td className="px-3 py-3 font-medium">
                  ${product.price_amount?.toLocaleString('es-AR') || '-'}
                </td>
                <td className="px-3 py-3">
                  {product.active ? (
                    <span className="text-green-600">● Activo</span>
                  ) : (
                    <span className="text-gray-400">○ Inactivo</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
