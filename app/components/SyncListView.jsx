"use client";
import { useState, useEffect, useRef } from "react";
import { Plus, CaretUp, CaretDown, CaretRight, Gear, X, Lightning, ClockCounterClockwise, Copy, GitBranch } from "@phosphor-icons/react";
import EditorModal from "./EditorModal";
import ConfirmModal from "./ConfirmModal";
import TargetPicker from "./TargetPicker";
import { toast } from "./Toast";
import { buildItemTargetMap, pickDueLiveItem } from "../../lib/live-sync";
import {
  categoryBreadcrumbs,
  duplicateCategoryTree,
  removeCategory,
} from "../../lib/categories";

const PAGE_SIZE = 30;
const LS_KEY = "sync-gui-settings";

function blankItem() {
  return {
    id: "",
    name: "",
    source: "",
    type: "folder",
    projectId: "",
    categoryId: "",
    targets: [{ name: "", remoteIds: [], dest: "", variables: {} }],
  };
}

function resolveProject(id, projects) {
  return projects.find((p) => p.id === id);
}
function parseVariablesInput(value) {
  const variables = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const nextValue = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    variables[key] = nextValue;
  }
  return variables;
}

function formatVariablesInput(variables) {
  return Object.entries(variables || {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function describeJob(job, items) {
  const names = (job.itemIds || [])
    .map((id) => items.find((item) => item.id === id)?.name)
    .filter(Boolean);
  if (!names.length) return `${job.itemIds?.length || 0} item(s)`;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} + ${names[1]}`;
  return `${names[0]} + ${names.length - 1} more`;
}

function isCategoryDescendant(categories, categoryId, possibleDescendantId) {
  let current = categories.find((category) => category.id === possibleDescendantId);
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    if (current.parentId === categoryId) return true;
    seen.add(current.id);
    current = categories.find((category) => category.id === current.parentId);
  }
  return false;
}

function cloneName(name, existingNames) {
  const base = `${name} copy`;
  if (!existingNames.includes(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existingNames.includes(candidate)) return candidate;
  }
}

function categoryItemIds(categories, items, categoryId) {
  const descendants = new Set([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (descendants.has(category.id) || !descendants.has(category.parentId || "")) continue;
      descendants.add(category.id);
      changed = true;
    }
  }
  return items
    .filter((item) => descendants.has(item.categoryId || ""))
    .map((item) => item.id);
}

export default function SyncListView({ config, onRefresh }) {
  const { items = [], projects = [], remotes = [], categories = [] } = config;
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [currentCategoryId, setCurrentCategoryId] = useState("");
  const [page, setPage] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [categoryDraft, setCategoryDraft] = useState(null);
  const [confirmCategoryDelete, setConfirmCategoryDelete] = useState(null);
  const [dragOverCategoryId, setDragOverCategoryId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("ready");
  const [history, setHistory] = useState([]);
  const [historyMinimized, setHistoryMinimized] = useState(false);
  const [syncingIds, setSyncingIds] = useState([]);
  const [syncTargetPicker, setSyncTargetPicker] = useState(null);
  const [targetDraft, setTargetDraft] = useState(null);
  const [liveItemIds, setLiveItemIds] = useState([]);
  const [hookStates, setHookStates] = useState({});
  const [hookPendingId, setHookPendingId] = useState(null);

  const pollRef = useRef(null);
  const mountedRef = useRef(true);
  const settingsLoadedRef = useRef(false);
  const liveLastRunRef = useRef({});
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  });
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  const [dryRun, setDryRun] = useState(false);
  const [noDelete, setNoDelete] = useState(false);

  useEffect(() => {
    try {
      const settings = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      setHistoryMinimized(!!settings.historyMinimized);
      setLiveItemIds(Array.isArray(settings.liveItemIds) ? settings.liveItemIds : []);
      setDryRun(!!settings.dryRun);
      setNoDelete(!!settings.noDelete);
    } catch { }
    settingsLoadedRef.current = true;
  }, []);
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ dryRun, noDelete, liveItemIds, historyMinimized }),
    );
  }, [dryRun, noDelete, liveItemIds, historyMinimized]);
  useEffect(() => {
    loadHistory();
    const id = setInterval(loadHistory, 5000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);
  useEffect(() => {
    if (!liveItemIds.length) return;
    const id = setInterval(() => {
      if (
        !mountedRef.current ||
        pollRef.current ||
        statusRef.current === "running"
      )
        return;
      const nextItem = pickDueLiveItem(
        itemsRef.current,
        liveItemIds,
        liveLastRunRef.current,
      );
      if (!nextItem) return;
      doSync([nextItem.id], "up", buildItemTargetMap(nextItem, "up"), {
        liveItemId: nextItem.id,
      });
    }, 1000);
    return () => clearInterval(id);
  }, [liveItemIds, dryRun, noDelete]);

  async function loadHistory() {
    const r = await fetch("/api/history");
    if (r.ok) setHistory((await r.json()).history || []);
  }

  async function clearHistory() {
    try {
      const r = await fetch("/api/history", { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not clear history.");
      setHistory(data.history || []);
      setConfirmClearHistory(false);
      toast("History cleared.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  useEffect(() => {
    if (!currentCategoryId) return;
    if (categories.some((category) => category.id === currentCategoryId)) return;
    setCurrentCategoryId("");
  }, [categories, currentCategoryId]);

  useEffect(() => {
    let cancelled = false;
    async function loadHookStates() {
      if (!items.length) return setHookStates({});
      const params = new URLSearchParams();
      items.forEach((item) => params.append("itemId", item.id));
      const response = await fetch(`/api/hooks?${params}`);
      if (cancelled || !response.ok) return;
      const data = await response.json();
      setHookStates(Object.fromEntries((data.hooks || []).map((hook) => [hook.itemId, hook])));
    }
    loadHookStates().catch(() => {});
    return () => { cancelled = true; };
  }, [items]);

  async function togglePostCommitHook(item) {
    setHookPendingId(item.id);
    try {
      const action = hookStates[item.id]?.installed ? "remove" : "install";
      const response = await fetch("/api/hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update the Git hook.");
      setHookStates((current) => ({ ...current, [item.id]: data.hook }));
      toast(action === "install" ? "Post-commit sync enabled." : "Post-commit sync removed.");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setHookPendingId(null);
    }
  }

  async function saveConfig(nextItems, nextCategories = categories, nextSettings = config.settings) {
    const r = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { remotes, projects, categories: nextCategories, items: nextItems, settings: nextSettings },
      }),
    });
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.error);
    }
    onRefresh();
  }

  function openNew(categoryId = currentCategoryId) {
    const category = categories.find((candidate) => candidate.id === categoryId);
    setEditing({
      ...blankItem(),
      projectId: category ? category.projectId : projectFilter,
      categoryId,
      localSyncIgnoreText: "",
      targets: [
        {
          name: "",
          remoteIds: [],
          dest: "",
          variables: {},
          variablesText: "",
          remoteSyncIgnoreText: "",
        },
      ],
    });
    setShowForm(true);
  }

  function openEdit(item) {
    setEditing({
      ...item,
      localSyncIgnoreText: item.localSyncIgnore || "",
      targets: (item.targets || []).map((t) => ({
        ...t,
        remoteIds: t.remoteIds?.length
          ? t.remoteIds
          : [t.remoteId].filter(Boolean),
        variables: t.variables || {},
        variablesText: formatVariablesInput(t.variables || {}),
        remoteSyncIgnoreText: t.remoteSyncIgnore || "",
      })),
    });
    setShowForm(true);
  }

  function setRestrictToChangedFiles(enabled) {
    saveConfig(items, categories, {
      ...config.settings,
      restrictToChangedFiles: enabled,
    }).catch((error) => toast(error.message, "error"));
  }

  function openCategoryEditor(category = null) {
    setCategoryDraft(
      category
        ? { ...category }
        : {
            id: "",
            name: "",
            projectId: projectFilter,
            parentId: currentCategoryId,
          },
    );
  }

  function saveCategoryDraft() {
    const name = categoryDraft.name.trim();
    if (!name) {
      toast("Category name is required.", "error");
      return;
    }
    if (
      categoryDraft.id &&
      isCategoryDescendant(categories, categoryDraft.id, categoryDraft.parentId)
    ) {
      toast("A category cannot be moved inside itself.", "error");
      return;
    }
    const id =
      categoryDraft.id ||
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
        "-" +
        Date.now().toString(36);
    const saved = { ...categoryDraft, id, name };
    const nextCategories = [...categories];
    const idx = nextCategories.findIndex((category) => category.id === id);
    if (idx >= 0) nextCategories[idx] = saved;
    else nextCategories.push(saved);
    saveConfig(items, nextCategories)
      .then(() => {
        setCategoryDraft(null);
        toast("Category saved.");
      })
      .catch((e) => toast(e.message, "error"));
  }

  function openCategory(category) {
    setProjectFilter(category.projectId || "");
    setCurrentCategoryId(category.id);
    setPage(0);
  }

  function doRemoveCategory() {
    const next = removeCategory(categories, items, confirmCategoryDelete.id);
    saveConfig(next.items, next.categories)
      .then(() => {
        setConfirmCategoryDelete(null);
        toast("Category deleted.");
      })
      .catch((e) => toast(e.message, "error"));
  }

  function cloneCategory(category) {
    const copy = duplicateCategoryTree(categories, items, category.id);
    saveConfig(copy.items, copy.categories)
      .then(() => toast(`Cloned "${category.name}" and its contents.`))
      .catch((e) => toast(e.message, "error"));
  }

  function syncCategory(category, direction) {
    const ids = new Set(categoryItemIds(categories, items, category.id));
    const categoryItems = items.filter((item) => ids.has(item.id));
    if (!categoryItems.length) {
      toast("This category has no sync items.", "error");
      return;
    }
    const targetMap = Object.fromEntries(
      categoryItems
        .filter((item) => item.targets?.length)
        .map((item) => [
          item.id,
          direction === "up" ? item.targets.map((_, index) => index) : [0],
        ]),
    );
    if (!Object.keys(targetMap).length) {
      toast("No sync items in this category have targets.", "error");
      return;
    }
    doSync(Object.keys(targetMap), direction, targetMap);
  }

  function cloneItem(item) {
    const siblingNames = items
      .filter((candidate) =>
        candidate.projectId === item.projectId &&
        (candidate.categoryId || "") === (item.categoryId || ""),
      )
      .map((candidate) => candidate.name);
    const copy = {
      ...item,
      id: `${item.id || "item"}-copy-${Date.now().toString(36)}`,
      name: cloneName(item.name, siblingNames),
      targets: (item.targets || []).map((target) => ({ ...target })),
    };
    saveConfig([...items, copy])
      .then(() => toast(`Cloned "${item.name}".`))
      .catch((e) => toast(e.message, "error"));
  }

  function moveItemToCategory(itemId, categoryId) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item || (item.categoryId || "") === categoryId) return;
    const category = categories.find((candidate) => candidate.id === categoryId);
    if (categoryId && !category) return;
    const projectId = categoryId ? category.projectId : projectFilter;
    const nextItems = items.map((candidate) =>
      candidate.id === itemId
        ? { ...candidate, projectId, categoryId }
        : candidate,
    );
    saveConfig(nextItems)
      .then(() => toast(categoryId ? `Moved to "${category.name}".` : "Moved to root."))
      .catch((e) => toast(e.message, "error"));
  }

  function dragItem(e, item) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
  }

  function allowItemDrop(e, categoryId) {
    if (!e.dataTransfer.types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCategoryId(categoryId);
  }

  function dropItem(e, categoryId) {
    e.preventDefault();
    const itemId = e.dataTransfer.getData("text/plain");
    setDragOverCategoryId(null);
    moveItemToCategory(itemId, categoryId);
  }

  function openTargetEditor(index = null) {
    const target =
      index === null
        ? {
            name: "",
            remoteIds: [],
            dest: "",
            variables: {},
            variablesText: "",
            remoteSyncIgnoreText: "",
          }
        : editing.targets[index];
    setTargetDraft({ index, target: { ...target } });
  }

  function updateTargetDraft(patch) {
    setTargetDraft((current) => ({
      ...current,
      target: { ...current.target, ...patch },
    }));
  }

  function toggleDraftRemote(remoteId, checked) {
    const current = new Set(
      targetDraft.target.remoteIds?.length
        ? targetDraft.target.remoteIds
        : [targetDraft.target.remoteId].filter(Boolean),
    );
    if (checked) current.add(remoteId);
    else current.delete(remoteId);
    updateTargetDraft({ remoteIds: [...current], remoteId: undefined });
  }

  function saveTargetDraft() {
    const target = targetDraft.target;
    if (!target.dest) {
      toast("Destination path is required.", "error");
      return;
    }
    if (!(target.remoteIds?.length || target.remoteId)) {
      toast("At least one remote is required.", "error");
      return;
    }
    const targets = [...(editing.targets || [])];
    if (targetDraft.index === null) targets.push(target);
    else targets[targetDraft.index] = target;
    setEditing({ ...editing, targets });
    setTargetDraft(null);
  }

  function removeTarget(index) {
    setEditing({
      ...editing,
      targets: editing.targets.filter((_, targetIndex) => targetIndex !== index),
    });
  }

  function save() {
    if (!editing.name) {
      toast("Name is required.", "error");
      return;
    }
    if (!editing.source) {
      toast("Source path is required.", "error");
      return;
    }
    const validTargets = (editing.targets || [])
      .filter((t) => t.dest && (t.remoteIds?.length || t.remoteId))
      .map((t) => ({
        name: t.name || "",
        dest: t.dest,
        remoteIds: t.remoteIds?.length
          ? t.remoteIds
          : [t.remoteId].filter(Boolean),
        variables: parseVariablesInput(t.variablesText || ""),
        remoteSyncIgnore: t.remoteSyncIgnoreText || "",
      }));
    if (!validTargets.length) {
      toast(
        "At least one target with a destination path and remote is required.",
        "error",
      );
      return;
    }
    const idx = items.findIndex((i) => i.id === editing.id);
    const next = [...items];
    const itemId =
      editing.id ||
      editing.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
        "-" +
        Date.now().toString(36);
    const { localSyncIgnoreText, ...itemDraft } = editing;
    const saved = {
      ...itemDraft,
      id: itemId,
      localSyncIgnore: localSyncIgnoreText || "",
      targets: validTargets,
    };
    if (idx >= 0) next[idx] = saved;
    else next.push(saved);
    saveConfig(next)
      .then(() => {
        setShowForm(false);
        toast("Item saved.");
      })
      .catch((e) => toast(e.message, "error"));
  }

  function removeItem(id) {
    setConfirmDelete(items.find((i) => i.id === id));
  }
  async function doRemove() {
    try {
      await saveConfig(items.filter((i) => i.id !== confirmDelete.id));
      setConfirmDelete(null);
      toast("Item deleted.");
    } catch (e) {
      toast(e.message, "error");
    }
  }

  function doSync(itemIds, direction, targetMap = {}, options = {}) {
    const { liveItemId = null } = options;
    setStatus("running");
    setSyncingIds(itemIds);
    if (liveItemId) liveLastRunRef.current[liveItemId] = Date.now();
    const label = direction === "up" ? "up" : "down";
    setOutput(
      `> syncing ${itemIds.length} item(s) ${label}${liveItemId ? " [live]" : ""}\n`,
    );
    fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun,
        noDelete,
        direction,
        itemTargets: targetMap,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setOutput((o) => o + (data.error || "Failed") + "\n");
          setStatus("failed");
          setSyncingIds([]);
          return;
        }
        setOutput((o) => o + `Job #${data.id} started.\n`);
        pollJob(data.id);
      });
  }

  function handleSingleSync(item, direction, targetIndices) {
    setSyncTargetPicker(null);
    doSync([item.id], direction, { [item.id]: targetIndices });
  }

  function handleSyncAll(direction) {
    const targets = {};
    for (const item of items) {
      if (!item.targets?.length) continue;
      targets[item.id] =
        direction === "up" ? item.targets.map((_, i) => i) : [0];
    }
    const ids = Object.keys(targets);
    if (!ids.length) {
      toast("No items with targets to sync.", "error");
      return;
    }
    doSync(ids, direction, targets);
  }

  function toggleLiveSync(itemId) {
    setLiveItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  }

  function pollJob(id) {
    pollRef.current = setInterval(async () => {
      if (!mountedRef.current) {
        clearInterval(pollRef.current);
        return;
      }
      const r = await fetch(`/api/run?id=${id}`);
      if (!r.ok) return;
      const job = await r.json();
      if (job.status !== "running") {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setOutput(job.output || "");
        setStatus(job.status === "succeeded" ? "done" : "failed");
        setSyncingIds([]);
        loadHistory();
        if (job.status === "succeeded") toast("Sync completed.");
        else toast("Sync failed.", "error");
      }
    }, 1000);
  }

  const q = search.toLowerCase();
  const searching = Boolean(q);
  const breadcrumbs = categoryBreadcrumbs(categories, currentCategoryId);
  const visibleCategories = searching
    ? []
    : categories.filter(
        (category) =>
          (!projectFilter || category.projectId === projectFilter) &&
          (category.parentId || "") === currentCategoryId,
      );
  const filtered = items.filter((i) => {
    if (
      q &&
      !i.name.toLowerCase().includes(q) &&
      !i.source.toLowerCase().includes(q)
    )
      return false;
    if (projectFilter && i.projectId !== projectFilter) return false;
    if (!searching && (i.categoryId || "") !== currentCategoryId) return false;
    return true;
  });
  const visibleEntries = [...visibleCategories, ...filtered];
  const totalPages = Math.ceil(visibleEntries.length / PAGE_SIZE) || 1;
  const pagedEntries = visibleEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const categoryOptions = categories.filter(
    (category) => category.projectId === editing?.projectId,
  );

  return (
    <div className="stage">
      <div className="stage-title">
        <h2>Sync Items</h2>
        <div className="stage-actions">
          <label className="search-box">
            <input
              placeholder="Search..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {projects.length > 0 && (
            <select
              className="filter-select"
              aria-label="Filter projects"
              value={projectFilter}
              onChange={(e) => {
                setProjectFilter(e.target.value);
                setCurrentCategoryId("");
                setPage(0);
              }}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <div className="toggles">
            <label>
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              Dry-run
            </label>
            <label>
              <input
                type="checkbox"
                checked={noDelete}
                onChange={(e) => setNoDelete(e.target.checked)}
              />
              No-delete
            </label>
            <label title="Copy only newer source files; preserve newer and target-only files">
              <input
                type="checkbox"
                checked={Boolean(config.settings?.restrictToChangedFiles)}
                onChange={(e) => setRestrictToChangedFiles(e.target.checked)}
              />
              Changed files only
            </label>
          </div>
          <span className={`status ${status}`}>
            <span className="status-dot" />
            {status === "running" ? `${syncingIds.length} running` : status}
          </span>
          {items.length > 0 && (
            <>
              <button className="primary" onClick={() => handleSyncAll("up")}>
                <CaretUp size={14} weight="bold" /> Sync All Up
              </button>
              <button className="primary" onClick={() => handleSyncAll("down")}>
                <CaretDown size={14} weight="bold" /> Sync All Down
              </button>
            </>
          )}
          {!searching && (
            <button onClick={() => openCategoryEditor()}>
              <Plus size={14} weight="bold" /> Category
            </button>
          )}
          <button className="primary" onClick={() => openNew()}>
            <Plus size={14} weight="bold" /> Add
          </button>
        </div>
      </div>

      {status === "running" && (
        <div className="progress-bar">
          <div className="progress-fill" />
        </div>
      )}

      {!searching && (currentCategoryId || breadcrumbs.length > 0) && (
        <div className="category-breadcrumbs">
          <button
            className={dragOverCategoryId === "" ? "drop-active" : ""}
            onClick={() => setCurrentCategoryId("")}
            onDragOver={(e) => allowItemDrop(e, "")}
            onDragLeave={() => setDragOverCategoryId(null)}
            onDrop={(e) => dropItem(e, "")}
          >
            Root
          </button>
          {breadcrumbs.map((category) => (
            <span key={category.id}>
              /
              <button onClick={() => setCurrentCategoryId(category.id)}>
                {category.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {items.length === 0 && categories.length === 0 ? (
        <div className="empty-state">
          No sync items yet.
          <br />
          <button className="primary" onClick={() => openNew()} style={{ marginTop: 16 }}>
            <Plus size={14} weight="bold" /> Add your first item
          </button>
        </div>
      ) : pagedEntries.length === 0 ? (
        <div className="empty-state">
          {searching ? "No items match your search." : "No items in this category."}
          {!searching && (
            <>
              <br />
              <button className="primary" onClick={() => openNew()} style={{ marginTop: 16 }}>
                <Plus size={14} weight="bold" /> Add sync item here
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="item-list">
          {pagedEntries.map((entry) => {
            if ("parentId" in entry) {
              const childCategories = categories.filter(
                (category) => category.parentId === entry.id,
              ).length;
              const childItems = items.filter(
                (item) => item.categoryId === entry.id,
              ).length;
              const project = resolveProject(entry.projectId, projects);
              return (
                <div
                  key={`category-${entry.id}`}
                  className={`item-card category-card ${dragOverCategoryId === entry.id ? "drop-active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openCategory(entry)}
                  onDragOver={(e) => allowItemDrop(e, entry.id)}
                  onDragLeave={() => setDragOverCategoryId(null)}
                  onDrop={(e) => {
                    e.stopPropagation();
                    dropItem(e, entry.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") openCategory(entry);
                  }}
                >
                  <div className="item-head">
                    <span className="type-icon" aria-hidden="true">[+]</span>
                    <span className="item-name">{entry.name}</span>
                    <div className="item-actions">
                      <button
                        className="card-btn card-btn-add"
                        onClick={(e) => {
                          e.stopPropagation();
                          openNew(entry.id);
                        }}
                        title="Add sync item here"
                        aria-label="Add sync item here"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        className="card-btn card-btn-sync-up"
                        onClick={(e) => {
                          e.stopPropagation();
                          syncCategory(entry, "up");
                        }}
                        title="Sync category up"
                        aria-label="Sync category up"
                      >
                        <CaretUp size={14} weight="bold" />
                      </button>
                      <button
                        className="card-btn card-btn-sync-down"
                        onClick={(e) => {
                          e.stopPropagation();
                          syncCategory(entry, "down");
                        }}
                        title="Sync category down"
                        aria-label="Sync category down"
                      >
                        <CaretDown size={14} weight="bold" />
                      </button>
                      <button
                        className="card-btn card-btn-copy"
                        onClick={(e) => {
                          e.stopPropagation();
                          cloneCategory(entry);
                        }}
                        title="Clone category"
                        aria-label="Clone category"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        className="card-btn card-btn-edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCategoryEditor(entry);
                        }}
                        title="Edit category"
                        aria-label="Edit category"
                      >
                        <Gear size={14} />
                      </button>
                      <button
                        className="card-btn card-btn-del"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmCategoryDelete(entry);
                        }}
                        title="Delete category"
                        aria-label="Delete category"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="item-footer">
                    <div className="item-meta">
                      <span className="group-tag">
                        {project?.name || "No project"}
                      </span>
                      <span className="category-summary">
                        {childCategories} categories, {childItems} items
                      </span>
                    </div>
                  </div>
                </div>
              );
            }
            const item = entry;
            const project = resolveProject(item.projectId, projects);
            const liveEnabled = liveItemIds.includes(item.id);
            const hookEnabled = hookStates[item.id]?.installed;
            return (
              <div
                key={item.id}
                className={`item-card ${item.type}`}
                draggable
                onDragStart={(e) => dragItem(e, item)}
                onDragEnd={() => setDragOverCategoryId(null)}
              >
                <div className="item-head">
                  <span className="type-icon" aria-hidden="true">
                    {item.type === "folder" ? "📁" : "📄"}
                  </span>
                  <span className="item-name">{item.name}</span>
                  <div className="item-actions">
                    <button
                      className="card-btn card-btn-copy"
                      onClick={() => cloneItem(item)}
                      title="Clone"
                      aria-label="Clone"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      className="card-btn card-btn-edit"
                      onClick={() => openEdit(item)}
                      title="Edit"
                      aria-label="Edit"
                    >
                      <Gear size={14} />
                    </button>
                    <button
                      className="card-btn card-btn-del"
                      onClick={() => removeItem(item.id)}
                      title="Delete"
                      aria-label="Delete"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="item-footer">
                  <div className="item-meta">
                    <span className="group-tag">
                      {project?.name || "No project"}
                    </span>
                  </div>
                  <div className="item-actions-bottom">
                    <button
                      className="btn-up"
                      onClick={() =>
                        setSyncTargetPicker({ item, direction: "up" })
                      }
                      title="Sync up"
                      aria-label="Sync up"
                    >
                      <CaretUp size={14} weight="bold" />
                    </button>
                    <button
                      className="btn-down"
                      onClick={() =>
                        setSyncTargetPicker({ item, direction: "down" })
                      }
                      title="Sync down"
                      aria-label="Sync down"
                    >
                      <CaretDown size={14} weight="bold" />
                    </button>
                    <button
                      className={`live-icon ${liveEnabled ? "active" : ""}`}
                      onClick={() => toggleLiveSync(item.id)}
                      title={
                        liveEnabled
                          ? "Disable live sync (10s)"
                          : "Enable live sync (10s)"
                      }
                      aria-label={
                        liveEnabled
                          ? "Disable live sync (10s)"
                          : "Enable live sync (10s)"
                      }
                    >
                      <Lightning size={14} weight={liveEnabled ? "fill" : "regular"} />
                    </button>
                    <button
                      className={`hook-icon ${hookEnabled ? "active" : ""}`}
                      onClick={() => togglePostCommitHook(item)}
                      disabled={hookPendingId === item.id}
                      title={hookEnabled ? "Remove post-commit sync" : "Add post-commit sync"}
                      aria-label={hookEnabled ? "Remove post-commit sync" : "Add post-commit sync"}
                    >
                      <GitBranch size={14} weight={hookEnabled ? "fill" : "regular"} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            Prev
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}

      {(output || status !== "ready") && (
        <div className="console-panel">
          <div className="console-head">
            <span>Output</span>
            <button onClick={() => setOutput("")}>Clear</button>
          </div>
          <pre>{output || "Ready to sync."}</pre>
        </div>
      )}

      <aside className={`history-sidebar ${historyMinimized ? "minimized" : ""}`}>
        {historyMinimized ? (
          <button
            className="history-sidebar-rail"
            onClick={() => setHistoryMinimized(false)}
            aria-label="Show history"
          >
            <ClockCounterClockwise size={18} />
            {history.length > 0 && <span>{Math.min(history.length, 99)}</span>}
          </button>
        ) : (
          <>
            <div className="history-sidebar-head">
              <button
                className="history-minimize"
                onClick={() => setHistoryMinimized(true)}
                aria-label="Minimize history"
              >
                <CaretRight size={14} weight="bold" />
              </button>
              <span>
                <ClockCounterClockwise size={13} /> Recent Jobs
              </span>
              <button
                className="history-clear"
                onClick={() => setConfirmClearHistory(true)}
                disabled={history.length === 0}
              >
                Clear
              </button>
            </div>
            {history.length === 0 ? (
              <p className="history-empty">No jobs yet.</p>
            ) : (
              <div className="history-sidebar-list">
                {history.slice(0, 20).map((j) => (
                  <div
                    key={j.id}
                    className={`history-item-mini ${j.status}`}
                    onClick={() => {
                      setOutput(j.output || "");
                      setStatus(j.status === "succeeded" ? "done" : "failed");
                    }}
                  >
                    <span className={`status-dot ${j.status}`} />
                    <span className="h-direction">{j.direction}</span>
                    <span className="h-title">{describeJob(j, items)}</span>
                    <span className="h-time">
                      {new Date(j.startedAt).toLocaleTimeString()}
                    </span>
                    <span className={`h-status ${j.status}`}>{j.status}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </aside>

      {syncTargetPicker && (
        <TargetPicker
          item={syncTargetPicker.item}
          remotes={remotes}
          direction={syncTargetPicker.direction}
          onStart={(ti) =>
            handleSingleSync(
              syncTargetPicker.item,
              syncTargetPicker.direction,
              ti,
            )
          }
          onClose={() => setSyncTargetPicker(null)}
        />
      )}

      {showForm && !targetDraft && (
        <EditorModal
          title={editing.id ? "Edit Sync Item" : "New Sync Item"}
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
                placeholder="e.g. Static assets"
              />
            </label>
            <label>
              Source path (local)
              <input
                value={editing.source}
                onChange={(e) =>
                  setEditing({ ...editing, source: e.target.value })
                }
                placeholder="/home/user/project/dist"
              />
            </label>
            <label>
              Type
              <select
                value={editing.type}
                onChange={(e) =>
                  setEditing({ ...editing, type: e.target.value })
                }
              >
                <option value="folder">Folder</option>
                <option value="file">File</option>
              </select>
            </label>
            <label>
              Project (optional)
              <select
                value={editing.projectId}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    projectId: e.target.value,
                    categoryId: "",
                  })
                }
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select
                value={editing.categoryId || ""}
                onChange={(e) =>
                  setEditing({ ...editing, categoryId: e.target.value })
                }
              >
                <option value="">Root</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {categoryBreadcrumbs(categories, category.id)
                      .map((part) => part.name)
                      .join(" / ")}
                  </option>
                ))}
              </select>
            </label>
            {editing.type === "folder" && (
              <label>
                Local sync ignore
                <textarea
                  className="target-vars"
                  value={editing.localSyncIgnoreText || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      localSyncIgnoreText: e.target.value,
                    })
                  }
                  placeholder={"node_modules/\n*.log"}
                  rows={4}
                />
              </label>
            )}
            <div className="form-section">Targets</div>
            <div className="target-list-editor">
              {(editing.targets || []).map((t, i) => {
                const remoteIds = t.remoteIds?.length
                  ? t.remoteIds
                  : [t.remoteId].filter(Boolean);
                const remoteNames = remoteIds
                  .map((id) => remotes.find((r) => r.id === id)?.name || id)
                  .join(", ");
                return (
                  <div key={i} className="target-summary-row">
                    <button
                      type="button"
                      className="target-summary-main"
                      onClick={() => openTargetEditor(i)}
                    >
                      <span>{t.name || `Target ${i + 1}`}</span>
                      <small>{remoteNames || "No remote"} - {t.dest || "No destination"}</small>
                    </button>
                    <button
                      type="button"
                      className="target-remove"
                      onClick={() => removeTarget(i)}
                      disabled={editing.targets.length <= 1}
                      aria-label="Remove target"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="target-add"
              onClick={() => openTargetEditor()}
            >
              <Plus size={14} weight="bold" /> Add target
            </button>
          </div>
        </EditorModal>
      )}

      {showForm && targetDraft && (
        <EditorModal
          title={targetDraft.index === null ? "New Target" : "Edit Target"}
          onClose={() => setTargetDraft(null)}
          onSave={saveTargetDraft}
        >
          <div className="form">
            <label>
              Label (optional)
              <input
                value={targetDraft.target.name || ""}
                onChange={(e) => updateTargetDraft({ name: e.target.value })}
                placeholder="e.g. Production"
              />
            </label>
            <label>
              Remotes
              <div className="target-remotes">
                {remotes.map((r) => {
                  const selected = (
                    targetDraft.target.remoteIds?.length
                      ? targetDraft.target.remoteIds
                      : [targetDraft.target.remoteId].filter(Boolean)
                  ).includes(r.id);
                  return (
                    <label key={r.id}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => toggleDraftRemote(r.id, e.target.checked)}
                      />
                      {r.name} ({r.kind})
                    </label>
                  );
                })}
              </div>
            </label>
            <label>
              Destination path
              <input
                className="target-dest"
                value={targetDraft.target.dest || ""}
                onChange={(e) => updateTargetDraft({ dest: e.target.value })}
                placeholder="/remote/path"
              />
            </label>
            <label>
              Variables
              <textarea
                className="target-vars"
                value={targetDraft.target.variablesText || ""}
                onChange={(e) =>
                  updateTargetDraft({ variablesText: e.target.value })
                }
                placeholder={"project=kasb\ndomain=files_program"}
                rows={3}
              />
            </label>
            {editing.type === "folder" && (
              <label>
                Remote sync ignore
                <textarea
                  className="target-vars"
                  value={targetDraft.target.remoteSyncIgnoreText || ""}
                  onChange={(e) =>
                    updateTargetDraft({ remoteSyncIgnoreText: e.target.value })
                  }
                  placeholder={"cache/\n*.tmp"}
                  rows={4}
                />
              </label>
            )}
          </div>
        </EditorModal>
      )}

      {categoryDraft && (
        <EditorModal
          title={categoryDraft.id ? "Edit Category" : "New Category"}
          onClose={() => setCategoryDraft(null)}
          onSave={saveCategoryDraft}
        >
          <div className="form">
            <label>
              Name
              <input
                value={categoryDraft.name}
                onChange={(e) =>
                  setCategoryDraft({ ...categoryDraft, name: e.target.value })
                }
                placeholder="e.g. Client sites"
              />
            </label>
            <label>
              Project
              <select
                value={categoryDraft.projectId || ""}
                disabled={Boolean(categoryDraft.id)}
                onChange={(e) =>
                  setCategoryDraft({
                    ...categoryDraft,
                    projectId: e.target.value,
                    parentId: "",
                  })
                }
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Parent category
              <select
                value={categoryDraft.parentId || ""}
                onChange={(e) =>
                  setCategoryDraft({ ...categoryDraft, parentId: e.target.value })
                }
              >
                <option value="">Root</option>
                {categories
                  .filter(
                    (category) =>
                      category.projectId === categoryDraft.projectId &&
                      category.id !== categoryDraft.id &&
                      !isCategoryDescendant(
                        categories,
                        categoryDraft.id,
                        category.id,
                      ),
                  )
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {categoryBreadcrumbs(categories, category.id)
                        .map((part) => part.name)
                        .join(" / ")}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </EditorModal>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Sync Item"
          message={`Delete "${confirmDelete.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={doRemove}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmCategoryDelete && (
        <ConfirmModal
          title="Delete Category"
          message={`Delete "${confirmCategoryDelete.name}" and all its contents? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={doRemoveCategory}
          onCancel={() => setConfirmCategoryDelete(null)}
        />
      )}

      {confirmClearHistory && (
        <ConfirmModal
          title="Clear Job History"
          message="Clear all completed jobs from history?"
          confirmLabel="Clear history"
          onConfirm={clearHistory}
          onCancel={() => setConfirmClearHistory(false)}
        />
      )}
    </div>
  );
}
