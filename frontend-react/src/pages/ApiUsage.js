import {
    Activity,
    Coins,
    MessageSquareText,
    Layers,
    Cloud,
    Zap,
    Server,
    Database,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getApiUsage } from "../utils/chatStorage.js";
import {
    getUserConfig,
    getChatConfig,
    getEmbeddingConfig,
} from "../store/userConfig.js";
import { getProvider } from "../store/providerConfig.js";
import { systemApi, userApi } from "../api/request.js";

/** 厂商显示名：Ollama 时显示 "Ollama"，云端显示服务商名称 */
function providerLabel(key) {
    if (!key) return "未设置";
    const label = getProvider(key)?.label;
    if (key === "ollama") return "Ollama";
    return label || key;
}

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
                    icon={<MessageSquareText />}
                    title="对话模型"
                    value={getChatConfig(config).model || "未设置"}
                />
                <UsageCard
                    icon={<Layers />}
                    title="嵌入模型"
                    value={getEmbeddingConfig(config).model || "未设置"}
                />
                <UsageCard
                    icon={<Cloud />}
                    title="对话厂商"
                    value={providerLabel(getChatConfig(config).provider)}
                />
                <UsageCard
                    icon={<Cloud />}
                    title="嵌入厂商"
                    value={providerLabel(getEmbeddingConfig(config).provider)}
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
                <span>对话 Base URL：{getChatConfig(config).apiUrl || "未设置"}</span>
                <span>嵌入 Base URL：{getEmbeddingConfig(config).apiUrl || "未设置"}</span>
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