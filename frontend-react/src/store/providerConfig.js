/**
 * 服务商配置中心：Base URL、区域版本、可用的对话 / 嵌入模型。
 * 选择服务商后自动填充 Base URL；Ollama 支持拉取本地已下载模型。
 */

export const PROVIDERS = [
    {
        key: "deepseek",
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        chatModels: [
            "deepseek-chat",
            "deepseek-reasoner",
            "deepseek-v4-flash",
            "deepseek-v4-pro",
        ],
        embeddingModels: [],
    },
    {
        key: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        chatModels: [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4.1",
            "gpt-4.1-mini",
            "o3-mini",
            "gpt-5.6-sol",
            "gpt-5.6-luna",
        ],
        embeddingModels: [
            "text-embedding-3-small",
            "text-embedding-3-large",
            "text-embedding-ada-002",
        ],
    },
    {
        key: "qwen",
        label: "阿里云 Qwen（百炼）",
        baseUrls: [
            {
                label: "中国大陆版",
                url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            },
            {
                label: "国际版",
                url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            },
        ],
        chatModels: [
            "qwen-plus",
            "qwen-turbo",
            "qwen-max",
            "qwen-long",
            "qwen3.7-plus",
            "qwen2.5-72b-instruct",
        ],
        embeddingModels: [
            "text-embedding-v1",
            "text-embedding-v2",
            "text-embedding-v3",
            "text-embedding-v4",
        ],
    },
    {
        key: "moonshot",
        label: "Moonshot（Kimi）",
        baseUrl: "https://api.moonshot.cn/v1",
        chatModels: [
            "moonshot-v1-8k",
            "moonshot-v1-32k",
            "moonshot-v1-128k",
            "kimi-k2-0711-preview",
        ],
        embeddingModels: [],
    },
    {
        key: "zhipu",
        label: "智谱 GLM",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        chatModels: [
            "glm-4-plus",
            "glm-4-air",
            "glm-4-flash",
            "glm-4-long",
            "glm-4.5",
            "glm-4.6",
        ],
        embeddingModels: ["embedding-2", "embedding-3"],
    },
    {
        key: "baidu",
        label: "百度千帆",
        baseUrl: "https://qianfan.baidubce.com/v2",
        chatModels: [
            "ernie-4.0-turbo-8k",
            "ernie-3.5-8k",
            "ernie-speed-128k",
            "ernie-lite-8k",
        ],
        embeddingModels: ["embedding-v1"],
    },
    {
        key: "tencent",
        label: "腾讯混元",
        baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
        chatModels: ["hunyuan-turbo", "hunyuan-pro", "hunyuan-standard"],
        embeddingModels: [],
    },
    {
        key: "minimax",
        label: "MiniMax",
        baseUrl: "https://api.minimax.chat/v1",
        chatModels: ["MiniMax-Text-01", "abab6.5s-chat", "abab6.5g-chat"],
        embeddingModels: ["embo-01"],
    },
    {
        key: "siliconflow",
        label: "硅基流动 SiliconFlow",
        baseUrl: "https://api.siliconflow.cn/v1",
        chatModels: [
            "deepseek-ai/DeepSeek-V3",
            "Qwen/Qwen2.5-72B-Instruct",
            "Qwen/Qwen2.5-7B-Instruct",
            "meta-llama/Llama-3.3-70B-Instruct",
        ],
        embeddingModels: [
            "BAAI/bge-m3",
            "BAAI/bge-large-zh-v1.5",
            "netease-youdao/bce-embedding-base_v1",
        ],
    },
    {
        key: "groq",
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        chatModels: [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "mixtral-8x7b-32768",
            "gemma2-9b-it",
        ],
        embeddingModels: [],
    },
    {
        key: "xai",
        label: "xAI（Grok）",
        baseUrl: "https://api.x.ai/v1",
        chatModels: ["grok-2", "grok-2-mini", "grok-beta"],
        embeddingModels: [],
    },
    {
        key: "mistral",
        label: "Mistral",
        baseUrl: "https://api.mistral.ai/v1",
        chatModels: [
            "mistral-large-latest",
            "mistral-small-latest",
            "open-mistral-nemo",
            "codestral-latest",
        ],
        embeddingModels: ["mistral-embed"],
    },
    {
        key: "ollama",
        label: "Ollama（本地）",
        baseUrl: "http://127.0.0.1:11434/v1",
        local: true,
        chatModels: [],
        embeddingModels: [],
    },
];

/** 通用嵌入模型（多数 OpenAI 兼容服务可用） */
export const COMMON_EMBEDDING_MODELS = [
    "text-embedding-v4",
    "text-embedding-3-small",
    "BAAI/bge-small-zh-v1.5",
    "BAAI/bge-m3",
];

export function getProvider(key) {
    return PROVIDERS.find((p) => p.key === key);
}

/** 服务商默认 Base URL（多区域取第一个） */
export function getProviderDefaultUrl(key) {
    const p = getProvider(key);
    if (!p) return "";
    return p.baseUrls ? p.baseUrls[0].url : p.baseUrl || "";
}

/** 是否为常见嵌入模型名（Ollama 下拉用于提示） */
export function looksLikeEmbeddingModel(name = "") {
    return /embed|bge|nomic|mxbai|minilm|e5-|gte-/i.test(name);
}

/** 拉取 Ollama 本地已下载模型列表（GET /api/tags） */
export async function fetchOllamaModels(apiUrl = "") {
    const root = String(apiUrl || "http://127.0.0.1:11434/v1").replace(
        /\/v1\/?$/,
        ""
    );
    const res = await fetch(`${root}/api/tags`);
    if (!res.ok) {
        throw new Error(`Ollama 请求失败（${res.status}），请确认 Ollama 已启动`);
    }
    const data = await res.json();
    const list = Array.isArray(data?.models) ? data.models : [];
    return list
        .map((m) => m.name)
        .filter(Boolean)
        .sort();
}
