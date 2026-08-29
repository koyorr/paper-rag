import { MessageSquareText, Clock, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getRecentSessions } from "../utils/chatStorage.js";

const TYPES = ["全部", "检索", "AI对话"];

export default function Sessions() {
    const [sessions, setSessions] = useState(getRecentSessions);
    const [activeType, setActiveType] = useState("全部");

    useEffect(() => {
        function refresh() {
            setSessions(getRecentSessions());
        }

        window.addEventListener("paperhub:history-updated", refresh);
        return () =>
            window.removeEventListener("paperhub:history-updated", refresh);
    }, []);

    const filtered =
        activeType === "全部"
            ? sessions
            : sessions.filter((item) => item.type === activeType);

    // 删除单条记录（写入 localStorage 并广播刷新事件）
    function handleDelete(id) {
        const next = sessions.filter((item) => item.id !== id);
        localStorage.setItem("paperhub_recent_sessions", JSON.stringify(next));
        window.dispatchEvent(new Event("paperhub:history-updated"));
    }

    // 清空全部记录
    function handleClearAll() {
        if (sessions.length === 0) return;
        if (!window.confirm("确定清空全部会话记录吗？")) return;
        localStorage.setItem("paperhub_recent_sessions", "[]");
        window.dispatchEvent(new Event("paperhub:history-updated"));
    }

    return (
        <div className="inner-page">
            <div className="page-title">
                <span>SESSION HISTORY</span>
                <h1>会话记录</h1>
                <p>查看最近的 AI 对话和论文检索记录</p>
            </div>

            {sessions.length > 0 && (
                <div className="sessions-toolbar">
                    <div className="mode-switch">
                        {TYPES.map((type) => (
                            <button
                                key={type}
                                className={activeType === type ? "active" : ""}
                                onClick={() => setActiveType(type)}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                    <button className="toolbar-btn" onClick={handleClearAll}>
                        <Trash2 size={14} />
                        清空记录
                    </button>
                </div>
            )}

            {sessions.length === 0 ? (
                <div className="empty-state">
                    <Sparkles size={32} />
                    <p>暂无会话记录</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="empty-state">
                    <Sparkles size={32} />
                    <p>当前分类下暂无记录</p>
                </div>
            ) : (
                <div className="sessions-list">
                    {filtered.map((item) => (
                        <div className="session-row" key={item.id}>
                            <div className="session-row-icon">
                                <MessageSquareText size={18} />
                            </div>
                            <div className="session-row-body">
                                <strong>{item.title}</strong>
                                {item.preview && (
                                    <span className="session-preview">
                                        {item.preview}
                                    </span>
                                )}
                            </div>
                            <div className="session-row-meta">
                                <span className="session-type">{item.type}</span>
                                <span className="session-time">
                                    <Clock size={12} />
                                    {new Date(item.createdAt).toLocaleString("zh-CN")}
                                </span>
                            </div>
                            <button
                                className="session-delete"
                                title="删除该记录"
                                onClick={() => handleDelete(item.id)}
                            >
                                <Trash2 size={15} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}