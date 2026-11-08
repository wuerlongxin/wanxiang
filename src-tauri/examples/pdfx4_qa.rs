use std::{env, fs, path::PathBuf, process};

use wanxiang_deck_lib::build_pdfx4_for_qa;

fn fail(message: impl AsRef<str>) -> ! {
    eprintln!("{}", message.as_ref());
    process::exit(1);
}

fn main() {
    let mut arguments = env::args_os().skip(1);
    let pages_directory = arguments
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| fail("missing pages directory"));
    let output = arguments
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| fail("missing output path"));
    let title = arguments
        .next()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| fail("missing PDF title"));
    let author = arguments
        .next()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| fail("missing PDF author"));
    if arguments.next().is_some() {
        fail("unexpected extra arguments");
    }
    if output.exists() {
        fail("refusing to overwrite an existing QA PDF");
    }

    let mut png_paths = fs::read_dir(&pages_directory)
        .unwrap_or_else(|_| fail("unable to read QA pages directory"))
        .map(|entry| {
            entry
                .map(|entry| entry.path())
                .unwrap_or_else(|_| fail("unable to enumerate QA pages"))
        })
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
        })
        .collect::<Vec<_>>();
    png_paths.sort();
    if png_paths.is_empty() {
        fail("QA pages directory contains no PNG pages");
    }

    let pages = png_paths
        .into_iter()
        .enumerate()
        .map(|(expected_index, path)| {
            let stem = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_else(|| fail("QA page name is not valid UTF-8"));
            let (index, role) = stem
                .split_once('-')
                .unwrap_or_else(|| fail("QA page name must be INDEX-role.png"));
            let index = index
                .parse::<usize>()
                .unwrap_or_else(|_| fail("QA page index is invalid"));
            if index != expected_index {
                fail("QA page indexes are not contiguous");
            }
            if !matches!(role, "cardFront" | "cardBack" | "rulebook" | "rightsNotice") {
                fail("QA page role is invalid");
            }
            let role = role.to_owned();
            (path, role)
        })
        .collect::<Vec<_>>();

    if let Err(error) = build_pdfx4_for_qa(&output, &title, &author, &pages) {
        fail(format!("{}: {}", error.code, error.message));
    }
    println!("PDFX4_QA_PATH={}", output.display());
    println!("PDFX4_QA_PAGES={}", pages.len());
}
