import type {
  ClientMessage,
  McpServerStatus,
  PermissionRequest,
  RenderBlock,
  ServerMessage,
  SessionSummary,
  StoredUpdate,
} from '@dsh-mobile/protocol'
import { fold } from '@dsh-mobile/protocol'
import { toast } from 'sonner'
import { create } from 'zustand'
import {
  createDemoBlocks,
  createDemoMcp,
  createDemoPermission,
  createDemoSessions,
  DEMO_DEVICE_ID,
  DEMO_PRIMARY_SESSION_ID,
  DEMO_REPLY,
} from '../lib/demo'
import { promptStopCopy } from '../lib/format'
import { firstIssue, promptSchema, tokenSchema } from '../lib/validation'
import { BridgeClient, type BridgeStatus } from '../lib/ws-client'

const TOKEN_KEY = 'dsh-mobile.token'
const DEVICE_KEY = 'dsh-mobile.device'
const DEMO_KEY = 'dsh-mobile.demo'

export type AppMode = 'live' | 'demo'
export type StoreStatus = BridgeStatus | 'demo'

export interface SessionData {
  blocks: RenderBlock[]
  updates: StoredUpdate[]
  historyStartsAt?: number
  historyTruncated?: boolean
}

interface PendingPrompt {
  clientMsgId: string
  text: string
  startedAt: number
}

interface StoreError {
  code: string
  requestType?: string
}

export interface BridgeStore {
  booted: boolean
  mode: AppMode
  status: StoreStatus
  statusDetail: string | null
  everConnected: boolean
  authToken: string
  deviceId: string
  sessions: Record<string, SessionSummary>
  order: string[]
  data: Record<string, SessionData>
  activeSessionId: string | null
  pendingPrompt: Record<string, PendingPrompt>
  cancelling: Record<string, boolean>
  permissions: Record<string, PermissionRequest>
  permissionReceivedAt: Record<string, number>
  permissionBusy: { requestId: string; optionId: string } | null
  creating: boolean
  listLoading: boolean
  mcp: McpServerStatus[]
  mcpLoading: boolean
  leaseBusy: boolean
  pendingNavigation: string | null
  lastError: StoreError | null

  boot: () => void
  connect: (token: string) => boolean
  reconnect: () => void
  signOut: () => void
  enterDemo: () => void
  exitDemo: () => void
  resetDemo: () => void
  setActiveSession: (sessionId: string | null) => void
  refreshSessions: () => void
  createSession: () => void
  attachSession: (sessionId: string) => void
  sendPrompt: (sessionId: string, text: string) => boolean
  cancelPrompt: (sessionId: string) => void
  takeLease: (sessionId: string) => void
  releaseLease: (sessionId: string) => void
  answerPermission: (requestId: string, optionId: string) => void
  triggerDemoPermission: (sessionId: string) => void
  refreshMcp: () => void
  clearError: () => void
  consumeNavigation: () => void
  receive: (message: ServerMessage) => void
}

const ERROR_COPY: Record<string, string> = {
  unauthorized: '访问令牌无效，请重新输入',
  agent_disconnected: 'DSH 尚未就绪，稍后再试',
  agent_unavailable: 'Bridge 未启用 ACP',
  session_gone: '这个会话已经不在了',
  session_busy: '会话被其他入口占用',
  lease_held: '写权在另一台设备上，先接管写权',
  prompt_in_flight: '上一轮还在运行，先停止再发送',
  permission_gone: '这条审批已经失效',
  invalid_message: '请求格式不合法',
  session_cwd_mismatch: '会话目录与 Bridge 不匹配',
  agent_error: 'Agent 返回了错误',
}

let client: BridgeClient | null = null
let demoTimers: Array<ReturnType<typeof setTimeout>> = []
let demoGeneration = 0
const resyncing = new Set<string>()

