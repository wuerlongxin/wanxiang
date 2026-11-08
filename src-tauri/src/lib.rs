mod builtin_artwork;
mod error;
mod external_links;
mod gameplay;
mod p2p;
mod pdf;
mod pdfx;
mod safety;
mod storage;

pub use error::CommandError;
pub use external_links::open_project_repository;
pub use p2p::{
    P2pState, p2p_connect, p2p_respond_offer, p2p_send_offer, p2p_snapshot, p2p_start, p2p_stop,
};
pub use pdf::{SavePdfResult, save_pdf};
pub use pdfx::{
    AppendPdfx4PageResult, BeginPdfx4ExportResult, CancelPdfx4ExportResult,
    FinishPdfx4ExportResult, PdfxState, append_pdfx4_page, begin_pdfx4_export, build_pdfx4_for_qa,
    cancel_pdfx4_export, finish_pdfx4_export,
};
pub use storage::{
    DeckLibrary, ExportDeckProjectResult, ImportDeckProjectResult, OpenDeckProjectFileResult,
    export_deck_project, import_deck_project, load_deck_library, open_deck_project_file,
    save_deck_library, save_deck_project_file,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(P2pState::default())
        .manage(PdfxState::default())
        .invoke_handler(tauri::generate_handler![
            open_project_repository,
            save_pdf,
            begin_pdfx4_export,
            append_pdfx4_page,
            finish_pdfx4_export,
            cancel_pdfx4_export,
            p2p_start,
            p2p_stop,
            p2p_snapshot,
            p2p_connect,
            p2p_send_offer,
            p2p_respond_offer,
            load_deck_library,
            save_deck_library,
            export_deck_project,
            import_deck_project,
            save_deck_project_file,
            open_deck_project_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wanxiang Deck");
}
