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
  condition: 'new' | 'used' | 'like_new' | 'refurbished';
  price_amount: number | null;
  currency_code: string;
  active: boolean;
}

export default function Storefront() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/products?active=true&limit=50')
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
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800">TechnoStore</h1>
          <p className="text-gray-600 mt-2">Cargando productos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">
            TechnoStore Salta 📱
          </h1>
          <p className="text-gray-600 mt-2">
            iPhones, Samsung, Xiaomi y más
          </p>
        </div>
      </header>

      {/* Products Grid */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {products.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600">No hay productos disponibles</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <p className="text-gray-600 text-center">
            📍 Caseros 1365, Salta Capital | 📱 WhatsApp: +54 9 387 XXX XXXX
          </p>
        </div>
      </footer>
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const formatPrice = (amount: number | null, currency: string) => {
    if (!amount) return 'Consultar';
    return `$${amount.toLocaleString('es-AR')} ${currency}`;
  };

  const conditionLabels = {
    new: 'Nuevo',
    used: 'Seminuevo',
    like_new: 'Como Nuevo',
    refurbished: 'Reacondicionado',
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      <div className="aspect-square bg-gray-200 flex items-center justify-center">
        <span className="text-gray-400 text-4xl">📱</span>
      </div>
      
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">
              {product.brand} {product.model}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {product.title}
            </p>
          </div>
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            product.condition === 'new' 
              ? 'bg-green-100 text-green-800'
              : 'bg-blue-100 text-blue-800'
          }`}>
            {conditionLabels[product.condition]}
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-lg font-bold text-gray-900">
            {formatPrice(product.price_amount, product.currency_code)}
          </span>
          <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors">
            Ver detalles
          </button>
        </div>
      </div>
    </div>
  );
}
