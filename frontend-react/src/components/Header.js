import {
    Settings,
    UserRound,
    BookOpenText,
    ChevronDown,
    CircleUserRound,
    LogOut,
} from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import SettingsDrawer from "./SettingsDrawer.js";
import ProfileDrawer from "./ProfileDrawer.js";
import useClickOutside from "../hooks/useClickOutside.js";

// 顶部导航配置：集中维护，便于后续扩展
const NAV_ITEMS = [
    { to: "/", label: "首页" },
    { to: "/files", label: "文件管理" },
    { to: "/search", label: "文件检索" },
    { to: "/library", label: "期刊文献库" },
    { to: "/chat", label: "全屏对话" },
    { to: "/sessions", label: "会话记录" },
    { to: "/usage", label: "API用量" },
];

export default function Header({ onUserMenuChange }) {
    const navigate = useNavigate();
    const location = useLocation();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState("api");
    const [userMenuOpen, setUserMenuOpen] = useState(false);

    const userMenuRef = useRef(null);
    useClickOutside(userMenuRef, () => setUserMenuOpen(false));

    // 用户菜单开合状态同步给 App（用于禁用右侧聊天面板的拖拽调整）
    useEffect(() => {
        onUserMenuChange?.(userMenuOpen);
    }, [userMenuOpen, onUserMenuChange]);

    function openSettings(tab) {
        setSettingsTab(tab);
        setSettingsOpen(true);
        setUserMenuOpen(false);
    }

    // 高亮当前所在页面（首页精确匹配，其余按前缀匹配）
    function isActive(to) {
        if (to === "/") return location.pathname === "/";
        return location.pathname.startsWith(to);
    }

    function logout() {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUserMenuOpen(false);
        navigate("/");
    }

    return (
        <>
            <header className="top-header">
                <Link to="/" className="brand">
                    <span className="brand-logo">
                        <BookOpenText size={19} />
                    </span>
                    <span className="brand-text">
                        PAPER
                        <b>HUB</b>
                    </span>
                </Link>

                <nav className="main-nav">
                    {NAV_ITEMS.map((item) => (
                        <Link
                            key={item.to}
                            to={item.to}
                            className={isActive(item.to) ? "active" : ""}
                        >
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="header-actions">
                    <button
                        className="icon-button"
                        onClick={() => openSettings("api")}
                    >
                        <Settings size={19} />
                    </button>

                    <div className="user-menu-wrapper" ref={userMenuRef}>
                        <button
                            className="user-button"
                            onClick={() => setUserMenuOpen(!userMenuOpen)}
                        >
                            <UserRound size={18} />
                            用户
                            <ChevronDown size={14} />
                        </button>

                        {userMenuOpen && (
                            <div className="user-dropdown">
                                <button
                                    onClick={() => {
                                        setProfileOpen(true);
                                        setUserMenuOpen(false);
                                    }}
                                >
                                    <CircleUserRound size={17} />
                                    个人信息
                                </button>
                                <div className="dropdown-divider" />
                                <button className="logout-item" onClick={logout}>
                                    <LogOut size={17} />
                                    退出登录
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <SettingsDrawer
                open={settingsOpen}
                initialTab={settingsTab}
                onClose={() => setSettingsOpen(false)}
            />
            <ProfileDrawer
                open={profileOpen}
                onClose={() => setProfileOpen(false)}
            />
        </>
    );
}
