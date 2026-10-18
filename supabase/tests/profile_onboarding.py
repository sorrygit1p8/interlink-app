"""Isolated profile setup checks for the disposable PostgreSQL runner only."""
import json
import uuid


def run_profile_onboarding_checks(h):
    lit = h.literal
    user, other = str(uuid.uuid4()), str(uuid.uuid4())
    for actor in (user, other):
        h.sql(f"INSERT INTO auth.users(id) VALUES({lit(actor)});")
    initial = h.query(user, 'bootstrap')['viewer']
    assert initial['educationLevel'] is None and initial['onboardingCompleted'] is False
    profile = dict(nickname='내 가상 별명', avatar='leaf', interests=['환경'], roles=[],
                   learningRoles=[], skills=[], availability=[], activityMode='online',
                   bio='보존할 가상 소개', discoverable=False, links=[])
    setup = dict(profile, educationLevel='high', onboardingCompleted=True)
    for patch in ({'educationLevel': 'graduate'}, {'educationLevel': 1},
                  {'educationLevel': None}, {'interests': []}, {'nickname': ' '},
                  {'onboardingCompleted': 'true'}):
        h.command(user, 'profile.update', dict(setup, **patch), expect='VALIDATION')
    h.command(user, 'profile.update', dict(profile, onboardingCompleted=True), expect='VALIDATION')
    key = str(uuid.uuid4())
    h.sql(f"BEGIN; SELECT public.interlink_command('profile.update',{lit(json.dumps(setup))}::jsonb,{lit(key)}::uuid); ROLLBACK;", user=user)
    assert h.query(user, 'bootstrap')['viewer'] == initial
    assert h.sql(f"SELECT count(*) FROM interlink.idempotency WHERE user_id={lit(user)} AND key={lit(key)};") == '0'
    result = h.command(user, 'profile.update', setup, key)
    assert result == {'id': user}
    assert h.command(user, 'profile.update', setup, key) == result
    updated = h.query(user, 'bootstrap')['viewer']
    assert updated['nickname'] == setup['nickname'] and updated['interests'] == setup['interests']
    assert updated['educationLevel'] == 'high' and updated['onboardingCompleted'] is True
    h.passed('profile setup validates required choices and persists atomically with rollback and idempotent replay')

    h.command(user, 'profile.update', dict(profile, discoverable=True))
    updated = h.query(user, 'bootstrap')['viewer']
    assert updated['discoverable'] is True and updated['educationLevel'] == 'high' and updated['onboardingCompleted'] is True
    h.command(user, 'profile.update', dict(profile, educationLevel='middle'))
    updated = h.query(user, 'bootstrap')['viewer']
    assert updated['educationLevel'] == 'middle' and updated['onboardingCompleted'] is True
    for patch in ({'onboardingCompleted': False}, {'educationLevel': None}, {'interests': []}):
        h.command(user, 'profile.update', dict(profile, **patch), expect='VALIDATION')
        assert h.query(user, 'bootstrap')['viewer'] == updated
    h.command(other, 'profile.update', dict(setup, id=user), expect='VALIDATION')
    assert h.query(user, 'bootstrap')['viewer'] == updated
    assert h.query(other, 'bootstrap')['viewer']['onboardingCompleted'] is False
    h.passed('ordinary profile payloads preserve omitted setup fields; completed setup stays valid and actor-scoped')

    deletion = h.command(user, 'account.delete', {'confirmation': 'DELETE', 'ownedTeams': 'archive'})
    job = h.sql(f"SELECT id FROM interlink.jobs WHERE deletion_request_id={lit(deletion['id'])};")
    lease = str(uuid.uuid4())
    # Prepare the existing finalizer's authorized post-Auth phase without any
    # external provider. The general runner separately checks job lease phases.
    h.sql(f"UPDATE interlink.jobs SET phase='auth',status='processing',lease_token={lit(lease)},lease_until=now()+interval '5 minutes' WHERE id={lit(job)};")
    h.sql(f"DELETE FROM auth.users WHERE id={lit(user)};")
    assert h.worker('interlink_deletion_finalize', lit(job) + ',' + lit(lease))['status'] == 'completed'
    assert h.sql(f"SELECT education_level IS NULL AND NOT onboarding_completed AND cardinality(interests)=0 FROM interlink.profiles WHERE id={lit(user)};") == 't'
    assert h.query(other, 'bootstrap')['viewer']['onboardingCompleted'] is False
    h.passed('authorized deletion finalizer erases school and completion metadata without affecting another account')
