#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command as TokioCommand;

// =========================================================================
// Structs & State
// =========================================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
struct SyncJob {
    id: String,
    direction: String,
    #[serde(rename = "dryRun")]
    dry_run: bool,
    #[serde(rename = "noDelete")]
    no_delete: bool,
    #[serde(rename = "itemTargets")]
    item_targets: serde_json::Value,
    #[serde(rename = "itemIds")]
    item_ids: Vec<String>,
    status: String, // "running", "succeeded", "failed"
    #[serde(rename = "exitCode")]
    exit_code: Option<i32>,
    output: String,
    #[serde(rename = "startedAt")]
    started_at: String,
    #[serde(rename = "finishedAt")]
    finished_at: Option<String>,
}

struct TerminalSession {
    id: String,
    name: String,
    status: Arc<Mutex<String>>,
    output: Arc<Mutex<String>>,
    stdin_tx: tokio::sync::mpsc::Sender<String>,
    abort_handle: tokio::task::AbortHandle,
    created_at: i64,
}

#[derive(Serialize, Clone, Debug)]
struct TerminalSnapshot {
    id: String,
    name: String,
    status: String,
    output: String,
    #[serde(rename = "createdAt")]
    created_at: i64,
}

struct AppState {
    jobs: Arc<Mutex<Vec<SyncJob>>>,
    terminals: Arc<Mutex<HashMap<String, TerminalSession>>>,
    next_job_id: Arc<Mutex<u64>>,
}

// =========================================================================
// Environment & Helper functions
// =========================================================================

fn load_dotenv(env_path: &Path) {
    if let Ok(content) = fs::read_to_string(env_path) {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, val)) = line.split_once('=') {
                let key = key.trim();
                let val = val.trim().trim_matches('"').trim_matches('\'');
                env::set_var(key, val);
            }
        }
    }
}

fn get_config_path() -> PathBuf {
    if let Ok(val) = env::var("SYNC_CONFIG") {
        PathBuf::from(val)
    } else {
        env::current_dir().unwrap_or_default().join("sync-config.json")
    }
}

fn init_env(_app_handle: &AppHandle) {
    let config_path = get_config_path();
    env::set_var("SYNC_CONFIG", &config_path);

    if let Some(parent) = config_path.parent() {
        let env_path = parent.join(".env");
        load_dotenv(&env_path);
        env::set_var("SYNC_GUI_ENV", env_path);
    }

    #[cfg(target_os = "windows")]
    {
        use tauri::path::BaseDirectory;
        if let Ok(bundled_root) = _app_handle.path().resolve("vendor/win-tools", BaseDirectory::Resource) {
            let bundled_bin = bundled_root.join("usr").join("bin");
            let bundled_bash = bundled_bin.join("bash.exe");
            if bundled_bash.exists() {
                let _ = fs::create_dir_all(bundled_root.join("tmp"));
                let _ = fs::create_dir_all(bundled_root.join("home").join("sync-gui").join(".ssh"));

                env::set_var("SYNC_GUI_BASH", &bundled_bash);
                env::set_var("SYNC_GUI_DRIVE_PREFIX", "/cygdrive");
                env::set_var("SYNC_GUI_KNOWN_HOSTS", "/home/sync-gui/.ssh/known_hosts");
                env::set_var("HOME", "/home/sync-gui");

                if let Ok(current_path) = env::var("PATH") {
                    let new_path = format!("{};{}", bundled_bin.to_string_lossy(), current_path);
                    env::set_var("PATH", new_path);
                } else {
                    env::set_var("PATH", bundled_bin);
                }
            }
        }
    }
}

// =========================================================================
// Configuration CRUD Commands
// =========================================================================

fn migration_v1(config: &mut serde_json::Value) -> bool {
    let mut changed = false;
    let mut project_to_remote = HashMap::new();
    if let Some(projects) = config.get("projects").and_then(|v| v.as_array()) {
        for proj in projects {
            if let (Some(id), Some(remote_id)) = (proj.get("id").and_then(|v| v.as_str()), proj.get("remoteId").and_then(|v| v.as_str())) {
                project_to_remote.insert(id.to_string(), remote_id.to_string());
            }
        }
    }

    if let Some(items) = config.get_mut("items").and_then(|v| v.as_array_mut()) {
        for item in items {
            if item.get("dest").is_some() && item.get("targets").is_none() {
                let project_id = item.get("projectId").and_then(|v| v.as_str()).unwrap_or("");
                let remote_id = project_to_remote.get(project_id).map(|s| s.as_str()).unwrap_or("");
                let dest = item.get("dest").cloned().unwrap_or(serde_json::Value::Null);
                item.as_object_mut().unwrap().insert(
                    "targets".to_string(),
                    serde_json::json!([{ "name": "Default", "remoteId": remote_id, "dest": dest }])
                );
                item.as_object_mut().unwrap().remove("dest");
                changed = true;
            }
        }
    }
    changed
}

fn migrate(mut config: serde_json::Value) -> serde_json::Value {
    let mut changed = migration_v1(&mut config);
    
    if config.get("remotes").is_none() {
        config.as_object_mut().unwrap().insert("remotes".to_string(), serde_json::json!([]));
        changed = true;
    }
    if config.get("projects").is_none() {
        config.as_object_mut().unwrap().insert("projects".to_string(), serde_json::json!([]));
        changed = true;
    }
    if config.get("categories").is_none() {
        config.as_object_mut().unwrap().insert("categories".to_string(), serde_json::json!([]));
        changed = true;
    }
    if config.get("items").is_none() {
        config.as_object_mut().unwrap().insert("items".to_string(), serde_json::json!([]));
        changed = true;
    }
    
    // Recover missing categories
    let mut missing_categories = Vec::new();
    if let Some(items) = config.get("items").and_then(|v| v.as_array()) {
        let category_ids: std::collections::HashSet<&str> = config.get("categories")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|c| c.get("id").and_then(|v| v.as_str())).collect())
            .unwrap_or_default();
            
        for item in items {
            if let Some(cat_id) = item.get("categoryId").and_then(|v| v.as_str()) {
                if !cat_id.is_empty() && !category_ids.contains(cat_id) {
                    let project_id = item.get("projectId").and_then(|v| v.as_str()).unwrap_or("");
                    let name = cat_id.split('-').next().unwrap_or("Recovered category");
                    missing_categories.push(serde_json::json!({
                        "id": cat_id,
                        "name": name,
                        "projectId": project_id,
                        "parentId": ""
                    }));
                }
            }
        }
    }
    
    if !missing_categories.is_empty() {
        if let Some(categories) = config.get_mut("categories").and_then(|v| v.as_array_mut()) {
            for mc in missing_categories {
                categories.push(mc);
            }
            changed = true;
        }
    }

    if changed {
        let _ = write_config_internal(&config);
    }

    config
}

fn write_config_internal(config: &serde_json::Value) -> Result<(), String> {
    let path = get_config_path();
    let out = serde_json::json!({
        "remotes": config.get("remotes").cloned().unwrap_or(serde_json::json!([])),
        "projects": config.get("projects").cloned().unwrap_or(serde_json::json!([])),
        "categories": config.get("categories").cloned().unwrap_or(serde_json::json!([])),
        "items": config.get("items").cloned().unwrap_or(serde_json::json!([]))
    });
    let raw = serde_json::to_string_pretty(&out).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(())
}

fn item_uses_remote(item: &serde_json::Value, config: &serde_json::Value, remote_id: &str) -> bool {
    let project_id = item.get("projectId").and_then(|v| v.as_str()).unwrap_or("");
    if let Some(projects) = config.get("projects").and_then(|v| v.as_array()) {
        if let Some(proj) = projects.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(project_id)) {
            if proj.get("remoteId").and_then(|v| v.as_str()) == Some(remote_id) {
                return true;
            }
        }
    }
    if let Some(targets) = item.get("targets").and_then(|v| v.as_array()) {
        for target in targets {
            if let Some(r_ids) = target.get("remoteIds").and_then(|v| v.as_array()) {
                if r_ids.iter().any(|id| id.as_str() == Some(remote_id)) {
                    return true;
                }
            }
            if target.get("remoteId").and_then(|v| v.as_str()) == Some(remote_id) {
                return true;
            }
        }
    }
    false
}

fn apply_remote_rename_migrations(prev: &serde_json::Value, next: &serde_json::Value) {
    let prev_remotes = match prev.get("remotes").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return,
    };
    let next_remotes = match next.get("remotes").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return,
    };
    
    let prev_map: HashMap<&str, &serde_json::Value> = prev_remotes.iter()
        .filter_map(|r| r.get("id").and_then(|v| v.as_str()).map(|id| (id, r)))
        .collect();

    for remote in next_remotes {
        let id = match remote.get("id").and_then(|v| v.as_str()) {
            Some(id) => id,
            None => continue,
        };
        let name = match remote.get("name").and_then(|v| v.as_str()) {
            Some(n) => n,
            None => continue,
        };
        let previous = match prev_map.get(id) {
            Some(p) => p,
            None => continue,
        };
        let prev_name = match previous.get("name").and_then(|v| v.as_str()) {
            Some(n) => n,
            None => continue,
        };
        if prev_name == name {
            continue;
        }

        if let Some(items) = next.get("items").and_then(|v| v.as_array()) {
            for item in items {
                let source = match item.get("source").and_then(|v| v.as_str()) {
                    Some(s) => s,
                    None => continue,
                };
                if !source.contains("{SERVER_NAME}") {
                    continue;
                }
                if !item_uses_remote(item, next, id) {
                    continue;
                }

                let mut vals_prev = HashMap::new();
                vals_prev.insert("SERVER_NAME".to_string(), prev_name.to_string());
                let old_path_str = apply_known_path_tokens(source, &vals_prev);
                let old_path = Path::new(&old_path_str);

                let mut vals_next = HashMap::new();
                vals_next.insert("SERVER_NAME".to_string(), name.to_string());
                let new_path_str = apply_known_path_tokens(source, &vals_next);
                let new_path = Path::new(&new_path_str);

                if old_path_str == new_path_str {
                    continue;
                }
                if old_path.exists() && !new_path.exists() {
                    if let Some(parent) = new_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if fs::rename(old_path, new_path).is_ok() {
                        let _ = remove_empty_parents(old_path.parent().unwrap(), Path::new("."));
                    }
                }
            }
        }
    }
}

