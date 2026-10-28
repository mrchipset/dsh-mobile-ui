import { useEffect, useRef, useState } from 'react'

export type VoiceState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error'
export type VoiceSource = 'microphone' | 'demo'

export interface VoiceClip {
  blob: Blob
  mimeType: string
  durationMs: number
  source: VoiceSource
}

export interface UseVoiceRecorderOptions {
  demo: boolean
  transcribe: (clip: VoiceClip) => Promise<string>
  onTranscript: (text: string) => void
  demoTranscript?: string
  maxDurationMs?: number
  minDurationMs?: number
}

export interface VoiceRecorderApi {
  state: VoiceState
  elapsedMs: number
  level: number
  error: string | null
  start: () => Promise<void>
  stop: () => void
  cancel: () => void
  reset: () => void
}

export const VOICE_MAX_DURATION_MS = 60_000
export const VOICE_MIN_DURATION_MS = 300
export const DEMO_VOICE_TRANSCRIPT = '把支付回调改成异步处理，并补一个失败重试的测试。'

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4']

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  if (typeof MediaRecorder.isTypeSupported !== 'function') return null
  return MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return '麦克风权限被拒绝，请在浏览器设置中允许'
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return '没有找到可用的麦克风'
      case 'NotReadableError':
      case 'TrackStartError':
        return '麦克风正在被其他应用占用'
      case 'NotSupportedError':
        return '当前浏览器不支持录音'
      default:
        break
    }
  }
  return '录音失败，请重试'
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions): VoiceRecorderApi {
  const demo = options.demo
  const minDurationMs = options.minDurationMs ?? VOICE_MIN_DURATION_MS
  const maxDurationMs = options.maxDurationMs ?? VOICE_MAX_DURATION_MS

  const [state, setState] = useState<VoiceState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mountedRef = useRef(true)
  const stateRef = useRef<VoiceState>('idle')
  const attemptRef = useRef(0)
  const finishingRef = useRef(false)
  const cancelledRef = useRef(false)
  const startedAtRef = useRef<number | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef('')
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)

  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const transcribeRef = useRef(options.transcribe)
  const onTranscriptRef = useRef(options.onTranscript)
  const demoTranscriptRef = useRef(options.demoTranscript ?? DEMO_VOICE_TRANSCRIPT)
  transcribeRef.current = options.transcribe
  onTranscriptRef.current = options.onTranscript
  demoTranscriptRef.current = options.demoTranscript ?? DEMO_VOICE_TRANSCRIPT

  function setVoiceState(next: VoiceState): void {
    stateRef.current = next
    if (mountedRef.current) setState(next)
  }

  function clearCaptureTimers(): void {
    if (levelTimerRef.current !== null) {
      clearInterval(levelTimerRef.current)
      levelTimerRef.current = null
    }
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (maxTimerRef.current !== null) {
      clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
    }
  }

  function clearAllTimers(): void {
    clearCaptureTimers()
    if (demoTimerRef.current !== null) {
      clearTimeout(demoTimerRef.current)
      demoTimerRef.current = null
    }
  }

  function stopStream(stream: MediaStream | null = streamRef.current): void {
    if (stream === null) return
    for (const track of stream.getTracks()) track.stop()
    if (streamRef.current === stream) streamRef.current = null
  }

  function closeAudioGraph(): void {
    sourceNodeRef.current?.disconnect()
    sourceNodeRef.current = null
    const context = audioContextRef.current
    audioContextRef.current = null
    if (context !== null) {
      void context.close().catch(() => undefined)
    }
  }

  function stopRecorderSilently(): void {
    const recorder = recorderRef.current
    recorderRef.current = null
    chunksRef.current = []
    if (recorder === null) return
    recorder.ondataavailable = null
    recorder.onstop = null
    recorder.onerror = null
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // Recorder may already have stopped.
      }
    }
  }

  function releaseCaptureResources(): void {
    clearAllTimers()
    stopRecorderSilently()
    stopStream()
    closeAudioGraph()
    startedAtRef.current = null
  }

  function showVoiceError(message: string): void {
    releaseCaptureResources()
    finishingRef.current = false
    if (!mountedRef.current) return
    setVoiceState('error')
    setError(message)
    setElapsedMs(0)
    setLevel(0)
  }

  function startLevelLoop(stream: MediaStream): void {
    const AudioContextConstructor = window.AudioContext
    if (typeof AudioContextConstructor !== 'function') return

    let context: AudioContext
    try {
      context = new AudioContextConstructor()
    } catch {
      return
    }
    audioContextRef.current = context
    void context.resume().catch(() => undefined)

    let analyser: AnalyserNode
    try {
      const source = context.createMediaStreamSource(stream)
      analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      sourceNodeRef.current = source
    } catch {
      closeAudioGraph()
      return
    }

    const samples = new Uint8Array(analyser.fftSize)
    levelTimerRef.current = setInterval(() => {
      try {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) {
          const normalized = (sample - 128) / 128
          sum += normalized * normalized
        }
        const rms = Math.sqrt(sum / samples.length)
        const next = Math.min(1, rms * 4.2)
        setLevel((previous) => previous * 0.5 + next * 0.5)
      } catch {
        // Audio graph can close between ticks.
      }
    }, 80)
  }

  function startDemoLevelLoop(): void {
    levelTimerRef.current = setInterval(() => {
      const now = performance.now()
      const wave = Math.abs(Math.sin(now / 210)) * (0.68 + 0.32 * Math.sin(now / 83))
      setLevel(Math.min(1, 0.12 + wave * 0.82))
    }, 80)
  }

  function startCaptureTimers(stream: MediaStream | null): void {
    const startedAt = performance.now()
    startedAtRef.current = startedAt
    setElapsedMs(0)

    if (stream === null) startDemoLevelLoop()
    else startLevelLoop(stream)

    elapsedTimerRef.current = setInterval(() => {
      const current = startedAtRef.current
      if (current === null) return
      setElapsedMs(Math.min(maxDurationMs, performance.now() - current))
    }, 100)

    maxTimerRef.current = setTimeout(() => {
      finishRef.current()
    }, maxDurationMs)
  }

  async function transcribeClip(clip: VoiceClip): Promise<void> {
    const attempt = attemptRef.current
    setVoiceState('transcribing')
    setError(null)
    setLevel(0)
    try {
      const text = (await transcribeRef.current(clip)).trim()
      if (attempt !== attemptRef.current || !mountedRef.current) return
      if (text.length === 0) throw new Error('没有识别到文字，请再试一次')
      onTranscriptRef.current(text)
      setVoiceState('idle')
      setElapsedMs(0)
      setLevel(0)
      setError(null)
    } catch (transcriptionError) {
      if (attempt !== attemptRef.current || !mountedRef.current) return
      const message =
        transcriptionError instanceof Error && transcriptionError.message.length > 0
          ? transcriptionError.message
          : '语音转写失败，请重试'
      setVoiceState('error')
      setError(message)
      setElapsedMs(0)
      setLevel(0)
    }
  }

  function finish(): void {
    if (stateRef.current !== 'recording' || finishingRef.current) return
    finishingRef.current = true

    const startedAt = startedAtRef.current
    const durationMs =
      startedAt === null ? 0 : Math.max(0, Math.min(maxDurationMs, performance.now() - startedAt))

    clearCaptureTimers()
    setElapsedMs(durationMs)

    if (durationMs < minDurationMs) {
      cancelledRef.current = true
      stopRecorderSilently()
      stopStream()
      closeAudioGraph()
      startedAtRef.current = null
      finishingRef.current = false
      setVoiceState('error')
      setError('录音太短，已丢弃')
      setElapsedMs(0)
      setLevel(0)
      return
    }

    if (demo) {
      setVoiceState('transcribing')
      setLevel(0)
      demoTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return
        finishingRef.current = false
        onTranscriptRef.current(demoTranscriptRef.current.trim())
        setVoiceState('idle')
        setElapsedMs(0)
        setLevel(0)
        setError(null)
      }, 900)
      return
    }

    const recorder = recorderRef.current
    const mimeType = mimeTypeRef.current
    const attempt = attemptRef.current
    if (recorder === null || mimeType.length === 0) {
      finishingRef.current = false
      showVoiceError('录音失败，请重试')
      return
    }

    recorder.onstop = () => {
      const chunks = chunksRef.current
      chunksRef.current = []
      recorderRef.current = null
      stopStream()
      closeAudioGraph()
      startedAtRef.current = null
      finishingRef.current = false

      if (!mountedRef.current || cancelledRef.current || attempt !== attemptRef.current) return
      if (chunks.length === 0) {
        showVoiceError('没有录到声音，请再试一次')
        return
      }

      const blob = new Blob(chunks, { type: mimeType })
      if (blob.size === 0) {
        showVoiceError('没有录到声音，请再试一次')
        return
      }

      void transcribeClip({
        blob,
        mimeType,
        durationMs,
        source: 'microphone',
      })
    }

    try {
      recorder.stop()
    } catch {
      finishingRef.current = false
      showVoiceError('录音失败，请重试')
    }
  }

  const finishRef = useRef(finish)
  finishRef.current = finish

  async function start(): Promise<void> {
    if (stateRef.current === 'recording' || stateRef.current === 'requesting') return
    if (stateRef.current === 'transcribing') return

    const attempt = attemptRef.current + 1
    attemptRef.current = attempt
    cancelledRef.current = false
    finishingRef.current = false
    setError(null)
    setElapsedMs(0)
    setLevel(0)
    setVoiceState('requesting')

    if (demo) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      if (!mountedRef.current || attempt !== attemptRef.current) return
      setVoiceState('recording')
      startCaptureTimers(null)
      return
    }

    if (!window.isSecureContext) {
      showVoiceError('语音输入需要 HTTPS 或 localhost')
      return
    }
    if (
      typeof MediaRecorder === 'undefined' ||
      navigator.mediaDevices === undefined ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      showVoiceError('当前浏览器不支持录音')
      return
    }

    const mimeType = pickMimeType()
    if (mimeType === null) {
      showVoiceError('当前浏览器不支持录音格式')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      if (!mountedRef.current || attempt !== attemptRef.current) {
        stopStream(stream)
        return
      }

      streamRef.current = stream
      mimeTypeRef.current = mimeType
      chunksRef.current = []

      let recorder: MediaRecorder
      try {
        recorder = new MediaRecorder(stream, { mimeType })
      } catch {
        stopStream(stream)
        showVoiceError('当前浏览器不支持录音格式')
        return
      }

      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        showVoiceError('录音失败，请重试')
      }

      recorder.start(250)
      setVoiceState('recording')
      startCaptureTimers(stream)
    } catch (captureError) {
      if (!mountedRef.current || attempt !== attemptRef.current) return
      showVoiceError(microphoneError(captureError))
    }
  }

  function stop(): void {
    if (stateRef.current === 'recording') {
      finish()
      return
    }
    if (stateRef.current === 'requesting') {
      cancel()
    }
  }

  function cancel(): void {
    if (stateRef.current !== 'recording' && stateRef.current !== 'requesting') return
    cancelledRef.current = true
    attemptRef.current += 1
    finishingRef.current = false
    releaseCaptureResources()
    if (!mountedRef.current) return
    setVoiceState('idle')
    setElapsedMs(0)
    setLevel(0)
    setError(null)
  }

  function reset(): void {
    if (stateRef.current === 'recording' || stateRef.current === 'transcribing') return
    releaseCaptureResources()
    setVoiceState('idle')
    setElapsedMs(0)
    setLevel(0)
    setError(null)
  }

  function teardown(): void {
    attemptRef.current += 1
    cancelledRef.current = true
    finishingRef.current = false
    releaseCaptureResources()
  }

  const teardownRef = useRef(teardown)
  teardownRef.current = teardown

  useEffect(() => {
    mountedRef.current = true
    const handlePageHide = (): void => teardownRef.current()
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      mountedRef.current = false
      window.removeEventListener('pagehide', handlePageHide)
      teardownRef.current()
    }
  }, [])

  return { state, elapsedMs, level, error, start, stop, cancel, reset }
}