function randomId(prefix = ''): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}${cryptoApi.randomUUID()}`
  }
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function loadDeviceId(): string {
  const store = storage()
  const existing = store?.getItem(DEVICE_KEY)
  if (existing !== undefined && existing !== null && existing.length > 0 && existing.length <= 64) {
    return existing
  }
  const created = `web-${randomId('')}`.slice(0, 64)
  store?.setItem(DEVICE_KEY, created)
  return created
}

function sortOrder(sessions: Record<string, SessionSummary>): string[] {
  return Object.values(sessions)
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
    .map((session) => session.id)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function updateKind(update: unknown): string {
  const record = asRecord(update)
  const kind = record?.sessionUpdate
  return typeof kind === 'string' ? kind : 'unknown'
}

function isActivityKind(kind: string): boolean {
  return (
    kind === 'user_message_chunk' ||
    kind === 'agent_message_chunk' ||
    kind === 'agent_thought_chunk' ||
    kind === 'tool_call' ||
    kind === 'tool_call_update' ||
    kind === 'plan' ||
    kind === 'plan_update' ||
    kind === 'compaction_update'
  )
}

function clearDemoTimers(): void {
  demoGeneration += 1
  for (const timer of demoTimers) clearTimeout(timer)
  demoTimers = []
}

function later(callback: () => void, delay: number): void {
  const generation = demoGeneration
  const timer = setTimeout(() => {
    demoTimers = demoTimers.filter((entry) => entry !== timer)
    if (generation !== demoGeneration) return
    callback()
  }, delay)
  demoTimers.push(timer)
}

function notifyError(message: string): void {
  toast.error(message)
}

function scheduleResync(sessionId: string): void {
  if (resyncing.has(sessionId)) return
  resyncing.add(sessionId)
  setTimeout(() => {
    resyncing.delete(sessionId)
    if (client !== null) client.send({ type: 'session.attach', sessionId })
  }, 250)
}

function sendLive(message: ClientMessage): boolean {
  if (client === null) {
    notifyError('Bridge 客户端尚未初始化')
    return false
  }
  if (!client.send(message)) {
    notifyError('连接尚未就绪，请稍后重试')
    return false
  }
  return true
}

function appendDemoBlock(sessionId: string, block: RenderBlock): void {
  useBridgeStore.setState((state) => {
    const current = state.data[sessionId]
    if (current === undefined) return state
    const summary = state.sessions[sessionId]
    const nextSummary =
      summary === undefined
        ? undefined
        : {
            ...summary,
            lastSeq: summary.lastSeq + 1,
            lastActivityAt: Date.now(),
          }
    const sessions =
      nextSummary === undefined ? state.sessions : { ...state.sessions, [sessionId]: nextSummary }
    return {
      data: {
        ...state.data,
        [sessionId]: {
          ...current,
          blocks: [...current.blocks, block],
        },
      },
      sessions,
      order: nextSummary === undefined ? state.order : sortOrder(sessions),
    }
  })
}

function demoPermissionRole(kind: string | undefined): 'allowed' | 'rejected' {
  return kind === 'allow_once' || kind === 'allow_always' ? 'allowed' : 'rejected'
}

function continueDemoTurn(sessionId: string, outcome: 'allowed' | 'rejected'): void {
  later(() => {
    appendDemoBlock(sessionId, {
      kind: 'notice',
      id: randomId('demo-notice-'),
      level: outcome === 'allowed' ? 'info' : 'warning',
      text: outcome === 'allowed' ? '已允许修改支付回调。' : '已拒绝这次文件修改。',
      code: 'permission_resolved',
    })
  }, 320)

  if (outcome === 'rejected') {
    later(() => {
      appendDemoBlock(sessionId, {
        kind: 'message',
        id: randomId('demo-msg-'),
        role: 'assistant',
        text: '好的，这次修改我不动了。需要你确认后再继续。',
        streaming: false,
      })
      useBridgeStore.setState((state) => {
        const summary = state.sessions[sessionId]
        return summary === undefined
          ? state
          : {
              sessions: { ...state.sessions, [sessionId]: { ...summary, running: false } },
            }
      })
      toast.info('已拒绝这次修改')
    }, 760)
    return
  }

  later(() => {
    appendDemoBlock(sessionId, {
      kind: 'tool_call',
      id: randomId('demo-tool-'),
      toolCallId: randomId('call_patch_'),
      title: '写入支付回调补丁',
      toolKind: 'edit',
      status: 'completed',
      content: [{ type: 'text', text: '已修改 2 个文件，新增 1 个测试。' }],
    })
  }, 700)

  later(() => {
    appendDemoBlock(sessionId, {
      kind: 'plan',
      id: randomId('demo-plan-'),
      planId: 'payments-async',
      entries: [
        { content: '拆出回调事件的 outbox 表', status: 'completed', priority: 'high' },
        { content: '新增 worker 与指数退避重试', status: 'completed', priority: 'high' },
        { content: '补幂等与重试测试', status: 'completed', priority: 'medium' },
        { content: '更新回调接口文档', status: 'in_progress', priority: 'low' },
      ],
    })
  }, 920)

  later(() => {
    appendDemoBlock(sessionId, {
      kind: 'message',
      id: randomId('demo-msg-'),
      role: 'assistant',
      text: `${DEMO_REPLY}\n\n\`\`\`bash\npnpm vitest run src/payments\n# 12 passed (2.4s)\n\`\`\``,
      streaming: false,
    })
    useBridgeStore.setState((state) => {
      const summary = state.sessions[sessionId]
      return summary === undefined
        ? state
        : {
            sessions: { ...state.sessions, [sessionId]: { ...summary, running: false } },
          }
    })
    toast.success('本轮演示完成')
  }, 1360)
}

