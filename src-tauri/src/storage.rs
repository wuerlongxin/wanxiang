use std::{
    borrow::Cow,
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Cursor, Read, Seek, Write},
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD as BASE64_PADDED, STANDARD_NO_PAD as BASE64_NO_PAD},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::{error::CommandError, gameplay::validate_card_gameplay};

const STORAGE_SCHEMA_VERSION: u32 = 1;
const MAX_DECKS: usize = 128;
const MAX_CARDS_PER_DECK: usize = 64;
const MAX_PERSISTED_DECK_BYTES: usize = 24 * 1024 * 1024;
const MAX_PERSISTED_LIBRARY_BYTES: usize = 96 * 1024 * 1024;
const MAX_HYDRATED_DECK_BYTES: usize = 24 * 1024 * 1024;
const MAX_HYDRATED_LIBRARY_BYTES: usize = 64 * 1024 * 1024;
const MAX_ASSET_BYTES: usize = 4 * 1024 * 1024;
const MAX_ASSET_STORE_BYTES: usize = 64 * 1024 * 1024;
const MAX_RASTER_DIMENSION: u32 = 4_096;
const MAX_RASTER_PIXELS: u64 = 8 * 1024 * 1024;
const MAX_ART_URL_CHARS: usize = (MAX_ASSET_BYTES * 4 / 3) + 128;
const MAX_DECK_REVISION: u64 = 1_000_000;
const MAX_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const LIBRARY_DIRECTORY: &str = "deck-library";
const LIBRARY_FILE_NAME: &str = "library.json";
const ASSET_DIRECTORY: &str = "assets";
const ASSET_REFERENCE_PREFIX: &str = "artificer-asset:v1:";
const ASSET_FILE_SUFFIX: &str = ".bin";
const TRANSACTION_LOCK_FILE_NAME: &str = ".library.lock";
const PROJECT_FORMAT: &str = "wanxiang-deck-project";
const PROJECT_FORMAT_VERSION: u32 = 1;
const PROJECT_MANIFEST_NAME: &str = "project.json";
const MAX_PROJECT_BYTES: u64 = 80 * 1024 * 1024;
const MAX_PROJECT_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
static STORAGE_PROCESS_LOCK: Mutex<()> = Mutex::new(());
static OBSERVED_MANIFESTS: LazyLock<Mutex<HashMap<PathBuf, Option<blake3::Hash>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeckLibrary {
    pub schema_version: u32,
    pub active_deck_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_deck_cid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_deck_revision: Option<DeckRevisionReference>,
    pub decks: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeckRevisionReference {
    pub family_id: String,
    pub revision: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDeckProjectResult {
    pub saved: bool,
    pub path: Option<String>,
    pub bytes_written: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDeckProjectResult {
    pub imported: bool,
    pub path: Option<String>,
    pub deck: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDeckProjectFileResult {
    pub opened: bool,
    pub path: Option<String>,
    pub contents_base64: Option<String>,
    pub bytes_read: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeckProjectManifest {
    format: String,
    format_version: u32,
    exported_at: u64,
    deck: Value,
}

impl Default for DeckLibrary {
    fn default() -> Self {
        Self {
            schema_version: STORAGE_SCHEMA_VERSION,
            active_deck_id: None,
            active_deck_cid: None,
            active_deck_revision: None,
            decks: Vec::new(),
        }
    }
}

#[tauri::command]
pub async fn load_deck_library(app: AppHandle) -> Result<DeckLibrary, CommandError> {
    let path = deck_library_path(&app)?;
    tokio::task::spawn_blocking(move || load_library_at(&path))
        .await
        .map_err(|_| storage_read_error())?
}

#[tauri::command]
pub async fn save_deck_library(
    app: AppHandle,
    library: DeckLibrary,
) -> Result<DeckLibrary, CommandError> {
    let path = deck_library_path(&app)?;
    tokio::task::spawn_blocking(move || {
        save_library_at(&path, &library)?;
        Ok(library)
    })
    .await
    .map_err(|_| storage_write_error())?
}

#[tauri::command]
pub async fn export_deck_project(
    deck: Value,
    suggested_name: String,
) -> Result<ExportDeckProjectResult, CommandError> {
    let file_name = safe_project_name(&suggested_name);
    let selection = rfd::AsyncFileDialog::new()
        .add_filter("Wanxiang Deck project", &["artdeck"])
        .set_file_name(file_name)
        .save_file()
        .await;
    let Some(file_handle) = selection else {
        return Ok(ExportDeckProjectResult {
            saved: false,
            path: None,
            bytes_written: 0,
        });
    };

    let path = file_handle.path().to_path_buf();
    let bytes = tokio::task::spawn_blocking(move || build_project_archive(deck))
        .await
        .map_err(|_| project_error("PROJECT_EXPORT_FAILED", "套牌工程打包失败。"))??;
    let bytes_written = bytes.len();
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|_| project_error("PROJECT_SAVE_FAILED", "工程文件保存失败，请检查目录权限。"))?;

    Ok(ExportDeckProjectResult {
        saved: true,
        path: Some(path.to_string_lossy().into_owned()),
        bytes_written,
    })
}

#[tauri::command]
pub async fn import_deck_project() -> Result<ImportDeckProjectResult, CommandError> {
    let selection = rfd::AsyncFileDialog::new()
        .add_filter("Wanxiang Deck project", &["artdeck", "zip"])
        .pick_file()
        .await;
    let Some(file_handle) = selection else {
        return Ok(ImportDeckProjectResult {
            imported: false,
            path: None,
            deck: None,
        });
    };

    let path = file_handle.path().to_path_buf();
    let archive_path = path.clone();
    let deck = tokio::task::spawn_blocking(move || read_project_archive(&archive_path))
        .await
        .map_err(|_| project_error("PROJECT_IMPORT_FAILED", "套牌工程读取失败。"))??;
    Ok(ImportDeckProjectResult {
        imported: true,
        path: Some(path.to_string_lossy().into_owned()),
        deck: Some(deck),
    })
}

#[tauri::command]
pub async fn save_deck_project_file(
    contents_base64: String,
    suggested_name: String,
) -> Result<ExportDeckProjectResult, CommandError> {
    let bytes = decode_project_archive_base64(&contents_base64)?;
    validate_project_archive_bytes(&bytes)?;
    let bytes_written = bytes.len();
    let file_name = safe_project_name(&suggested_name);
    let selection = rfd::AsyncFileDialog::new()
        .add_filter("Wanxiang Deck project", &["artdeck"])
        .set_file_name(file_name)
        .save_file()
        .await;

    let Some(file_handle) = selection else {
        return Ok(ExportDeckProjectResult {
            saved: false,
            path: None,
            bytes_written: 0,
        });
    };

    let path = ensure_project_extension(file_handle.path());
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|_| project_error("PROJECT_SAVE_FAILED", "工程文件保存失败，请检查目录权限。"))?;

    Ok(ExportDeckProjectResult {
        saved: true,
        path: Some(path.to_string_lossy().into_owned()),
        bytes_written,
    })
}

#[tauri::command]
pub async fn open_deck_project_file() -> Result<OpenDeckProjectFileResult, CommandError> {
    let selection = rfd::AsyncFileDialog::new()
        .add_filter("Wanxiang Deck project", &["artdeck", "zip"])
        .pick_file()
        .await;
    let Some(file_handle) = selection else {
        return Ok(OpenDeckProjectFileResult {
            opened: false,
            path: None,
            contents_base64: None,
            bytes_read: 0,
        });
    };

    let path = file_handle.path().to_path_buf();
    let read_path = path.clone();
    let bytes = tokio::task::spawn_blocking(move || read_project_file_bytes(&read_path))
        .await
        .map_err(|_| project_error("PROJECT_IMPORT_FAILED", "套牌工程读取失败。"))??;
    let bytes_read = bytes.len();

    Ok(OpenDeckProjectFileResult {
        opened: true,
        path: Some(path.to_string_lossy().into_owned()),
        contents_base64: Some(BASE64_PADDED.encode(bytes)),
        bytes_read,
    })
}

fn project_error(code: &'static str, message: &'static str) -> CommandError {
    CommandError::new(code, message)
}

fn ensure_project_extension(path: &Path) -> PathBuf {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("artdeck"))
    {
        return path.to_path_buf();
    }
    path.with_extension("artdeck")
}

fn safe_project_name(suggested_name: &str) -> String {
    let mut name: String = suggested_name
        .trim()
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
        })
        .take(80)
        .collect();
    name = name.trim_matches([' ', '.']).to_owned();
    if name.to_ascii_lowercase().ends_with(".artdeck") {
        name.truncate(name.len().saturating_sub(8));
        name = name.trim_end_matches([' ', '.']).to_owned();
    }
    if name.is_empty() {
        name = "wanxiang-deck".to_owned();
    }
    format!("{name}.artdeck")
}

fn decode_project_archive_base64(value: &str) -> Result<Vec<u8>, CommandError> {
    let encoded = value
        .trim()
        .strip_prefix("data:application/zip;base64,")
        .unwrap_or(value.trim());
    let maximum_encoded_length = (MAX_PROJECT_BYTES as usize).div_ceil(3) * 4 + 4;
    if encoded.len() > maximum_encoded_length + (64 * 1024) {
        return Err(project_error(
            "PROJECT_TOO_LARGE",
            "套牌工程不得超过 80 MiB。",
        ));
    }
    let compact = if encoded.bytes().any(|byte| byte.is_ascii_whitespace()) {
        Cow::Owned(
            encoded
                .chars()
                .filter(|character| !character.is_ascii_whitespace())
                .collect::<String>(),
        )
    } else {
        Cow::Borrowed(encoded)
    };
    if compact.is_empty() || compact.len() > maximum_encoded_length {
        return Err(project_error(
            "PROJECT_TOO_LARGE",
            "套牌工程不得超过 80 MiB。",
        ));
    }
    let bytes = BASE64_PADDED
        .decode(compact.as_bytes())
        .map_err(|_| project_error("PROJECT_INVALID", "套牌工程数据格式无效。"))?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_PROJECT_BYTES {
        return Err(project_error(
            "PROJECT_TOO_LARGE",
            "套牌工程不得超过 80 MiB。",
        ));
    }
    Ok(bytes)
}

fn validate_project_archive_bytes(bytes: &[u8]) -> Result<(), CommandError> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_PROJECT_BYTES {
        return Err(project_error(
            "PROJECT_TOO_LARGE",
            "套牌工程不得超过 80 MiB。",
        ));
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| project_error("PROJECT_INVALID", "所选文件不是有效的套牌工程。"))?;
    if archive.len() == 0 || archive.len() > MAX_CARDS_PER_DECK + 2 {
        return Err(project_error(
            "PROJECT_INVALID",
            "套牌工程包含异常数量的文件。",
        ));
    }
    let manifest_bytes = read_project_entry(
        &mut archive,
        PROJECT_MANIFEST_NAME,
        MAX_PROJECT_MANIFEST_BYTES,
    )?;
    let manifest: Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| project_error("PROJECT_INVALID", "套牌工程清单格式无效。"))?;
    let object = manifest
        .as_object()
        .ok_or_else(|| project_error("PROJECT_INVALID", "套牌工程清单格式无效。"))?;
    let format = object.get("format").and_then(Value::as_str);
    let format_version = object.get("formatVersion").and_then(Value::as_u64);
    if format != Some(PROJECT_FORMAT) || !matches!(format_version, Some(1 | 2)) {
        return Err(project_error(
            "PROJECT_VERSION_UNSUPPORTED",
            "此套牌工程版本暂不受支持。",
        ));
    }
    if !object
        .get("deck")
        .and_then(Value::as_object)
        .is_some_and(|deck| deck.get("cards").and_then(Value::as_array).is_some())
    {
        return Err(project_error(
            "PROJECT_INVALID",
            "套牌工程中没有可导入的套牌。",
        ));
    }
    Ok(())
}

fn read_project_file_bytes(path: &Path) -> Result<Vec<u8>, CommandError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| project_error("PROJECT_READ_FAILED", "无法读取所选工程文件。"))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_PROJECT_BYTES
    {
        return Err(project_error(
            "PROJECT_TOO_LARGE",
            "工程文件无效或超过 80 MiB。",
        ));
    }
    let file = File::open(path)
        .map_err(|_| project_error("PROJECT_READ_FAILED", "无法读取所选工程文件。"))?;
    let bytes = read_bounded(file, MAX_PROJECT_BYTES as usize).map_err(|error| match error {
        BoundedReadError::TooLarge => project_error("PROJECT_TOO_LARGE", "工程文件超过 80 MiB。"),
        BoundedReadError::Io => project_error("PROJECT_READ_FAILED", "无法读取所选工程文件。"),
    })?;
    validate_project_archive_bytes(&bytes)?;
    Ok(bytes)
}

fn build_project_archive(deck: Value) -> Result<Vec<u8>, CommandError> {
    let mut library = DeckLibrary {
        schema_version: STORAGE_SCHEMA_VERSION,
        active_deck_id: deck.get("id").and_then(Value::as_str).map(str::to_owned),
        active_deck_cid: None,
        active_deck_revision: None,
        decks: vec![deck],
    };
    validate_library(&library).map_err(hydrated_save_validation_error)?;
    let assets = externalize_library_assets(&mut library).map_err(asset_save_error)?;
    validate_persisted_library(&library).map_err(persisted_save_validation_error)?;
    let deck = library
        .decks
        .pop()
        .ok_or_else(|| project_error("PROJECT_EXPORT_FAILED", "套牌工程缺少有效套牌。"))?;
    let manifest = DeckProjectManifest {
        format: PROJECT_FORMAT.to_owned(),
        format_version: PROJECT_FORMAT_VERSION,
        exported_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX),
        deck,
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|_| project_error("PROJECT_EXPORT_FAILED", "套牌工程清单生成失败。"))?;
    if manifest_bytes.len() as u64 > MAX_PROJECT_MANIFEST_BYTES {
        return Err(project_error("PROJECT_TOO_LARGE", "套牌工程清单过大。"));
    }

    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let manifest_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);
    writer
        .start_file(PROJECT_MANIFEST_NAME, manifest_options)
        .map_err(|_| project_error("PROJECT_EXPORT_FAILED", "套牌工程清单写入失败。"))?;
    writer
        .write_all(&manifest_bytes)
        .map_err(|_| project_error("PROJECT_EXPORT_FAILED", "套牌工程清单写入失败。"))?;
    let asset_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .unix_permissions(0o600);
    for (digest, asset) in assets {
        writer
            .start_file(format!("assets/{digest}.bin"), asset_options)
            .map_err(|_| project_error("PROJECT_EXPORT_FAILED", "套牌图片写入工程失败。"))?;
        writer
            .write_all(&asset.bytes)
            .map_err(|_| project_error("PROJECT_EXPORT_FAILED", "套牌图片写入工程失败。"))?;
    }
    let bytes = writer
        .finish()
        .map_err(|_| project_error("PROJECT_EXPORT_FAILED", "套牌工程封装失败。"))?
        .into_inner();
    if bytes.len() as u64 > MAX_PROJECT_BYTES {
        return Err(project_error(
            "PROJECT_TOO_LARGE",
            "套牌工程不得超过 80 MiB。",
        ));
    }
    Ok(bytes)
}

