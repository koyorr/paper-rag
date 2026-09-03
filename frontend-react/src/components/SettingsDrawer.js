import { RefreshCw, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
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

/** 判断模型名是否为 Ollama 风格（含 :tag 后缀，如 qwen3-embedding:8b-q4_K_M） */
function isOllamaStyleModel(name = "") {
    return typeof name === "string" && /^[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$/.test(name);
}

/** 云端嵌入模型回退值：与现有向量库（1024 维 text-embedding-v4）保持一致 */
const CLOUD_EMBEDDING_FALLBACK = "text-embedding-v4";

/** 拉取 Ollama 本地模型列表（对话 / 嵌入可各自触发） */
function useOllamaModels(enabled, apiUrl) {
    const [models, setModels] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reload, setReload] = useState(0);

    useEffect(() => {
        if (!enabled) {
            setModels([]);
            setError("");
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError("");
        fetchOllamaModels(apiUrl)
            .then((list) => {
                if (!cancelled) setModels(list);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [enabled, apiUrl, reload]);

    return {
        models,
        loading,
        error,
        reload: () => setReload((v) => v + 1),
    };
}

/**
 * 模型设置抽屉：模型选择 → API 设置 → RAG 参数 一屏展开，
 * 底部合并一个保存按钮；聊天 / 嵌入模型可共用或分别设置 API。
 * initialTab 仅用于打开时定位区块（model / api / rag）。
 */
export default function SettingsDrawer({ open, onClose, initialTab = "model" }) {
    const { drawerRef, drawerWidth, isResizingClass, onResizeHandleMouseDown } =
        useDrawerResize(480);
    useClickOutside(drawerRef, onClose);

    const config = getUserConfig();

    // API 使用模式：shared（共用）| separate（分别设置）
    const [modelApiMode, setModelApiMode] = useState(
        config.modelApiMode === "separate" ? "separate" : "shared"
    );

    // 对话侧
    const savedProvider = getProvider(config.provider)
        ? config.provider
        : "deepseek";
    const [provider, setProvider] = useState(savedProvider);
    const [apiKey, setApiKey] = useState(config.apiKey || "");
    const [apiUrl, setApiUrl] = useState(
        config.apiUrl || getProviderDefaultUrl(savedProvider)
    );
    const [chatModel, setChatModel] = useState(config.model || "deepseek-chat");

    // 嵌入侧
    const savedEmbProvider = getProvider(config.embeddingProvider)
        ? config.embeddingProvider
        : config.provider || "qwen";
    const [embeddingProvider, setEmbeddingProvider] = useState(
        savedEmbProvider
    );
    const [embeddingApiKey, setEmbeddingApiKey] = useState(
        config.embeddingApiKey || config.apiKey || ""
    );
    const [embeddingApiUrl, setEmbeddingApiUrl] = useState(
        config.embeddingApiUrl ||
            config.apiUrl ||
            getProviderDefaultUrl(savedEmbProvider)
    );
    const [embeddingModel, setEmbeddingModel] = useState(
        config.embeddingModel || "text-embedding-v4"
    );

    // RAG 参数
    const [topK, setTopK] = useState(config.topK ?? 4);
    const [chunkSize, setChunkSize] = useState(config.chunkSize ?? 800);
    const [chunkOverlap, setChunkOverlap] = useState(config.chunkOverlap ?? 80);
    const [temperature, setTemperature] = useState(config.temperature ?? 0.2);

    // 连通性测试
    const [testing, setTesting] = useState(false);
    const [conn, setConn] = useState(null);

    // 对话 / 嵌入各自需要的 Ollama 本地模型
    const chatOllama = useOllamaModels(provider === "ollama", apiUrl);
    const embIsOllama =
        (modelApiMode === "separate" ? embeddingProvider : provider) ===
        "ollama";
    const embApiUrl =
        modelApiMode === "separate" ? embeddingApiUrl : apiUrl;
    const embeddingOllama = useOllamaModels(embIsOllama, embApiUrl);

    const modelSectionRef = useRef(null);
    const apiSectionRef = useRef(null);
    const ragSectionRef = useRef(null);

    // 打开时定位到指定区块（默认模型选择；上传引导也会跳到模型选择）
    useEffect(() => {
        if (!open) return;
        const sectionMap = {
            model: modelSectionRef,
            api: apiSectionRef,
            rag: ragSectionRef,
        };
        const target = sectionMap[initialTab] || modelSectionRef;
        const frame = requestAnimationFrame(() => {
            target.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        });
        return () => cancelAnimationFrame(frame);
    }, [open, initialTab]);

    // 切换模式：进入「分别设置」时用共用配置初始化嵌入侧，避免空值
    function handleModeChange(mode) {
        setModelApiMode(mode);
        if (mode === "separate") {
            setEmbeddingProvider((prev) => prev || provider);
            setEmbeddingApiKey((prev) => prev || apiKey);
            setEmbeddingApiUrl((prev) => prev || apiUrl);
        }
    }

    function handleProviderChange(key) {
        const nextProv = getProvider(key);
        setProvider(key);
        setApiUrl(getProviderDefaultUrl(key));
        // 切换服务商时，若当前模型不在新服务商列表内，回退到该服务商默认模型
        if (key !== "ollama" && nextProv?.chatModels?.length) {
            if (!nextProv.chatModels.includes(chatModel)) {
                setChatModel(nextProv.chatModels[0]);
            }
            // shared 模式下嵌入模型跟随主服务商，避免 Ollama 模型名残留
            if (modelApiMode !== "separate") {
                setEmbeddingModel(CLOUD_EMBEDDING_FALLBACK);
            }
        } else if (key === "ollama" && modelApiMode !== "separate") {
            // 切到 Ollama：嵌入模型由本地模型列表决定，保留输入框当前值
        }
    }

    function handleEmbeddingProviderChange(key) {
        setEmbeddingProvider(key);
        setEmbeddingApiUrl(getProviderDefaultUrl(key));
        // 切到云端服务商时重置嵌入模型，避免残留 Ollama 模型名
        if (key !== "ollama") {
            setEmbeddingModel(CLOUD_EMBEDDING_FALLBACK);
        }
    }

    async function handleSave() {
        const shared = { provider, apiKey, apiUrl };
        const emb =
            modelApiMode === "separate"
                ? {
                      provider: embeddingProvider,
                      apiKey: embeddingApiKey,
                      apiUrl: embeddingApiUrl,
                  }
                : shared;
        // 保存前兜底：云端服务商不允许使用 Ollama 风格的嵌入模型，避免检索/问答报错
        const effEmbProvider = modelApiMode === "separate" ? embeddingProvider : provider;
        const resolvedEmbeddingModel =
            effEmbProvider !== "ollama" && isOllamaStyleModel(embeddingModel)
                ? CLOUD_EMBEDDING_FALLBACK
                : embeddingModel;

        // 保存前兜底：Ollama 下对话模型必须是本地已下载的模型
        let resolvedChatModel = chatModel;
        if (provider === "ollama" && chatOllama.models.length) {
            if (!chatOllama.models.includes(chatModel)) {
                const preferred = chatOllama.models.find(
                    (m) => /qwen/i.test(m) && !/embed/i.test(m)
                );
                resolvedChatModel = preferred || chatOllama.models[0];
            }
        }

        const next = {
            name: config.name,
            modelApiMode,
            ...shared,
            model: resolvedChatModel,
            embeddingProvider: emb.provider,
            embeddingApiKey: emb.apiKey,
            embeddingApiUrl: emb.apiUrl,
            embeddingModel: resolvedEmbeddingModel,
            topK,
            chunkSize,
            chunkOverlap,
            temperature,
        };
        const res = await syncConfig(next);
        showToast(syncMessage(res));
        // 保存后不关闭抽屉，便于继续测试连接 / 调整其它参数
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

    if (!open) return null;

    // 对话 / 嵌入模型下拉选项
    const chatProv = getProvider(provider);
    const chatOptions =
        provider === "ollama"
            ? chatOllama.models
            : mergeOptions(chatProv?.chatModels || [], chatModel);
    const embProv = getProvider(
        modelApiMode === "separate" ? embeddingProvider : provider
    );
    const embedOptions = embIsOllama
        ? embeddingOllama.models
        : mergeOptions(
              [...(embProv?.embeddingModels || []), ...COMMON_EMBEDDING_MODELS],
              embeddingModel
          );

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
                        <h2>模型设置</h2>
                        <p>Model settings</p>
                    </div>
                    <button className="icon-button" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="settings-body">
                    <div className="settings-content">
                        <section ref={modelSectionRef} className="settings-section">
                            <ModelSelectSection
                                modelApiMode={modelApiMode}
                                onModeChange={handleModeChange}
                                provider={provider}
                                embeddingProvider={embeddingProvider}
                                chatModel={chatModel}
                                onChatModelChange={setChatModel}
                                embeddingModel={embeddingModel}
                                onEmbeddingModelChange={setEmbeddingModel}
                                chatOptions={chatOptions}
                                embedOptions={embedOptions}
                                embIsOllama={embIsOllama}
                                chatOllama={chatOllama}
                                embeddingOllama={embeddingOllama}
                            />
                        </section>
                        <section ref={apiSectionRef} className="settings-section">
                            <ApiSettingsSection
                                modelApiMode={modelApiMode}
                                provider={provider}
                                onProviderChange={handleProviderChange}
                                apiKey={apiKey}
                                onApiKeyChange={setApiKey}
                                apiUrl={apiUrl}
                                onApiUrlChange={setApiUrl}
                                embeddingProvider={embeddingProvider}
                                onEmbeddingProviderChange={
                                    handleEmbeddingProviderChange
                                }
                                embeddingApiKey={embeddingApiKey}
                                onEmbeddingApiKeyChange={setEmbeddingApiKey}
                                embeddingApiUrl={embeddingApiUrl}
                                onEmbeddingApiUrlChange={setEmbeddingApiUrl}
                            />
                        </section>
                        <section ref={ragSectionRef} className="settings-section">
                            <RagSettingsSection
                                topK={topK}
                                onTopKChange={setTopK}
                                chunkSize={chunkSize}
                                onChunkSizeChange={setChunkSize}
                                chunkOverlap={chunkOverlap}
                                onChunkOverlapChange={setChunkOverlap}
                                temperature={temperature}
                                onTemperatureChange={setTemperature}
                            />
                        </section>

                        <div className="settings-footer">
                            <button
                                className="primary-button settings-save-btn"
                                onClick={handleSave}
                            >
                                保存
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
                                    className={`conn-item ${
                                        conn.rag ? "online" : "offline"
                                    }`}
                                >
                                    <span className="conn-dot" />
                                    RAG 服务 (127.0.0.1:8000) ——{" "}
                                    {conn.rag ? "在线" : "离线"}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ModelSelectSection({
    modelApiMode,
    onModeChange,
    provider,
    embeddingProvider,
    chatModel,
    onChatModelChange,
    embeddingModel,
    onEmbeddingModelChange,
    chatOptions,
    embedOptions,
    embIsOllama,
    chatOllama,
    embeddingOllama,
}) {
    const chatProvName = getProvider(provider)?.label || provider;
    const embProvName =
        getProvider(modelApiMode === "separate" ? embeddingProvider : provider)
            ?.label ||
        embeddingProvider ||
        provider;

    return (
        <>
            <h3>模型选择</h3>
            <p className="settings-subtitle">
                选择对话与文本嵌入模型，可共用或分别设置 API
            </p>

            <div className="mode-toggle">
                <button
                    className={modelApiMode === "shared" ? "active" : ""}
                    onClick={() => onModeChange("shared")}
                >
                    共用一个 API
                </button>
                <button
                    className={modelApiMode === "separate" ? "active" : ""}
                    onClick={() => onModeChange("separate")}
                >
                    分别设置 API
                </button>
            </div>

            {modelApiMode === "separate" && (
                <p className="settings-subtitle">
                    对话模型：{chatProvName} ｜ 嵌入模型：{embProvName}
                </p>
            )}

            <label>
                Chat Model
                <select
                    value={chatModel}
                    onChange={(e) => onChatModelChange(e.target.value)}
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
            {provider === "ollama" && (
                <OllamaPanel
                    ollama={chatOllama}
                    title="对话（本地 Ollama）"
                    hint="对话模型示例：qwen2.5、llama3、deepseek-r1"
                />
            )}

            <label>
                Embedding Model
                <select
                    value={embeddingModel}
                    onChange={(e) => onEmbeddingModelChange(e.target.value)}
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
            {embIsOllama && (
                <OllamaPanel
                    ollama={embeddingOllama}
                    title="嵌入（本地 Ollama）"
                    hint="嵌入模型示例：nomic-embed-text、bge-m3、mxbai-embed-large"
                />
            )}
        </>
    );
}

function OllamaPanel({ ollama, title, hint }) {
    return (
        <div className="ollama-panel">
            {title && <p className="api-block-title">{title}</p>}
            <div className="ollama-bar">
                <RefreshCw
                    size={15}
                    className={ollama.loading ? "spin" : ""}
                />
                <span>
                    {ollama.loading
                        ? "正在读取本地模型..."
                        : ollama.models.length > 0
                        ? `已检测到 ${ollama.models.length} 个本地模型`
                        : "未检测到本地模型"}
                </span>
                <button
                    className="toolbar-btn"
                    onClick={ollama.reload}
                    disabled={ollama.loading}
                >
                    刷新
                </button>
            </div>
            {ollama.error && <p className="ollama-error">{ollama.error}</p>}
            <p className="ollama-hint">{hint}</p>
        </div>
    );
}

function ApiSettingsSection({
    modelApiMode,
    provider,
    onProviderChange,
    apiKey,
    onApiKeyChange,
    apiUrl,
    onApiUrlChange,
    embeddingProvider,
    onEmbeddingProviderChange,
    embeddingApiKey,
    onEmbeddingApiKeyChange,
    embeddingApiUrl,
    onEmbeddingApiUrlChange,
}) {
    return (
        <>
            <h3>API 设置</h3>
            <p className="settings-subtitle">
                配置 API 连接参数（保存后同步到后端与 RAG 服务）
            </p>

            <div className="api-block">
                <p className="api-block-title">
                    {modelApiMode === "separate" ? "对话 API" : "对话与嵌入共用"}
                </p>
                <ProviderFields
                    provider={provider}
                    onProviderChange={onProviderChange}
                    apiKey={apiKey}
                    onApiKeyChange={onApiKeyChange}
                    apiUrl={apiUrl}
                    onApiUrlChange={onApiUrlChange}
                />
            </div>

            {modelApiMode === "separate" && (
                <div className="api-block">
                    <p className="api-block-title">嵌入 API</p>
                    <ProviderFields
                        provider={embeddingProvider}
                        onProviderChange={onEmbeddingProviderChange}
                        apiKey={embeddingApiKey}
                        onApiKeyChange={onEmbeddingApiKeyChange}
                        apiUrl={embeddingApiUrl}
                        onApiUrlChange={onEmbeddingApiUrlChange}
                    />
                </div>
            )}
        </>
    );
}

function ProviderFields({
    provider,
    onProviderChange,
    apiKey,
    onApiKeyChange,
    apiUrl,
    onApiUrlChange,
}) {
    const currentProvider = getProvider(provider);
    const regionOptions =
        currentProvider?.baseUrls && currentProvider.baseUrls.length > 1
            ? currentProvider.baseUrls
            : [];
    const regionIndex = regionOptions.findIndex((v) => v.url === apiUrl);
    const isOllama = provider === "ollama";

    return (
        <>
            <label>
                API Provider
                <select
                    value={provider}
                    onChange={(e) => onProviderChange(e.target.value)}
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
                    onChange={(e) => onApiKeyChange(e.target.value)}
                    placeholder={isOllama ? "本地 Ollama 不需要 API Key" : "sk-..."}
                    disabled={isOllama}
                    title={isOllama ? "本地 Ollama 不需要 API Key" : ""}
                />
                {isOllama && (
                    <span className="field-hint">
                        本地 Ollama 不需要 API Key，已自动禁用
                    </span>
                )}
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
                    本地接入：Base URL 使用 http://127.0.0.1:11434/v1，无需 API Key
                </p>
            )}
        </>
    );
}

function RagSettingsSection({
    topK,
    onTopKChange,
    chunkSize,
    onChunkSizeChange,
    chunkOverlap,
    onChunkOverlapChange,
    temperature,
    onTemperatureChange,
}) {
    return (
        <>
            <h3>RAG 参数</h3>
            <p className="settings-subtitle">调整检索增强生成参数</p>
            <label>
                Top K
                <input
                    type="number"
                    value={topK}
                    onChange={(e) => onTopKChange(Number(e.target.value))}
                />
            </label>
            <label>
                Chunk Size
                <input
                    type="number"
                    value={chunkSize}
                    onChange={(e) => onChunkSizeChange(Number(e.target.value))}
                />
            </label>
            <label>
                Chunk Overlap
                <input
                    type="number"
                    value={chunkOverlap}
                    onChange={(e) =>
                        onChunkOverlapChange(Number(e.target.value))
                    }
                />
            </label>
            <label>
                Temperature
                <input
                    type="number"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => onTemperatureChange(Number(e.target.value))}
                />
            </label>
        </>
    );
}
