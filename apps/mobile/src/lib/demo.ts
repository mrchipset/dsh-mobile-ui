import type {
  McpServerStatus,
  PermissionRequest,
  RenderBlock,
  SessionSummary,
} from '@dsh-mobile/protocol'

export const DEMO_DEVICE_ID = 'demo-phone-01'

const PRIMARY = 'demo-payments'
const E2E = 'demo-e2e'
const PROTOCOL = 'demo-protocol'
const REVIEW = 'demo-review'

export function createDemoSessions(now = Date.now(), deviceId = DEMO_DEVICE_ID): SessionSummary[] {
  return [
    {
      id: PRIMARY,
      title: '把支付回调改成异步',
      cwd: '/workspace/dsh-mobile-ui',
      createdAt: now - 3_600_000 * 5,
      lastActivityAt: now - 90_000,
      lastSeq: 46,
      lease: { state: 'write', holder: deviceId },
      running: false,
    },
    {
      id: E2E,
      title: '排查 CI 上偶发的 E2E 失败',
      cwd: '/workspace/dsh-mobile-ui',
      createdAt: now - 86_400_000 * 2,
      lastActivityAt: now - 1_100_000,
      lastSeq: 31,
      lease: { state: 'read', holder: null },
      running: false,
    },
    {
      id: PROTOCOL,
      title: null,
      cwd: '/workspace/dsh-mobile-ui/packages/protocol',
      createdAt: now - 86_400_000 * 4,
      lastActivityAt: now - 3_600_000 * 9,
      lastSeq: 18,
      lease: { state: 'handoff', holder: 'laptop-7f2a', deadline: now + 6_400 },
      running: false,
    },
    {
      id: REVIEW,
      title: '移动端审批交互走查',
      cwd: '/workspace/dsh-mobile-ui/apps/mobile',
      createdAt: now - 86_400_000 * 6,
      lastActivityAt: now - 86_400_000,
      lastSeq: 12,
      lease: { state: 'idle', holder: null },
      running: false,
    },
  ]
}

function historyNotice(): RenderBlock {
  return {
    kind: 'notice',
    id: 'history:1',
    level: 'info',
    text: 'History is only visible from the point this Bridge first observed the session.',
    code: 'history_starts_at',
    seq: 1,
  }
}

