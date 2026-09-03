import { useEffect, useRef } from "react";
import ChatSession from "./ChatSession.js";

/**
 * 右侧聊天面板：可拖拽左侧边缘调整宽度。
 * onResize(width) 会把宽度同步给 App，用于联动调整左侧主内容区边距。
 */
export default function SideChat({
    mode,
    initialQuestion,
    initialMessages = [],
    onMessagesChange,
    onClose,
    onResize,
    resizeDisabled = false,
}) {
    const isResizing = useRef(false);

    // 开始拖拽
    function handleMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();
        isResizing.current = true;
        // 禁止文本选择，避免拖拽时选中页面内容
        document.body.style.userSelect = "none";
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    }

    function handleMouseMove(e) {
        if (!isResizing.current) return;
        // 面板固定在右侧，宽度 = 视口宽 - 鼠标 x
        const newWidth = window.innerWidth - e.clientX;
        // 限制宽度范围：最小 320px，最大视口宽度的 80%
        const clamped = Math.min(Math.max(newWidth, 320), window.innerWidth * 0.8);
        onResize?.(Math.round(clamped));
    }

    function handleMouseUp() {
        isResizing.current = false;
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
    }

    // 组件卸载时清理（handleMouseMove/handleMouseUp 仅依赖 refs，稳定无需重订阅）
    useEffect(() => {
        return () => {
            isResizing.current = false;
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <aside className="side-chat-panel">
            <div
                className={`side-chat-resize-handle${resizeDisabled ? " disabled" : ""}`}
                onMouseDown={(e) => {
                    if (resizeDisabled) return;
                    handleMouseDown(e);
                }}
                title={resizeDisabled ? "用户菜单打开时不可调整宽度" : "拖拽调整宽度"}
            />
            <ChatSession
                initialMode={mode}
                initialQuestion={initialQuestion}
                initialMessages={initialMessages}
                onMessagesChange={onMessagesChange}
                onClose={onClose}
            />
        </aside>
    );
}