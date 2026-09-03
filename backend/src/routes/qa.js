const express = require('express');
const {ask_Question, search_Documents, stream_Forward} = require('../services/ragService');
const router = express.Router();

router.post('/ask', async (req, res) => {
    try {
        const userId = Number(req.header('x-user-id'));
        if (!userId) {
            return res.status(401).json({
                message: '缺少 x-user-id'
            });
        }

        const {question, top_k, model, temperature} = req.body;
        if (!question?.trim()) {
            return res.status(400).json({
                message: '问题不能为空'
            });
        }

        // 前端设置中的模型 / RAG 参数随请求下发
        const wantsStream = (req.headers.accept || '').includes('text/event-stream');
        if (wantsStream) {
            const payload = {
                question,
                user_id: userId,
                top_k: Number(top_k) || 5
            };
            if (model) payload.model = model;
            if (temperature != null) payload.temperature = Number(temperature);
            if (req.header('x-api-key')) payload.api_key = req.header('x-api-key');
            return stream_Forward('/query', payload, req, res);
        }

        const result = await ask_Question({
            question,
            userId,
            topK: Number(top_k) || 5,
            model: model || undefined,
            temperature: temperature != null ? Number(temperature) : undefined,
            apiKey: req.header('x-api-key') || undefined
        });
        res.json(result);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: '问答失败',
            error: error.response?.data ?? error.message
        });
    }
});


/** GET /api/qa/search  纯语义检索（转发到 RAG 服务 /search，不调用大模型） */
router.get('/search', async (req, res) => {
    try {
        const userId = Number(req.header('x-user-id'));
        if (!userId) {
            return res.status(401).json({ message: '缺少 x-user-id' });
        }

        const query = req.query.query || req.query.q;
        if (!query?.trim()) {
            return res.status(400).json({ message: '检索词不能为空' });
        }

        const result = await search_Documents({
            query,
            userId,
            topK: Number(req.query.top_k) || Number(req.query.topK) || 5
        });
        res.json(result);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: '检索失败',
            error: error.response?.data ?? error.message
        });
    }
});

module.exports = router;
