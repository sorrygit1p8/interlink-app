-- A ticket accepted by the final send attempt still needs receipt processing.
-- Keep the lifetime send budget separate from the current phase's claim budget.
alter table interlink.jobs add column send_attempts integer not null default 0 check(send_attempts between 0 and 8);
update interlink.jobs set send_attempts=case
  when phase='receipt' then greatest(1,least(8,attempts))
  else greatest(0,least(8,attempts)) end
where kind='push';
-- Old receipt rows mixed send and receipt counts. Grant queued tickets one fresh
-- receipt budget on upgrade; preserve failed/leased rows and conservative sends.
update interlink.jobs set attempts=0 where kind='push' and phase='receipt' and status in ('pending','retry');

create or replace function public.interlink_worker_claim(kind text,batch_size integer default 20) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;
begin
  perform interlink.service_only();
  if kind not in ('push','deletion') then perform interlink.fail('VALIDATION'); end if;
  update interlink.jobs j set status='failed',last_error='ATTEMPTS_EXHAUSTED',lease_token=null,lease_until=null
  where j.kind=$1 and (j.attempts>=8 or j.kind='push' and j.phase='send' and j.send_attempts>=8)
    and (j.status in ('pending','retry') or j.status='processing' and j.lease_until<now());
  update interlink.deletion_requests d set status='failed',reason='ATTEMPTS_EXHAUSTED' from interlink.jobs j where j.deletion_request_id=d.id and j.status='failed' and d.status<>'completed';
  with selected as (
    select j.id from interlink.jobs j where j.kind=$1 and j.attempts<8
      and (j.kind<>'push' or j.phase<>'send' or j.send_attempts<8) and j.next_attempt_at<=now()
      and (j.status in ('pending','retry') or j.status='processing' and j.lease_until<now())
      order by j.next_attempt_at,j.id for update skip locked limit greatest(1,least(50,batch_size))
  ), claimed as (
    update interlink.jobs j set status='processing',attempts=j.attempts+1,
      send_attempts=j.send_attempts+case when j.kind='push' and j.phase='send' then 1 else 0 end,
      lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds'
    from selected s where j.id=s.id returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',c.kind,'leaseToken',lease_token,'attempts',attempts,'phase',phase,'payload',jsonb_strip_nulls(jsonb_build_object('notificationId',notification_id,'deviceId',device_id,'userId',user_id,'ticketId',ticket_id)))),'[]') into rows from claimed c;
  update interlink.deletion_requests d set status='processing',reason=null from interlink.jobs j where j.deletion_request_id=d.id and j.status='processing';
  return rows;
end $$;

create or replace function public.interlink_worker_ack(job_id uuid,lease_token uuid,outcome text,details jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare j interlink.jobs; delay_seconds integer; job_error_code text; next_phase text; exhausted boolean;
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
    if j.kind<>'push' or j.phase not in ('send','receipt') or nullif(details->>'ticketId','') is null then perform interlink.fail('VALIDATION'); end if;
    -- Reset only once when a send succeeds, never for a pending receipt poll.
    update interlink.jobs set status=case when j.phase='receipt' and j.attempts>=8 then 'failed' else 'retry' end,
      phase='receipt',attempts=case when j.phase='send' then 0 else attempts end,
      ticket_id=details->>'ticketId',next_attempt_at=now()+make_interval(secs=>greatest(60,delay_seconds)),
      last_error=case when j.phase='receipt' and j.attempts>=8 then 'RECEIPT_PENDING' else null end where id=j.id;
    insert into interlink.push_receipts(job_id,ticket_id) values(j.id,details->>'ticketId') on conflict on constraint push_receipts_pkey do update set ticket_id=excluded.ticket_id,status='pending';
  when 'auth' then
    if j.kind<>'deletion' or j.phase<>'files' then perform interlink.fail('VALIDATION'); end if;
    update interlink.jobs set status='retry',phase='auth',attempts=0,next_attempt_at=now(),last_error=null where id=j.id;
  when 'retry','failed' then
    if details?'phase' and (j.kind<>'push' or details->>'phase' not in ('send','receipt')) then perform interlink.fail('VALIDATION'); end if;
    next_phase:=coalesce(details->>'phase',j.phase);
    exhausted:=outcome='failed' or j.attempts>=8 or j.kind='push' and next_phase='send' and j.send_attempts>=8;
    update interlink.jobs set status=case when exhausted then 'failed' else 'retry' end,
      phase=next_phase,attempts=case when j.kind='push' and next_phase='send' then j.send_attempts else attempts end,
      ticket_id=case when details->>'phase'='send' then null else ticket_id end,
      next_attempt_at=now()+make_interval(secs=>greatest(1,delay_seconds)),last_error=job_error_code where id=j.id;
    update interlink.push_receipts set error_code=job_error_code,checked_at=now() where interlink.push_receipts.job_id=j.id;
    update interlink.deletion_requests set status=case when exhausted then 'failed' else 'processing' end,reason=job_error_code where id=j.deletion_request_id;
  else perform interlink.fail('VALIDATION'); end case;
  update interlink.jobs set lease_token=null,lease_until=null where id=j.id;
  return jsonb_build_object('id',j.id,'status',(select status from interlink.jobs where id=j.id));
end $$;

-- The existing audited admin.job.retry command resets the whole reviewed job.
-- Keep its explicit restart meaningful without replacing unrelated command code.
create function interlink.reset_push_retry_budget() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if old.kind='push' and old.status='failed' and new.status='retry' and new.attempts=0 then new.send_attempts:=0; end if;
  return new;
end $$;
create trigger interlink_push_retry_budget before update on interlink.jobs for each row execute function interlink.reset_push_retry_budget();
revoke all on function interlink.reset_push_retry_budget() from public,anon,authenticated;
revoke all on function public.interlink_worker_claim(text,integer),public.interlink_worker_ack(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.interlink_worker_claim(text,integer),public.interlink_worker_ack(uuid,uuid,text,jsonb) to service_role;
