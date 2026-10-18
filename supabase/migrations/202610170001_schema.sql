-- Private application tables are intentionally absent from the PostgREST schemas.
-- Only authenticated dispatch RPCs and service-role worker RPCs are exposed.
create schema if not exists interlink;
create extension if not exists pgcrypto with schema extensions;
revoke all on schema interlink from public, anon, authenticated;
grant usage on schema interlink to service_role;

create table interlink.accounts (
  id uuid primary key,
  status text not null default 'active' check(status in ('active','suspended','deleting','deleted')),
  consent_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table interlink.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 2 and 80),
  status text not null default 'active' check(status in ('active','closed')),
  created_at timestamptz not null default now()
);
create table interlink.community_members (
  community_id uuid references interlink.communities on delete cascade,
  user_id uuid references interlink.accounts,
  status text not null default 'approved' check(status in ('approved','revoked')),
  joined_at timestamptz not null default now(),
  primary key(community_id,user_id)
);
create table interlink.community_invites (
  id uuid primary key default gen_random_uuid(),
  code_hash bytea not null unique,
  community_id uuid not null references interlink.communities,
  max_uses integer not null check(max_uses between 1 and 1000),
  uses integer not null default 0 check(uses>=0 and uses<=max_uses),
  expires_at timestamptz not null,
  created_by uuid not null references interlink.accounts,
  created_at timestamptz not null default now()
);
create table interlink.profiles (
  id uuid primary key references interlink.accounts,
  nickname text not null default '새로운 팀원' check(length(nickname) between 2 and 24),
  avatar text not null default 'lime' check(length(avatar)<=120),
  interests text[] not null default '{}', roles text[] not null default '{}',
  learning_roles text[] not null default '{}', skills text[] not null default '{}',
  availability text[] not null default '{}',
  activity_mode text not null default 'online' check(activity_mode in ('online','offline','hybrid')),
  bio text not null default '' check(length(bio)<=500),
  discoverable boolean not null default false,
  community_id uuid references interlink.communities,
  links text[] not null default '{}',
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  check(cardinality(interests)<=20 and cardinality(roles)<=20 and cardinality(learning_roles)<=20 and cardinality(skills)<=20 and cardinality(availability)<=20 and cardinality(links)<=3)
);
create table interlink.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references interlink.accounts,
  community_id uuid not null references interlink.communities,
  title text not null check(length(title) between 3 and 80),
  goal text not null check(length(goal) between 5 and 200),
  description text not null check(length(description) between 10 and 4000),
  interests text[] not null default '{}', roles text[] not null default '{}',
  capacity integer not null check(capacity between 2 and 20),
  activity_mode text not null check(activity_mode in ('online','offline','hybrid')),
  availability text[] not null default '{}',
  deadline timestamptz not null,
  beginner_friendly boolean not null default true,
  status text not null default 'recruiting' check(status in ('draft','recruiting','active','completed','archived')),
  hidden boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(cardinality(interests)<=20 and cardinality(roles)<=20 and cardinality(availability)<=20)
);
create index projects_scope_status on interlink.projects(community_id,status,created_at desc,id);
create index projects_interests on interlink.projects using gin(interests);
create index projects_roles on interlink.projects using gin(roles);
create index profiles_interests on interlink.profiles using gin(interests);
create index profiles_roles on interlink.profiles using gin(roles);
create index profiles_scope on interlink.profiles(community_id,discoverable);
create table interlink.memberships (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references interlink.projects,
  user_id uuid not null references interlink.accounts,
  role text not null check(length(role) between 1 and 80),
  active boolean not null default true,
  joined_at timestamptz not null default now(), left_at timestamptz,
  unique(project_id,user_id)
);
create index memberships_user on interlink.memberships(user_id,active,project_id);
create table interlink.applications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references interlink.projects,
  user_id uuid not null references interlink.accounts,
  role text not null check(length(role) between 1 and 80),
  introduction text not null check(length(introduction) between 5 and 500),
  status text not null default 'pending' check(status in ('pending','approved','rejected','withdrawn')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index applications_pending on interlink.applications(project_id,user_id) where status='pending';
create index applications_user on interlink.applications(user_id,created_at desc);
create index applications_project on interlink.applications(project_id,status);
create table interlink.invitations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references interlink.projects,
  inviter_id uuid not null references interlink.accounts, invitee_id uuid not null references interlink.accounts,
  role text not null check(length(role) between 1 and 80),
  message text not null default '' check(length(message)<=500),
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled','expired')),
  expires_at timestamptz not null default (now()+interval '7 days'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(inviter_id<>invitee_id)
);
create unique index invitations_pending on interlink.invitations(project_id,invitee_id) where status='pending';
create index invitations_user on interlink.invitations(invitee_id,status);
create table interlink.messages (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references interlink.projects,
  author_id uuid not null references interlink.accounts,
  body text not null check(length(body)<=2000),
  client_id uuid not null,
  deleted boolean not null default false, hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique(author_id,client_id), check(deleted or length(body)>0)
);
create index messages_project_cursor on interlink.messages(project_id,created_at desc,id desc);
create table interlink.message_reads (
  project_id uuid references interlink.projects, user_id uuid references interlink.accounts,
  message_id uuid references interlink.messages, read_at timestamptz not null default now(),
  primary key(project_id,user_id)
);
create table interlink.saved_projects (
  project_id uuid references interlink.projects, user_id uuid references interlink.accounts,
  created_at timestamptz not null default now(), primary key(project_id,user_id)
);
create table interlink.experiences (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references interlink.accounts,
  project_id uuid not null references interlink.projects,
  title text not null check(length(title) between 2 and 100),
  description text not null check(length(description) between 5 and 2000),
  role text not null check(length(role) between 1 and 80), is_public boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table interlink.blocks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references interlink.accounts,
  blocked_id uuid not null references interlink.accounts, created_at timestamptz not null default now(),
  unique(user_id,blocked_id), check(user_id<>blocked_id)
);
create index blocks_reverse on interlink.blocks(blocked_id,user_id);
create table interlink.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references interlink.accounts,
  actor_id uuid references interlink.accounts, type text not null,
  title text not null, project_id uuid references interlink.projects,
  read boolean not null default false, created_at timestamptz not null default now()
);
create index notifications_user on interlink.notifications(user_id,created_at desc,id desc);
create table interlink.notification_preferences (
  user_id uuid primary key references interlink.accounts, push boolean not null default false,
  team boolean not null default true, applications boolean not null default true
);
create table interlink.devices (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references interlink.accounts,
  token text not null unique check(length(token) between 20 and 200),
  platform text not null check(platform in ('ios','android')), active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table interlink.reports (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null references interlink.accounts,
  target_type text not null check(target_type in ('profile','project','message')), target_id uuid not null,
  reason text not null check(length(reason) between 1 and 80), detail text not null default '' check(length(detail)<=2000),
  status text not null default 'open' check(status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now()
);
create index reports_status on interlink.reports(status,created_at);
-- Evidence is never returned in message queries or realtime. Retention requires an operator policy.
create table interlink.report_evidence (
  report_id uuid primary key references interlink.reports on delete cascade,
  content text not null, created_at timestamptz not null default now()
);
create table interlink.admin_roles (
  user_id uuid primary key references interlink.accounts, role text not null check(role='admin'),
  granted_at timestamptz not null default now()
);
create table interlink.audit (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references interlink.accounts,
  action text not null, target_id uuid not null, note text not null default '', created_at timestamptz not null default now()
);
create table interlink.deletion_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references interlink.accounts,
  status text not null default 'requested' check(status in ('requested','processing','completed','failed')),
  created_at timestamptz not null default now(), completed_at timestamptz, reason text
);
create table interlink.jobs (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('push','deletion')),
  user_id uuid not null references interlink.accounts,
  notification_id uuid references interlink.notifications on delete cascade,
  device_id uuid references interlink.devices on delete cascade,
  deletion_request_id uuid references interlink.deletion_requests,
  phase text not null check(phase in ('send','receipt','files','auth')),
  status text not null default 'pending' check(status in ('pending','processing','retry','completed','failed')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  lease_token uuid, lease_until timestamptz, ticket_id text, last_error text,
  created_at timestamptz not null default now(), completed_at timestamptz,
  unique(notification_id,device_id), unique(deletion_request_id)
);
create index jobs_claim on interlink.jobs(kind,status,next_attempt_at) where status in ('pending','retry','processing');
create table interlink.push_receipts (
  job_id uuid primary key references interlink.jobs on delete cascade,
  ticket_id text not null, status text not null default 'pending', error_code text,
  checked_at timestamptz, created_at timestamptz not null default now()
);
create table interlink.idempotency (
  user_id uuid references interlink.accounts, key uuid, operation text not null,
  payload_hash bytea not null, response jsonb, created_at timestamptz not null default now(),
  primary key(user_id,key)
);
create table interlink.rate_limits (
  user_id uuid references interlink.accounts, action text, bucket timestamptz,
  count integer not null, primary key(user_id,action,bucket)
);

-- Content-free invalidations only. Private tables are never added to realtime publication.
create table public.change_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  scope text not null, project_id uuid, created_at timestamptz not null default now()
);
create index change_events_user on public.change_events(user_id,created_at);
alter table public.change_events enable row level security;
revoke all on public.change_events from public, anon, authenticated;
grant select on public.change_events to authenticated;

