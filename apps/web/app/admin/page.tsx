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

interface StockUnit {
  id: number;
  serial_number: string | null;
  color: string | null;
  battery_health: number | null;
  status: 'in_stock' | 'reserved' | 'sold' | 'damaged';
  product_id: number;
  product: Product;
}

export default function AdminPanel() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<StockUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'products' | 'stock'>('products');

  useEffect(() => {
    Promise.all([
      fetch('/api/products?limit=100').then(r => r.json()),
      fetch('/api/stock?limit=100').then(r => r.json()),
    ])
    .then(([productsData, stockData]) => {
      setProducts(productsData.items || []);
      setStock(stockData.items || []);
      setLoading(false);
    })
    .catch(err => {
      console.error('Failed to load data:', err);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Cargando admin panel...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">
              TechnoStore Admin 🔧
            </h1>
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab('products')}
                className={`px-4 py-2 rounded ${
                  activeTab === 'products'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-800'
                }`}
              >
                Productos ({products.length})
              </button>
              <button
                onClick={() => setActiveTab('stock')}
                className={`px-4 py-2 rounded ${
                  activeTab === 'stock'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-800'
                }`}
              >
                Stock ({stock.length})
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'products' ? (
          <ProductsTable products={products} />
        ) : (
          <StockTable stock={stock} />
        )}
      </main>
    </div>
  );
}

function ProductsTable({ products }: { products: Product[] }) {
  return (
    <div className="bg-white rounded shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IMG</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">RAM</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Storage</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cond</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Precio</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {products.map(product => (
            <tr key={product.id} className="hover:bg-gray-50">
              <td className="px-4 py-4">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.title} className="w-10 h-10 rounded object-cover" />
                ) : (
                  <span className="text-gray-400 text-xl">📱</span>
                )}
              </td>
              <td className="px-4 py-4 text-xs font-mono text-gray-600">{product.sku}</td>
              <td className="px-4 py-4">
                <div className="font-medium text-gray-900">{product.brand} {product.model}</div>
                <div className="text-gray-500 text-xs">{product.title}</div>
              </td>
              <td className="px-4 py-4 text-gray-600">{product.ram_gb || '-'}</td>
              <td className="px-4 py-4 text-gray-600">{product.storage_gb || '-'}</td>
              <td className="px-4 py-4">
                <span className={`px-2 py-1 rounded text-xs ${
                  product.condition === 'new' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                }`}>
                  {product.condition}
                </span>
              </td>
              <td className="px-4 py-4 font-medium">
                ${product.price_amount?.toLocaleString('es-AR') || '-'}
              </td>
              <td className="px-4 py-4">
                {product.active ? (
                  <span className="text-green-600">● Activo</span>
                ) : (
                  <span className="text-gray-400">○ Inactivo</span>
                )}
              </td>
              <td className="px-4 py-4 text-xs text-gray-500">
                {new Date(product.created_at).toLocaleDateString('es-AR')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockTable({ stock }: { stock: StockUnit[] }) {
  const statusColors = {
    in_stock: 'bg-green-100 text-green-800',
    reserved: 'bg-yellow-100 text-yellow-800',
    sold: 'bg-gray-100 text-gray-800',
    damaged: 'bg-red-100 text-red-800',
  };

  return (
    <div className="bg-white rounded shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Serial</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Color</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batería</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {stock.map(unit => (
            <tr key={unit.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 text-sm font-mono text-gray-600">#{unit.id}</td>
              <td className="px-6 py-4 text-sm">
                <div className="font-medium text-gray-900">
                  {unit.product?.brand} {unit.product?.model}
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-gray-600">
                {unit.serial_number || '-'}
              </td>
              <td className="px-6 py-4 text-sm text-gray-600">
                {unit.color || '-'}
              </td>
              <td className="px-6 py-4 text-sm">
                {unit.battery_health ? (
                  <div className="flex items-center gap-2">
                    <div className="w-20 bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${
                          unit.battery_health > 80 ? 'bg-green-500' :
                          unit.battery_health > 60 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${unit.battery_health}%` }}
                      />
                    </div>
                    <span className="text-gray-600">{unit.battery_health}%</span>
                  </div>
                ) : '-'}
              </td>
              <td className="px-6 py-4 text-sm">
                <span className={`px-2 py-1 rounded text-xs ${statusColors[unit.status]}`}>
                  {unit.status.replace('_', ' ')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
