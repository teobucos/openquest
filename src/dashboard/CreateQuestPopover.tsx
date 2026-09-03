import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from "react";
import { createQuest } from "../api";
import { readableError } from "../useRemoteData";

export interface CreateQuestPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
}

function positionCreatePopover(dialog: HTMLDialogElement) {
  const anchor = dialog.parentElement;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 24);
  const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);
  const top = Math.min(rect.bottom + 8, window.innerHeight - 12);
  dialog.style.width = `${width}px`;
  dialog.style.left = `${left}px`;
  dialog.style.top = `${top}px`;
}

export function CreateQuestPopover({
  open,
  onOpenChange,
  onCreated,
}: CreateQuestPopoverProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    positionCreatePopover(dialog);
    const title = dialog.querySelector("input[name=title]");
    if (title instanceof HTMLInputElement) title.focus();
    const reposition = () => positionCreatePopover(dialog);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const closeOnBackdrop = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      dialog.close();
      onOpenChangeRef.current(false);
    };
    dialog.addEventListener("click", closeOnBackdrop);
    return () => dialog.removeEventListener("click", closeOnBackdrop);
  }, []);

  const close = useCallback(() => {
    dialogRef.current?.close();
    onOpenChange(false);
  }, [onOpenChange]);

  const closeOnCancel = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    close();
  }, [close]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const fields = new FormData(event.currentTarget);
    try {
      const result = await createQuest({
        title: String(fields.get("title") ?? ""),
        goal: String(fields.get("goal") ?? ""),
        description: String(fields.get("description") ?? ""),
      });
      onOpenChange(false);
      onCreated(result.slug);
    } catch (cause: unknown) {
      setMessage(readableError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="create-popover"
      aria-labelledby="create-quest-heading"
      onCancel={closeOnCancel}
    >
      <div className="create-popover-heading">
        <h2 id="create-quest-heading">NEW QUEST</h2>
        <button className="icon-button" type="button" onClick={close} aria-label="Close new Quest">×</button>
      </div>
      <div className="create-popover-body">
        <p className="create-safety">Everything on OpenQuest is public. Do not submit confidential, proprietary, personal, credential, or secret information.</p>
        <form className="quest-form" onSubmit={submit}>
          <label>Title<input name="title" required minLength={3} maxLength={160} /></label>
          <label>Goal<textarea name="goal" required minLength={10} maxLength={2_000} /></label>
          <label>Description<textarea name="description" maxLength={6_000} /></label>
          <button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create Quest"}</button>
          {message ? <p className="form-error" role="alert">{message}</p> : null}
        </form>
      </div>
    </dialog>
  );
}
