use std::{
    borrow::Cow,
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, BufRead, BufReader, BufWriter, Cursor, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use jpeg_encoder::{
    ColorType as JpegColorType, Encoder as JpegEncoder, PixelDensity, SamplingFactor,
};
use lcms2::{ColorSpaceSignature, Intent, PixelFormat, Profile, Transform};
use png::{BitDepth, ColorType as PngColorType, Decoder as PngDecoder, Transformations};
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::error::CommandError;

const PAGE_WIDTH: u32 = 2480;
const PAGE_HEIGHT: u32 = 3508;
const MAX_PAGES: u32 = 512;
const MAX_ACTIVE_JOBS: usize = 4;
const MAX_PNG_BYTES: usize = 48 * 1024 * 1024;
const PROFILE_NAME: &str = "FOGRA39L Coated";
const ICC_PROFILE: &[u8] = include_bytes!("../resources/color/FOGRA39L_coated.icc");
const PDF_WIDTH_POINTS: &str = "595.2756";
const PDF_HEIGHT_POINTS: &str = "841.8898";
const PDF_PAGE_BOX: &str = "[0 0 595.2756 841.8898]";

type SharedPdfxJob = Arc<Mutex<PdfxJob>>;
type PdfxJobs = HashMap<String, SharedPdfxJob>;

#[derive(Default)]
pub struct PdfxState {
    jobs: Mutex<PdfxJobs>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginPdfx4ExportResult {
    pub started: bool,
    pub job_id: Option<String>,
    pub expected_pages: u32,
    pub page_width: u32,
    pub page_height: u32,
    pub profile_name: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendPdfx4PageResult {
    pub appended_pages: u32,
    pub expected_pages: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishPdfx4ExportResult {
    pub saved: bool,
    pub path: String,
    pub bytes_written: u64,
    pub page_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelPdfx4ExportResult {
    pub cancelled: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PdfxPageRole {
    CardFront,
    CardBack,
    Rulebook,
    RightsNotice,
}

impl PdfxPageRole {
    fn parse(value: &str) -> Result<Self, CommandError> {
        match value {
            "cardFront" => Ok(Self::CardFront),
            "cardBack" => Ok(Self::CardBack),
            "rulebook" => Ok(Self::Rulebook),
            "rightsNotice" => Ok(Self::RightsNotice),
            _ => Err(pdfx_error(
                "PDFX_INVALID_PAGE_ROLE",
                "页面类型无效，请重新开始导出。",
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::CardFront => "cardFront",
            Self::CardBack => "cardBack",
            Self::Rulebook => "rulebook",
            Self::RightsNotice => "rightsNotice",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum JobStatus {
    Active,
    Finalizing,
    Cancelled,
}

struct PdfxPage {
    role: PdfxPageRole,
    jpeg_path: PathBuf,
    jpeg_bytes: u64,
}

struct ColorConverter {
    transform: Transform<u8, u8>,
}

impl ColorConverter {
    fn new() -> Result<Self, CommandError> {
        let output = Profile::new_icc(ICC_PROFILE).map_err(|_| {
            pdfx_error(
                "PDFX_PROFILE_INVALID",
                "内置印刷色彩配置无效，请重新安装应用。",
            )
        })?;
        if output.color_space() != ColorSpaceSignature::CmykData {
            return Err(pdfx_error(
                "PDFX_PROFILE_INVALID",
                "内置印刷色彩配置不是 CMYK 配置，请重新安装应用。",
            ));
        }

        let input = Profile::new_srgb();
        let transform = Transform::new(
            &input,
            PixelFormat::RGB_8,
            &output,
            PixelFormat::CMYK_8,
            Intent::RelativeColorimetric,
        )
        .map_err(|_| {
            pdfx_error(
                "PDFX_COLOR_TRANSFORM_FAILED",
                "无法建立印刷色彩转换，请重新启动应用后再试。",
            )
        })?;

        Ok(Self { transform })
    }

    fn convert(&self, rgb: &[u8]) -> Result<Vec<u8>, CommandError> {
        let pixel_count = (PAGE_WIDTH as usize)
            .checked_mul(PAGE_HEIGHT as usize)
            .ok_or_else(internal_error)?;
        if rgb.len() != pixel_count * 3 {
            return Err(internal_error());
        }
        let mut cmyk = vec![0_u8; pixel_count * 4];
        self.transform.transform_pixels(rgb, &mut cmyk);
        Ok(cmyk)
    }
}

struct PdfxJob {
    destination: PathBuf,
    temp_dir: PathBuf,
    title: String,
    author: String,
    expected_pages: u32,
    pages: Vec<PdfxPage>,
    status: JobStatus,
    converter: ColorConverter,
}

impl Drop for PdfxJob {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.temp_dir);
    }
}

#[tauri::command]
pub async fn begin_pdfx4_export(
    state: State<'_, PdfxState>,
    suggested_name: String,
    title: String,
    author: String,
    expected_pages: u32,
) -> Result<BeginPdfx4ExportResult, CommandError> {
    let title = validated_metadata_text(title, 160)?;
    let author = validated_metadata_text(author, 100)?;
    if !(1..=MAX_PAGES).contains(&expected_pages) {
        return Err(pdfx_error(
            "PDFX_INVALID_PAGE_COUNT",
            "PDF/X-4 导出页数必须在 1 到 512 页之间。",
        ));
    }
    ensure_job_capacity(&state)?;

    let file_name = safe_pdf_name(&suggested_name);
    let selection = rfd::AsyncFileDialog::new()
        .add_filter("PDF/X-4 document", &["pdf"])
        .set_file_name(file_name)
        .save_file()
        .await;
    let Some(file_handle) = selection else {
        return Ok(BeginPdfx4ExportResult {
            started: false,
            job_id: None,
            expected_pages,
            page_width: PAGE_WIDTH,
            page_height: PAGE_HEIGHT,
            profile_name: PROFILE_NAME,
        });
    };

    let destination = ensure_pdf_extension(file_handle.path());
    let converter = ColorConverter::new()?;
    let job_id = Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir().join(format!("wanxiang-deck-pdfx-{job_id}"));
    create_secure_temp_dir(&temp_dir)?;

    let job = PdfxJob {
        destination,
        temp_dir,
        title,
        author,
        expected_pages,
        pages: Vec::with_capacity(expected_pages as usize),
        status: JobStatus::Active,
        converter,
    };

    let mut jobs = lock_jobs(&state)?;
    if jobs.len() >= MAX_ACTIVE_JOBS {
        drop(jobs);
        drop(job);
        return Err(pdfx_error(
            "PDFX_TOO_MANY_JOBS",
            "同时进行的印刷导出过多，请先完成或取消其他导出。",
        ));
    }
    let mut destination_busy = false;
    for entry in jobs.values() {
        if lock_job(entry)?.destination == job.destination {
            destination_busy = true;
            break;
        }
    }
    if destination_busy {
        drop(jobs);
        drop(job);
        return Err(pdfx_error(
            "PDFX_DESTINATION_BUSY",
            "这个文件正在由另一项印刷导出使用。",
        ));
    }
    jobs.insert(job_id.clone(), Arc::new(Mutex::new(job)));

    Ok(BeginPdfx4ExportResult {
        started: true,
        job_id: Some(job_id),
        expected_pages,
        page_width: PAGE_WIDTH,
        page_height: PAGE_HEIGHT,
        profile_name: PROFILE_NAME,
    })
}

#[tauri::command]
pub async fn append_pdfx4_page(
    state: State<'_, PdfxState>,
    job_id: String,
    page_index: u32,
    role: String,
    png_base64: String,
) -> Result<AppendPdfx4PageResult, CommandError> {
    let role = PdfxPageRole::parse(&role)?;
    let job = find_job(&state, &job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut job = lock_job(&job)?;
        append_page(&mut job, page_index, role, &png_base64)
    })
    .await
    .map_err(|_| internal_error())?
}

#[tauri::command]
pub async fn finish_pdfx4_export(
    state: State<'_, PdfxState>,
    job_id: String,
) -> Result<FinishPdfx4ExportResult, CommandError> {
    let job = find_job(&state, &job_id)?;
    {
        let mut locked = lock_job(&job)?;
        ensure_active(&locked)?;
        if locked.pages.len() != locked.expected_pages as usize {
            return Err(pdfx_error(
                "PDFX_EXPORT_INCOMPLETE",
                format!(
                    "印刷导出尚未完成：已收到 {} 页，共需 {} 页。",
                    locked.pages.len(),
                    locked.expected_pages
                ),
            ));
        }
        locked.status = JobStatus::Finalizing;
    }

    let worker_job = Arc::clone(&job);
    let worker_result = tauri::async_runtime::spawn_blocking(move || {
        let locked = lock_job(&worker_job)?;
        write_completed_job(&locked)
    })
    .await;
    let result = worker_result.unwrap_or_else(|_| Err(internal_error()));

    match result {
        Ok(result) => {
            let mut jobs = lock_jobs(&state)?;
            if jobs
                .get(&job_id)
                .is_some_and(|registered| Arc::ptr_eq(registered, &job))
            {
                jobs.remove(&job_id);
            }
            Ok(result)
        }
        Err(error) => {
            if let Ok(mut locked) = job.lock()
                && locked.status == JobStatus::Finalizing
            {
                locked.status = JobStatus::Active;
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn cancel_pdfx4_export(
    state: State<'_, PdfxState>,
    job_id: String,
) -> Result<CancelPdfx4ExportResult, CommandError> {
    validate_job_id(&job_id)?;
    let job = {
        let jobs = lock_jobs(&state)?;
        jobs.get(&job_id).cloned()
    };
    let Some(job) = job else {
        return Ok(CancelPdfx4ExportResult { cancelled: false });
    };

    {
        let mut locked = lock_job(&job)?;
        match locked.status {
            JobStatus::Active => locked.status = JobStatus::Cancelled,
            JobStatus::Cancelled => {
                return Ok(CancelPdfx4ExportResult { cancelled: false });
            }
            JobStatus::Finalizing => {
                return Err(pdfx_error(
                    "PDFX_EXPORT_FINALIZING",
                    "PDF/X-4 文件正在完成写入，当前不能取消。",
                ));
            }
        }
    }

    let mut jobs = lock_jobs(&state)?;
    if jobs
        .get(&job_id)
        .is_some_and(|registered| Arc::ptr_eq(registered, &job))
    {
        jobs.remove(&job_id);
    }
    Ok(CancelPdfx4ExportResult { cancelled: true })
}

#[doc(hidden)]
pub fn build_pdfx4_for_qa(
    output: &Path,
    title: &str,
    author: &str,
    pages: &[(PathBuf, String)],
) -> Result<(), CommandError> {
    let expected_pages = u32::try_from(pages.len()).map_err(|_| internal_error())?;
    if !(1..=MAX_PAGES).contains(&expected_pages) {
        return Err(pdfx_error(
            "PDFX_INVALID_PAGE_COUNT",
            "PDF/X-4 导出页数必须在 1 到 512 页之间。",
        ));
    }
    let title = validated_metadata_text(title.to_owned(), 160)?;
    let author = validated_metadata_text(author.to_owned(), 100)?;
    let converter = ColorConverter::new()?;
    let temp_dir = std::env::temp_dir().join(format!("wanxiang-deck-pdfx-qa-{}", Uuid::new_v4()));
    create_secure_temp_dir(&temp_dir)?;
    let mut job = PdfxJob {
        destination: output.to_path_buf(),
        temp_dir,
        title,
        author,
        expected_pages,
        pages: Vec::with_capacity(pages.len()),
        status: JobStatus::Active,
        converter,
    };

    for (page_index, (png_path, role)) in pages.iter().enumerate() {
        let metadata = fs::metadata(png_path).map_err(|_| invalid_png_error())?;
        if metadata.len() > MAX_PNG_BYTES as u64 {
            return Err(pdfx_error(
                "PDFX_PNG_TOO_LARGE",
                "单页 PNG 数据不得超过 48MB。",
            ));
        }
        let png = fs::read(png_path).map_err(|_| invalid_png_error())?;
        let rgb = decode_png_to_rgb(&png, PAGE_WIDTH, PAGE_HEIGHT)?;
        let cmyk = job.converter.convert(&rgb)?;
        let jpeg_path = job.temp_dir.join(format!("page-{page_index:04}.cmyk.jpg"));
        let jpeg_bytes = encode_cmyk_jpeg(&jpeg_path, &cmyk, PAGE_WIDTH, PAGE_HEIGHT)?;
        job.pages.push(PdfxPage {
            role: PdfxPageRole::parse(role)?,
            jpeg_path,
            jpeg_bytes,
        });
    }
    job.status = JobStatus::Finalizing;
    write_pdfx4(&job, output)?;
    verify_pdfx4_file(output, pages.len())
}

fn append_page(
    job: &mut PdfxJob,
    page_index: u32,
    role: PdfxPageRole,
    png_base64: &str,
) -> Result<AppendPdfx4PageResult, CommandError> {
    ensure_active(job)?;
    let next_page = job.pages.len() as u32;
    if page_index != next_page || page_index >= job.expected_pages {
        return Err(pdfx_error(
            "PDFX_PAGE_ORDER_INVALID",
            format!("页面必须按顺序追加，下一页应为第 {} 页。", next_page + 1),
        ));
    }

    let png = decode_png_base64(png_base64)?;
    let rgb = decode_png_to_rgb(&png, PAGE_WIDTH, PAGE_HEIGHT)?;
    let cmyk = job.converter.convert(&rgb)?;
    let jpeg_path = job.temp_dir.join(format!("page-{page_index:04}.cmyk.jpg"));
    let jpeg_bytes = encode_cmyk_jpeg(&jpeg_path, &cmyk, PAGE_WIDTH, PAGE_HEIGHT)?;
    job.pages.push(PdfxPage {
        role,
        jpeg_path,
        jpeg_bytes,
    });

    Ok(AppendPdfx4PageResult {
        appended_pages: job.pages.len() as u32,
        expected_pages: job.expected_pages,
    })
}

fn ensure_active(job: &PdfxJob) -> Result<(), CommandError> {
    match job.status {
        JobStatus::Active => Ok(()),
        JobStatus::Finalizing => Err(pdfx_error(
            "PDFX_EXPORT_FINALIZING",
            "PDF/X-4 文件正在完成写入，请稍候。",
        )),
        JobStatus::Cancelled => Err(pdfx_error(
            "PDFX_EXPORT_CANCELLED",
            "这项 PDF/X-4 导出已经取消。",
        )),
    }
}

fn write_completed_job(job: &PdfxJob) -> Result<FinishPdfx4ExportResult, CommandError> {
    if job.status != JobStatus::Finalizing {
        return Err(internal_error());
    }
    let parent = job.destination.parent().ok_or_else(|| {
        pdfx_error(
            "PDFX_SAVE_FAILED",
            "PDF/X-4 保存位置无效，请选择其他文件夹。",
        )
    })?;
    fs::create_dir_all(parent).map_err(|_| save_error())?;
    let temporary = parent.join(format!(
        ".{}.{}.pdfx.tmp",
        job.destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("wanxiang-deck.pdf"),
        Uuid::new_v4()
    ));

    let write_result = write_pdfx4(job, &temporary);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = verify_pdfx4_file(&temporary, job.pages.len()) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    commit_export(&temporary, &job.destination)?;
    verify_pdfx4_file(&job.destination, job.pages.len())?;
    let bytes_written = fs::metadata(&job.destination)
        .map_err(|_| save_error())?
        .len();

    Ok(FinishPdfx4ExportResult {
        saved: true,
        path: job.destination.to_string_lossy().into_owned(),
        bytes_written,
        page_count: job.pages.len() as u32,
    })
}

fn write_pdfx4(job: &PdfxJob, path: &Path) -> Result<(), CommandError> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| save_error())?;
    let page_count = job.pages.len();
    let object_count = 6_usize
        .checked_add(page_count.checked_mul(3).ok_or_else(internal_error)?)
        .ok_or_else(internal_error)?;
    let mut writer =
        PdfWriter::new(BufWriter::new(file), object_count).map_err(|_| save_error())?;
    let timestamp = utc_timestamp(SystemTime::now());
    let document_id = Uuid::new_v4();
    let instance_id = Uuid::new_v4();
    let xmp = xmp_metadata(job, &timestamp.xmp, document_id, instance_id);

    writer
        .object(
            1,
            b"<< /Type /Catalog /Version /1.6 /Pages 2 0 R /Metadata 3 0 R /OutputIntents [4 0 R] /Lang (zh-CN) /ViewerPreferences << /DisplayDocTitle true >> >>",
        )
        .map_err(|_| save_error())?;

    let kids = (0..page_count)
        .map(|index| format!("{} 0 R", page_object_id(index)))
        .collect::<Vec<_>>()
        .join(" ");
    writer
        .object(
            2,
            format!("<< /Type /Pages /Count {page_count} /Kids [{kids}] >>").as_bytes(),
        )
        .map_err(|_| save_error())?;
    writer
        .stream_object(3, b"/Type /Metadata /Subtype /XML", xmp.as_bytes())
        .map_err(|_| save_error())?;
    writer
        .object(
            4,
            b"<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (FOGRA39L Coated) /OutputCondition (FOGRA39L Coated - CMYK print condition) /RegistryName (http://www.color.org) /Info (FOGRA39L Coated CMYK profile) /DestOutputProfile 5 0 R >>",
        )
        .map_err(|_| save_error())?;
    writer
        .stream_object(
            5,
            b"/N 4 /Alternate /DeviceCMYK /Range [0 1 0 1 0 1 0 1]",
            ICC_PROFILE,
        )
        .map_err(|_| save_error())?;

    let info = format!(
        "<< /Title {} /Author {} /Creator {} /Producer {} /CreationDate ({}) /ModDate ({}) /GTS_PDFXVersion (PDF/X-4) /Trapped /False >>",
        pdf_utf16_hex(&job.title),
        pdf_utf16_hex(&job.author),
        pdf_utf16_hex("Wanxiang Deck"),
        pdf_utf16_hex("Wanxiang Deck PDF/X-4 Engine"),
        timestamp.pdf,
        timestamp.pdf,
    );
    writer
        .object(6, info.as_bytes())
        .map_err(|_| save_error())?;

    for (index, page) in job.pages.iter().enumerate() {
        let page_id = page_object_id(index);
        let image_id = page_id + 1;
        let content_id = page_id + 2;
        let page_dictionary = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox {PDF_PAGE_BOX} /TrimBox {PDF_PAGE_BOX} /BleedBox {PDF_PAGE_BOX} /Resources << /ColorSpace << /DefaultCMYK [/ICCBased 5 0 R] >> /XObject << /PageImage {image_id} 0 R >> >> /Contents {content_id} 0 R >>"
        );
        writer
            .object(page_id, page_dictionary.as_bytes())
            .map_err(|_| save_error())?;

        let image_dictionary = format!(
            "/Type /XObject /Subtype /Image /Width {PAGE_WIDTH} /Height {PAGE_HEIGHT} /ColorSpace [/ICCBased 5 0 R] /BitsPerComponent 8 /Intent /RelativeColorimetric /Filter /DCTDecode /Decode [1 0 1 0 1 0 1 0]"
        );
        writer
            .file_stream_object(
                image_id,
                image_dictionary.as_bytes(),
                &page.jpeg_path,
                page.jpeg_bytes,
            )
            .map_err(|_| save_error())?;

        let content = format!(
            "% Wanxiang Deck page role: {}\nq\n{PDF_WIDTH_POINTS} 0 0 {PDF_HEIGHT_POINTS} 0 0 cm\n/PageImage Do\nQ\n",
            page.role.as_str()
        );
        writer
            .stream_object(content_id, b"", content.as_bytes())
            .map_err(|_| save_error())?;
    }

    let buffered = writer
        .finish(1, 6, document_id, instance_id)
        .map_err(|_| save_error())?;
    let file = buffered.into_inner().map_err(|_| save_error())?;
    file.sync_all().map_err(|_| save_error())
}

fn verify_pdfx4_file(path: &Path, expected_pages: usize) -> Result<(), CommandError> {
    let mut file = File::open(path).map_err(|_| validation_error())?;
    let length = file.metadata().map_err(|_| validation_error())?.len();
    if length < 256 {
        return Err(validation_error());
    }

    let mut header = [0_u8; 8];
    file.read_exact(&mut header)
        .map_err(|_| validation_error())?;
    if &header != b"%PDF-1.6" {
        return Err(validation_error());
    }

    let tail_length = usize::try_from(length.min(64 * 1024)).map_err(|_| validation_error())?;
    file.seek(SeekFrom::End(-(tail_length as i64)))
        .map_err(|_| validation_error())?;
    let mut tail = vec![0_u8; tail_length];
    file.read_exact(&mut tail).map_err(|_| validation_error())?;
    let trimmed_tail = trim_ascii_end(&tail);
    if !trimmed_tail.ends_with(b"%%EOF") {
        return Err(validation_error());
    }
    let marker = b"startxref\n";
    let marker_position = rfind_bytes(trimmed_tail, marker).ok_or_else(validation_error)?;
    let offset_start = marker_position + marker.len();
    let offset_end = trimmed_tail[offset_start..]
        .iter()
        .position(|byte| *byte == b'\n' || *byte == b'\r')
        .map(|relative| offset_start + relative)
        .ok_or_else(validation_error)?;
    let xref_offset = std::str::from_utf8(&trimmed_tail[offset_start..offset_end])
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|offset| *offset < length)
        .ok_or_else(validation_error)?;
    let expected_xref_size = 7_usize
        .checked_add(expected_pages.checked_mul(3).ok_or_else(validation_error)?)
        .ok_or_else(validation_error)?;
    verify_classic_xref(path, xref_offset, expected_xref_size)?;

    let tokens: &[&[u8]] = &[
        b"/GTS_PDFXVersion (PDF/X-4)",
        b"/OutputIntents [4 0 R]",
        b"/Type /OutputIntent /S /GTS_PDFX",
        b"/DestOutputProfile 5 0 R",
        b"/N 4 /Alternate /DeviceCMYK",
        b"/Type /Metadata /Subtype /XML",
        b"<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>",
        b"/OutputConditionIdentifier (FOGRA39L Coated)",
        b"/Type /Page /Parent 2 0 R",
        b"/MediaBox [0 0 595.2756 841.8898]",
        b"/TrimBox [0 0 595.2756 841.8898]",
        b"/BleedBox [0 0 595.2756 841.8898]",
        b"/Subtype /Image",
        b"/ColorSpace [/ICCBased 5 0 R]",
        b"/Width 2480 /Height 3508",
        b"/BitsPerComponent 8 /Intent /RelativeColorimetric /Filter /DCTDecode /Decode [1 0 1 0 1 0 1 0]",
        b"595.2756 0 0 841.8898 0 0 cm",
        b"/DeviceRGB",
        b"/CalRGB",
    ];
    let counts = scan_token_counts(path, tokens).map_err(|_| validation_error())?;
    let singleton_indexes = 0..=7;
    if singleton_indexes.clone().any(|index| counts[index] != 1)
        || (8..=16).any(|index| counts[index] != expected_pages)
        || counts[17] != 0
        || counts[18] != 0
    {
        return Err(validation_error());
    }
    Ok(())
}

fn verify_classic_xref(
    path: &Path,
    xref_offset: u64,
    expected_size: usize,
) -> Result<(), CommandError> {
    let mut xref_reader = BufReader::new(File::open(path).map_err(|_| validation_error())?);
    xref_reader
        .seek(SeekFrom::Start(xref_offset))
        .map_err(|_| validation_error())?;
    let mut line = String::new();
    read_xref_line(&mut xref_reader, &mut line)?;
    if line.trim_end() != "xref" {
        return Err(validation_error());
    }
    read_xref_line(&mut xref_reader, &mut line)?;
    let mut subsection = line.split_ascii_whitespace();
    if subsection.next() != Some("0")
        || subsection
            .next()
            .and_then(|value| value.parse::<usize>().ok())
            != Some(expected_size)
        || subsection.next().is_some()
    {
        return Err(validation_error());
    }

    read_xref_line(&mut xref_reader, &mut line)?;
    if line.split_ascii_whitespace().collect::<Vec<_>>() != ["0000000000", "65535", "f"] {
        return Err(validation_error());
    }

    let mut object_file = File::open(path).map_err(|_| validation_error())?;
    for object_id in 1..expected_size {
        read_xref_line(&mut xref_reader, &mut line)?;
        let mut entry = line.split_ascii_whitespace();
        let offset = entry
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|offset| *offset < xref_offset)
            .ok_or_else(validation_error)?;
        if entry.next() != Some("00000") || entry.next() != Some("n") || entry.next().is_some() {
            return Err(validation_error());
        }
        let expected_header = format!("{object_id} 0 obj\n");
        let mut actual_header = vec![0_u8; expected_header.len()];
        object_file
            .seek(SeekFrom::Start(offset))
            .and_then(|_| object_file.read_exact(&mut actual_header))
            .map_err(|_| validation_error())?;
        if actual_header != expected_header.as_bytes() {
            return Err(validation_error());
        }
    }
    read_xref_line(&mut xref_reader, &mut line)?;
    if line.trim_end() != "trailer" {
        return Err(validation_error());
    }
    Ok(())
}

fn read_xref_line(reader: &mut BufReader<File>, line: &mut String) -> Result<(), CommandError> {
    line.clear();
    if reader.read_line(line).map_err(|_| validation_error())? == 0 {
        return Err(validation_error());
    }
    Ok(())
}

fn scan_token_counts(path: &Path, tokens: &[&[u8]]) -> io::Result<Vec<usize>> {
    let maximum_token = tokens.iter().map(|token| token.len()).max().unwrap_or(1);
    let overlap = maximum_token.saturating_sub(1);
    let mut reader = BufReader::new(File::open(path)?);
    let mut chunk = vec![0_u8; 64 * 1024];
    let mut carry = Vec::with_capacity(overlap);
    let mut counts = vec![0_usize; tokens.len()];

    loop {
        let read = reader.read(&mut chunk)?;
        if read == 0 {
            count_token_starts(&carry, carry.len(), tokens, &mut counts);
            break;
        }
        let mut combined = Vec::with_capacity(carry.len() + read);
        combined.extend_from_slice(&carry);
        combined.extend_from_slice(&chunk[..read]);
        let processed = combined.len().saturating_sub(overlap);
        count_token_starts(&combined, processed, tokens, &mut counts);
        carry.clear();
        carry.extend_from_slice(&combined[processed..]);
    }
    Ok(counts)
}

fn count_token_starts(data: &[u8], starts_before: usize, tokens: &[&[u8]], counts: &mut [usize]) {
    for (token_index, token) in tokens.iter().enumerate() {
        if token.is_empty() || data.len() < token.len() {
            continue;
        }
        let candidate_count = (data.len() - token.len() + 1).min(starts_before);
        counts[token_index] += (0..candidate_count)
            .filter(|start| &data[*start..*start + token.len()] == *token)
            .count();
    }
}

fn trim_ascii_end(mut value: &[u8]) -> &[u8] {
    while value.last().is_some_and(|byte| byte.is_ascii_whitespace()) {
        value = &value[..value.len() - 1];
    }
    value
}

fn rfind_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .rposition(|window| window == needle)
}

struct PdfWriter<W: Write + Seek> {
    output: W,
    offsets: Vec<u64>,
}

impl<W: Write + Seek> PdfWriter<W> {
    fn new(mut output: W, object_count: usize) -> io::Result<Self> {
        output.write_all(b"%PDF-1.6\n%\xE2\xE3\xCF\xD3\n")?;
        Ok(Self {
            output,
            offsets: vec![0; object_count + 1],
        })
    }

    fn start_object(&mut self, object_id: usize) -> io::Result<()> {
        if object_id == 0 || object_id >= self.offsets.len() || self.offsets[object_id] != 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid PDF object id",
            ));
        }
        self.offsets[object_id] = self.output.stream_position()?;
        writeln!(self.output, "{object_id} 0 obj")
    }

    fn object(&mut self, object_id: usize, body: &[u8]) -> io::Result<()> {
        self.start_object(object_id)?;
        self.output.write_all(body)?;
        self.output.write_all(b"\nendobj\n")
    }

    fn stream_object(
        &mut self,
        object_id: usize,
        dictionary: &[u8],
        stream: &[u8],
    ) -> io::Result<()> {
        self.start_object(object_id)?;
        write!(self.output, "<< /Length {} ", stream.len())?;
        self.output.write_all(dictionary)?;
        self.output.write_all(b" >>\nstream\n")?;
        self.output.write_all(stream)?;
        self.output.write_all(b"\nendstream\nendobj\n")
    }

    fn file_stream_object(
        &mut self,
        object_id: usize,
        dictionary: &[u8],
        path: &Path,
        length: u64,
    ) -> io::Result<()> {
        self.start_object(object_id)?;
        write!(self.output, "<< /Length {length} ")?;
        self.output.write_all(dictionary)?;
        self.output.write_all(b" >>\nstream\n")?;
        let mut input = File::open(path)?;
        let copied = io::copy(&mut input, &mut self.output)?;
        if copied != length {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "CMYK page stream changed while exporting",
            ));
        }
        self.output.write_all(b"\nendstream\nendobj\n")
    }

    fn finish(
        mut self,
        root_id: usize,
        info_id: usize,
        document_id: Uuid,
        instance_id: Uuid,
    ) -> io::Result<W> {
        if self.offsets.iter().skip(1).any(|offset| *offset == 0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "missing PDF object",
            ));
        }
        let xref_offset = self.output.stream_position()?;
        writeln!(self.output, "xref\n0 {}", self.offsets.len())?;
        self.output.write_all(b"0000000000 65535 f \n")?;
        for offset in self.offsets.iter().skip(1) {
            if *offset > 9_999_999_999 {
                return Err(io::Error::new(
                    io::ErrorKind::FileTooLarge,
                    "PDF exceeds classic xref limit",
                ));
            }
            writeln!(self.output, "{offset:010} 00000 n ")?;
        }
        writeln!(
            self.output,
            "trailer\n<< /Size {} /Root {root_id} 0 R /Info {info_id} 0 R /ID [<{}> <{}>] >>\nstartxref\n{xref_offset}\n%%EOF",
            self.offsets.len(),
            uuid_hex(document_id),
            uuid_hex(instance_id),
        )?;
        self.output.flush()?;
        Ok(self.output)
    }
}

