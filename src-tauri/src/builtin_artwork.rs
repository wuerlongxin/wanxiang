const CARD_ASSET_PREFIX: &str = "/assets/cards/";

fn is_builtin_mode(value: &str) -> bool {
    matches!(
        value,
        "reflex" | "memory" | "strategy" | "expression" | "mischief"
    )
}

pub(crate) fn is_builtin_card_artwork_path(value: &str) -> bool {
    let Some(relative_path) = value.strip_prefix(CARD_ASSET_PREFIX) else {
        return false;
    };
    let Some((stem, extension)) = relative_path.rsplit_once('.') else {
        return false;
    };
    if !matches!(extension, "jpg" | "webp") {
        return false;
    }

    let Some(starter_stem) = stem.strip_prefix("starter/") else {
        return is_builtin_mode(stem);
    };
    let Some((mode, card_number)) = starter_stem.rsplit_once('-') else {
        return false;
    };
    is_builtin_mode(mode) && matches!(card_number, "1" | "2" | "3" | "4")
}

#[cfg(test)]
mod tests {
    use super::is_builtin_card_artwork_path;

    #[test]
    fn accepts_current_and_legacy_concept_and_starter_artwork() {
        for extension in ["jpg", "webp"] {
            for mode in ["reflex", "memory", "strategy", "expression", "mischief"] {
                assert!(is_builtin_card_artwork_path(&format!(
                    "/assets/cards/{mode}.{extension}"
                )));
                for card_number in 1..=4 {
                    assert!(is_builtin_card_artwork_path(&format!(
                        "/assets/cards/starter/{mode}-{card_number}.{extension}"
                    )));
                }
            }
        }
    }

    #[test]
    fn rejects_unlisted_or_ambiguous_artwork_paths() {
        for path in [
            "/assets/cards/reflex.png",
            "/assets/cards/reflex-1.jpg",
            "/assets/cards/starter/reflex-0.jpg",
            "/assets/cards/starter/reflex-5.webp",
            "/assets/cards/starter/reflex-01.jpg",
            "/assets/cards/starter/unknown-1.jpg",
            "/assets/cards/starter/reflex-1.jpg?revision=2",
            "/assets/cards/starter/../reflex.jpg",
            "/assets/cards/starter/%2e%2e/reflex.jpg",
            "/assets/cards//starter/reflex-1.jpg",
        ] {
            assert!(!is_builtin_card_artwork_path(path), "accepted {path}");
        }
    }
}
