import { UserRound, X } from "lucide-react";
import { useState } from "react";
import useClickOutside from "../hooks/useClickOutside.js";
import useDrawerResize from "../hooks/useDrawerResize.js";
import { showToast } from "../store/toastStore.js";
import { getUserConfig, saveUserConfig } from "../store/userConfig.js";

export default function ProfileDrawer({ open, onClose }) {
    const { drawerRef, drawerWidth, isResizingClass, onResizeHandleMouseDown } =
        useDrawerResize(480);
    useClickOutside(drawerRef, onClose);

    if (!open) return null;

    return (
        <div className="settings-mask" onClick={onClose}>
            <div
                ref={drawerRef}
                className={`settings-drawer${isResizingClass ? " resizing" : ""}`}
                style={{ width: drawerWidth }}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className="resize-handle"
                    onMouseDown={onResizeHandleMouseDown}
                ></div>
                <div className="settings-header">
                    <div>
                        <h2>个人信息</h2>
                        <p>管理你的个人资料</p>
                    </div>
                    <button className="icon-button" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div
                    className="settings-body"
                    style={{
                        display: "flex",
                        justifyContent: "center",
                        padding: "20px 28px 28px 28px",
                    }}
                >
                    <ProfileContent onClose={onClose} />
                </div>
            </div>
        </div>
    );
}

function ProfileContent({ onClose }) {
    const config = getUserConfig();
    const [name, setName] = useState(config.name || "");
    const [email, setEmail] = useState(config.email || "");

    function handleSave() {
        saveUserConfig({ ...config, name, email });
        showToast("保存成功");
        onClose();
    }

    return (
        <div className="profile-content-wrapper">
            <div className="profile-avatar">
                <UserRound size={64} strokeWidth={1.5} />
            </div>
            <label>
                用户名
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="请输入用户名"
                />
            </label>
            <label>
                Email
                <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@email.com"
                />
            </label>
            <button className="primary-button" onClick={handleSave}>
                保存修改
            </button>
        </div>
    );
}