fn remove_empty_parents(start_dir: &Path, stop_dir: &Path) -> Result<(), std::io::Error> {
    let current = start_dir.to_path_buf();
    if let (Ok(curr_abs), Ok(stop_abs)) = (fs::canonicalize(&current), fs::canonicalize(stop_dir)) {
        let mut curr = curr_abs;
        while curr.starts_with(&stop_abs) && curr != stop_abs {
            let entries = fs::read_dir(&curr)?.count();
            if entries > 0 {
                break;
            }
            fs::remove_dir(&curr)?;
            if let Some(parent) = curr.parent() {
                curr = parent.to_path_buf();
            } else {
                break;
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn read_config() -> Result<serde_json::Value, String> {
    let path = get_config_path();
    if !path.exists() {
        return Ok(serde_json::json!({ "remotes": [], "projects": [], "categories": [], "items": [] }));
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(migrate(json))
}

#[tauri::command]
fn write_config(config: serde_json::Value) -> Result<(), String> {
    let path = get_config_path();
    let previous = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .map(migrate)
    } else {
        None
    };

    write_config_internal(&config)?;

    if let Some(prev) = previous {
        apply_remote_rename_migrations(&prev, &config);
    }

    Ok(())
}

// =========================================================================
// Dependency Check & Remote Test Commands
// =========================================================================

fn command_exists_win(command: &str, _msys2_bash: &str) -> bool {
    let check_cmd = format!("PATH=/usr/bin; command -v {}", command);
    if let Ok((code, output)) = run_bash_process(&check_cmd, "") {
        if code == 0 && !output.is_empty() {
            let normalized = output.replace('\\', "/").to_lowercase();
            return normalized.ends_with(&format!("/{}", command.to_lowercase()))
                || normalized.ends_with(&format!("/{}.exe", command.to_lowercase()));
        }
    }
    false
}

#[tauri::command]
fn check_dependencies() -> Result<serde_json::Value, String> {
    let mut deps = HashMap::new();
    deps.insert("bash".to_string(), false);
    deps.insert("rsync".to_string(), false);
    deps.insert("sshpass".to_string(), false);
    deps.insert("ssh".to_string(), false);

    if cfg!(target_os = "windows") {
        let msys2_bash = env::var("SYNC_GUI_BASH").unwrap_or_else(|_| "C:\\msys64\\usr\\bin\\bash.exe".to_string());
        let msys2 = Path::new(&msys2_bash).exists();
        if msys2 {
            for key in deps.keys().cloned().collect::<Vec<String>>() {
                deps.insert(key.clone(), command_exists_win(&key, &msys2_bash));
            }
        }
        let ok = deps.values().all(|&v| v);
        Ok(serde_json::json!({
            "ok": ok,
            "platform": "win32",
            "deps": deps,
            "msys2": msys2
        }))
    } else {
        // Unix platforms
        for key in deps.keys().cloned().collect::<Vec<String>>() {
            let output = std::process::Command::new("command")
                .args(["-v", &key])
                .output();
            deps.insert(key, output.map(|o| o.status.success()).unwrap_or(false));
        }
        let ok = deps.values().all(|&v| v);
        Ok(serde_json::json!({
            "ok": ok,
            "platform": "linux",
            "deps": deps
        }))
    }
}

#[tauri::command]
fn check_remote_connection(remote_id: String) -> Result<serde_json::Value, String> {
    let config = read_config()?;
    let remotes = config.get("remotes").and_then(|v| v.as_array()).ok_or("No remotes configured.")?;
    let remote = remotes.iter().find(|r| r.get("id").and_then(|v| v.as_str()) == Some(&remote_id))
        .ok_or_else(|| format!("Remote not found: {}", remote_id))?;

    let kind = remote.get("kind").and_then(|v| v.as_str()).unwrap_or("local");
    if kind == "ssh" {
        let (ok, msg) = match check_ssh(remote) {
            Ok((ok, msg)) => (ok, msg),
            Err(e) => (false, e),
        };
        return Ok(serde_json::json!({ "ok": ok, "message": msg }));
    }

    let root = remote.get("root").or_else(|| remote.get("path")).and_then(|v| v.as_str()).unwrap_or("");
    if root.is_empty() {
        return Ok(serde_json::json!({ "ok": false, "error": "Local remote has no root path." }));
    }
    let p = Path::new(root);
    if p.exists() {
        Ok(serde_json::json!({ "ok": true, "message": "Local path is reachable." }))
    } else {
        Ok(serde_json::json!({ "ok": false, "error": format!("Local path does not exist: {}", root) }))
    }
}

fn check_ssh(remote: &serde_json::Value) -> Result<(bool, String), String> {
    let host = remote.get("host").and_then(|v| v.as_str()).unwrap_or("");
    let username = remote.get("username").and_then(|v| v.as_str()).unwrap_or("");
    let password = remote.get("password").and_then(|v| v.as_str()).unwrap_or("");
    let port = remote.get("port").and_then(|v| v.as_i64()).unwrap_or(22);

    if host.is_empty() || username.is_empty() {
        return Ok((false, "SSH remote needs host and username.".to_string()));
    }

    let known_hosts_opt = if let Ok(hosts) = env::var("SYNC_GUI_KNOWN_HOSTS") {
        format!(" -o UserKnownHostsFile='{}'", hosts.replace('\'', "'\\''"))
    } else {
        "".to_string()
    };

    let ssh_cmd = format!(
        "sshpass -e ssh -p {} -o BatchMode=no -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new{}{}@{} 'printf ok'",
        port,
        known_hosts_opt,
        username,
        host
    );

    match run_bash_process(&ssh_cmd, password) {
        Ok((code, output)) => {
            if code == 0 && output.contains("ok") {
                Ok((true, "SSH connection works.".to_string()))
            } else {
                Ok((false, if output.is_empty() { format!("SSH exited with code {}", code) } else { output }))
            }
        }
        Err(e) => Ok((false, e))
    }
}

// =========================================================================
// Sync Process Spawning & Logic
// =========================================================================

fn run_bash_process(command_str: &str, password: &str) -> Result<(i32, String), String> {
    let bash_path = env::var("SYNC_GUI_BASH")
        .unwrap_or_else(|_| if cfg!(target_os = "windows") { "C:\\msys64\\usr\\bin\\bash.exe".to_string() } else { "bash".to_string() });

    let mut cmd = std::process::Command::new(&bash_path);
    cmd.arg("-lc")
        .arg(format!("PATH=/usr/bin:$PATH\n{}", command_str));

    cmd.env("SSHPASS", password);
    for (k, v) in env::vars() {
        if k != "SSHPASS" {
            cmd.env(k, v);
        }
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn bash: {}", e))?;
    let output = child.wait_with_output().map_err(|e| format!("Process error: {}", e))?;

    let mut out_str = String::from_utf8_lossy(&output.stdout).into_owned();
    let err_str = String::from_utf8_lossy(&output.stderr).into_owned();

    if !err_str.is_empty() {
        if !out_str.is_empty() && !out_str.ends_with('\n') {
            out_str.push('\n');
        }
        out_str.push_str(&err_str);
    }

    let code = output.status.code().unwrap_or(1);
    Ok((code, out_str.trim().to_string()))
}

#[tauri::command]
fn start_sync_job(
    state: State<'_, AppState>,
    direction: String,
    dry_run: bool,
    no_delete: bool,
    item_targets: serde_json::Value,
) -> Result<SyncJob, String> {
    let config = read_config()?;
    let item_ids: Vec<String> = if item_targets.is_object() {
        item_targets.as_object().unwrap().keys().cloned().collect()
    } else {
        Vec::new()
    };

    let items_to_sync = if !item_ids.is_empty() {
        if let Some(items) = config.get("items").and_then(|v| v.as_array()) {
            items.iter().filter(|i| {
                i.get("id").and_then(|v| v.as_str()).map(|id| item_ids.contains(&id.to_string())).unwrap_or(false)
            }).cloned().collect::<Vec<serde_json::Value>>()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    if items_to_sync.is_empty() {
        return Err("No items to sync.".to_string());
    }

    let mut next_id = state.next_job_id.lock().unwrap();
    let job_id = next_id.to_string();
    *next_id += 1;

    let job = SyncJob {
        id: job_id.clone(),
        direction: direction.clone(),
        dry_run,
        no_delete,
        item_targets: item_targets.clone(),
        item_ids: item_ids.clone(),
        status: "running".to_string(),
        exit_code: None,
        output: String::new(),
        started_at: Utc::now().to_rfc3339(),
        finished_at: None,
    };

    state.jobs.lock().unwrap().insert(0, job.clone());

    // Spawn thread to execute sync
    let jobs_mutex = Arc::clone(&state.jobs);
    let job_id_clone = job_id.clone();
    
    std::thread::spawn(move || {
        let result = run_sync_internal(&config, &direction, dry_run, no_delete, &item_targets);
        let mut jobs = jobs_mutex.lock().unwrap();
        if let Some(j) = jobs.iter_mut().find(|j| j.id == job_id_clone) {
            match result {
                Ok((code, output)) => {
                    j.exit_code = Some(code);
                    j.output = output;
                    j.status = if code == 0 { "succeeded".to_string() } else { "failed".to_string() };
                }
                Err(e) => {
                    j.exit_code = Some(1);
                    j.output = e;
                    j.status = "failed".to_string();
                }
            }
            j.finished_at = Some(Utc::now().to_rfc3339());
        }
    });

    Ok(job)
}

#[tauri::command]
fn get_sync_history(state: State<'_, AppState>) -> Result<Vec<SyncJob>, String> {
    Ok(state.jobs.lock().unwrap().clone())
}

#[tauri::command]
fn get_sync_job(state: State<'_, AppState>, id: String) -> Result<SyncJob, String> {
    let jobs = state.jobs.lock().unwrap();
    jobs.iter().find(|j| j.id == id).cloned().ok_or_else(|| format!("Job not found: {}", id))
}

#[tauri::command]
fn clear_sync_history(state: State<'_, AppState>) -> Result<usize, String> {
    let mut jobs = state.jobs.lock().unwrap();
    let before = jobs.len();
    jobs.retain(|j| j.status == "running");
    let cleared = before - jobs.len();
    Ok(cleared)
}

fn run_sync_internal(
    config: &serde_json::Value,
    direction: &str,
    dry_run: bool,
    no_delete: bool,
    item_targets: &serde_json::Value,
) -> Result<(i32, String), String> {
    let items_arr = config.get("items").and_then(|v| v.as_array()).ok_or("No items config.")?;
    let remotes_arr = config.get("remotes").and_then(|v| v.as_array()).ok_or("No remotes config.")?;
    let projects_arr = config.get("projects").and_then(|v| v.as_array()).ok_or("No projects config.")?;

    let item_targets_obj = item_targets.as_object().ok_or("itemTargets must be an object")?;
    
    let mut chunks = Vec::new();
    let mut final_code = 0;

    for (item_id, targets_val) in item_targets_obj {
        let item = items_arr.iter().find(|i| i.get("id").and_then(|v| v.as_str()) == Some(item_id))
            .ok_or_else(|| format!("Item not found: {}", item_id))?;
            
        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("Unnamed");
        let project_id = item.get("projectId").and_then(|v| v.as_str()).unwrap_or("");
        
        let target_indices: Vec<usize> = if let Some(arr) = targets_val.as_array() {
            arr.iter().filter_map(|v| v.as_u64().map(|idx| idx as usize)).collect()
        } else {
            vec![0]
        };
        let target_indices = if target_indices.is_empty() { vec![0] } else { target_indices };

        let targets = item.get("targets").and_then(|v| v.as_array()).ok_or("Item has no targets")?;

        if direction == "up" {
            for ti in target_indices {
                if ti >= targets.len() { continue; }
                let target = &targets[ti];
                
                let project = projects_arr.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(project_id));
                let remote_ids = target_remote_ids(target);
                
                let mut remotes: Vec<serde_json::Value> = if !remote_ids.is_empty() {
                    remote_ids.iter().filter_map(|rid| {
                        remotes_arr.iter().find(|r| r.get("id").and_then(|v| v.as_str()) == Some(rid)).cloned()
                    }).collect()
                } else {
                    let proj_remote = project.and_then(|p| p.get("remoteId").and_then(|v| v.as_str())).and_then(|rid| {
                        remotes_arr.iter().find(|r| r.get("id").and_then(|v| v.as_str()) == Some(rid))
                    });
                    if let Some(r) = proj_remote {
                        vec![r.clone()]
                    } else {
                        Vec::new()
                    }
                };
                
                if remotes.is_empty() {
                    let default_name = target.get("name")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!(format!("target {}", ti)));
                    remotes.push(serde_json::json!({ "kind": "local", "name": default_name }));
                }

                for remote in remotes {
                    let target_name = target.get("name").and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("target {}", ti));
                    let remote_name = remote.get("name").or_else(|| remote.get("id")).and_then(|v| v.as_str()).unwrap_or("local");
                    let label = format!("{} / {}", target_name, remote_name);
                    
                    chunks.push(format!("[{} ? {}]", name, label));
                    let (code, output) = if remote.get("kind").and_then(|v| v.as_str()) == Some("ssh") {
                        sync_ssh(item, target, &remote, direction, dry_run, no_delete)?
                    } else {
                        sync_local(item, target, &remote, direction, dry_run, no_delete)?
                    };
                    if !output.is_empty() {
                        chunks.push(output);
                    }
                    if code != 0 && final_code == 0 {
                        final_code = code;
                    }
                    chunks.push(format!("[{} ? {}] exit {}", name, label, code));
                }
            }
        } else {
            // Down direction
            let ti = if !target_indices.is_empty() { target_indices[0] } else { 0 };
            if ti < targets.len() {
                let target = &targets[ti];
                let project = projects_arr.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(project_id));
                let remote_ids = target_remote_ids(target);
                
                let mut remotes: Vec<serde_json::Value> = if !remote_ids.is_empty() {
                    remote_ids.iter().filter_map(|rid| {
                        remotes_arr.iter().find(|r| r.get("id").and_then(|v| v.as_str()) == Some(rid)).cloned()
                    }).collect()
                } else {
                    let proj_remote = project.and_then(|p| p.get("remoteId").and_then(|v| v.as_str())).and_then(|rid| {
                        remotes_arr.iter().find(|r| r.get("id").and_then(|v| v.as_str()) == Some(rid))
                    });
                    if let Some(r) = proj_remote {
                        vec![r.clone()]
                    } else {
                        Vec::new()
                    }
                };
                
                if remotes.is_empty() {
                    let default_name = target.get("name")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!(format!("target {}", ti)));
                    remotes.push(serde_json::json!({ "kind": "local", "name": default_name }));
                }

                for remote in remotes {
                    let target_name = target.get("name").and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("target {}", ti));
                    let remote_name = remote.get("name").or_else(|| remote.get("id")).and_then(|v| v.as_str()).unwrap_or("local");
                    let label = format!("{} / {}", target_name, remote_name);
                    
                    chunks.push(format!("[{} ? {}]", name, label));
                    let (code, output) = if remote.get("kind").and_then(|v| v.as_str()) == Some("ssh") {
                        sync_ssh(item, target, &remote, direction, dry_run, no_delete)?
                    } else {
                        sync_local(item, target, &remote, direction, dry_run, no_delete)?
                    };
                    if !output.is_empty() {
                        chunks.push(output);
                    }
                    if code != 0 && final_code == 0 {
                        final_code = code;
                    }
                    chunks.push(format!("[{} ? {}] exit {}", name, label, code));
                }
            }
        }
    }

    Ok((final_code, chunks.join("\n")))
}

fn shq(v: &str) -> String {
    format!("'{}'", v.replace('\'', "'\\''"))
}

fn to_shell_path(value: &str) -> String {
    let raw = value.replace('\\', "/");
    let drive_prefix = env::var("SYNC_GUI_DRIVE_PREFIX").unwrap_or_default();
    
    if raw.len() >= 3 && raw.as_bytes()[1] == b':' && raw.as_bytes()[2] == b'/' {
        let drive_letter = (raw.as_bytes()[0] as char).to_ascii_lowercase();
        let rest = &raw[3..];
        return format!("{}/{}/{}", drive_prefix, drive_letter, rest);
    }
    
    if let Ok(abs_path) = fs::canonicalize(value) {
        let abs_str = abs_path.to_string_lossy().replace('\\', "/");
        if abs_str.len() >= 3 && abs_str.as_bytes()[1] == b':' && abs_str.as_bytes()[2] == b'/' {
            let drive_letter = (abs_str.as_bytes()[0] as char).to_ascii_lowercase();
            let rest = &abs_str[3..];
            return format!("{}/{}/{}", drive_prefix, drive_letter, rest);
        }
        return abs_str;
    }
    
    raw
}

fn ssh_known_hosts_option() -> String {
    if let Ok(hosts) = env::var("SYNC_GUI_KNOWN_HOSTS") {
        format!(" -o UserKnownHostsFile={}", shq(&hosts))
    } else {
        "".to_string()
    }
}

fn ignore_rules(value: &str) -> Vec<String> {
    value.lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect()
}

fn target_token_values(remote: &serde_json::Value, target: &serde_json::Value) -> HashMap<String, String> {
    let mut values = HashMap::new();
    if let Some(variables) = target.get("variables").and_then(|v| v.as_object()) {
        for (k, v) in variables {
            if let Some(s) = v.as_str() {
                values.insert(k.clone(), s.to_string());
            } else if let Some(n) = v.as_i64() {
                values.insert(k.clone(), n.to_string());
            } else if let Some(b) = v.as_bool() {
                values.insert(k.clone(), b.to_string());
            }
        }
    }
    
    let server_name = remote.get("name")
        .or_else(|| target.get("name"))
        .or_else(|| remote.get("id"))
        .or_else(|| target.get("remoteId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
        
    values.insert("SERVER_NAME".to_string(), server_name);
    values
}

fn sync_local(
    item: &serde_json::Value,
    target: &serde_json::Value,
    remote: &serde_json::Value,
    direction: &str,
    dry_run: bool,
    no_delete: bool,
) -> Result<(i32, String), String> {
    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("file");
    let src_pattern = if direction == "up" {
        item.get("source").and_then(|v| v.as_str()).unwrap_or("")
    } else {
        target.get("dest").and_then(|v| v.as_str()).unwrap_or("")
    };
    let dst_pattern = if direction == "up" {
        target.get("dest").and_then(|v| v.as_str()).unwrap_or("")
    } else {
        item.get("source").and_then(|v| v.as_str()).unwrap_or("")
    };

    let initial_values = target_token_values(remote, target);
    let pairs = expand_path_pairs(item_type, src_pattern, dst_pattern, &initial_values)?;

    if pairs.is_empty() {
        return Ok((1, format!("No {}s matched: {}", item_type, src_pattern)));
    }

    if dry_run {
        return Ok((0, format!("Would copy {} {}{}", pairs.len(), item_type, if pairs.len() == 1 { "" } else { "s" })));
    }

    let mut output = Vec::new();
    let mut exit_code = 0;

    let local_ignore_text = item.get("localSyncIgnore").and_then(|v| v.as_str()).unwrap_or("");
    let remote_ignore_text = target.get("remoteSyncIgnore").and_then(|v| v.as_str()).unwrap_or("");

    for pair in pairs {
        let source_ignores = if direction == "up" {
            vec![(pair.src.clone(), local_ignore_text.to_string())]
        } else {
            vec![(pair.src.clone(), remote_ignore_text.to_string())]
        };

        let dest_ignores = if direction == "up" {
            vec![
                (pair.src.clone(), local_ignore_text.to_string()),
                (pair.dst.clone(), remote_ignore_text.to_string()),
            ]
        } else {
            vec![(pair.dst.clone(), local_ignore_text.to_string())]
        };

        match copy_mapping(
            item_type,
            &pair.src,
            &pair.dst,
            no_delete,
            source_ignores,
            dest_ignores,
        ) {
            Ok(out) => {
                output.push(out);
            }
            Err(e) => {
                output.push(e);
                exit_code = 1;
                break;
            }
        }
    }

    Ok((exit_code, output.join("\n")))
}

struct PosixPatternMatcher {
    root: String,
    regex: Regex,
    token_names: Vec<String>,
    literal_suffix: String,
}

impl PosixPatternMatcher {
    fn new(pattern: &str) -> Result<Self, String> {
        let first_token = pattern.find('{');
        let root = if let Some(idx) = first_token {
            let prefix = &pattern[..idx];
            let last_slash = prefix.rfind('/');
            if let Some(slash_idx) = last_slash {
                if slash_idx == 0 {
                    "/".to_string()
                } else {
                    prefix[..slash_idx].to_string()
                }
            } else {
                ".".to_string()
            }
        } else {
            let last_slash = pattern.rfind('/');
            if let Some(slash_idx) = last_slash {
                if slash_idx == 0 {
                    "/".to_string()
                } else {
                    pattern[..slash_idx].to_string()
                }
            } else {
                ".".to_string()
            }
        };

        let mut regex_str = "^".to_string();
        let mut token_names = Vec::new();
        let token_regex = Regex::new(r"\{([A-Za-z_][A-Za-z0-9_]*)\}").unwrap();
        
        let mut last_idx = 0;
        for cap in token_regex.captures_iter(pattern) {
            let m = cap.get(0).unwrap();
            regex_str.push_str(&regex::escape(&pattern[last_idx..m.start()]));
            regex_str.push_str("([^/]+)");
            token_names.push(cap.get(1).unwrap().as_str().to_string());
            last_idx = m.end();
        }
        let literal_suffix = pattern[last_idx..].to_string();
        regex_str.push_str(&regex::escape(&literal_suffix));
        regex_str.push('$');
        
        let regex = Regex::new(&regex_str).map_err(|e| e.to_string())?;
        
        Ok(Self {
            root: if root.is_empty() { ".".to_string() } else { root },
            regex,
            token_names,
            literal_suffix,
        })
    }
    
    fn match_path(&self, value: &str) -> Option<HashMap<String, String>> {
        let caps = self.regex.captures(value)?;
        let mut values = HashMap::new();
        for (i, name) in self.token_names.iter().enumerate() {
            let matched_val = caps.get(i + 1)?.as_str().to_string();
            if let Some(old_val) = values.get(name) {
                if old_val != &matched_val {
                    return None;
                }
            }
            values.insert(name.clone(), matched_val);
        }
        Some(values)
    }
}

fn remote_find_command(pattern: &str) -> Result<String, String> {
    let matcher = PosixPatternMatcher::new(pattern)?;
    let suffix = if matcher.literal_suffix.is_empty() { pattern } else { &matcher.literal_suffix };
    let last_slash = suffix.rfind('/');
    let basename = if let Some(idx) = last_slash {
        &suffix[idx+1..]
    } else {
        suffix
    };
    
    let name_pattern = if has_path_tokens(basename) { "*" } else { basename };
    Ok(format!("find {} -type f -name {} -print", shq(&matcher.root), shq(name_pattern)))
}

fn list_remote_matches(remote: &serde_json::Value, pattern: &str) -> Result<Vec<String>, String> {
    let username = remote.get("username").and_then(|v| v.as_str()).unwrap_or("");
    let host = remote.get("host").and_then(|v| v.as_str()).unwrap_or("");
    let password = remote.get("password").and_then(|v| v.as_str()).unwrap_or("");
    let port = remote.get("port").and_then(|v| v.as_i64()).unwrap_or(22);
    
    let ssh_known = ssh_known_hosts_option();
    let find_command = remote_find_command(pattern)?;
    
    let ssh_cmd = format!(
        "sshpass -e ssh -p {} -o StrictHostKeyChecking=accept-new{} {}@{} {}",
        port,
        ssh_known,
        username,
        host,
        shq(&find_command)
    );
    
    let (code, output) = run_bash_process(&ssh_cmd, password)?;
    if code == 0 {
        let paths: Vec<String> = output.lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        Ok(paths)
    } else {
        Err(if output.is_empty() { format!("SSH exited with code {}", code) } else { output })
    }
}

fn sync_ssh_exact_down(
    item: &serde_json::Value,
    remote: &serde_json::Value,
    remote_path: &str,
    local_path: &str,
    no_delete: bool,
) -> Result<(i32, String), String> {
    let username = remote.get("username").and_then(|v| v.as_str()).unwrap_or("");
    let host = remote.get("host").and_then(|v| v.as_str()).unwrap_or("");
    let password = remote.get("password").and_then(|v| v.as_str()).unwrap_or("");
    let port = remote.get("port").and_then(|v| v.as_i64()).unwrap_or(22);
    
    let remote_spec = format!("{}@{}:{}", username, host, remote_path);
    let ssh = format!(
        "sshpass -e ssh -p {} -o StrictHostKeyChecking=accept-new{}",
        port,
        ssh_known_hosts_option()
    );
    
    let mut flags = vec!["-azs".to_string(), "--human-readable".to_string(), "--itemize-changes".to_string(), "--no-o".to_string(), "--no-g".to_string()];
    
    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("file");
    if item_type == "folder" {
        if !no_delete {
            flags.push("--delete".to_string());
        }
        let local_sync_ignore = item.get("localSyncIgnore").and_then(|v| v.as_str()).unwrap_or("");
        for rule in ignore_rules(local_sync_ignore) {
            flags.push(format!("--exclude={}", shq(&rule)));
        }
    }
    
    let local = to_shell_path(local_path);
    let src = if item_type == "folder" { format!("{}/", remote_spec.trim_end_matches('/')) } else { remote_spec };
    let dst = if item_type == "folder" { format!("{}/", local.trim_end_matches('/')) } else { local };
    
    let create_dir = if item_type == "folder" {
        local_path.to_string()
    } else {
        let p = Path::new(local_path);
        p.parent().map(|parent| parent.to_string_lossy().to_string()).unwrap_or_else(|| ".".to_string())
    };
    
    if !create_dir.is_empty() && create_dir != "." {
        fs::create_dir_all(&create_dir).map_err(|e| e.to_string())?;
    }
    
    let commands = vec![
        "set -Eeuo pipefail".to_string(),
        format!("rsync {} -e {} {} {}", flags.join(" "), shq(&ssh), shq(&src), shq(&dst))
    ];
    
    let full_command = commands.join("\n");
    run_bash_process(&full_command, password)
}

fn sync_ssh_wildcard_down(
    item: &serde_json::Value,
    source: &str,
    dest: &str,
    remote: &serde_json::Value,
    dry_run: bool,
    no_delete: bool,
    values: &HashMap<String, String>,
) -> Result<(i32, String), String> {
    if !has_path_tokens(source) {
        return Ok((1, "Wildcard SSH downloads need {tokens} on the remote source side.".to_string()));
    }
    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("file");
    if item_type != "file" {
        return Ok((1, "Wildcard SSH downloads support files right now.".to_string()));
    }
    
    let remote_paths = list_remote_matches(remote, source)?;
    let matcher = PosixPatternMatcher::new(source)?;
    
    struct Pair {
        remote_path: String,
        local_path: String,
    }
    
    let mut pairs = Vec::new();
    for rp in remote_paths {
        if let Some(captured) = matcher.match_path(&rp) {
            let mut merged_values = values.clone();
            for (k, v) in captured {
                merged_values.insert(k, v);
            }
            if let Ok(local_path) = apply_path_tokens(dest, &merged_values) {
                pairs.push(Pair { remote_path: rp, local_path });
            }
        }
    }
    
    if pairs.is_empty() {
        return Ok((1, format!("No files matched: {}", source)));
    }
    
    if dry_run {
        return Ok((0, format!("Would download {} file{}.", pairs.len(), if pairs.len() == 1 { "" } else { "s" })));
    }
    
    let mut output = Vec::new();
    let mut exit_code = 0;
    
    for pair in pairs {
        let result = sync_ssh_exact_down(item, remote, &pair.remote_path, &pair.local_path, no_delete)?;
        output.push(format!("{} -> {}", pair.remote_path, pair.local_path));
        if !result.1.is_empty() {
            output.push(result.1);
        }
        if result.0 != 0 {
            exit_code = result.0;
            break;
        }
    }
    
    Ok((exit_code, output.join("\n")))
}

fn sync_ssh(
    item: &serde_json::Value,
    target: &serde_json::Value,
    remote: &serde_json::Value,
    direction: &str,
    dry_run: bool,
    no_delete: bool,
) -> Result<(i32, String), String> {
    let values = target_token_values(remote, target);
    
    let source_pattern = item.get("source").and_then(|v| v.as_str()).unwrap_or("");
    let dest_pattern = target.get("dest").and_then(|v| v.as_str()).unwrap_or("");
    
    let local = apply_known_path_tokens(source_pattern, &values);
    let remote_path = apply_known_path_tokens(dest_pattern, &values);
    
    let source = if direction == "up" { &local } else { &remote_path };
    let dest = if direction == "up" { &remote_path } else { &local };
    
    if has_path_tokens(source) || has_path_tokens(dest) {
        if direction == "down" {
            return sync_ssh_wildcard_down(item, source, dest, remote, dry_run, no_delete, &values);
        }
        return Ok((1, "Wildcard capture tokens on SSH targets are only supported for download right now.".to_string()));
    }
    
    let username = remote.get("username").and_then(|v| v.as_str()).unwrap_or("");
    let host = remote.get("host").and_then(|v| v.as_str()).unwrap_or("");
    let password = remote.get("password").and_then(|v| v.as_str()).unwrap_or("");
    let port = remote.get("port").and_then(|v| v.as_i64()).unwrap_or(22);
    
    let remote_spec = format!("{}@{}:{}", username, host, remote_path);
    let ssh = format!(
        "sshpass -e ssh -p {} -o StrictHostKeyChecking=accept-new{}",
        port,
        ssh_known_hosts_option()
    );
    
    let mut flags = vec!["-azs".to_string(), "--human-readable".to_string(), "--itemize-changes".to_string(), "--no-o".to_string(), "--no-g".to_string()];
    if dry_run {
        flags.push("--dry-run".to_string());
    }
    
    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("file");
    if item_type == "folder" {
        if !no_delete {
            flags.push("--delete".to_string());
        }
        flags.push("--exclude=.syncignore".to_string());
        
        let ignore_file = Path::new(&local).join(".syncignore");
        if ignore_file.exists() {
            flags.push(format!("--exclude-from={}", shq(&to_shell_path(&ignore_file.to_string_lossy()))));
        }
        
        let config_ignore = if direction == "up" {
            item.get("localSyncIgnore").and_then(|v| v.as_str()).unwrap_or("")
        } else {
            target.get("remoteSyncIgnore").and_then(|v| v.as_str()).unwrap_or("")
        };
        
        for rule in ignore_rules(config_ignore) {
            flags.push(format!("--exclude={}", shq(&rule)));
        }
    }
    
    let mut commands = vec!["set -Eeuo pipefail".to_string()];
    
    if direction == "up" {
        let local_source = to_shell_path(source);
        if !dry_run {
            let remote_dir = if item_type == "folder" {
                dest.trim_end_matches('/').to_string()
            } else {
                let p = Path::new(dest);
                p.parent().map(|parent| parent.to_string_lossy().to_string()).unwrap_or_else(|| ".".to_string())
            };
            commands.push(format!("{} {}@{} {}", ssh, username, host, shq(&format!("mkdir -p -- {}", shq(&remote_dir)))));
        }
        let src = if item_type == "folder" { format!("{}/", local_source.trim_end_matches('/')) } else { local_source };
        let dst = if item_type == "folder" { format!("{}/", remote_spec.trim_end_matches('/')) } else { remote_spec };
        commands.push(format!("rsync {} -e {} {} {}", flags.join(" "), shq(&ssh), shq(&src), shq(&dst)));
    } else {
        let local_dest = to_shell_path(dest);
        if !dry_run {
            let dir = if item_type == "folder" {
                local_dest.clone()
            } else {
                let p = Path::new(&local_dest);
                p.parent().map(|parent| parent.to_string_lossy().to_string()).unwrap_or_else(|| ".".to_string())
            };
            commands.push(format!("mkdir -p -- {}", shq(&dir)));
        }
        let src = if item_type == "folder" { format!("{}/", remote_spec.trim_end_matches('/')) } else { remote_spec };
        let dst = if item_type == "folder" { format!("{}/", local_dest.trim_end_matches('/')) } else { local_dest };
        commands.push(format!("rsync {} -e {} {} {}", flags.join(" "), shq(&ssh), shq(&src), shq(&dst)));
    }
    
    let full_command = commands.join("\n");
    run_bash_process(&full_command, password)
}

fn target_remote_ids(target: &serde_json::Value) -> Vec<String> {
    if let Some(arr) = target.get("remoteIds").and_then(|v| v.as_array()) {
        return arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
    }
    if let Some(s) = target.get("remoteId").and_then(|v| v.as_str()) {
        if !s.is_empty() {
            return vec![s.to_string()];
        }
    }
    Vec::new()
}

// Local sync implementation details
struct PathPair {
    src: String,
    dst: String,
}

fn expand_path_pairs(
    item_type: &str,
    src_pattern: &str,
    dst_pattern: &str,
    initial_values: &HashMap<String, String>,
) -> Result<Vec<PathPair>, String> {
    let src_resolved = apply_known_path_tokens(src_pattern, initial_values);
    let dst_resolved = apply_known_path_tokens(dst_pattern, initial_values);
    
    if !has_path_tokens(&src_resolved) && !has_path_tokens(&dst_resolved) {
        let p = Path::new(&src_resolved);
        if p.exists() {
            return Ok(vec![PathPair { src: src_resolved, dst: dst_resolved }]);
        } else {
            return Ok(vec![]);
        }
    }
    
    if !has_path_tokens(&src_resolved) {
        return Err("Wildcard mappings need {tokens} on the source side.".to_string());
    }
    
    let matcher = PathPatternMatcher::new(&src_resolved)?;
    let mut candidates = Vec::new();
    walk_candidate_paths(Path::new(&matcher.root), item_type, &mut candidates).map_err(|e| e.to_string())?;
    
    let mut pairs = Vec::new();
    for cand in candidates {
        let cand_str = cand.to_string_lossy().to_string();
        if let Some(captured_vals) = matcher.match_path(&cand_str) {
            let mut merged_vals = initial_values.clone();
            for (k, v) in captured_vals {
                merged_vals.insert(k, v);
            }
            let dst_final = apply_path_tokens(&dst_resolved, &merged_vals)?;
            pairs.push(PathPair { src: cand_str, dst: dst_final });
        }
    }
    
    Ok(pairs)
}

fn walk_candidate_paths(dir: &Path, item_type: &str, results: &mut Vec<PathBuf>) -> Result<(), std::io::Error> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if item_type == "file" && path.is_file() {
                results.push(path.clone());
            }
            if item_type == "folder" && path.is_dir() {
                results.push(path.clone());
            }
            if path.is_dir() {
                let _ = walk_candidate_paths(&path, item_type, results);
            }
        }
    }
    Ok(())
}

