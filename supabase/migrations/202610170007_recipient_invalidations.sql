-- These rows contain only server-created invalidation metadata, never content.
-- A request recipient is not yet a member, and a hidden team's member check is
-- already false. Let those users receive their own change/revocation signal so
-- they can clear caches and refetch through the unchanged authorized RPCs.
create or replace function public.interlink_event_allowed(event_user uuid,event_project uuid,event_scope text) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select event_user=auth.uid() and interlink.active_user(auth.uid())
    and (event_project is null
      or event_scope in ('notifications','membership','applications','invitations','team','saved')
      or interlink.member(auth.uid(),event_project))
$$;
revoke all on function public.interlink_event_allowed(uuid,uuid,text) from public,anon;
grant execute on function public.interlink_event_allowed(uuid,uuid,text) to authenticated;

-- Status changes can originate in project closure, blocks, admission, account
-- deletion or maintenance, not just the explicit review/respond commands.
-- Keep all those paths observable without enabling notification preferences or
-- copying request introductions, invitation text, profiles or message bodies.
create function interlink.invalidate_request_status() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid;
begin
  if tg_op='UPDATE' and old.status is not distinct from new.status then return new; end if;
  if tg_table_name='applications' then
    perform interlink.emit(new.user_id,'applications',new.project_id);
    select p.owner_id into owner_id from interlink.projects p where p.id=new.project_id;
    if owner_id is not null and owner_id<>new.user_id then perform interlink.emit(owner_id,'applications',new.project_id); end if;
  elsif tg_table_name='invitations' then
    perform interlink.emit(new.invitee_id,'invitations',new.project_id);
    if new.inviter_id<>new.invitee_id then perform interlink.emit(new.inviter_id,'invitations',new.project_id); end if;
    select p.owner_id into owner_id from interlink.projects p where p.id=new.project_id;
    if owner_id is not null and owner_id<>new.invitee_id and owner_id<>new.inviter_id then
      perform interlink.emit(owner_id,'invitations',new.project_id);
    end if;
  end if;
  return new;
end $$;
create trigger application_status_invalidates after insert or update of status on interlink.applications
  for each row execute function interlink.invalidate_request_status();
create trigger invitation_status_invalidates after insert or update of status on interlink.invitations
  for each row execute function interlink.invalidate_request_status();
revoke all on function interlink.invalidate_request_status() from public,anon,authenticated,service_role;
