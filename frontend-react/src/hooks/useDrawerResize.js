import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 右侧抽屉（设置 / 个人信息）拖拽调宽。
 * rAF 节流 + 直接操作 DOM：拖拽过程不触发 React 重渲染，宽度跟随鼠标顺滑；
 * 松开后再把最终宽度同步回 React 状态。
 */
export default function useDrawerResize(initialWidth = 480) {
    const drawerRef = useRef(null);
    const [drawerWidth, setDrawerWidth] = useState(initialWidth);
    const [isResizingClass, setIsResizingClass] = useState(false);
    const isResizing = useRef(false);
    const rafId = useRef(null);
    const pendingWidth = useRef(initialWidth);
    // 用于在 handleMouseUp 中移除自身监听，避免回调内自引用
    const mouseUpRef = useRef(null);

    const handleMouseMove = useCallback((e) => {
        if (!isResizing.current) return;
        // 右侧边缘固定，宽度 = 视口宽 - 鼠标 x
        const newWidth = window.innerWidth - e.clientX;
        // 限制宽度范围：最小320px，最大视口宽度的80%
        const clamped = Math.min(
            Math.max(newWidth, 320),
            window.innerWidth * 0.8
        );
        // 只记录最新宽度，由 rAF 统一写入 DOM，避免逐帧排队导致卡顿掉帧
        pendingWidth.current = clamped;
        if (rafId.current == null) {
            rafId.current = requestAnimationFrame(() => {
                rafId.current = null;
                if (drawerRef.current) {
                    drawerRef.current.style.width = `${pendingWidth.current}px`;
                }
            });
        }
    }, []);

    const handleMouseUp = useCallback(() => {
        if (!isResizing.current) return;
        isResizing.current = false;
        setIsResizingClass(false);
        if (rafId.current != null) {
            cancelAnimationFrame(rafId.current);
            rafId.current = null;
        }
        // 将最终宽度同步回 React 状态，保持组件内部一致
        if (drawerRef.current) {
            const finalWidth =
                parseInt(drawerRef.current.style.width, 10) ||
                pendingWidth.current;
            setDrawerWidth(finalWidth);
        }
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", mouseUpRef.current);
        document.body.style.userSelect = "";
    }, [handleMouseMove]);

    // 拖拽结束回调同步到 ref（useCallback 稳定，仅执行一次）
    useEffect(() => {
        mouseUpRef.current = handleMouseUp;
    }, [handleMouseUp]);

    const onResizeHandleMouseDown = useCallback(
        (e) => {
            e.preventDefault();
            e.stopPropagation(); // 防止触发点击外部关闭
            isResizing.current = true;
            setIsResizingClass(true);
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
            document.body.style.userSelect = "none";
        },
        [handleMouseMove, handleMouseUp]
    );

    // 组件卸载时清理
    useEffect(() => {
        return () => {
            isResizing.current = false;
            if (rafId.current != null) {
                cancelAnimationFrame(rafId.current);
                rafId.current = null;
            }
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            document.body.style.userSelect = "";
        };
    }, [handleMouseMove, handleMouseUp]);

    return { drawerRef, drawerWidth, isResizingClass, onResizeHandleMouseDown };
}