struct PathPatternMatcher {
    root: String,
    regex: Regex,
    token_names: Vec<String>,
}

impl PathPatternMatcher {
    fn new(pattern: &str) -> Result<Self, String> {
        let abs_pattern = fs::canonicalize(pattern)
            .unwrap_or_else(|_| PathBuf::from(pattern))
            .to_string_lossy().to_string();
            
        let first_token = abs_pattern.find('{');
        let root = if let Some(idx) = first_token {
            let prefix = &abs_pattern[..idx];
            let p = Path::new(prefix);
            if p.is_dir() {
                prefix.to_string()
            } else {
                p.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "/".to_string())
            }
        } else {
            abs_pattern.clone()
        };
        
        let mut regex_str = "^".to_string();
        let mut token_names = Vec::new();
        let token_regex = Regex::new(r"\{([A-Za-z_][A-Za-z0-9_]*)\}").unwrap();
        
        let mut last_idx = 0;
        for cap in token_regex.captures_iter(&abs_pattern) {
            let m = cap.get(0).unwrap();
            regex_str.push_str(&regex::escape(&abs_pattern[last_idx..m.start()]));
            regex_str.push_str("([^\\\\/]+)");
            token_names.push(cap.get(1).unwrap().as_str().to_string());
            last_idx = m.end();
        }
        regex_str.push_str(&regex::escape(&abs_pattern[last_idx..]));
        regex_str.push('$');
        