fn decode_png_base64(value: &str) -> Result<Vec<u8>, CommandError> {
    let encoded = value
        .trim()
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(value.trim());
    let maximum_encoded_length = MAX_PNG_BYTES.div_ceil(3) * 4 + 4;
    if encoded.is_empty() || encoded.len() > maximum_encoded_length {
        return Err(pdfx_error(
            "PDFX_PNG_TOO_LARGE",
            "单页 PNG 数据不得超过 48MB。",
        ));
    }
    let png = BASE64
        .decode(encoded.as_bytes())
        .map_err(|_| pdfx_error("PDFX_INVALID_PNG", "页面图像数据损坏，请重新生成这一页。"))?;
    if png.len() > MAX_PNG_BYTES {
        return Err(pdfx_error(
            "PDFX_PNG_TOO_LARGE",
            "单页 PNG 数据不得超过 48MB。",
        ));
    }
    if !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(pdfx_error(
            "PDFX_INVALID_PNG",
            "页面图像不是有效的 PNG 文件。",
        ));
    }
    Ok(png)
}

fn decode_png_to_rgb(
    png: &[u8],
    expected_width: u32,
    expected_height: u32,
) -> Result<Vec<u8>, CommandError> {
    let mut decoder = PngDecoder::new(Cursor::new(png));
    decoder.set_transformations(Transformations::EXPAND | Transformations::STRIP_16);
    decoder.set_ignore_text_chunk(true);
    let mut reader = decoder.read_info().map_err(|_| invalid_png_error())?;
    if reader.info().width != expected_width || reader.info().height != expected_height {
        return Err(pdfx_error(
            "PDFX_PAGE_SIZE_INVALID",
            format!("页面必须是 {expected_width} x {expected_height} 像素。"),
        ));
    }
    let output_size = reader.output_buffer_size().ok_or_else(invalid_png_error)?;
    let mut decoded = vec![0_u8; output_size];
    let output = reader
        .next_frame(&mut decoded)
        .map_err(|_| invalid_png_error())?;
    if output.bit_depth != BitDepth::Eight {
        return Err(invalid_png_error());
    }
    decoded.truncate(output.buffer_size());

    let pixel_count = (expected_width as usize)
        .checked_mul(expected_height as usize)
        .ok_or_else(internal_error)?;
    let expected_bytes = pixel_count
        .checked_mul(output.color_type.samples())
        .ok_or_else(internal_error)?;
    if decoded.len() != expected_bytes {
        return Err(invalid_png_error());
    }

    let mut rgb = Vec::with_capacity(pixel_count * 3);
    match output.color_type {
        PngColorType::Rgb => rgb.extend_from_slice(&decoded),
        PngColorType::Rgba => {
            for pixel in decoded.chunks_exact(4) {
                rgb.push(composite_over_white(pixel[0], pixel[3]));
                rgb.push(composite_over_white(pixel[1], pixel[3]));
                rgb.push(composite_over_white(pixel[2], pixel[3]));
            }
        }
        PngColorType::Grayscale => {
            for value in decoded {
                rgb.extend_from_slice(&[value, value, value]);
            }
        }
        PngColorType::GrayscaleAlpha => {
            for pixel in decoded.chunks_exact(2) {
                let value = composite_over_white(pixel[0], pixel[1]);
                rgb.extend_from_slice(&[value, value, value]);
            }
        }
        PngColorType::Indexed => return Err(invalid_png_error()),
    }
    Ok(rgb)
}