function paymentBlocks(): RenderBlock[] {
  return [
    historyNotice(),
    {
      kind: 'message',
      id: 'demo-msg-1',
      role: 'user',
      text: '把支付回调改成异步处理，别阻塞主请求。',
      seq: 2,
    },
    {
      kind: 'thought',
      id: 'demo-thought-1',
      text: '先确认现有回调路径和重试策略。Webhook 验签必须是同步的，真正需要挪走的是写入与通知。我倾向于落一张 outbox 表，由 worker 消费。',
      streaming: false,
      seq: 3,
    },
    {
      kind: 'tool_call',
      id: 'demo-tool-1',
      toolCallId: 'call_read_01',
      title: '读取支付回调实现',
      toolKind: 'read',
      status: 'completed',
      content: [
        {
          type: 'text',
          text: 'src/payments/callback.ts · 84 行\nexport async function handleCallback(req, res) { ... }',
        },
      ],
      rawInput: { path: 'src/payments/callback.ts' },
      seq: 4,
    },
    {
      kind: 'message',
      id: 'demo-msg-2',
      role: 'assistant',
      text: [
        '看完了。现在的回调在同一个请求里做验签、扣款和发货，任何一步慢都会把网关拖到超时。',
        '',
        '我会拆成 **同步验签 + 异步事件** 两段：',
        '',
        '- `POST /payments/callback` 只验签、做幂等检查，写入 `payment_events` 后立即返回 `202`',
        '- worker 消费事件，负责扣款与发货',
        '- 失败按 1s / 4s / 16s 退避，最多五次，最终进入死信队列',
        '',
        '先动 `callback.ts` 和新增 `payment-worker.ts`。',
      ].join('\n'),
      streaming: false,
      seq: 5,
    },
    {
      kind: 'plan',
      id: 'demo-plan-1',
      planId: 'payments-async',
      entries: [
        { content: '拆出回调事件的 outbox 表', status: 'completed', priority: 'high' },
        { content: '新增 worker 与指数退避重试', status: 'completed', priority: 'high' },
        { content: '补幂等与重试测试', status: 'in_progress', priority: 'medium' },
        { content: '更新回调接口文档', status: 'pending', priority: 'low' },
      ],
      seq: 6,
    },
    {
      kind: 'tool_call',
      id: 'demo-tool-2',
      toolCallId: 'call_patch_01',
      title: '修改回调与新增 worker',
      toolKind: 'edit',
      status: 'completed',
      content: [{ type: 'text', text: '已修改 3 个文件，新增 1 个文件。' }],
      rawOutput: {
        changed: [
          'src/payments/callback.ts',
          'src/payments/payment-worker.ts',
          'src/db/schema.ts',
          'src/payments/callback.test.ts',
        ],
      },
      seq: 7,
    },
    {
      kind: 'message',
      id: 'demo-msg-3',
      role: 'user',
      text: '顺便补一个失败重试的测试，别只测 happy path。',
      seq: 8,
    },
    {
      kind: 'tool_call',
      id: 'demo-tool-3',
      toolCallId: 'call_test_01',
      title: '运行 payments 测试',
      toolKind: 'execute',
      status: 'in_progress',
      content: [{ type: 'text', text: 'pnpm vitest run src/payments · 12 个用例运行中' }],
      rawInput: { command: 'pnpm vitest run src/payments' },
      seq: 9,
    },
    {
      kind: 'notice',
      id: 'demo-notice-1',
      level: 'info',
      text: 'Context was compacted.',
      code: 'compaction',
      seq: 10,
    },
    {
      kind: 'message',
      id: 'demo-msg-4',
      role: 'assistant',
      text: [
        '测试已经补齐，覆盖三个关键分支：',
        '',
        '1. 重复回调只落一条事件',
        '2. worker 首次失败后会重试并在第三次成功',
        '3. 超过五次后进入死信队列，主请求不受影响',
        '',
        '```ts',
        "it('retries then succeeds', async () => {",
        '  await expect(worker.tick()).resolves.toBe("delivered")',
        '})',
        '```',
        '',
        '要我顺手把死信队列的告警也接上吗？',
      ].join('\n'),
      streaming: false,
      seq: 11,
    },
  ]
}

function e2eBlocks(): RenderBlock[] {
  return [
    historyNotice(),
    {
      kind: 'message',
      id: 'e2e-msg-1',
      role: 'user',
      text: 'CI 上 e2e 大概五次挂一次，本地又复现不出来。先帮我看最近三次失败的共同点。',
      seq: 2,
    },
    {
      kind: 'thought',
      id: 'e2e-thought-1',
      text: '先对齐失败发生的时间点，再看是否都卡在同一个等待条件上。可能是动画结束和断言之间的竞态。',
      streaming: false,
      seq: 3,
    },
    {
      kind: 'tool_call',
      id: 'e2e-tool-1',
      toolCallId: 'call_gh_01',
      title: '读取 CI 失败日志',
      toolKind: 'fetch',
      status: 'completed',
      content: [{ type: 'text', text: '3 次失败都停在 checkout.spec.ts:42 · 等待 toast 出现' }],
      rawInput: { workflow: 'e2e.yml', run: 'latest-3' },
      seq: 4,
    },
    {
      kind: 'message',
      id: 'e2e-msg-2',
      role: 'assistant',
      text: [
        '三次失败都停在同一条等待：`getByText("支付成功")`。日志里 toast 已经渲染，但断言在 2 秒后超时。',
        '',
        '更像是 **动画期间元素可见性不稳定**，而不是业务失败。建议把断言改成等待 `data-state="visible"`，并把 CI 的动画降级打开。',
        '',
        '我可以直接提一个修复 PR，只动测试和 Playwright 配置。',
      ].join('\n'),
      streaming: false,
      seq: 5,
    },
  ]
}

