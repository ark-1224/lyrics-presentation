import { useState } from "react";
import type { FormEvent } from "react";
import type { Presentation } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  presentations: Presentation[];
  selectedId: number | null;
  /** The presentation currently on the displays (gets a LIVE badge). */
  livePresentationId: number | null;
  onSelect: (id: number) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDuplicate: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

/** Left column: list of presentations with create / rename / duplicate / delete. */
export function Library({ presentations, selectedId, livePresentationId, onSelect, onCreate, onRename, onDuplicate, onDelete }: Props) {
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Presentation | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await onCreate(name);
    setNewName("");
  }

  async function commitRename() {
    const id = renamingId;
    const name = renameValue.trim();
    setRenamingId(null);
    const current = presentations.find((p) => p.id === id);
    if (id !== null && name && current && name !== current.name) await onRename(id, name);
  }

  return (
    <aside className="library" aria-label="Presentations">
      <h2>Presentations</h2>
      <form className="new-presentation" onSubmit={create}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New presentation name"
          aria-label="New presentation name"
          maxLength={200}
        />
        <button type="submit" className="primary" disabled={!newName.trim()}>
          Create
        </button>
      </form>

      {presentations.length === 0 && <p className="muted">No presentations yet. Create one above.</p>}

      <ul>
        {presentations.map((p) => (
          <li key={p.id} className={p.id === selectedId ? "selected" : ""}>
            {renamingId === p.id ? (
              <input
                className="rename"
                value={renameValue}
                autoFocus
                maxLength={200}
                aria-label={`Rename ${p.name}`}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenamingId(null);
                }}
              />
            ) : (
              <button type="button" className="select" onClick={() => onSelect(p.id)} aria-current={p.id === selectedId}>
                <span className="name">
                  {p.name}
                  {p.id === livePresentationId && <span className="live-badge">LIVE</span>}
                </span>
                <span className="count">{p.slideCount} slide{p.slideCount === 1 ? "" : "s"}</span>
              </button>
            )}
            <span className="row-actions">
              <button
                type="button"
                title="Rename"
                aria-label={`Rename ${p.name}`}
                onClick={() => {
                  setRenamingId(p.id);
                  setRenameValue(p.name);
                }}
              >
                Rename
              </button>
              <button type="button" title="Duplicate" aria-label={`Duplicate ${p.name}`} onClick={() => void onDuplicate(p.id)}>
                Copy
              </button>
              <button type="button" className="danger-text" title="Delete" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>

      {deleting && (
        <ConfirmDialog
          title="Delete presentation?"
          message={`"${deleting.name}" and its ${deleting.slideCount} slide${deleting.slideCount === 1 ? "" : "s"} will be permanently deleted. This can't be undone.`}
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const target = deleting;
            setDeleting(null);
            void onDelete(target.id);
          }}
        />
      )}
    </aside>
  );
}