create function interlink.fail(code text) returns void language plpgsql set search_path=pg_catalog as $$
begin raise exception using errcode='P0001',message=code; end $$;
create function interlink.actor(require_active boolean default true) returns uuid
language plpgsql stable security definer set search_path=pg_catalog as $$
declare u uuid := auth.uid(); s text;
begin
  if u is null then perform interlink.fail('UNAUTHENTICATED'); end if;
  select status into s from interlink.accounts where id=u;
  if s is null then perform interlink.fail('UNAUTHENTICATED'); end if;
  if require_active and s<>'active' then perform interlink.fail('FORBIDDEN'); end if;
  return u;
end $$;
create function interlink.active_user(u uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from interlink.accounts where id=u and status='active')
$$;
create function interlink.community_access(u uuid,c uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select interlink.active_user(u) and exists(select 1 from interlink.community_members m join interlink.communities c on c.id=m.community_id where m.user_id=u and m.community_id=$2 and m.status='approved' and c.status='active')
$$;
create function interlink.blocked(a uuid,b uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from interlink.blocks where (user_id=a and blocked_id=b) or (user_id=b and blocked_id=a))
$$;
create function interlink.member(u uuid,p uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select interlink.active_user(u) and exists(select 1 from interlink.memberships m join interlink.projects p on p.id=m.project_id where m.user_id=u and m.project_id=$2 and m.active and interlink.community_access(u,p.community_id) and not p.hidden)
$$;
create function interlink.project_visible(u uuid,p uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from interlink.projects p where p.id=$2 and interlink.community_access(u,p.community_id) and not p.hidden and (p.owner_id=u or interlink.member(u,p.id) or (p.status<>'draft' and interlink.active_user(p.owner_id) and not interlink.blocked(u,p.owner_id))))
$$;
create function interlink.profile_visible(u uuid,p uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select u=p or exists(select 1 from interlink.profiles x where x.id=p and x.discoverable and not x.hidden and interlink.active_user(p) and interlink.community_access(u,x.community_id) and not interlink.blocked(u,p))
$$;
create function interlink.is_admin(u uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select interlink.active_user(u) and coalesce(auth.jwt()->>'aal','')='aal2' and exists(select 1 from interlink.admin_roles where user_id=u and role='admin')
$$;
create function interlink.require_admin(u uuid) returns void language plpgsql stable security definer set search_path=pg_catalog as $$
begin if not interlink.is_admin(u) then perform interlink.fail('FORBIDDEN'); end if; end $$;
create function interlink.rate(u uuid,a text,max_count integer,seconds integer default 60) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare b timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp())/seconds)*seconds); n integer;
begin
  insert into interlink.rate_limits(user_id,action,bucket,count) values(u,a,b,1)
  on conflict(user_id,action,bucket) do update set count=interlink.rate_limits.count+1 returning count into n;
  if n>max_count then perform interlink.fail('RATE_LIMITED'); end if;
end $$;
create function interlink.strings(v jsonb,max_count integer default 20,max_length integer default 40) returns text[] language plpgsql immutable set search_path=pg_catalog as $$
declare result text[];
begin
  if v is null then return '{}'; end if;
  if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>max_count then perform interlink.fail('VALIDATION'); end if;
  if exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and max_length) then perform interlink.fail('VALIDATION'); end if;
  select coalesce(array_agg(distinct value),'{}') into result from jsonb_array_elements_text(v);
  return result;
