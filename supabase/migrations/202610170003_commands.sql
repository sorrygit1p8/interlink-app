create function interlink.project_lock(p uuid) returns interlink.projects language plpgsql security definer set search_path=pg_catalog as $$
declare x interlink.projects;
begin select * into x from interlink.projects where id=p for update; if x.id is null then perform interlink.fail('NOT_FOUND'); end if; return x; end $$;
create function interlink.owner(u uuid,x interlink.projects) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin if x.owner_id<>u or not interlink.community_access(u,x.community_id) or x.hidden then perform interlink.fail('FORBIDDEN'); end if; end $$;
create function interlink.recruitable(x interlink.projects,u uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  if not interlink.community_access(u,x.community_id) or not interlink.active_user(x.owner_id) or x.hidden or interlink.blocked(u,x.owner_id) then perform interlink.fail('FORBIDDEN'); end if;
  if x.status<>'recruiting' or x.deadline<=now() then perform interlink.fail('CLOSED'); end if;
end $$;
create function interlink.add_member(x interlink.projects,u uuid,member_role text) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  -- Every admission locks the same project before inspecting the count.
  perform 1 from interlink.accounts where id=u for share;
  perform 1 from interlink.projects where id=x.id for update;
  perform interlink.recruitable(x,u);
  if exists(select 1 from interlink.memberships where project_id=x.id and user_id=u and active) then perform interlink.fail('DUPLICATE'); end if;
  if (select count(*) from interlink.memberships where project_id=x.id and active)>=x.capacity then perform interlink.fail('FULL'); end if;
  insert into interlink.memberships(project_id,user_id,role) values(x.id,u,member_role)
  on conflict(project_id,user_id) do update set active=true,role=excluded.role,joined_at=now(),left_at=null;
  update interlink.applications set status='withdrawn',updated_at=now() where project_id=x.id and user_id=u and status='pending';
  update interlink.invitations set status='cancelled',updated_at=now() where project_id=x.id and invitee_id=u and status='pending';
  perform interlink.emit_team(x.id,'membership');
end $$;
create function interlink.membership_capacity() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare cap integer;
begin
  if new.active and (tg_op='INSERT' or not old.active) then
    select capacity into cap from interlink.projects where id=new.project_id for update;
    if (select count(*) from interlink.memberships where project_id=new.project_id and active and id<>new.id)>=cap then perform interlink.fail('FULL'); end if;
  end if;
  return new;
end $$;
create trigger membership_capacity_guard before insert or update of active on interlink.memberships for each row execute function interlink.membership_capacity();
create function interlink.transition(x interlink.projects,new_status text) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  if new_status=x.status then return; end if;
  if not ((x.status='draft' and new_status in ('recruiting','archived')) or (x.status='recruiting' and new_status in ('active','archived')) or (x.status='active' and new_status in ('completed','archived')) or (x.status='completed' and new_status='archived')) then perform interlink.fail('CONFLICT'); end if;
  if new_status='recruiting' and x.deadline<=now() then perform interlink.fail('VALIDATION'); end if;
  update interlink.projects set status=new_status,updated_at=now() where id=x.id;
  if new_status<>'recruiting' then
    update interlink.applications set status='rejected',updated_at=now() where project_id=x.id and status='pending';
    update interlink.invitations set status='cancelled',updated_at=now() where project_id=x.id and status='pending';
  end if;
  perform interlink.emit_team(x.id,'team');
end $$;
create function interlink.input_keys(v jsonb,keys text[]) returns void language plpgsql immutable set search_path=pg_catalog as $$
begin if v-keys<>'{}'::jsonb then perform interlink.fail('VALIDATION'); end if; end $$;

create function public.interlink_command(operation text,payload jsonb,idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  u uuid; p uuid; target uuid; result_id uuid; result_status text; result jsonb; saved interlink.idempotency;
  x interlink.projects; a interlink.applications; invitation interlink.invitations; msg interlink.messages;
  ci interlink.community_invites; profile interlink.profiles; deletion interlink.deletion_requests;
  item record; txt text; content_text text; desired text; community uuid; count_members integer; authenticated_at timestamptz; required_fields text[];
begin
  if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>20000 or idempotency_key is null then perform interlink.fail('VALIDATION'); end if;
  required_fields:=case operation
    when 'profile.update' then array['nickname','avatar','interests','roles','learningRoles','skills','availability','activityMode','bio','discoverable','links']
    when 'project.create' then array['title','goal','description','interests','roles','capacity','activityMode','availability','deadline','beginnerFriendly']
    when 'project.update' then array['id','title','goal','description','interests','roles','capacity','activityMode','availability','deadline','beginnerFriendly']
    when 'project.transition' then array['id','status'] when 'project.save' then array['id','saved']
    when 'application.submit' then array['projectId','role','introduction'] when 'application.withdraw' then array['id'] when 'application.review' then array['id','decision']
    when 'invitation.send' then array['projectId','inviteeId','role','message'] when 'invitation.respond' then array['id','decision'] when 'invitation.cancel' then array['id']
    when 'membership.leave' then array['projectId'] when 'membership.remove' then array['projectId','userId'] when 'membership.transfer' then array['projectId','userId']
    when 'message.send' then array['projectId','body','clientId'] when 'message.delete' then array['id'] when 'message.read' then array['projectId','messageId']
    when 'notification.read' then array['id'] when 'notification.preferences' then array['push','team','applications']
    when 'device.register' then array['token','platform'] when 'device.unregister' then array['token']
    when 'report.create' then array['targetType','targetId','reason','detail'] when 'block.set' then array['userId','blocked']
    when 'experience.save' then array['projectId','title','description','role','isPublic'] when 'experience.delete' then array['id']
    when 'account.delete' then array['confirmation','ownedTeams'] when 'community.join' then array['code']
    when 'admin.action' then array['targetType','targetId','action','note'] when 'admin.community' then array['name','status']
    when 'admin.invite' then array['communityId','maxUses','expiresAt'] when 'admin.job.retry' then array['id','note']
    else null end;
  if required_fields is null or not(payload ?& required_fields) then perform interlink.fail('VALIDATION'); end if;
  for item in select key,value from jsonb_each(payload) loop
    if jsonb_typeof(item.value)<>(case
      when item.key in ('beginnerFriendly','saved','discoverable','push','team','applications','blocked','isPublic') then 'boolean'
      when item.key in ('capacity','maxUses') then 'number'
      when item.key in ('interests','roles','learningRoles','skills','availability','links') then 'array'
      else 'string' end) then perform interlink.fail('VALIDATION'); end if;
  end loop;
  u:=interlink.actor(operation not in ('account.delete','device.unregister'));
  -- Hold the account lock until commit: deletion/suspension cannot be overtaken by
  -- an already-authorized command that resumes after a separate lock wait.
  if operation='account.delete' then perform 1 from interlink.accounts where id=u for update;
  else perform 1 from interlink.accounts where id=u for share; end if;
  u:=interlink.actor(operation not in ('account.delete','device.unregister'));
  -- Cached admin results can contain invitation codes. Recheck current role and
  -- MFA before replaying them, just as for a newly executed admin command.
  if operation like 'admin.%' then perform interlink.require_admin(u); end if;
  -- Unique per actor, not per command: key reuse with different intent is a conflict.
  insert into interlink.idempotency(user_id,key,operation,payload_hash) values(u,idempotency_key,operation,extensions.digest(payload::text,'sha256')) on conflict do nothing;
  select * into saved from interlink.idempotency where user_id=u and key=idempotency_key for update;
  if saved.operation<>operation or saved.payload_hash<>extensions.digest(payload::text,'sha256') then perform interlink.fail('CONFLICT'); end if;
  if saved.response is not null then return saved.response; end if;
  perform interlink.rate(u,'command',120);
  case operation
  when 'profile.update' then
    perform interlink.input_keys(payload,array['nickname','avatar','interests','roles','learningRoles','skills','availability','activityMode','bio','discoverable','links']);
    txt:=payload->>'avatar';
    if txt is null or not (txt~'^[a-z][a-z0-9_-]{0,29}$' or (txt like u::text||'/%' and exists(select 1 from storage.objects where bucket_id='avatars' and name=txt))) then perform interlink.fail('VALIDATION'); end if;
    if exists(select 1 from unnest(interlink.strings(payload->'links',3,1000)) l where l !~ '^https?://[^[:space:]/]+') then perform interlink.fail('VALIDATION'); end if;
    update interlink.profiles set nickname=btrim(payload->>'nickname'),avatar=txt,interests=interlink.strings(payload->'interests'),roles=interlink.strings(payload->'roles'),learning_roles=interlink.strings(payload->'learningRoles'),skills=interlink.strings(payload->'skills'),availability=interlink.strings(payload->'availability'),activity_mode=payload->>'activityMode',bio=btrim(payload->>'bio'),discoverable=(payload->>'discoverable')::boolean,links=interlink.strings(payload->'links',3,1000),updated_at=now() where id=u;
    result_id:=u; perform interlink.emit(u,'profile');
  when 'project.create','project.update' then
    perform interlink.input_keys(payload,array['id','title','goal','description','interests','roles','capacity','activityMode','availability','deadline','beginnerFriendly','status']);
    if cardinality(interlink.strings(payload->'interests'))=0 or cardinality(interlink.strings(payload->'roles'))=0 or cardinality(interlink.strings(payload->'availability'))=0 then perform interlink.fail('VALIDATION'); end if;
    if operation='project.create' then
      perform interlink.rate(u,'project.create',5,3600);
      select community_id into community from interlink.profiles where id=u;
      if not interlink.community_access(u,community) then perform interlink.fail('FORBIDDEN'); end if;
      desired:=coalesce(payload->>'status','recruiting');
      if desired not in ('draft','recruiting') or (payload->>'deadline')::timestamptz<=now() then perform interlink.fail('VALIDATION'); end if;
      insert into interlink.projects(owner_id,community_id,title,goal,description,interests,roles,capacity,activity_mode,availability,deadline,beginner_friendly,status)
      values(u,community,btrim(payload->>'title'),btrim(payload->>'goal'),btrim(payload->>'description'),interlink.strings(payload->'interests'),interlink.strings(payload->'roles'),(payload->>'capacity')::integer,payload->>'activityMode',interlink.strings(payload->'availability'),(payload->>'deadline')::timestamptz,(payload->>'beginnerFriendly')::boolean,desired) returning id into result_id;
      insert into interlink.memberships(project_id,user_id,role) values(result_id,u,'팀장');
    else
      x:=interlink.project_lock((payload->>'id')::uuid); perform interlink.owner(u,x);
      if x.status in ('completed','archived') then perform interlink.fail('CLOSED'); end if;
      if (select count(*) from interlink.memberships where project_id=x.id and active)>(payload->>'capacity')::integer then perform interlink.fail('FULL'); end if;
      if payload?'status' and payload->>'status'<>x.status then perform interlink.fail('CONFLICT'); end if;
      if x.status in ('draft','recruiting') and (payload->>'deadline')::timestamptz<=now() then perform interlink.fail('VALIDATION'); end if;
      update interlink.projects set title=btrim(payload->>'title'),goal=btrim(payload->>'goal'),description=btrim(payload->>'description'),interests=interlink.strings(payload->'interests'),roles=interlink.strings(payload->'roles'),capacity=(payload->>'capacity')::integer,activity_mode=payload->>'activityMode',availability=interlink.strings(payload->'availability'),deadline=(payload->>'deadline')::timestamptz,beginner_friendly=(payload->>'beginnerFriendly')::boolean,updated_at=now() where id=x.id;
      result_id:=x.id;
    end if;
    perform interlink.emit_team(result_id,'projects');
  when 'project.transition' then
    perform interlink.input_keys(payload,array['id','status']);
    x:=interlink.project_lock((payload->>'id')::uuid); perform interlink.owner(u,x);
    perform interlink.transition(x,payload->>'status'); result_id:=x.id; result_status:=payload->>'status';
    for item in select user_id from interlink.memberships where project_id=x.id and active and user_id<>u loop perform interlink.notify_user(item.user_id,u,'team.updated',x.id,'팀의 활동 상태가 변경되었어요'); end loop;
  when 'project.save' then
    perform interlink.input_keys(payload,array['id','saved']); p:=(payload->>'id')::uuid;
    if not interlink.project_visible(u,p) then perform interlink.fail('NOT_FOUND'); end if;
    if (payload->>'saved')::boolean then insert into interlink.saved_projects(project_id,user_id) values(p,u) on conflict do nothing; else delete from interlink.saved_projects where project_id=p and user_id=u; end if;
    result_id:=p; perform interlink.emit(u,'saved',p);
  when 'application.submit' then
    perform interlink.input_keys(payload,array['projectId','role','introduction']); perform interlink.rate(u,'application.submit',10,3600);
    if length(btrim(payload->>'introduction')) not between 5 and 500 then perform interlink.fail('VALIDATION'); end if;
    x:=interlink.project_lock((payload->>'projectId')::uuid); perform interlink.recruitable(x,u);
    if not (btrim(payload->>'role')=any(x.roles)) then perform interlink.fail('VALIDATION'); end if;
    if x.owner_id=u or exists(select 1 from interlink.memberships where project_id=x.id and user_id=u and active) then perform interlink.fail('DUPLICATE'); end if;
    if exists(select 1 from interlink.invitations where project_id=x.id and invitee_id=u and status='pending' and expires_at>now()) then perform interlink.fail('DUPLICATE'); end if;
    if (select count(*) from interlink.memberships where project_id=x.id and active)>=x.capacity then perform interlink.fail('FULL'); end if;
    insert into interlink.applications(project_id,user_id,role,introduction) values(x.id,u,btrim(payload->>'role'),btrim(payload->>'introduction')) returning id into result_id;
    result_status:='pending'; perform interlink.notify_user(x.owner_id,u,'application.new',x.id,'새로운 참여 신청이 도착했어요'); perform interlink.emit(x.owner_id,'applications',x.id);
  when 'application.withdraw','application.review' then
    perform interlink.input_keys(payload,array['id','decision']);
    if operation='application.review' then
      select user_id into target from interlink.applications where id=(payload->>'id')::uuid;
      perform 1 from interlink.accounts where id=target for share;
    end if;
    select project_id into p from interlink.applications where id=(payload->>'id')::uuid;
    x:=interlink.project_lock(p);
    select * into a from interlink.applications where id=(payload->>'id')::uuid for update;
    if a.status<>'pending' then perform interlink.fail('CONFLICT'); end if;
    if operation='application.withdraw' then
      if a.user_id<>u then perform interlink.fail('FORBIDDEN'); end if; desired:='withdrawn';
    else
      perform interlink.owner(u,x); desired:=payload->>'decision';
      if desired not in ('approved','rejected') then perform interlink.fail('VALIDATION'); end if;
      if desired='approved' then perform interlink.add_member(x,a.user_id,a.role); end if;
      perform interlink.notify_user(a.user_id,u,'application.'||desired,x.id,case when desired='approved' then '참여 신청이 승인되었어요' else '참여 신청 결과를 확인해 주세요' end);
    end if;
    update interlink.applications set status=desired,updated_at=now() where id=a.id;
    result_id:=a.id; result_status:=desired; perform interlink.emit(a.user_id,'applications',x.id); perform interlink.emit(x.owner_id,'applications',x.id);
  when 'invitation.send' then
    perform interlink.input_keys(payload,array['projectId','inviteeId','role','message']); perform interlink.rate(u,'invitation.send',15,3600);
    target:=(payload->>'inviteeId')::uuid; perform 1 from interlink.accounts where id=target for share;
    x:=interlink.project_lock((payload->>'projectId')::uuid); perform interlink.owner(u,x);
    target:=(payload->>'inviteeId')::uuid; perform interlink.recruitable(x,target);
    if not (btrim(payload->>'role')=any(x.roles)) then perform interlink.fail('VALIDATION'); end if;
    if target=u or not interlink.profile_visible(u,target) then perform interlink.fail('FORBIDDEN'); end if;
    if exists(select 1 from interlink.memberships where project_id=x.id and user_id=target and active) or exists(select 1 from interlink.applications where project_id=x.id and user_id=target and status='pending') then perform interlink.fail('DUPLICATE'); end if;
    if (select count(*) from interlink.memberships where project_id=x.id and active)>=x.capacity then perform interlink.fail('FULL'); end if;
    update interlink.invitations set status='expired',updated_at=now() where project_id=x.id and invitee_id=target and status='pending' and expires_at<=now();
    insert into interlink.invitations(project_id,inviter_id,invitee_id,role,message,expires_at) values(x.id,u,target,btrim(payload->>'role'),btrim(payload->>'message'),least(x.deadline,now()+interval '7 days')) returning id into result_id;
    result_status:='pending'; perform interlink.notify_user(target,u,'invitation.new',x.id,'새로운 팀 초대가 도착했어요'); perform interlink.emit(target,'invitations',x.id);
  when 'invitation.respond','invitation.cancel' then
    perform interlink.input_keys(payload,array['id','decision']);
    select project_id into p from interlink.invitations where id=(payload->>'id')::uuid; x:=interlink.project_lock(p);
    select * into invitation from interlink.invitations where id=(payload->>'id')::uuid for update;
    if invitation.status<>'pending' then perform interlink.fail('CONFLICT'); end if;
    if operation='invitation.cancel' then perform interlink.owner(u,x); desired:='cancelled';
    else
      if invitation.invitee_id<>u then perform interlink.fail('FORBIDDEN'); end if;
      if invitation.expires_at<=now() then perform interlink.fail('CLOSED'); end if;
      desired:=payload->>'decision'; if desired not in ('accepted','declined') then perform interlink.fail('VALIDATION'); end if;
      if desired='accepted' then perform interlink.add_member(x,u,invitation.role); end if;
      perform interlink.notify_user(x.owner_id,u,'invitation.'||desired,x.id,case when desired='accepted' then '팀 초대가 수락되었어요' else '팀 초대 결과를 확인해 주세요' end);
    end if;
    update interlink.invitations set status=desired,updated_at=now() where id=invitation.id;
    result_id:=invitation.id; result_status:=desired; perform interlink.emit(invitation.invitee_id,'invitations',x.id); perform interlink.emit(x.owner_id,'invitations',x.id);
  when 'membership.leave','membership.remove','membership.transfer' then
    perform interlink.input_keys(payload,array['projectId','userId']);
    target:=case when operation='membership.leave' then u else (payload->>'userId')::uuid end;
    if operation='membership.transfer' then perform 1 from interlink.accounts where id=target for share; end if;
    x:=interlink.project_lock((payload->>'projectId')::uuid);
    target:=case when operation='membership.leave' then u else (payload->>'userId')::uuid end;
    if operation<>'membership.leave' then perform interlink.owner(u,x); end if;
    if not exists(select 1 from interlink.memberships where project_id=x.id and user_id=target and active) then perform interlink.fail('NOT_FOUND'); end if;
    if operation='membership.transfer' then
      if target=u or not interlink.community_access(target,x.community_id) or interlink.blocked(u,target) then perform interlink.fail('FORBIDDEN'); end if;
      update interlink.projects set owner_id=target,updated_at=now() where id=x.id;
      update interlink.memberships set role=case when user_id=target then '팀장' else '팀원' end where project_id=x.id and user_id in (u,target);
      result_status:='transferred';
    else
      if target=x.owner_id and x.status<>'archived' then perform interlink.fail('CONFLICT'); end if;
      if operation='membership.remove' and target=u then perform interlink.fail('FORBIDDEN'); end if;
      update interlink.memberships set active=false,left_at=now() where project_id=x.id and user_id=target;
      result_status:='left';
      perform interlink.emit(target,'membership',x.id);
    end if;
    result_id:=x.id; perform interlink.emit_team(x.id,'membership');
    perform interlink.notify_user(case when operation='membership.leave' then x.owner_id else target end,u,'team.membership',x.id,'팀 멤버 구성이 변경되었어요');
  when 'message.send' then
    perform interlink.input_keys(payload,array['projectId','body','clientId']); perform interlink.rate(u,'message.send',40);
    x:=interlink.project_lock((payload->>'projectId')::uuid);
    if not interlink.member(u,x.id) then perform interlink.fail('FORBIDDEN'); end if;
    if x.status not in ('recruiting','active') then perform interlink.fail('CLOSED'); end if;
    select * into msg from interlink.messages where author_id=u and client_id=(payload->>'clientId')::uuid;
    if msg.id is not null then
      if msg.project_id<>x.id or (not msg.deleted and msg.body<>btrim(payload->>'body')) then perform interlink.fail('CONFLICT'); end if;
      result_id:=msg.id;
    else
      insert into interlink.messages(project_id,author_id,body,client_id) values(x.id,u,btrim(payload->>'body'),(payload->>'clientId')::uuid) returning id into result_id;
      perform interlink.emit_team(x.id,'messages');
    end if;
    result_status:='sent';
  when 'message.delete' then
    perform interlink.input_keys(payload,array['id']);
    select * into msg from interlink.messages where id=(payload->>'id')::uuid for update;
    if msg.id is null then perform interlink.fail('NOT_FOUND'); end if;
    if msg.author_id<>u or not interlink.member(u,msg.project_id) then perform interlink.fail('FORBIDDEN'); end if;
    update interlink.messages set body='',deleted=true where id=msg.id;
    result_id:=msg.id; result_status:='deleted'; perform interlink.emit_team(msg.project_id,'messages');
  when 'message.read' then
    perform interlink.input_keys(payload,array['projectId','messageId']); p:=(payload->>'projectId')::uuid;
    if not interlink.member(u,p) then perform interlink.fail('FORBIDDEN'); end if;
    select * into msg from interlink.messages where id=(payload->>'messageId')::uuid and project_id=p;
    if msg.id is null then perform interlink.fail('NOT_FOUND'); end if;
    insert into interlink.message_reads(project_id,user_id,message_id,read_at) values(p,u,msg.id,msg.created_at)
      on conflict(project_id,user_id) do update set message_id=excluded.message_id,read_at=excluded.read_at where (excluded.read_at,excluded.message_id)>=(interlink.message_reads.read_at,interlink.message_reads.message_id);
    result_id:=msg.id; perform interlink.emit(u,'messages',p);
  when 'notification.read' then
    perform interlink.input_keys(payload,array['id']);
    update interlink.notifications set read=true where id=(payload->>'id')::uuid and user_id=u returning id into result_id;
    if result_id is null then perform interlink.fail('NOT_FOUND'); end if; perform interlink.emit(u,'notifications');
  when 'notification.preferences' then
    perform interlink.input_keys(payload,array['push','team','applications']);
    insert into interlink.notification_preferences(user_id,push,team,applications) values(u,(payload->>'push')::boolean,(payload->>'team')::boolean,(payload->>'applications')::boolean)
    on conflict(user_id) do update set push=excluded.push,team=excluded.team,applications=excluded.applications;
    result_id:=u;
  when 'device.register' then
    perform interlink.input_keys(payload,array['token','platform']);
    if payload->>'token' !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then perform interlink.fail('VALIDATION'); end if;
    insert into interlink.devices(user_id,token,platform) values(u,payload->>'token',payload->>'platform')
    on conflict(token) do update set user_id=u,platform=excluded.platform,active=true,updated_at=now() returning id into result_id;
  when 'device.unregister' then
    perform interlink.input_keys(payload,array['token']); update interlink.devices set active=false,updated_at=now() where user_id=u and token=payload->>'token' returning id into result_id;
    result_id:=coalesce(result_id,u);
  when 'report.create' then
    perform interlink.input_keys(payload,array['targetType','targetId','reason','detail']); perform interlink.rate(u,'report.create',5,3600);
    target:=(payload->>'targetId')::uuid;
    case payload->>'targetType'
    when 'profile' then
      if not interlink.profile_visible(u,target) and not exists(select 1 from interlink.memberships mine join interlink.memberships theirs on mine.project_id=theirs.project_id where mine.user_id=u and theirs.user_id=target and mine.active and theirs.active and interlink.member(u,mine.project_id)) then perform interlink.fail('NOT_FOUND'); end if;
      select nickname||E'\n'||bio into content_text from interlink.profiles where id=target;
    when 'project' then
      if not interlink.project_visible(u,target) then perform interlink.fail('NOT_FOUND'); end if;
      select title||E'\n'||goal||E'\n'||description into content_text from interlink.projects where id=target;
    when 'message' then
      select * into msg from interlink.messages where id=target;
      if msg.id is null or not interlink.member(u,msg.project_id) then perform interlink.fail('NOT_FOUND'); end if;
      content_text:=case when msg.deleted or msg.hidden then '[삭제되거나 숨겨진 메시지]' else msg.body end;
    else perform interlink.fail('VALIDATION'); end case;
    insert into interlink.reports(reporter_id,target_type,target_id,reason,detail) values(u,payload->>'targetType',target,btrim(payload->>'reason'),btrim(payload->>'detail')) returning id into result_id;
    insert into interlink.report_evidence(report_id,content) values(result_id,coalesce(content_text,'')); result_status:='open';
  when 'block.set' then
    perform interlink.input_keys(payload,array['userId','blocked']); target:=(payload->>'userId')::uuid;
    perform 1 from interlink.accounts where id=target for share;
    if target=u then perform interlink.fail('VALIDATION'); end if;
    if (payload->>'blocked')::boolean then
      if not exists(select 1 from interlink.blocks where user_id=u and blocked_id=target) and not interlink.profile_visible(u,target) and not exists(select 1 from interlink.memberships mine join interlink.memberships theirs using(project_id) where mine.user_id=u and theirs.user_id=target and mine.active and theirs.active and interlink.member(u,mine.project_id)) then perform interlink.fail('NOT_FOUND'); end if;
      insert into interlink.blocks(user_id,blocked_id) values(u,target) on conflict(user_id,blocked_id) do nothing;
      update interlink.applications app_row set status='withdrawn',updated_at=now() from interlink.projects project_row where app_row.project_id=project_row.id and app_row.status='pending' and ((app_row.user_id=u and project_row.owner_id=target) or (app_row.user_id=target and project_row.owner_id=u));
      update interlink.invitations set status='cancelled',updated_at=now() where status='pending' and ((inviter_id=u and invitee_id=target) or (inviter_id=target and invitee_id=u));
    else delete from interlink.blocks where user_id=u and blocked_id=target; end if;
    result_id:=target; perform interlink.emit(u,'blocks');
  when 'experience.save' then
    perform interlink.input_keys(payload,array['id','projectId','title','description','role','isPublic']); p:=(payload->>'projectId')::uuid;
    if not exists(select 1 from interlink.memberships where project_id=p and user_id=u) then perform interlink.fail('FORBIDDEN'); end if;
    if payload?'id' then
      update interlink.experiences set title=btrim(payload->>'title'),description=btrim(payload->>'description'),role=btrim(payload->>'role'),is_public=(payload->>'isPublic')::boolean,updated_at=now() where id=(payload->>'id')::uuid and user_id=u and project_id=p returning id into result_id;
      if result_id is null then perform interlink.fail('NOT_FOUND'); end if;
    else
      insert into interlink.experiences(user_id,project_id,title,description,role,is_public) values(u,p,btrim(payload->>'title'),btrim(payload->>'description'),btrim(payload->>'role'),(payload->>'isPublic')::boolean) returning id into result_id;
    end if;
    perform interlink.emit(u,'experiences');
  when 'experience.delete' then
    perform interlink.input_keys(payload,array['id']); delete from interlink.experiences where id=(payload->>'id')::uuid and user_id=u returning id into result_id;
    if result_id is null then perform interlink.fail('NOT_FOUND'); end if; perform interlink.emit(u,'experiences');
  when 'account.delete' then
    perform interlink.input_keys(payload,array['confirmation','ownedTeams']);
    if payload->>'confirmation'<>'DELETE' or payload->>'ownedTeams'<>'archive' then perform interlink.fail('VALIDATION'); end if;
    select max(to_timestamp((v->>'timestamp')::double precision)) into authenticated_at from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) v where v->>'method' in ('otp','password','totp','mfa/totp','oauth');
    if authenticated_at is null or authenticated_at<now()-interval '15 minutes' then perform interlink.fail('UNAUTHENTICATED'); end if;
    select * into deletion from interlink.deletion_requests where user_id=u;
    if deletion.id is not null then result_id:=deletion.id; result_status:=deletion.status;
    else
      update interlink.accounts set status='deleting',updated_at=now() where id=u;
      update interlink.profiles set discoverable=false where id=u;
      for x in select * from interlink.projects where owner_id=u and status<>'archived' order by id for update loop
        perform interlink.transition(x,'archived');
      end loop;
      for item in select project_id from interlink.memberships where user_id=u and active loop perform interlink.emit_team(item.project_id,'membership'); end loop;
      update interlink.memberships set active=false,left_at=now() where user_id=u;
      update interlink.applications set status='withdrawn',updated_at=now() where user_id=u and status='pending';
      update interlink.invitations set status='cancelled',updated_at=now() where (inviter_id=u or invitee_id=u) and status='pending';
      update interlink.devices set active=false where user_id=u;
      insert into interlink.deletion_requests(user_id) values(u) returning id into result_id;
      insert into interlink.jobs(kind,user_id,deletion_request_id,phase) values('deletion',u,result_id,'files'); result_status:='requested';
    end if;
  when 'community.join' then
    perform interlink.input_keys(payload,array['code']); perform interlink.rate(u,'community.join',5,3600);
    select * into ci from interlink.community_invites where code_hash=extensions.digest(lower(btrim(payload->>'code')),'sha256') for update;
    if ci.id is null or ci.expires_at<=now() or ci.uses>=ci.max_uses or not exists(select 1 from interlink.communities where id=ci.community_id and status='active') then perform interlink.fail('FORBIDDEN'); end if;
    if exists(select 1 from interlink.community_members where user_id=u and community_id=ci.community_id and status='approved') then perform interlink.fail('DUPLICATE'); end if;
    insert into interlink.community_members(community_id,user_id) values(ci.community_id,u) on conflict(community_id,user_id) do update set status='approved',joined_at=now();
    update interlink.community_invites set uses=uses+1 where id=ci.id;
    update interlink.profiles set community_id=ci.community_id,updated_at=now() where id=u;
    result_id:=ci.community_id; result_status:='approved'; perform interlink.emit(u,'profile');
  when 'admin.action' then
    perform interlink.input_keys(payload,array['reportId','targetType','targetId','action','note']);
    if length(btrim(payload->>'note')) not between 5 and 1000 then perform interlink.fail('VALIDATION'); end if;
    target:=(payload->>'targetId')::uuid; desired:=payload->>'action'; txt:=payload->>'targetType';
    if payload?'reportId' and not exists(select 1 from interlink.reports where id=(payload->>'reportId')::uuid and (txt='report' and id=target or target_type=txt and target_id=target)) then perform interlink.fail('FORBIDDEN'); end if;
    if txt='message' and not exists(select 1 from interlink.reports where target_type='message' and target_id=target) then perform interlink.fail('FORBIDDEN'); end if;
    if txt='profile' and desired in ('suspend','reactivate') then
      if target=u then perform interlink.fail('FORBIDDEN'); end if;
      update interlink.accounts set status=case when desired='suspend' then 'suspended' else 'active' end,updated_at=now() where id=target and status in ('active','suspended') returning id into result_id;
      if desired='suspend' then update interlink.devices set active=false where user_id=target; end if;
    elsif txt='profile' and desired in ('hide','restore') then update interlink.profiles set hidden=desired='hide' where id=target returning id into result_id;
    elsif txt='project' and desired in ('hide','restore') then update interlink.projects set hidden=desired='hide',updated_at=now() where id=target returning id into result_id; perform interlink.emit_team(target,'team');
    elsif txt='message' and desired in ('hide','restore') then update interlink.messages set hidden=desired='hide' where id=target returning id,project_id into result_id,p; perform interlink.emit_team(p,'messages');
    elsif txt='report' and desired in ('resolve','dismiss') then update interlink.reports set status=case when desired='resolve' then 'resolved' else 'dismissed' end where id=target returning id into result_id;
    else perform interlink.fail('VALIDATION'); end if;
    if result_id is null then perform interlink.fail('NOT_FOUND'); end if;
    if payload?'reportId' and txt<>'report' then update interlink.reports set status='reviewing' where id=(payload->>'reportId')::uuid; end if;
    insert into interlink.audit(actor_id,action,target_id,note) values(u,txt||'.'||desired,target,btrim(payload->>'note')); result_status:=desired;
  when 'admin.community' then
    perform interlink.input_keys(payload,array['id','name','status']);
    if payload?'id' then update interlink.communities set name=btrim(payload->>'name'),status=payload->>'status' where id=(payload->>'id')::uuid returning id into result_id;
    else insert into interlink.communities(name,status) values(btrim(payload->>'name'),payload->>'status') returning id into result_id; end if;
    if result_id is null then perform interlink.fail('NOT_FOUND'); end if;
    insert into interlink.audit(actor_id,action,target_id,note) values(u,'community.update',result_id,'커뮤니티 설정 변경');
  when 'admin.invite' then
    perform interlink.input_keys(payload,array['communityId','maxUses','expiresAt']); community:=(payload->>'communityId')::uuid;
    if not exists(select 1 from interlink.communities where id=community and status='active') or (payload->>'expiresAt')::timestamptz<=now() or (payload->>'maxUses')::integer not between 1 and 100 then perform interlink.fail('VALIDATION'); end if;
    result_id:=gen_random_uuid();
    insert into interlink.community_invites(code_hash,community_id,max_uses,expires_at,created_by) values(extensions.digest(result_id::text,'sha256'),community,(payload->>'maxUses')::integer,(payload->>'expiresAt')::timestamptz,u);
    insert into interlink.audit(actor_id,action,target_id,note) values(u,'community.invite',community,'초대코드 생성'); result_status:='created';
  when 'admin.job.retry' then
    perform interlink.input_keys(payload,array['id','note']);
    if length(btrim(payload->>'note')) not between 5 and 1000 then perform interlink.fail('VALIDATION'); end if;
    update interlink.jobs set status='retry',attempts=0,next_attempt_at=now(),lease_token=null,lease_until=null,last_error=null where id=(payload->>'id')::uuid and status='failed' returning id into result_id;
    if result_id is null then perform interlink.fail('CONFLICT'); end if;
    update interlink.deletion_requests set status='requested',reason=null where id=(select deletion_request_id from interlink.jobs where id=result_id);
    insert into interlink.audit(actor_id,action,target_id,note) values(u,'job.retry',result_id,btrim(payload->>'note')); result_status:='retry';
  else perform interlink.fail('VALIDATION');
  end case;
  if result_id is null then perform interlink.fail('VALIDATION'); end if;
  result:=jsonb_strip_nulls(jsonb_build_object('id',result_id,'status',result_status));
  update interlink.idempotency set response=result where user_id=u and key=idempotency_key;
  return result;
exception
  when unique_violation then perform interlink.fail('DUPLICATE');
  when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then perform interlink.fail('VALIDATION');
  when others then
    if sqlstate='P0001' and sqlerrm in ('CONFIGURATION','UNAUTHENTICATED','FORBIDDEN','VALIDATION','NOT_FOUND','CLOSED','FULL','DUPLICATE','RATE_LIMITED','NETWORK','UNAVAILABLE','CONFLICT') then raise; end if;
    perform interlink.fail('UNAVAILABLE');
end $$;
revoke all on function public.interlink_command(text,jsonb,uuid) from public,anon;
grant execute on function public.interlink_command(text,jsonb,uuid) to authenticated;
revoke all on all functions in schema interlink from public,anon,authenticated;
