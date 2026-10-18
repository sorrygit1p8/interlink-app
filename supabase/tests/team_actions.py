"""Isolated SQL disband/leave checks; never connects to a user's database."""
import uuid


def run_team_action_checks(harness):
    h = harness
    lit = h.literal
    leader, member, applicant, invitee, community = [str(uuid.uuid4()) for _ in range(5)]
    h.sql(f"INSERT INTO interlink.communities(id,name) VALUES({lit(community)},'가상 팀 종료 검증');")
    # Fresh profiles are private; this fixture needs discoverable invitation targets.
    for user in (leader, member, applicant, invitee):
        h.sql(f"INSERT INTO auth.users(id) VALUES({lit(user)});"
              f"INSERT INTO interlink.community_members(community_id,user_id) VALUES({lit(community)},{lit(user)});"
              f"UPDATE interlink.profiles SET community_id={lit(community)},discoverable=true WHERE id={lit(user)};")

    def join(project_id):
        invitation = h.command(leader, 'invitation.send', {
            'projectId': project_id, 'inviteeId': member, 'role': '개발', 'message': '가상 팀 합류'
        })['id']
        h.command(member, 'invitation.respond', {'id': invitation, 'decision': 'accepted'})

    project = h.command(leader, 'project.create', h.project('가상 해체 검증 팀', capacity=4))['id']
    join(project)
    message = h.command(member, 'message.send', {
        'projectId': project, 'body': '해체 후에도 원본을 보존하는 가상 대화', 'clientId': str(uuid.uuid4())
    })['id']
    application = h.command(applicant, 'application.submit', {
        'projectId': project, 'role': '개발', 'introduction': '검토 중인 가상 참여 신청입니다.'
    })['id']
    invitation = h.command(leader, 'invitation.send', {
        'projectId': project, 'inviteeId': invitee, 'role': '개발', 'message': '응답 전 가상 초대'
    })['id']
    for user in (member, applicant):
        h.command(user, 'project.disband', {'id': project}, expect='FORBIDDEN')
    h.command(leader, 'project.disband', {'id': project, 'ownerId': member}, expect='VALIDATION')
    h.command(leader, 'membership.leave', {'projectId': project}, expect='CONFLICT')

    key = str(uuid.uuid4())
    h.sql(f"BEGIN; SELECT public.interlink_command('project.disband',jsonb_build_object('id',{lit(project)}),{lit(key)}::uuid); ROLLBACK;", user=leader)
    assert h.query(leader, 'projects.detail', {'id': project})['project']['memberCount'] == 2
    assert h.query(leader, 'projects.detail', {'id': project})['project']['status'] == 'recruiting'
    assert h.sql(f"SELECT status FROM interlink.applications WHERE id={lit(application)};") == 'pending'
    assert h.sql(f"SELECT status FROM interlink.invitations WHERE id={lit(invitation)};") == 'pending'
    assert h.sql(f"SELECT count(*) FROM interlink.idempotency WHERE user_id={lit(leader)} AND key={lit(key)};") == '0'

    h.sql(f"DELETE FROM public.change_events WHERE project_id={lit(project)};")
    result = h.command(leader, 'project.disband', {'id': project}, key)
    assert result == {'id': project, 'status': 'archived'}
    notifications = h.sql(f"SELECT count(*) FROM interlink.notifications WHERE project_id={lit(project)};")
    assert h.command(leader, 'project.disband', {'id': project}, key) == result
    assert h.command(leader, 'project.disband', {'id': project}) == result
    assert h.sql(f"SELECT count(*) FROM interlink.notifications WHERE project_id={lit(project)};") == notifications
    assert h.sql(f"SELECT count(*) FROM interlink.memberships WHERE project_id={lit(project)};") == '2'
    assert h.sql(f"SELECT count(*) FROM interlink.memberships WHERE project_id={lit(project)} AND active;") == '0'
    assert h.sql(f"SELECT status FROM interlink.applications WHERE id={lit(application)};") == 'rejected'
    assert h.sql(f"SELECT status FROM interlink.invitations WHERE id={lit(invitation)};") == 'cancelled'
    assert h.sql(f"SELECT body FROM interlink.messages WHERE id={lit(message)};") == '해체 후에도 원본을 보존하는 가상 대화'
    for user, scope in ((applicant, 'applications'), (invitee, 'invitations')):
        # Migration 007 triggers deliver recipient metadata even though these
        # pending users never held a team membership or chat permission.
        assert int(h.sql(f"SELECT count(*) FROM public.change_events WHERE project_id={lit(project)} AND scope={lit(scope)};", user=user)) > 0
        h.query(user, 'messages.list', {'projectId': project}, expect='FORBIDDEN')
    for user in (leader, member):
        assert project not in [item['id'] for item in h.query(user, 'teams.mine')['items']]
        history = next(item for item in h.query(user, 'teams.history')['items'] if item['id'] == project)
        assert history['description'] == '' and history['memberCount'] == 0
        assert int(h.sql(f"SELECT count(*) FROM public.change_events WHERE project_id={lit(project)} AND scope='membership';", user=user)) > 0
        h.query(user, 'messages.list', {'projectId': project}, expect='FORBIDDEN')
        h.command(user, 'message.send', {'projectId': project, 'body': '종료 후 전송 금지', 'clientId': str(uuid.uuid4())}, expect='FORBIDDEN')
    h.command(leader, 'project.transition', {'id': project, 'status': 'recruiting'}, expect='CONFLICT')
    h.command(invitee, 'invitation.respond', {'id': invitation, 'decision': 'accepted'}, expect='CONFLICT')
    h.command(member, 'experience.save', {'projectId': project, 'title': '종료 후 가상 경험', 'description': '실제 참여 이력은 계속 사용할 수 있어요.', 'role': '개발', 'isPublic': False})
    h.passed('owner disband is atomic, actor-authorized and idempotent; requests close, memberships revoke, history and invalidations survive')

    remaining = h.command(leader, 'project.create', h.project('가상 탈퇴 검증 팀'))['id']
    join(remaining)
    h.command(member, 'membership.leave', {'projectId': remaining})
    assert remaining not in [item['id'] for item in h.query(member, 'teams.mine')['items']]
    assert remaining in [item['id'] for item in h.query(member, 'teams.history')['items']]
    assert h.query(leader, 'projects.detail', {'id': remaining})['project']['memberCount'] == 1
    h.query(member, 'messages.list', {'projectId': remaining}, expect='FORBIDDEN')
    assert h.query(leader, 'projects.detail', {'id': remaining})['project']['status'] == 'recruiting'
    h.passed('member leave removes only the caller and retains owner access and participation history')
