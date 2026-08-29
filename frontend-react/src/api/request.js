/**
 * ============================================================
 *  预设的后端 & RAG 接口层 (axios 封装)
 * ============================================================
 *  - Express 后端服务 : http://127.0.0.1:3000
 *  - Python RAG 服务  : http://127.0.0.1:8000
 *
 * 参照 antd Pro / Element Plus 的 request 封装模式：
 *  1. 统一 baseURL、超时、鉴权头（x-user-id / token）
 *  2. 统一错误处理：响应拦截器直接返回 data，错误包装成携带 status/data 的 Error
 *  3. 按业务域导出：systemApi / documentApi / qaApi / chatApi / ragApi
 *
 * 接口连通：
 *  - 前端设置（API / 模型 / RAG 参数）通过 configHeaders() 注入每个请求头，
 *    后端与 RAG 服务可直接读取（x-api-key、x-chat-model、x-rag-*）。
 *  - systemApi.updateConfig / ragApi.updateConfig 会把完整配置推送到后端与 RAG。
 * ============================================================
 */
import axios from "axios";
import { getUserConfig } from "../store/userConfig.js";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:3000";
const RAG_BASE_URL = import.meta.env?.VITE_RAG_BASE_URL || "http://127.0.0.1:8000";
const DEFAULT_USER_ID = Number(import.meta.env?.VITE_USER_ID || 1);

/** 获取当前用户 ID（后端暂未接入 JWT，先用 x-user-id 模拟） */
function getUserId() {
    const stored = Number(localStorage.getItem("paperhub_user_id"));
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_USER_ID;
}

/** 切换当前用户 ID */
function setUserId(id) {
    localStorage.setItem("paperhub_user_id", String(id));
    window.dispatchEvent(new Event("paperhub:user-changed"));
}

/** 从任意错误对象中提取可读的错误信息 */
function extractErrorMessage(error, fallback = "网络请求失败") {
    return (
        error?.response?.data?.detail ||
        error?.response?.data?.message ||
        error?.message ||
        fallback
    );
}

/** 包装错误：附带 status / data，便于前端分支处理（如 404 提示接口未接入） */
function wrapError(error, fallback) {
    const wrapped = new Error(extractErrorMessage(error, fallback));
    wrapped.status = error?.response?.status;
    wrapped.data = error?.response?.data;
    wrapped.isAxiosError = true;
    return wrapped;
}

/**
 * 把前端设置中的 API / 模型 / RAG 参数转成请求头，
 * 随每个请求提供给后端与 RAG 服务。
 */
function configHeaders() {
    const cfg = getUserConfig();
    const headers = {};
    if (cfg.provider) headers["x-provider"] = cfg.provider;
    if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
    if (cfg.apiUrl) headers["x-api-url"] = cfg.apiUrl;
    if (cfg.model) headers["x-chat-model"] = cfg.model;
    if (cfg.embeddingModel) headers["x-embedding-model"] = cfg.embeddingModel;
    if (cfg.topK != null) headers["x-rag-top-k"] = String(cfg.topK);
    if (cfg.chunkSize != null) headers["x-rag-chunk-size"] = String(cfg.chunkSize);
    if (cfg.chunkOverlap != null) headers["x-rag-chunk-overlap"] = String(cfg.chunkOverlap);
    if (cfg.temperature != null) headers["x-rag-temperature"] = String(cfg.temperature);
    return headers;
}

// ---------- Express 后端实例 ----------
const service = axios.create({
    baseURL: API_BASE_URL,
    timeout: 120000,
});

// ---------- Python RAG 服务实例 ----------
const ragService = axios.create({
    baseURL: RAG_BASE_URL,
    timeout: 120000,
});