fn composite_over_white(component: u8, alpha: u8) -> u8 {
    let component = u32::from(component);
    let alpha = u32::from(alpha);
    ((component * alpha + 255 * (255 - alpha) + 127) / 255) as u8
}

fn encode_cmyk_jpeg(
    path: &Path,
    cmyk: &[u8],
    width: u32,
    height: u32,
) -> Result<u64, CommandError> {
    let width = u16::try_from(width).map_err(|_| internal_error())?;
    let height = u16::try_from(height).map_err(|_| internal_error())?;
    if cmyk.len() != usize::from(width) * usize::from(height) * 4 {
        return Err(internal_error());
    }
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| temp_write_error())?;
    let mut writer = BufWriter::new(file);
    let encode_result = {
        let mut encoder = JpegEncoder::new(&mut writer, 95);
        encoder.set_density(PixelDensity::dpi(300));
        encoder.set_sampling_factor(SamplingFactor::F_1_1);
        encoder.set_optimized_huffman_tables(true);
        encoder.encode(cmyk, width, height, JpegColorType::Cmyk)
    };
    if encode_result.is_err() || writer.flush().is_err() || writer.get_ref().sync_all().is_err() {
        drop(writer);
        let _ = fs::remove_file(path);
        return Err(temp_write_error());
    }
    drop(writer);
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|_| temp_write_error())
}