        let regex = if cfg!(target_os = "windows") {
            Regex::new(&format!("(?i){}", regex_str)).map_err(|e| e.to_string())?
        } else {
            Regex::new(&regex_str).map_err(|e| e.to_string())?
        };
        
        Ok(Self { root, regex, token_names })
    }
    
    fn match_path(&self, value: &str) -> Option<HashMap<String, String>> {
        let abs_value = fs::canonicalize(value)
            .unwrap_or_else(|_| PathBuf::from(value))
            .to_string_lossy().to_string();
            
        let caps = self.regex.captures(&abs_value)?;
        let mut values = HashMap::new();
        for (i, name) in self.token_names.iter().enumerate() {
            let matched_val = caps.get(i + 1)?.as_str().to_string();
            if let Some(old_val) = values.get(name) {
                if old_val != &matched_val {
                    return None;
                }
            }
            values.insert(name.clone(), matched_val);
        }
        Some(values)
    }
}

fn has_path_tokens(val: &str) -> bool {
    let re = Regex::new(r"\{[A-Za-z_][A-Za-z0-9_]*\}").unwrap();
    re.is_match(val)
}

fn apply_known_path_tokens(pattern: &str, values: &HashMap<String, String>) -> String {
    let re = Regex::new(r"\{([A-Za-z_][A-Za-z0-9_]*)\}").unwrap();
    re.replace_all(pattern, |caps: &regex::Captures| {
        let name = caps.get(1).unwrap().as_str();
        values.get(name).cloned().unwrap_or_else(|| caps.get(0).unwrap().as_str().to_string())
    }).into_owned()
}

