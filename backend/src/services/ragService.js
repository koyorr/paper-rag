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
    topK = 3,
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

module.exports = {
    ingest_Document,
    ask_Question,
    update_Config
};
