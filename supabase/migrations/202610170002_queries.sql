create function interlink.profile_json(x interlink.profiles) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',x.id,'nickname',x.nickname,'avatar',x.avatar,'interests',x.interests,'roles',x.roles,'learningRoles',x.learning_roles,'skills',x.skills,'availability',x.availability,'activityMode',x.activity_mode,'bio',x.bio,'discoverable',x.discoverable,'communityId',x.community_id,'status',a.status,'links',x.links) from interlink.accounts a where a.id=x.id
$$;
create function interlink.project_json(x interlink.projects,u uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',x.id,'ownerId',x.owner_id,'communityId',x.community_id,'title',x.title,'goal',x.goal,'description',x.description,'interests',x.interests,'roles',x.roles,'capacity',x.capacity,'memberCount',(select count(*) from interlink.memberships where project_id=x.id and active),'activityMode',x.activity_mode,'availability',x.availability,'deadline',x.deadline,'beginnerFriendly',x.beginner_friendly,'status',x.status,'createdAt',x.created_at,'updatedAt',x.updated_at,'saved',exists(select 1 from interlink.saved_projects where project_id=x.id and user_id=u),'unreadCount',case when interlink.member(u,x.id) then (select count(*) from interlink.messages m where m.project_id=x.id and m.author_id<>u and not m.deleted and not m.hidden and not interlink.blocked(u,m.author_id) and (m.created_at,m.id)>(coalesce((select read_at from interlink.message_reads where project_id=x.id and user_id=u),'-infinity'),coalesce((select message_id from interlink.message_reads where project_id=x.id and user_id=u),'00000000-0000-0000-0000-000000000000'::uuid))) else 0 end)
$$;
create function interlink.membership_json(x interlink.memberships) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',x.id,'projectId',x.project_id,'userId',x.user_id,'role',x.role,'nickname',case when a.status in ('deleting','deleted') then '탈퇴한 팀원' else p.nickname end,'avatar',case when a.status in ('deleting','deleted') then 'lime' else p.avatar end,'active',x.active,'joinedAt',x.joined_at) from interlink.profiles p join interlink.accounts a on a.id=p.id where p.id=x.user_id
$$;
create function interlink.application_json(x interlink.applications) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',x.id,'projectId',x.project_id,'userId',x.user_id,'role',x.role,'introduction',x.introduction,'status',x.status,'createdAt',x.created_at,'nickname',p.nickname,'projectTitle',t.title) from interlink.profiles p,interlink.projects t where p.id=x.user_id and t.id=x.project_id
$$;
create function interlink.invitation_json(x interlink.invitations) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',x.id,'projectId',x.project_id,'inviterId',x.inviter_id,'inviteeId',x.invitee_id,'role',x.role,'message',x.message,'status',case when x.status='pending' and x.expires_at<=now() then 'expired' else x.status end,'expiresAt',x.expires_at,'createdAt',x.created_at,'nickname',p.nickname,'projectTitle',t.title) from interlink.profiles p,interlink.projects t where p.id=x.invitee_id and t.id=x.project_id
$$;
create function interlink.message_json(x interlink.messages) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',x.id,'projectId',x.project_id,'authorId',x.author_id,'authorName',case when a.status in ('deleting','deleted') then '탈퇴한 팀원' else p.nickname end,'body',case when x.deleted or x.hidden or interlink.blocked(auth.uid(),x.author_id) then '' else x.body end,'createdAt',x.created_at,'clientId',x.client_id,'deleted',x.deleted or x.hidden or interlink.blocked(auth.uid(),x.author_id)) from interlink.profiles p join interlink.accounts a on a.id=p.id where p.id=x.author_id
$$;
create function interlink.report_json(x interlink.reports) returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('id',x.id,'reporterId',x.reporter_id,'targetType',x.target_type,'targetId',x.target_id,'reason',x.reason,'detail',x.detail,'status',x.status,'createdAt',x.created_at)
$$;
create function interlink.community_json(x interlink.communities) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('id',x.id,'name',x.name,'status',x.status,'memberCount',(select count(*) from interlink.community_members where community_id=x.id and status='approved'))
$$;
create function interlink.reasons(i text[],r text[],a text[],v interlink.profiles) returns jsonb language sql immutable set search_path=pg_catalog as $$
  select coalesce(jsonb_agg(reason),'[]') from (
    select unnest(i) || ' 관심 분야 일치' reason where i && v.interests
    union all select unnest(r) || ' 역할 일치' where r && (v.roles || v.learning_roles)
    union all select unnest(a) || ' 참여 시간 일치' where a && v.availability
  ) x where reason in (
    select unnest(v.interests)||' 관심 분야 일치'
    union all select unnest(v.roles||v.learning_roles)||' 역할 일치'
    union all select unnest(v.availability)||' 참여 시간 일치'
  )
$$;
create function interlink.cursor(id uuid,at timestamptz,score integer default 0) returns jsonb language sql immutable set search_path=pg_catalog as $$
  select jsonb_build_object('_cursor',jsonb_build_object('id',id,'at',at,'score',score)::text)
$$;
create function interlink.page(rows jsonb,n integer) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare items jsonb; next text;
begin
  rows:=coalesce(rows,'[]');
  select coalesce(jsonb_agg(value-'_cursor' order by ordinality),'[]') into items from jsonb_array_elements(rows) with ordinality where ordinality<=n;
  if jsonb_array_length(rows)>n then next:=rows->(n-1)->>'_cursor'; end if;
  return jsonb_build_object('items',items,'nextCursor',next);
end $$;

create function public.interlink_query(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  u uuid; p uuid; target uuid; n integer; cur jsonb; at_time timestamptz; cid uuid; score integer;
  rows jsonb; result jsonb; viewer interlink.profiles; project interlink.projects; report interlink.reports;
begin
  if jsonb_typeof(payload)<>'object' or octet_length(payload::text)>16000 then perform interlink.fail('VALIDATION'); end if;
  u:=interlink.actor(operation not in ('bootstrap','account.status'));
  perform interlink.rate(u,'query',180);
  n:=greatest(1,least(50,coalesce((payload->>'limit')::integer,20)));
  cur:=coalesce(nullif(payload->>'cursor','')::jsonb,'{}');
  at_time:=coalesce((cur->>'at')::timestamptz,'infinity');
  cid:=coalesce((cur->>'id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff');
  score:=coalesce((cur->>'score')::integer,2147483647);
  select * into viewer from interlink.profiles where id=u;
  if operation like 'admin.%' then perform interlink.require_admin(u); end if;

  case operation
  when 'bootstrap' then
    return jsonb_build_object('viewer',interlink.profile_json(viewer),'community',(select interlink.community_json(c) from interlink.communities c where id=viewer.community_id and interlink.community_access(u,id)),'unreadCount',(select count(*) from interlink.notifications where user_id=u and not read and (actor_id is null or not interlink.blocked(u,actor_id))),
      'messageUnreadCount',(select count(*) from interlink.memberships m
        join interlink.messages msg on msg.project_id=m.project_id
        left join interlink.message_reads r on r.project_id=m.project_id and r.user_id=u
        where m.user_id=u and m.active and interlink.member(u,m.project_id)
          and msg.author_id<>u and not msg.deleted and not msg.hidden and not interlink.blocked(u,msg.author_id)
          and (msg.created_at,msg.id)>(coalesce(r.read_at,'-infinity'),coalesce(r.message_id,'00000000-0000-0000-0000-000000000000'::uuid))));
  when 'account.status' then
    return (select jsonb_strip_nulls(jsonb_build_object('status',a.status,'deletionRequestId',d.id,'deletionStatus',d.status,'reason',d.reason)) from interlink.accounts a left join interlink.deletion_requests d on d.user_id=a.id where a.id=u);
  when 'projects.search' then
    perform interlink.rate(u,'search',60);
    select jsonb_agg(obj order by s desc,sort_at desc,id desc) into rows from (
      select interlink.project_json(x.core,u)||jsonb_build_object('reasons',reasons)||interlink.cursor(id,sort_at,s) obj,s,sort_at,id from (
        select x as core,x.*,case when payload->>'sort'='deadline' then timestamptz '2000-01-01'-(x.deadline-timestamptz '2000-01-01') else x.created_at end sort_at,interlink.reasons(x.interests,x.roles,x.availability,viewer) reasons,
          case when coalesce(payload->>'sort','recommended')='recommended' then jsonb_array_length(interlink.reasons(x.interests,x.roles,x.availability,viewer)) else 0 end s
        from interlink.projects x
        where interlink.project_visible(u,x.id) and interlink.active_user(x.owner_id) and not interlink.blocked(u,x.owner_id) and x.status not in ('draft','archived')
          and (x.status<>'recruiting' or x.deadline>now())
          and x.status=coalesce(payload->>'status','recruiting')
          and (x.status<>'recruiting' or (select count(*) from interlink.memberships where project_id=x.id and active)<x.capacity)
          and (not(payload?'search') or x.title||' '||x.goal||' '||x.description ilike '%'||(payload->>'search')||'%')
          and (not(payload?'interests') or cardinality(interlink.strings(payload->'interests'))=0 or x.interests && interlink.strings(payload->'interests'))
          and (not(payload?'roles') or cardinality(interlink.strings(payload->'roles'))=0 or x.roles && interlink.strings(payload->'roles'))
          and (not(payload?'availability') or cardinality(interlink.strings(payload->'availability'))=0 or x.availability && interlink.strings(payload->'availability'))
          and (not(payload?'activityMode') or x.activity_mode=payload->>'activityMode')
          and (not(payload?'beginnerFriendly') or x.beginner_friendly=(payload->>'beginnerFriendly')::boolean)
      ) x where (s,sort_at,id)<(score,at_time,cid) order by s desc,sort_at desc,id desc limit n+1
    ) t;
  when 'projects.detail' then
    p:=(payload->>'id')::uuid;
    if not interlink.project_visible(u,p) then perform interlink.fail('NOT_FOUND'); end if;
    select * into project from interlink.projects where id=p;
    return jsonb_build_object('project',interlink.project_json(project,u),
      'members',(select coalesce(jsonb_agg(interlink.membership_json(m) order by joined_at),'[]') from interlink.memberships m where project_id=p and active),
      'application',(select interlink.application_json(a) from interlink.applications a where project_id=p and user_id=u order by created_at desc limit 1),
      'invitation',(select interlink.invitation_json(i) from interlink.invitations i where project_id=p and invitee_id=u order by created_at desc limit 1));
  when 'people.search' then
    perform interlink.rate(u,'search',60);
    select jsonb_agg(obj order by s desc,updated_at desc,id desc) into rows from (
      select interlink.profile_json(x.core)||jsonb_build_object('reasons',reasons)||interlink.cursor(id,updated_at,s) obj,s,updated_at,id from (
        select t as core,t.*,interlink.reasons(t.interests,t.roles,t.availability,viewer) reasons,
          case when coalesce(payload->>'sort','recommended')='recommended' then jsonb_array_length(interlink.reasons(t.interests,t.roles,t.availability,viewer)) else 0 end s
        from interlink.profiles t where id<>u and interlink.profile_visible(u,id)
          and (not(payload?'search') or nickname||' '||bio ilike '%'||(payload->>'search')||'%')
          and (not(payload?'interests') or cardinality(interlink.strings(payload->'interests'))=0 or interests && interlink.strings(payload->'interests'))
          and (not(payload?'roles') or cardinality(interlink.strings(payload->'roles'))=0 or (roles||learning_roles) && interlink.strings(payload->'roles'))
          and (not(payload?'availability') or cardinality(interlink.strings(payload->'availability'))=0 or availability && interlink.strings(payload->'availability'))
          and (not(payload?'activityMode') or activity_mode=payload->>'activityMode')
      ) x where (s,updated_at,id)<(score,at_time,cid) order by s desc,updated_at desc,id desc limit n+1
    ) y;
  when 'people.detail' then
    target:=(payload->>'id')::uuid;
    if not interlink.profile_visible(u,target) then perform interlink.fail('NOT_FOUND'); end if;
    return (select interlink.profile_json(x) from interlink.profiles x where id=target);
  when 'teams.mine','saved.list' then
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select interlink.project_json(x,u)||interlink.cursor(id,created_at) obj,created_at,id from interlink.projects x
      where interlink.project_visible(u,id) and (created_at,id)<(at_time,cid)
        and ((operation='teams.mine' and exists(select 1 from interlink.memberships where project_id=x.id and user_id=u and active)) or (operation='saved.list' and exists(select 1 from interlink.saved_projects where project_id=x.id and user_id=u)))
      order by created_at desc,id desc limit n+1
    ) t;
  when 'teams.history' then
    -- Prior participation permits choosing an experience project, not renewed
    -- membership, a private project description, or access to its conversation.
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select jsonb_build_object('id',x.id,'ownerId',x.owner_id,'communityId',x.community_id,
        'title',x.title,'goal','','description','','interests','[]'::jsonb,'roles','[]'::jsonb,
        'capacity',x.capacity,'memberCount',0,'activityMode',x.activity_mode,'availability','[]'::jsonb,
        'deadline',x.deadline,'beginnerFriendly',x.beginner_friendly,'status',x.status,
        'createdAt',x.created_at,'updatedAt',x.updated_at,'saved',false,'unreadCount',0)
        ||interlink.cursor(x.id,x.created_at) obj,x.created_at,x.id
      from interlink.projects x
      where exists(select 1 from interlink.memberships m where m.project_id=x.id and m.user_id=u)
        and interlink.community_access(u,x.community_id) and not x.hidden and not interlink.blocked(u,x.owner_id)
        and (x.created_at,x.id)<(at_time,cid)
      order by x.created_at desc,x.id desc limit n+1
    ) t;
  when 'teams.members' then
    p:=(payload->>'projectId')::uuid;
    if not interlink.member(u,p) then perform interlink.fail('FORBIDDEN'); end if;
    select jsonb_agg(obj order by joined_at desc,id desc) into rows from (
      select interlink.membership_json(m)||interlink.cursor(id,joined_at) obj,joined_at,id from interlink.memberships m where project_id=p and active and (joined_at,id)<(at_time,cid) order by joined_at desc,id desc limit n+1
    ) t;
  when 'applications.list' then
    p:=(payload->>'projectId')::uuid;
    if p is not null and not exists(select 1 from interlink.projects where id=p and owner_id=u and interlink.community_access(u,community_id)) then perform interlink.fail('FORBIDDEN'); end if;
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select interlink.application_json(a)||interlink.cursor(id,created_at) obj,created_at,id from interlink.applications a
      where (p is null and (user_id=u or exists(select 1 from interlink.projects owned where owned.id=a.project_id and owned.owner_id=u and interlink.community_access(u,owned.community_id))) or project_id=p) and (created_at,id)<(at_time,cid) order by created_at desc,id desc limit n+1
    ) t;
  when 'invitations.list' then
    p:=(payload->>'projectId')::uuid;
    if p is not null and not exists(select 1 from interlink.projects where id=p and owner_id=u and interlink.community_access(u,community_id)) then perform interlink.fail('FORBIDDEN'); end if;
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select interlink.invitation_json(i)||interlink.cursor(id,created_at) obj,created_at,id from interlink.invitations i
      where (p is null and (invitee_id=u or inviter_id=u or exists(select 1 from interlink.projects owned where owned.id=i.project_id and owned.owner_id=u and interlink.community_access(u,owned.community_id))) or project_id=p) and (created_at,id)<(at_time,cid) order by created_at desc,id desc limit n+1
    ) t;
  when 'messages.list' then
    p:=(payload->>'projectId')::uuid;
    if not interlink.member(u,p) then perform interlink.fail('FORBIDDEN'); end if;
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select interlink.message_json(m)||interlink.cursor(id,created_at) obj,created_at,id from interlink.messages m where project_id=p and (created_at,id)<(at_time,cid) order by created_at desc,id desc limit n+1
    ) t;
  when 'notifications.list' then
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select jsonb_strip_nulls(jsonb_build_object('id',id,'userId',user_id,'type',type,'title',title,'projectId',project_id,'read',read,'createdAt',created_at))||interlink.cursor(id,created_at) obj,created_at,id
      from interlink.notifications where user_id=u and (actor_id is null or not interlink.blocked(u,actor_id)) and (created_at,id)<(at_time,cid) order by created_at desc,id desc limit n+1
    ) t;
  when 'notifications.preferences' then
    return (select jsonb_build_object('push',push,'team',team,'applications',applications) from interlink.notification_preferences where user_id=u);
  when 'experiences.list' then
    target:=coalesce((payload->>'userId')::uuid,u);
    if not interlink.profile_visible(u,target) then perform interlink.fail('NOT_FOUND'); end if;
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select jsonb_build_object('id',id,'userId',user_id,'projectId',project_id,'title',title,'description',description,'role',role,'isPublic',is_public,'createdAt',created_at)||interlink.cursor(id,created_at) obj,created_at,id
      from interlink.experiences where user_id=target and (target=u or is_public) and (created_at,id)<(at_time,cid) order by created_at desc,id desc limit n+1
    ) t;
  when 'blocks.list' then
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select jsonb_build_object('id',b.id,'blockedId',b.blocked_id,'nickname',p.nickname,'createdAt',b.created_at)||interlink.cursor(b.id,b.created_at) obj,b.created_at,b.id
      from interlink.blocks b join interlink.profiles p on p.id=b.blocked_id where b.user_id=u and (b.created_at,b.id)<(at_time,cid) order by b.created_at desc,b.id desc limit n+1
    ) t;
  when 'admin.session' then return jsonb_build_object('userId',u,'role','admin','mfa',true);
  when 'admin.overview' then
    return jsonb_build_object('reports',(select count(*) from interlink.reports where status in ('open','reviewing')),'users',(select count(*) from interlink.accounts where status='active'),'projects',(select count(*) from interlink.projects),'failedJobs',(select count(*) from interlink.jobs where status='failed'));
  when 'admin.reports' then
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select interlink.report_json(r)||interlink.cursor(id,created_at) obj,created_at,id from interlink.reports r where (not(payload?'status') or status=payload->>'status') and (created_at,id)<(at_time,cid) order by created_at desc,id desc limit n+1
    ) t;
  when 'admin.report' then
    select * into report from interlink.reports where id=(payload->>'id')::uuid;
    if report.id is null then perform interlink.fail('NOT_FOUND'); end if;
    insert into interlink.audit(actor_id,action,target_id,note) values(u,'report.view',report.id,'신고 증거 조회');
    return interlink.report_json(report)||jsonb_build_object('content',(select content from interlink.report_evidence where report_id=report.id));
  when 'admin.audit' then
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select jsonb_build_object('id',id,'actorId',actor_id,'action',action,'targetId',target_id,'note',note,'createdAt',created_at)||interlink.cursor(id,created_at) obj,created_at,id from interlink.audit where (created_at,id)<(at_time,cid) order by created_at desc,id desc limit n+1
    ) t;
  when 'admin.jobs' then
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select jsonb_build_object('id',id,'kind',kind,'status',status,'attempts',attempts,'nextAttemptAt',next_attempt_at,'lastError',last_error)||interlink.cursor(id,created_at) obj,created_at,id from interlink.jobs where (created_at,id)<(at_time,cid) order by created_at desc,id desc limit n+1
    ) t;
  when 'admin.communities' then
    select jsonb_agg(obj order by created_at desc,id desc) into rows from (
      select interlink.community_json(c)||interlink.cursor(id,created_at) obj,created_at,id from interlink.communities c where (created_at,id)<(at_time,cid) order by created_at desc,id desc limit n+1
    ) t;
  else perform interlink.fail('VALIDATION');
  end case;
  return interlink.page(rows,n);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or null_value_not_allowed then perform interlink.fail('VALIDATION');
  when others then
    if sqlstate='P0001' and sqlerrm in ('CONFIGURATION','UNAUTHENTICATED','FORBIDDEN','VALIDATION','NOT_FOUND','CLOSED','FULL','DUPLICATE','RATE_LIMITED','NETWORK','UNAVAILABLE','CONFLICT') then raise; end if;
    perform interlink.fail('UNAVAILABLE');
end $$;
revoke all on function public.interlink_query(text,jsonb) from public,anon;
grant execute on function public.interlink_query(text,jsonb) to authenticated;
revoke all on all functions in schema interlink from public,anon,authenticated;