fn apply_path_tokens(pattern: &str, values: &HashMap<String, String>) -> Result<String, String> {
    let mut err = None;
    let re = Regex::new(r"\{([A-Za-z_][A-Za-z0-9_]*)\}").unwrap();
    let result = re.replace_all(pattern, |caps: &regex::Captures| {
        let name = caps.get(1).unwrap().as_str();
        if let Some(val) = values.get(name) {
            val.clone()
        } else {
            err = Some(format!("Destination uses unknown wildcard token: {{{}}}", name));
            String::new()
        }
    }).into_owned();
    
    if let Some(e) = err {
        Err(e)
    } else {
        Ok(result)
    }
}

struct IgnoreChecker {
    regexes: Vec<Regex>,
}

fn ignore_rule_regex(rule: &str) -> Result<Regex, regex::Error> {
    let directory_only = rule.ends_with('/');
    let normalized = rule.trim_start_matches('/').trim_end_matches('/');
    let has_slash = normalized.contains('/');
    let mut pattern = String::new();
    let chars: Vec<char> = normalized.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '*' && i + 1 < chars.len() && chars[i+1] == '*' {
            pattern.push_str(".*");
            i += 2;
        } else if chars[i] == '*' {
            pattern.push_str("[^/]*");
            i += 1;
        } else if chars[i] == '?' {
            pattern.push_str("[^/]");
            i += 1;
        } else {
            pattern.push_str(&regex::escape(&chars[i].to_string()));
            i += 1;
        }
    }
    let prefix = if has_slash { "^" } else { "(^|/)" };
    let suffix = if directory_only { "(/|$)" } else { "($|/)" };
    Regex::new(&format!("{}{}{}", prefix, pattern, suffix))
}