// 请求拦截：动态注入用户 ID、Token 与前端设置的接口参数
service.interceptors.request.use((config) => {
    config.headers = config.headers || {};
    config.headers["x-user-id"] = getUserId();
    const token = localStorage.getItem("token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    Object.assign(config.headers, configHeaders());
    return config;
});

ragService.interceptors.request.use((config) => {
    config.headers = config.headers || {};
    config.headers["x-user-id"] = getUserId();
    Object.assign(config.headers, configHeaders());
    return config;
});

// 响应拦截：直接返回 data，错误统一包装
service.interceptors.response.use(
    (response) => response.data,
    (error) => Promise.reject(wrapError(error, "后端服务请求失败"))
);

ragService.interceptors.response.use(
    (response) => response.data,
    (error) => Promise.reject(wrapError(error, "RAG 服务请求失败"))
);

/* ---------- 用户 / 鉴权 ---------- */
export const userApi = {
    getUserId,
    setUserId,
};

/* ---------- 系统 / 健康检查 / 配置同步 ---------- */
export const systemApi = {
    /** GET /health  Express 后端健康检查 */
    health: () => service.get("/health"),
    /** GET /health  Python RAG 服务健康检查 */
    ragHealth: () => ragService.get("/health"),

    /** POST /api/config  把前端设置的 API/模型/RAG 参数同步给后端 */
    updateConfig: (config) => service.post("/api/config", config),
    /** GET /api/config  读取后端已保存的配置 */
    getConfig: () => service.get("/api/config"),

    /** 同时探测后端与 RAG 服务的连通性 */
    async testConnection() {
        const [backend, rag] = await Promise.allSettled([
            service.get("/health"),
            ragService.get("/health"),
        ]);
        return {
            backend: backend.status === "fulfilled",
            backendData: backend.status === "fulfilled" ? backend.value : null,
            backendError:
                backend.status === "rejected" ? backend.reason?.message : null,
            rag: rag.status === "fulfilled",
            ragData: rag.status === "fulfilled" ? rag.value : null,
            ragError: rag.status === "rejected" ? rag.reason?.message : null,
        };
    },
};

/* ---------- 文档管理 ---------- */
export const documentApi = {
    /**
     * POST /api/documents/upload
     * 上传文件（multipart/form-data），onUploadProgress 用于进度展示；
     * RAG 分块参数（chunk_size/chunk_overlap）通过 x-rag-* 请求头传递。
     */
    upload(file, onUploadProgress) {
        const formData = new FormData();
        formData.append("file", file);
        return service.post("/api/documents/upload", formData, {
            headers: { "Content-Type": "multipart/form-data" },
            onUploadProgress,
        });
    },

    /** GET /api/documents  文档列表（预设接口） */
    list: (params) => service.get("/api/documents", { params }),

    /** GET /api/documents/:id  文档详情（预设接口） */
    detail: (id) => service.get(`/api/documents/${id}`),

    /** DELETE /api/documents/:id  删除文档（预设接口） */
    remove: (id) => service.delete(`/api/documents/${id}`),

    /** POST /api/documents/:id/reindex  重新解析入库（预设接口） */
    reindex: (id) => service.post(`/api/documents/${id}/reindex`),
};

/* ---------- 问答 / 检索 ---------- */
export const qaApi = {
    /**
     * POST /api/qa/ask  RAG 问答（Express 转发到 Python RAG 服务）
     * @param {string} question
     * @param {{topK?:number, model?:string, temperature?:number}} params
     */
    ask(question, params = {}) {
        const p = typeof params === "number" ? { topK: params } : params;
        return service.post("/api/qa/ask", {
            question,
            top_k: p.topK ?? 3,
            model: p.model,
            temperature: p.temperature,
        });
    },

    /** GET /api/qa/search  语义检索（预设接口） */
    search: (params) => service.get("/api/qa/search", { params }),
};

/* ---------- 通用 AI 对话（预设接口） ---------- */
export const chatApi = {
    /**
     * POST /api/chat  通用 AI 对话（后端接入后即可用）
     * @param {string} message
     * @param {{model?:string, temperature?:number}} params
     */
    send(message, params = {}) {
        return service.post("/api/chat", {
            message,
            model: params.model,
            temperature: params.temperature,
        });
    },
};

/* ---------- RAG Python 服务直连接口（预设接口） ---------- */
export const ragApi = {
    /** POST /ingest  文档解析入库 */
    ingest: (payload) => ragService.post("/ingest", payload),
    /** POST /query   向量检索 + 问答 */
    query: (payload) => ragService.post("/query", payload),

    /** POST /config   把前端设置同步给 RAG 服务（运行时生效） */
    updateConfig: (config) => ragService.post("/config", config),
    /** GET /config    读取 RAG 服务当前配置 */
    getConfig: () => ragService.get("/config"),
};

export { extractErrorMessage };

export default service;
