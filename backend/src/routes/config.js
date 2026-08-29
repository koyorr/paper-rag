const express = require('express');
const { update_Config } = require('../services/ragService');
const router = express.Router();

// 内存中的配置缓存（重启失效；如需持久化可写入数据库 / .env）
let configStore = {};

/**
 * POST /api/config
 * 接收前端设置中的 API / 模型 / RAG 参数：
 * 1. 暂存到后端内存
 * 2. 转发给 Python RAG 服务（POST /config），使其运行时生效
 */
router.post('/', async (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    configStore = { ...configStore, ...body };

    let ragSynced = false;
    let ragError = null;
    try {
        await update_Config(configStore);
        ragSynced = true;
    } catch (error) {
        ragError = error?.response?.data?.detail ?? error.message;
        console.warn('RAG 配置同步失败:', ragError);
    }

    res.json({
        status: 'ok',
        synced: true,
        rag: { synced: ragSynced, error: ragError },
        config: configStore
    });
});

/** GET /api/config 读取后端保存的配置 */
router.get('/', (req, res) => {
    res.json({ status: 'ok', config: configStore });
});

module.exports = router;
