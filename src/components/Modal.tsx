import { useContext, useEffect, useRef, type ReactNode } from "react";
import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import { OperationContext } from "../app/OperationContext";

export function Modal({
  title,
  children,
  close,
  busy = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const operation = useContext(OperationContext);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal modal-wide" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
      aria-labelledby="modal-title"
    >
      <header className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="关闭对话框"
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      {operation.error && (
        <div className="error-banner" role="alert">
          <TriangleAlert size={18} />
          <span>{operation.error}</span>
        </div>
      )}
      {operation.busy && (
        <div className="task-status" role="status">
          <LoaderCircle size={17} className="spin" />
          <span>{operation.busy}…</span>
          <button className="text-button" onClick={operation.cancel}>
            取消操作
          </button>
        </div>
      )}
      {children}
    </dialog>
  );
}
