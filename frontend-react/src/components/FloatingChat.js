import { Search, Sparkles, Send, Maximize2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function FloatingChat({ onOpenChat }) {
    const navigate = useNavigate();
    const [mode, setMode] = useState("rag");
    const [question, setQuestion] = useState("");

    function submit() {
        const value = question.trim();
        if (!value) return;

        onOpenChat({ mode, question: value });
        setQuestion("");
    }

    return (
        <div className="floating-chat">
            <div className="chat-toolbar">
                <div className="mode-switch">
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
                <button
                    className="chat-fullscreen-btn"
                    onClick={() => navigate("/chat")}
                    title="进入全屏对话"
                >
                    <Maximize2 size={14} />
                    全屏
                </button>
            </div>

            <div className="chat-input-row">
                <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") submit();
                    }}
                    placeholder={
                        mode === "rag"
                            ? "检索论文，例如：这篇论文的研究方法是什么？"
                            : "和 AI 对话..."
                    }
                />
                <button className="send-button" onClick={submit}>
                    <Send size={18} />
                </button>
            </div>
        </div>
    );
}
