// components/polla/PollaCard.tsx — Tarjeta de resumen de una polla para mostrar en listas
interface PollaCardProps {
  polla: {
    id: string;
    name: string;
    slug: string;
    description?: string;
    participants?: string[];
    entry_fee?: number;
  };
}

export default function PollaCard({ polla }: PollaCardProps) {
  return (
    <a
      href={`/pollas/${polla.slug}`}
      className="block bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow border-l-4 border-colombia-yellow"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-colombia-blue">{polla.name}</h3>
          {polla.description && (
            <p className="text-gray-500 text-sm mt-1 line-clamp-1">
              {polla.description}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-colombia-blue">
            {polla.participants?.length || 0} 👥
          </p>
          {polla.entry_fee ? (
            <p className="text-xs text-gray-500">
              ${polla.entry_fee.toLocaleString()} COP
            </p>
          ) : (
            <p className="text-xs text-green-600">Gratis</p>
          )}
        </div>
      </div>
    </a>
  );
}
