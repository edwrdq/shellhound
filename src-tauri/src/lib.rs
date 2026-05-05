use serde_json::Value;
use std::{fs, io::ErrorKind, path::PathBuf, process::Stdio};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

fn workspace_root() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|error| error.to_string())?;

    if cwd.file_name().is_some_and(|name| name == "src-tauri") {
        return cwd
            .parent()
            .map(PathBuf::from)
            .ok_or_else(|| "Unable to resolve workspace root".to_string());
    }

    if cwd.join("data").exists() || cwd.join("scraper").exists() {
        return Ok(cwd);
    }

    if let Some(parent) = cwd.parent() {
        if parent.join("data").exists() || parent.join("scraper").exists() {
            return Ok(parent.to_path_buf());
        }
    }

    Ok(cwd)
}

fn data_file(file_name: &str) -> Result<PathBuf, String> {
    Ok(workspace_root()?.join("data").join(file_name))
}

fn read_json_file(file_name: &str) -> Result<Value, String> {
    let path = data_file(file_name)?;

    match fs::read_to_string(&path) {
        Ok(contents) => {
            if contents.trim().is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            serde_json::from_str(&contents)
                .map_err(|error| format!("Invalid JSON in {}: {error}", path.display()))
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Value::Array(Vec::new())),
        Err(error) => Err(format!("Unable to read {}: {error}", path.display())),
    }
}

fn write_json_string(file_name: &str, data: &str) -> Result<(), String> {
    let path = data_file(file_name)?;
    let directory = path
        .parent()
        .ok_or_else(|| format!("Unable to resolve parent for {}", path.display()))?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create {}: {error}", directory.display()))?;

    let parsed: Value = serde_json::from_str(data)
        .map_err(|error| format!("Invalid JSON payload for {file_name}: {error}"))?;
    let body = serde_json::to_string_pretty(&parsed).map_err(|error| error.to_string())?;
    fs::write(&path, format!("{body}\n"))
        .map_err(|error| format!("Unable to write {}: {error}", path.display()))
}

#[tauri::command]
fn read_entities() -> Result<Value, String> {
    read_json_file("entities.json")
}

#[tauri::command]
fn write_entities(data: String) -> Result<(), String> {
    write_json_string("entities.json", &data)
}

#[tauri::command]
fn read_relationships() -> Result<Value, String> {
    read_json_file("relationships.json")
}

#[tauri::command]
fn write_relationships(data: String) -> Result<(), String> {
    write_json_string("relationships.json", &data)
}

#[tauri::command]
fn read_financials() -> Result<Value, String> {
    read_json_file("financials.json")
}

#[tauri::command]
fn write_financials(data: String) -> Result<(), String> {
    write_json_string("financials.json", &data)
}

#[tauri::command]
fn clear_data() -> Result<(), String> {
    write_json_string("entities.json", "[]")?;
    write_json_string("relationships.json", "[]")?;
    write_json_string("financials.json", "[]")?;
    Ok(())
}

async fn stream_command(
    app: &AppHandle,
    mut cmd: TokioCommand,
    label: &str,
) -> Result<i32, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("Unable to spawn {label}: {error}"))?;

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app.emit("scraper-log", line);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app.emit("scraper-log", format!("[stderr] {line}"));
            }
        });
    }

    let status = child
        .wait()
        .await
        .map_err(|error| format!("Wait failed: {error}"))?;
    Ok(status.code().unwrap_or(-1))
}

#[tauri::command]
async fn run_scraper(
    seed: String,
    seed_type: String,
    depth: u32,
    app: AppHandle,
) -> Result<(), String> {
    let seed = seed.trim().to_string();
    if seed.is_empty() {
        return Err("Seed is required".to_string());
    }

    let root = workspace_root()?;
    let scraper_directory = root.join("scraper");
    let script = scraper_directory.join("main.py");
    if !script.exists() {
        return Err(format!("Scraper script not found at {}", script.display()));
    }

    // Ensure venv
    if !scraper_directory.join(".venv").exists() {
        let _ = app.emit("scraper-log", "Running uv sync...".to_string());
        let mut sync_cmd = TokioCommand::new("uv");
        sync_cmd.arg("sync").current_dir(&scraper_directory);
        let code = stream_command(&app, sync_cmd, "uv sync").await?;
        if code != 0 {
            let _ = app.emit("scraper-done", code);
            return Err(format!("uv sync exited with code {code}"));
        }
    }

    let _ = app.emit(
        "scraper-log",
        format!("Starting scraper: seed={seed} type={seed_type} depth={depth}"),
    );

    let mut cmd = TokioCommand::new("uv");
    cmd.arg("run")
        .arg("python")
        .arg("main.py")
        .arg("--seed")
        .arg(&seed)
        .arg("--type")
        .arg(&seed_type)
        .arg("--depth")
        .arg(depth.to_string())
        .current_dir(&scraper_directory)
        .env("PYTHONUNBUFFERED", "1");

    let code = stream_command(&app, cmd, "scraper").await?;
    let _ = app.emit("scraper-done", code);
    if code != 0 {
        return Err(format!("Scraper exited with code {code}"));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_entities,
            write_entities,
            read_relationships,
            write_relationships,
            read_financials,
            write_financials,
            run_scraper,
            clear_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