function startDemoTurn(sessionId: string, text: string): void {
  const now = Date.now()
  appendDemoBlock(sessionId, {
    kind: 'message',
    id: randomId('demo-user-'),
    role: 'user',
    text,
  })
  useBridgeStore.setState((state) => {
    const summary = state.sessions[sessionId]
    return summary === undefined
      ? state
      : {
          sessions: {
            ...state.sessions,
            [sessionId]: { ...summary, running: true, lastActivityAt: now },
          },
        }
  })

  later(() => {
    appendDemoBlock(sessionId, {
      kind: 'thought',
      id: randomId('demo-thought-'),
      text: '先把改动限定在回调链路。验签和幂等必须同步，队列只负责后续副作用。接下来需要写入一个补丁文件，这会触发审批。',
      streaming: false,
    })
  }, 520)

  later(() => {
    const request = createDemoPermission(sessionId)
    useBridgeStore.setState((state) => ({
      permissions: { ...state.permissions, [request.requestId]: request },
      permissionReceivedAt: {
        ...state.permissionReceivedAt,
        [request.requestId]: Date.now(),
      },
    }))
    toast.warning('需要你的确认', { description: request.toolCall.title ?? '文件修改请求' })
  }, 1180)
}

function createBridgeClient(): BridgeClient {
  return new BridgeClient({
    onMessage: (message) => {
      useBridgeStore.getState().receive(message)
    },
    onStatus: (status, detail) => {
      const previous = useBridgeStore.getState()
      if (status === 'ready') {
        if (previous.status === 'reconnecting' && previous.everConnected) {
          toast.success('已重新连接 Bridge')
        }
        useBridgeStore.setState({
          status,
          statusDetail: null,
          everConnected: true,
        })
        return
      }

      if (status === 'unauthorized') {
        storage()?.removeItem(TOKEN_KEY)
        useBridgeStore.setState({
          status,
          statusDetail: detail ?? '访问令牌无效',
          authToken: '',
          everConnected: false,
          sessions: {},
          order: [],
          data: {},
          activeSessionId: null,
          pendingPrompt: {},
          cancelling: {},
          permissions: {},
          permissionReceivedAt: {},
          pendingNavigation: null,
          creating: false,
          listLoading: false,
        })
        return
      }

      if (status === 'reconnecting' && previous.status === 'ready') {
        toast.warning('连接中断，正在重连…', { id: 'bridge-reconnect' })
      }
      if (status === 'reconnecting' && previous.status === 'connecting') {
        toast.warning('暂时连不上 Bridge，正在重试…', { id: 'bridge-reconnect' })
      }
      useBridgeStore.setState({ status, statusDetail: detail ?? null })
    },
  })
}

function ensureClient(): BridgeClient {
  if (client === null) client = createBridgeClient()
  return client
}

function resetLiveState(): Pick<
  BridgeStore,
  | 'mode'
  | 'everConnected'
  | 'sessions'
  | 'order'
  | 'data'
  | 'activeSessionId'
  | 'pendingPrompt'
  | 'cancelling'
  | 'permissions'
  | 'permissionReceivedAt'
  | 'permissionBusy'
  | 'creating'
  | 'listLoading'
  | 'mcp'
  | 'mcpLoading'
  | 'leaseBusy'
  | 'pendingNavigation'
  | 'lastError'
> {
  return {
    mode: 'live',
    everConnected: false,
    sessions: {},
    order: [],
    data: {},
    activeSessionId: null,
    pendingPrompt: {},
    cancelling: {},
    permissions: {},
    permissionReceivedAt: {},
    permissionBusy: null,
    creating: false,
    listLoading: false,
    mcp: [],
    mcpLoading: false,
    leaseBusy: false,
    pendingNavigation: null,
    lastError: null,
  }
}

