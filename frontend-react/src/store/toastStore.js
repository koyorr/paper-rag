let listener = null;

export function showToast(message) {
    if (listener) {
        listener(message);
    }
}

export function subscribeToast(callback) {
    listener = callback;

    return () => {
        listener = null;
    };
}