fn xmp_metadata(job: &PdfxJob, timestamp: &str, document_id: Uuid, instance_id: Uuid) -> String {
    let title = xml_escape(&job.title);
    let author = xml_escape(&job.author);
    format!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Wanxiang Deck PDF/X-4 Engine\">\n<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n<rdf:Description rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\" xmlns:pdfxid=\"http://www.npes.org/pdfx/ns/id/\" xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmlns:xmpMM=\"http://ns.adobe.com/xap/1.0/mm/\">\n<dc:format>application/pdf</dc:format>\n<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">{title}</rdf:li></rdf:Alt></dc:title>\n<dc:creator><rdf:Seq><rdf:li>{author}</rdf:li></rdf:Seq></dc:creator>\n<pdf:Producer>Wanxiang Deck PDF/X-4 Engine</pdf:Producer>\n<pdf:Trapped>False</pdf:Trapped>\n<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>\n<xmp:CreatorTool>Wanxiang Deck</xmp:CreatorTool>\n<xmp:CreateDate>{timestamp}</xmp:CreateDate>\n<xmp:ModifyDate>{timestamp}</xmp:ModifyDate>\n<xmp:MetadataDate>{timestamp}</xmp:MetadataDate>\n<xmpMM:DocumentID>uuid:{document_id}</xmpMM:DocumentID>\n<xmpMM:InstanceID>uuid:{instance_id}</xmpMM:InstanceID>\n</rdf:Description>\n</rdf:RDF>\n</x:xmpmeta>\n<?xpacket end=\"w\"?>"
    )
}