export const useBridgeStore = create<BridgeStore>((set, get) => ({
  booted: false,
  mode: 'live',
  status: 'idle',
  statusDetail: null,
  everConnected: false,
  authToken: '',
  deviceId: '',
  sessions: {},
  order: [],
  data: {},
  activeSessionId: null,
  pendingPrompt: {},
  cancelling: {},
  permissions: {},
  permissionReceivedAt: {},
  permissionBusy: null,
  creating: false,
  listLoading: false,
  mcp: [],
  mcpLoading: false,
  leaseBusy: false,
  pendingNavigation: null,
  lastError: null,

  boot: () => {
    if (get().booted) return
    const deviceId = loadDeviceId()
    set({ booted: true, deviceId })
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const demoParam = params.get('demo')
    const store = storage()
    if (demoParam === '1') store?.setItem(DEMO_KEY, '1')
    if (demoParam === '0') store?.removeItem(DEMO_KEY)
    if (demoParam !== null) {
      const url = new URL(window.location.href)
      url.searchParams.delete('demo')
      window.history.replaceState({}, '', url)
    }

    if (demoParam === '1' || (demoParam !== '0' && store?.getItem(DEMO_KEY) === '1')) {
      get().enterDemo()
      return
    }

    const savedToken = store?.getItem(TOKEN_KEY)?.trim() ?? ''
    if (savedToken.length > 0) {
      set({ authToken: savedToken, mode: 'live', status: 'connecting', statusDetail: null })
      ensureClient().connect(savedToken, deviceId)
      return
    }
    set({ status: 'unauthorized', statusDetail: '输入访问令牌以连接 Bridge' })
  },

  connect: (token) => {
    const parsed = tokenSchema.safeParse(token)
    if (!parsed.success) {
      notifyError(firstIssue(parsed.error))
      return false
    }
    const deviceId = get().deviceId.length > 0 ? get().deviceId : loadDeviceId()
    clearDemoTimers()
    const connection = ensureClient()
    connection.disconnect()
    storage()?.setItem(TOKEN_KEY, parsed.data)
    storage()?.removeItem(DEMO_KEY)
    set({
      ...resetLiveState(),
      authToken: parsed.data,
      deviceId,
      status: 'connecting',
      statusDetail: null,
    })
    connection.connect(parsed.data, deviceId)
    return true
  },

  reconnect: () => {
    if (get().mode === 'demo') {
      get().resetDemo()
      return
    }
    const token = get().authToken
    if (token.length === 0) {
      set({ status: 'unauthorized', statusDetail: '输入访问令牌以连接 Bridge' })
      return
    }
    set({ status: 'connecting', statusDetail: null })
    ensureClient().connect(token, get().deviceId)
  },

  signOut: () => {
    clearDemoTimers()
    ensureClient().disconnect()
    storage()?.removeItem(TOKEN_KEY)
    storage()?.removeItem(DEMO_KEY)
    set({
      ...resetLiveState(),
      status: 'unauthorized',
      statusDetail: null,
      authToken: '',
    })
  },

  enterDemo: () => {
    clearDemoTimers()
    ensureClient().disconnect()
    // Entering demo mode must not hijack the current route. The catalog,
    // settings, and session deep links all remain reachable after boot.
    const deviceId = get().deviceId.length > 0 ? get().deviceId : DEMO_DEVICE_ID
    const sessions = createDemoSessions(Date.now(), deviceId)
    const sessionMap = Object.fromEntries(sessions.map((session) => [session.id, session]))
    const blocks = createDemoBlocks()
    const data: Record<string, SessionData> = {}
    for (const [sessionId, sessionBlocks] of Object.entries(blocks)) {
      data[sessionId] = { blocks: sessionBlocks, updates: [] }
    }
    storage()?.setItem(DEMO_KEY, '1')
    set({
      mode: 'demo',
      status: 'demo',
      statusDetail: null,
      everConnected: true,
      deviceId,
      sessions: sessionMap,
      order: sortOrder(sessionMap),
      data,
      activeSessionId: DEMO_PRIMARY_SESSION_ID,
      pendingPrompt: {},
      cancelling: {},
      permissions: {},
      permissionReceivedAt: {},
      permissionBusy: null,
      creating: false,
      listLoading: false,
      mcp: createDemoMcp(),
      mcpLoading: false,
      leaseBusy: false,
      pendingNavigation: null,
      lastError: null,
    })
  },

  exitDemo: () => {
    if (get().mode !== 'demo') return
    clearDemoTimers()
    storage()?.removeItem(DEMO_KEY)
    const connection = ensureClient()
    connection.disconnect()
    const token =
      get().authToken.length > 0 ? get().authToken : (storage()?.getItem(TOKEN_KEY)?.trim() ?? '')
    if (token.length > 0) {
      set({
        ...resetLiveState(),
        authToken: token,
        status: 'connecting',
        statusDetail: null,
      })
      connection.connect(token, get().deviceId)
      return
    }
    set({
      ...resetLiveState(),
      status: 'unauthorized',
      statusDetail: null,
      authToken: '',
    })
  },

  resetDemo: () => {
    if (get().mode !== 'demo') return
    get().enterDemo()
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId })
  },

  refreshSessions: () => {
    if (get().mode === 'demo') {
      set({ listLoading: true })
      later(() => set({ listLoading: false }), 420)
      return
    }
    if (get().status !== 'ready') return
    set({ listLoading: true })
    if (!sendLive({ type: 'session.list' })) set({ listLoading: false })
  },

  createSession: () => {
    if (get().mode === 'demo') {
      const id = `demo-${Date.now().toString(36)}`
      const now = Date.now()
      const session: SessionSummary = {
        id,
        title: '新的会话',
        cwd: '/workspace/dsh-mobile-ui',
        createdAt: now,
        lastActivityAt: now,
        lastSeq: 0,
        lease: { state: 'write', holder: get().deviceId },
        running: false,
      }
      set((state) => {
        const sessions = { ...state.sessions, [id]: session }
        return {
          sessions,
          order: sortOrder(sessions),
          data: { ...state.data, [id]: { blocks: [], updates: [] } },
          creating: false,
          pendingNavigation: id,
          activeSessionId: id,
        }
      })
      toast.success('新会话已创建')
      return
    }
    if (get().status !== 'ready') {
      notifyError('Bridge 尚未连接')
      return
    }
    if (get().creating) return
    set({ creating: true })
    if (!sendLive({ type: 'session.create' })) set({ creating: false })
  },

  attachSession: (sessionId) => {
    set({ activeSessionId: sessionId })
    if (get().mode === 'demo') return
    if (get().status !== 'ready') return
    if (client !== null) client.send({ type: 'session.attach', sessionId })
  },

  sendPrompt: (sessionId, text) => {
    const parsed = promptSchema.safeParse(text)
    if (!parsed.success) {
      notifyError(firstIssue(parsed.error))
      return false
    }
    const state = get()
    const session = state.sessions[sessionId]
    if (session === undefined) {
      notifyError('会话尚未加载')
      return false
    }
    if (session.running) {
      notifyError('上一轮还在运行，先停止再发送')
      return false
    }
    if (state.mode === 'demo') {
      startDemoTurn(sessionId, parsed.data)
      return true
    }
    if (state.status !== 'ready') {
      notifyError('连接尚未就绪')
      return false
    }
    if (session.lease.holder !== null && session.lease.holder !== state.deviceId) {
      notifyError('写权在另一台设备上，先接管写权')
      return false
    }

    const clientMsgId = randomId('p_')
    set((current) => ({
      pendingPrompt: {
        ...current.pendingPrompt,
        [sessionId]: { clientMsgId, text: parsed.data, startedAt: Date.now() },
      },
      sessions: {
        ...current.sessions,
        [sessionId]: { ...session, running: true },
      },
      lastError: null,
    }))
    const sent = sendLive({
      type: 'session.prompt',
      sessionId,
      clientMsgId,
      text: parsed.data,
    })
    if (!sent) {
      set((current) => {
        const pendingPrompt = { ...current.pendingPrompt }
        delete pendingPrompt[sessionId]
        const currentSession = current.sessions[sessionId]
        return {
          pendingPrompt,
          sessions:
            currentSession === undefined
              ? current.sessions
              : {
                  ...current.sessions,
                  [sessionId]: { ...currentSession, running: false },
                },
        }
      })
      return false
    }
    return true
  },

  cancelPrompt: (sessionId) => {
    const state = get()
    if (state.mode === 'demo') {
      clearDemoTimers()
      set((current) => {
        const sessions = { ...current.sessions }
        const summary = sessions[sessionId]
        if (summary !== undefined) sessions[sessionId] = { ...summary, running: false }
        const permissions = { ...current.permissions }
        for (const [id, request] of Object.entries(permissions)) {
          if (request.sessionId === sessionId) delete permissions[id]
        }
        return { sessions, permissions, permissionBusy: null }
      })
      appendDemoBlock(sessionId, {
        kind: 'notice',
        id: randomId('demo-notice-'),
        level: 'warning',
        text: '已停止生成。',
        code: 'cancelled',
      })
      toast.success('已停止演示生成')
      return
    }
    if (state.status !== 'ready') return
    if (state.cancelling[sessionId] === true) return
    set((current) => ({
      cancelling: { ...current.cancelling, [sessionId]: true },
    }))
    if (!sendLive({ type: 'session.cancel', sessionId })) {
      set((current) => {
        const cancelling = { ...current.cancelling }
        delete cancelling[sessionId]
        return { cancelling }
      })
    }
  },

  takeLease: (sessionId) => {
    const state = get()
    if (state.mode === 'demo') {
      set((current) => {
        const summary = current.sessions[sessionId]
        if (summary === undefined) return current
        return {
          sessions: {
            ...current.sessions,
            [sessionId]: {
              ...summary,
              lease: { state: 'write', holder: current.deviceId },
            },
          },
          leaseBusy: false,
        }
      })
      toast.success('已接管写权')
      return
    }
    if (state.status !== 'ready' || state.leaseBusy) return
    set({ leaseBusy: true })
    if (!sendLive({ type: 'session.lease', sessionId, action: 'take' })) {
      set({ leaseBusy: false })
    }
  },

  releaseLease: (sessionId) => {
    const state = get()
    if (state.mode === 'demo') {
      set((current) => {
        const summary = current.sessions[sessionId]
        if (summary === undefined) return current
        return {
          sessions: {
            ...current.sessions,
            [sessionId]: { ...summary, lease: { state: 'read', holder: null } },
          },
          leaseBusy: false,
        }
      })
      toast.success('已释放写权')
      return
    }
    if (state.status !== 'ready' || state.leaseBusy) return
    set({ leaseBusy: true })
    if (!sendLive({ type: 'session.lease', sessionId, action: 'release' })) {
      set({ leaseBusy: false })
    }
  },

  answerPermission: (requestId, optionId) => {
    const state = get()
    const request = state.permissions[requestId]
    if (request === undefined) {
      notifyError('这条审批已经失效')
      return
    }
    const option = request.options.find((candidate) => candidate.optionId === optionId)
    if (option === undefined) {
      notifyError('审批选项不存在')
      return
    }
    if (state.permissionBusy !== null) return

    if (state.mode === 'demo') {
      const outcome = demoPermissionRole(option.kind)
      set({ permissionBusy: { requestId, optionId } })
      later(() => {
        set((current) => {
          const permissions = { ...current.permissions }
          delete permissions[requestId]
          const permissionReceivedAt = { ...current.permissionReceivedAt }
          delete permissionReceivedAt[requestId]
          return { permissions, permissionReceivedAt, permissionBusy: null }
        })
        continueDemoTurn(request.sessionId, outcome)
      }, 260)
      return
    }

    set({ permissionBusy: { requestId, optionId } })
    if (!sendLive({ type: 'permission.answer', requestId, optionId })) {
      set({ permissionBusy: null })
    }
  },

  triggerDemoPermission: (sessionId) => {
    if (get().mode !== 'demo') return
    const request = createDemoPermission(sessionId)
    set((state) => {
      const summary = state.sessions[sessionId]
      return {
        permissions: { ...state.permissions, [request.requestId]: request },
        permissionReceivedAt: { ...state.permissionReceivedAt, [request.requestId]: Date.now() },
        sessions:
          summary === undefined
            ? state.sessions
            : { ...state.sessions, [sessionId]: { ...summary, running: true } },
      }
    })
    toast.warning('演示审批已触发', { description: request.toolCall.title ?? '文件修改请求' })
  },

  refreshMcp: () => {
    if (get().mode === 'demo') {
      set({ mcpLoading: true })
      later(() => set({ mcp: createDemoMcp(), mcpLoading: false }), 460)
      return
    }
    if (get().status !== 'ready') return
    set({ mcpLoading: true })
    if (!sendLive({ type: 'mcp.subscribe' })) set({ mcpLoading: false })
  },

  clearError: () => set({ lastError: null }),
  consumeNavigation: () => set({ pendingNavigation: null }),

  receive: (message) => {
    switch (message.type) {
      case 'ready': {
        set({
          status: 'ready',
          statusDetail: null,
          everConnected: true,
          deviceId: message.deviceId,
        })
        get().refreshSessions()
        get().refreshMcp()
        const active = get().activeSessionId
        if (active !== null) get().attachSession(active)
        return
      }

      case 'session.list': {
        set((state) => {
          const sessions = { ...state.sessions }
          for (const session of message.sessions) sessions[session.id] = session
          return {
            sessions,
            order: sortOrder(sessions),
            listLoading: false,
          }
        })
        return
      }

      case 'session.snapshot': {
        set((state) => {
          const session = message.session
          const historyStartsAt = message.historyStartsAt
          const historyTruncated = message.historyTruncated
          const blocks =
            message.updates === undefined
              ? message.blocks
              : fold(message.updates, {
                  ...(historyStartsAt === undefined ? {} : { historyStartsAt }),
                  ...(historyTruncated === undefined ? {} : { historyTruncated }),
                })
          const updates = message.updates ?? []

          const sessions = { ...state.sessions, [session.id]: session }
          const permissions = { ...state.permissions }
          const permissionReceivedAt = { ...state.permissionReceivedAt }
          for (const [requestId, request] of Object.entries(permissions)) {
            if (request.sessionId !== session.id) continue
            delete permissions[requestId]
            delete permissionReceivedAt[requestId]
          }
          if (message.pendingPermission !== undefined) {
            permissions[message.pendingPermission.requestId] = message.pendingPermission
            permissionReceivedAt[message.pendingPermission.requestId] = Date.now()
          }

          const pendingPrompt = { ...state.pendingPrompt }
          delete pendingPrompt[session.id]
          const cancelling = { ...state.cancelling }
          delete cancelling[session.id]

          return {
            sessions,
            order: sortOrder(sessions),
            data: {
              ...state.data,
              [session.id]: {
                blocks,
                updates,
                ...(historyStartsAt === undefined ? {} : { historyStartsAt }),
                ...(historyTruncated === undefined ? {} : { historyTruncated }),
              },
            },
            permissions,
            permissionReceivedAt,
            pendingPrompt,
            cancelling,
            creating: false,
            pendingNavigation: state.creating ? session.id : state.pendingNavigation,
            activeSessionId: state.activeSessionId === null ? session.id : state.activeSessionId,
          }
        })
        return
      }

      case 'session.update': {
        const state = get()
        const sessionId = message.sessionId
        const current = state.data[sessionId] ?? { blocks: [], updates: [] }
        const summary = state.sessions[sessionId]

        if (current.updates.some((update) => update.seq === message.seq)) return
        if (summary !== undefined && message.seq <= summary.lastSeq) return
        if (summary !== undefined && summary.lastSeq > 0 && message.seq > summary.lastSeq + 1) {
          scheduleResync(sessionId)
          return
        }

        const kind = updateKind(message.update)
        const update: StoredUpdate = {
          seq: message.seq,
          kind,
          payload: message.update,
          createdAt: Date.now(),
        }
        const updates = [...current.updates, update]
        const blocks = fold(updates, {
          ...(current.historyStartsAt === undefined
            ? {}
            : { historyStartsAt: current.historyStartsAt }),
          ...(current.historyTruncated === undefined
            ? {}
            : { historyTruncated: current.historyTruncated }),
        })
        const payload = asRecord(message.update)
        const title = payload?.title
        const sessionInfoTitle =
          kind === 'session_info_update' && typeof title === 'string' && title.trim().length > 0
            ? title.trim()
            : undefined

        const pending = state.pendingPrompt[sessionId]
        const messageId = payload?.messageId
        const clearsPending =
          pending !== undefined &&
          kind === 'user_message_chunk' &&
          messageId === pending.clientMsgId
        const pendingPrompt = { ...state.pendingPrompt }
        if (clearsPending) delete pendingPrompt[sessionId]

        const sessions = { ...state.sessions }
        if (summary !== undefined) {
          sessions[sessionId] = {
            ...summary,
            ...(sessionInfoTitle === undefined ? {} : { title: sessionInfoTitle }),
            lastSeq: message.seq,
            lastActivityAt: Date.now(),
            running: summary.running || isActivityKind(kind),
          }
        }

        set({
          data: {
            ...state.data,
            [sessionId]: {
              ...current,
              blocks,
              updates,
            },
          },
          sessions,
          order: sortOrder(sessions),
          pendingPrompt,
        })
        return
      }

      case 'session.lease': {
        const state = get()
        const summary = state.sessions[message.sessionId]
        const previousHolder = summary?.lease.holder ?? null
        const nextHolder = message.lease.holder
        if (summary !== undefined) {
          set({
            sessions: {
              ...state.sessions,
              [message.sessionId]: { ...summary, lease: message.lease },
            },
            leaseBusy: false,
          })
        } else {
          set({ leaseBusy: false })
        }
        if (nextHolder === state.deviceId && previousHolder !== state.deviceId) {
          toast.success('已取得写权')
        } else if (previousHolder === state.deviceId && nextHolder !== state.deviceId) {
          toast.warning('写权已转交给另一台设备')
        }
        return
      }

      case 'session.prompt.done': {
        set((state) => {
          const sessions = { ...state.sessions }
          const summary = sessions[message.sessionId]
          if (summary !== undefined) {
            sessions[message.sessionId] = {
              ...summary,
              running: false,
              lastActivityAt: Date.now(),
            }
          }
          const pendingPrompt = { ...state.pendingPrompt }
          delete pendingPrompt[message.sessionId]
          const cancelling = { ...state.cancelling }
          delete cancelling[message.sessionId]
          return { sessions, pendingPrompt, cancelling }
        })
        if (message.stopReason === 'cancelled' || message.stopReason === 'canceled') {
          toast.success('已停止生成')
        } else if (message.stopReason === 'max_tokens') {
          toast.warning(promptStopCopy(message.stopReason))
        }
        return
      }

      case 'permission.request': {
        const request: PermissionRequest = {
          requestId: message.requestId,
          sessionId: message.sessionId,
          toolCall: message.toolCall,
          options: message.options,
        }
        set((state) => {
          const summary = state.sessions[message.sessionId]
          return {
            permissions: { ...state.permissions, [request.requestId]: request },
            permissionReceivedAt: {
              ...state.permissionReceivedAt,
              [request.requestId]: Date.now(),
            },
            sessions:
              summary === undefined
                ? state.sessions
                : {
                    ...state.sessions,
                    [message.sessionId]: { ...summary, running: true },
                  },
          }
        })
        if (get().activeSessionId !== message.sessionId) {
          toast.warning('有新的审批请求', {
            description: message.toolCall.title ?? '另一个会话正在等待确认',
          })
        }
        return
      }

      case 'permission.resolved': {
        set((state) => {
          const permissions = { ...state.permissions }
          delete permissions[message.requestId]
          const permissionReceivedAt = { ...state.permissionReceivedAt }
          delete permissionReceivedAt[message.requestId]
          return { permissions, permissionReceivedAt, permissionBusy: null }
        })
        if (message.outcome === 'allowed') toast.success('已批准')
        else if (message.outcome === 'rejected') toast.info('已拒绝')
        else toast.info('审批已自动取消')
        return
      }

      case 'mcp.status': {
        set({ mcp: message.servers, mcpLoading: false })
        return
      }

      case 'error': {
        const copy = ERROR_COPY[message.code] ?? '操作没有完成'
        const requestType = message.requestType
        set((state) => {
          const next: Partial<BridgeStore> = {
            lastError: {
              code: message.code,
              ...(requestType === undefined ? {} : { requestType }),
            },
          }

          if (requestType === 'session.prompt') {
            const pendingPrompt = { ...state.pendingPrompt }
            const latest = Object.entries(state.pendingPrompt).sort(
              (left, right) => right[1].startedAt - left[1].startedAt,
            )[0]
            if (latest !== undefined) {
              delete pendingPrompt[latest[0]]
              next.pendingPrompt = pendingPrompt
              const summary = state.sessions[latest[0]]
              if (summary !== undefined) {
                next.sessions = {
                  ...state.sessions,
                  [latest[0]]: { ...summary, running: false },
                }
              }
            }
            const cancelling = { ...state.cancelling }
            if (latest !== undefined) delete cancelling[latest[0]]
            next.cancelling = cancelling
          }
          if (requestType === 'session.create') next.creating = false
          if (requestType === 'session.lease') next.leaseBusy = false
          if (requestType === 'permission.answer') next.permissionBusy = null
          if (requestType === 'session.list') next.listLoading = false
          return next
        })
        if (message.code === 'unauthorized') {
          toast.error(copy)
          return
        }
        toast.error(copy, { description: message.code })
        return
      }
    }
  },
}))
