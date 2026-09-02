-- 088: trazabilidad de entrega de los SMS de login + DLR atómico.
--
-- Fusión de las migraciones 066 + 069 de los-del-sur-app (2026-08-11),
-- portadas a La Polla para el cutover Twilio Verify → LabsMobile.
-- NO se aplica a producción desde este commit: el archivo queda listo
-- para cuando el dueño haga el cutover.
--
-- POR QUÉ EXISTE. La noche del 2026-08-10 (en la otra app) dos códigos de
-- acceso quedaron retenidos 2h35m en la ruta de LabsMobile hacia Colombia y
-- NADIE se enteró. El destinatario pidió el código, no le llegó, y entró
-- por WhatsApp; el SMS apareció en su celular a la 01:58 con un código
-- muerto hacía dos horas y media. Nos enteramos porque él lo contó.
--
-- El punto ciego era este: el hook devuelve 200 cuando LabsMobile ACEPTA el
-- mensaje, y ahí se terminaba nuestra visibilidad. Pero "el proveedor lo
-- aceptó" NO es "llegó al celular" — entre las dos cosas cabe una cola de dos
-- horas. Reconstruir el incidente exigió cruzar a mano los logs de Vercel,
-- auth.users y el panel web de LabsMobile.
--
-- Esta tabla guarda las DOS puntas de cada SMS:
--   · el despacho     → el `subid` que devolvemos a /json/send (y registramos
--                       ANTES del fetch, para que el callback no se adelante)
--   · el acuse (DLR)  → lo que LabsMobile pega contra /api/sms/ack
--
-- OJO con los niveles de acuse: LabsMobile puede llamar VARIAS veces por el
-- mismo mensaje, una por nivel (gateway → operator → handset). El que importa
-- es `handset`: es el que significa "el celular lo tiene", y es el que el panel
-- muestra en su columna "ACK HS". Por eso `delivered_at` solo se llena con ese
-- nivel, mientras `last_ack_at` va guardando el último de cualquier tipo.
--
-- La RPC `aplicar_sms_ack` serializa dos callbacks simultáneos con
-- SELECT FOR UPDATE: un operator/ko no puede pisar un handset/ok ya
-- confirmado (eso era posible con read/update desde JavaScript).

create table if not exists public.sms_entregas (
  subid        text primary key,          -- id de LabsMobile: la clave natural del cruce
  phone        text not null,             -- E.164 sin "+", igual que auth.users.phone
  sent_at      timestamptz not null default now(),
  delivered_at timestamptz,               -- solo acuse nivel handset + status ok
  last_ack_at  timestamptz,               -- último acuse de CUALQUIER nivel
  acklevel     text,                      -- gateway | operator | handset | error
  status       text,                      -- ok | ko
  descripcion  text,                      -- DELIVRD | REJECTD | EXPIRED | UNDELIV | BLOCKED | UNKNOWN
  -- Materializada y no calculada al vuelo para poder ORDENAR e INDEXAR por
  -- demora sin recalcular en cada query. `generated ... stored` la mantiene
  -- Postgres: no puede quedar desincronizada de las dos fechas que la definen.
  demora_seg   int generated always as (
                 case
                   when delivered_at is null then null
                   else greatest(0, extract(epoch from (delivered_at - sent_at))::int)
                 end
               ) stored,
  alertado_at  timestamptz,               -- cuándo se avisó por correo (evita repetir el aviso)
  created_at   timestamptz not null default now(),
  -- Nace en pending: el hook inserta ANTES del fetch a LabsMobile. Un DLR
  -- posterior (o registrarResultadoDespacho) promociona a accepted.
  dispatch_status     text not null default 'pending',
  dispatch_updated_at timestamptz not null default now(),
  constraint sms_entregas_dispatch_status_check
    check (dispatch_status in ('pending', 'accepted', 'ambiguous', 'rejected'))
);

-- El vigía busca exactamente esto: despachados hace rato, sin acuse de
-- handset y sin avisar todavía. El índice parcial lo deja en una lectura corta
-- por más que la tabla crezca.
create index if not exists idx_sms_entregas_pendientes
  on public.sms_entregas (sent_at)
  where delivered_at is null and alertado_at is null;

-- Para mirar los últimos envíos y para responder "¿le llegó a este número?".
create index if not exists idx_sms_entregas_sent
  on public.sms_entregas (sent_at desc);
create index if not exists idx_sms_entregas_phone
  on public.sms_entregas (phone, sent_at desc);