fn xml_escape(value: &str) -> Cow<'_, str> {
    if !value
        .bytes()
        .any(|byte| matches!(byte, b'&' | b'<' | b'>' | b'\'' | b'"'))
    {
        return Cow::Borrowed(value);
    }
    let mut escaped = String::with_capacity(value.len() + 16);
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '\'' => escaped.push_str("&apos;"),
            '"' => escaped.push_str("&quot;"),
            _ => escaped.push(character),
        }
    }
    Cow::Owned(escaped)
}

fn pdf_utf16_hex(value: &str) -> String {
    let mut encoded = String::from("<FEFF");
    for unit in value.encode_utf16() {
        encoded.push_str(&format!("{unit:04X}"));
    }
    encoded.push('>');
    encoded
}

fn uuid_hex(value: Uuid) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect()
}

fn page_object_id(index: usize) -> usize {
    7 + index * 3
}

struct PdfTimestamp {
    xmp: String,
    pdf: String,
}

fn utc_timestamp(time: SystemTime) -> PdfTimestamp {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    PdfTimestamp {
        xmp: format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z"),
        pdf: format!("D:{year:04}{month:02}{day:02}{hour:02}{minute:02}{second:02}Z"),
    }
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let days = days_since_epoch + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

fn validated_metadata_text(
    value: String,
    maximum_characters: usize,
) -> Result<String, CommandError> {
    let normalized = value.trim();
    if normalized.is_empty()
        || normalized.chars().count() > maximum_characters
        || normalized
            .chars()
            .any(|character| character.is_control() && character != '\n')
    {
        return Err(pdfx_error(
            "PDFX_INVALID_METADATA",
            "印刷文件的标题或创作者信息无效。",
        ));
    }
    Ok(normalized.to_owned())
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
        name = "wanxiang-deck-print".to_owned();
    }
    format!("{name}.pdf")
}

