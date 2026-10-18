import React, { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, Platform, Pressable, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { createDataClient, createSecureStorageAdapter, createQueryReconciler, type DemoClient, type SupabaseDataClient } from '@interlink/data';
import { type DataClient, type QueryMap, type QueryName, type CommandMap, type CommandName, type Page, AppError } from '@interlink/shared';
import { Button, C, ErrorState, Loading, Panel, Screen, T, s } from './ui';
import { attachPushListeners } from './push';
import { useReducedMotion } from './accessibility';
import { router, usePreventRemove } from 'expo-router';
type Scenario = 'normal' | 'empty' | 'offline' | 'error';
type Actor = 'A' | 'B' | 'C';
type Runtime = {
    client: DataClient;
    actor: DemoClient['actor'] | null;
    sessionUser: string | null;
    chooseActor: (actor: Actor) => Promise<void>;
    reset: () => Promise<void>;
    scenario: Scenario;
    setScenario: (v: Scenario) => void;
    toast: (text: string) => void;
    confirm: (title: string, message: string, action?: string, destructive?: boolean) => Promise<boolean>;
};
const RuntimeContext = createContext<Runtime | null>(null);
export const env = { mode: process.env.EXPO_PUBLIC_DATA_MODE || 'demo', environment: process.env.EXPO_PUBLIC_APP_ENV || 'development' };
export function useRuntime() { const context = useContext(RuntimeContext); if (!context)
    throw new Error('App provider missing'); return context; }
export function useData<K extends QueryName>(name: K, input: QueryMap[K]['input'], enabled = true) {
    const { client, actor, sessionUser, scenario } = useRuntime();
    return useQuery<QueryMap[K]['output']>({ queryKey: [client.mode, client.mode === 'demo' ? actor : sessionUser, name, input, scenario], queryFn: async ({ signal }) => {
            if (client.mode === 'demo' && scenario === 'offline')
                throw new AppError('NETWORK', '오프라인 상황을 체험 중이에요. 설정에서 정상 상태로 돌아갈 수 있어요.', true);
            if (client.mode === 'demo' && scenario === 'error')
                throw new AppError('UNAVAILABLE', '일시적인 서비스 오류 체험 중이에요. 설정에서 정상 상태로 돌아갈 수 있어요.', true);
            const result = await client.query(name, input, { signal });
            if (client.mode === 'demo' && scenario === 'empty' && result && typeof result === 'object' && 'items' in result)
                return { ...result, items: [], nextCursor: null } as QueryMap[K]['output'];
            return result;
        }, enabled, retry: (count, error) => count < 1 && error instanceof AppError && error.retryable, staleTime: 15000 });
}
export function useCommand() {
    const { client, toast, scenario } = useRuntime();
    const cache = useQueryClient();
    const [pending, setPending] = useState(false);
    const lock = useRef(false);
    async function run<K extends CommandName>(name: K, input: CommandMap[K]['input'], success?: string, idempotencyKey?: string) {
        if (lock.current)
            return null;
        lock.current = true;
        setPending(true);
        try {
            if (client.mode === 'demo' && (scenario === 'offline' || scenario === 'error'))
                throw new AppError('NETWORK', '체험 중인 연결 상태에서는 전송할 수 없어요. 정상 상태로 복구한 뒤 다시 시도해 주세요.');
            const result = await client.command(name, input, idempotencyKey);
            await cache.invalidateQueries();
            if (success)
                toast(success);
            return result;
        }
        catch (e) {
            toast(e instanceof AppError ? e.message : '요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
            return null;
        }
        finally {
            setPending(false);
            lock.current = false;
        }
    }
    return { run, pending };
}
type PaginatedName = { [K in QueryName]: QueryMap[K]['output'] extends Page<unknown> ? K : never }[QueryName];
type PageItem<K extends PaginatedName> = QueryMap[K]['output'] extends Page<infer Item> ? Item : never;
export function usePagedData<K extends PaginatedName>(name: K, input: QueryMap[K]['input'], enabled = true) {
    const { client, actor, sessionUser, scenario } = useRuntime();
    const query = useInfiniteQuery({
        queryKey: [client.mode, client.mode === 'demo' ? actor : sessionUser, name, 'pages', input, scenario],
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam, signal }): Promise<Page<PageItem<K>>> => {
            if (client.mode === 'demo' && (scenario === 'offline' || scenario === 'error')) throw new AppError('NETWORK', '연결 오류 상황을 체험 중이에요. 설정에서 정상 상태로 돌아갈 수 있어요.');
            if (client.mode === 'demo' && scenario === 'empty') return { items: [], nextCursor: null };
            return await client.query(name, { limit: 20, ...input, cursor: pageParam } as QueryMap[K]['input'], { signal }) as Page<PageItem<K>>;
        },
        getNextPageParam: page => page.nextCursor || undefined,
        staleTime: 15000, retry: 1, enabled,
    });
    const data=useMemo(()=>query.data ? {items:query.data.pages.flatMap(page=>page.items),nextCursor:query.data.pages.at(-1)?.nextCursor||null} : undefined,[query.data]);
    return { ...query, data };
}
/** Every loaded chat page stays in the query cache, so invalidation refreshes older pages too. */
export function useMessagePages(projectId: string) {
    const { client, actor, sessionUser, scenario } = useRuntime();
    return useInfiniteQuery({
        queryKey: [client.mode, client.mode === 'demo' ? actor : sessionUser, 'messages.pages', projectId, scenario],
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam, signal }) => {
            if (client.mode === 'demo' && (scenario === 'offline' || scenario === 'error')) throw new AppError('NETWORK', '연결 오류 상황을 체험 중이에요. 설정에서 정상 상태로 돌아갈 수 있어요.');
            if (client.mode === 'demo' && scenario === 'empty') return { items: [], nextCursor: null };
            return client.query('messages.list', { projectId, limit: 30, cursor: pageParam }, { signal });
        },
        getNextPageParam: page => page.nextCursor || undefined,
        staleTime: 15000, retry: 1,
    });
}
export function useUnsavedChanges(dirty: boolean) {
    const { confirm } = useRuntime();
    const [discarded, setDiscarded] = useState(false);
    const disable = usePreventRemove(dirty && !discarded, ({ repeat }) => { void (async () => { if (await confirm('작성을 멈출까요?', '저장하지 않은 내용은 사라져요.', '작성 그만두기')) {
        setDiscarded(true);
        repeat();
    } })(); });
    return () => { setDiscarded(true); disable(); };
}
export function AppProvider({ children }: {
    children: ReactNode;
}) {
    const reducedMotion = useReducedMotion();
    const [cache] = useState(() => new QueryClient());
    const [client, setClient] = useState<DataClient | null>(null);
    const initializedClient = useRef<DataClient | null>(null);
    const [recovering,setRecovering]=useState(false);
    const [recoveryAsked,setRecoveryAsked]=useState(false);
    const [error, setError] = useState<unknown>();
    const [actor, setActor] = useState<DemoClient['actor'] | null>(null);
    const [sessionUser, setSessionUser] = useState<string | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [scenario, setScenario] = useState<Scenario>('normal');
    const [message, setMessage] = useState('');
    const [confirmation, setConfirmation] = useState<{
        title: string;
        message: string;
        action: string;
        destructive: boolean;
        resolve: (v: boolean) => void;
    } | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => {
        let alive = true;
        let activeClient: DataClient | undefined;
        async function init() {
            try {
                if (!['demo', 'supabase'].includes(env.mode) || !['development', 'staging', 'production'].includes(env.environment))
                    throw new AppError('CONFIGURATION', '실행 모드 또는 환경 설정을 확인해 주세요.');
                const storage = env.mode === 'demo' ? AsyncStorage : Platform.OS === 'web' ? { getItem: (k: string) => typeof window !== 'undefined' ? window.sessionStorage.getItem(k) : null, setItem: (k: string, v: string) => window.sessionStorage.setItem(k, v), removeItem: (k: string) => window.sessionStorage.removeItem(k) } : createSecureStorageAdapter(SecureStore);
                activeClient = createDataClient({ mode: env.mode as 'demo' | 'supabase', environment: env.environment as 'development' | 'staging' | 'production', url: process.env.EXPO_PUBLIC_SUPABASE_URL, anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, storage, randomUUID: Crypto.randomUUID });
                initializedClient.current=activeClient;
                if (activeClient.mode === 'demo') {
                    const demo = activeClient as DemoClient;
                    await demo.ready();
                    if (alive) setActor(demo.actor);
                }
                if (alive)
                    setClient(activeClient);
            }
            catch (e) {
                if (alive)
                    setError(e);
            }
        }
        void init();
        return () => { alive = false; activeClient?.dispose(); };
    }, []);
    useEffect(() => {
        if (!client) return;
        const reconciler = createQueryReconciler(cache);
        const unsubscribe = client.subscribe(reconciler.request);
        return () => { reconciler.dispose(); unsubscribe(); };
    }, [client, cache]);
    useEffect(() => { if (!client || client.mode !== 'supabase')
        return; const subscription = AppState.addEventListener('change', state => { (client as SupabaseDataClient).setForeground(state === 'active'); if (state === 'active')
        void cache.invalidateQueries(); }); return () => subscription.remove(); }, [client, cache]);
    useEffect(() => {
        if (!client || client.mode !== 'supabase') return;
        let lastUser: string | null = null; let revision = 0; let alive = true;
        const update = (id: string | null) => {
            if (!alive) return;
            if (id !== lastUser) { void cache.cancelQueries(); cache.clear(); lastUser = id; setSessionUser(id); }
            setAuthReady(true);
        };
        const unsubscribe = (client as SupabaseDataClient).onAuthStateChange((_event, session) => { revision++; update(session?.user.id || null); });
        const snapshotRevision = revision;
        void (client as SupabaseDataClient).getSession().then(session => { if (revision === snapshotRevision) update(session?.user.id || null); }).catch(() => { if (revision === snapshotRevision) update(null); });
        return () => { alive = false; unsubscribe(); };
    }, [client, cache]);
    useEffect(() => { if (!client || client.mode !== 'supabase' || !authReady)
        return; let alive = true; let cleanup: (() => void) | undefined; void attachPushListeners(client as SupabaseDataClient, id => router.push('/project/' + id), () => setMessage('기기 알림 연결을 갱신하지 못했어요. 설정에서 다시 확인해 주세요.')).then(unsubscribe => { if (alive)
        cleanup = unsubscribe;
    else
        unsubscribe(); }).catch(() => { }); return () => { alive = false; cleanup?.(); }; }, [client, authReady]);
    const toast = (text: string) => { setMessage(text); if (timer.current)
        clearTimeout(timer.current); timer.current = setTimeout(() => setMessage(''), 4500); };
    async function chooseActor(next: Actor) { if (client?.mode !== 'demo')
        return; await (client as DemoClient).selectActor(next); cache.clear(); setActor(next); setScenario('normal'); }
    async function reset() { if (client?.mode !== 'demo')
        return; const demo = client as DemoClient; await demo.reset(); cache.clear(); setActor(demo.actor); setScenario('normal'); router.replace('/'); }
    if (error)
        return <Screen title="환경 설정이 필요해요" back={false}><ErrorState error={error}/>{initializedClient.current?.mode==='demo'?<Panel><T style={{fontWeight:'800'}}>저장된 데모 데이터를 복구할 수 있어요</T><T muted style={{fontSize:12,lineHeight:22,marginVertical:15}}>이 기기의 가상 프로젝트·신청·대화·기록을 초기화하고 다시 시작해요. 실제 계정이나 서버에는 영향을 주지 않아요.</T>{recoveryAsked?<><Button title="초기화하고 다시 시작" busy={recovering} onPress={async()=>{setRecovering(true);try{const demo=initializedClient.current as DemoClient;await demo.reset();cache.clear();setActor(demo.actor);setScenario('normal');setClient(demo);setError(undefined);setRecoveryAsked(false);}catch{setError(new AppError('UNAVAILABLE','기기 저장소를 초기화하지 못했어요. 저장 공간을 확인해 주세요.'));}finally{setRecovering(false);}}}/><Button title="취소" variant="ghost" onPress={()=>setRecoveryAsked(false)}/></>:<Button title="데모 데이터 초기화" variant="secondary" onPress={()=>setRecoveryAsked(true)}/>}</Panel>:<T muted>실제 연결 모드는 데모로 자동 전환되지 않아요. 환경 변수와 연결 절차를 확인해 주세요.</T>}</Screen>;
    if (!client || client.mode === 'supabase' && !authReady)
        return <Screen back={false}><Loading /></Screen>;
    const context: Runtime = { client, actor, sessionUser, chooseActor, reset, scenario, setScenario, toast, confirm: (title, body, action = '확인', destructive = false) => new Promise(resolve => setConfirmation({ title, message: body, action, destructive, resolve })) };
    return <QueryClientProvider client={cache}><RuntimeContext.Provider value={context}>{children}
 {message ? <Pressable accessibilityRole="alert" onPress={() => setMessage('')} style={{ position: 'absolute', bottom: 94, left: 20, right: 20, maxWidth: 560, alignSelf: 'center', backgroundColor: C.raised, borderWidth: 1, borderColor: '#46513D', borderRadius: 16, padding: 16, zIndex: 100 }}><T style={{ fontSize: 13 }}>{message}</T></Pressable> : null}
 <Modal visible={!!confirmation} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => { confirmation?.resolve(false); setConfirmation(null); }}><View accessibilityViewIsModal style={{ flex: 1, backgroundColor: '#000C', alignItems: 'center', justifyContent: 'center', padding: 24 }}><Panel style={{ maxWidth: 430, width: '100%', padding: 24, borderRadius: 24 }}><T style={s.title}>{confirmation?.title}</T><T muted style={{ fontSize: 14, lineHeight: 24, marginVertical: 20 }}>{confirmation?.message}</T><View style={{ gap: 10 }}><Button title={confirmation?.action || '확인'} variant={confirmation?.destructive ? 'danger' : 'primary'} onPress={() => { confirmation?.resolve(true); setConfirmation(null); }}/><Button title="취소" variant="ghost" onPress={() => { confirmation?.resolve(false); setConfirmation(null); }}/></View></Panel></View></Modal>
 </RuntimeContext.Provider></QueryClientProvider>;
}