end $$;
create function interlink.emit(u uuid,s text,p uuid default null) returns void language sql security definer set search_path=pg_catalog as $$
  insert into public.change_events(user_id,scope,project_id) values(u,s,p)
$$;
create function interlink.emit_team(p uuid,s text default 'team') returns void language sql security definer set search_path=pg_catalog as $$
  insert into public.change_events(user_id,scope,project_id) select user_id,s,p from interlink.memberships where project_id=p and active
$$;
create function interlink.notify_user(u uuid,a uuid,t text,p uuid,title_text text) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare n uuid;
begin
  if u=a or not interlink.active_user(u) or interlink.blocked(u,a) then return; end if;
  if exists(select 1 from interlink.notification_preferences where user_id=u and ((t like 'application%' or t like 'invitation%') and not applications or t not like 'application%' and t not like 'invitation%' and not team)) then return; end if;
  insert into interlink.notifications(user_id,actor_id,type,title,project_id) values(u,a,t,title_text,p) returning id into n;
  insert into interlink.jobs(kind,user_id,notification_id,device_id,phase)
  select 'push',u,n,d.id,'send' from interlink.devices d join interlink.notification_preferences np on np.user_id=u where d.user_id=u and d.active and np.push;
  perform interlink.emit(u,'notifications',p);
