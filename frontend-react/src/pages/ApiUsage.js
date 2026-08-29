import {
    Activity,
    Coins,
    Cpu,
    Zap,
    Server,
    Database,
    KeyRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getApiUsage } from "../utils/chatStorage.js";
import { getUserConfig } from "../store/userConfig.js";
import { systemApi, userApi } from "../api/request.js";

export default function ApiUsage() {
    const [usage, setUsage] = useState(getApiUsage());
    const [config, setConfig] = useState(getUserConfig());
    // 服务状态：null=检测中，online/offline
    const [services, setServices] = useState({ backend: null, rag: null });

    useEffect(() => {
        function refreshUsage() {
            setUsage(getApiUsage());
        }

        function refreshConfig() {
            setConfig(getUserConfig());
        }

        window.addEventListener("paperhub:usage-updated", refreshUsage);
        window.addEventListener("user-config-change", refreshConfig);

        return () => {
            window.removeEventListener("paperhub:usage-updated", refreshUsage);
            window.removeEventListener("user-config-change", refreshConfig);
        };
    }, []);

    // 检测预设的后端与 RAG 服务状态
    useEffect(() => {
        systemApi
            .health()
            .then(() => setServices((s) => ({ ...s, backend: "online" })))
            .catch(() => setServices((s) => ({ ...s, backend: "offline" })));

        systemApi
            .ragHealth()
            .then(() => setServices((s) => ({ ...s, rag: "online" })))
            .catch(() => setServices((s) => ({ ...s, rag: "offline" })));
    }, []);

    return (
        <div className="inner-page">
            <div className="page-title">
                <span>API USAGE</span>
                <h1>API 用量</h1>
                <p>查看接口调用量、服务状态和当前模型配置</p>
            </div>

            <div className="usage-grid">
                <UsageCard
                    icon={<Cpu />}
                    title="当前模型"
                    value={config.model || "未设置"}
                />
                <UsageCard
                    icon={<Activity />}
                    title="今日请求"
                    value={usage.todayRequests}
                />
                <UsageCard
                    icon={<Zap />}
                    title="本月请求"
                    value={usage.monthRequests}
                />
                <UsageCard
                    icon={<Coins />}
                    title="累计 Tokens"
                    value={usage.totalTokens}
                />
                <UsageCard
                    icon={<KeyRound />}
                    title="API Provider"
                    value={config.provider || "DeepSeek"}
                />
                <UsageCard
                    icon={<Server />}
                    title="Express 后端"
                    value={serviceText(services.backend)}
                    status={services.backend}
                />
                <UsageCard
                    icon={<Database />}
                    title="RAG 服务"
                    value={serviceText(services.rag)}
                    status={services.rag}
                />
            </div>

            <div className="usage-meta">
                <span>Base URL：{config.apiUrl || "http://127.0.0.1:3000"}</span>
                <span>User ID：{userApi.getUserId()}</span>
            </div>
        </div>
    );
}

function serviceText(status) {
    if (status === "online") return "在线";
    if (status === "offline") return "离线";
    return "检测中...";
}

function UsageCard({ icon, title, value, status }) {
    return (
        <div className={`usage-card ${status ? status : ""}`}>
            <div className="usage-icon">{icon}</div>
            <span>{title}</span>
            <strong className={status ? status : ""}>{value}</strong>
        </div>
    );
}