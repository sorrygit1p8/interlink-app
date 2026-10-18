-- Private, minimal application/invitation status history. This is not a content
-- archive: introductions, messages, roles, nicknames and contact details are never
-- copied here. Existing rows are explicitly observed baselines, not invented past
-- transitions. No client RPC or Realtime publication exposes this table.
create table interlink.request_status_history (
  id bigint generated always as identity primary key,
  application_id uuid references interlink.applications on delete cascade,
  invitation_id uuid references interlink.invitations on delete cascade,
  event_kind text not null check(event_kind in ('created','transition','baseline')),
  previous_status text,
  next_status text not null,
  actor_id uuid references interlink.accounts on delete set null,
  recorded_at timestamptz not null default clock_timestamp(),
  check(num_nonnulls(application_id,invitation_id)=1),
  check((event_kind='transition' and previous_status is not null and previous_status<>next_status)
    or (event_kind in ('created','baseline') and previous_status is null)),
  check((application_id is not null
      and next_status in ('pending','approved','rejected','withdrawn')
      and (previous_status is null or previous_status in ('pending','approved','rejected','withdrawn')))
    or (invitation_id is not null
      and next_status in ('pending','accepted','declined','cancelled','expired')
      and (previous_status is null or previous_status in ('pending','accepted','declined','cancelled','expired'))))
);
create index request_history_application on interlink.request_status_history(application_id,recorded_at,id)
  where application_id is not null;
create index request_history_invitation on interlink.request_status_history(invitation_id,recorded_at,id)
  where invitation_id is not null;
create index request_history_retention on interlink.request_status_history(recorded_at);
alter table interlink.request_status_history enable row level security;
revoke all on interlink.request_status_history from public,anon,authenticated,service_role;

insert into interlink.request_status_history(application_id,event_kind,next_status)
select id,'baseline',status from interlink.applications;
insert into interlink.request_status_history(invitation_id,event_kind,next_status)
select id,'baseline',status from interlink.invitations;

create function interlink.record_request_status() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare previous text; event text; actor uuid;
begin
  if tg_op='UPDATE' then
    if old.status is not distinct from new.status then return new; end if;
    previous:=old.status; event:='transition';
  else
    previous:=null; event:='created';
  end if;
  -- Identity comes from verified claims, never from a command payload. Maintenance
  -- and migration actions without a user claim have a null (system) actor.
  select id into actor from interlink.accounts where id=auth.uid() and status<>'deleted';
  if tg_table_name='applications' then
    insert into interlink.request_status_history(application_id,event_kind,previous_status,next_status,actor_id)
    values(new.id,event,previous,new.status,actor);
  elsif tg_table_name='invitations' then
    insert into interlink.request_status_history(invitation_id,event_kind,previous_status,next_status,actor_id)
    values(new.id,event,previous,new.status,actor);
  end if;
  return new;
end $$;
create trigger application_status_history after insert or update of status on interlink.applications
  for each row execute function interlink.record_request_status();
create trigger invitation_status_history after insert or update of status on interlink.invitations
  for each row execute function interlink.record_request_status();

create function interlink.erase_request_history() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  -- Erase history belonging to the deleted account, its invitations or its owned
  -- projects. Remove attribution from unrelated retained transitions as well.
  -- This runs after the existing deletion worker finishes its SQL cleanup; its
  -- own cancellation transitions therefore cannot leave new identifying history.
  delete from interlink.request_status_history h
  where h.application_id in (
    select a.id from interlink.applications a join interlink.projects p on p.id=a.project_id
    where a.user_id=new.id or p.owner_id=new.id
  ) or h.invitation_id in (
    select i.id from interlink.invitations i join interlink.projects p on p.id=i.project_id
    where i.inviter_id=new.id or i.invitee_id=new.id or p.owner_id=new.id
  );
  update interlink.request_status_history set actor_id=null where actor_id=new.id;
  return new;
end $$;
create trigger account_erases_request_history after update of status on interlink.accounts
  for each row when (old.status is distinct from new.status and new.status='deleted')
  execute function interlink.erase_request_history();

-- A conservative 30-day implementation cap, not a finalized legal retention
-- policy. Operators must review duration and lawful basis before public launch.
-- Existing maintenance behavior is preserved; its established schedule prunes
-- this metadata too, and account deletion erases related history earlier.
create or replace function public.interlink_maintenance() returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform interlink.service_only();
  update interlink.invitations set status='expired',updated_at=now() where status='pending' and expires_at<=now();
  delete from public.change_events where created_at<now()-interval '2 days';
  delete from interlink.rate_limits where bucket<now()-interval '2 days';
  delete from interlink.idempotency where created_at<now()-interval '30 days';
  delete from interlink.request_status_history where recorded_at<now()-interval '30 days';
end $$;
revoke all on function interlink.record_request_status(),interlink.erase_request_history() from public,anon,authenticated,service_role;
revoke all on function public.interlink_maintenance() from public,anon,authenticated;
grant execute on function public.interlink_maintenance() to service_role;
