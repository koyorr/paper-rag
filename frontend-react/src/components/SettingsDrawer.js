import {
    Brain,
    KeyRound,
    SlidersHorizontal,
    RefreshCw,
    X,
} from "lucide-react";
import { useState, useEffect } from "react";
import useClickOutside from "../hooks/useClickOutside.js";
import useDrawerResize from "../hooks/useDrawerResize.js";
import { systemApi, ragApi } from "../api/request.js";
import { showToast } from "../store/toastStore.js";
import { getUserConfig, saveUserConfig } from "../store/userConfig.js";
import {
    PROVIDERS,
    COMMON_EMBEDDING_MODELS,
    getProvider,
    getProviderDefaultUrl,
    fetchOllamaModels,
} from "../store/providerConfig.js";

/** 保存配置：写入本地，并同步到后端与 RAG 服务（接口未就绪时静默降级） */
async function syncConfig(next) {
    saveUserConfig(next);
    const results = await Promise.allSettled([
        systemApi.updateConfig(next),
        ragApi.updateConfig(next),
    ]);
    const ragValue =
        results[1].status === "fulfilled" ? results[1].value : null;
    return {
        backendOk: results[0].status === "fulfilled",
        ragOk: results[1].status === "fulfilled",
        // RAG 返回 restart_required=true 表示切换了嵌入模型/服务商，需重启后重建向量库
        ragRestartRequired: !!ragValue?.restart_required,
    };
}

function syncMessage(res) {
    const restartHint = res.ragRestartRequired
        ? "（切换嵌入模型/服务商需重启 RAG 服务后生效）"
        : "";
    if (res.backendOk && res.ragOk) {
        return `配置已保存并同步到后端与 RAG 服务${restartHint}`;
    }
    if (res.backendOk) {
        return `配置已保存，后端已同步（RAG 服务未连接）${restartHint}`;
    }
    if (res.ragOk) {
        return `配置已保存，RAG 已同步（后端未连接）${restartHint}`;
    }
    return "配置已保存到本地（服务端未连接）";
}

/** 合并选项：服务商预置列表 + 当前值，保证当前选择不被丢弃 */
function mergeOptions(list, current) {
    const set = new Set(list.filter(Boolean));
    if (current) set.add(current);
    return [...set];
}

export default function SettingsDrawer({ open, onClose, initialTab = "api" }) {
    const [tab, setTab] = useState(initialTab);
    const { drawerRef, drawerWidth, isResizingClass, onResizeHandleMouseDown } =
        useDrawerResize(480);
    useClickOutside(drawerRef, onClose);

    // 服务商与 Base URL 提升到抽屉层级，供 API / 模型两个页签联动
    const config = getUserConfig();
    const savedProvider = getProvider(config.provider)
        ? config.provider
        : "deepseek";
    const [provider, setProvider] = useState(savedProvider);
    const [apiUrl, setApiUrl] = useState(
        config.apiUrl || getProviderDefaultUrl(savedProvider)
    );

    useEffect(() => {
        if (open) {
            setTab(initialTab);
        }
    }, [open, initialTab]);

    if (!open) return null;

    return (
        <div className="settings-mask" onClick={onClose}>
            <div
                ref={drawerRef}
                className={`settings-drawer${isResizingClass ? " resizing" : ""}`}
                // 设置宽度可调整
                style={{ width: drawerWidth }}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className="resize-handle"
                    onMouseDown={onResizeHandleMouseDown}
                ></div>
                <div className="settings-header">
                    <div>
                        <h2>设置</h2>
                        <p>System preferences</p>
                    </div>
                    <button className="icon-button" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="settings-body">
                    <div className="settings-menu">
                        <SettingMenu
                            icon={<KeyRound />}
                            text="API 设置"
                            active={tab === "api"}
                            onClick={() => setTab("api")}
                        />
                        <SettingMenu
                            icon={<Brain />}
                            text="模型设置"
                            active={tab === "model"}
                            onClick={() => setTab("model")}
                        />
                        <SettingMenu
                            icon={<SlidersHorizontal />}
                            text="RAG 参数"
                            active={tab === "rag"}
                            onClick={() => setTab("rag")}
                        />
                    </div>

                    <div className="settings-content">
                        {tab === "api" && (
                            <ApiSettings
                                provider={provider}
                                onProviderChange={setProvider}
                                apiUrl={apiUrl}
                                onApiUrlChange={setApiUrl}
                                onClose={onClose}
                            />
                        )}
                        {tab === "model" && (
                            <ModelSettings
                                provider={provider}
                                apiUrl={apiUrl}
                                onClose={onClose}
                            />
                        )}
                        {tab === "rag" && <RagSettings onClose={onClose} />}
                    </div>
                </div>
            </div>
        </div>
    );
}

