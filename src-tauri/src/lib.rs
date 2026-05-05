use serde_json::Value;
use std::{
    fs,
    io::ErrorKind,
    path::PathBuf,
    process::{Command, Output},
};

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

fn write_json_file(file_name: &str, data: Value) -> Result<(), String> {
    let path = data_file(file_name)?;
    let directory = path
        .parent()
        .ok_or_else(|| format!("Unable to resolve parent for {}", path.display()))?;

    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create {}: {error}", directory.display()))?;

    let body = serde_json::to_string_pretty(&data).map_err(|error| error.to_string())?;
    fs::write(&path, format!("{body}\n"))
        .map_err(|error| format!("Unable to write {}: {error}", path.display()))
}

#[tauri::command]
fn read_entities() -> Result<Value, String> {
    read_json_file("entities.json")
}

#[tauri::command]
fn write_entities(data: Value) -> Result<(), String> {
    write_json_file("entities.json", data)
}

#[tauri::command]
fn read_relationships() -> Result<Value, String> {
    read_json_file("relationships.json")
}

#[tauri::command]
fn write_relationships(data: Value) -> Result<(), String> {
    write_json_file("relationships.json", data)
}

#[tauri::command]
fn read_financials() -> Result<Value, String> {
    read_json_file("financials.json")
}

#[tauri::command]
fn write_financials(data: Value) -> Result<(), String> {
    write_json_file("financials.json", data)
}

fn scraper_dir() -> Result<PathBuf, String> {
    Ok(workspace_root()?.join("scraper"))
}

fn ensure_scraper_environment(scraper_directory: &PathBuf) -> Result<(), String> {
    if scraper_directory.join(".venv").exists() {
        return Ok(());
    }

    let output = Command::new("uv")
        .arg("sync")
        .current_dir(scraper_directory)
        .output()
        .map_err(|error| format!("Unable to run uv sync: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(format!(
        "uv sync failed with {}: {}{}",
        output.status, stderr, stdout
    ))
}

fn invoke_python(
    scraper_directory: &PathBuf,
    script: &PathBuf,
    seed: &str,
    scraper_type: &str,
) -> Result<Output, String> {
    let root = workspace_root()?;
    let script_arg = script.strip_prefix(&root).unwrap_or(script.as_path());

    Command::new("uv")
        .arg("run")
        .arg("python")
        .arg(script_arg)
        .arg("--seed")
        .arg(seed)
        .arg("--scraper-type")
        .arg(scraper_type)
        .arg("--json")
        .env("UV_PROJECT", scraper_directory)
        .current_dir(root)
        .output()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn run_scraper(seed: String, scraper_type: String) -> Result<Value, String> {
    let seed = seed.trim();
    if seed.is_empty() {
        return Err("Seed is required".to_string());
    }

    let scraper_directory = scraper_dir()?;
    let script = scraper_directory.join("crawler.py");
    if !script.exists() {
        return Err(format!("Scraper script not found at {}", script.display()));
    }

    ensure_scraper_environment(&scraper_directory)?;

    match invoke_python(&scraper_directory, &script, seed, &scraper_type) {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            serde_json::from_str(&stdout)
                .map_err(|error| format!("Scraper returned invalid JSON: {error}"))
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            Err(format!(
                "uv run python exited with {}: {}{}",
                output.status, stderr, stdout
            ))
        }
        Err(error) => Err(format!("uv run python: {error}")),
    }
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
            run_scraper
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
