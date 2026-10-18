"""Focused PostgreSQL regressions for private request status history.

Invoked by supabase/tests/run.py with its already initialized local harness.
Uses real SQL transactions and fictional accounts, never a remote Supabase project.
"""
import json
import uuid


def run_request_history_checks(harness):
    h = harness
    leader, applicant, invitee, community = [str(uuid.uuid4()) for _ in range(4)]
    lit = h.literal
    for index, user in enumerate((leader, applicant, invitee)):
        h.sql(f"INSERT INTO auth.users(id,email) VALUES({lit(user)},'history-{index}-{user}@example.invalid');")
    h.sql(f"INSERT INTO interlink.communities(id,name) VALUES({lit(community)},'가상 이력 검증 커뮤니티');")
    for user in (leader, applicant, invitee):
        h.sql(f"INSERT INTO interlink.community_members(community_id,user_id) VALUES({lit(community)},{lit(user)});"
              f"UPDATE interlink.profiles SET community_id={lit(community)},discoverable=true WHERE id={lit(user)};")

    def history(request_id, kind="application"):
        return json.loads(h.sql(
            "SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'event',event_kind,"
            "'before',previous_status,'after',next_status,'actor',actor_id) ORDER BY id),'[]') "
            f"FROM interlink.request_status_history WHERE {kind}_id={lit(request_id)};"))

    def create_project(owner=leader):
        return h.command(owner, "project.create", h.project("가상 상태 이력 프로젝트", capacity=6))["id"]

    def apply(project, user=applicant, key=None):
        return h.command(user, "application.submit", {
            "projectId": project, "role": "개발", "introduction": "이 문장은 이력에 복사되면 안 됩니다."
        }, key=key)["id"]

    def invite(project, user=invitee, owner=leader):
        return h.command(owner, "invitation.send", {
            "projectId": project, "inviteeId": user, "role": "개발", "message": "이 초대 본문은 이력에 저장하지 않습니다."
        })["id"]

    # Only private metadata columns, no direct client reads/writes, no realtime.
    columns = json.loads(h.sql("SELECT jsonb_agg(column_name ORDER BY ordinal_position) "
                              "FROM information_schema.columns WHERE table_schema='interlink' "
                              "AND table_name='request_status_history';"))
    assert columns == ["id", "application_id", "invitation_id", "event_kind", "previous_status",
                       "next_status", "actor_id", "recorded_at"], columns
    assert h.sql("SELECT relrowsecurity FROM pg_class WHERE oid='interlink.request_status_history'::regclass;") == "t"
    assert h.sql("SELECT count(*) FROM pg_publication_tables WHERE schemaname='interlink' AND tablename='request_status_history';") == "0"
    for role in ("anon", "authenticated"):
        h.sql("SELECT * FROM interlink.request_status_history;", user=leader, role=role, expect="permission denied")
        assert h.sql(f"SELECT has_table_privilege({lit(role)},'interlink.request_status_history','SELECT,INSERT,UPDATE,DELETE');") == "f"
        assert h.sql(f"SELECT has_function_privilege({lit(role)},'interlink.record_request_status()','EXECUTE');") == "f"
    h.passed("request history is private metadata only, RLS protected, not published or client executable")

    project = create_project()
    key = str(uuid.uuid4())
    application = apply(project, key=key)
    assert apply(project, key=key) == application
    assert [(r["event"], r["before"], r["after"], r["actor"]) for r in history(application)] == [
        ("created", None, "pending", applicant)
    ]
    h.command(leader, "application.review", {"id": application, "decision": "approved"})
    assert [(r["before"], r["after"], r["actor"]) for r in history(application)][1:] == [
        ("pending", "withdrawn", leader), ("withdrawn", "approved", leader)
    ]
    count = len(history(application))
    h.sql(f"UPDATE interlink.applications SET status=status,updated_at=now() WHERE id={lit(application)};")
    h.sql(f"BEGIN; UPDATE interlink.applications SET status='rejected' WHERE id={lit(application)}; ROLLBACK;")
    assert len(history(application)) == count
    invitation = invite(project)
    h.command(invitee, "invitation.respond", {"id": invitation, "decision": "accepted"})
    assert [(r["event"], r["before"], r["after"], r["actor"]) for r in history(invitation, "invitation")] == [
        ("created", None, "pending", leader),
        ("transition", "pending", "cancelled", invitee),
        ("transition", "cancelled", "accepted", invitee),
    ]
    h.passed("request creation, approval and acceptance history is transactional, actor-derived and replay-safe")

    closed_project = create_project()
    closed_application = apply(closed_project)
    closed_invitation = invite(closed_project)
    h.command(leader, "project.transition", {"id": closed_project, "status": "active"})
    assert history(closed_application)[-1]["after"] == "rejected"
    assert history(closed_application)[-1]["actor"] == leader
    assert history(closed_invitation, "invitation")[-1]["after"] == "cancelled"
    assert history(closed_invitation, "invitation")[-1]["actor"] == leader

    expiry_project = create_project()
    expired_invitation = invite(expiry_project, user=applicant)
    h.sql(f"UPDATE interlink.invitations SET expires_at=now()-interval '1 minute' WHERE id={lit(expired_invitation)};")
    h.worker("interlink_maintenance")
    expired = history(expired_invitation, "invitation")[-1]
    assert (expired["before"], expired["after"], expired["actor"]) == ("pending", "expired", None)
    # The policy cap is implemented, without inventing a legal retention basis.
    aged_id = history(invitation, "invitation")[0]["id"]
    h.sql(f"UPDATE interlink.request_status_history SET recorded_at=now()-interval '31 days' WHERE id={aged_id};")
    h.worker("interlink_maintenance")
    assert all(row["id"] != aged_id for row in history(invitation, "invitation"))
    assert len(history(application)) == count
    h.passed("implicit project closure and scheduled expiry record history; maintenance prunes the provisional retention cap")

    # Former ownership must preserve another person's state history while erasing
    # attribution to the deleted former owner. Use the real transfer/delete path.
    transferred_project = create_project(owner=applicant)
    retained_application = apply(transferred_project, user=invitee)
    h.command(applicant, "application.review", {"id": retained_application, "decision": "approved"})
    transfer_invitation = invite(transferred_project, user=leader, owner=applicant)
    h.command(leader, "invitation.respond", {"id": transfer_invitation, "decision": "accepted"})
    h.command(applicant, "membership.transfer", {"projectId": transferred_project, "userId": leader})
    assert any(row["actor"] == applicant for row in history(retained_application))
    deletion = h.command(applicant, "account.delete", {"confirmation": "DELETE", "ownedTeams": "archive"})
    jobs = h.worker("interlink_worker_claim", "'deletion',50")
    job = next(job for job in jobs if job["payload"]["userId"] == applicant)
    h.worker("interlink_worker_ack", f"{lit(job['id'])},{lit(job['leaseToken'])},'auth','{{}}'")
    jobs = h.worker("interlink_worker_claim", "'deletion',50")
    job = next(job for job in jobs if job["payload"]["userId"] == applicant)
    h.sql(f"DELETE FROM auth.users WHERE id={lit(applicant)};")
    result = h.worker("interlink_deletion_finalize", f"{lit(job['id'])},{lit(job['leaseToken'])}")
    assert result == {"id": deletion["id"], "status": "completed"}
    for request_id, kind in ((application, "application"), (closed_application, "application"),
                             (expired_invitation, "invitation"), (transfer_invitation, "invitation")):
        assert history(request_id, kind) == []
    retained = history(retained_application)
    assert retained and all(row["actor"] != applicant for row in retained)
    assert retained[-1]["after"] == "approved" and retained[-1]["actor"] is None
    assert h.sql(f"SELECT count(*) FROM interlink.request_status_history WHERE actor_id={lit(applicant)};") == "0"
    h.passed("deletion finalize erases related request history and removes attribution from unrelated retained history")
