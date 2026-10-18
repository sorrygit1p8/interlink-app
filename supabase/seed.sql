-- Fictional LOCAL SQL fixtures; intentionally disabled in config.toml.
-- Requires: SET interlink.allow_test_seed = 'on';
do $$ begin
  if current_setting('interlink.allow_test_seed',true) is distinct from 'on' then
    raise exception 'LOCAL_TEST_SEED_NOT_ENABLED';
  end if;
end $$;
insert into auth.users(id,email) values
('10000000-0000-4000-8000-000000000001','fictional-a@example.invalid'),
('10000000-0000-4000-8000-000000000002','fictional-b@example.invalid'),
('10000000-0000-4000-8000-000000000003','fictional-c@example.invalid'),
('10000000-0000-4000-8000-000000000004','fictional-admin@example.invalid'),
('10000000-0000-4000-8000-000000000005','fictional-outsider@example.invalid');
insert into interlink.communities(id,name) values
('20000000-0000-4000-8000-000000000001','가상 테스트 커뮤니티'),
('20000000-0000-4000-8000-000000000002','별도 가상 커뮤니티');
insert into interlink.community_members(community_id,user_id)
select '20000000-0000-4000-8000-000000000001',id from interlink.accounts where id<>'10000000-0000-4000-8000-000000000005';
insert into interlink.community_members(community_id,user_id) values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000005');
update interlink.profiles set community_id=case when id='10000000-0000-4000-8000-000000000005' then '20000000-0000-4000-8000-000000000002'::uuid else '20000000-0000-4000-8000-000000000001'::uuid end,
  nickname=case right(id::text,1) when '1' then '가상 팀장' when '2' then '가상 지원자' when '3' then '가상 초대자' when '4' then '가상 운영자' else '가상 외부인' end,
  interests=array['환경'],roles=array['개발'],learning_roles=array['디자인'],availability=array['주말 오후'],discoverable=true;
insert into interlink.admin_roles(user_id,role) values('10000000-0000-4000-8000-000000000004','admin');
insert into interlink.projects(id,owner_id,community_id,title,goal,description,interests,roles,capacity,activity_mode,availability,deadline,status) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','가상 환경 프로젝트','가상 환경 아이디어 실험','SQL 테스트를 위한 가상 환경 프로젝트입니다.',array['환경'],array['개발','디자인'],2,'online',array['주말 오후'],now()+interval '30 days','recruiting'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','가상 두 번째 프로젝트','함께 만드는 가상 실험','SQL 테스트를 위한 두 번째 가상 프로젝트입니다.',array['환경'],array['디자인'],4,'online',array['주말 오후'],now()+interval '20 days','recruiting');
insert into interlink.memberships(project_id,user_id,role) select id,owner_id,'팀장' from interlink.projects;
