const express = require('express');
const {ask_Question} = require('../services/ragService');
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
        const result = await ask_Question({
            question,
            userId,
            topK: Number(top_k) || 3,
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

module.exports = router;
