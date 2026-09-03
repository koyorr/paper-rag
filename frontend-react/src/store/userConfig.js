const KEY = "paperhub_user_config";

/** 默认配置：API / 模型 / RAG 参数 */
const DEFAULT_CONFIG = {
    name: "用户",
    // API 使用模式：shared（聊天与嵌入共用一个 API）| separate（分别设置 API）
    modelApiMode: "shared",
    // 对话侧（separate 模式下仍为主字段，保存时同步为 provider/api_key/api_url/chat_model）
    provider: "deepseek",
    apiKey: "",
    apiUrl: "",
    model: "deepseek-chat",
    // 嵌入侧（separate 模式下用 embedding* 覆盖共用配置）
    embeddingProvider: "qwen",
    embeddingApiKey: "",
    embeddingApiUrl: "",
    embeddingModel: "text-embedding-v4",
    // RAG 参数
    topK: 5,
    chunkSize: 800,
    chunkOverlap: 80,
    temperature: 0.3,
};

export function getUserConfig() {
    try {
        const data = JSON.parse(localStorage.getItem(KEY));
        return data ? { ...DEFAULT_CONFIG, ...data } : { ...DEFAULT_CONFIG };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

export function saveUserConfig(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
    window.dispatchEvent(new Event("user-config-change"));
}

/** 对话侧生效配置（shared / separate 统一入口） */
export function getChatConfig(cfg = getUserConfig()) {
    return {
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        apiUrl: cfg.apiUrl,
        model: cfg.model,
    };
}

/** 嵌入侧生效配置：separate 时用 embedding*，shared 时回退共用配置 */
export function getEmbeddingConfig(cfg = getUserConfig()) {
    if (cfg.modelApiMode === "separate") {
        return {
            provider: cfg.embeddingProvider || cfg.provider,
            apiKey: cfg.embeddingApiKey || cfg.apiKey,
            apiUrl: cfg.embeddingApiUrl || cfg.apiUrl,
            model: cfg.embeddingModel,
        };
    }
    return {
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        apiUrl: cfg.apiUrl,
        model: cfg.embeddingModel,
    };
}

/** 生成同步给后端 / RAG 服务的归一化配置 */
export function buildSyncConfig(cfg = getUserConfig()) {
    const chat = getChatConfig(cfg);
    const emb = getEmbeddingConfig(cfg);
    return {
        modelApiMode: cfg.modelApiMode,
        provider: chat.provider,
        apiKey: chat.apiKey,
        apiUrl: chat.apiUrl,
        model: chat.model,
        chatModel: chat.model,
        embeddingProvider: emb.provider,
        embeddingApiKey: emb.apiKey,
        embeddingApiUrl: emb.apiUrl,
        embeddingModel: emb.model,
        topK: cfg.topK,
        chunkSize: cfg.chunkSize,
        chunkOverlap: cfg.chunkOverlap,
        temperature: cfg.temperature,
    };
}
