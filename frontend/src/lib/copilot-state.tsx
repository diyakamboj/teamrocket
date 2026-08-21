import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  askAgent,
  askAgentStreaming,
  getAgentModels,
  type AgentProgress,
  getCandidate,
  getChatAttachment,
  listAgentSessions,
  uploadChatAttachment,
  type AgentCitation,
  type AgentSessionSummary,
  type AgentStructuredPayload,
  type ChatAttachmentInfo,
  type CopilotModelInfo,
} from "./api";
import { useAppState } from "./app-state";
import { isBackendUuid } from "./utils";

/**
 * Candidate ids across the app now come from the backend store, so they are
 * real UUIDs and can be sent as AgentAskRequest.candidate_id. isBackendUuid
 * is kept as a guard against ids arriving from anywhere else — the backend
 * 422s on a non-UUID. See lib/utils.ts.
 */

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  source?: string | undefined;
  engine?: string | undefined;
  tools?: string[] | undefined;
  citations?: AgentCitation[] | undefined;
  structured?: AgentStructuredPayload | null | undefined;
  modelId?: string | undefined;
  attachments?: ChatAttachmentInfo[] | undefined;
  createdAt: string;
  /** Only set on role:"error" messages — lets the input bar retry the same query. */
  retryText?: string | undefined;
};

/**
 * Client-side heuristic label shown while a request is in flight — the backend
 * is request/response (no streaming), so this is an honest approximation of
 * what's happening, not a live progress feed. Once the response lands, the
 * message's real `tools` field (from the backend) replaces this guess.
 */
function guessToolInFlight(query: string): string {
  const q = query.toLowerCase();
  if (q.includes("compare")) return "Comparing candidates…";
  if (q.includes("gap")) return "Checking for gaps…";
  if (q.includes("must have") || q.includes("must-have") || q.includes("requirement")) {
    return "Checking requirements…";
  }
  if (q.includes("rank") || q.includes("search") || q.includes("find") || q.includes("top")) {
    return "Searching candidates…";
  }
  return "Thinking…";
}

let idSeq = 0;
function nextId(prefix: string) {
  idSeq += 1;
  return `${prefix}-${Date.now()}-${idSeq}`;
}

type SendOptions = {
  attachmentIds?: string[];
};

type Ctx = {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  sessionId: string | null;
  chatbotConversationId: string | null;
  send: (text: string, opts?: SendOptions) => Promise<void>;
  loading: boolean;
  toolInFlight: string | null;
  thinking: AgentProgress[];
  models: CopilotModelInfo[];
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
  sessions: AgentSessionSummary[];
  refreshSessions: () => Promise<void>;
  resumeSession: (session: AgentSessionSummary) => void;
  newSession: () => void;
  attachments: ChatAttachmentInfo[];
  attachFile: (file: File) => Promise<void>;
  removeAttachment: (id: string) => void;
  viewingCandidateName: string | null;
};