function SettingMenu({ icon, text, active, onClick }) {
    return (
        <button
            className={`settings-menu-item ${active ? "active" : ""}`}
            onClick={onClick}
        >
            {icon}
            {text}
        </button>
    );
}

function ApiSettings({
    provider,
    onProviderChange,
    apiUrl,
    onApiUrlChange,
    onClose,
}) {
    const config = getUserConfig();
    const [apiKey, setApiKey] = useState(config.apiKey || "");
    const [testing, setTesting] = useState(false);
    const [conn, setConn] = useState(null);

    const currentProvider = getProvider(provider);
    const regionOptions =
        currentProvider?.baseUrls && currentProvider.baseUrls.length > 1
            ? currentProvider.baseUrls
            : [];
    const regionIndex = regionOptions.findIndex((v) => v.url === apiUrl);
    const isOllama = provider === "ollama";

    // 切换服务商：自动填充对应 Base URL（多区域取默认第一个）
    function handleProviderChange(key) {
        onProviderChange(key);
        onApiUrlChange(getProviderDefaultUrl(key));
    }

    async function handleSave() {
        const next = { ...config, provider, apiKey, apiUrl };
        const res = await syncConfig(next);
        showToast(syncMessage(res));
        onClose();
    }

    async function handleTest() {
        setTesting(true);
        setConn(null);
        try {
            const result = await systemApi.testConnection();
            setConn(result);
        } catch (error) {
            setConn({ backend: false, rag: false, error: error.message });
        } finally {
            setTesting(false);
        }
    }

    return (
        <>
            <h3>API 设置</h3>
            <p className="settings-subtitle">
                配置 API 连接参数（保存后同步到后端与 RAG 服务）
            </p>
            <label>
                API Provider
                <select
                    value={provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                >
                    {PROVIDERS.map((p) => (
                        <option key={p.key} value={p.key}>
                            {p.label}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                API Key
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={isOllama ? "Ollama 本地可不填" : "sk-..."}
                />
            </label>
            {regionOptions.length > 0 && (
                <label>
                    接入区域
                    <select
                        value={regionIndex >= 0 ? regionIndex : 0}
                        onChange={(e) =>
                            onApiUrlChange(
                                regionOptions[Number(e.target.value)].url
                            )
                        }
                    >
                        {regionOptions.map((v, i) => (
                            <option key={v.url} value={i}>
                                {v.label}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            <label>
                Base URL
                <input
                    value={apiUrl}
                    onChange={(e) => onApiUrlChange(e.target.value)}
                    list="provider-base-urls"
                    placeholder="选择服务商后自动生成"
                />
                <datalist id="provider-base-urls">
                    {PROVIDERS.flatMap((p) =>
                        p.baseUrls
                            ? p.baseUrls.map((v) => v.url)
                            : p.baseUrl
                            ? [p.baseUrl]
                            : []
                    ).map((url) => (
                        <option key={url} value={url} />
                    ))}
                </datalist>
            </label>
            {isOllama && (
                <p className="settings-subtitle">
                    本地接入：Base URL 使用 http://127.0.0.1:11434/v1，API Key
                    可留空
                </p>
            )}

            <div className="settings-actions">
                <button className="primary-button" onClick={handleSave}>
                    保存 API
                </button>
                <button
                    className="toolbar-btn"
                    onClick={handleTest}
                    disabled={testing}
                >
                    {testing ? "测试中..." : "测试连接"}
                </button>
            </div>

            {conn && (
                <div className="conn-status">
                    <div
                        className={`conn-item ${
                            conn.backend ? "online" : "offline"
                        }`}
                    >
                        <span className="conn-dot" />
                        后端服务 (127.0.0.1:3000) ——{" "}
                        {conn.backend ? "在线" : "离线"}
                    </div>
                    <div
                        className={`conn-item ${conn.rag ? "online" : "offline"}`}
                    >
                        <span className="conn-dot" />
                        RAG 服务 (127.0.0.1:8000) ——{" "}
                        {conn.rag ? "在线" : "离线"}
                    </div>
                </div>
            )}
        </>
    );
}

function ModelSettings({ provider, apiUrl, onClose }) {
    const config = getUserConfig();
    const [chatModel, setChatModel] = useState(config.model || "deepseek-chat");
    const [embeddingModel, setEmbeddingModel] = useState(
        config.embeddingModel || "text-embedding-v4"
    );
    const [ollamaModels, setOllamaModels] = useState([]);
    const [ollamaLoading, setOllamaLoading] = useState(false);
    const [ollamaError, setOllamaError] = useState("");
    const [ollamaReload, setOllamaReload] = useState(0);

    const isOllama = provider === "ollama";

    // 选择 Ollama 时自动读取本地已下载模型
    useEffect(() => {
        if (!isOllama) {
            setOllamaModels([]);
            setOllamaError("");
            return;
        }
        let cancelled = false;
        setOllamaLoading(true);
        setOllamaError("");
        fetchOllamaModels(apiUrl)
            .then((list) => {
                if (!cancelled) setOllamaModels(list);
            })
            .catch((error) => {
                if (!cancelled) setOllamaError(error.message);
            })
            .finally(() => {
                if (!cancelled) setOllamaLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isOllama, apiUrl, ollamaReload]);

    const prov = getProvider(provider);
    const chatOptions = isOllama
        ? ollamaModels
        : mergeOptions(prov?.chatModels || [], chatModel);
    const embedOptions = isOllama
        ? ollamaModels
        : mergeOptions(
              [...(prov?.embeddingModels || []), ...COMMON_EMBEDDING_MODELS],
              embeddingModel
          );

    async function handleSave() {
        const next = {
            ...config,
            provider,
            apiUrl,
            model: chatModel,
            embeddingModel,
        };
        const res = await syncConfig(next);
        showToast(syncMessage(res));
        onClose();
    }

    return (
        <>
            <h3>模型设置</h3>
            <p className="settings-subtitle">
                {isOllama
                    ? "使用本地 Ollama 模型（自动读取已下载模型）"
                    : "选择对话与文本嵌入模型"}
            </p>

            {isOllama && (
                <div className="ollama-panel">
                    <div className="ollama-bar">
                        <RefreshCw
                            size={15}
                            className={ollamaLoading ? "spin" : ""}
                        />
                        <span>
                            {ollamaLoading
                                ? "正在读取本地模型..."
                                : ollamaModels.length > 0
                                ? `已检测到 ${ollamaModels.length} 个本地模型`
                                : "未检测到本地模型"}
                        </span>
                        <button
                            className="toolbar-btn"
                            onClick={() => setOllamaReload((v) => v + 1)}
                            disabled={ollamaLoading}
                        >
                            刷新
                        </button>
                    </div>
                    {ollamaError && (
                        <p className="ollama-error">{ollamaError}</p>
                    )}
                    <p className="ollama-hint">
                        嵌入模型示例：nomic-embed-text、bge-m3、mxbai-embed-large
                    </p>
                </div>
            )}

            <label>
                Chat Model
                <select
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                >
                    {chatOptions.length > 0 ? (
                        chatOptions.map((m) => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))
                    ) : (
                        <option value={chatModel}>
                            {chatModel || "（未选择）"}
                        </option>
                    )}
                </select>
            </label>
            <label>
                Embedding Model
                <select
                    value={embeddingModel}
                    onChange={(e) => setEmbeddingModel(e.target.value)}
                >
                    {embedOptions.length > 0 ? (
                        embedOptions.map((m) => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))
                    ) : (
                        <option value={embeddingModel}>
                            {embeddingModel || "（未选择）"}
                        </option>
                    )}
                </select>
            </label>
            <button className="primary-button" onClick={handleSave}>
                保存模型
            </button>
        </>
    );
}

function RagSettings({ onClose }) {
    const config = getUserConfig();
    const [topK, setTopK] = useState(config.topK ?? 4);
    const [chunkSize, setChunkSize] = useState(config.chunkSize ?? 800);
    const [chunkOverlap, setChunkOverlap] = useState(config.chunkOverlap ?? 80);
    const [temperature, setTemperature] = useState(config.temperature ?? 0.2);

    async function handleSave() {
        const next = {
            ...config,
            topK,
            chunkSize,
            chunkOverlap,
            temperature,
        };
        const res = await syncConfig(next);
        showToast(syncMessage(res));
        onClose();
    }

    return (
        <>
            <h3>RAG 参数</h3>
            <p className="settings-subtitle">调整检索增强生成参数</p>
            <label>
                Top K
                <input
                    type="number"
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                />
            </label>
            <label>
                Chunk Size
                <input
                    type="number"
                    value={chunkSize}
                    onChange={(e) => setChunkSize(Number(e.target.value))}
                />
            </label>
            <label>
                Chunk Overlap
                <input
                    type="number"
                    value={chunkOverlap}
                    onChange={(e) => setChunkOverlap(Number(e.target.value))}
                />
            </label>
            <label>
                Temperature
                <input
                    type="number"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                />
            </label>
            <button className="primary-button" onClick={handleSave}>
                保存参数
            </button>
        </>
    );
}