end $$;
create function interlink.new_auth_user() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into interlink.accounts(id) values(new.id);
  insert into interlink.profiles(id) values(new.id);
  insert into interlink.notification_preferences(user_id) values(new.id);
  return new;
end $$;
create trigger interlink_auth_created after insert on auth.users for each row execute function interlink.new_auth_user();

create function public.interlink_event_allowed(event_user uuid,event_project uuid,event_scope text) returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select event_user=auth.uid() and interlink.active_user(auth.uid()) and (event_project is null or event_scope in ('notifications','membership') or interlink.member(auth.uid(),event_project))
$$;
create policy read_own_events on public.change_events for select to authenticated
using(public.interlink_event_allowed(user_id,project_id,scope));
revoke all on function public.interlink_event_allowed(uuid,uuid,text) from public,anon;
grant execute on function public.interlink_event_allowed(uuid,uuid,text) to authenticated;

do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='interlink' loop
    execute format('alter table interlink.%I enable row level security',t.tablename);
  end loop;
end $$;
revoke all on all tables in schema interlink from public,anon,authenticated;
revoke all on all functions in schema interlink from public,anon,authenticated;
alter default privileges in schema interlink revoke execute on functions from public;
alter default privileges in schema interlink revoke all on tables from public,anon,authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.change_events;
  end if;
end $$;
