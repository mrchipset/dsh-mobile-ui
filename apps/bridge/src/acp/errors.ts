/** Stable device-facing error codes. */
export type BridgeErrorCode =
  | 'invalid_message'
  | 'unauthorized'
  | 'session_busy'
  | 'session_gone'
  | 'session_cwd_mismatch'
  | 'session_not_found'
  | 'agent_disconnected'
  | 'agent_unavailable'
  | 'agent_error'
  | 'lease_held'
  | 'prompt_in_flight'
  | 'permission_gone'
  | 'audio_not_found'
  | 'audio_session_mismatch'

/** Error shape shared by the ACP supervisor, lease manager, and WS layer. */
export class BridgeError extends Error {
  readonly code: BridgeErrorCode
  readonly retryable: boolean

  constructor(code: BridgeErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
    this.retryable = retryable
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown agent error'
}

/**
 * Translate an ACP SDK / JSON-RPC failure into a stable device error code.
 * Only known phrases are matched; everything else stays a generic agent_error.
 */
export function mapAcpError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error

  const message = messageOf(error)
  const normalized = message.toLowerCase()

  if (normalized.includes('session is already active')) {
    return new BridgeError('session_busy', 'Session is active in another client', false)
  }
  if (normalized.includes('session is not resumable')) {
    return new BridgeError('session_gone', 'Session is not resumable', false)
  }
  if (normalized.includes('session cwd does not match')) {
    return new BridgeError(
      'session_cwd_mismatch',
      'Session working directory does not match',
      false,
    )
  }
  if (
    normalized.includes('connection closed') ||
    normalized.includes('connection is closed') ||
    normalized.includes('connection is not open') ||
    normalized.includes('econnreset') ||
    normalized.includes('epipe')
  ) {
    return new BridgeError('agent_disconnected', 'Agent connection is closed', true)
  }

  // Unrecognized ACP messages can contain paths or command lines; do not echo
  // them to devices. The code is enough for the client to show a generic error.
  return new BridgeError('agent_error', 'Agent request failed', false)
}
