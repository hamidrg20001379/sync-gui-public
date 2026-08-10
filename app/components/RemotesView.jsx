"use client";
import { useState } from "react";
import { Plus, X, Gear, CaretLeft, Eye, EyeSlash, TerminalWindow } from "@phosphor-icons/react";
import EditorModal from "./EditorModal";
import ConfirmModal from "./ConfirmModal";
import { toast } from "./Toast";

function blankRemote() {
  return {
    id: "",
    name: "",
    kind: "ssh",
    root: "",
    host: "",
    port: 22,
    username: "",
    password: "",
  };
}

export default function RemotesView({ config, onBack, onRefresh, activeTerminalRemote, onOpenTerminal }) {
  const { remotes = [] } = config;
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [checks, setChecks] = useState({});

  function openNew() {
    setEditing(blankRemote());
    setShowForm(true);
  }
  function openEdit(r) {
    setEditing({ ...r });
    setShowForm(true);
  }

  async function save() {
    if (!editing.name) return toast("Name is required.", "error");
    if (editing.kind === "ssh" && !editing.host)
      return toast("Host is required for SSH.", "error");
    if (editing.kind === "local" && !editing.root?.trim())
      return toast("Root path is required for local remotes.", "error");
    const idx = remotes.findIndex((r) => r.id === editing.id);
    const next = [...remotes];
    if (!editing.id)
      editing.id =
        editing.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
        "-" +
        Date.now().toString(36);
    if (editing.kind === "local") {
      editing.host = "";
      editing.port = 22;
      editing.username = "";
      editing.password = "";
    }
    if (idx >= 0) next[idx] = editing;
    else next.push(editing);
    const r = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          ...config,
          remotes: next,
        },
      }),
    });
    if (!r.ok) return toast("Failed to save.", "error");
    setShowForm(false);
    onRefresh();
    toast("Remote saved.");
  }

  function removeRemote(id) {
    setConfirmDelete(remotes.find((r) => r.id === id));
  }
  async function doRemove() {
    const used = config.projects.filter(
      (p) => p.remoteId === confirmDelete.id,
    ).length;
    if (used > 0)
      return toast(
        "Cannot delete: remote is used by " + used + " project(s).",
        "error",
      );
    const next = remotes.filter((r) => r.id !== confirmDelete.id);
    const r = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          ...config,
          remotes: next,
        },
      }),
    });
    if (!r.ok) return toast("Failed to delete.", "error");
    setConfirmDelete(null);
    onRefresh();
    toast("Remote deleted.");
  }

  async function checkConnection(remote) {
    setChecks((old) => ({
      ...old,
      [remote.id]: { status: "checking", message: "Checking..." },
    }));
    try {
      const response = await fetch("/api/remotes/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remoteId: remote.id }),
      });
      const data = await response.json();
      const status = response.ok && data.ok ? "ok" : "failed";
      const message =
        data.message ||
        data.error ||
        (status === "ok" ? "Connection works." : "Connection failed.");
      setChecks((old) => ({ ...old, [remote.id]: { status, message } }));
      toast(message, status === "ok" ? "info" : "error");
    } catch (error) {
      setChecks((old) => ({
        ...old,
        [remote.id]: { status: "failed", message: error.message },
      }));
      toast(error.message, "error");
    }
  }

  return (
    <div className="stage">
      <div className="stage-title">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="back-btn" onClick={onBack}>
            <CaretLeft size={14} weight="bold" /> Back
          </button>
          <h2>Remotes</h2>
        </div>
        <div className="stage-actions">
          <button className="primary" onClick={openNew}>
            <Plus size={14} weight="bold" /> Add
          </button>
        </div>
      </div>

      {remotes.length === 0 ? (
        <p className="empty-state">No remotes defined.</p>
      ) : (
        <div className="remote-list">
          {remotes.map((r) => (
            <div key={r.id} className={`remote-row ${activeTerminalRemote?.id === r.id ? "active" : ""}`}>
              <div className="remote-info">
                <strong>{r.name}</strong>
                <span className={`badge badge-${r.kind}`}>{r.kind}</span>
                {r.kind === "ssh" && (
                  <span className="remote-detail">
                    {r.username}@{r.host}:{r.port}
                  </span>
                )}
                {r.kind !== "ssh" && r.root && (
                  <span className="remote-detail">{r.root}</span>
                )}
                <span className="remote-used-by">
                  {config.projects.filter((p) => p.remoteId === r.id).length} project(s)
                </span>
                {checks[r.id] && (
                  <span className={`remote-check ${checks[r.id].status}`}>
                    {checks[r.id].message}
                  </span>
                )}
              </div>
              <div className="remote-actions">
                <button
                  className="remote-terminal-btn"
                  onClick={() => onOpenTerminal?.(r)}
                >
                  <TerminalWindow size={14} />
                  Terminal
                </button>
                <button
                  className="remote-check-btn"
                  onClick={() => checkConnection(r)}
                  disabled={checks[r.id]?.status === "checking"}
                >
                  {checks[r.id]?.status === "checking"
                    ? "Checking..."
                    : "Check connection"}
                </button>
                <button
                  className="card-btn card-btn-edit"
                  onClick={() => openEdit(r)}
                  aria-label="Edit remote"
                >
                  <Gear size={13} />
                </button>
                <button
                  className="card-btn card-btn-del"
                  onClick={() => removeRemote(r.id)}
                  aria-label="Delete remote"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <EditorModal
          title={editing.id ? "Edit Remote" : "New Remote"}
          onClose={() => setShowForm(false)}
          onSave={save}
        >
          <div className="form">
            <label>
              Name
              <input
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                placeholder="Production Server"
              />
            </label>
            <label>
              Kind
              <select
                value={editing.kind}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    kind: e.target.value,
                    host: "",
                    port: 22,
                    username: "",
                    password: "",
                  })
                }
              >
                <option value="ssh">SSH</option>
                <option value="local">Local</option>
              </select>
            </label>
            {editing.kind === "ssh" && (
              <>
                <label>
                  Host
                  <input
                    value={editing.host}
                    onChange={(e) =>
                      setEditing({ ...editing, host: e.target.value })
                    }
                    placeholder="192.168.1.100"
                  />
                </label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 14,
                  }}
                >
                  <label>
                    Port
                    <input
                      type="number"
                      value={editing.port}
                      onChange={(e) =>
                        setEditing({ ...editing, port: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Username
                    <input
                      value={editing.username}
                      onChange={(e) =>
                        setEditing({ ...editing, username: e.target.value })
                      }
                      placeholder="deploy"
                    />
                  </label>
                </div>
                <label>
                  Password
                  <div className="password-wrap">
                    <input
                      type={editing.showPass ? "text" : "password"}
                      value={editing.password || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, password: e.target.value })
                      }
                      placeholder="Optional"
                    />
                    <button
                      className="eye-btn"
                      type="button"
                      onClick={() =>
                        setEditing((prev) => ({
                          ...prev,
                          showPass: !prev.showPass,
                        }))
                      }
                    >
                      {editing.showPass ? <EyeSlash size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
              </>
            )}
            {editing.kind === "local" && (
              <label>
                Root path
                <input
                  value={editing.root || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, root: e.target.value })
                  }
                  placeholder="C:\Users\name\folder or /home/name/folder"
                />
              </label>
            )}
          </div>
        </EditorModal>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Remote"
          message={`Delete "${confirmDelete.name}"?`}
          confirmLabel="Delete"
          onConfirm={doRemove}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

    </div>
  );
}
