let listener = null;

/**
 * 打开设置抽屉并定位到指定区块（api / model / rag）。
 * 供文件管理页等非 Header 组件在需要用户配置时调用。
 */
export function openSettings(section) {
    if (listener) listener(section || "model");
}

export function subscribeSettings(callback) {
    listener = callback;
    return () => {
        listener = null;
    };
}