fn ensure_pdf_extension(path: &Path) -> PathBuf {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        path.to_path_buf()
    } else {
        path.with_extension("pdf")
    }
}

fn ensure_job_capacity(state: &State<'_, PdfxState>) -> Result<(), CommandError> {
    if lock_jobs(state)?.len() >= MAX_ACTIVE_JOBS {
        return Err(pdfx_error(
            "PDFX_TOO_MANY_JOBS",
            "同时进行的印刷导出过多，请先完成或取消其他导出。",
        ));
    }
    Ok(())
}

fn create_secure_temp_dir(path: &Path) -> Result<(), CommandError> {
    fs::create_dir(path).map_err(|_| temp_write_error())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::set_permissions(path, fs::Permissions::from_mode(0o700)).is_err() {
            let _ = fs::remove_dir(path);
            return Err(temp_write_error());
        }
    }
    Ok(())
}

fn commit_export(temporary: &Path, destination: &Path) -> Result<(), CommandError> {
    if let Err(error) = fs::rename(temporary, destination) {
        let _ = fs::remove_file(temporary);
        return Err(pdfx_error(
            "PDFX_SAVE_FAILED",
            format!("PDF/X-4 文件保存失败：{}。", io_error_kind(&error)),
        ));
    }
    if let Some(parent) = destination.parent()
        && let Ok(directory) = File::open(parent)
    {
        let _ = directory.sync_all();
    }
    Ok(())
}