const CopilotCtx = createContext<Ctx | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const { viewingCandidateId, activeJobId, blindMode, weights } = useAppState();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatbotConversationId, setChatbotConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toolInFlight, setToolInFlight] = useState<string | null>(null);
  // What the agent reported doing for the message in flight.
  const [thinking, setThinking] = useState<AgentProgress[]>([]);

  const [models, setModels] = useState<CopilotModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [viewingCandidateName, setViewingCandidateName] = useState<string | null>(null);

  const [attachments, setAttachments] = useState<ChatAttachmentInfo[]>([]);
  const pollTimers = useRef<Record<string, number>>({});
  const boundCandidateRef = useRef<string | null>(null);
  const offeredCandidateRef = useRef<string | null>(null);

  // Load available models once.
  const loadModels = useCallback(() => {
    getAgentModels()
      .then((res) => {
        setModels(res.models);
        setSelectedModelId((current) => current ?? res.default_model_id);
      })
      .catch((error: unknown) => {
        setModels([]);
        toast.error("Couldn't load AI models", {
          description: error instanceof Error ? error.message : undefined,
          action: { label: "Retry", onClick: () => loadModels() },
        });
      });
  }, []);

  useEffect(() => {
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const rows = await listAgentSessions();
      setSessions(rows);
    } catch {
      // History is a nice-to-have — silently keep whatever we had.
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const resumeSession = useCallback((session: AgentSessionSummary) => {
    setSessionId(session.id);
    setChatbotConversationId(null);
    boundCandidateRef.current = session.candidate_id ?? null;
    setViewingCandidateName(session.candidate_name ?? null);

    const restored: ChatMessage[] = [];
    for (const raw of session.messages ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as {
        role?: string;
        content?: string;
        metadata?: {
          source?: string;
          engine?: string;
          tools?: string[];
          citations?: AgentCitation[];
          chatbot_conversation_id?: string;
        };
      };
      if (entry.role !== "user" && entry.role !== "assistant") continue;
      restored.push({
        id: nextId("restored"),
        role: entry.role,
        text: entry.content ?? "",
        source: entry.metadata?.source,
        engine: entry.metadata?.engine,
        tools: entry.metadata?.tools,
        citations: entry.metadata?.citations,
        createdAt: new Date().toISOString(),
      });
      if (entry.metadata?.chatbot_conversation_id) {
        setChatbotConversationId(entry.metadata.chatbot_conversation_id);
      }
    }
    setMessages(restored);
    setAttachments([]);
    setOpen(true);
  }, []);

  const newSession = useCallback(() => {
    setSessionId(null);
    setChatbotConversationId(null);
    setMessages([]);
    setAttachments([]);
    boundCandidateRef.current = null;
    setViewingCandidateName(null);
  }, []);

  // Keep the context strip's display name in sync with whatever candidate is
  // in view, independent of session history. Resolved from the backend store
  // so the strip shows the same name the rest of the app ranked.
  useEffect(() => {
    if (!viewingCandidateId) {
      setViewingCandidateName(null);
      return;
    }
    let cancelled = false;
    getCandidate(viewingCandidateId)
      .then((candidate) => {
        if (!cancelled) setViewingCandidateName(candidate.name);
      })
      .catch(() => {
        if (!cancelled) setViewingCandidateName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [viewingCandidateId]);

  // When the recruiter navigates to a different candidate, offer to resume a
  // session already bound to it (rather than silently resetting history).
  useEffect(() => {
    if (!viewingCandidateId) return;
    if (boundCandidateRef.current === viewingCandidateId) return;
    if (offeredCandidateRef.current === viewingCandidateId) return;
    const existing = sessions.find((s) => s.candidate_id === viewingCandidateId);
    if (existing) {
      offeredCandidateRef.current = viewingCandidateId;
      resumeSession(existing);
    }
  }, [viewingCandidateId, sessions, resumeSession]);

  const send = useCallback(
    async (text: string, opts?: SendOptions) => {
      const query = text.trim();
      if (!query || loading) return;

      const attachmentIds = opts?.attachmentIds ?? attachments.map((a) => a.id);
      const attachedInfos = attachments.filter((a) => attachmentIds.includes(a.id));

      const userMsg: ChatMessage = {
        id: nextId("user"),
        role: "user",
        text: query,
        attachments: attachedInfos.length > 0 ? attachedInfos : undefined,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, userMsg]);
      setLoading(true);
      setThinking([]);
      setToolInFlight(guessToolInFlight(query));

      try {
        const result = await askAgentStreaming(
          {
            query,
            job_id: activeJobId,
            session_id: sessionId,
            chatbot_conversation_id: chatbotConversationId,
            blind_mode: blindMode,
            weights,
            candidate_id: isBackendUuid(viewingCandidateId) ? viewingCandidateId : null,
            model_id: selectedModelId,
            attachment_ids: attachmentIds,
          },
          (progress) => setThinking((steps) => [...steps, progress]),
        );

        setSessionId(result.session_id);
        if (result.chatbot_conversation_id) {
          setChatbotConversationId(result.chatbot_conversation_id);
        }
        boundCandidateRef.current = result.candidate_id ?? boundCandidateRef.current;

        setMessages((m) => [
          ...m,
          {
            id: nextId("assistant"),
            role: "assistant",
            text: result.response,
            source: result.source,
            engine: result.engine,
            tools: result.tools,
            citations: result.citations,
            structured: result.structured,
            modelId: result.model_id,
            createdAt: new Date().toISOString(),
          },
        ]);
        setAttachments([]);
        void refreshSessions();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        setMessages((m) => [
          ...m,
          {
            id: nextId("error"),
            role: "error",
            text: message,
            retryText: query,
            createdAt: new Date().toISOString(),
          },
        ]);
        toast.error("AI couldn't answer that", {
          description: message,
          action: { label: "Retry", onClick: () => void send(query, opts) },
        });
      } finally {
        setLoading(false);
        setToolInFlight(null);
        setThinking([]);
      }
    },
    [
      loading,
      attachments,
      activeJobId,
      sessionId,
      chatbotConversationId,
      blindMode,
      weights,
      viewingCandidateId,
      selectedModelId,
      refreshSessions,
    ],
  );

  const pollAttachment = useCallback((id: string) => {
    const tick = async () => {
      try {
        const info = await getChatAttachment(id);
        setAttachments((prev) => prev.map((a) => (a.id === id ? info : a)));
        if (info.status === "processed" || info.status === "failed") {
          const timer = pollTimers.current[id];
          if (timer) window.clearInterval(timer);
          delete pollTimers.current[id];
        }
      } catch {
        const timer = pollTimers.current[id];
        if (timer) window.clearInterval(timer);
        delete pollTimers.current[id];
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 1500);
    pollTimers.current[id] = timer;
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(pollTimers.current)) window.clearInterval(timer);
    };
  }, []);

  const attachFile = useCallback(
    async (file: File) => {
      try {
        const info = await uploadChatAttachment(file, sessionId);
        setAttachments((prev) => [...prev, info]);
        if (info.status === "queued" || info.status === "processing") {
          pollAttachment(info.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        setMessages((m) => [
          ...m,
          {
            id: nextId("error"),
            role: "error",
            text: `Couldn't attach "${file.name}": ${message}`,
            createdAt: new Date().toISOString(),
          },
        ]);
        toast.error(`Couldn't attach "${file.name}"`, {
          description: message,
          action: { label: "Retry", onClick: () => void attachFile(file) },
        });
      }
    },
    [sessionId, pollAttachment],
  );

  const removeAttachment = useCallback((id: string) => {
    const timer = pollTimers.current[id];
    if (timer) window.clearInterval(timer);
    delete pollTimers.current[id];
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      open,
      setOpen,
      messages,
      sessionId,
      chatbotConversationId,
      send,
      loading,
      toolInFlight,
      thinking,
      models,
      selectedModelId,
      setSelectedModelId,
      sessions,
      refreshSessions,
      resumeSession,
      newSession,
      attachments,
      attachFile,
      removeAttachment,
      viewingCandidateName,
    }),
    [
      open,
      messages,
      sessionId,
      chatbotConversationId,
      send,
      loading,
      toolInFlight,
      thinking,
      models,
      selectedModelId,
      sessions,
      refreshSessions,
      resumeSession,
      newSession,
      attachments,
      attachFile,
      removeAttachment,
      viewingCandidateName,
    ],
  );

  return <CopilotCtx.Provider value={value}>{children}</CopilotCtx.Provider>;
}

export function useCopilot() {
  const ctx = useContext(CopilotCtx);
  if (!ctx) throw new Error("useCopilot must be used inside CopilotProvider");
  return ctx;
}
