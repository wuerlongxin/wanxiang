use std::borrow::Cow;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::Serialize;

use crate::error::CommandError;

const MAX_PDF_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePdfResult {
    pub saved: bool,
    pub path: Option<String>,
    pub bytes_written: usize,
}

#[tauri::command]
pub async fn save_pdf(
    base64_data: String,
    suggested_name: String,
) -> Result<SavePdfResult, CommandError> {
    let bytes = decode_pdf(&base64_data)?;
    let bytes_written = bytes.len();
    let file_name = safe_pdf_name(&suggested_name);
    let selection = rfd::AsyncFileDialog::new()
        .add_filter("PDF document", &["pdf"])
        .set_file_name(file_name)
        .save_file()
        .await;

    let Some(file_handle) = selection else {
        return Ok(SavePdfResult {
            saved: false,
            path: None,
            bytes_written: 0,
        });
    };

    let path = file_handle.path().to_path_buf();
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|_| CommandError::new("PDF_SAVE_FAILED", "PDF 保存失败，请检查目录权限。"))?;

    Ok(SavePdfResult {
        saved: true,
        path: Some(path.to_string_lossy().into_owned()),
        bytes_written,
    })
}

fn decode_pdf(value: &str) -> Result<Vec<u8>, CommandError> {
    let encoded = value
        .trim()
        .strip_prefix("data:application/pdf;base64,")
        .unwrap_or(value.trim());
    let maximum_encoded_length = MAX_PDF_BYTES.div_ceil(3) * 4 + 4;
    if encoded.len() > maximum_encoded_length + (64 * 1024) {
        return Err(CommandError::new(
            "PDF_TOO_LARGE",
            "PDF 文件不得超过 32MB。",
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
        return Err(CommandError::new(
            "PDF_TOO_LARGE",
            "PDF 文件不得超过 32MB。",
        ));
    }

    let bytes = BASE64
        .decode(compact.as_bytes())
        .map_err(|_| CommandError::new("INVALID_PDF", "PDF 数据格式无效。"))?;
    if bytes.len() > MAX_PDF_BYTES {
        return Err(CommandError::new(
            "PDF_TOO_LARGE",
            "PDF 文件不得超过 32MB。",
        ));
    }
    if bytes.len() < 8 || !bytes.starts_with(b"%PDF-") {
        return Err(CommandError::new("INVALID_PDF", "PDF 数据格式无效。"));
    }

    Ok(bytes)
}

fn safe_pdf_name(suggested_name: &str) -> String {
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

    if name.to_ascii_lowercase().ends_with(".pdf") {
        name.truncate(name.len().saturating_sub(4));
        name = name.trim_end_matches([' ', '.']).to_owned();
    }
    if name.is_empty() {
        name = "wanxiang-deck".to_owned();
    }

    format!("{name}.pdf")
}

#[cfg(test)]
mod tests {
    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

    use super::{decode_pdf, safe_pdf_name};

    #[test]
    fn accepts_raw_and_data_url_pdf_base64() {
        let pdf = b"%PDF-1.7\n%%EOF";
        let encoded = BASE64.encode(pdf);
        assert_eq!(decode_pdf(&encoded).expect("raw PDF"), pdf);
        assert_eq!(
            decode_pdf(&format!("data:application/pdf;base64,{encoded}")).expect("data URL PDF"),
            pdf
        );
    }

    #[test]
    fn rejects_non_pdf_bytes() {
        let encoded = BASE64.encode(b"not a pdf");
        assert_eq!(
            decode_pdf(&encoded).expect_err("invalid PDF").code,
            "INVALID_PDF"
        );
    }

    #[test]
    fn sanitizes_suggested_file_name() {
        assert_eq!(safe_pdf_name("../万象:卡组.PDF"), "万象卡组.pdf");
        assert_eq!(safe_pdf_name("  "), "wanxiang-deck.pdf");
    }
}
