const KEY = "paperhub_user_config";

/** 默认配置：API / 模型 / RAG 参数 */
const DEFAULT_CONFIG = {
    name: "用户",
    provider: "deepseek",
    apiKey: "",
    apiUrl: "",
    model: "deepseek-chat",
    embeddingModel: "text-embedding-v4",
    topK: 3,
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
