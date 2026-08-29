export default function Toast({ message }) {
    if (!message) return null;

    return <div className="global-toast">{message}</div>;
}