fn read_project_archive(path: &Path) -> Result<Value, CommandError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| project_error("PROJECT_READ_FAILED", "无法读取所选工程文件。"))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_PROJECT_BYTES
    {
        return Err(project_error(
            "PROJECT_TOO_LARGE",
            "工程文件无效或超过 80 MiB。",
        ));
    }
    let file = File::open(path)
        .map_err(|_| project_error("PROJECT_READ_FAILED", "无法读取所选工程文件。"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|_| project_error("PROJECT_INVALID", "所选文件不是有效的套牌工程。"))?;
    if archive.len() == 0 || archive.len() > MAX_CARDS_PER_DECK + 2 {
        return Err(project_error(
            "PROJECT_INVALID",
            "套牌工程包含异常数量的文件。",
        ));
    }

    let manifest_bytes = read_project_entry(
        &mut archive,
        PROJECT_MANIFEST_NAME,
        MAX_PROJECT_MANIFEST_BYTES,
    )?;
    let manifest: DeckProjectManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| project_error("PROJECT_INVALID", "套牌工程清单格式无效。"))?;
    if manifest.format != PROJECT_FORMAT || manifest.format_version != PROJECT_FORMAT_VERSION {
        return Err(project_error(
            "PROJECT_VERSION_UNSUPPORTED",
            "此套牌工程版本暂不受支持。",
        ));
    }

    let mut library = DeckLibrary {
        schema_version: STORAGE_SCHEMA_VERSION,
        active_deck_id: manifest
            .deck
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_owned),
        active_deck_cid: None,
        active_deck_revision: None,
        decks: vec![manifest.deck],
    };
    validate_persisted_library(&library).map_err(persisted_save_validation_error)?;
    let references = collect_persisted_asset_references(&library).map_err(asset_load_error)?;
    if archive.len() != references.len() + 1 {
        return Err(project_error(
            "PROJECT_INVALID",
            "套牌工程包含缺失或多余的图片文件。",
        ));
    }
    let mut assets = AssetManifest::new();
    for (digest, mime_type) in references {
        let bytes = read_project_entry(
            &mut archive,
            &format!("assets/{digest}.bin"),
            MAX_ASSET_BYTES as u64,
        )?;
        if blake3::hash(&bytes).to_hex().as_str() != digest
            || !matching_raster_signature(mime_type, &bytes)
        {
            return Err(project_error(
                "PROJECT_ASSET_CORRUPT",
                "套牌工程中的图片已损坏。",
            ));
        }
        assets.insert(digest, AssetRecord { mime_type, bytes });
    }
    hydrate_project_assets(&mut library, &assets)?;
    validate_library(&library).map_err(hydrated_save_validation_error)?;
    library
        .decks
        .pop()
        .ok_or_else(|| project_error("PROJECT_INVALID", "套牌工程中没有可导入的套牌。"))
}

fn read_project_entry<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    maximum_bytes: u64,
) -> Result<Vec<u8>, CommandError> {
    let entry = archive
        .by_name(name)
        .map_err(|_| project_error("PROJECT_INVALID", "套牌工程缺少必要文件。"))?;
    if entry.is_dir() || entry.size() == 0 || entry.size() > maximum_bytes {
        return Err(project_error("PROJECT_INVALID", "套牌工程文件大小无效。"));
    }
    let capacity = usize::try_from(entry.size())
        .map_err(|_| project_error("PROJECT_TOO_LARGE", "套牌工程文件过大。"))?;
    let mut bytes = Vec::with_capacity(capacity);
    entry
        .take(maximum_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| project_error("PROJECT_READ_FAILED", "套牌工程文件读取失败。"))?;
    if bytes.len() as u64 > maximum_bytes {
        return Err(project_error("PROJECT_TOO_LARGE", "套牌工程文件过大。"));
    }
    Ok(bytes)
}

fn hydrate_project_assets(
    library: &mut DeckLibrary,
    assets: &AssetManifest,
) -> Result<(), CommandError> {
    let mut expanded_bytes = serde_json::to_vec(library)
        .map_err(|_| project_error("PROJECT_INVALID", "套牌工程清单无法解析。"))?
        .len();
    visit_asset_fields_mut(library, |value| {
        let source = value.as_str().ok_or(AssetStorageError::Invalid)?.to_owned();
        if !source.starts_with(ASSET_REFERENCE_PREFIX) {
            validate_inline_image_data_url(&source)?;
            return Ok(());
        }
        let reference = parse_asset_reference(&source)?;
        let asset = assets
            .get(&reference.digest)
            .ok_or(AssetStorageError::Missing)?;
        if asset.mime_type != reference.mime_type {
            return Err(AssetStorageError::Corrupt);
        }
        let hydrated = encode_asset_data_url(reference.mime_type, reference.encoding, &asset.bytes);
        expanded_bytes = expanded_bytes
            .checked_sub(source.len())
            .and_then(|size| size.checked_add(hydrated.len()))
            .ok_or(AssetStorageError::TooLarge)?;
        if expanded_bytes > MAX_HYDRATED_LIBRARY_BYTES {
            return Err(AssetStorageError::TooLarge);
        }
        *value = Value::String(hydrated);
        Ok(())
    })
    .map_err(asset_load_error)
}

fn deck_library_path(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(LIBRARY_DIRECTORY).join(LIBRARY_FILE_NAME))
        .map_err(|_| CommandError::new("DECK_STORAGE_UNAVAILABLE", "无法访问本地套牌存储目录。"))
}

fn acquire_transaction_lock(path: &Path) -> Result<File, AssetStorageError> {
    let parent = path.parent().ok_or(AssetStorageError::Io)?;
    match fs::symlink_metadata(parent) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(AssetStorageError::Corrupt);
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir_all(parent).map_err(|_| AssetStorageError::Io)?;
            let metadata = fs::symlink_metadata(parent).map_err(|_| AssetStorageError::Io)?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(AssetStorageError::Corrupt);
            }
        }
        Err(_) => return Err(AssetStorageError::Io),
    }

    let lock_path = parent.join(TRANSACTION_LOCK_FILE_NAME);
    match fs::symlink_metadata(&lock_path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(AssetStorageError::Corrupt);
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(_) => return Err(AssetStorageError::Io),
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|_| AssetStorageError::Io)?;
    let metadata = fs::symlink_metadata(&lock_path).map_err(|_| AssetStorageError::Io)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AssetStorageError::Corrupt);
    }
    lock.lock().map_err(|_| AssetStorageError::Io)?;
    Ok(lock)
}

fn observed_manifest(path: &Path) -> Result<Option<Option<blake3::Hash>>, CommandError> {
    OBSERVED_MANIFESTS
        .lock()
        .map(|observed| observed.get(path).copied())
        .map_err(|_| storage_read_error())
}

fn record_observed_manifest(
    path: &Path,
    fingerprint: Option<blake3::Hash>,
) -> Result<(), CommandError> {
    OBSERVED_MANIFESTS
        .lock()
        .map_err(|_| storage_write_error())?
        .insert(path.to_path_buf(), fingerprint);
    Ok(())
}

fn require_current_manifest(
    path: &Path,
    current: Option<blake3::Hash>,
) -> Result<(), CommandError> {
    match observed_manifest(path)? {
        Some(expected) if expected == current => Ok(()),
        None if current.is_none() => Ok(()),
        _ => Err(CommandError::new(
            "DECK_STORAGE_CONFLICT",
            "本地作品库已被另一个窗口更新，请重新载入后再保存。",
        )),
    }
}

fn load_library_at(path: &Path) -> Result<DeckLibrary, CommandError> {
    let _process_guard = STORAGE_PROCESS_LOCK
        .lock()
        .map_err(|_| storage_read_error())?;
    let _transaction_lock = acquire_transaction_lock(path).map_err(asset_load_error)?;
    cleanup_stale_manifest_temporaries(path).map_err(asset_load_error)?;
    let (mut library, persisted_bytes, fingerprint) = load_persisted_library_at(path)?;
    let assets = asset_directory(path)?;
    let references = collect_persisted_asset_references(&library).map_err(asset_load_error)?;
    hydrate_library_assets(&mut library, &assets, persisted_bytes).map_err(asset_load_error)?;
    validate_library(&library).map_err(load_validation_error)?;
    cleanup_asset_store(&assets, &references).map_err(asset_load_error)?;
    record_observed_manifest(path, fingerprint)?;
    Ok(library)
}

fn load_persisted_library_at(
    path: &Path,
) -> Result<(DeckLibrary, usize, Option<blake3::Hash>), CommandError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(corrupt_error());
        }
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok((DeckLibrary::default(), 0, None));
        }
        Err(_) => return Err(storage_read_error()),
    };
    if metadata.len() > MAX_PERSISTED_LIBRARY_BYTES as u64 {
        return Err(CommandError::new(
            "DECK_STORAGE_TOO_LARGE",
            "本地套牌库超过 96 MiB 上限，原文件未被修改。",
        ));
    }
    let file = File::open(path).map_err(|_| storage_read_error())?;

    let bytes = read_bounded(file, MAX_PERSISTED_LIBRARY_BYTES).map_err(|error| match error {
        BoundedReadError::TooLarge => CommandError::new(
            "DECK_STORAGE_TOO_LARGE",
            "本地套牌库超过 96 MiB 上限，原文件未被修改。",
        ),
        BoundedReadError::Io => storage_read_error(),
    })?;
    let mut library: DeckLibrary = serde_json::from_slice(&bytes).map_err(|_| corrupt_error())?;
    clear_ambiguous_legacy_active_deck(&mut library);
    validate_persisted_library(&library).map_err(load_validation_error)?;
    let fingerprint = Some(blake3::hash(&bytes));
    Ok((library, bytes.len(), fingerprint))
}

