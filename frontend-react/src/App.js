import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";

import Home from "./pages/Home.js";
import FileManager from "./pages/FileManager.js";
import FileSearch from "./pages/FileSearch.js";
import JournalLibrary from "./pages/JournalLibrary.js";

import Chat from "./pages/Chat.js";
import ApiUsage from "./pages/ApiUsage.js";
import Sessions from "./pages/Sessions.js";

import Header from "./components/Header.js";
import FloatingChat from "./components/FloatingChat.js";
import SideChat from "./components/SideChat.js";
import Toast from "./components/Toast.js";

import { subscribeToast } from "./store/toastStore.js";
import "./styles/global.css";

const SIDE_CHAT_KEY = "paperhub_side_chat";

/** 读取本地保存的侧边聊天状态（open / mode / messages） */
function loadSavedSideChat() {
    try {
        const raw = localStorage.getItem(SIDE_CHAT_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.messages)) return null;
        return data;
    } catch {
        return null;
    }
}

function AppContent() {
    // 判断当前是否在 /chat 页面
    const location = useLocation();
    // 侧边聊天：从本地恢复（刷新页面后不丢失打开的侧边聊天）
    const [sideChat, setSideChat] = useState(() => {
        const saved = loadSavedSideChat();
        return {
            open: saved?.open ?? false,
            mode: saved?.mode ?? "rag",
            question: "",
            messages: saved?.messages ?? [],
            seed: 0,
        };
    });

    // 侧边聊天状态变化时持久化到本地
    useEffect(() => {
        try {
            localStorage.setItem(
                SIDE_CHAT_KEY,
                JSON.stringify({
                    open: sideChat.open,
                    mode: sideChat.mode,
                    messages: sideChat.messages || [],
                })
            );
        } catch {
            /* 忽略 */
        }
    }, [sideChat.open, sideChat.mode, sideChat.messages]);

    // 右侧聊天面板宽度（可拖拽调整），默认与 CSS 中的 420px 一致
    const [sideChatWidth, setSideChatWidth] = useState(420);
    // 用户菜单是否打开（打开期间禁用右侧聊天面板拖拽）
    const [userMenuOpen, setUserMenuOpen] = useState(false);

    // useLocation，返回当前 URL 的 location 对象（包含 pathname、search、hash 等）
    // 用于在函数组件中获取当前路径
    const isChatPage = location.pathname === "/chat";

    // 打开聊天面板（保留已有会话消息，刷新/重开不丢失）
    function openSideChat({ mode, question }) {
        setSideChat((prev) => ({
            open: true,
            mode,
            question,
            messages: prev.messages || [],
            seed: Date.now(),
        }));
    }

    // 侧边聊天消息变化时回写 App 状态（用于持久化）
    function handleSideMessagesChange(messages) {
        setSideChat((prev) => ({ ...prev, messages }));
    }
    // 函数式更新（传入 prev 前一个状态）
    function closeSideChat() {
        setSideChat((prev) => ({
            // 展开运算符 ...prev 复制所有原有属性，只将 open 改为 false
            ...prev,
            open: false,
        }));
    }

    return (
        // <></>，包裹多个子元素而不增加额外的 DOM 节点
        <>
            <Header onUserMenuChange={setUserMenuOpen} />
            <div
                // className 模板字符串动态生成（注意使用反引号）
                className={`app-shell ${sideChat.open && !isChatPage ? "chat-open" : ""}`}
                style={{ "--side-chat-width": `${sideChatWidth}px` }}
            >
                <div className="app-main">
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/files" element={<FileManager />} />
                        <Route path="/search" element={<FileSearch />} />
                        <Route path="/library" element={<JournalLibrary />} />
                        <Route path="/chat" element={<Chat />} />
                        <Route path="/usage" element={<ApiUsage />} />
                        <Route path="/sessions" element={<Sessions />} />
                    </Routes>
                </div>

                {sideChat.open && !isChatPage && (
                    <SideChat
                        key={sideChat.seed}
                        mode={sideChat.mode}
                        initialQuestion={sideChat.question}
                        initialMessages={sideChat.messages}
                        onMessagesChange={handleSideMessagesChange}
                        onClose={closeSideChat}
                        onResize={setSideChatWidth}
                        resizeDisabled={userMenuOpen}
                    />
                )}
            </div>

            {!sideChat.open && !isChatPage && (
                <FloatingChat onOpenChat={openSideChat} />
            )}
        </>
    );
}

function App() {
    // useState 存储当前要显示的通知，初始值为空
    const [toast, setToast] = useState("");
    // useRef 保存定时器句柄，避免多次触发时消息提前消失
    const toastTimer = useRef(null);

    // useEffect：用于处理副作用（如数据请求、订阅、DOM 操作）。
    // 它接受一个函数和一个依赖数组，依赖变化时重新执行该函数；[] 表示只在挂载时执行
    useEffect(() => {
        return subscribeToast((msg) => {
            setToast(msg);
            clearTimeout(toastTimer.current);
            toastTimer.current = setTimeout(() => setToast(""), 2500);
        });
    }, []);

    return (
        <>
            <BrowserRouter>
                <AppContent />
            </BrowserRouter>
            <Toast message={toast} />
        </>
    );
}

export default App;