impl IgnoreChecker {
    fn new(sources: Vec<(String, String)>) -> Result<Self, String> {
        let mut regexes = Vec::new();
        for (root_str, extra_text) in sources {
            let root = Path::new(&root_str);
            let ignore_file = root.join(".syncignore");
            let mut contents = String::new();
            if ignore_file.exists() {
                contents = fs::read_to_string(&ignore_file).unwrap_or_default();
            }
            contents.push('\n');
            contents.push_str(&extra_text);
            
            for line in contents.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Ok(re) = ignore_rule_regex(trimmed) {
                    regexes.push(re);
                }
            }
        }
        Ok(Self { regexes })
    }
    
    fn is_ignored(&self, relative_path: &str) -> bool {
        let normalized = relative_path.replace('\\', "/");
        let normalized = normalized.trim_start_matches("./").trim_start_matches('/');
        if normalized == ".syncignore" {
            return true;
        }
        self.regexes.iter().any(|re| re.is_match(normalized))
    }
}

fn copy_mapping(
    item_type: &str,
    src: &str,
    dst: &str,
    no_delete: bool,
    source_ignores: Vec<(String, String)>,
    dest_ignores: Vec<(String, String)>,
) -> Result<String, String> {
    let src_path = Path::new(src);
    let dst_path = Path::new(dst);
    
    if !src_path.exists() {
        return Err(format!("Source path does not exist: {}", src));
    }
    
    let is_file = src_path.is_file();
    if item_type == "file" {
        if !is_file {
            return Err(format!("Not a file: {}", src));
        }
        if let Some(parent) = dst_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(src_path, dst_path).map_err(|e| e.to_string())?;
        return Ok(format!("Copied: {}", dst));
    }
    
    if !src_path.is_dir() {
        return Err(format!("Not a folder: {}", src));
    }
    
    let is_ignored = IgnoreChecker::new(source_ignores)?;
    let is_dest_ignored = IgnoreChecker::new(dest_ignores)?;
    
    if no_delete {
        copy_dir_recursive(src_path, dst_path, &is_ignored, src_path).map_err(|e| e.to_string())?;
        Ok(format!("Copied folder: {}", dst))
    } else {
        mirror_dir(src_path, dst_path, &is_ignored, &is_dest_ignored, src_path, dst_path).map_err(|e| e.to_string())?;
        Ok(format!("Mirrored: {}", dst))
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path, checker: &IgnoreChecker, src_root: &Path) -> Result<(), std::io::Error> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let entry_path = entry.path();
        let rel_path = entry_path.strip_prefix(src_root).unwrap_or(&entry_path);
        let rel_str = rel_path.to_string_lossy();
        
        if checker.is_ignored(&rel_str) {
            continue;
        }
        
        let dest_path = dst.join(entry.file_name());
        if entry_path.is_dir() {
            copy_dir_recursive(&entry_path, &dest_path, checker, src_root)?;
        } else {
            fs::copy(&entry_path, &dest_path)?;
        }
    }
    Ok(())
}

fn mirror_dir(
    src: &Path,
    dst: &Path,
    checker: &IgnoreChecker,
    dest_checker: &IgnoreChecker,
    src_root: &Path,
    dst_root: &Path,
) -> Result<(), std::io::Error> {
    fs::create_dir_all(dst)?;
    let mut src_names = std::collections::HashSet::new();
    
    if src.exists() {
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let entry_path = entry.path();
            let rel_path = entry_path.strip_prefix(src_root).unwrap_or(&entry_path);
            let rel_str = rel_path.to_string_lossy();
            
            if checker.is_ignored(&rel_str) {
                continue;
            }
            
            let file_name = entry.file_name();
            let file_name_str = file_name.to_string_lossy().into_owned();
            src_names.insert(file_name_str.clone());
            
            let dest_path = dst.join(&file_name);
            let dest_rel_path = dest_path.strip_prefix(dst_root).unwrap_or(&dest_path);
            let dest_rel_str = dest_rel_path.to_string_lossy();
            
            if dest_checker.is_ignored(&dest_rel_str) {
                continue;
            }
            
            if entry_path.is_dir() {
                mirror_dir(&entry_path, &dest_path, checker, dest_checker, src_root, dst_root)?;
            } else {
                if let Some(parent) = dest_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(&entry_path, &dest_path)?;
            }
        }
    }
    
    if dst.exists() {
        for entry in fs::read_dir(dst)? {
            let entry = entry?;
            let entry_path = entry.path();
            let file_name = entry.file_name();
            let file_name_str = file_name.to_string_lossy();
            
            let dest_rel_path = entry_path.strip_prefix(dst_root).unwrap_or(&entry_path);
            let dest_rel_str = dest_rel_path.to_string_lossy();
            
            if dest_checker.is_ignored(&dest_rel_str) {
                continue;
            }
            
            if !src_names.contains(&*file_name_str) {
                if entry_path.is_dir() {
                    fs::remove_dir_all(&entry_path)?;
                } else {
                    fs::remove_file(&entry_path)?;
                }
            }
        }
    }
    
    Ok(())
}

// =========================================================================
// Interactive Terminal Manager Commands
// =========================================================================

fn merge_terminal_output(previous: &str, text: &str) -> String {
    let base = if has_clear_screen(text) {
        ""
    } else {
        previous
    };
    let combined = format!("{}{}", base, text);
    let cleaned = clean_terminal_output(&combined);
    const MAX_OUTPUT: usize = 80_000;
    if cleaned.len() > MAX_OUTPUT {
        cleaned[cleaned.len() - MAX_OUTPUT..].to_string()
    } else {
        cleaned
    }
}

fn has_clear_screen(text: &str) -> bool {
    let re = Regex::new(r"\x1b\[(?:2J|3J|H\x1b\[2J|2J\x1b\[H)").unwrap();
    re.is_match(text)
}

fn clean_terminal_output(text: &str) -> String {
    let re_ansi1 = Regex::new(r"\x1b\][^\x07]*(?:\x07|\x1b\\)").unwrap();
    let re_ansi2 = Regex::new(r"\x1b\[\?2004[hl]").unwrap();
    let re_ansi3 = Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").unwrap();
    
    let step1 = re_ansi1.replace_all(text, "");
    let step2 = re_ansi2.replace_all(&step1, "");
    let step3 = re_ansi3.replace_all(&step2, "");
    
    let step4 = step3.replace("\r\n", "\n").replace('\r', "\n").replace('\x7f', "\x08");
    
    let re_ctrl = Regex::new(r"[\x00-\x06\x07\x0e-\x1f]").unwrap();
    let step5 = re_ctrl.replace_all(&step4, "");
    
    apply_backspaces(&step5)
}

fn apply_backspaces(text: &str) -> String {
    let mut out = Vec::new();
    for c in text.chars() {
        if c == '\x08' {
            out.pop();
        } else {
            out.push(c);
        }
    }
    out.into_iter().collect()
}

struct TerminalCommandSpec {
    file: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    banner: String,
}

fn get_terminal_command(remote: &serde_json::Value) -> Result<TerminalCommandSpec, String> {
    let bash = env::var("SYNC_GUI_BASH")
        .unwrap_or_else(|_| if cfg!(target_os = "windows") { "C:\\msys64\\usr\\bin\\bash.exe".to_string() } else { "bash".to_string() });
    
    let kind = remote.get("kind").and_then(|v| v.as_str()).unwrap_or("local");
    
    if kind == "ssh" {
        let host = remote.get("host").and_then(|v| v.as_str()).unwrap_or("");
        let username = remote.get("username").and_then(|v| v.as_str()).unwrap_or("");
        let password = remote.get("password").and_then(|v| v.as_str()).unwrap_or("");
        let port = remote.get("port").and_then(|v| v.as_i64()).unwrap_or(22);
        
        if host.is_empty() || username.is_empty() {
            return Err("SSH remote needs host and username.".to_string());
        }
        
        let sshpass_prefix = if !password.is_empty() { "sshpass -e " } else { "" };
        let known_hosts = ssh_known_hosts_option();
        
        let ssh_cmd = format!(
            "{}ssh -tt -p {} -o StrictHostKeyChecking=accept-new{}{}@{} {}",
            sshpass_prefix,
            shq(&port.to_string()),
            known_hosts,
            username,
            host,
            shq("stty erase ^? 2>/dev/null; exec \"${SHELL:-/bin/bash}\" -l")
        );
        
        let mut env_map = HashMap::new();
        env_map.insert("SSHPASS".to_string(), password.to_string());
        env_map.insert("TERM".to_string(), "xterm".to_string());
        
        let remote_name = remote.get("name").or_else(|| remote.get("host")).and_then(|v| v.as_str()).unwrap_or("");
        
        Ok(TerminalCommandSpec {
            file: bash,
            args: vec!["-lc".to_string(), format!("PATH=/usr/bin:$PATH\n{}", ssh_cmd)],
            env: env_map,
            banner: format!("Connecting to {}...\n", remote_name),
        })
    } else {
        let root = remote.get("root").or_else(|| remote.get("path")).and_then(|v| v.as_str()).unwrap_or("");
        if root.is_empty() {
            return Err("Local remote has no root path.".to_string());
        }
        
        let cwd = fs::canonicalize(root)
            .map_err(|e| format!("Invalid directory {}: {}", root, e))?
            .to_string_lossy()
            .to_string();
            
        let shell_exec = "stty erase ^? 2>/dev/null; exec \"${SHELL:-bash}\"";
        let mut env_map = HashMap::new();
        env_map.insert("TERM".to_string(), "xterm".to_string());
        
        Ok(TerminalCommandSpec {
            file: bash,
            args: vec!["-lc".to_string(), format!("cd -- {}\n{}", shq(&to_shell_path(&cwd)), shell_exec)],
            env: env_map,
            banner: format!("Opened {}\n", cwd),
        })
    }
}

