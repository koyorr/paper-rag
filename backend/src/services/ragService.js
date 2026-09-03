const axios = require('axios');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';

/**
 * 解析分块参数：来自前端请求头 x-rag-chunk-size / x-rag-chunk-overlap
 */
function parseChunk(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : fallback;
}

async function ingest_Document({
    documentId,
    storedName,
    originalName,
    userId,
    chunkSize,
    chunkOverlap
}) {
    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/ingest`,
        {
            document_id: documentId,
            stored_name: storedName,
            original_name: originalName,
            user_id: userId,
            chunk_size: parseChunk(chunkSize, 800),
            chunk_overlap: parseChunk(chunkOverlap, 80)
        },
        {
            timeout: 120000
        }
    );
    return response.data;
}

async function ask_Question({
    question,
    userId,
    topK = 5,
    model,
    temperature,
    apiKey
}) {
    const payload = {
        question,
        user_id: userId,
        top_k: topK
    };
    // 前端设置中的模型 / 采样参数随请求下发给 RAG 服务
    if (model) payload.model = model;
    if (temperature != null) payload.temperature = Number(temperature);
    if (apiKey) payload.api_key = apiKey;

    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/query`,
        payload,
        {
            timeout: 120000
        }
    );
    return response.data;
}

/** 把前端配置转发给 RAG 服务（POST /config），使其运行时生效 */
async function update_Config(config = {}) {
    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/config`,
        config,
        { timeout: 15000 }
    );
    return response.data;
}


/** 通用 AI 对话（转发到 RAG 服务 /chat，不检索知识库） */
async function chat_Message({
    message,
    history,
    model,
    temperature,
    apiKey,
    apiUrl
}) {
    const payload = { message };
    if (Array.isArray(history) && history.length) payload.history = history;
    if (model) payload.model = model;
    if (temperature != null) payload.temperature = Number(temperature);
    if (apiKey) payload.api_key = apiKey;
    if (apiUrl) payload.api_url = apiUrl;

    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/chat`,
        payload,
        { timeout: 120000 }
    );
    return response.data;
}

/** 纯语义检索（转发到 RAG 服务 /search，只检索向量库） */
async function search_Documents({ query, userId, topK = 5 }) {
    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/search`,
        {
            query,
            user_id: userId,
            top_k: topK
        },
        { timeout: 120000 }
    );
    return response.data;
}

/**
 * 把 RAG 服务的 SSE 流（/query、/chat）原样转发给前端。
 * 前端断开时中止上游请求。
 */
async function stream_Forward(path, payload, req, res) {
    const controller = new AbortController();
    // 客户端断开（响应未正常结束）时才中止上游；正常结束不中止
    res.on('close', () => {
        if (!res.writableEnded) controller.abort();
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
        const upstream = await fetch(`${PYTHON_SERVICE_URL}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text().catch(() => '');
            const message = detail || `上游服务返回 ${upstream.status}`;
            res.write(`data: ${JSON.stringify({ type: 'error', detail: message })}\n\n`);
            return res.end();
        }

        const reader = upstream.body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
        } finally {
            reader.releaseLock();
        }
        res.end();
    } catch (error) {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', detail: error.message })}\n\n`);
            res.end();
        }
    }
}

/** 删除指定文档的向量（转发到 RAG 服务 /delete） */
async function delete_Documents({ documentId, userId }) {
    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/delete`,
        {
            user_id: userId,
            document_id: documentId
        },
        { timeout: 60000 }
    );
    return response.data;
}

module.exports = {
    ingest_Document,
    ask_Question,
    update_Config,
    chat_Message,
    search_Documents,
    stream_Forward,
    delete_Documents
};
