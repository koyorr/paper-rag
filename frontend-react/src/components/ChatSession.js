import { Search, Sparkles, Send, Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { qaApi, chatApi } from "../api/request.js";
import { addRecentSession, recordApiUsage } from "../utils/chatStorage.js";
import { getUserConfig, getChatConfig } from "../store/userConfig.js";

export default function ChatSession({
    initialMode = "rag",
    initialQuestion = "",
    initialMessages = [],
    fullPage = false,
    onClose,
    onMessagesChange,
}) {
    const navigate = useNavigate();
    const [mode, setMode] = useState(initialMode);
    const [messages, setMessages] = useState(initialMessages);
    const [question, setQuestion] = useState("");
    const [loading, setLoading] = useState(false);
    const initialized = useRef(false);
    const messagesEndRef = useRef(null);

    // 新消息或加载状态变化时，自动滚动到底部
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "end",
        });
    }, [messages, loading]);

    // 消息变化时上报给父组件（用于侧边聊天持久化）
    useEffect(() => {
        onMessagesChange?.(messages);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages]);

    useEffect(() => {
        if (initialQuestion && !initialized.current) {
            initialized.current = true;
            sendMessage(initialQuestion);
        }
        // 仅在首次挂载时发送初始问题
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function sendMessage(customQuestion) {
        const text = (customQuestion ?? question).trim();
        if (!text || loading) return;

        setQuestion("");
        setMessages((prev) => [
            ...prev,
            { role: "user", content: text, mode },
        ]);
        // 先放一个空的流式气泡，后续逐 token 填充
        setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "", streaming: true, mode },
        ]);
        setLoading(true);

        let answer = "";
        let sources = [];
        let usage = {};
        const config = getUserConfig();

        function patchAnswer(value) {
            setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant" && last.streaming) {
                    next[next.length - 1] = { ...last, content: value };
                }
                return next;
            });
        }

        function finalizeMessage(overrides = {}) {
            setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant" && last.streaming) {
                    next[next.length - 1] = {
                        ...last,
                        content: answer || "AI 没有返回内容",
                        streaming: false,
                        sources,
                        ...overrides,
                    };
                }
                return next;
            });
        }

        try {
            const onEvent = (evt) => {
                if (evt.type === "delta") {
                    answer += evt.content || "";
                    patchAnswer(answer);
                } else if (evt.type === "sources") {
                    sources = evt.sources || [];
                } else if (evt.type === "usage") {
                    usage = evt.usage || {};
                }
            };

            if (mode === "rag") {
                // 论文检索：RAG 问答流式输出（携带模型 / RAG 参数）
                await qaApi.askStream(text, {
                    topK: config.topK ?? 5,
                    model: getChatConfig(config).model,
                    temperature: config.temperature,
                }, onEvent);
            } else {
                // 普通 AI 对话：/api/chat 流式输出
                await chatApi.stream(text, {
                    model: getChatConfig(config).model,
                    temperature: config.temperature,
                }, onEvent);
            }

            finalizeMessage();
            addRecentSession({ mode, question: text, answer });
            recordApiUsage(usage);
        } catch (error) {
            console.error(error);
            let errorMessage = "请求失败，请检查后端服务。";
            if (mode === "ai" && error.status === 404) {
                errorMessage = "普通 AI 对话接口 /api/chat 尚未接入后端。";
            } else if (error.message) {
                errorMessage = error.message;
            }
            finalizeMessage({ content: errorMessage, error: true });
        } finally {
            setLoading(false);
        }
    }

    function fullscreen() {
        navigate("/chat", { state: { mode, messages } });
    }

    // 按对话类型分组：连续相同 mode 的轮次合并为一组，便于区分论文检索 / AI 对话
    const groups = [];
    for (const message of messages) {
        const m = message.mode || initialMode;
        const last = groups[groups.length - 1];
        if (last && last.mode === m) {
            last.items.push(message);
        } else {
            groups.push({ mode: m, items: [message] });
        }
    }

    return (
        <div className={fullPage ? "chat-session full" : "chat-session"}>
            <div className="chat-session-header">
                <div>
                    <strong>AI Research Assistant</strong>
                    <span>{mode === "rag" ? "基于论文知识库" : "通用 AI 对话"}</span>
                </div>
                <div className="chat-header-actions">
                    {!fullPage && (
                        <button onClick={fullscreen}>
                            <Maximize2 size={17} />
                        </button>
                    )}
                    {onClose && (
                        <button onClick={onClose}>
                            <X size={18} />
                        </button>
                    )}
                </div>
            </div>

            <div className="chat-mode-tabs">
                <button
                    className={mode === "rag" ? "active" : ""}
                    onClick={() => setMode("rag")}
                >
                    <Search size={15} />
                    论文检索
                </button>
                <button
                    className={mode === "ai" ? "active" : ""}
                    onClick={() => setMode("ai")}
                >
                    <Sparkles size={15} />
                    AI 对话
                </button>
            </div>

            <div className="chat-messages">
                {messages.length === 0 && (
                    <div className="chat-empty">
                        <Sparkles size={28} />
                        <strong>开始新的研究对话</strong>
                        <span>可以询问论文内容、研究方法、结论或其他问题</span>
                    </div>
                )}

                {groups.map((group, groupIndex) => (
                    <div className="chat-group-wrap" key={groupIndex}>
                        <div
                            className={`chat-group ${
                                group.mode === "rag" ? "rag" : "ai"
                            }`}
                        >
                            {group.items.map((message, index) => (
                                <div
                                    key={index}
                                    className={`chat-message ${message.role}`}
                                >
                                    <div
                                        className={`message-bubble${
                                            message.streaming ? " streaming" : ""
                                        }`}
                                    >
                                        {message.content ||
                                            (message.streaming
                                                ? "正在思考..."
                                                : "")}
                                    </div>
                                    {message.sources?.length > 0 && (
                                        <div className="message-sources">
                                            {message.sources.map((source, i) => (
                                                <span key={i}>
                                                    {source.source}
                                                    {source.page != null &&
                                                        ` · P${source.page}`}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="chat-group-label">
                            {group.mode === "rag" ? "论文检索" : "AI 对话"}
                        </div>
                    </div>
                ))}

                {/* 用于自动滚动定位的空节点 */}
                <div ref={messagesEndRef} />
            </div>

            <div className="chat-composer">
                <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    }}
                    placeholder={mode === "rag" ? "继续询问论文..." : "继续和 AI 对话..."}
                />
                <button className="send-button" onClick={() => sendMessage()}>
                    <Send size={18} />
                </button>
            </div>
        </div>
    );
}