fn clear_ambiguous_legacy_active_deck(library: &mut DeckLibrary) {
    if library.active_deck_cid.is_some() || library.active_deck_revision.is_some() {
        return;
    }
    let Some(active_deck_id) = library.active_deck_id.as_deref() else {
        return;
    };
    let ambiguous = library
        .decks
        .iter()
        .filter(|deck| deck.get("id").and_then(Value::as_str) == Some(active_deck_id))
        .take(2)
        .count()
        > 1;
    if ambiguous {
        library.active_deck_id = None;
        library.active_deck_cid = None;
        library.active_deck_revision = None;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AssetEncoding {
    Padded,
    NoPad,
}

impl AssetEncoding {
    fn label(self) -> &'static str {
        match self {
            Self::Padded => "padded",
            Self::NoPad => "nopad",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AssetReference {
    digest: String,
    mime_type: &'static str,
    encoding: AssetEncoding,
}

#[derive(Clone, Debug)]
struct AssetRecord {
    mime_type: &'static str,
    bytes: Vec<u8>,
}

type AssetManifest = BTreeMap<String, AssetRecord>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AssetStorageError {
    Invalid,
    Missing,
    Corrupt,
    TooLarge,
    Io,
}

fn asset_directory(library_path: &Path) -> Result<PathBuf, CommandError> {
    library_path
        .parent()
        .map(|parent| parent.join(ASSET_DIRECTORY))
        .ok_or_else(|| CommandError::new("DECK_STORAGE_UNAVAILABLE", "无法访问本地套牌资产目录。"))
}

fn mime_slug(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpeg"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

fn mime_from_slug(slug: &str) -> Option<&'static str> {
    match slug {
        "png" => Some("image/png"),
        "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn format_asset_reference(reference: &AssetReference) -> String {
    format!(
        "{ASSET_REFERENCE_PREFIX}blake3:{}:{}:{}",
        reference.digest,
        mime_slug(reference.mime_type).expect("validated asset MIME"),
        reference.encoding.label(),
    )
}

fn parse_asset_reference(value: &str) -> Result<AssetReference, AssetStorageError> {
    let remainder = value
        .strip_prefix(ASSET_REFERENCE_PREFIX)
        .ok_or(AssetStorageError::Invalid)?;
    let mut parts = remainder.split(':');
    if parts.next() != Some("blake3") {
        return Err(AssetStorageError::Invalid);
    }
    let digest = parts.next().ok_or(AssetStorageError::Invalid)?;
    let mime_type = parts
        .next()
        .and_then(mime_from_slug)
        .ok_or(AssetStorageError::Invalid)?;
    let encoding = match parts.next() {
        Some("padded") => AssetEncoding::Padded,
        Some("nopad") => AssetEncoding::NoPad,
        _ => return Err(AssetStorageError::Invalid),
    };
    if parts.next().is_some()
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AssetStorageError::Invalid);
    }
    Ok(AssetReference {
        digest: digest.to_owned(),
        mime_type,
        encoding,
    })
}

fn valid_raster_dimensions(width: u32, height: u32) -> bool {
    width > 0
        && height > 0
        && width <= MAX_RASTER_DIMENSION
        && height <= MAX_RASTER_DIMENSION
        && u64::from(width) * u64::from(height) <= MAX_RASTER_PIXELS
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || &bytes[8..12] != 13_u32.to_be_bytes().as_slice()
        || &bytes[12..16] != b"IHDR"
    {
        return None;
    }
    Some((
        u32::from_be_bytes(bytes[16..20].try_into().ok()?),
        u32::from_be_bytes(bytes[20..24].try_into().ok()?),
    ))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut offset = 2usize;
    while offset < bytes.len() {
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let marker = *bytes.get(offset)?;
        offset += 1;
        if marker == 0x00 || marker == 0xff {
            continue;
        }
        if marker == 0xd9 || marker == 0xda {
            return None;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }

        let segment_length =
            u16::from_be_bytes([*bytes.get(offset)?, *bytes.get(offset.checked_add(1)?)?]) as usize;
        if segment_length < 2 {
            return None;
        }
        let segment_end = offset.checked_add(segment_length)?;
        if segment_end > bytes.len() {
            return None;
        }
        let is_start_of_frame = matches!(
            marker,
            0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf
        );
        if is_start_of_frame {
            if segment_length < 7 {
                return None;
            }
            let height = u16::from_be_bytes([bytes[offset + 3], bytes[offset + 4]]) as u32;
            let width = u16::from_be_bytes([bytes[offset + 5], bytes[offset + 6]]) as u32;
            return Some((width, height));
        }
        offset = segment_end;
    }
    None
}

fn little_endian_u24(bytes: &[u8]) -> Option<u32> {
    Some(
        u32::from(bytes.first().copied()?)
            | (u32::from(*bytes.get(1)?) << 8)
            | (u32::from(*bytes.get(2)?) << 16),
    )
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 20 || !bytes.starts_with(b"RIFF") || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let riff_size = u32::from_le_bytes(bytes[4..8].try_into().ok()?) as usize;
    let riff_end = riff_size.checked_add(8)?;
    if riff_end > bytes.len() {
        return None;
    }

    let mut offset = 12usize;
    while offset.checked_add(8)? <= riff_end {
        let chunk_type = bytes.get(offset..offset + 4)?;
        let chunk_size =
            u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().ok()?) as usize;
        let data_start = offset.checked_add(8)?;
        let data_end = data_start.checked_add(chunk_size)?;
        if data_end > riff_end {
            return None;
        }
        let data = &bytes[data_start..data_end];
        let dimensions = match chunk_type {
            b"VP8X" if data.len() >= 10 => Some((
                little_endian_u24(&data[4..7])?.checked_add(1)?,
                little_endian_u24(&data[7..10])?.checked_add(1)?,
            )),
            b"VP8 " if data.len() >= 10 && data[3..6] == [0x9d, 0x01, 0x2a] => Some((
                u32::from(u16::from_le_bytes([data[6], data[7]]) & 0x3fff),
                u32::from(u16::from_le_bytes([data[8], data[9]]) & 0x3fff),
            )),
            b"VP8L" if data.len() >= 5 && data[0] == 0x2f => {
                let bits = u32::from_le_bytes(data[1..5].try_into().ok()?);
                Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
            }
            _ => None,
        };
        if dimensions.is_some() {
            return dimensions;
        }
        offset = data_end.checked_add(chunk_size & 1)?;
    }
    None
}

fn matching_raster_signature(mime_type: &str, bytes: &[u8]) -> bool {
    let dimensions = match mime_type {
        "image/png" => png_dimensions(bytes),
        "image/jpeg" => jpeg_dimensions(bytes),
        "image/webp" => webp_dimensions(bytes),
        _ => None,
    };
    dimensions.is_some_and(|(width, height)| valid_raster_dimensions(width, height))
}

fn encode_asset_data_url(mime_type: &str, encoding: AssetEncoding, bytes: &[u8]) -> String {
    let encoded = match encoding {
        AssetEncoding::Padded => BASE64_PADDED.encode(bytes),
        AssetEncoding::NoPad => BASE64_NO_PAD.encode(bytes),
    };
    format!("data:{mime_type};base64,{encoded}")
}

fn validate_inline_image_data_url(value: &str) -> Result<(), AssetStorageError> {
    let Some(scheme) = value.get(..5) else {
        return Ok(());
    };
    if !scheme.eq_ignore_ascii_case("data:") {
        return Ok(());
    }
    let (metadata, encoded) = value[5..]
        .split_once(',')
        .ok_or(AssetStorageError::Invalid)?;
    let source_mime = metadata
        .split(';')
        .next()
        .map(str::trim)
        .ok_or(AssetStorageError::Invalid)?;
    if !source_mime
        .get(..6)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("image/"))
    {
        return Ok(());
    }
    let mime_type = if source_mime.eq_ignore_ascii_case("image/png") {
        "image/png"
    } else if source_mime.eq_ignore_ascii_case("image/jpeg") {
        "image/jpeg"
    } else if source_mime.eq_ignore_ascii_case("image/webp") {
        "image/webp"
    } else {
        return Err(AssetStorageError::Invalid);
    };
    if !metadata
        .rsplit(';')
        .next()
        .is_some_and(|parameter| parameter.eq_ignore_ascii_case("base64"))
        || encoded.is_empty()
        || encoded.len() > MAX_ART_URL_CHARS
    {
        return Err(AssetStorageError::Invalid);
    }
    let bytes = BASE64_PADDED
        .decode(encoded.as_bytes())
        .or_else(|_| BASE64_NO_PAD.decode(encoded.as_bytes()))
        .map_err(|_| AssetStorageError::Invalid)?;
    if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
        return Err(AssetStorageError::TooLarge);
    }
    if !matching_raster_signature(mime_type, &bytes) {
        return Err(AssetStorageError::Invalid);
    }
    Ok(())
}

fn parse_canonical_inline_asset(
    value: &str,
) -> Result<Option<(AssetReference, Vec<u8>)>, AssetStorageError> {
    let Some(data_url) = value.strip_prefix("data:") else {
        return Ok(None);
    };
    let Some((metadata, encoded)) = data_url.split_once(',') else {
        return Err(AssetStorageError::Invalid);
    };
    let Some(source_mime_type) = metadata.strip_suffix(";base64") else {
        return Ok(None);
    };
    let Some(mime_type) = mime_slug(source_mime_type).and_then(mime_from_slug) else {
        return Ok(None);
    };
    if encoded.is_empty() || encoded.len() > MAX_ART_URL_CHARS {
        return Err(AssetStorageError::TooLarge);
    }

    let encoding = if encoded.ends_with('=') {
        AssetEncoding::Padded
    } else {
        AssetEncoding::NoPad
    };
    let bytes = match encoding {
        AssetEncoding::Padded => BASE64_PADDED.decode(encoded.as_bytes()),
        AssetEncoding::NoPad => BASE64_NO_PAD.decode(encoded.as_bytes()),
    }
    .map_err(|_| AssetStorageError::Invalid)?;
    if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
        return Err(AssetStorageError::TooLarge);
    }
    if !matching_raster_signature(mime_type, &bytes) {
        return Err(AssetStorageError::Invalid);
    }

    let digest = blake3::hash(&bytes).to_hex().to_string();
    let reference = AssetReference {
        digest,
        mime_type,
        encoding,
    };
    if encode_asset_data_url(mime_type, encoding, &bytes) != value {
        return Ok(None);
    }
    Ok(Some((reference, bytes)))
}

fn visit_asset_fields_mut(
    library: &mut DeckLibrary,
    mut visitor: impl FnMut(&mut Value) -> Result<(), AssetStorageError>,
) -> Result<(), AssetStorageError> {
    for deck in &mut library.decks {
        let object = deck.as_object_mut().ok_or(AssetStorageError::Invalid)?;
        let cards = object
            .get_mut("cards")
            .and_then(Value::as_array_mut)
            .ok_or(AssetStorageError::Invalid)?;
        for card in cards {
            let art_url = card
                .as_object_mut()
                .and_then(|card| card.get_mut("artUrl"))
                .ok_or(AssetStorageError::Invalid)?;
            visitor(art_url)?;
        }
        if let Some(texture_url) = object
            .get_mut("cardBack")
            .and_then(Value::as_object_mut)
            .and_then(|card_back| card_back.get_mut("textureUrl"))
        {
            visitor(texture_url)?;
        }
    }
    Ok(())
}

fn externalize_library_assets(
    library: &mut DeckLibrary,
) -> Result<AssetManifest, AssetStorageError> {
    let mut manifest = AssetManifest::new();
    let mut unique_asset_bytes = 0usize;
    visit_asset_fields_mut(library, |value| {
        let source = value.as_str().ok_or(AssetStorageError::Invalid)?.to_owned();
        if source.starts_with(ASSET_REFERENCE_PREFIX) {
            return Err(AssetStorageError::Invalid);
        }
        validate_inline_image_data_url(&source)?;
        let Some((reference, bytes)) = parse_canonical_inline_asset(&source)? else {
            return Ok(());
        };

        if let Some(existing) = manifest.get(&reference.digest) {
            if existing.mime_type != reference.mime_type || existing.bytes != bytes {
                return Err(AssetStorageError::Corrupt);
            }
        } else {
            unique_asset_bytes = unique_asset_bytes
                .checked_add(bytes.len())
                .ok_or(AssetStorageError::TooLarge)?;
            if unique_asset_bytes > MAX_ASSET_STORE_BYTES {
                return Err(AssetStorageError::TooLarge);
            }
            manifest.insert(
                reference.digest.clone(),
                AssetRecord {
                    mime_type: reference.mime_type,
                    bytes,
                },
            );
        }
        *value = Value::String(format_asset_reference(&reference));
        Ok(())
    })?;
    Ok(manifest)
}

fn collect_persisted_asset_references(
    library: &DeckLibrary,
) -> Result<BTreeMap<String, &'static str>, AssetStorageError> {
    let mut copy = library.clone();
    let mut references = BTreeMap::new();
    let mut reference_count = 0usize;
    visit_asset_fields_mut(&mut copy, |value| {
        let source = value.as_str().ok_or(AssetStorageError::Invalid)?;
        if !source.starts_with(ASSET_REFERENCE_PREFIX) {
            return Ok(());
        }
        reference_count = reference_count
            .checked_add(1)
            .ok_or(AssetStorageError::TooLarge)?;
        if reference_count > MAX_DECKS * (MAX_CARDS_PER_DECK + 1) {
            return Err(AssetStorageError::TooLarge);
        }
        let reference = parse_asset_reference(source)?;
        if let Some(existing_mime) = references.get(&reference.digest) {
            if *existing_mime != reference.mime_type {
                return Err(AssetStorageError::Corrupt);
            }
        } else {
            references.insert(reference.digest, reference.mime_type);
        }
        Ok(())
    })?;
    Ok(references)
}

fn ensure_asset_directory(assets: &Path, create: bool) -> Result<bool, AssetStorageError> {
    match fs::symlink_metadata(assets) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(AssetStorageError::Corrupt)
        }
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound && create => {
            fs::create_dir_all(assets).map_err(|_| AssetStorageError::Io)?;
            let metadata = fs::symlink_metadata(assets).map_err(|_| AssetStorageError::Io)?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                Err(AssetStorageError::Corrupt)
            } else {
                Ok(true)
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(AssetStorageError::Io),
    }
}

fn asset_file_path(assets: &Path, digest: &str) -> PathBuf {
    assets.join(format!("{digest}{ASSET_FILE_SUFFIX}"))
}

fn valid_digest(digest: &str) -> bool {
    digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn managed_blob_digest(file_name: &str) -> Option<&str> {
    let digest = file_name.strip_suffix(ASSET_FILE_SUFFIX)?;
    valid_digest(digest).then_some(digest)
}

fn generated_asset_temporary(file_name: &str) -> bool {
    let Some(body) = file_name
        .strip_prefix('.')
        .and_then(|name| name.strip_suffix(".tmp"))
    else {
        return false;
    };
    let Some(digest) = body.get(..64) else {
        return false;
    };
    let Some(uuid) = body.get(64..).and_then(|value| value.strip_prefix('.')) else {
        return false;
    };
    valid_digest(digest)
        && Uuid::parse_str(uuid).is_ok_and(|parsed| parsed.hyphenated().to_string() == uuid)
}

fn generated_manifest_temporary(file_name: &str) -> bool {
    let Some(uuid) = file_name
        .strip_prefix(&format!(".{LIBRARY_FILE_NAME}."))
        .and_then(|name| name.strip_suffix(".tmp"))
    else {
        return false;
    };
    Uuid::parse_str(uuid).is_ok_and(|parsed| parsed.hyphenated().to_string() == uuid)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

fn cleanup_stale_manifest_temporaries(path: &Path) -> Result<(), AssetStorageError> {
    let parent = path.parent().ok_or(AssetStorageError::Io)?;
    let metadata = match fs::symlink_metadata(parent) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(AssetStorageError::Corrupt);
        }
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(AssetStorageError::Io),
    };
    if !metadata.is_dir() {
        return Err(AssetStorageError::Corrupt);
    }

    let mut removed = false;
    for entry in fs::read_dir(parent).map_err(|_| AssetStorageError::Io)? {
        let entry = entry.map_err(|_| AssetStorageError::Io)?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !generated_manifest_temporary(&file_name) {
            continue;
        }
        let entry_metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(_) => return Err(AssetStorageError::Io),
        };
        if entry_metadata.is_file() && !entry_metadata.file_type().is_symlink() {
            fs::remove_file(entry.path()).map_err(|_| AssetStorageError::Io)?;
            removed = true;
        }
    }
    if removed {
        sync_directory(parent).map_err(|_| AssetStorageError::Io)?;
    }
    Ok(())
}

fn cleanup_asset_store(
    assets: &Path,
    retained: &BTreeMap<String, &'static str>,
) -> Result<(), AssetStorageError> {
    if !ensure_asset_directory(assets, false)? {
        return Ok(());
    }
    let mut removed = false;
    for entry in fs::read_dir(assets).map_err(|_| AssetStorageError::Io)? {
        let entry = entry.map_err(|_| AssetStorageError::Io)?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let should_remove = generated_asset_temporary(&file_name)
            || managed_blob_digest(&file_name).is_some_and(|digest| !retained.contains_key(digest));
        if !should_remove {
            continue;
        }
        let entry_metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(_) => return Err(AssetStorageError::Io),
        };
        if entry_metadata.is_file() && !entry_metadata.file_type().is_symlink() {
            fs::remove_file(entry.path()).map_err(|_| AssetStorageError::Io)?;
            removed = true;
        }
    }
    if removed {
        sync_directory(assets).map_err(|_| AssetStorageError::Io)?;
    }
    Ok(())
}

