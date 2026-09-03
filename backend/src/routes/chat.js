const express = require('express');
const { chat_Message, stream_Forward } = require('../services/ragService');
const router = express.Router();

/**
 * POST /api/chat  通用 AI 对话
 * 前端设置中的模型 / Base URL / API Key 随请求头下发，转发到 RAG 服务 /chat。
 */
router.post('/', async (req, res) => {
    try {
        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        const message = body.message;
        if (!message?.trim()) {
            return res.status(400).json({ message: '消息不能为空' });
        }

        const wantsStream = (req.headers.accept || '').includes('text/event-stream');
        if (wantsStream) {
            const payload = { message };
            if (Array.isArray(body.history)) payload.history = body.history;
            if (body.model || req.header('x-chat-model')) payload.model = body.model || req.header('x-chat-model');
            if (body.temperature != null) payload.temperature = Number(body.temperature);
            if (body.api_key || req.header('x-api-key')) payload.api_key = body.api_key || req.header('x-api-key');
            if (body.api_url || req.header('x-api-url')) payload.api_url = body.api_url || req.header('x-api-url');
            return stream_Forward('/chat', payload, req, res);
        }

        const result = await chat_Message({
            message,
            history: Array.isArray(body.history) ? body.history : undefined,
            model: body.model || req.header('x-chat-model') || undefined,
            temperature: body.temperature != null ? Number(body.temperature) : undefined,
            apiKey: body.api_key || req.header('x-api-key') || undefined,
            apiUrl: body.api_url || req.header('x-api-url') || undefined
        });
        res.json(result);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: '对话失败',
            error: error.response?.data ?? error.message
        });
    }
});

module.exports = router;