#[tauri::command]
async fn start_terminal_session(
    state: State<'_, AppState>,
    remote_id: String,
) -> Result<TerminalSnapshot, String> {
    let config = read_config()?;
    let remotes = config.get("remotes").and_then(|v| v.as_array()).ok_or("No remotes configured")?;
    let remote = remotes.iter().find(|r| r.get("id").and_then(|v| v.as_str()) == Some(&remote_id))
        .ok_or_else(|| format!("Remote not found: {}", remote_id))?;

    let id = uuid::Uuid::new_v4().to_string();
    let name = remote.get("name")
        .or_else(|| remote.get("host"))
        .and_then(|v| v.as_str())
        .unwrap_or("Terminal").to_string();

    let spec = get_terminal_command(remote)?;

    let output = Arc::new(Mutex::new(spec.banner.clone()));
    let status_session = Arc::new(Mutex::new("running".to_string()));

    let mut cmd = TokioCommand::new(&spec.file);
    cmd.args(&spec.args)
       .stdin(Stdio::piped())
       .stdout(Stdio::piped())
       .stderr(Stdio::piped());
       
    for (k, v) in env::vars() {
        if k != "SSHPASS" {
            cmd.env(k, v);
        }
    }
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let mut stdin = child.stdin.take().ok_or("Failed to open stdin")?;
    let mut stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let mut stderr = child.stderr.take().ok_or("Failed to open stderr")?;

    let (stdin_tx, mut stdin_rx) = tokio::sync::mpsc::channel::<String>(100);
    
    let output_stdout = Arc::clone(&output);
    let output_stderr = Arc::clone(&output);
    
    let status_stdout = Arc::clone(&status_session);
    let status_stderr = Arc::clone(&status_session);
    let status_stdin = Arc::clone(&status_session);
    
    // Write to stdin task
    let stdin_task = tokio::spawn(async move {
        while let Some(input) = stdin_rx.recv().await {
            if *status_stdin.lock().unwrap() != "running" {
                break;
            }
            let _ = stdin.write_all(input.as_bytes()).await;
            let _ = stdin.flush().await;
        }
    });

    // Read stdout task
    let stdout_task = tokio::spawn(async move {
        let mut buffer = [0; 4096];
        loop {
            match stdout.read(&mut buffer).await {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buffer[..n]);
                    let mut out = output_stdout.lock().unwrap();
                    *out = merge_terminal_output(&out, &text);
                }
                Err(_) => break,
            }
        }
        let mut status = status_stdout.lock().unwrap();
        if *status == "running" {
            *status = "closed".to_string();
        }
    });

    // Read stderr task
    let stderr_task = tokio::spawn(async move {
        let mut buffer = [0; 4096];
        loop {
            match stderr.read(&mut buffer).await {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buffer[..n]);
                    let mut out = output_stderr.lock().unwrap();
                    *out = merge_terminal_output(&out, &text);
                }
                Err(_) => break,
            }
        }
        let mut status = status_stderr.lock().unwrap();
        if *status == "running" {
            *status = "closed".to_string();
        }
    });

    let child_session_id = id.clone();
    let child_output = Arc::clone(&output);
    let child_status = Arc::clone(&status_session);
    let app_state_clone = Arc::clone(&state.terminals);
    
    // Child monitor task
    let child_task = tokio::spawn(async move {
        let code = match child.wait().await {
            Ok(status) => status.code().unwrap_or(0),
            Err(_) => 1,
        };
        let mut status = child_status.lock().unwrap();
        *status = if code == 0 { "closed".to_string() } else { "failed".to_string() };
        
        let mut out = child_output.lock().unwrap();
        out.push_str(&format!("\n[session exited with code {}]\n", code));
        
        let mut terms = app_state_clone.lock().unwrap();
        terms.remove(&child_session_id);
    });

    let abort_handle = tokio::spawn(async move {
        let _ = tokio::join!(stdout_task, stderr_task, stdin_task, child_task);
    }).abort_handle();

    let created_at = Utc::now().timestamp_millis();
    let session = TerminalSession {
        id: id.clone(),
        name: name.clone(),
        status: status_session,
        output: Arc::clone(&output),
        stdin_tx,
        abort_handle,
        created_at,
    };

    let snapshot = TerminalSnapshot {
        id: id.clone(),
        name,
        status: "running".to_string(),
        output: output.lock().unwrap().clone(),
        created_at,
    };

    state.terminals.lock().unwrap().insert(id, session);
    Ok(snapshot)
}

#[tauri::command]
fn get_terminal_session(state: State<'_, AppState>, id: String) -> Result<TerminalSnapshot, String> {
    let terminals = state.terminals.lock().unwrap();
    let session = terminals.get(&id).ok_or_else(|| format!("Session not found: {}", id))?;
    
    let status = {
        let guard = session.status.lock().unwrap();
        guard.clone()
    };
    let output = {
        let guard = session.output.lock().unwrap();
        guard.clone()
    };
    
    Ok(TerminalSnapshot {
        id: session.id.clone(),
        name: session.name.clone(),
        status,
        output,
        created_at: session.created_at,
    })
}

#[tauri::command]
async fn write_terminal_input(
    state: State<'_, AppState>,
    id: String,
    input: String,
) -> Result<TerminalSnapshot, String> {
    let stdin_tx = {
        let terminals = state.terminals.lock().unwrap();
        let session = terminals.get(&id).ok_or_else(|| format!("Session not found: {}", id))?;
        if *session.status.lock().unwrap() != "running" {
            return Err("Terminal session is not running.".to_string());
        }
        session.stdin_tx.clone()
    };

    let _ = stdin_tx.send(input).await;
    
    // Return latest snapshot
    get_terminal_session(state, id)
}

#[tauri::command]
fn close_terminal_session(state: State<'_, AppState>, id: String) -> Result<TerminalSnapshot, String> {
    let mut terminals = state.terminals.lock().unwrap();
    let session = terminals.remove(&id).ok_or_else(|| format!("Session not found: {}", id))?;
    
    *session.status.lock().unwrap() = "closed".to_string();
    session.abort_handle.abort();

    let output = {
        let guard = session.output.lock().unwrap();
        guard.clone()
    };

    Ok(TerminalSnapshot {
        id: session.id,
        name: session.name,
        status: "closed".to_string(),
        output,
        created_at: session.created_at,
    })
}

// =========================================================================
// Configuration Import & Export Commands
// =========================================================================

#[tauri::command]
fn export_config() -> Result<serde_json::Value, String> {
    read_config()
}

#[tauri::command]
fn analyze_import(existing: serde_json::Value, data: serde_json::Value) -> Result<serde_json::Value, String> {
    let existing_remotes = existing.get("remotes").and_then(|v| v.as_array());
    let existing_projects = existing.get("projects").and_then(|v| v.as_array());
    let existing_items = existing.get("items").and_then(|v| v.as_array());
    
    let import_remotes = data.get("remotes").and_then(|v| v.as_array());
    let import_projects = data.get("projects").and_then(|v| v.as_array());
    let import_items = data.get("items").and_then(|v| v.as_array());
    
    let mut remotes_analyzed = Vec::new();
    let mut projects_analyzed = Vec::new();
    let mut items_analyzed = Vec::new();
    
    let mut remotes_new = 0;
    let mut remotes_conflict = 0;
    let mut projects_new = 0;
    let mut projects_conflict = 0;
    let mut items_new = 0;
    let mut items_conflict = 0;
    
    if let Some(arr) = import_remotes {
        for (i, r) in arr.iter().enumerate() {
            let name = r.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let existing_r = existing_remotes.and_then(|arr| {
                arr.iter().find(|er| er.get("name").and_then(|v| v.as_str()) == Some(name))
            });
            let conflict = existing_r.is_some();
            if conflict { remotes_conflict += 1; } else { remotes_new += 1; }
            remotes_analyzed.push(serde_json::json!({
                "idx": i,
                "imported": r,
                "existing": existing_r,
                "conflict": conflict
            }));
        }
    }
    
    if let Some(arr) = import_projects {
        for (i, p) in arr.iter().enumerate() {
            let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let existing_p = existing_projects.and_then(|arr| {
                arr.iter().find(|ep| ep.get("name").and_then(|v| v.as_str()) == Some(name))
            });
            
            let remote_id = p.get("remoteId").and_then(|v| v.as_str()).unwrap_or("");
            let remote_name = import_remotes.and_then(|arr| {
                arr.iter().find(|r| r.get("id").and_then(|v| v.as_str()) == Some(remote_id))
                    .and_then(|r| r.get("name").and_then(|v| v.as_str()))
            }).unwrap_or("");
            
            let conflict = existing_p.is_some();
            if conflict { projects_conflict += 1; } else { projects_new += 1; }
            projects_analyzed.push(serde_json::json!({
                "idx": i,
                "imported": p,
                "existing": existing_p,
                "conflict": conflict,
                "remoteName": remote_name
            }));
        }
    }
    
    if let Some(arr) = import_items {
        for (i, item) in arr.iter().enumerate() {
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let project_id = item.get("projectId").and_then(|v| v.as_str()).unwrap_or("");
            
            let import_proj = import_projects.and_then(|arr| {
                arr.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(project_id))
            });
            let proj_name = import_proj.and_then(|p| p.get("name").and_then(|v| v.as_str())).unwrap_or("?");
            
            let existing_item = existing_projects.and_then(|parr| {
                parr.iter().find(|ep| ep.get("name").and_then(|v| v.as_str()) == Some(proj_name))
            }).and_then(|ep| {
                let ep_id = ep.get("id").and_then(|v| v.as_str())?;
                existing_items.and_then(|iarr| {
                    iarr.iter().find(|ei| {
                        ei.get("name").and_then(|v| v.as_str()) == Some(name)
                            && ei.get("projectId").and_then(|v| v.as_str()) == Some(ep_id)
                    }).cloned()
                })
            });
            
            let conflict = existing_item.is_some();
            if conflict { items_conflict += 1; } else { items_new += 1; }
            items_analyzed.push(serde_json::json!({
                "idx": i,
                "imported": item,
                "existing": existing_item,
                "conflict": conflict,
                "projectName": proj_name
            }));
        }
    }
    
    Ok(serde_json::json!({
        "summary": {
            "remotesNew": remotes_new,
            "remotesConflict": remotes_conflict,
            "projectsNew": projects_new,
            "projectsConflict": projects_conflict,
            "itemsNew": items_new,
            "itemsConflict": items_conflict
        },
        "remotes": remotes_analyzed,
        "projects": projects_analyzed,
        "items": items_analyzed
    }))
}

