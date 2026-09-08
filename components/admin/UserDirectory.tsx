"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, Users } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { fadeUp, staggerContainer } from "@/lib/animations";
import { formatPhone } from "@/lib/format-phone";

interface DirectoryUser {
  id: string;
  display_name: string;
  whatsapp_number: string | null;
  is_admin: boolean;
}

interface UserDirectoryProps {
  admins: { id: string }[] | null;
  savingId: string | null;
  onPromote: (user: DirectoryUser) => void;
}

export default function UserDirectory({ admins, savingId, onPromote }: UserDirectoryProps) {
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ directory: "1", page: String(page) });
        const response = await fetch(`/api/admin/promote?${params}`, {
          cache: "no-store",
          // Los telefonos de busqueda no deben quedar en URLs ni access logs.
          headers: { "X-User-Search": encodeURIComponent(query.trim()) },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("No se pudo cargar el directorio");
        const data = await response.json();
        if (controller.signal.aborted) return;
        setUsers((previous) => {
          const combined: DirectoryUser[] = page === 0 ? data.usuarios : [...previous, ...data.usuarios];
          return Array.from(new Map(combined.map((user) => [user.id, user])).values());
        });
        setHasMore(data.hasMore);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, page === 0 && query.trim() ? 300 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, page, retry]);

  function showDirectory() {
    if (open) return;
    setUsers([]);
    setPage(0);
    setHasMore(false);
    setLoading(true);
    setOpen(true);
  }

  function search(value: string) {
    setQuery(value);
    setPage(0);
    setUsers([]);
    setHasMore(false);
    setLoading(true);
    setOpen(true);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }

  function loadMore() {
    if (!hasMore || loading || error) return;
    setLoading(true);
    setPage((current) => current + 1);
  }

  return (
    <div className="mt-6" onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(false);
      }
    }}>
      <label htmlFor="buscar-usuario" className="lp-label mb-2 block">
        Buscar un usuario
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
        <input
          id="buscar-usuario"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => search(event.target.value)}
          onFocus={showDirectory}
          placeholder="Nombre o teléfono"
          autoComplete="off"
          aria-controls="directorio-usuarios"
          className="lp-input !pl-11 !pr-14"
        />
        <button
          type="button"
          onClick={() => open ? setOpen(false) : showDirectory()}
          aria-label={open ? "Ocultar usuarios" : "Mostrar todos los usuarios"}
          aria-expanded={open}
          aria-controls="directorio-usuarios"
          className="absolute inset-y-0 right-1 flex w-11 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-all duration-200 hover:bg-bg-card-hover hover:text-text-primary active:scale-95"
        >
          <ChevronDown className={`h-5 w-5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-2 text-[12px] text-text-secondary">
        Abre la lista completa o busca por nombre o teléfono.
      </p>

      {open && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border-default bg-bg-card/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3 text-[12px] text-text-secondary">
            <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{query.trim() ? "Resultados de búsqueda" : "Todos los usuarios"}</span>
          </div>
          <div
              id="directorio-usuarios"
              ref={scrollRef}
              role="region"
              aria-label="Lista de usuarios"
              tabIndex={0}
              className="max-h-80 overflow-y-auto overscroll-contain"
              onScroll={(event) => {
                const list = event.currentTarget;
                if (list.scrollHeight - list.scrollTop - list.clientHeight < 120) loadMore();
              }}
          >
            <motion.ul
              variants={staggerContainer}
              initial={reducedMotion ? false : "hidden"}
              animate="visible"
              className="divide-y divide-border-subtle"
            >
              {users.map((user) => {
                const isAdmin = admins === null ? user.is_admin : admins.some((admin) => admin.id === user.id);
                return (
                  <motion.li key={user.id} variants={fadeUp} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4 transition-colors duration-200 hover:bg-bg-elevated">
                    <div className="min-w-0 grow basis-40">
                      <p className="text-[14px] font-medium text-text-primary [overflow-wrap:anywhere]">{user.display_name || "Sin nombre"}</p>
                      <p className="mt-1 text-[13px] tabular-nums text-text-secondary [overflow-wrap:anywhere]">{formatPhone(user.whatsapp_number) || "Sin teléfono"}</p>
                    </div>
                    {isAdmin ? (
                      <span className="text-[12px] text-text-secondary">Administrador</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPromote(user)}
                        disabled={savingId !== null || admins === null}
                        aria-label={`Hacer administrador a ${user.display_name || "usuario sin nombre"}, ${formatPhone(user.whatsapp_number) || "sin teléfono"}`}
                        className="lp-btn lp-btn-ghost shrink-0 px-3 text-[13px]"
                      >
                        {savingId === user.id ? "Guardando..." : "Hacer admin"}
                      </button>
                    )}
                  </motion.li>
                );
              })}
            </motion.ul>

            {loading && (
              <div role="status" className="space-y-4 p-4">
                <span className="sr-only">Cargando usuarios...</span>
                {[0, 1, 2].map((row) => (
                  <div key={row} className="space-y-2" aria-hidden="true">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            )}
            {error && !loading && (
              <div role="alert" className="p-4 text-[13px] text-text-secondary">
                <p>No se pudo cargar {users.length ? "el resto de la lista" : "la lista de usuarios"}.</p>
                <button type="button" className="lp-btn lp-btn-ghost mt-2 text-[13px]" onClick={() => setRetry((current) => current + 1)}>Reintentar</button>
              </div>
            )}
            {!loading && !error && users.length === 0 && (
              <div className="p-5 text-center">
                <Search className="mx-auto h-6 w-6 text-text-secondary" aria-hidden="true" />
                <p className="lp-display mt-2 text-[22px]">No hay usuarios para mostrar</p>
                <p className="mt-1 text-[13px] text-text-secondary">{query.trim() ? "Prueba con otro nombre o número de teléfono." : "Los nuevos registros aparecerán aquí."}</p>
                <button type="button" className="lp-btn lp-btn-ghost mt-3 text-[13px]" onClick={() => query ? search("") : setRetry((current) => current + 1)}>{query ? "Ver todos los usuarios" : "Actualizar lista"}</button>
              </div>
            )}
            {!loading && !error && hasMore && (
              <div className="p-3 text-center">
                <button type="button" onClick={loadMore} className="lp-btn lp-btn-ghost text-[13px]">Cargar más usuarios</button>
              </div>
            )}
            {!loading && !error && !hasMore && users.length > 0 && (
              <p role="status" className="border-t border-border-subtle px-4 py-3 text-center text-[12px] text-text-secondary">Fin de la lista · {users.length} {users.length === 1 ? "usuario" : "usuarios"}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
