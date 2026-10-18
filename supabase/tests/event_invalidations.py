"""Real SQL checks for content-free recipient invalidations, not websocket tests."""
import json
import uuid


def run_event_invalidation_checks(harness):
    h = harness
    lit = h.literal
    leader, applicant, invitee, outsider, community = [str(uuid.uuid4()) for _ in range(5)]
    for user in (leader, applicant, invitee, outsider):
        h.sql(f"INSERT INTO auth.users(id,email) VALUES({lit(user)},'events-{user}@example.invalid');")
    h.sql(f"INSERT INTO interlink.communities(id,name) VALUES({lit(community)},'가상 변경 알림 검증');")
    for user in (leader, applicant, invitee):
        h.sql(f"INSERT INTO interlink.community_members(community_id,user_id) VALUES({lit(community)},{lit(user)});"
              f"UPDATE interlink.profiles SET community_id={lit(community)},discoverable=true WHERE id={lit(user)};")
        h.command(user, 'notification.preferences', {'push': False, 'team': True, 'applications': False})
    project = h.command(leader, 'project.create', h.project('가상 수신자 변경 신호', capacity=4))['id']

    def events(user, scope, target_project=project):
        result = json.loads(h.sql("SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM public.change_events e "
                                 f"WHERE project_id={lit(target_project)} AND scope={lit(scope)};", user=user))
        for row in result:
            assert set(row) == {'id', 'user_id', 'scope', 'project_id', 'created_at'}, row
            assert row['user_id'] == user
        return result

    def clear_events():
        h.sql(f"DELETE FROM public.change_events WHERE project_id={lit(project)};")

    application = h.command(applicant, 'application.submit', {
        'projectId': project, 'role': '개발', 'introduction': '이 본문은 변경 신호에 포함되지 않습니다.'
    })['id']
    assert events(applicant, 'applications')
    assert events(outsider, 'applications') == []
    h.query(applicant, 'messages.list', {'projectId': project}, expect='FORBIDDEN')
    clear_events()
    h.command(leader, 'application.review', {'id': application, 'decision': 'rejected'})
    assert events(applicant, 'applications')
    assert events(leader, 'applications')
    assert h.sql(f"SELECT count(*) FROM interlink.notifications WHERE user_id={lit(applicant)};") == '0'
    assert events(outsider, 'applications') == []

    invitation = h.command(leader, 'invitation.send', {
        'projectId': project, 'inviteeId': invitee, 'role': '개발', 'message': '공개되면 안 되는 가상 초대 본문'
    })['id']
    assert events(invitee, 'invitations')
    clear_events()
    h.command(leader, 'invitation.cancel', {'id': invitation})
    assert events(invitee, 'invitations')
    assert events(outsider, 'invitations') == []
    assert h.sql(f"SELECT count(*) FROM interlink.notifications WHERE user_id={lit(invitee)};") == '0'
    h.passed('nonmember applicants and invitees receive only their own content-free changes with notifications disabled')

    h.command(applicant, 'application.submit', {
        'projectId': project, 'role': '개발', 'introduction': '종료 시 신청 상태 변경을 확인합니다.'
    })
    h.command(leader, 'invitation.send', {
        'projectId': project, 'inviteeId': invitee, 'role': '개발', 'message': '종료 시 초대 상태 변경 검증'
    })
    clear_events()
    h.command(leader, 'project.transition', {'id': project, 'status': 'active'})
    assert events(applicant, 'applications') and events(invitee, 'invitations')
    assert events(outsider, 'applications') == [] and events(outsider, 'invitations') == []
    h.passed('implicit project closure invalidates both request recipients without message or profile content')

    transferred_project = h.command(leader, 'project.create', h.project('가상 소유권 이전 변경 신호', capacity=4))['id']
    transferred_invitation = h.command(leader, 'invitation.send', {
        'projectId': transferred_project, 'inviteeId': applicant, 'role': '개발', 'message': '소유권 이전 후 만료 검증'
    })['id']
    successor_application = h.command(invitee, 'application.submit', {
        'projectId': transferred_project, 'role': '개발', 'introduction': '새 팀장의 변경 수신을 검증합니다.'
    })['id']
    h.command(leader, 'application.review', {'id': successor_application, 'decision': 'approved'})
    h.command(leader, 'membership.transfer', {'projectId': transferred_project, 'userId': invitee})
    h.sql(f"DELETE FROM public.change_events WHERE project_id={lit(transferred_project)};"
          f"UPDATE interlink.invitations SET expires_at=now()-interval '1 minute' WHERE id={lit(transferred_invitation)};")
    h.worker('interlink_maintenance')
    assert len(events(invitee, 'invitations', transferred_project)) == 1
    assert len(events(leader, 'invitations', transferred_project)) == 1
    assert len(events(applicant, 'invitations', transferred_project)) == 1
    assert events(outsider, 'invitations', transferred_project) == []
    assert next(item for item in h.query(invitee, 'invitations.list', {'limit': 50})['items']
                if item['id'] == transferred_invitation)['status'] == 'expired'
    h.passed('scheduled invitation expiry reaches the current owner after transfer without duplicate recipients')

    clear_events()
    h.command(h.ADMIN, 'admin.action', {'targetType': 'project', 'targetId': project,
                                      'action': 'hide', 'note': '가상 숨김 변경 신호 검증'}, aal='aal2')
    assert events(leader, 'team')
    h.query(leader, 'messages.list', {'projectId': project}, expect='FORBIDDEN')
    h.query(leader, 'projects.detail', {'id': project}, expect='NOT_FOUND')
    h.sql(f"INSERT INTO public.change_events(user_id,scope,project_id) VALUES({lit(leader)},'messages',{lit(project)});")
    assert events(leader, 'messages') == []
    assert events(outsider, 'team') == []
    h.command(h.ADMIN, 'admin.action', {'targetType': 'profile', 'targetId': leader,
                                      'action': 'suspend', 'note': '가상 정지 변경 신호 제한'}, aal='aal2')
    assert events(leader, 'team') == []
    assert events(leader, 'applications') == []
    h.passed('hidden-team invalidations remain readable only to their active recipient; content RPC and message RLS stay denied')
