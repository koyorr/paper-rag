import { Search, Sparkles, Send, Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { qaApi, chatApi } from "../api/request.js";
import { addRecentSession, recordApiUsage } from "../utils/chatStorage.js";
import { getUserConfig } from "../store/userConfig.js";

export default function ChatSession({
    initialMode = "rag",
    initialQuestion = "",
    initialMessages = [],
    fullPage = false,
    onClose,
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
            { role: "user", content: text },
        ]);
        setLoading(true);

        try {
            const config = getUserConfig();
            let response;

            if (mode === "rag") {
                // 论文检索：走 RAG 问答接口（携带模型 / RAG 参数）
                response = await qaApi.ask(text, {
                    topK: config.topK ?? 3,
                    model: config.model,
                    temperature: config.temperature,
                });
            } else {
                // 普通 AI 对话接口（预设 POST /api/chat，携带模型参数）
                response = await chatApi.send(text, {
                    model: config.model,
                    temperature: config.temperature,
                });
            }

            const answer =
                response.answer ?? response.message ?? "AI 没有返回内容";

            setMessages((prev) => [
                ...prev,
                {
                    role: "assistant",
                    content: answer,
                    sources: response.sources ?? [],
                },
            ]);

            addRecentSession({ mode, question: text, answer });
            recordApiUsage(response.usage);
        } catch (error) {
            console.error(error);
            let errorMessage = "请求失败，请检查后端服务。";
            if (mode === "ai" && error.status === 404) {
                errorMessage = "普通 AI 对话接口 /api/chat 尚未接入后端。";
            } else if (error.message) {
                errorMessage = error.message;
            }
            setMessages((prev) => [
                ...prev,
                { role: "assistant", content: errorMessage, error: true },
            ]);
        } finally {
            setLoading(false);
        }
    }

    function fullscreen() {
        navigate("/chat", { state: { mode, messages } });
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

                {messages.map((message, index) => (
                    <div key={index} className={`chat-message ${message.role}`}>
                        <div className="message-bubble">{message.content}</div>
                        {message.sources?.length > 0 && (
                            <div className="message-sources">
                                {message.sources.map((source, i) => (
                                    <span key={i}>
                                        {source.source}
                                        {source.page != null && ` · P${source.page}`}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                ))}

                {loading && (
                    <div className="chat-message assistant">
                        <div className="message-bubble loading-message">正在思考...</div>
                    </div>
                )}

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