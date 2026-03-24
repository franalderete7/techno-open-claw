'use client';

import { useEffect, useState } from 'react';

interface Setting {
  key: string;
  value: any;
  updated_at: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        setSettings(data.items || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load settings:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-8 text-center">Cargando configuración...</div>;
  }

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold mb-4">Configuración</h2>
      
      <div className="grid gap-6 md:grid-cols-2">
        {settings.map(setting => (
          <div key={setting.key} className="bg-white rounded shadow p-6">
            <h3 className="font-semibold text-lg mb-2">{setting.key}</h3>
            <div className="bg-gray-50 rounded p-4 font-mono text-xs overflow-auto max-h-64">
              <pre>{JSON.stringify(setting.value, null, 2)}</pre>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Actualizado: {new Date(setting.updated_at).toLocaleString('es-AR')}
            </div>
          </div>
        ))}
        
        {settings.length === 0 && (
          <div className="col-span-2 text-center text-gray-500 py-12">
            No hay configuración guardada
          </div>
        )}
      </div>
    </div>
  );
}
