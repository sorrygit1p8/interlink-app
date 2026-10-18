import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOperationsClient } from '../../apps/web/lib/browser-client';

const community = { name: '가상 재시도 확인', status: 'active' as const };
const reply = (id: string) => new Response(JSON.stringify({ result: { id } }), { status: 200 });
const requestBody = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index: number) => JSON.parse(String(fetcher.mock.calls[index]?.[1]?.body)) as { input: unknown; idempotencyKey: string };

afterEach(() => { vi.unstubAllGlobals(); });

describe('operations browser mutation transport (mock HTTP only)', () => {
  it('shares one request for equal commands while its response is pending', async () => {
    const response = Promise.withResolvers<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetcher);
    const client = createOperationsClient();

    const first = client.command('admin.community', community);
    const second = client.command('admin.community', { ...community });
    expect(fetcher).toHaveBeenCalledOnce();

    response.resolve(reply('one-community'));
    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 'one-community' }, { id: 'one-community' }]);
  });

  it('keeps different command payloads independent while both are pending', async () => {
    const firstResponse = Promise.withResolvers<Response>();
    const secondResponse = Promise.withResolvers<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(firstResponse.promise).mockReturnValueOnce(secondResponse.promise);
    vi.stubGlobal('fetch', fetcher);
    const client = createOperationsClient();

    const first = client.command('admin.community', community);
    const second = client.command('admin.community', { ...community, name: '별개의 가상 커뮤니티' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requestBody(fetcher, 0).idempotencyKey).not.toBe(requestBody(fetcher, 1).idempotencyKey);

    firstResponse.resolve(reply('first-community')); secondResponse.resolve(reply('second-community'));
    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 'first-community' }, { id: 'second-community' }]);
  });

  it('reuses the original key and payload after a lost response despite a new caller key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Lost response')).mockResolvedValueOnce(reply('committed-community'));
    vi.stubGlobal('fetch', fetcher);
    const client = createOperationsClient();
    const firstKey = crypto.randomUUID();

    await expect(client.command('admin.community', community, firstKey)).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(client.command('admin.community', community, crypto.randomUUID())).resolves.toEqual({ id: 'committed-community' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requestBody(fetcher, 0)).toEqual(requestBody(fetcher, 1));
    expect(requestBody(fetcher, 1).idempotencyKey).toBe(firstKey);
  });

  it('starts a new intent with a new key after the shared command succeeds', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply('first-community')).mockResolvedValueOnce(reply('new-community'));
    vi.stubGlobal('fetch', fetcher);
    const client = createOperationsClient();

    await expect(client.command('admin.community', community)).resolves.toEqual({ id: 'first-community' });
    await expect(client.command('admin.community', community)).resolves.toEqual({ id: 'new-community' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requestBody(fetcher, 0).idempotencyKey).not.toBe(requestBody(fetcher, 1).idempotencyKey);
  });

  it('retains the key when a successful HTTP response body cannot be read', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('truncated JSON', { status: 200 })).mockResolvedValueOnce(reply('committed-community'));
    vi.stubGlobal('fetch', fetcher);
    const client = createOperationsClient();

    await expect(client.command('admin.community', community)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(client.command('admin.community', community)).resolves.toEqual({ id: 'committed-community' });
    expect(requestBody(fetcher, 0)).toEqual(requestBody(fetcher, 1));
  });
});
