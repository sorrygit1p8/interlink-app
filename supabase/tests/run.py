#!/usr/bin/env python3
"""Real PostgreSQL SQL/RPC/RLS/concurrency tests; NOT Supabase Auth/Realtime integration.

Run: python3 supabase/tests/run.py
Requires Docker, or INTERLINK_PG_BIN pointing to PostgreSQL 17 binaries.
Creates and removes a disposable local PostgreSQL 17 cluster and fictional data.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import os
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
CONTAINER = f"interlink-postgres-test-{os.getpid()}"
IMAGE = "postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24"
A, B, C, ADMIN, OUT = [f"10000000-0000-4000-8000-00000000000{i}" for i in range(1, 6)]
P1, P2 = [f"30000000-0000-4000-8000-00000000000{i}" for i in range(1, 3)]
COMMUNITY = "20000000-0000-4000-8000-000000000001"
PASSED = []
NATIVE = None
DOCKER_STARTED = False


def start_database():
    global NATIVE, DOCKER_STARTED
    if os.environ.get("INTERLINK_PG_BIN"):
        from native_postgres import NativePostgres
        NATIVE = NativePostgres(os.environ["INTERLINK_PG_BIN"], ROOT)
        NATIVE.start()
        return
    subprocess.run(["docker", "run", "--rm", "-d", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=local-test-only", "-e", "POSTGRES_DB=interlink", IMAGE], check=True, capture_output=True)
    DOCKER_STARTED = True
    for _ in range(100):
        ready = subprocess.run(["docker", "exec", CONTAINER, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], capture_output=True)
        if ready.returncode == 0:
            return
        time.sleep(0.1)
    raise AssertionError("PostgreSQL did not start")


def stop_database():
    if NATIVE is not None:
        NATIVE.stop()
    elif DOCKER_STARTED:
        subprocess.run(["docker", "rm", "-f", CONTAINER], capture_output=True)


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def sql(statement, user=None, role=None, aal="aal1", expect=None, recent=True):
    if role or user:
        role = role or "authenticated"
        claims = {"role": role, "aal": aal}
        if user:
            claims.update(sub=user, amr=[{"method": "otp", "timestamp": int(time.time()) - (0 if recent else 7200)}])
        statement = f"SET request.jwt.claims={literal(json.dumps(claims))}; SET ROLE {role}; " + statement
    result = subprocess.run(
        NATIVE.psql_command if NATIVE is not None else ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-U", "postgres", "-d", "interlink", "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, encoding="utf-8", capture_output=True,
        env=NATIVE.env if NATIVE is not None else None,
        creationflags=NATIVE.flags if NATIVE is not None else 0,
    )
    if expect:
        assert result.returncode != 0 and expect in result.stderr, (expect, result.stdout, result.stderr)
        return None
    assert result.returncode == 0, (statement, result.stdout, result.stderr)
    lines = result.stdout.strip().splitlines()
    return lines[-1] if lines else None


def query(user, operation, payload=None, **kwargs):
    raw = sql(f"SELECT public.interlink_query({literal(operation)},{literal(json.dumps(payload or {}))}::jsonb);", user=user, **kwargs)
    return json.loads(raw) if raw else None


def command(user, operation, payload, key=None, **kwargs):
    raw = sql(f"SELECT public.interlink_command({literal(operation)},{literal(json.dumps(payload))}::jsonb,{literal(key or uuid.uuid4())}::uuid);", user=user, **kwargs)
    return json.loads(raw) if raw else None


def worker(name, args="", expect=None):
    raw = sql(f"SELECT public.{name}({args});", role="service_role", expect=expect)
    return json.loads(raw) if raw else None


def passed(name):
    PASSED.append(name)
    print(f"PASS {len(PASSED):02d} {name}", flush=True)


def project(title="가상 테스트 팀", capacity=4):
    return dict(title=title, goal="함께 가상 아이디어를 만들어요", description="실제 개인정보 없는 테스트용 가상 프로젝트입니다.", interests=["환경"], roles=["개발"], capacity=capacity, activityMode="online", availability=["주말 오후"], deadline="2099-01-01T00:00:00Z", beginnerFriendly=True)


def main():
    try:
        start_database()
        sql((ROOT / "supabase/tests/bootstrap.sql").read_text(encoding="utf-8"))
        for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            sql(migration.read_text(encoding="utf-8"))
        sql("SET interlink.allow_test_seed=on;\n" + (ROOT / "supabase/seed.sql").read_text(encoding="utf-8"))
        passed("all migrations apply to PostgreSQL 17; fictional fixtures only")

        assert query(A, "bootstrap")["viewer"]["id"] == A
        assert len(query(A, "projects.search")["items"]) == 2
        assert query(OUT, "projects.search")["items"] == []
        assert len(query(A, "people.search")["items"]) == 3
        assert query(A, "projects.search", {"sort": "deadline"})["items"][0]["id"] == P2
        page = query(A, "projects.search", {"limit": 1})
        page2 = query(A, "projects.search", {"limit": 1, "cursor": page["nextCursor"]})
        assert page2["items"][0]["id"] != page["items"][0]["id"] and page2["nextCursor"] is None
        query(OUT, "projects.detail", {"id": P1}, expect="NOT_FOUND")
        query(A, "projects.search", {"cursor": "invalid-json"}, expect="VALIDATION")
        passed("community-scoped search, recommendation, deadline sort, keyset pagination")

        assert sql("SELECT bool_and(relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='interlink' AND c.relkind='r';") == "t"
        sql("SELECT * FROM interlink.accounts;", user=A, expect="permission denied")
        sql("INSERT INTO public.change_events(user_id,scope) VALUES(gen_random_uuid(),'forged');", user=A, expect="permission denied")
        sql("SELECT interlink.add_member(null,null,null);", user=A, expect="permission denied")
        sql("SELECT public.interlink_worker_claim('push',20);", user=A, expect="permission denied")
        sql("SELECT public.interlink_query('bootstrap','{}');", role="anon", expect="permission denied")
        query(A, "admin.overview", expect="FORBIDDEN")
        query(ADMIN, "admin.session", expect="FORBIDDEN")
        assert query(ADMIN, "admin.session", aal="aal2")["mfa"] is True
        passed("private schema, RLS, helper grants, anonymous and admin MFA denials")

        admin_key = str(uuid.uuid4())
        invite_payload = {"communityId": COMMUNITY, "maxUses": 1, "expiresAt": "2099-01-01T00:00:00Z"}
        invite_result = command(ADMIN, "admin.invite", invite_payload, admin_key, aal="aal2")
        assert command(ADMIN, "admin.invite", invite_payload, admin_key, aal="aal2") == invite_result
        command(ADMIN, "admin.invite", invite_payload, admin_key, expect="FORBIDDEN")
        granted_at = sql(f"SELECT granted_at FROM interlink.admin_roles WHERE user_id={literal(ADMIN)};")
        sql(f"DELETE FROM interlink.admin_roles WHERE user_id={literal(ADMIN)};")
        try:
            command(ADMIN, "admin.invite", invite_payload, admin_key, aal="aal2", expect="FORBIDDEN")
        finally:
            sql(f"INSERT INTO interlink.admin_roles(user_id,role,granted_at) VALUES({literal(ADMIN)},'admin',{literal(granted_at)});")
        assert command(ADMIN, "admin.invite", invite_payload, admin_key, aal="aal2") == invite_result
        assert sql(f"SELECT count(*) FROM interlink.community_invites WHERE code_hash=extensions.digest({literal(invite_result['id'])},'sha256');") == "1"
        passed("cached admin invite requires current AAL2 and role; authorized replay preserves the original code")

        new_user = "10000000-0000-4000-8000-000000000006"
        sql(f"INSERT INTO auth.users(id) VALUES({literal(new_user)});")
        assert query(new_user, "bootstrap")["community"] is None
        command(new_user, "application.submit", {"projectId": P1, "role": "개발", "introduction": "함께 참여하고 싶어요"}, expect="FORBIDDEN")
        code = command(ADMIN, "admin.invite", {"communityId": COMMUNITY, "maxUses": 1, "expiresAt": "2099-01-01T00:00:00Z"}, aal="aal2")["id"]
        assert command(new_user, "community.join", {"code": code})["status"] == "approved"
        command(OUT, "community.join", {"code": code}, expect="FORBIDDEN")
        passed("new authenticated accounts stay unapproved; hashed single-use community invite")

        key = str(uuid.uuid4())
        body = project()
        created = command(A, "project.create", body, key)
        assert command(A, "project.create", body, key) == created
        command(A, "project.create", {**body, "title": "다른 명령"}, key, expect="CONFLICT")
        command(A, "project.create", {**body, "ownerId": B}, expect="VALIDATION")
        command(A, "project.create", {**body, "capacity": "3"}, expect="VALIDATION")
        command(A, "account.delete", {}, expect="VALIDATION")
        passed("actor-derived writes, required fields, strict types, idempotent replay and key conflict")

        app = command(B, "application.submit", {"projectId": P1, "role": "개발", "introduction": "가상 프로젝트 참여 신청"})["id"]
        command(B, "application.review", {"id": app, "decision": "approved"}, expect="FORBIDDEN")
        invitation = command(A, "invitation.send", {"projectId": P1, "inviteeId": C, "role": "디자인", "message": "가상 팀 초대입니다"})["id"]
        command(C, "application.submit", {"projectId": P1, "role": "디자인", "introduction": "교차 요청은 거부합니다"}, expect="DUPLICATE")
        def approve_or_error(fn):
            try:
                return fn()
            except AssertionError as error:
                assert "FULL" in str(error), str(error)
                return {"status": "FULL"}
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(approve_or_error, lambda: command(A, "application.review", {"id": app, "decision": "approved"})), pool.submit(approve_or_error, lambda: command(C, "invitation.respond", {"id": invitation, "decision": "accepted"}))]
            outcomes = [future.result()["status"] for future in futures]
        assert outcomes.count("FULL") == 1, outcomes
        assert sql(f"SELECT count(*) FROM interlink.memberships WHERE project_id={literal(P1)} AND active;") == "2"
        sql(f"INSERT INTO interlink.memberships(project_id,user_id,role) VALUES({literal(P1)},{literal(OUT)},'개발');", expect="FULL")
        assert P1 not in [p["id"] for p in query(A, "projects.search")["items"]]
        passed("real two-session final-slot approval/accept race; capacity trigger and cross-request guard")

        inv2 = command(A, "invitation.send", {"projectId": P2, "inviteeId": B, "role": "디자인", "message": "테스트 팀에 초대해요"})["id"]
        command(B, "invitation.respond", {"id": inv2, "decision": "accepted"})
        assert any(i["id"] == inv2 for i in query(A, "invitations.list")["items"])
        command(A, "membership.transfer", {"projectId": P2, "userId": B})
        command(A, "project.transition", {"id": P2, "status": "active"}, expect="FORBIDDEN")
        command(B, "membership.transfer", {"projectId": P2, "userId": A})
        passed("invitation, mutual consent, owner transfer and stale-owner authorization")

        client_id = str(uuid.uuid4())
        msg_payload = {"projectId": P2, "body": "가상 팀 테스트 대화", "clientId": client_id}
        message = command(A, "message.send", msg_payload)["id"]
        assert command(A, "message.send", msg_payload)["id"] == message
        command(A, "message.send", {**msg_payload, "body": "다른 내용"}, expect="CONFLICT")
        query(OUT, "messages.list", {"projectId": P2}, expect="FORBIDDEN")
        bteam = next(t for t in query(B, "teams.mine")["items"] if t["id"] == P2)
        assert bteam["unreadCount"] == 1
        command(B, "message.read", {"projectId": P2, "messageId": message})
        assert next(t for t in query(B, "teams.mine")["items"] if t["id"] == P2)["unreadCount"] == 0
        report = command(B, "report.create", {"targetType": "message", "targetId": message, "reason": "테스트 신고", "detail": "가상 콘텐츠 검증"})["id"]
        query(ADMIN, "messages.list", {"projectId": P2}, aal="aal2", expect="FORBIDDEN")
        assert query(ADMIN, "admin.report", {"id": report}, aal="aal2")["content"] == msg_payload["body"]
        assert int(sql(f"SELECT count(*) FROM interlink.audit WHERE target_id={literal(report)} AND action='report.view';")) == 1
        command(ADMIN, "admin.action", {"reportId": report, "targetType": "message", "targetId": message, "action": "hide", "note": "가상 신고 검토 숨김"}, aal="aal2")
        assert query(A, "messages.list", {"projectId": P2})["items"][0]["body"] == ""
        command(A, "message.delete", {"id": message})
        command(ADMIN, "admin.action", {"reportId": report, "targetType": "message", "targetId": message, "action": "restore", "note": "삭제된 본문 복구 금지"}, aal="aal2")
        assert query(A, "messages.list", {"projectId": P2})["items"][0]["body"] == ""
        passed("private chat, client-id dedupe, monotonic read cursor, minimal audited report evidence, deletion")

        command(A, "membership.remove", {"projectId": P2, "userId": B})
        query(B, "messages.list", {"projectId": P2}, expect="FORBIDDEN")
        command(B, "message.send", {"projectId": P2, "body": "금지된 메시지", "clientId": str(uuid.uuid4())}, expect="FORBIDDEN")
        assert sql(f"SELECT count(*) FROM public.change_events WHERE project_id={literal(P2)} AND scope='messages';", user=B) == "0"
        passed("revoked member denied new RPC reads/writes and old content-free event rows")

        command(A, "block.set", {"userId": B, "blocked": True})
        assert B not in [p["id"] for p in query(A, "people.search")["items"]]
        command(A, "invitation.send", {"projectId": P2, "inviteeId": B, "role": "개발", "message": "차단한 사용자"}, expect="FORBIDDEN")
        command(A, "block.set", {"userId": B, "blocked": False})
        experience = command(B, "experience.save", {"projectId": P2, "title": "가상 경험", "description": "실제 참여 이력에 연결된 가상 경험", "role": "개발", "isPublic": False})["id"]
        assert query(A, "experiences.list", {"userId": B})["items"] == []
        command(OUT, "experience.save", {"projectId": P2, "title": "거짓 경험", "description": "참여 이력이 없어 거절됩니다", "role": "개발", "isPublic": True}, expect="FORBIDDEN")
        command(B, "experience.delete", {"id": experience})
        passed("server-side block effects and experience membership/publicity authorization")

        token = "ExpoPushToken[fictional_local_test_token_a]"
        device = command(A, "device.register", {"token": token, "platform": "android"})["id"]
        command(A, "notification.preferences", {"push": True, "team": True, "applications": True})
        app3 = command(B, "application.submit", {"projectId": created["id"], "role": "개발", "introduction": "알림 작업 검증을 위한 가상 신청"})["id"]
        jobs = worker("interlink_worker_claim", "'push',20")
        assert len(jobs) == 1
        job = jobs[0]
        args = literal(job["id"]) + "," + literal(job["leaseToken"])
        assert worker("interlink_push_target", args)["deviceId"] == device
        worker("interlink_worker_ack", args + ",'receipt','{\"ticketId\":\"fictional-ticket\",\"delaySeconds\":900}'")
        assert worker("interlink_worker_claim", "'push',20") == []
        sql(f"UPDATE interlink.jobs SET next_attempt_at=now() WHERE id={literal(job['id'])};")
        receipt = worker("interlink_worker_claim", "'push',20")[0]
        assert receipt["phase"] == "receipt" and receipt["payload"]["ticketId"] == "fictional-ticket"
        args = literal(receipt["id"]) + "," + literal(receipt["leaseToken"])
        worker("interlink_disable_device", literal(device))
        assert worker("interlink_push_target", args) is None
        worker("interlink_worker_ack", args + ",'done','{\"reason\":\"device_revoked\"}'")
        worker("interlink_worker_ack", args + ",'done','{}'", expect="CONFLICT")
        assert sql(f"SELECT status FROM interlink.push_receipts WHERE job_id={literal(job['id'])};") == "device_revoked"
        passed("durable push ticket/receipt scheduling, revoked token, stale lease rejection")

        # Last send attempt may succeed; receipt polling needs its own bounded
        # allowance while resend cycles must still share a finite send budget.
        def push_job(attempts=0):
            return sql(f"INSERT INTO interlink.jobs(kind,user_id,phase,attempts,send_attempts) VALUES('push',{literal(A)},'send',{attempts},{attempts}) RETURNING id;")

        def claim_push(job_id):
            sql(f"UPDATE interlink.jobs SET next_attempt_at=now() WHERE id={literal(job_id)};")
            claimed = worker("interlink_worker_claim", "'push',20")
            assert len(claimed) == 1 and claimed[0]["id"] == job_id, claimed
            return claimed[0], literal(job_id) + "," + literal(claimed[0]["leaseToken"])

        final_send = push_job(7)
        sent, args = claim_push(final_send)
        assert sent["phase"] == "send" and sent["attempts"] == 8
        worker("interlink_worker_ack", args + ",'receipt','{\"ticketId\":\"final-send-ticket\",\"delaySeconds\":900}'")
        assert sql(f"SELECT attempts||':'||send_attempts FROM interlink.jobs WHERE id={literal(final_send)};") == "0:8"
        receipt, args = claim_push(final_send)
        assert receipt["phase"] == "receipt" and receipt["attempts"] == 1
        worker("interlink_worker_ack", args + ",'done','{}'")
        assert sql(f"SELECT status FROM interlink.push_receipts WHERE job_id={literal(final_send)};") == "ok"

        pending_receipt = push_job(7)
        _, args = claim_push(pending_receipt)
        worker("interlink_worker_ack", args + ",'receipt','{\"ticketId\":\"pending-final-ticket\",\"delaySeconds\":900}'")
        for attempt in range(1, 9):
            receipt, args = claim_push(pending_receipt)
            assert receipt["phase"] == "receipt" and receipt["attempts"] == attempt
            outcome = worker("interlink_worker_ack", args + ",'receipt','{\"ticketId\":\"pending-final-ticket\",\"delaySeconds\":900}'")
            assert outcome["status"] == ("failed" if attempt == 8 else "retry")
        assert worker("interlink_worker_claim", "'push',20") == []

        rejected_receipts = push_job()
        for attempt in range(1, 9):
            sent, args = claim_push(rejected_receipts)
            assert sent["phase"] == "send" and sent["attempts"] == attempt
            worker("interlink_worker_ack", args + ",'receipt','{\"ticketId\":\"rejected-ticket\",\"delaySeconds\":900}'")
            receipt, args = claim_push(rejected_receipts)
            assert receipt["phase"] == "receipt" and receipt["attempts"] == 1
            outcome = worker("interlink_worker_ack", args + ",'retry','{\"phase\":\"send\",\"code\":\"MessageRateExceeded\",\"delaySeconds\":60}'")
            assert outcome["status"] == ("failed" if attempt == 8 else "retry")
        assert worker("interlink_worker_claim", "'push',20") == []
        assert sql(f"SELECT send_attempts FROM interlink.jobs WHERE id={literal(rejected_receipts)};") == "8"
        command(ADMIN, "admin.job.retry", {"id": rejected_receipts, "note": "가상 제공자 장애 조치 후 재시도"}, aal="aal2")
        assert sql(f"SELECT attempts||':'||send_attempts FROM interlink.jobs WHERE id={literal(rejected_receipts)};") == "0:0"
        sent, args = claim_push(rejected_receipts)
        assert sent["attempts"] == 1
        worker("interlink_worker_ack", args + ",'done','{\"reason\":\"fixture_complete\"}'")
        passed("final send retains bounded receipt allowance; pending polls and rejected-receipt resend cycles exhaust safely")

        avatar = f"{B}/{uuid.uuid4()}.jpeg"
        sql(f"INSERT INTO storage.objects(bucket_id,name) VALUES('avatars',{literal(avatar)});", user=B, expect="row-level security")
        sql(f"INSERT INTO storage.objects(bucket_id,name) VALUES('avatars',{literal(avatar)});", role="service_role")
        assert sql(f"SELECT count(*) FROM storage.objects WHERE name={literal(avatar)};", user=A) == "0"
        sql(f"UPDATE interlink.profiles SET avatar={literal(avatar)} WHERE id={literal(B)};")
        assert sql(f"SELECT count(*) FROM storage.objects WHERE name={literal(avatar)};", user=A) == "1"
        assert sql(f"SELECT count(*) FROM storage.objects WHERE name={literal(avatar)};", user=OUT) == "0"
        sql(f"UPDATE storage.objects SET name={literal(avatar+'.bad')} WHERE name={literal(avatar)};", user=A)
        assert sql(f"SELECT count(*) FROM storage.objects WHERE name={literal(avatar)};") == "1"
        passed("private Storage scope, denied direct upload/overwrite, service-only write path")

        command(B, "account.delete", {"confirmation": "DELETE", "ownedTeams": "archive"}, recent=False, expect="UNAUTHENTICATED")
        deletion = command(B, "account.delete", {"confirmation": "DELETE", "ownedTeams": "archive"})
        assert deletion["status"] == "requested" and query(B, "account.status")["status"] == "deleting"
        query(B, "projects.search", expect="FORBIDDEN")
        sql(f"INSERT INTO storage.objects(bucket_id,name) VALUES('avatars',{literal(B+'/'+str(uuid.uuid4())+'.jpeg')});", role="service_role", expect="FORBIDDEN")
        dj = worker("interlink_worker_claim", "'deletion',20")[0]
        args = literal(dj["id"]) + "," + literal(dj["leaseToken"])
        worker("interlink_worker_ack", args + ",'retry','{\"code\":\"STORAGE_TEMPORARY\",\"delaySeconds\":60}'")
        sql(f"UPDATE interlink.jobs SET next_attempt_at=now(),attempts=7 WHERE id={literal(dj['id'])};")
        dj = worker("interlink_worker_claim", "'deletion',20")[0]
        assert dj["phase"] == "files" and dj["attempts"] == 8
        sql(f"DELETE FROM storage.objects WHERE name={literal(avatar)};", role="service_role")
        args = literal(dj["id"]) + "," + literal(dj["leaseToken"])
        worker("interlink_worker_ack", args + ",'auth','{}'")
        assert sql(f"SELECT attempts FROM interlink.jobs WHERE id={literal(dj['id'])};") == "0"
        dj = worker("interlink_worker_claim", "'deletion',20")[0]
        assert dj["phase"] == "auth" and dj["attempts"] == 1
        args = literal(dj["id"]) + "," + literal(dj["leaseToken"])
        worker("interlink_deletion_finalize", args, expect="CONFLICT")
        sql(f"DELETE FROM auth.users WHERE id={literal(B)};")
        assert worker("interlink_deletion_finalize", args)["status"] == "completed"
        assert sql(f"SELECT status FROM interlink.accounts WHERE id={literal(B)};") == "deleted"
        assert sql(f"SELECT count(*) FROM interlink.devices WHERE user_id={literal(B)};") == "0"
        assert sql(f"SELECT count(*) FROM interlink.applications WHERE user_id={literal(B)} AND introduction<>'';") == "0"
        passed("recent authentication, deletion revocation, upload guard and final-file-attempt Auth cleanup")

        pending_avatar = f"{new_user}/{uuid.uuid4()}.jpeg"
        sql(f"INSERT INTO storage.objects(bucket_id,name) VALUES('avatars',{literal(pending_avatar)});", role="service_role")
        pending_deletion = command(new_user, "account.delete", {"confirmation": "DELETE", "ownedTeams": "archive"})
        sql(f"UPDATE interlink.jobs SET attempts=7 WHERE deletion_request_id={literal(pending_deletion['id'])};")
        pending_job = worker("interlink_worker_claim", "'deletion',20")[0]
        assert pending_job["phase"] == "files" and pending_job["attempts"] == 8
        args = literal(pending_job["id"]) + "," + literal(pending_job["leaseToken"])
        assert worker("interlink_worker_ack", args + ",'retry','{\"code\":\"FILES_REMAIN\",\"delaySeconds\":5}'")["status"] == "failed"
        assert worker("interlink_worker_claim", "'deletion',20") == []
        assert sql(f"SELECT phase FROM interlink.jobs WHERE id={literal(pending_job['id'])};") == "files"
        assert query(new_user, "account.status")["deletionStatus"] == "failed"
        assert sql(f"SELECT count(*) FROM auth.users WHERE id={literal(new_user)};") == "1"
        assert sql(f"SELECT count(*) FROM storage.objects WHERE name={literal(pending_avatar)};") == "1"
        passed("incomplete file batches retain a bounded retry budget and cannot advance Auth deletion")

        command(ADMIN, "admin.action", {"targetType": "profile", "targetId": C, "action": "suspend", "note": "가상 계정 정지 테스트"}, aal="aal2")
        query(C, "projects.search", expect="FORBIDDEN")
        assert sql("SELECT count(*) FROM public.change_events;", user=C) == "0"
        command(ADMIN, "admin.action", {"targetType": "profile", "targetId": C, "action": "reactivate", "note": "가상 계정 정지 해제"}, aal="aal2")
        passed("account suspension enforces RPC and existing event row authorization")

        profile = query(A, 'people.detail', {'id': A})
        editable = {key: profile[key] for key in ['nickname','avatar','interests','roles','learningRoles','skills','availability','activityMode','bio','discoverable','links']}
        command(A, 'profile.update', {**editable, 'bio': '가상 프로필 수정 검증', 'links': ['https://example.invalid/project']})
        draft_data = {**project('가상 상태 전이 테스트'), 'status': 'draft'}
        draft = command(A, 'project.create', draft_data)['id']
        command(A, 'project.update', {**draft_data, 'id': draft, 'title': '가상 수정된 초안'})
        command(A, 'project.transition', {'id': draft, 'status': 'recruiting'})
        command(C, 'project.save', {'id': draft, 'saved': True})
        assert draft in [p['id'] for p in query(C, 'saved.list')['items']]
        command(C, 'project.save', {'id': draft, 'saved': False})
        ca = command(C, 'application.submit', {'projectId': draft, 'role': '개발', 'introduction': '가상 거절 상태 검증'})['id']
        command(A, 'application.review', {'id': ca, 'decision': 'rejected'})
        ca = command(C, 'application.submit', {'projectId': draft, 'role': '개발', 'introduction': '가상 철회 상태 검증'})['id']
        command(C, 'application.withdraw', {'id': ca})
        ci = command(A, 'invitation.send', {'projectId': draft, 'inviteeId': C, 'role': '개발', 'message': '가상 거절 초대'})['id']
        command(C, 'invitation.respond', {'id': ci, 'decision': 'declined'})
        ci = command(A, 'invitation.send', {'projectId': draft, 'inviteeId': C, 'role': '개발', 'message': '가상 취소 초대'})['id']
        command(A, 'invitation.cancel', {'id': ci})
        ci = command(A, 'invitation.send', {'projectId': draft, 'inviteeId': C, 'role': '개발', 'message': '가상 참여 초대'})['id']
        command(C, 'invitation.respond', {'id': ci, 'decision': 'accepted'})
        assert len(query(C, 'teams.members', {'projectId': draft})['items']) == 2
        command(C, 'membership.leave', {'projectId': draft})
        command(A, 'project.transition', {'id': draft, 'status': 'active'})
        command(A, 'project.transition', {'id': draft, 'status': 'completed'})
        command(A, 'project.transition', {'id': draft, 'status': 'archived'})
        command(A, 'membership.leave', {'projectId': draft})
        note = query(A, 'notifications.list')['items'][0]
        command(A, 'notification.read', {'id': note['id']})
        assert query(A, 'notifications.preferences')['push'] is True
        assert isinstance(query(A, 'blocks.list')['items'], list)
        for operation in ['admin.overview', 'admin.reports', 'admin.audit', 'admin.jobs', 'admin.communities']:
            assert query(ADMIN, operation, aal='aal2') is not None
        community = command(ADMIN, 'admin.community', {'name': '가상 운영 커뮤니티', 'status': 'active'}, aal='aal2')['id']
        command(ADMIN, 'admin.community', {'id': community, 'name': '가상 종료 커뮤니티', 'status': 'closed'}, aal='aal2')
        command(ADMIN, 'admin.invite', {'communityId': community, 'maxUses': 1, 'expiresAt': '2099-01-01T00:00:00Z'}, aal='aal2', expect='VALIDATION')
        command(A, 'device.unregister', {'token': token})
        failed_job = sql(f"INSERT INTO interlink.jobs(kind,user_id,phase,status,attempts) VALUES('push',{literal(A)},'send','failed',8) RETURNING id;")
        command(ADMIN, 'admin.job.retry', {'id': failed_job, 'note': '가상 실패 작업 검토 후 재시도'}, aal='aal2')
        assert sql(f"SELECT attempts FROM interlink.jobs WHERE id={literal(failed_job)};") == '0'
        worker('interlink_maintenance')
        passed('profile/project edits, lifecycle, saved state, reject/withdraw/decline/cancel/leave, all admin/read branches')

        # Two messages sharing one server timestamp must preserve a total read order.
        sql(f"INSERT INTO interlink.memberships(project_id,user_id,role) VALUES({literal(P2)},{literal(C)},'개발');")
        mlow, mhigh = '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002'
        sql(f"INSERT INTO interlink.messages(id,project_id,author_id,body,client_id,created_at) VALUES({literal(mlow)},{literal(P2)},{literal(A)},'같은 시각 첫 메시지',gen_random_uuid(),'2098-01-01'),({literal(mhigh)},{literal(P2)},{literal(A)},'같은 시각 다음 메시지',gen_random_uuid(),'2098-01-01');")
        command(C, 'message.read', {'projectId': P2, 'messageId': mlow})
        assert next(p for p in query(C, 'teams.mine')['items'] if p['id'] == P2)['unreadCount'] == 1
        command(C, 'message.read', {'projectId': P2, 'messageId': mhigh})
        command(C, 'message.read', {'projectId': P2, 'messageId': mlow})
        assert next(p for p in query(C, 'teams.mine')['items'] if p['id'] == P2)['unreadCount'] == 0
        command(C, 'block.set', {'userId': A, 'blocked': True})
        assert all(m['body'] == '' for m in query(C, 'messages.list', {'projectId': P2})['items'] if m['authorId'] == A)
        command(C, 'block.set', {'userId': A, 'blocked': True})
        command(C, 'block.set', {'userId': A, 'blocked': False})
        passed('equal-timestamp read ordering, stale read prevention, blocked message body redaction')

        # Hold an account deletion transaction open to force admission/transfer overlap.
        candidate = '10000000-0000-4000-8000-000000000007'
        successor = '10000000-0000-4000-8000-000000000008'
        sql(f"INSERT INTO auth.users(id) VALUES({literal(candidate)}),({literal(successor)}); INSERT INTO interlink.community_members(community_id,user_id) VALUES({literal(COMMUNITY)},{literal(candidate)}),({literal(COMMUNITY)},{literal(successor)}); UPDATE interlink.profiles SET community_id={literal(COMMUNITY)},discoverable=true WHERE id IN ({literal(candidate)},{literal(successor)});")
        race_project = command(A, 'project.create', project('가상 삭제 경합 테스트'))['id']
        race_app = command(candidate, 'application.submit', {'projectId': race_project, 'role': '개발', 'introduction': '삭제와 동시 승인 검증'})['id']
        sql(f"INSERT INTO interlink.memberships(project_id,user_id,role) VALUES({literal(race_project)},{literal(successor)},'개발'); CREATE FUNCTION public.test_pause_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='deleting' AND OLD.status='active' THEN PERFORM pg_sleep(0.5); END IF; RETURN NEW; END $$; CREATE TRIGGER test_pause BEFORE UPDATE ON interlink.accounts FOR EACH ROW EXECUTE FUNCTION public.test_pause_delete();")
        def allowed_race(fn):
            try:
                return fn()
            except AssertionError as error:
                assert any(code in str(error) for code in ['FORBIDDEN', 'CONFLICT', 'NOT_FOUND']), str(error)
                assert 'UNAVAILABLE' not in str(error) and 'deadlock' not in str(error), str(error)
                return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            deleting = pool.submit(command, candidate, 'account.delete', {'confirmation': 'DELETE', 'ownedTeams': 'archive'})
            time.sleep(0.1)
            review = pool.submit(allowed_race, lambda: command(A, 'application.review', {'id': race_app, 'decision': 'approved'}))
            deleting.result(); review.result()
        assert sql(f"SELECT count(*) FROM interlink.memberships WHERE project_id={literal(race_project)} AND user_id={literal(candidate)} AND active;") == '0'
        with ThreadPoolExecutor(max_workers=2) as pool:
            deleting = pool.submit(command, successor, 'account.delete', {'confirmation': 'DELETE', 'ownedTeams': 'archive'})
            time.sleep(0.1)
            transfer = pool.submit(allowed_race, lambda: command(A, 'membership.transfer', {'projectId': race_project, 'userId': successor}))
            deleting.result(); transfer.result()
        assert sql(f"SELECT count(*) FROM interlink.projects WHERE id={literal(race_project)} AND owner_id={literal(successor)} AND status<>'archived';") == '0'
        sql('DROP TRIGGER test_pause ON interlink.accounts; DROP FUNCTION public.test_pause_delete();')
        passed('real concurrent deletion versus approval/ownership-transfer; no deadlock or resurrection')

        history = query(C, 'teams.history')['items']
        former = next(p for p in history if p['id'] == draft)
        assert former['goal'] == '' and former['description'] == '' and former['roles'] == []
        assert former['memberCount'] == 0 and former['unreadCount'] == 0
        assert draft not in [p['id'] for p in query(C, 'teams.mine')['items']]
        assert query(OUT, 'teams.history')['items'] == []
        query(C, 'teams.members', {'projectId': draft}, expect='FORBIDDEN')
        query(C, 'messages.list', {'projectId': draft}, expect='FORBIDDEN')
        query(OUT, 'messages.list', {'projectId': draft}, expect='FORBIDDEN')
        # A real past membership remains sufficient for a private experience.
        recorded = command(C, 'experience.save', {'projectId': draft, 'title': '탈퇴한 팀의 실제 참여 이력', 'description': '팀을 떠난 뒤 가상 참여 경험을 기록해요.', 'role': '개발', 'isPublic': False})['id']
        assert recorded in [e['id'] for e in query(C, 'experiences.list')['items']]
        command(OUT, 'experience.save', {'projectId': draft, 'title': '무관한 사용자', 'description': '참여 이력이 없으므로 거절됩니다.', 'role': '개발', 'isPublic': False}, expect='FORBIDDEN')
        sql(f"UPDATE interlink.projects SET hidden=true WHERE id={literal(draft)};")
        assert draft not in [p['id'] for p in query(C, 'teams.history')['items']]
        sql(f"UPDATE interlink.projects SET hidden=false WHERE id={literal(draft)}; UPDATE interlink.community_members SET status='revoked' WHERE community_id={literal(COMMUNITY)} AND user_id={literal(C)};")
        assert query(C, 'teams.history')['items'] == []
        sql(f"UPDATE interlink.community_members SET status='approved' WHERE community_id={literal(COMMUNITY)} AND user_id={literal(C)};")
        first_history = query(C, 'teams.history', {'limit': 1})
        next_history = query(C, 'teams.history', {'limit': 1, 'cursor': first_history['nextCursor']})
        assert first_history['nextCursor'] is not None and first_history['items'][0]['id'] != next_history['items'][0]['id']
        passed('paginated former-team history, minimal metadata, scope checks and experience eligibility')

        # An old failed job must remain reachable beyond the default 20-row page.
        old_job = sql(f"INSERT INTO interlink.jobs(kind,user_id,phase,status,attempts,created_at) VALUES('push',{literal(A)},'send','failed',8,'2000-01-01') RETURNING id;")
        sql(f"INSERT INTO interlink.jobs(kind,user_id,phase,status) SELECT 'push',{literal(A)},'send','completed' FROM generate_series(1,25);")
        first_jobs = query(ADMIN, 'admin.jobs', {'limit': 20}, aal='aal2')
        assert len(first_jobs['items']) == 20 and first_jobs['nextCursor'] is not None
        assert old_job not in [j['id'] for j in first_jobs['items']]
        seen_jobs = {j['id'] for j in first_jobs['items']}
        cursor = first_jobs['nextCursor']
        for _ in range(10):
            if cursor is None:
                break
            page_jobs = query(ADMIN, 'admin.jobs', {'limit': 20, 'cursor': cursor}, aal='aal2')
            ids = {j['id'] for j in page_jobs['items']}
            assert not (seen_jobs & ids)
            seen_jobs.update(ids)
            cursor = page_jobs['nextCursor']
        assert cursor is None and old_job in seen_jobs
        command(ADMIN, 'admin.job.retry', {'id': old_job, 'note': '이전 페이지의 오래된 실패 작업 검토'}, aal='aal2')
        assert sql(f"SELECT status FROM interlink.jobs WHERE id={literal(old_job)};") == 'retry'
        # Existing Page endpoints accept the same bounded cursor/limit contract.
        for saved_project in [P1, P2]:
            command(A, 'project.save', {'id': saved_project, 'saved': True})
            command(A, 'experience.save', {'projectId': saved_project, 'title': '페이지별 가상 경험', 'description': '여러 경험이 페이지로 이어지는지 확인합니다.', 'role': '팀장', 'isPublic': False})
        for blocked_user in [C, ADMIN]:
            command(A, 'block.set', {'userId': blocked_user, 'blocked': True})
        checks = [(A, 'teams.mine', {}, {}), (A, 'teams.members', {'projectId': P2}, {}),
                  (A, 'applications.list', {}, {}), (A, 'invitations.list', {}, {}),
                  (A, 'saved.list', {}, {}), (A, 'experiences.list', {}, {}), (A, 'blocks.list', {}, {}),
                  (ADMIN, 'admin.communities', {}, {'aal': 'aal2'})]
        for actor, operation, payload, options in checks:
            page_one = query(actor, operation, {**payload, 'limit': 1}, **options)
            assert len(page_one['items']) == 1 and page_one['nextCursor'] is not None, operation
            page_two = query(actor, operation, {**payload, 'limit': 1, 'cursor': page_one['nextCursor']}, **options)
            assert page_one['items'][0]['id'] != page_two['items'][0]['id'], operation
        for blocked_user in [C, ADMIN]:
            command(A, 'block.set', {'userId': blocked_user, 'blocked': False})
        passed('old admin failures reachable and retryable after pagination; shared Page endpoints honor cursors')

        sql(f"INSERT INTO interlink.memberships(project_id,user_id,role) VALUES({literal(race_project)},{literal(C)},'개발'); INSERT INTO interlink.messages(project_id,author_id,body,client_id,created_at) VALUES({literal(P2)},{literal(A)},'전체 집계 첫 팀',gen_random_uuid(),'2099-01-02'),({literal(race_project)},{literal(A)},'전체 집계 다른 팀',gen_random_uuid(),'2099-01-02'),({literal(race_project)},{literal(C)},'본인 메시지 제외',gen_random_uuid(),'2099-01-02'); INSERT INTO interlink.messages(project_id,author_id,body,client_id,created_at,deleted) VALUES({literal(race_project)},{literal(A)},'',gen_random_uuid(),'2099-01-02',true); INSERT INTO interlink.messages(project_id,author_id,body,client_id,created_at,hidden) VALUES({literal(race_project)},{literal(A)},'운영자가 숨긴 메시지 제외',gen_random_uuid(),'2099-01-02',true);")
        assert query(C, 'bootstrap')['messageUnreadCount'] == 2
        assert sum(p['unreadCount'] for p in query(C, 'teams.mine', {'limit': 1})['items']) == 1
        sql(f"INSERT INTO interlink.notifications(user_id,actor_id,type,title,project_id) VALUES({literal(C)},{literal(A)},'team.updated','차단 후 배지 일치 검증',{literal(race_project)});")
        assert query(C, 'bootstrap')['unreadCount'] == sum(not n['read'] for n in query(C, 'notifications.list', {'limit': 50})['items'])
        command(C, 'block.set', {'userId': A, 'blocked': True})
        assert query(C, 'bootstrap')['messageUnreadCount'] == 0
        assert query(C, 'bootstrap')['unreadCount'] == sum(not n['read'] for n in query(C, 'notifications.list', {'limit': 50})['items']) == 0
        command(C, 'block.set', {'userId': A, 'blocked': False})
        sql(f"UPDATE interlink.communities SET status='closed' WHERE id={literal(COMMUNITY)};")
        assert query(C, 'bootstrap')['messageUnreadCount'] == 0
        sql(f"UPDATE interlink.communities SET status='active' WHERE id={literal(COMMUNITY)};")
        assert query(C, 'bootstrap')['messageUnreadCount'] == 2
        passed('global chat unread badge spans all pages and excludes self/deleted/hidden/blocked/inaccessible content')

        from request_history import run_request_history_checks
        from event_invalidations import run_event_invalidation_checks
        from team_actions import run_team_action_checks
        from profile_onboarding import run_profile_onboarding_checks
        import sys
        run_request_history_checks(sys.modules[__name__])
        run_event_invalidation_checks(sys.modules[__name__])
        run_team_action_checks(sys.modules[__name__])
        run_profile_onboarding_checks(sys.modules[__name__])

        print(f"\n{len(PASSED)} PostgreSQL integration groups passed. No remote services, Auth provider, realtime sockets or push delivery were used.", flush=True)
    finally:
        stop_database()


if __name__ == "__main__":
    main()