function protocolBlocks(): RenderBlock[] {
  return [
    historyNotice(),
    {
      kind: 'message',
      id: 'proto-msg-1',
      role: 'user',
      text: 'fold 里 plan_update 的 markdown 分支，是不是应该保留原始 plan 而不是只出一条 notice？',
      seq: 2,
    },
    {
      kind: 'message',
      id: 'proto-msg-2',
      role: 'assistant',
      text: [
        '按现在的契约，markdown plan 不参与 timeline 的结构化渲染，所以降级成 notice 是合理的。',
        '',
        '但有一个边界要补：`plan_update` 如果只带 `planId` 不带 plan 体，应该忽略，而不是覆盖已有 plan。',
        '',
        '我建议在 `fold.test.ts` 里补两条用例，分别覆盖 **未知 plan 类型** 和 **缺失 plan 体**。',
      ].join('\n'),
      streaming: false,
      seq: 3,
    },
    {
      kind: 'unknown',
      id: 'proto-unknown-1',
      sessionUpdate: 'progress_update',
      raw: { sessionUpdate: 'progress_update', percent: 0.62 },
      seq: 4,
    },
  ]
}

function reviewBlocks(): RenderBlock[] {
  return [
    historyNotice(),
    {
      kind: 'message',
      id: 'review-msg-1',
      role: 'user',
      text: '移动端审批不要做成全屏弹窗，挡住上下文会让人不敢批。',
      seq: 2,
    },
    {
      kind: 'message',
      id: 'review-msg-2',
      role: 'assistant',
      text: [
        '同意。这里更适合 **底部面板**：保留上方的工具调用摘要，同时把选项做成整行按钮。',
        '',
        '另外需要处理三个状态：',
        '',
        '- 写权不在本机：只读提示，不允许代答',
        '- 180 秒未处理：Bridge 自动取消，面板关闭',
        '- 切换会话：待审批保留在会话列表上，不打断当前阅读',
      ].join('\n'),
      streaming: false,
      seq: 3,
    },
  ]
}

export function createDemoBlocks(): Record<string, RenderBlock[]> {
  return {
    [PRIMARY]: paymentBlocks(),
    [E2E]: e2eBlocks(),
    [PROTOCOL]: protocolBlocks(),
    [REVIEW]: reviewBlocks(),
  }
}

export function createDemoMcp(now = Date.now()): McpServerStatus[] {
  return [
    {
      server: 'filesystem',
      transport: 'stdio',
      state: 'connected',
      since: now - 3_600_000 * 2,
      lastCallAt: now - 80_000,
      lastCallOk: true,
      source: 'process',
    },
    {
      server: 'github',
      transport: 'http',
      state: 'reconnecting',
      since: now - 420_000,
      lastError: 'upstream returned 502 from https://mcp.internal.example/rpc',
      lastCallAt: now - 400_000,
      lastCallOk: false,
      source: 'probe',
    },
    {
      server: 'playwright',
      transport: 'stdio',
      state: 'down',
      since: now - 900_000,
      lastError: 'child process exited with code 1',
      lastCallAt: now - 1_200_000,
      lastCallOk: false,
      source: 'probe',
    },
    {
      server: 'linear',
      transport: 'http',
      state: 'disabled',
      since: now - 86_400_000,
      source: 'process',
    },
  ]
}

export function createDemoPermission(sessionId = PRIMARY, now = Date.now()): PermissionRequest {
  return {
    requestId: `demo-permission-${now}`,
    sessionId,
    toolCall: {
      toolCallId: 'call_patch_42',
      title: '修改 src/payments/callback.ts',
    },
    options: [
      { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
    ],
  }
}

export const DEMO_PRIMARY_SESSION_ID = PRIMARY

export const DEMO_REPLY = [
  '收到。我先按这个方向继续。',
  '',
  '改动会限定在支付回调链路，不碰调度器本身。完成后我会把 diff 摘要和测试结果贴回来。',
].join('\n')