fn next_id(prefix: &str, arr: &serde_json::Value) -> String {
    let max = arr.as_array().map(|a| {
        a.iter().filter_map(|e| {
            e.get("id").and_then(|v| v.as_str())
                .and_then(|id| id.strip_prefix(prefix))
                .and_then(|num| num.parse::<i64>().ok())
        }).max().unwrap_or(-1)
    }).unwrap_or(-1);
    format!("{}{}", prefix, max + 1)
}

#[tauri::command]
fn apply_import(mut existing: serde_json::Value, data: serde_json::Value, resolutions: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut remap_remote_id = HashMap::new();
    let mut remap_project_id = HashMap::new();
    let mut remap_category_id = HashMap::new();

    // Ensure structures are initialized
    if existing.get("remotes").is_none() { existing.as_object_mut().unwrap().insert("remotes".to_string(), serde_json::json!([])); }
    if existing.get("projects").is_none() { existing.as_object_mut().unwrap().insert("projects".to_string(), serde_json::json!([])); }
    if existing.get("categories").is_none() { existing.as_object_mut().unwrap().insert("categories".to_string(), serde_json::json!([])); }
    if existing.get("items").is_none() { existing.as_object_mut().unwrap().insert("items".to_string(), serde_json::json!([])); }

    // Remotes
    if let Some(remotes) = data.get("remotes").and_then(|v| v.as_array()) {
        let resolutions_r = resolutions.get("remotes").and_then(|v| v.as_object());
        for r in remotes {
            let r_id = r.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let r_name = r.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let res = resolutions_r.and_then(|obj| obj.get(r_name));
            
            let action = res.and_then(|v| v.get("action").and_then(|s| s.as_str())).unwrap_or("");
            if action == "skip" { continue; }
            
            let mut copy = r.clone();
            if action == "rename" {
                let new_name = match res.and_then(|v| v.get("newName").and_then(|s| s.as_str())) {
                    Some(name) => name.to_string(),
                    None => r_name.to_string() + " (imported)",
                };
                copy.as_object_mut().unwrap().insert("name".to_string(), serde_json::json!(new_name));
            }
            
            if action == "replace" {
                if let Some(existing_remotes) = existing.get_mut("remotes").and_then(|v| v.as_array_mut()) {
                    if let Some(idx) = existing_remotes.iter().position(|er| er.get("name").and_then(|v| v.as_str()) == Some(r_name)) {
                        let existing_id = existing_remotes[idx].get("id").unwrap().clone();
                        copy.as_object_mut().unwrap().insert("id".to_string(), existing_id.clone());
                        existing_remotes[idx] = copy;
                        remap_remote_id.insert(r_id.to_string(), existing_id.as_str().unwrap().to_string());
                        continue;
                    }
                }
            }
            
            let next_r_id = next_id("r-", existing.get("remotes").unwrap());
            copy.as_object_mut().unwrap().insert("id".to_string(), serde_json::json!(next_r_id));
            existing.get_mut("remotes").unwrap().as_array_mut().unwrap().push(copy);
            remap_remote_id.insert(r_id.to_string(), next_r_id);
        }
    }

    // Projects
    if let Some(projects) = data.get("projects").and_then(|v| v.as_array()) {
        let resolutions_p = resolutions.get("projects").and_then(|v| v.as_object());
        for p in projects {
            let p_id = p.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let p_name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let res = resolutions_p.and_then(|obj| obj.get(p_name));
            
            let action = res.and_then(|v| v.get("action").and_then(|s| s.as_str())).unwrap_or("");
            if action == "skip" { continue; }
            
            let mut copy = p.clone();
            let remote_id = p.get("remoteId").and_then(|v| v.as_str()).unwrap_or("");
            let mapped_remote_id = remap_remote_id.get(remote_id).cloned().unwrap_or(remote_id.to_string());
            copy.as_object_mut().unwrap().insert("remoteId".to_string(), serde_json::json!(mapped_remote_id));

            if action == "rename" {
                let new_name = match res.and_then(|v| v.get("newName").and_then(|s| s.as_str())) {
                    Some(name) => name.to_string(),
                    None => p_name.to_string() + " (imported)",
                };
                copy.as_object_mut().unwrap().insert("name".to_string(), serde_json::json!(new_name));
            }
            
            if action == "replace" {
                if let Some(existing_projects) = existing.get_mut("projects").and_then(|v| v.as_array_mut()) {
                    if let Some(idx) = existing_projects.iter().position(|ep| ep.get("name").and_then(|v| v.as_str()) == Some(p_name)) {
                        let existing_id = existing_projects[idx].get("id").unwrap().clone();
                        copy.as_object_mut().unwrap().insert("id".to_string(), existing_id.clone());
                        existing_projects[idx] = copy;
                        remap_project_id.insert(p_id.to_string(), existing_id.as_str().unwrap().to_string());
                        continue;
                    }
                }
            }
            
            let next_p_id = next_id("p-", existing.get("projects").unwrap());
            copy.as_object_mut().unwrap().insert("id".to_string(), serde_json::json!(next_p_id));
            existing.get_mut("projects").unwrap().as_array_mut().unwrap().push(copy);
            remap_project_id.insert(p_id.to_string(), next_p_id);
        }
    }

    // Categories
    let mut imported_categories = Vec::new();
    if let Some(categories) = data.get("categories").and_then(|v| v.as_array()) {
        for category in categories {
            let cat_id = category.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let proj_id = category.get("projectId").and_then(|v| v.as_str()).unwrap_or("");
            let mapped_proj_id = remap_project_id.get(proj_id).cloned().unwrap_or(proj_id.to_string());
            
            let next_c_id = next_id("c-", existing.get("categories").unwrap());
            let mut copy = category.clone();
            copy.as_object_mut().unwrap().insert("id".to_string(), serde_json::json!(next_c_id));
            copy.as_object_mut().unwrap().insert("projectId".to_string(), serde_json::json!(mapped_proj_id));
            
            existing.get_mut("categories").unwrap().as_array_mut().unwrap().push(copy.clone());
            imported_categories.push(copy);
            remap_category_id.insert(cat_id.to_string(), next_c_id);
        }
    }
    
    // Remap parent IDs on imported categories
    if let Some(existing_categories) = existing.get_mut("categories").and_then(|v| v.as_array_mut()) {
        for ec in existing_categories {
            if let Some(parent_id) = ec.get("parentId").and_then(|v| v.as_str()) {
                if let Some(mapped_parent) = remap_category_id.get(parent_id) {
                    ec.as_object_mut().unwrap().insert("parentId".to_string(), serde_json::json!(mapped_parent));
                }
            }
        }
    }

    // Items
    if let Some(items) = data.get("items").and_then(|v| v.as_array()) {
        let resolutions_i = resolutions.get("items").and_then(|v| v.as_object());
        for item in items {
            let item_name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let project_id = item.get("projectId").and_then(|v| v.as_str()).unwrap_or("");
            
            let import_proj = data.get("projects").and_then(|v| v.as_array()).and_then(|arr| {
                arr.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(project_id))
            });
            let proj_name = import_proj.and_then(|p| p.get("name").and_then(|v| v.as_str())).unwrap_or("?");
            
            let key = format!("{}@{}", item_name, proj_name);
            let res = resolutions_i.and_then(|obj| obj.get(&key));
            
            let action = res.and_then(|v| v.get("action").and_then(|s| s.as_str())).unwrap_or("");
            if action == "skip" { continue; }
            
            let mapped_proj_id = remap_project_id.get(project_id).cloned().unwrap_or(project_id.to_string());
            let category_id = item.get("categoryId").and_then(|v| v.as_str()).unwrap_or("");
            let mapped_cat_id = remap_category_id.get(category_id).cloned().unwrap_or(category_id.to_string());
            
            let mut copy = item.clone();
            copy.as_object_mut().unwrap().insert("projectId".to_string(), serde_json::json!(mapped_proj_id));
            copy.as_object_mut().unwrap().insert("categoryId".to_string(), serde_json::json!(mapped_cat_id));
            
            if action == "rename" {
                let new_name = match res.and_then(|v| v.get("newName").and_then(|s| s.as_str())) {
                    Some(name) => name.to_string(),
                    None => item_name.to_string() + " (imported)",
                };
                copy.as_object_mut().unwrap().insert("name".to_string(), serde_json::json!(new_name));
            }
            
            if action == "replace" || action.is_empty() {
                if let Some(existing_items) = existing.get_mut("items").and_then(|v| v.as_array_mut()) {
                    if let Some(idx) = existing_items.iter().position(|ei| {
                        ei.get("name").and_then(|v| v.as_str()) == Some(item_name)
                            && ei.get("projectId").and_then(|v| v.as_str()) == Some(&mapped_proj_id)
                    }) {
                        let existing_id = existing_items[idx].get("id").unwrap().clone();
                        copy.as_object_mut().unwrap().insert("id".to_string(), existing_id);
                        existing_items[idx] = copy;
                        continue;
                    }
                }
            }
            
            let next_i_id = next_id("i-", existing.get("items").unwrap());
            copy.as_object_mut().unwrap().insert("id".to_string(), serde_json::json!(next_i_id));
            existing.get_mut("items").unwrap().as_array_mut().unwrap().push(copy);
        }
    }

    write_config_internal(&existing)?;
    Ok(existing)
}

// =========================================================================
// Main Entry Point
// =========================================================================

fn main() {
    let state = AppState {
        jobs: Arc::new(Mutex::new(Vec::new())),
        terminals: Arc::new(Mutex::new(HashMap::new())),
        next_job_id: Arc::new(Mutex::new(1)),
    };

    tauri::Builder::default()
        .setup(|app| {
            init_env(&app.handle());
            Ok(())
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            check_dependencies,
            check_remote_connection,
            start_sync_job,
            get_sync_history,
            get_sync_job,
            clear_sync_history,
            start_terminal_session,
            get_terminal_session,
            write_terminal_input,
            close_terminal_session,
            export_config,
            analyze_import,
            apply_import
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