fn io_error_kind(error: &io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::PermissionDenied => "没有写入权限",
        io::ErrorKind::StorageFull => "磁盘空间不足",
        io::ErrorKind::NotFound => "保存目录不存在",
        _ => "请检查保存目录与磁盘空间",
    }
}

fn validate_job_id(job_id: &str) -> Result<(), CommandError> {
    Uuid::parse_str(job_id)
        .map(|_| ())
        .map_err(|_| pdfx_error("PDFX_INVALID_JOB_ID", "PDF/X-4 导出任务编号无效。"))
}

fn find_job(state: &State<'_, PdfxState>, job_id: &str) -> Result<SharedPdfxJob, CommandError> {
    validate_job_id(job_id)?;
    lock_jobs(state)?.get(job_id).cloned().ok_or_else(|| {
        pdfx_error(
            "PDFX_JOB_NOT_FOUND",
            "找不到这项 PDF/X-4 导出，请重新开始导出。",
        )
    })
}

fn lock_jobs(state: &PdfxState) -> Result<MutexGuard<'_, PdfxJobs>, CommandError> {
    state.jobs.lock().map_err(|_| internal_error())
}

fn lock_job(job: &SharedPdfxJob) -> Result<MutexGuard<'_, PdfxJob>, CommandError> {
    job.lock().map_err(|_| internal_error())
}

fn invalid_png_error() -> CommandError {
    pdfx_error("PDFX_INVALID_PNG", "页面 PNG 无法解码，请重新生成这一页。")
}

fn temp_write_error() -> CommandError {
    pdfx_error(
        "PDFX_TEMP_WRITE_FAILED",
        "无法写入印刷导出的临时页面，请检查磁盘空间。",
    )
}

fn save_error() -> CommandError {
    pdfx_error(
        "PDFX_SAVE_FAILED",
        "PDF/X-4 文件保存失败，请检查目录权限和磁盘空间。",
    )
}

fn validation_error() -> CommandError {
    pdfx_error(
        "PDFX_VALIDATION_FAILED",
        "生成的 PDF/X-4 文件未通过内部印前结构校验，本次导出未报告为成功。",
    )
}

fn internal_error() -> CommandError {
    pdfx_error(
        "PDFX_INTERNAL_ERROR",
        "印刷导出出现内部错误，请取消后重新导出。",
    )
}

