create function interlink.service_only() returns void language plpgsql stable security definer set search_path=pg_catalog as $$
begin if coalesce(auth.role(),'')<>'service_role' then perform interlink.fail('FORBIDDEN'); end if; end $$;

create function public.interlink_worker_claim(kind text,batch_size integer default 20) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;
begin
  perform interlink.service_only();
  if kind not in ('push','deletion') then perform interlink.fail('VALIDATION'); end if;
  -- Exhausted abandoned leases are visible to operators, never silently discarded.
  update interlink.jobs j set status='failed',last_error='ATTEMPTS_EXHAUSTED',lease_token=null,lease_until=null
  where j.kind=$1 and j.attempts>=8 and (j.status in ('pending','retry') or j.status='processing' and j.lease_until<now());
  update interlink.deletion_requests d set status='failed',reason='ATTEMPTS_EXHAUSTED' from interlink.jobs j where j.deletion_request_id=d.id and j.status='failed' and d.status<>'completed';
  with selected as (
    select j.id from interlink.jobs j where j.kind=$1 and j.attempts<8 and j.next_attempt_at<=now()
      and (j.status in ('pending','retry') or j.status='processing' and j.lease_until<now())
      order by j.next_attempt_at,j.id for update skip locked limit greatest(1,least(50,batch_size))
  ), claimed as (
    update interlink.jobs j set status='processing',attempts=j.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds'
    from selected s where j.id=s.id returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',c.kind,'leaseToken',lease_token,'attempts',attempts,'phase',phase,'payload',jsonb_strip_nulls(jsonb_build_object('notificationId',notification_id,'deviceId',device_id,'userId',user_id,'ticketId',ticket_id)))),'[]') into rows from claimed c;
  update interlink.deletion_requests d set status='processing',reason=null from interlink.jobs j where j.deletion_request_id=d.id and j.status='processing';
  return rows;
end $$;
create function public.interlink_worker_ack(job_id uuid,lease_token uuid,outcome text,details jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j interlink.jobs; delay_seconds integer; job_error_code text;
begin
  perform interlink.service_only();
  select * into j from interlink.jobs where id=job_id for update;
  if j.id is null or j.lease_token is distinct from $2 or j.status<>'processing' or j.lease_until<now() then perform interlink.fail('CONFLICT'); end if;
  job_error_code:=left(regexp_replace(coalesce(details->>'code','WORKER_ERROR'),'[^A-Za-z0-9_]','','g'),80);
  delay_seconds:=greatest(0,least(3600,coalesce((details->>'delaySeconds')::integer,(60*power(2,least(j.attempts,6)))::integer)));
  case outcome
  when 'done' then
    if j.kind<>'push' then perform interlink.fail('VALIDATION'); end if;
    update interlink.jobs set status='completed',completed_at=now(),last_error=null where id=j.id;
    update interlink.push_receipts set status=coalesce(details->>'reason','ok'),checked_at=now() where interlink.push_receipts.job_id=j.id;
  when 'receipt' then
    if j.kind<>'push' or nullif(details->>'ticketId','') is null then perform interlink.fail('VALIDATION'); end if;
    update interlink.jobs set status='retry',phase='receipt',ticket_id=details->>'ticketId',next_attempt_at=now()+make_interval(secs=>greatest(60,delay_seconds)),last_error=null where id=j.id;
    insert into interlink.push_receipts(job_id,ticket_id) values(j.id,details->>'ticketId') on conflict on constraint push_receipts_pkey do update set ticket_id=excluded.ticket_id,status='pending';
  when 'auth' then
    if j.kind<>'deletion' or j.phase<>'files' then perform interlink.fail('VALIDATION'); end if;
    -- A completed file phase starts a fresh Auth retry budget, even when the
    -- final allowed file attempt succeeded. Incomplete file retries stay bounded.
    update interlink.jobs set status='retry',phase='auth',attempts=0,next_attempt_at=now(),last_error=null where id=j.id;
  when 'retry','failed' then
    if details?'phase' and (j.kind<>'push' or details->>'phase' not in ('send','receipt')) then perform interlink.fail('VALIDATION'); end if;
    update interlink.jobs set status=case when outcome='failed' or attempts>=8 then 'failed' else 'retry' end,
      phase=coalesce(details->>'phase',phase),ticket_id=case when details->>'phase'='send' then null else ticket_id end,
      next_attempt_at=now()+make_interval(secs=>greatest(1,delay_seconds)),last_error=job_error_code where id=j.id;
    update interlink.push_receipts set error_code=job_error_code,checked_at=now() where interlink.push_receipts.job_id=j.id;
    update interlink.deletion_requests set status=case when outcome='failed' or j.attempts>=8 then 'failed' else 'processing' end,reason=job_error_code where id=j.deletion_request_id;
  else perform interlink.fail('VALIDATION'); end case;
  update interlink.jobs set lease_token=null,lease_until=null where id=j.id;
  return jsonb_build_object('id',j.id,'status',(select status from interlink.jobs where id=j.id));
end $$;
create function public.interlink_push_target(job_id uuid,lease_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j interlink.jobs; d interlink.devices; n interlink.notifications; pref interlink.notification_preferences;
begin
  perform interlink.service_only();
  select * into j from interlink.jobs where id=job_id and kind='push' and status='processing' and interlink.jobs.lease_token=$2 and lease_until>now();
  if j.id is null then perform interlink.fail('CONFLICT'); end if;
  select * into d from interlink.devices where id=j.device_id;
  select * into n from interlink.notifications where id=j.notification_id;
  select * into pref from interlink.notification_preferences where user_id=j.user_id;
  if d.id is null or n.id is null or not d.active or d.user_id<>j.user_id or not interlink.active_user(j.user_id) or not coalesce(pref.push,false) or (n.actor_id is not null and interlink.blocked(j.user_id,n.actor_id)) then return null; end if;
  if ((n.type like 'application%' or n.type like 'invitation%') and not pref.applications) or (n.type not like 'application%' and n.type not like 'invitation%' and not pref.team) then return null; end if;
  if n.project_id is not null and (not interlink.project_visible(j.user_id,n.project_id) or n.type like 'team.%' and not interlink.member(j.user_id,n.project_id)) then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object('token',d.token,'notificationId',n.id,'projectId',n.project_id,'deviceId',d.id));
end $$;
create function public.interlink_disable_device(device_id uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin perform interlink.service_only(); update interlink.devices set active=false,updated_at=now() where id=device_id; end $$;

create function public.interlink_deletion_finalize(job_id uuid,lease_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j interlink.jobs; u uuid;
begin
  perform interlink.service_only();
  select * into j from interlink.jobs where id=job_id for update;
  if j.id is null or j.kind<>'deletion' or j.phase<>'auth' or j.status<>'processing' or j.lease_token is distinct from $2 or j.lease_until<now() then perform interlink.fail('CONFLICT'); end if;
  u:=j.user_id;
  if exists(select 1 from auth.users where id=u) or exists(select 1 from storage.objects where bucket_id='avatars' and (storage.foldername(name))[1]=u::text) then perform interlink.fail('CONFLICT'); end if;
  -- Default erasure retains only non-identifying tombstones for shared foreign keys.
  -- No evidence-retention exception is assumed before an approved retention policy exists.
  delete from interlink.report_evidence where report_id in (select r.id from interlink.reports r where r.reporter_id=u or r.target_type='profile' and r.target_id=u or r.target_type='message' and r.target_id in (select id from interlink.messages where author_id=u) or r.target_type='project' and r.target_id in (select id from interlink.projects where owner_id=u));
  update interlink.audit set note='삭제된 계정의 운영 기록' where target_id in (select id from interlink.reports where reporter_id=u);
  delete from interlink.reports where reporter_id=u;
  update interlink.reports set detail='',reason='삭제된 계정 관련 신고' where target_type='profile' and target_id=u or target_type='message' and target_id in (select id from interlink.messages where author_id=u) or target_type='project' and target_id in (select id from interlink.projects where owner_id=u);
  update interlink.messages set body='',deleted=true where author_id=u;
  update interlink.projects set title='종료된 프로젝트',goal='삭제된 계정이 종료한 프로젝트',description='계정 삭제로 종료된 프로젝트입니다.',interests='{}',roles='{}',availability='{}',status='archived',updated_at=now() where owner_id=u;
  update interlink.memberships set active=false,role='탈퇴한 팀원',left_at=coalesce(left_at,now()) where user_id=u;
  update interlink.applications set introduction='',role='탈퇴한 팀원' where user_id=u;
  update interlink.invitations set message='',role='탈퇴한 팀원',status=case when status='pending' then 'cancelled' else status end where inviter_id=u or invitee_id=u;
  delete from interlink.experiences where user_id=u;
  delete from interlink.saved_projects where user_id=u;
  delete from interlink.message_reads where user_id=u;
  delete from interlink.blocks where user_id=u or blocked_id=u;
  delete from interlink.notifications where user_id=u or actor_id=u;
  delete from interlink.devices where user_id=u;
  delete from interlink.notification_preferences where user_id=u;
  delete from interlink.admin_roles where user_id=u;
  delete from interlink.community_invites where created_by=u;
  delete from interlink.community_members where user_id=u;
  delete from interlink.idempotency where user_id=u;
  delete from interlink.rate_limits where user_id=u;
  delete from public.change_events where user_id=u;
  update interlink.audit set note='삭제된 계정의 운영 기록' where actor_id=u or target_id=u or target_id in (select id from interlink.messages where author_id=u) or target_id in (select id from interlink.projects where owner_id=u) or target_id in (select id from interlink.reports where target_type='profile' and target_id=u or target_type='message' and target_id in (select id from interlink.messages where author_id=u) or target_type='project' and target_id in (select id from interlink.projects where owner_id=u));
  update interlink.profiles set nickname='탈퇴한 팀원',avatar='lime',bio='',interests='{}',roles='{}',learning_roles='{}',skills='{}',availability='{}',links='{}',discoverable=false,community_id=null,hidden=true,updated_at=now() where id=u;
  update interlink.accounts set status='deleted',consent_version=null,updated_at=now() where id=u;
  update interlink.deletion_requests set status='completed',completed_at=now(),reason=null where id=j.deletion_request_id;
  update interlink.jobs set status='completed',completed_at=now(),lease_token=null,lease_until=null,last_error=null where id=j.id;
  return jsonb_build_object('id',j.deletion_request_id,'status','completed');
end $$;

-- Empty introductions are reserved for erased tombstones, enforced through the account state.
alter table interlink.applications drop constraint applications_introduction_check;
alter table interlink.applications add constraint applications_introduction_check check(length(introduction)=0 or length(introduction) between 5 and 500);
create function public.interlink_upload_authorize(user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform interlink.service_only();
  if not interlink.active_user(user_id) then perform interlink.fail('FORBIDDEN'); end if;
  perform interlink.rate(user_id,'avatar.upload',10,3600);
  return jsonb_build_object('allowed',true);
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('avatars','avatars',false,5242880,array['image/jpeg']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function public.interlink_avatar_allowed(object_name text) returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare owner_id uuid;
begin
  if auth.uid() is null or not interlink.active_user(auth.uid()) then return false; end if;
  owner_id:=((storage.foldername(object_name))[1])::uuid;
  return interlink.active_user(owner_id) and (owner_id=auth.uid() or (interlink.profile_visible(auth.uid(),owner_id) and exists(select 1 from interlink.profiles where id=owner_id and avatar=object_name)));
exception when invalid_text_representation then return false;
end $$;
create policy avatar_private_reads on storage.objects for select to authenticated using(bucket_id='avatars' and public.interlink_avatar_allowed(name));
-- No INSERT/UPDATE/DELETE grant policy: uploads go through decoder Edge Function only.
create function interlink.avatar_write_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid; s text;
begin
  if new.bucket_id<>'avatars' then return new; end if;
  if new.name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpeg$' then perform interlink.fail('VALIDATION'); end if;
  owner_id:=((storage.foldername(new.name))[1])::uuid;
  select status into s from interlink.accounts where id=owner_id for share;
  if s is distinct from 'active' then perform interlink.fail('FORBIDDEN'); end if;
  return new;
end $$;
create trigger interlink_avatar_guard before insert or update on storage.objects for each row execute function interlink.avatar_write_guard();
revoke all on function public.interlink_avatar_allowed(text) from public,anon;
grant execute on function public.interlink_avatar_allowed(text) to authenticated;

revoke all on function public.interlink_worker_claim(text,integer),public.interlink_worker_ack(uuid,uuid,text,jsonb),public.interlink_push_target(uuid,uuid),public.interlink_disable_device(uuid),public.interlink_deletion_finalize(uuid,uuid),public.interlink_upload_authorize(uuid) from public,anon,authenticated;
grant execute on function public.interlink_worker_claim(text,integer),public.interlink_worker_ack(uuid,uuid,text,jsonb),public.interlink_push_target(uuid,uuid),public.interlink_disable_device(uuid),public.interlink_deletion_finalize(uuid,uuid),public.interlink_upload_authorize(uuid) to service_role;
revoke all on all functions in schema interlink from public,anon,authenticated;

create function public.interlink_maintenance() returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform interlink.service_only();
  update interlink.invitations set status='expired',updated_at=now() where status='pending' and expires_at<=now();
  delete from public.change_events where created_at<now()-interval '2 days';
  delete from interlink.rate_limits where bucket<now()-interval '2 days';
  -- Completed keys remain for 30 days; deleted users' keys are removed by deletion finalize.
  delete from interlink.idempotency where created_at<now()-interval '30 days';
end $$;
revoke all on function public.interlink_maintenance() from public,anon,authenticated;
grant execute on function public.interlink_maintenance() to service_role;