fn managed_asset_store_bytes(assets: &Path) -> Result<usize, AssetStorageError> {
    if !ensure_asset_directory(assets, false)? {
        return Ok(0);
    }
    let mut total = 0usize;
    for entry in fs::read_dir(assets).map_err(|_| AssetStorageError::Io)? {
        let entry = entry.map_err(|_| AssetStorageError::Io)?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if managed_blob_digest(&file_name).is_none() {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|_| AssetStorageError::Io)?;
        if metadata.is_file() && !metadata.file_type().is_symlink() {
            total = total
                .checked_add(
                    usize::try_from(metadata.len()).map_err(|_| AssetStorageError::TooLarge)?,
                )
                .ok_or(AssetStorageError::TooLarge)?;
            if total > MAX_ASSET_STORE_BYTES {
                return Err(AssetStorageError::TooLarge);
            }
        }
    }
    Ok(total)
}

fn read_verified_asset(
    assets: &Path,
    digest: &str,
    mime_type: &str,
) -> Result<Vec<u8>, AssetStorageError> {
    if !ensure_asset_directory(assets, false)? {
        return Err(AssetStorageError::Missing);
    }
    let path = asset_file_path(assets, digest);
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            AssetStorageError::Missing
        } else {
            AssetStorageError::Io
        }
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AssetStorageError::Corrupt);
    }
    let file = File::open(path).map_err(|_| AssetStorageError::Io)?;
    let bytes = read_bounded(file, MAX_ASSET_BYTES).map_err(|error| match error {
        BoundedReadError::TooLarge => AssetStorageError::TooLarge,
        BoundedReadError::Io => AssetStorageError::Io,
    })?;
    if bytes.is_empty()
        || blake3::hash(&bytes).to_hex().as_str() != digest
        || !matching_raster_signature(mime_type, &bytes)
    {
        return Err(AssetStorageError::Corrupt);
    }
    Ok(bytes)
}

fn verify_persisted_asset_references(
    library: &DeckLibrary,
    assets: &Path,
) -> Result<(), AssetStorageError> {
    let references = collect_persisted_asset_references(library)?;
    let mut total_bytes = 0usize;
    for (digest, mime_type) in references {
        let bytes = read_verified_asset(assets, &digest, mime_type)?;
        total_bytes = total_bytes
            .checked_add(bytes.len())
            .ok_or(AssetStorageError::TooLarge)?;
        if total_bytes > MAX_ASSET_STORE_BYTES {
            return Err(AssetStorageError::TooLarge);
        }
    }
    Ok(())
}

fn publish_asset_noclobber(
    assets: &Path,
    digest: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<(), AssetStorageError> {
    ensure_asset_directory(assets, true)?;
    let target = asset_file_path(assets, digest);
    let temporary = assets.join(format!(".{digest}.{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| AssetStorageError::Io)?;
    let publish_result = (|| {
        file.write_all(bytes).map_err(|_| AssetStorageError::Io)?;
        file.sync_all().map_err(|_| AssetStorageError::Io)?;
        drop(file);
        match fs::hard_link(&temporary, &target) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let existing = read_verified_asset(assets, digest, mime_type)?;
                if existing == bytes {
                    Ok(())
                } else {
                    Err(AssetStorageError::Corrupt)
                }
            }
            Err(_) => Err(AssetStorageError::Io),
        }
    })();
    let _ = fs::remove_file(&temporary);
    publish_result
}

fn materialize_asset_manifest(
    assets: &Path,
    manifest: &AssetManifest,
) -> Result<(), AssetStorageError> {
    let mut missing = Vec::new();
    let mut total_bytes = managed_asset_store_bytes(assets)?;
    let directory_exists = ensure_asset_directory(assets, false)?;
    for (digest, record) in manifest {
        if record.bytes.len() > MAX_ASSET_BYTES {
            return Err(AssetStorageError::TooLarge);
        }
        let path = asset_file_path(assets, digest);
        match fs::symlink_metadata(&path) {
            Ok(_) => {
                let existing = read_verified_asset(assets, digest, record.mime_type)?;
                if existing != record.bytes {
                    return Err(AssetStorageError::Corrupt);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                total_bytes = total_bytes
                    .checked_add(record.bytes.len())
                    .ok_or(AssetStorageError::TooLarge)?;
                if total_bytes > MAX_ASSET_STORE_BYTES {
                    return Err(AssetStorageError::TooLarge);
                }
                missing.push((digest.as_str(), record));
            }
            Err(_) => return Err(AssetStorageError::Io),
        }
    }
    if !directory_exists && !missing.is_empty() {
        ensure_asset_directory(assets, true)?;
    }
    for (digest, record) in missing {
        publish_asset_noclobber(assets, digest, record.mime_type, &record.bytes)?;
    }
    if !manifest.is_empty() {
        sync_directory(assets).map_err(|_| AssetStorageError::Io)?;
    }
    Ok(())
}

fn verify_existing_asset_targets(
    assets: &Path,
    manifest: &AssetManifest,
) -> Result<(), AssetStorageError> {
    if !ensure_asset_directory(assets, false)? {
        return Ok(());
    }
    for (digest, record) in manifest {
        match fs::symlink_metadata(asset_file_path(assets, digest)) {
            Ok(_) => {
                let existing = read_verified_asset(assets, digest, record.mime_type)?;
                if existing != record.bytes {
                    return Err(AssetStorageError::Corrupt);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(AssetStorageError::Io),
        }
    }
    Ok(())
}

fn hydrate_library_assets(
    library: &mut DeckLibrary,
    assets: &Path,
    persisted_bytes: usize,
) -> Result<(), AssetStorageError> {
    let mut cached: Option<(String, &'static str, Vec<u8>)> = None;
    let mut seen = HashSet::new();
    let mut expanded_bytes = persisted_bytes;
    let mut unique_asset_bytes = 0usize;
    let mut reference_count = 0usize;
    visit_asset_fields_mut(library, |value| {
        let source = value.as_str().ok_or(AssetStorageError::Invalid)?.to_owned();
        if !source.starts_with(ASSET_REFERENCE_PREFIX) {
            validate_inline_image_data_url(&source)?;
            return Ok(());
        }
        reference_count = reference_count
            .checked_add(1)
            .ok_or(AssetStorageError::TooLarge)?;
        if reference_count > MAX_DECKS * (MAX_CARDS_PER_DECK + 1) {
            return Err(AssetStorageError::TooLarge);
        }
        let reference = parse_asset_reference(&source)?;
        if cached
            .as_ref()
            .is_none_or(|(digest, _, _)| digest != &reference.digest)
        {
            let bytes = read_verified_asset(assets, &reference.digest, reference.mime_type)?;
            if seen.insert(reference.digest.clone()) {
                unique_asset_bytes = unique_asset_bytes
                    .checked_add(bytes.len())
                    .ok_or(AssetStorageError::TooLarge)?;
                if unique_asset_bytes > MAX_ASSET_STORE_BYTES {
                    return Err(AssetStorageError::TooLarge);
                }
            }
            cached = Some((reference.digest.clone(), reference.mime_type, bytes));
        }
        let (_, cached_mime, bytes) = cached.as_ref().ok_or(AssetStorageError::Corrupt)?;
        if *cached_mime != reference.mime_type {
            return Err(AssetStorageError::Corrupt);
        }
        let hydrated = encode_asset_data_url(reference.mime_type, reference.encoding, bytes);
        expanded_bytes = expanded_bytes
            .checked_sub(source.len())
            .and_then(|size| size.checked_add(hydrated.len()))
            .ok_or(AssetStorageError::TooLarge)?;
        if expanded_bytes > MAX_HYDRATED_LIBRARY_BYTES {
            return Err(AssetStorageError::TooLarge);
        }
        *value = Value::String(hydrated);
        Ok(())
    })
}

fn asset_load_error(error: AssetStorageError) -> CommandError {
    match error {
        AssetStorageError::TooLarge => CommandError::new(
            "DECK_STORAGE_TOO_LARGE",
            "本地套牌资产超过存储上限，原文件未被修改。",
        ),
        AssetStorageError::Io => storage_read_error(),
        AssetStorageError::Invalid | AssetStorageError::Missing | AssetStorageError::Corrupt => {
            corrupt_error()
        }
    }
}

fn asset_save_error(error: AssetStorageError) -> CommandError {
    match error {
        AssetStorageError::TooLarge => {
            CommandError::new("DECK_LIBRARY_TOO_LARGE", "套牌图片资产超过本地存储上限。")
        }
        AssetStorageError::Io => storage_write_error(),
        AssetStorageError::Invalid | AssetStorageError::Missing | AssetStorageError::Corrupt => {
            CommandError::new("INVALID_DECK_LIBRARY", "套牌图片资产无效，原文件未被替换。")
        }
    }
}

fn save_library_at(path: &Path, library: &DeckLibrary) -> Result<(), CommandError> {
    let _process_guard = STORAGE_PROCESS_LOCK
        .lock()
        .map_err(|_| storage_write_error())?;
    let _transaction_lock = acquire_transaction_lock(path).map_err(asset_load_error)?;
    cleanup_stale_manifest_temporaries(path).map_err(asset_save_error)?;
    validate_library(library).map_err(hydrated_save_validation_error)?;

    let assets = asset_directory(path)?;
    let (committed, _, current_fingerprint) = load_persisted_library_at(path)?;
    require_current_manifest(path, current_fingerprint)?;
    let committed_references =
        collect_persisted_asset_references(&committed).map_err(asset_load_error)?;
    verify_persisted_asset_references(&committed, &assets).map_err(asset_load_error)?;

    let mut persisted = library.clone();
    let manifest = externalize_library_assets(&mut persisted).map_err(asset_save_error)?;
    verify_existing_asset_targets(&assets, &manifest).map_err(asset_save_error)?;
    cleanup_asset_store(&assets, &committed_references).map_err(asset_save_error)?;
    validate_persisted_library(&persisted).map_err(persisted_save_validation_error)?;
    let bytes = json_bytes_with_limit(&persisted, MAX_PERSISTED_LIBRARY_BYTES)
        .map_err(|error| persisted_save_validation_error(error.into()))?;

    materialize_asset_manifest(&assets, &manifest).map_err(asset_save_error)?;
    atomic_write(path, &bytes).map_err(|_| storage_write_error())?;
    record_observed_manifest(path, Some(blake3::hash(&bytes)))?;

    let persisted_references =
        collect_persisted_asset_references(&persisted).map_err(asset_save_error)?;
    cleanup_asset_store(&assets, &persisted_references).map_err(asset_save_error)
}

fn validate_library(library: &DeckLibrary) -> Result<(), ValidationError> {
    validate_library_with_limits(library, MAX_HYDRATED_DECK_BYTES, MAX_HYDRATED_LIBRARY_BYTES)
}

fn validate_persisted_library(library: &DeckLibrary) -> Result<(), ValidationError> {
    validate_library_with_limits(
        library,
        MAX_PERSISTED_DECK_BYTES,
        MAX_PERSISTED_LIBRARY_BYTES,
    )
}

fn validate_library_with_limits(
    library: &DeckLibrary,
    maximum_deck_bytes: usize,
    maximum_library_bytes: usize,
) -> Result<(), ValidationError> {
    if library.schema_version != STORAGE_SCHEMA_VERSION {
        return Err(ValidationError::UnsupportedVersion);
    }
    if library.decks.len() > MAX_DECKS {
        return Err(ValidationError::TooManyDecks);
    }

    let mut deck_versions = HashSet::with_capacity(library.decks.len());
    for deck in &library.decks {
        validate_deck(deck)?;
        if json_size_with_limit(deck, maximum_deck_bytes).is_err() {
            return Err(ValidationError::DeckTooLarge);
        }
        if !deck_versions.insert(deck_version_key(deck)) {
            return Err(ValidationError::DuplicateDeckVersion);
        }
    }

    match (
        library.active_deck_id.as_deref(),
        library.active_deck_cid.as_deref(),
        library.active_deck_revision.as_ref(),
    ) {
        (None, None, None) => {}
        (None, _, _) | (Some(_), Some(_), Some(_)) => {
            return Err(ValidationError::InvalidActiveDeck);
        }
        (Some(active_deck_id), active_deck_cid, active_deck_revision) => {
            if !valid_string(active_deck_id, 128)
                || active_deck_cid.is_some_and(|cid| !valid_string(cid, 128))
                || active_deck_revision.is_some_and(|revision| !valid_revision_reference(revision))
                || !active_deck_exists(
                    &library.decks,
                    active_deck_id,
                    active_deck_cid,
                    active_deck_revision,
                )
            {
                return Err(ValidationError::InvalidActiveDeck);
            }
        }
    }

    if json_size_with_limit(library, maximum_library_bytes).is_err() {
        return Err(ValidationError::LibraryTooLarge);
    }
    Ok(())
}

fn validate_deck(deck: &Value) -> Result<(), ValidationError> {
    let object = deck
        .as_object()
        .ok_or(ValidationError::InvalidDeck("套牌必须是对象"))?;
    require_string(object, "id", 128)?;
    require_string(object, "theme", 240)?;
    require_string(object, "name", 160)?;
    let mode_id = require_string(object, "modeId", 32)?;
    if !valid_mode_id(mode_id) {
        return Err(ValidationError::InvalidDeck("套牌玩法无效"));
    }
    require_multiline_text(object, "story", 12_000)?;
    require_multiline_text(object, "rules", 12_000)?;
    require_string(object, "author", 160)?;

    if let Some(revision) = object.get("revision") {
        validate_deck_revision(revision)?;
    }

    if let Some(content_policy) = object.get("contentPolicy") {
        validate_content_policy(content_policy)?;
    }

    let cards = object
        .get("cards")
        .and_then(Value::as_array)
        .filter(|cards| !cards.is_empty() && cards.len() <= MAX_CARDS_PER_DECK)
        .ok_or(ValidationError::InvalidDeck("卡牌数量必须为 1 至 64 张"))?;
    for card in cards {
        validate_card(card)?;
    }

    if let Some(card_back) = object.get("cardBack") {
        validate_card_back(card_back)?;
    }

    if let Some(provenance) = object.get("provenance") {
        validate_provenance(provenance)?;
    }
    Ok(())
}

fn deck_cid(deck: &Value) -> Option<&str> {
    deck.get("provenance")
        .and_then(Value::as_object)
        .and_then(|provenance| provenance.get("cid"))
        .and_then(Value::as_str)
}

fn deck_revision(deck: &Value) -> Option<DeckRevisionReference> {
    let object = deck.get("revision")?.as_object()?;
    Some(DeckRevisionReference {
        family_id: object.get("familyId")?.as_str()?.to_owned(),
        revision: object.get("revision")?.as_u64()?,
    })
}

fn deck_version_key(deck: &Value) -> String {
    if let Some(cid) = deck_cid(deck) {
        let id = deck.get("id").and_then(Value::as_str).unwrap_or_default();
        return format!("signed:{id}:{cid}");
    }
    if let Some(revision) = deck_revision(deck) {
        return format!("revision:{}:{}", revision.family_id, revision.revision);
    }
    let id = deck.get("id").and_then(Value::as_str).unwrap_or_default();
    format!("legacy:{id}")
}

fn valid_revision_reference(revision: &DeckRevisionReference) -> bool {
    valid_string(&revision.family_id, 128) && (1..=MAX_DECK_REVISION).contains(&revision.revision)
}

fn active_deck_exists(
    decks: &[Value],
    active_id: &str,
    active_cid: Option<&str>,
    active_revision: Option<&DeckRevisionReference>,
) -> bool {
    let mut matching_id_count = 0;
    let mut unversioned_match = false;
    for deck in decks {
        if deck.get("id").and_then(Value::as_str) != Some(active_id) {
            continue;
        }
        matching_id_count += 1;
        let cid = deck_cid(deck);
        if let Some(expected_cid) = active_cid {
            if cid == Some(expected_cid) {
                return true;
            }
        } else if let Some(expected_revision) = active_revision {
            if cid.is_none() && deck_revision(deck).as_ref() == Some(expected_revision) {
                return true;
            }
        } else if cid.is_none() && deck_revision(deck).is_none() {
            unversioned_match = true;
        }
    }

    active_cid.is_none()
        && active_revision.is_none()
        && (unversioned_match || matching_id_count == 1)
}

fn validate_deck_revision(revision: &Value) -> Result<(), ValidationError> {
    let object = revision
        .as_object()
        .ok_or(ValidationError::InvalidDeck("套牌版本信息必须是对象"))?;
    if object.len() != 4
        || object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "familyId" | "revision" | "createdAt" | "reason"
            )
        })
    {
        return Err(ValidationError::InvalidDeck("套牌版本字段无效"));
    }
    require_string(object, "familyId", 128)?;
    let valid_revision = object
        .get("revision")
        .and_then(Value::as_u64)
        .is_some_and(|value| (1..=MAX_DECK_REVISION).contains(&value));
    let valid_created_at = object
        .get("createdAt")
        .and_then(Value::as_u64)
        .is_some_and(|value| value <= MAX_JS_SAFE_INTEGER);
    let valid_reason = object
        .get("reason")
        .and_then(Value::as_str)
        .is_some_and(|reason| {
            matches!(
                reason,
                "initial"
                    | "deck-generation"
                    | "card-regeneration"
                    | "manual-snapshot"
                    | "imported"
            )
        });
    if !valid_revision || !valid_created_at || !valid_reason {
        return Err(ValidationError::InvalidDeck("套牌版本信息无效"));
    }
    Ok(())
}

fn validate_content_policy(content_policy: &Value) -> Result<(), ValidationError> {
    let object = content_policy
        .as_object()
        .ok_or(ValidationError::InvalidDeck("套牌创作模式必须是对象"))?;
    let valid_common = object.get("schemaVersion").and_then(Value::as_u64) == Some(1);
    let mode = object.get("mode").and_then(Value::as_str);
    if !valid_common {
        return Err(ValidationError::InvalidDeck("套牌创作模式版本无效"));
    }

    if mode == Some("original") {
        if object.len() == 2
            && object
                .keys()
                .all(|key| matches!(key.as_str(), "schemaVersion" | "mode"))
        {
            return Ok(());
        }
        return Err(ValidationError::InvalidDeck("原创模式字段无效"));
    }

    if mode != Some("fan-study")
        || object.len() != 3
        || object
            .keys()
            .any(|key| !matches!(key.as_str(), "schemaVersion" | "mode" | "agreement"))
    {
        return Err(ValidationError::InvalidDeck("个人同人研习模式字段无效"));
    }
    let agreement = object
        .get("agreement")
        .and_then(Value::as_object)
        .ok_or(ValidationError::InvalidDeck("个人同人研习确认必须是对象"))?;
    if agreement.len() != 3
        || agreement.keys().any(|key| {
            !matches!(
                key.as_str(),
                "termsVersion" | "acceptedAt" | "confirmations"
            )
        })
    {
        return Err(ValidationError::InvalidDeck("个人同人研习确认字段无效"));
    }
    require_string(agreement, "termsVersion", 32)?;
    let confirmations = agreement
        .get("confirmations")
        .and_then(Value::as_object)
        .ok_or(ValidationError::InvalidDeck("个人同人研习勾选项必须是对象"))?;
    let confirmation_fields = [
        "materialsRightsConfirmed",
        "personalNonCommercialConfirmed",
        "unofficialAndUnaffiliatedConfirmed",
        "guardianJointlyConfirmed",
    ];
    if confirmations.len() != confirmation_fields.len()
        || confirmations
            .keys()
            .any(|key| !confirmation_fields.contains(&key.as_str()))
        || confirmation_fields
            .iter()
            .any(|field| !confirmations.get(*field).is_some_and(Value::is_boolean))
    {
        return Err(ValidationError::InvalidDeck("个人同人研习勾选项无效"));
    }

    let fully_accepted = confirmation_fields
        .iter()
        .all(|field| confirmations.get(*field).and_then(Value::as_bool) == Some(true));
    let accepted_at = agreement.get("acceptedAt");
    let valid_accepted_at = if fully_accepted {
        accepted_at
            .and_then(Value::as_u64)
            .is_some_and(|value| value <= MAX_JS_SAFE_INTEGER)
    } else {
        accepted_at.is_some_and(Value::is_null)
    };
    if !valid_accepted_at {
        return Err(ValidationError::InvalidDeck("个人同人研习确认时间无效"));
    }
    Ok(())
}

fn validate_card(card: &Value) -> Result<(), ValidationError> {
    let object = card
        .as_object()
        .ok_or(ValidationError::InvalidDeck("卡牌必须是对象"))?;
    require_string(object, "id", 128)?;
    require_string(object, "name", 160)?;
    require_string(object, "title", 240)?;
    let mode_id = require_string(object, "modeId", 32)?;
    if !valid_mode_id(mode_id) {
        return Err(ValidationError::InvalidDeck("卡牌玩法无效"));
    }
    require_string(object, "artUrl", MAX_ART_URL_CHARS)?;
    require_multiline_text(object, "skill", 4_000)?;
    require_multiline_text(object, "flavor", 4_000)?;
    let rarity = require_string(object, "rarity", 16)?;
    if !matches!(rarity, "普通" | "稀有" | "史诗" | "传说") {
        return Err(ValidationError::InvalidDeck("卡牌稀有度无效"));
    }
    require_string(object, "author", 160)?;

    if let Some(style) = object.get("inscriptionStyle")
        && !style
            .as_str()
            .is_some_and(|style| matches!(style, "seal" | "signature"))
    {
        return Err(ValidationError::InvalidDeck("卡牌题记样式无效"));
    }
    if let Some(placement) = object.get("inscriptionPlacement")
        && !placement
            .as_str()
            .is_some_and(|placement| matches!(placement, "front" | "back"))
    {
        return Err(ValidationError::InvalidDeck("卡牌题记位置无效"));
    }

    validate_card_gameplay(object.get("gameplay"))
        .map_err(|_| ValidationError::InvalidDeck("卡牌玩法绑定无效"))?;

    for field in ["attack", "defense", "cost"] {
        let valid = object
            .get(field)
            .and_then(Value::as_i64)
            .is_some_and(|value| (0..=999).contains(&value));
        if !valid {
            return Err(ValidationError::InvalidDeck("卡牌数值必须为 0 至 999"));
        }
    }
    Ok(())
}

fn validate_card_back(card_back: &Value) -> Result<(), ValidationError> {
    let object = card_back
        .as_object()
        .ok_or(ValidationError::InvalidDeck("卡背设计必须是对象"))?;
    let style = require_string(object, "style", 32)?;
    if !matches!(style, "forge" | "constellation" | "circuit" | "sigil") {
        return Err(ValidationError::InvalidDeck("卡背设计样式无效"));
    }
    let valid_seed = object
        .get("seed")
        .and_then(Value::as_i64)
        .is_some_and(|seed| (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&seed));
    if !valid_seed {
        return Err(ValidationError::InvalidDeck("卡背设计种子无效"));
    }
    require_string(object, "label", 160)?;
    if let Some(texture_url) = object.get("textureUrl")
        && !texture_url
            .as_str()
            .is_some_and(|value| valid_string(value, MAX_ART_URL_CHARS))
    {
        return Err(ValidationError::InvalidDeck("卡背纹理地址无效"));
    }
    Ok(())
}

fn validate_provenance(provenance: &Value) -> Result<(), ValidationError> {
    let object = provenance
        .as_object()
        .ok_or(ValidationError::InvalidDeck("套牌来源信息必须是对象"))?;
    require_string(object, "cid", 128)?;
    require_string(object, "signerPeerId", 128)?;
    if object.contains_key("publicKey") {
        require_string(object, "publicKey", 256)?;
    }
    require_string(object, "signature", 512)?;
    Ok(())
}

fn require_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
    maximum_chars: usize,
) -> Result<&'a str, ValidationError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| valid_string(value, maximum_chars))
        .ok_or(ValidationError::InvalidDeck("套牌字段缺失或无效"))
}