fn pdfx_error(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError::new(code, message)
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Cursor, time::Duration};

    use jpeg_encoder::{ColorType as JpegColorType, Encoder as JpegEncoder};
    use png::{BitDepth, ColorType as PngColorType, Encoder as PngEncoder};

    use super::*;

    fn rgba_png(width: u32, height: u32, pixels: &[u8]) -> Vec<u8> {
        let mut png = Vec::new();
        {
            let mut encoder = PngEncoder::new(&mut png, width, height);
            encoder.set_color(PngColorType::Rgba);
            encoder.set_depth(BitDepth::Eight);
            let mut writer = encoder.write_header().expect("PNG header");
            writer.write_image_data(pixels).expect("PNG pixels");
        }
        png
    }

    #[test]
    fn composites_transparent_png_over_white_without_distortion() {
        let png = rgba_png(2, 1, &[200, 100, 50, 255, 0, 10, 20, 0]);
        let rgb = decode_png_to_rgb(&png, 2, 1).expect("decoded RGB");
        assert_eq!(rgb, [200, 100, 50, 255, 255, 255]);
    }

    #[test]
    fn rejects_wrong_page_dimensions() {
        let png = rgba_png(1, 1, &[0, 0, 0, 255]);
        let error = decode_png_to_rgb(&png, 2, 1).expect_err("wrong page size");
        assert_eq!(error.code, "PDFX_PAGE_SIZE_INVALID");
    }

    #[test]
    fn bundled_profile_builds_real_four_channel_transform() {
        let converter = ColorConverter::new().expect("CMYK transform");
        let mut cmyk = [0_u8; 8];
        converter
            .transform
            .transform_pixels(&[255, 255, 255, 0, 0, 0], &mut cmyk);
        assert_eq!(cmyk.len(), 8);
        assert!(cmyk[4..].iter().any(|component| *component > 0));
    }

    #[test]
    fn pdf_writer_emits_pdfx4_output_intent_and_icc_cmyk_images() {
        let root = std::env::temp_dir().join(format!("pdfx-test-{}", Uuid::new_v4()));
        fs::create_dir(&root).expect("test directory");
        let jpeg_path = root.join("page.jpg");
        let mut jpeg = Vec::new();
        JpegEncoder::new(&mut jpeg, 100)
            .encode(&[0, 0, 0, 0], 1, 1, JpegColorType::Cmyk)
            .expect("CMYK JPEG");
        fs::write(&jpeg_path, &jpeg).expect("JPEG fixture");
        let destination = root.join("result.pdf");
        let job = PdfxJob {
            destination,
            temp_dir: root.join("pages"),
            title: "万象测试".to_owned(),
            author: "测试作者".to_owned(),
            expected_pages: 1,
            pages: vec![PdfxPage {
                role: PdfxPageRole::Rulebook,
                jpeg_path,
                jpeg_bytes: jpeg.len() as u64,
            }],
            status: JobStatus::Finalizing,
            converter: ColorConverter::new().expect("CMYK transform"),
        };
        let output = root.join("fixture.pdf");
        write_pdfx4(&job, &output).expect("PDF/X-4");
        let bytes = fs::read(&output).expect("PDF bytes");
        let syntax = String::from_utf8_lossy(&bytes);
        assert!(syntax.starts_with("%PDF-1.6"));
        assert!(syntax.contains("/GTS_PDFXVersion (PDF/X-4)"));
        assert!(syntax.contains("/S /GTS_PDFX"));
        assert!(syntax.contains("/DestOutputProfile 5 0 R"));
        assert!(syntax.contains("/ColorSpace [/ICCBased 5 0 R]"));
        assert!(syntax.contains("/N 4 /Alternate /DeviceCMYK"));
        assert!(syntax.contains("/MediaBox [0 0 595.2756 841.8898]"));
        assert!(syntax.contains("/TrimBox [0 0 595.2756 841.8898]"));
        assert!(syntax.contains("/BleedBox [0 0 595.2756 841.8898]"));
        assert!(!syntax.contains("/DeviceRGB"));
        verify_pdfx4_file(&output, 1).expect("internal structure validation");

        let mut missing_bleed_bytes = bytes;
        let bleed_key = b"/BleedBox";
        let bleed_position = missing_bleed_bytes
            .windows(bleed_key.len())
            .position(|window| window == bleed_key)
            .expect("BleedBox key");
        missing_bleed_bytes[bleed_position..bleed_position + bleed_key.len()]
            .copy_from_slice(b"/Bl33dBox");
        let missing_bleed = root.join("missing-bleed.pdf");
        fs::write(&missing_bleed, missing_bleed_bytes).expect("invalid PDF fixture");
        assert_eq!(
            verify_pdfx4_file(&missing_bleed, 1)
                .expect_err("explicit BleedBox is required")
                .code,
            "PDFX_VALIDATION_FAILED"
        );
        drop(job);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn timestamps_match_pdf_and_xmp_utc_forms() {
        let timestamp = utc_timestamp(UNIX_EPOCH + Duration::from_secs(1_704_067_200));
        assert_eq!(timestamp.xmp, "2024-01-01T00:00:00Z");
        assert_eq!(timestamp.pdf, "D:20240101000000Z");
    }

    #[test]
    fn sanitizes_pdfx_suggested_name() {
        assert_eq!(safe_pdf_name("../万象:牌组.PDF"), "万象牌组.pdf");
        assert_eq!(safe_pdf_name("  "), "wanxiang-deck-print.pdf");
        assert_eq!(
            safe_pdf_name("万象牌组--pdfx4-cmyk.pdf"),
            "万象牌组--pdfx4-cmyk.pdf"
        );
    }

    #[test]
    fn validates_base64_png_signature_and_limit() {
        let png = rgba_png(1, 1, &[0, 0, 0, 255]);
        let encoded = BASE64.encode(&png);
        assert_eq!(decode_png_base64(&encoded).expect("PNG"), png);
        let not_png = BASE64.encode(b"not a png");
        assert_eq!(
            decode_png_base64(&not_png).expect_err("invalid PNG").code,
            "PDFX_INVALID_PNG"
        );
    }

    #[test]
    fn pdf_utf16_and_xml_metadata_are_escaped() {
        assert_eq!(pdf_utf16_hex("A"), "<FEFF0041>");
        assert_eq!(xml_escape("A&B<\""), "A&amp;B&lt;&quot;");
    }

    #[test]
    fn raw_writer_rejects_missing_objects() {
        let cursor = Cursor::new(Vec::<u8>::new());
        let mut writer = PdfWriter::new(cursor, 2).expect("writer");
        writer.object(1, b"<<>>").expect("object one");
        assert!(writer.finish(1, 1, Uuid::new_v4(), Uuid::new_v4()).is_err());
    }

    #[test]
    #[ignore = "manual Poppler color-rendering QA fixture"]
    fn builds_cmyk_color_qa_fixture() {
        let output = std::env::var_os("WANXIANG_PDFX_QA_OUTPUT")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("wanxiang-deck-cmyk-pdfx4-qa.pdf"));
        let _ = fs::remove_file(&output);
        let fixture_root = std::env::temp_dir().join(format!("pdfx-color-qa-{}", Uuid::new_v4()));
        fs::create_dir(&fixture_root).expect("QA fixture directory");
        let png_path = fixture_root.join("color-grid.png");
        let swatches = [
            [255, 255, 255, 255],
            [0, 0, 0, 255],
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [0, 255, 255, 255],
            [255, 0, 255, 255],
            [255, 255, 0, 255],
        ];
        let mut pixels = Vec::with_capacity(PAGE_WIDTH as usize * PAGE_HEIGHT as usize * 4);
        for y in 0..PAGE_HEIGHT {
            for x in 0..PAGE_WIDTH {
                let row = usize::from(y >= PAGE_HEIGHT / 2);
                let column = ((x as usize) * 4 / PAGE_WIDTH as usize).min(3);
                pixels.extend_from_slice(&swatches[row * 4 + column]);
            }
        }
        let png = rgba_png(PAGE_WIDTH, PAGE_HEIGHT, &pixels);
        fs::write(&png_path, png).expect("QA PNG");
        build_pdfx4_for_qa(
            &output,
            "CMYK color rendering QA",
            "Wanxiang Deck",
            &[(png_path, "rulebook".to_owned())],
        )
        .expect("QA PDF/X-4");
        let _ = fs::remove_dir_all(fixture_root);
        println!("{}", output.display());
    }
}
