// app/(app)/pollas/crear/page.tsx — Página para crear una nueva polla
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

export default function CrearPollaPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    description: "",
    leagueId: 239,
    entryFee: 0,
    isPrivate: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await axios.post("/api/pollas", form);
      router.push(`/pollas/${data.polla.slug}`);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || "Error al crear la polla");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-colombia-blue text-white p-4 shadow-lg">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.back()} className="text-colombia-yellow">
            ←
          </button>
          <h1 className="text-xl font-bold">Crear nueva polla</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4">
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre de la polla
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej: Polla Liga BetPlay 2024"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-colombia-yellow focus:border-transparent outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Descripción (opcional)
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Descripción de la polla..."
              rows={3}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-colombia-yellow focus:border-transparent outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Liga
            </label>
            <select
              value={form.leagueId}
              onChange={(e) => setForm({ ...form, leagueId: parseInt(e.target.value) })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-colombia-yellow focus:border-transparent outline-none bg-white"
            >
              <option value={239}>Liga BetPlay (Colombia)</option>
              <option value={2}>Champions League</option>
              <option value={140}>La Liga (España)</option>
              <option value={39}>Premier League</option>
              <option value={135}>Serie A (Italia)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Valor de entrada (COP)
            </label>
            <input
              type="number"
              min={0}
              value={form.entryFee}
              onChange={(e) => setForm({ ...form, entryFee: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-colombia-yellow focus:border-transparent outline-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isPrivate"
              checked={form.isPrivate}
              onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })}
              className="w-5 h-5 text-colombia-blue rounded"
            />
            <label htmlFor="isPrivate" className="text-sm text-gray-700">
              Polla privada (solo por invitación)
            </label>
          </div>

          {error && (
            <p className="text-colombia-red text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-colombia-yellow text-colombia-blue font-bold py-3 px-4 rounded-xl hover:bg-yellow-400 transition-colors disabled:opacity-50 text-lg"
          >
            {loading ? "Creando..." : "Crear polla 🏆"}
          </button>
        </form>
      </main>
    </div>
  );
}