fn require_multiline_text<'a>(
    object: &'a Map<String, Value>,
    field: &str,
    maximum_chars: usize,
) -> Result<&'a str, ValidationError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| valid_multiline_text(value, maximum_chars))
        .ok_or(ValidationError::InvalidDeck("套牌文本字段缺失或无效"))
}

fn valid_string(value: &str, maximum_chars: usize) -> bool {
    !value.is_empty()
        && value.chars().count() <= maximum_chars
        && !value.chars().any(char::is_control)
}

fn valid_multiline_text(value: &str, maximum_chars: usize) -> bool {
    !value.is_empty()
        && value.chars().count() <= maximum_chars
        && !value
            .chars()
            .any(|character| character.is_control() && character != '\n')
}

fn valid_mode_id(value: &str) -> bool {
    matches!(
        value,
        "reflex" | "memory" | "strategy" | "expression" | "mischief"
    )
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing parent directory"))?;
    fs::create_dir_all(parent)?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(LIBRARY_FILE_NAME);
    let temporary_path = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let mut temporary_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)?;

    let write_result = (|| {
        temporary_file.write_all(bytes)?;
        temporary_file.sync_all()?;
        drop(temporary_file);
        fs::rename(&temporary_path, path)?;
        sync_directory(parent)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn read_bounded(file: File, maximum_bytes: usize) -> Result<Vec<u8>, BoundedReadError> {
    if file.metadata().map_err(|_| BoundedReadError::Io)?.len() > maximum_bytes as u64 {
        return Err(BoundedReadError::TooLarge);
    }

    let mut bytes = Vec::new();
    file.take(maximum_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| BoundedReadError::Io)?;
    if bytes.len() > maximum_bytes {
        Err(BoundedReadError::TooLarge)
    } else {
        Ok(bytes)
    }
}

fn json_size_with_limit<T: ?Sized + Serialize>(
    value: &T,
    maximum_bytes: usize,
) -> Result<usize, JsonLimitError> {
    let mut writer = BoundedWriter::new(maximum_bytes, false);
    let result = serde_json::to_writer(&mut writer, value);
    match result {
        Ok(()) => Ok(writer.bytes_written),
        Err(_) if writer.exceeded => Err(JsonLimitError::TooLarge),
        Err(_) => Err(JsonLimitError::Serialization),
    }
}

fn json_bytes_with_limit<T: ?Sized + Serialize>(
    value: &T,
    maximum_bytes: usize,
) -> Result<Vec<u8>, JsonLimitError> {
    let mut writer = BoundedWriter::new(maximum_bytes, true);
    let result = serde_json::to_writer(&mut writer, value);
    match result {
        Ok(()) => Ok(writer.bytes),
        Err(_) if writer.exceeded => Err(JsonLimitError::TooLarge),
        Err(_) => Err(JsonLimitError::Serialization),
    }
}

struct BoundedWriter {
    bytes: Vec<u8>,
    bytes_written: usize,
    maximum_bytes: usize,
    retain_bytes: bool,
    exceeded: bool,
}

impl BoundedWriter {
    fn new(maximum_bytes: usize, retain_bytes: bool) -> Self {
        Self {
            bytes: Vec::new(),
            bytes_written: 0,
            maximum_bytes,
            retain_bytes,
            exceeded: false,
        }
    }
}

impl Write for BoundedWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let Some(next_size) = self.bytes_written.checked_add(buffer.len()) else {
            self.exceeded = true;
            return Err(io::Error::other("JSON too large"));
        };
        if next_size > self.maximum_bytes {
            self.exceeded = true;
            return Err(io::Error::other("JSON too large"));
        }
        if self.retain_bytes {
            self.bytes.extend_from_slice(buffer);
        }
        self.bytes_written = next_size;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum JsonLimitError {
    TooLarge,
    Serialization,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BoundedReadError {
    TooLarge,
    Io,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ValidationError {
    UnsupportedVersion,
    TooManyDecks,
    DeckTooLarge,
    LibraryTooLarge,
    DuplicateDeckVersion,
    InvalidActiveDeck,
    InvalidDeck(&'static str),
    Serialization,
}

impl From<JsonLimitError> for ValidationError {
    fn from(error: JsonLimitError) -> Self {
        match error {
            JsonLimitError::TooLarge => Self::LibraryTooLarge,
            JsonLimitError::Serialization => Self::Serialization,
        }
    }
}

fn hydrated_save_validation_error(error: ValidationError) -> CommandError {
    save_validation_error(error, "24 MiB", "64 MiB")
}

fn persisted_save_validation_error(error: ValidationError) -> CommandError {
    save_validation_error(error, "24 MiB", "96 MiB")
}

fn save_validation_error(
    error: ValidationError,
    maximum_deck_size: &'static str,
    maximum_library_size: &'static str,
) -> CommandError {
    match error {
        ValidationError::UnsupportedVersion => CommandError::new(
            "DECK_LIBRARY_UNSUPPORTED_VERSION",
            "套牌库版本不受支持，无法保存。",
        ),
        ValidationError::TooManyDecks => CommandError::new(
            "DECK_LIBRARY_CAPACITY_EXCEEDED",
            "本地最多保存 128 套套牌。",
        ),
        ValidationError::DeckTooLarge => CommandError::new(
            "DECK_TOO_LARGE",
            format!("单套套牌的数据不得超过 {maximum_deck_size}。"),
        ),
        ValidationError::LibraryTooLarge => CommandError::new(
            "DECK_LIBRARY_TOO_LARGE",
            format!("套牌库的数据不得超过 {maximum_library_size}。"),
        ),
        ValidationError::DuplicateDeckVersion => {
            CommandError::new("DUPLICATE_DECK_VERSION", "套牌库中存在重复的套牌版本。")
        }
        ValidationError::InvalidActiveDeck => CommandError::new(
            "INVALID_ACTIVE_DECK",
            "当前套牌 ID 必须指向套牌库中已有的套牌。",
        ),
        ValidationError::InvalidDeck(detail) => CommandError::new("INVALID_DECK_LIBRARY", detail),
        ValidationError::Serialization => {
            CommandError::new("INVALID_DECK_LIBRARY", "套牌库无法编码为 JSON。")
        }
    }
}

fn load_validation_error(error: ValidationError) -> CommandError {
    match error {
        ValidationError::UnsupportedVersion => CommandError::new(
            "DECK_STORAGE_UNSUPPORTED_VERSION",
            "本地套牌库由较新版本创建，当前版本无法读取，原文件未被修改。",
        ),
        ValidationError::DeckTooLarge | ValidationError::LibraryTooLarge => CommandError::new(
            "DECK_STORAGE_TOO_LARGE",
            "本地套牌库超过存储上限，原文件未被修改。",
        ),
        _ => corrupt_error(),
    }
}

fn storage_read_error() -> CommandError {
    CommandError::new("DECK_STORAGE_READ_FAILED", "无法读取本地套牌库。")
}

fn storage_write_error() -> CommandError {
    CommandError::new(
        "DECK_STORAGE_WRITE_FAILED",
        "无法保存本地套牌库，原文件未被替换。",
    )
}

fn corrupt_error() -> CommandError {
    CommandError::new(
        "DECK_STORAGE_CORRUPT",
        "本地套牌库已损坏或格式无效，原文件未被修改。",
    )
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::{Cursor, Write as _},
        path::{Path, PathBuf},
    };

    use base64::Engine as _;
    use serde_json::{Value, json};
    use uuid::Uuid;

    use super::{
        ASSET_DIRECTORY, ASSET_FILE_SUFFIX, ASSET_REFERENCE_PREFIX, AssetEncoding, AssetManifest,
        AssetRecord, AssetStorageError, BASE64_PADDED, DeckLibrary, DeckRevisionReference,
        JsonLimitError, MAX_ART_URL_CHARS, MAX_ASSET_BYTES, MAX_ASSET_STORE_BYTES, MAX_DECKS,
        PROJECT_FORMAT, PROJECT_MANIFEST_NAME, STORAGE_SCHEMA_VERSION, TRANSACTION_LOCK_FILE_NAME,
        ValidationError, build_project_archive, decode_project_archive_base64,
        encode_asset_data_url, json_size_with_limit, load_library_at, matching_raster_signature,
        materialize_asset_manifest, read_project_archive, save_library_at, validate_library,
        validate_persisted_library, validate_project_archive_bytes,
    };
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("wanxiang-deck-storage-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }

        fn library_path(&self) -> PathBuf {
            self.0.join("nested").join("library.json")
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn deck(id: &str) -> serde_json::Value {
        json!({
            "id": id,
            "theme": "云海机械城",
            "name": "云海守卫",
            "modeId": "strategy",
            "story": "一座漂浮在云海中的机械城市。",
            "rules": "部署卡牌并守住核心。",
            "cards": [{
                "id": format!("{id}-card"),
                "name": "铜翼守卫",
                "title": "云海先锋",
                "modeId": "strategy",
                "artUrl": "/assets/cards/strategy.jpg",
                "attack": 5,
                "defense": 6,
                "cost": 3,
                "skill": "入场时获得一点护盾。",
                "flavor": "齿轮转动，风暴止息。",
                "rarity": "稀有",
                "author": "南星"
            }],
            "author": "南星"
        })
    }

    fn library(ids: &[&str], active_deck_id: Option<&str>) -> DeckLibrary {
        DeckLibrary {
            schema_version: STORAGE_SCHEMA_VERSION,
            active_deck_id: active_deck_id.map(str::to_owned),
            active_deck_cid: None,
            active_deck_revision: None,
            decks: ids.iter().map(|id| deck(id)).collect(),
        }
    }

    fn received_deck(id: &str, cid: &str, story: &str) -> serde_json::Value {
        let mut value = deck(id);
        value["story"] = json!(story);
        value["provenance"] = json!({
            "cid": cid,
            "signerPeerId": "12D3KooWTestPeer",
            "signature": "signed-version"
        });
        value
    }

    fn png_bytes_with_dimensions(width: u32, height: u32, suffix: &[u8]) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&13_u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(suffix);
        bytes
    }

    fn png_bytes(suffix: &[u8]) -> Vec<u8> {
        png_bytes_with_dimensions(512, 720, suffix)
    }

    fn jpeg_bytes(width: u16, height: u16) -> Vec<u8> {
        let mut bytes = vec![0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08];
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&[1, 1, 0x11, 0]);
        bytes
    }

    fn webp_bytes(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&22_u32.to_le_bytes());
        bytes.extend_from_slice(b"WEBPVP8X");
        bytes.extend_from_slice(&10_u32.to_le_bytes());
        bytes.extend_from_slice(&[0; 4]);
        let width = width - 1;
        let height = height - 1;
        bytes.extend_from_slice(&width.to_le_bytes()[..3]);
        bytes.extend_from_slice(&height.to_le_bytes()[..3]);
        bytes
    }

    fn png_data_url(bytes: &[u8], encoding: AssetEncoding) -> String {
        encode_asset_data_url("image/png", encoding, bytes)
    }

    fn deck_with_art(id: &str, art_url: &str) -> serde_json::Value {
        let mut value = deck(id);
        value["cards"][0]["artUrl"] = json!(art_url);
        value
    }

    fn library_with_decks(decks: Vec<serde_json::Value>) -> DeckLibrary {
        DeckLibrary {
            schema_version: STORAGE_SCHEMA_VERSION,
            active_deck_id: None,
            active_deck_cid: None,
            active_deck_revision: None,
            decks,
        }
    }

    #[test]
    fn project_archive_round_trips_deck_metadata_and_raster_assets() {
        let directory = TestDirectory::new();
        let path = directory.0.join("云海守卫.artdeck");
        let artwork = png_data_url(&png_bytes(b"project-artwork"), AssetEncoding::Padded);
        let mut expected = deck_with_art("project-roundtrip", &artwork);
        expected["author"] = json!("流云");
        expected["cards"][0]["author"] = json!("流云");
        expected["cards"][0]["inscriptionText"] = json!("流云");
        expected["creatorPlaque"] = json!({
            "displayName": "流云",
            "signatureText": "流云",
            "edition": "工程文件版"
        });

        let bytes = build_project_archive(expected.clone()).expect("build project archive");
        assert!(bytes.starts_with(b"PK"));
        fs::write(&path, bytes).expect("write project fixture");
        let imported = read_project_archive(&path).expect("read project archive");
        assert_eq!(imported, expected);
    }

    #[test]
    fn accepts_frontend_v2_project_archives_for_desktop_file_dialogs() {
        let mut project = deck("frontend-v2");
        project["cards"][0]["artUrl"] = json!("assets/cards/001-frontend-v2-card.png");
        let manifest = json!({
            "format": PROJECT_FORMAT,
            "formatVersion": 2,
            "exportedAt": 1,
            "deck": project
        });
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .unix_permissions(0o600);
        writer
            .start_file(PROJECT_MANIFEST_NAME, options)
            .expect("start manifest");
        writer
            .write_all(
                serde_json::to_vec(&manifest)
                    .expect("serialize manifest")
                    .as_slice(),
            )
            .expect("write manifest");
        writer
            .start_file("assets/cards/001-frontend-v2-card.png", options)
            .expect("start artwork");
        writer
            .write_all(&png_bytes(b"frontend-v2-artwork"))
            .expect("write artwork");
        let bytes = writer.finish().expect("finish archive").into_inner();

        validate_project_archive_bytes(&bytes).expect("valid frontend project");
        let encoded = BASE64_PADDED.encode(&bytes);
        assert_eq!(
            decode_project_archive_base64(&format!("data:application/zip;base64,{encoded}"))
                .expect("decode project"),
            bytes
        );
    }

    fn assets_path(library_path: &Path) -> PathBuf {
        library_path
            .parent()
            .expect("library parent")
            .join(ASSET_DIRECTORY)
    }

    fn asset_path(library_path: &Path, bytes: &[u8]) -> PathBuf {
        assets_path(library_path).join(format!(
            "{}{}",
            blake3::hash(bytes).to_hex(),
            ASSET_FILE_SUFFIX
        ))
    }

    fn asset_files(library_path: &Path) -> Vec<PathBuf> {
        let assets = assets_path(library_path);
        let Ok(entries) = fs::read_dir(assets) else {
            return Vec::new();
        };
        entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|extension| extension.to_str()) == Some("bin"))
            .collect()
    }

    fn persisted_library(library_path: &Path) -> serde_json::Value {
        serde_json::from_slice(&fs::read(library_path).expect("read persisted library"))
            .expect("parse persisted library")
    }

    fn assert_no_asset_temporary_files(library_path: &Path) {
        let assets = assets_path(library_path);
        let Ok(entries) = fs::read_dir(assets) else {
            return;
        };
        assert!(
            entries
                .filter_map(Result::ok)
                .all(|entry| { !entry.file_name().to_string_lossy().ends_with(".tmp") })
        );
    }

    #[test]
    fn missing_file_returns_an_empty_versioned_library() {
        let directory = TestDirectory::new();
        assert_eq!(
            load_library_at(&directory.library_path()).expect("missing library"),
            DeckLibrary::default()
        );
    }

    #[test]
    fn validates_png_jpeg_and_webp_dimensions_inside_the_declared_container() {
        assert!(matching_raster_signature(
            "image/png",
            &png_bytes_with_dimensions(512, 720, b"valid")
        ));
        assert!(matching_raster_signature(
            "image/jpeg",
            &jpeg_bytes(512, 720)
        ));
        assert!(matching_raster_signature(
            "image/webp",
            &webp_bytes(512, 720)
        ));

        assert!(!matching_raster_signature(
            "image/png",
            &png_bytes_with_dimensions(4_097, 1, b"wide")
        ));
        assert!(!matching_raster_signature(
            "image/jpeg",
            &jpeg_bytes(4_096, 4_096)
        ));
        assert!(!matching_raster_signature(
            "image/webp",
            &webp_bytes(1, 4_097)
        ));

        let mut trailing_chunk = b"RIFF\x04\0\0\0WEBP".to_vec();
        trailing_chunk.extend_from_slice(&webp_bytes(512, 720)[12..]);
        assert!(!matching_raster_signature("image/webp", &trailing_chunk));
    }

    #[test]
    fn preserves_noncanonical_inline_rasters_but_still_rejects_dimension_bombs() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let valid = format!(
            "data:IMAGE/PNG;BASE64,{}",
            base64::engine::general_purpose::STANDARD.encode(png_bytes(b"legacy-case"))
        );
        let expected = library_with_decks(vec![deck_with_art("legacy-case", &valid)]);
        save_library_at(&path, &expected).expect("preserve safe noncanonical inline raster");
        assert_eq!(
            load_library_at(&path).expect("reload inline raster"),
            expected
        );
        assert!(
            fs::read_to_string(&path)
                .expect("read manifest")
                .contains(&valid)
        );

        let oversized = format!(
            "data:IMAGE/PNG;BASE64,{}",
            base64::engine::general_purpose::STANDARD.encode(png_bytes_with_dimensions(
                4_097,
                1,
                b"dimension-bomb"
            ))
        );
        let error = save_library_at(
            &path,
            &library_with_decks(vec![deck_with_art("oversized-inline", &oversized)]),
        )
        .expect_err("reject unsafe noncanonical inline raster");
        assert_eq!(error.code, "INVALID_DECK_LIBRARY");
    }

    #[test]
    fn rejects_stale_writes_after_an_external_manifest_change() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let initial = library(&["initial"], Some("initial"));
        save_library_at(&path, &initial).expect("save observed library");

        let external = library(&["external"], Some("external"));
        let external_bytes = serde_json::to_vec(&external).expect("serialize external change");
        fs::write(&path, &external_bytes).expect("simulate another process");
        let error = save_library_at(&path, &library(&["stale"], Some("stale")))
            .expect_err("stale writer must fail");
        assert_eq!(error.code, "DECK_STORAGE_CONFLICT");
        assert_eq!(
            fs::read(&path).expect("preserved external change"),
            external_bytes
        );
    }

    #[test]
    fn garbage_collects_only_exact_managed_names() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let parent = path.parent().expect("library parent");
        let assets = assets_path(&path);
        fs::create_dir_all(&assets).expect("create asset directory");
        let uuid = Uuid::new_v4();
        let digest = "a".repeat(64);
        let manifest_temp = parent.join(format!(".library.json.{uuid}.tmp"));
        let asset_temp = assets.join(format!(".{digest}.{uuid}.tmp"));
        let orphan = assets.join(format!("{digest}.bin"));
        let near_miss = assets.join(format!(".{digest}.{uuid}.tmp.keep"));
        let unknown = assets.join("artist-notes.bin");
        let temp_shaped_directory = assets.join(format!(".{digest}.{}.tmp", Uuid::new_v4()));
        fs::write(&manifest_temp, b"stale").expect("write manifest temp");
        fs::write(&asset_temp, b"stale").expect("write asset temp");
        fs::write(&orphan, b"orphan").expect("write orphan");
        fs::write(&near_miss, b"keep").expect("write near miss");
        fs::write(&unknown, b"keep").expect("write unknown file");
        fs::create_dir(&temp_shaped_directory).expect("create unknown directory");

        load_library_at(&path).expect("load and clean storage");
        assert!(!manifest_temp.exists());
        assert!(!asset_temp.exists());
        assert!(!orphan.exists());
        assert!(near_miss.exists());
        assert!(unknown.exists());
        assert!(temp_shaped_directory.is_dir());
    }

    #[test]
    fn removes_unreferenced_blobs_only_after_the_new_manifest_commits() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let bytes = png_bytes(b"old-art");
        let initial = library_with_decks(vec![deck_with_art(
            "with-art",
            &png_data_url(&bytes, AssetEncoding::Padded),
        )]);
        save_library_at(&path, &initial).expect("save initial asset");
        let old_asset = asset_path(&path, &bytes);
        assert!(old_asset.exists());

        save_library_at(&path, &library_with_decks(vec![deck("without-art")]))
            .expect("commit replacement");
        assert!(!old_asset.exists());
        assert_eq!(
            load_library_at(&path).expect("load replacement"),
            library_with_decks(vec![deck("without-art")])
        );
    }

    #[test]
    fn enforces_the_aggregate_managed_asset_store_cap_before_publication() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let assets = assets_path(&path);
        fs::create_dir_all(&assets).expect("create assets");
        let occupied = assets.join(format!("{}{}", "a".repeat(64), ASSET_FILE_SUFFIX));
        fs::File::create(&occupied)
            .expect("create occupied blob")
            .set_len(MAX_ASSET_STORE_BYTES as u64)
            .expect("set sparse blob size");

        let bytes = png_bytes(b"new-asset");
        let digest = blake3::hash(&bytes).to_hex().to_string();
        let target = assets.join(format!("{digest}{ASSET_FILE_SUFFIX}"));
        let mut manifest = AssetManifest::new();
        manifest.insert(
            digest,
            AssetRecord {
                mime_type: "image/png",
                bytes,
            },
        );
        assert_eq!(
            materialize_asset_manifest(&assets, &manifest),
            Err(AssetStorageError::TooLarge)
        );
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_cross_process_lock_file() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new();
        let path = directory.library_path();
        let parent = path.parent().expect("library parent");
        fs::create_dir_all(parent).expect("create parent");
        let target = directory.0.join("lock-target");
        fs::write(&target, b"target").expect("write lock target");
        symlink(&target, parent.join(TRANSACTION_LOCK_FILE_NAME)).expect("symlink lock file");

        let error = load_library_at(&path).expect_err("symlink lock must fail closed");
        assert_eq!(error.code, "DECK_STORAGE_CORRUPT");
    }

    #[test]
    fn atomically_roundtrips_and_replaces_a_library() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let initial = library(&["first"], Some("first"));
        save_library_at(&path, &initial).expect("save initial library");
        assert_eq!(load_library_at(&path).expect("load initial"), initial);

        let replacement = library(&["second", "third"], Some("third"));
        save_library_at(&path, &replacement).expect("replace library");
        assert_eq!(
            load_library_at(&path).expect("load replacement"),
            replacement
        );

        let temporary_files = fs::read_dir(path.parent().expect("library parent"))
            .expect("read storage directory")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(temporary_files, 0);
    }

    #[test]
    fn stores_shared_revision_art_once_and_roundtrips_exactly() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let bytes = png_bytes(b"shared-revision-art");
        let art_url = png_data_url(&bytes, AssetEncoding::Padded);
        let mut first = deck_with_art("shared-revision", &art_url);
        first["revision"] = json!({
            "familyId": "shared-family",
            "revision": 1,
            "createdAt": 1_800_000_000_000_u64,
            "reason": "initial"
        });
        let mut second = first.clone();
        second["revision"]["revision"] = json!(2);
        second["revision"]["createdAt"] = json!(1_800_000_100_000_u64);
        second["revision"]["reason"] = json!("card-regeneration");
        let expected = DeckLibrary {
            schema_version: STORAGE_SCHEMA_VERSION,
            active_deck_id: Some("shared-revision".to_owned()),
            active_deck_cid: None,
            active_deck_revision: Some(DeckRevisionReference {
                family_id: "shared-family".to_owned(),
                revision: 2,
            }),
            decks: vec![first, second],
        };

        save_library_at(&path, &expected).expect("save revision library");
        let raw = fs::read_to_string(&path).expect("read raw library");
        assert!(!raw.contains("data:image/"));
        assert_eq!(asset_files(&path).len(), 1);
        assert_eq!(
            load_library_at(&path).expect("load revision library"),
            expected
        );

        save_library_at(&path, &expected).expect("idempotent second save");
        assert_eq!(asset_files(&path).len(), 1);
        assert_eq!(
            load_library_at(&path).expect("reload revision library"),
            expected
        );
        assert_no_asset_temporary_files(&path);
    }

    #[test]
    fn shares_bytes_between_padded_and_unpadded_data_urls_without_rewriting_them() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let bytes = png_bytes(b"xy");
        assert_ne!(bytes.len() % 3, 0, "fixture must exercise base64 padding");
        let padded = png_data_url(&bytes, AssetEncoding::Padded);
        let unpadded = png_data_url(&bytes, AssetEncoding::NoPad);
        let expected = library_with_decks(vec![
            deck_with_art("padded", &padded),
            deck_with_art("unpadded", &unpadded),
        ]);

        save_library_at(&path, &expected).expect("save encoding variants");
        let raw = persisted_library(&path);
        let padded_reference = raw["decks"][0]["cards"][0]["artUrl"]
            .as_str()
            .expect("padded reference");
        let unpadded_reference = raw["decks"][1]["cards"][0]["artUrl"]
            .as_str()
            .expect("unpadded reference");
        assert!(padded_reference.ends_with(":padded"));
        assert!(unpadded_reference.ends_with(":nopad"));
        assert_eq!(asset_files(&path).len(), 1);
        assert_eq!(load_library_at(&path).expect("load variants"), expected);
    }

    #[test]
    fn deduplicates_card_front_and_card_back_assets() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let bytes = png_bytes(b"front-and-back");
        let data_url = png_data_url(&bytes, AssetEncoding::Padded);
        let mut value = deck_with_art("matching-back", &data_url);
        value["cardBack"] = json!({
            "style": "forge",
            "seed": 7,
            "label": "同源纹样",
            "textureUrl": data_url
        });
        let expected = library_with_decks(vec![value]);

        save_library_at(&path, &expected).expect("save shared front and back");
        assert_eq!(asset_files(&path).len(), 1);
        assert_eq!(load_library_at(&path).expect("load shared asset"), expected);
    }

    #[test]
    fn loads_legacy_inline_assets_and_migrates_them_on_the_next_save() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let bytes = png_bytes(b"legacy-inline");
        let data_url = png_data_url(&bytes, AssetEncoding::Padded);
        let expected = library_with_decks(vec![deck_with_art("legacy-inline", &data_url)]);
        fs::create_dir_all(path.parent().expect("library parent")).expect("create parent");
        fs::write(
            &path,
            serde_json::to_vec(&expected).expect("serialize legacy library"),
        )
        .expect("write legacy library");

        assert_eq!(
            load_library_at(&path).expect("load legacy inline"),
            expected
        );
        assert!(asset_files(&path).is_empty());

        save_library_at(&path, &expected).expect("migrate legacy library");
        assert!(
            !fs::read_to_string(&path)
                .expect("read migrated library")
                .contains("data:image/")
        );
        assert_eq!(asset_files(&path).len(), 1);
        assert_eq!(
            load_library_at(&path).expect("load migrated library"),
            expected
        );
    }

    #[test]
    fn rejects_missing_truncated_and_modified_assets() {
        for corruption in ["missing", "truncated", "modified"] {
            let directory = TestDirectory::new();
            let path = directory.library_path();
            let bytes = png_bytes(format!("asset-{corruption}").as_bytes());
            let data_url = png_data_url(&bytes, AssetEncoding::Padded);
            let expected = library_with_decks(vec![deck_with_art(corruption, &data_url)]);
            save_library_at(&path, &expected).expect("save corruption fixture");
            let asset = asset_path(&path, &bytes);

            match corruption {
                "missing" => fs::remove_file(&asset).expect("remove asset"),
                "truncated" => fs::write(&asset, &bytes[..8]).expect("truncate asset"),
                "modified" => {
                    let mut modified = bytes.clone();
                    *modified.last_mut().expect("asset body") ^= 0x01;
                    fs::write(&asset, modified).expect("modify asset");
                }
                _ => unreachable!(),
            }

            let error = load_library_at(&path).expect_err("corrupt asset must fail");
            assert_eq!(error.code, "DECK_STORAGE_CORRUPT", "case: {corruption}");
        }
    }

    #[test]
    fn rejects_an_asset_with_a_valid_digest_but_the_wrong_magic_bytes() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let bytes = b"not-a-png-but-the-digest-is-correct";
        let digest = blake3::hash(bytes).to_hex();
        let reference = format!("{ASSET_REFERENCE_PREFIX}blake3:{digest}:png:padded");
        let expected = library_with_decks(vec![deck_with_art("wrong-magic", &reference)]);
        fs::create_dir_all(assets_path(&path)).expect("create assets");
        fs::write(asset_path(&path, bytes), bytes).expect("write invalid raster");
        fs::write(
            &path,
            serde_json::to_vec(&expected).expect("serialize persisted library"),
        )
        .expect("write persisted library");

        let error = load_library_at(&path).expect_err("wrong magic must fail");
        assert_eq!(error.code, "DECK_STORAGE_CORRUPT");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_asset_blobs() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new();
        let path = directory.library_path();
        let bytes = png_bytes(b"symlinked");
        let data_url = png_data_url(&bytes, AssetEncoding::Padded);
        let expected = library_with_decks(vec![deck_with_art("symlinked", &data_url)]);
        save_library_at(&path, &expected).expect("save symlink fixture");
        let asset = asset_path(&path, &bytes);
        let target = assets_path(&path).join("symlink-target.bin");
        fs::write(&target, &bytes).expect("write symlink target");
        fs::remove_file(&asset).expect("remove real asset");
        symlink(&target, &asset).expect("create asset symlink");

        let error = load_library_at(&path).expect_err("symlink asset must fail");
        assert_eq!(error.code, "DECK_STORAGE_CORRUPT");
    }

    #[test]
    fn refuses_to_replace_an_index_when_an_old_reachable_asset_is_corrupt() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let bytes = png_bytes(b"old-reachable");
        let data_url = png_data_url(&bytes, AssetEncoding::Padded);
        let initial = library_with_decks(vec![deck_with_art("initial", &data_url)]);
        save_library_at(&path, &initial).expect("save initial library");
        fs::write(asset_path(&path, &bytes), b"damaged").expect("damage old asset");
        let original_index = fs::read(&path).expect("read original index");

        let replacement = library_with_decks(vec![deck("replacement")]);
        let error = save_library_at(&path, &replacement)
            .expect_err("save must preserve an index with corrupt reachable assets");
        assert_eq!(error.code, "DECK_STORAGE_CORRUPT");
        assert_eq!(
            fs::read(&path).expect("read preserved index"),
            original_index
        );
        assert_no_asset_temporary_files(&path);
    }

    #[test]
    fn rejects_malformed_asset_references_before_resolving_any_path() {
        let valid_digest = "a".repeat(64);
        let invalid_references = [
            format!("{ASSET_REFERENCE_PREFIX}blake3:../outside:png:padded"),
            format!(
                "{ASSET_REFERENCE_PREFIX}blake3:{}/:png:padded",
                "a".repeat(63)
            ),
            format!(
                "{ASSET_REFERENCE_PREFIX}blake3:{}:png:padded",
                "a".repeat(63)
            ),
            format!(
                "{ASSET_REFERENCE_PREFIX}blake3:{}:png:padded",
                "a".repeat(65)
            ),
            format!(
                "{ASSET_REFERENCE_PREFIX}blake3:{}:png:padded",
                "A".repeat(64)
            ),
            format!("{ASSET_REFERENCE_PREFIX}blake3:{valid_digest}:gif:padded"),
            format!("{ASSET_REFERENCE_PREFIX}blake3:{valid_digest}:png:urlsafe"),
        ];

        for (index, reference) in invalid_references.into_iter().enumerate() {
            let directory = TestDirectory::new();
            let path = directory.library_path();
            let persisted = library_with_decks(vec![deck_with_art(
                &format!("invalid-reference-{index}"),
                &reference,
            )]);
            fs::create_dir_all(path.parent().expect("library parent")).expect("create parent");
            fs::write(
                &path,
                serde_json::to_vec(&persisted).expect("serialize invalid reference"),
            )
            .expect("write invalid reference");

            let original = fs::read(&path).expect("read original index");
            let error = load_library_at(&path).expect_err("invalid reference must fail");
            assert_eq!(error.code, "DECK_STORAGE_CORRUPT", "case: {reference}");
            assert_eq!(fs::read(&path).expect("read preserved index"), original);
            assert!(!assets_path(&path).exists());
        }
    }

    #[test]
    fn rejects_an_asset_over_four_mib_before_writing_the_index() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let mut bytes = vec![0_u8; MAX_ASSET_BYTES + 1];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        let data_url = png_data_url(&bytes, AssetEncoding::Padded);
        assert!(data_url.chars().count() <= MAX_ART_URL_CHARS);
        let oversized = library_with_decks(vec![deck_with_art("oversized-asset", &data_url)]);

        let error = save_library_at(&path, &oversized).expect_err("oversized asset must fail");
        assert_eq!(error.code, "DECK_LIBRARY_TOO_LARGE");
        assert!(!path.exists());
        assert!(asset_files(&path).is_empty());
        assert_no_asset_temporary_files(&path);
    }

    #[test]
    fn never_overwrites_an_existing_blob_with_the_expected_digest_but_wrong_bytes() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let expected_bytes = png_bytes(b"expected-blob");
        let wrong_bytes = png_bytes(b"wrong-blob");
        let data_url = png_data_url(&expected_bytes, AssetEncoding::Padded);
        let value = library_with_decks(vec![deck_with_art("no-clobber", &data_url)]);
        let target = asset_path(&path, &expected_bytes);
        fs::create_dir_all(target.parent().expect("asset parent")).expect("create assets");
        fs::write(&target, &wrong_bytes).expect("write conflicting blob");

        let error = save_library_at(&path, &value).expect_err("conflicting blob must fail");
        assert_eq!(error.code, "INVALID_DECK_LIBRARY");
        assert_eq!(fs::read(&target).expect("read preserved blob"), wrong_bytes);
        assert!(!path.exists());
        assert_no_asset_temporary_files(&path);
    }

    #[test]
    fn corrupt_file_returns_an_error_without_modifying_it() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        fs::create_dir_all(path.parent().expect("library parent")).expect("create parent");
        let corrupt = b"{not valid JSON";
        fs::write(&path, corrupt).expect("write corrupt file");

        let error = load_library_at(&path).expect_err("corrupt library must fail");
        assert_eq!(error.code, "DECK_STORAGE_CORRUPT");
        assert_eq!(fs::read(&path).expect("read original bytes"), corrupt);

        let save_error = save_library_at(&path, &library(&["replacement"], Some("replacement")))
            .expect_err("save must not replace corrupt library");
        assert_eq!(save_error.code, "DECK_STORAGE_CORRUPT");
        assert_eq!(fs::read(&path).expect("read preserved bytes"), corrupt);
    }

    #[test]
    fn validates_capacity_identity_and_active_deck_reference() {
        let too_many = DeckLibrary {
            decks: (0..=MAX_DECKS)
                .map(|index| deck(&format!("deck-{index}")))
                .collect(),
            ..DeckLibrary::default()
        };
        assert_eq!(
            validate_library(&too_many),
            Err(ValidationError::TooManyDecks)
        );

        let duplicate = library(&["same", "same"], Some("same"));
        assert_eq!(
            validate_library(&duplicate),
            Err(ValidationError::DuplicateDeckVersion)
        );

        let missing_active = library(&["present"], Some("missing"));
        assert_eq!(
            validate_library(&missing_active),
            Err(ValidationError::InvalidActiveDeck)
        );
    }

    #[test]
    fn validates_gameplay_bindings_at_the_storage_boundary() {
        let mut valid = deck("gameplay-valid");
        valid["cards"][0]["gameplay"] = json!([{
            "kind": "quantity",
            "categoryId": "quantity-trigger:c1",
            "value": 5,
            "targetTotal": 5,
            "triggerRelation": "exact",
            "moduleId": "quantity-trigger"
        }]);
        validate_library(&library_with_decks(vec![valid])).expect("valid gameplay binding");

        for gameplay in [
            json!({"kind": "quantity"}),
            json!([{"kind": "quantity", "categoryId": "c1", "value": "five"}]),
            json!([{"kind": "custom", "moduleId": "maker", "slotRole": "role", "unexpected": true}]),
        ] {
            let mut invalid = deck("gameplay-invalid");
            invalid["cards"][0]["gameplay"] = gameplay;
            assert!(matches!(
                validate_library(&library_with_decks(vec![invalid])),
                Err(ValidationError::InvalidDeck(_))
            ));
        }
    }

    #[test]
    fn saves_generated_card_copy_with_line_breaks() {
        let directory = TestDirectory::new();
        let path = directory.library_path();
        let mut generated = deck("generated-draft");
        generated["story"] = json!("第一幕：少年进入机关城。\n第二幕：唤醒沉睡卡灵。");
        generated["rules"] = json!("【准备】洗匀套牌。\n【回合】依次打出功能牌。");
        generated["revision"] = json!({
            "familyId": "generated-draft",
            "revision": 2,
            "createdAt": 1_800_000_000_000_u64,
            "reason": "deck-generation"
        });
        let artwork =
            encode_asset_data_url("image/webp", AssetEncoding::Padded, &webp_bytes(700, 900));
        let base_card = generated["cards"][0].clone();
        generated["cards"] = Value::Array(
            (0..14)
                .map(|index| {
                    let mut card = base_card.clone();
                    card["id"] = json!(format!("ai-generated-risk-{index}"));
                    card["name"] = json!(format!("云海卡灵 {}", index + 1));
                    card["artUrl"] = json!(artwork);
                    card["skill"] =
                        json!("【玩法印谱】跳过当前行动。\n【创意演绎】将主动权交给下一位玩家。");
                    card["flavor"] = json!("铜翼掠过云海，\n齿轮随风而鸣。");
                    card["gameplay"] = json!([{
                        "kind": "risk",
                        "cardKind": "action",
                        "actionKind": "skip",
                        "activationRank": index + 1,
                        "moduleId": "risk-draw-1"
                    }]);
                    card
                })
                .collect(),
        );

        let expected = DeckLibrary {
            schema_version: STORAGE_SCHEMA_VERSION,
            active_deck_id: Some("generated-draft".to_owned()),
            active_deck_cid: None,
            active_deck_revision: Some(DeckRevisionReference {
                family_id: "generated-draft".to_owned(),
                revision: 2,
            }),
            decks: vec![generated],
        };
        save_library_at(&path, &expected).expect("multiline generated copy must persist");
        assert_eq!(
            load_library_at(&path).expect("reload multiline deck"),
            expected
        );
    }

    #[test]
    fn accepts_legacy_and_current_provenance_shapes() {
        let cid_a = format!("blake3:{}", "a".repeat(64));
        let cid_b = format!("blake3:{}", "b".repeat(64));
        let legacy = received_deck("legacy-signed", &cid_a, "旧版来源记录");
        let mut current = received_deck("current-signed", &cid_b, "新版来源记录");
        current["provenance"]["publicKey"] = json!("CAESIEd25519PublicKey");

        validate_library(&library_with_decks(vec![legacy, current.clone()]))
            .expect("both provenance generations remain readable");

        current["provenance"]["publicKey"] = json!(null);
        assert!(matches!(
            validate_library(&library_with_decks(vec![current])),
            Err(ValidationError::InvalidDeck(_))
        ));
    }

    #[test]
    fn preserves_same_id_decks_when_their_content_cids_differ() {
        let cid_a = format!("blake3:{}", "a".repeat(64));
        let cid_b = format!("blake3:{}", "b".repeat(64));
        let first = received_deck("shared-id", &cid_a, "云城初版");
        let second = received_deck("shared-id", &cid_b, "云城再版");
        let versions = DeckLibrary {
            schema_version: STORAGE_SCHEMA_VERSION,
            active_deck_id: Some("shared-id".to_owned()),
            active_deck_cid: Some(cid_b.clone()),
            active_deck_revision: None,
            decks: vec![first.clone(), second.clone()],
        };

        validate_library(&versions).expect("different CIDs are distinct versions");

        let directory = TestDirectory::new();
        let path = directory.library_path();
        save_library_at(&path, &versions).expect("save both versions");
        assert_eq!(
            load_library_at(&path).expect("load both versions"),
            versions
        );

        let duplicate = DeckLibrary {
            decks: vec![first.clone(), first],
            active_deck_cid: Some(cid_a),
            ..versions.clone()
        };
        assert_eq!(
            validate_library(&duplicate),
            Err(ValidationError::DuplicateDeckVersion)
        );

        let legacy_single_received = DeckLibrary {
            active_deck_cid: None,
            decks: vec![second],
            ..versions.clone()
        };
        validate_library(&legacy_single_received)
            .expect("legacy activeDeckId resolves when only one version exists");

        let ambiguous_legacy_reference = DeckLibrary {
            active_deck_cid: None,
            ..versions
        };
        assert_eq!(
            validate_library(&ambiguous_legacy_reference),
            Err(ValidationError::InvalidActiveDeck)
        );
    }

    #[test]
    fn loads_ambiguous_legacy_active_reference_with_selection_cleared() {
        let cid_a = format!("blake3:{}", "a".repeat(64));
        let cid_b = format!("blake3:{}", "b".repeat(64));
        let legacy_library = DeckLibrary {
            schema_version: STORAGE_SCHEMA_VERSION,
            active_deck_id: Some("shared-id".to_owned()),
            active_deck_cid: None,
            active_deck_revision: None,
            decks: vec![
                received_deck("shared-id", &cid_a, "云城初版"),
                received_deck("shared-id", &cid_b, "云城再版"),
            ],
        };
        let expected_decks = legacy_library.decks.clone();

        let legacy_directory = TestDirectory::new();
        let legacy_path = legacy_directory.library_path();
        fs::create_dir_all(legacy_path.parent().expect("legacy library parent"))
            .expect("create legacy parent");
        fs::write(
            &legacy_path,
            serde_json::to_vec(&legacy_library).expect("serialize legacy library"),
        )
        .expect("write legacy library");

        let migrated = load_library_at(&legacy_path).expect("load ambiguous legacy library");
        assert_eq!(migrated.active_deck_id, None);
        assert_eq!(migrated.active_deck_cid, None);
        assert_eq!(migrated.active_deck_revision, None);
        assert_eq!(migrated.decks, expected_decks);
    }

    #[test]
    fn rejects_a_persisted_deck_larger_than_twenty_four_mib() {
        let mut oversized = deck("large");
        let oversized_art_url = "x".repeat(MAX_ART_URL_CHARS - 1);
        let template = oversized["cards"][0].clone();
        oversized["cards"] = serde_json::Value::Array(
            (0..5)
                .map(|index| {
                    let mut card = template.clone();
                    card["id"] = json!(format!("large-card-{index}"));
                    card["artUrl"] = json!(oversized_art_url);
                    card
                })
                .collect(),
        );
        let library = DeckLibrary {
            schema_version: STORAGE_SCHEMA_VERSION,
            active_deck_id: Some("large".to_owned()),
            active_deck_cid: None,
            active_deck_revision: None,
            decks: vec![oversized],
        };
        assert_eq!(
            validate_persisted_library(&library),
            Err(ValidationError::DeckTooLarge)
        );
    }

    #[test]
    fn bounded_json_writer_stops_before_exceeding_its_limit() {
        assert_eq!(
            json_size_with_limit(&json!({ "value": "123456789" }), 8),
            Err(JsonLimitError::TooLarge)
        );
    }

    #[test]
    fn preserves_local_revisions_and_resolves_the_adopted_version() {
        let mut first = deck("shared-local-id");
        first["revision"] = json!({
            "familyId": "family-local",
            "revision": 2,
            "createdAt": 1_800_000_000_000_u64,
            "reason": "deck-generation"
        });
        let mut second = first.clone();
        second["revision"]["revision"] = json!(3);
        second["revision"]["createdAt"] = json!(1_800_000_100_000_u64);
        second["revision"]["reason"] = json!("card-regeneration");

        let versions = DeckLibrary {
            schema_version: STORAGE_SCHEMA_VERSION,
            active_deck_id: Some("shared-local-id".to_owned()),
            active_deck_cid: None,
            active_deck_revision: Some(DeckRevisionReference {
                family_id: "family-local".to_owned(),
                revision: 3,
            }),
            decks: vec![first.clone(), second.clone()],
        };
        validate_library(&versions).expect("local revisions are distinct");

        let duplicate = DeckLibrary {
            decks: vec![second.clone(), second],
            ..versions.clone()
        };
        assert_eq!(
            validate_library(&duplicate),
            Err(ValidationError::DuplicateDeckVersion)
        );

        let missing_revision = DeckLibrary {
            active_deck_revision: Some(DeckRevisionReference {
                family_id: "family-local".to_owned(),
                revision: 4,
            }),
            decks: vec![first],
            ..versions
        };
        assert_eq!(
            validate_library(&missing_revision),
            Err(ValidationError::InvalidActiveDeck)
        );
    }

    #[test]
    fn rejects_invalid_or_extended_local_revision_metadata() {
        let mut invalid_reason = deck("invalid-revision");
        invalid_reason["revision"] = json!({
            "familyId": "family-local",
            "revision": 2,
            "createdAt": 1_800_000_000_000_u64,
            "reason": "unknown"
        });
        assert!(matches!(
            validate_library(&DeckLibrary {
                decks: vec![invalid_reason],
                ..DeckLibrary::default()
            }),
            Err(ValidationError::InvalidDeck(_))
        ));

        let mut extended = deck("extended-revision");
        extended["revision"] = json!({
            "familyId": "family-local",
            "revision": 2,
            "createdAt": 1_800_000_000_000_u64,
            "reason": "manual-snapshot",
            "unexpected": true
        });
        assert!(matches!(
            validate_library(&DeckLibrary {
                decks: vec![extended],
                ..DeckLibrary::default()
            }),
            Err(ValidationError::InvalidDeck(_))
        ));
    }

    #[test]
    fn persists_fan_study_confirmations_including_guardian_acknowledgement() {
        let mut incomplete = deck("fan-study-incomplete");
        incomplete["contentPolicy"] = json!({
            "schemaVersion": 1,
            "mode": "fan-study",
            "agreement": {
                "termsVersion": "1.0",
                "acceptedAt": null,
                "confirmations": {
                    "materialsRightsConfirmed": true,
                    "personalNonCommercialConfirmed": true,
                    "unofficialAndUnaffiliatedConfirmed": true,
                    "guardianJointlyConfirmed": false
                }
            }
        });
        validate_library(&DeckLibrary {
            decks: vec![incomplete],
            ..DeckLibrary::default()
        })
        .expect("incomplete acknowledgements remain locally editable");

        let mut accepted = deck("fan-study-accepted");
        accepted["contentPolicy"] = json!({
            "schemaVersion": 1,
            "mode": "fan-study",
            "agreement": {
                "termsVersion": "1.0",
                "acceptedAt": 1_800_000_000_000_u64,
                "confirmations": {
                    "materialsRightsConfirmed": true,
                    "personalNonCommercialConfirmed": true,
                    "unofficialAndUnaffiliatedConfirmed": true,
                    "guardianJointlyConfirmed": true
                }
            }
        });
        validate_library(&DeckLibrary {
            decks: vec![accepted],
            ..DeckLibrary::default()
        })
        .expect("fully accepted fan-study agreement");
    }

    #[test]
    fn rejects_inconsistent_fan_study_acceptance_metadata() {
        let mut invalid = deck("fan-study-invalid");
        invalid["contentPolicy"] = json!({
            "schemaVersion": 1,
            "mode": "fan-study",
            "agreement": {
                "termsVersion": "1.0",
                "acceptedAt": 1_800_000_000_000_u64,
                "confirmations": {
                    "materialsRightsConfirmed": true,
                    "personalNonCommercialConfirmed": true,
                    "unofficialAndUnaffiliatedConfirmed": true,
                    "guardianJointlyConfirmed": false
                }
            }
        });
        assert!(matches!(
            validate_library(&DeckLibrary {
                decks: vec![invalid],
                ..DeckLibrary::default()
            }),
            Err(ValidationError::InvalidDeck(_))
        ));
    }
}