-- RLS ENABLE primero (regla de seguridad #1 — siempre, sin excepción).
alter table public.sms_entregas enable row level security;

-- Tabla con teléfonos: service_role y nadie más. El deadline de Supabase
-- 30-oct-2026 deja de auto-grantear tablas nuevas; GRANTs explícitos.
-- REVOKE de PUBLIC/anon/authenticated primero (los default privileges del
-- proyecto le dan SELECT/INSERT a authenticated sobre tablas nuevas).
revoke all on table public.sms_entregas from public, anon, authenticated;
grant select, insert, update, delete on public.sms_entregas to service_role;

-- Deny-all explícito: silencia el Security Advisor (rls_enabled_no_policy)
-- y documenta la intención. service_role bypassa RLS.
drop policy if exists sms_entregas_deny_all on public.sms_entregas;
create policy sms_entregas_deny_all on public.sms_entregas
  for all to anon, authenticated
  using (false) with check (false);

comment on table public.sms_entregas is
  'DLR de SMS de login (LabsMobile). Teléfonos: service_role only. Hook anota el subid ANTES del fetch; /api/sms/ack aplica el acuse.';

create or replace function public.aplicar_sms_ack(
  p_subid text,
  p_acklevel text,
  p_status text,
  p_descripcion text,
  p_event_at timestamptz,
  p_msisdn text default null
)
returns table (
  applied boolean,
  phone text,
  sent_at timestamptz,
  delivered_at timestamptz,
  alert_kind text,
  demora_seg integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.sms_entregas%rowtype;
  v_entregado boolean := p_acklevel = 'handset' and p_status = 'ok';
  v_demora integer;
  v_alert text;
begin
  if p_subid is null or length(p_subid) not between 1 and 64
     or p_acklevel is null or length(p_acklevel) > 32
     or p_status is null or length(p_status) > 16
     or p_event_at is null then
    return;
  end if;

  select * into v_row
  from public.sms_entregas
  where subid = p_subid
  for update;

  if not found then return; end if;
  if p_msisdn is not null and p_msisdn <> '' and p_msisdn <> v_row.phone then
    return;
  end if;
  if v_row.last_ack_at is not null and p_event_at < v_row.last_ack_at
     and not (v_entregado and v_row.delivered_at is null) then
    return;
  end if;

  v_demora := greatest(0, extract(epoch from (p_event_at - v_row.sent_at))::integer);

  -- Un handset confirmado es terminal: nunca se degrada. Un nuevo handset
  -- puede actualizar last_ack_at, pero conserva la primera hora de entrega.
  update public.sms_entregas as se
  set
    dispatch_status = case
      when se.dispatch_status in ('pending', 'ambiguous') then 'accepted'
      else se.dispatch_status
    end,
    dispatch_updated_at = case
      when se.dispatch_status in ('pending', 'ambiguous') then now()
      else se.dispatch_updated_at
    end,
    last_ack_at = greatest(coalesce(se.last_ack_at, p_event_at), p_event_at),
    acklevel = case when v_row.delivered_at is null or v_entregado then p_acklevel else se.acklevel end,
    status = case when v_row.delivered_at is null or v_entregado then p_status else se.status end,
    descripcion = case when v_row.delivered_at is null or v_entregado then left(coalesce(p_descripcion, ''), 120) else se.descripcion end,
    delivered_at = case when v_entregado and v_row.delivered_at is null then p_event_at else se.delivered_at end,
    alertado_at = case
      when v_row.alertado_at is null
       and ((p_status = 'ko' and v_row.delivered_at is null)
         or (v_entregado and v_demora > 120))
      then now()
      else se.alertado_at
    end
  where subid = p_subid;

  if v_row.alertado_at is null then
    if p_status = 'ko' and v_row.delivered_at is null then v_alert := 'failed';
    elsif v_entregado and v_demora > 120 then v_alert := 'late';
    end if;
  end if;

  return query
  select true, v_row.phone, v_row.sent_at,
         case when v_entregado and v_row.delivered_at is null then p_event_at else v_row.delivered_at end,
         v_alert, v_demora;
end;
$$;

-- REVOKE de PUBLIC primero (anon/authenticated heredan de PUBLIC). Después
-- de anon y authenticated explícito: el auto-grant de Supabase no se cae
-- solo con REVOKE FROM PUBLIC (gotcha de las migraciones 056/079/083).
revoke execute on function public.aplicar_sms_ack(text, text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.aplicar_sms_ack(text, text, text, text, timestamptz, text)
  to service_role;

comment on function public.aplicar_sms_ack(text, text, text, text, timestamptz, text) is
  'Serializa DLR de LabsMobile con FOR UPDATE, preserva handset terminal y reclama la alerta una sola vez. Solo service_role.';
