use serde::Deserialize;
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

use crate::{error::CommandError, gameplay::validate_card_gameplay};

const SEXUAL_ZH: &[&str] = &[
    "色情", "情色", "性爱", "裸体", "裸照", "性侵", "强奸", "乱伦", "恋童", "援交",
];
const SEXUAL_EN: &[&str] = &[
    "porn",
    "pornography",
    "nude",
    "naked",
    "erotic",
    "sexual",
    "rape",
    "incest",
    "pedophile",
    "fetish",
];
const VIOLENCE_ZH: &[&str] = &[
    "血腥", "虐杀", "肢解", "斩首", "开膛", "内脏", "碎尸", "屠杀",
];
const VIOLENCE_EN: &[&str] = &[
    "gore",
    "gory",
    "dismemberment",
    "beheading",
    "decapitation",
    "torture",
    "bloodbath",
    "massacre",
];
const SELF_HARM_ZH: &[&str] = &["自杀", "自残", "割腕"];
const SELF_HARM_EN: &[&str] = &["suicide", "self harm", "self injury"];
const EXTREMISM_ZH: &[&str] = &["恐怖主义", "恐怖袭击", "恐袭", "纳粹宣扬", "极端主义"];
const EXTREMISM_EN: &[&str] = &[
    "terrorism",
    "terrorist propaganda",
    "nazi propaganda",
    "extremism",
];
const DRUGS_ZH: &[&str] = &["毒品", "海洛因", "冰毒", "摇头丸", "吸毒"];
const DRUGS_EN: &[&str] = &["heroin", "methamphetamine", "cocaine", "illegal drugs"];

#[derive(Debug, PartialEq, Eq)]
pub struct SafetyAssessment {
    pub safe: bool,
    pub categories: Vec<&'static str>,
}

#[derive(Clone, Debug)]
pub struct ValidatedDeckInput {
    pub theme: String,
    pub play_style: String,
    pub play_style_label: &'static str,
    pub card_count: usize,
    pub art_style_id: String,
    pub art_style_label: &'static str,
    pub art_style_prompt: &'static str,
    pub rules_context: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ValidatedCardBrief {
    pub name: String,
    pub role: String,
    pub ability: String,
    pub flavor_text: String,
    pub attack: u8,
    pub defense: u8,
    pub rarity: String,
}

pub const DEFAULT_ART_STYLE_ID: &str = "danqing-animation";
const MAX_RULES_CONTEXT_CHARACTERS: usize = 8_000;

pub fn art_style_definition(value: &str) -> Option<(&'static str, &'static str)> {
    match value {
        "danqing-animation" => Some((
            "丹青动画 · 经典中国美术片气韵",
            "Original Chinese hand-painted animation-inspired art direction, xuan-paper texture, lyrical brush contours, warm cel-like color blocks, generous negative space and playful theatrical motion; do not imitate any named studio, franchise, or artist.",
        )),
        "freehand-ink" => Some((
            "水墨写意",
            "Original expressive Chinese ink-wash painting with layered wet and dry brushwork, controlled ink blooms, xuan-paper grain, cinnabar accents and poetic negative space.",
        )),
        "gongbi-rich-color" => Some((
            "工笔重彩",
            "Original gongbi-inspired meticulous painting with precise flowing linework, layered mineral pigments, elegant decorative detail and fine gold contours.",
        )),
        "paper-cut-festival" => Some((
            "锦纸剪影",
            "Original layered Chinese paper-cut illustration with crisp hand-cut silhouettes, folded symmetry, auspicious botanical motifs and visible fiber edges.",
        )),
        "shadow-puppet-glow" => Some((
            "皮影灯彩",
            "Original Chinese shadow-puppet-inspired illustration with translucent carved-leather shapes, articulated theatrical poses, intricate punched patterns and amber lantern backlight.",
        )),
        "dunhuang-mineral" => Some((
            "敦煌矿彩",
            "Original mural art using historic Dunhuang mineral-pigment vocabulary, flowing ribbon and cloud rhythms, azurite, malachite, cinnabar and aged earth-gold on matte plaster.",
        )),
        "lacquer-gilt" => Some((
            "漆器鎏金",
            "Original Chinese lacquerware-inspired fantasy illustration with deep black and cinnabar lacquer, hand-laid gold foil lines, subtle mother-of-pearl flecks and polished warm reflections.",
        )),
        "blue-white-porcelain" => Some((
            "青花瓷韵",
            "Original blue-and-white porcelain-inspired illustration with cobalt brush painting on luminous warm-white ceramic, glaze-softened pigment blooms and elegant cloud-and-water motifs.",
        )),
        "cloisonne-enamel" => Some((
            "铜胎珐琅",
            "Original Chinese cloisonne-enamel-inspired illustration with delicate gold-wire partitions, jewel-like enamel cells and polished turquoise, lapis, vermilion and ivory color.",
        )),
        "woodblock-new-year" => Some((
            "木版年画",
            "Original Chinese folk woodblock-print illustration with bold carved contours, slightly misregistered color layers, warm handmade paper and auspicious everyday storytelling.",
        )),
        "seal-bronze" => Some((
            "金石青铜",
            "Original Chinese bronze-and-seal-carving-inspired fantasy with cast-relief geometry, wholly original abstract motifs, warm aged bronze, jade patina and stamped rhythm.",
        )),
        "silk-landscape" => Some((
            "绢本青绿",
            "Original Chinese blue-green silk landscape-inspired fantasy with layered mineral mountains, fine silk texture, floating mist, journey-like spatial rhythm and warm gold outlines.",
        )),
        "celadon-crackle" => Some((
            "青瓷冰裂",
            "Original celadon-glaze-inspired illustration with luminous rain-washed blue-green ceramic atmosphere, delicate crackle network, soft rounded forms and restrained copper highlights.",
        )),
        "oracle-cosmos" => Some((
            "甲骨星图",
            "Original oracle-bone-and-celestial-map-inspired fantasy with abstract carved pictographic marks that are not readable text, luminous star paths and warm bone texture.",
        )),
        "cyber-guochao" => Some((
            "霓虹国潮",
            "Original futuristic Chinese visual language transforming cloud and lantern rhythms into energetic neon circuitry, with warm vermilion and gold balanced by jade cyan.",
        )),
        "stained-glass-fable" => Some((
            "晶彩寓言",
            "Original stained-glass storybook illustration with jewel-toned translucent panes, warm dark leading, radiant backlight and handcrafted irregular geometry.",
        )),
        "art-deco-cosmos" => Some((
            "金线几何",
            "Original early-modern geometric decorative illustration with radiant fan shapes, stepped symmetry, warm gold linework, coral and jade accents.",
        )),
        "storybook-gouache" => Some((
            "绘本厚彩",
            "Original hand-painted gouache storybook art with opaque layered brush strokes, tactile paper grain, warm natural light and sophisticated youth-friendly visual storytelling.",
        )),
        _ => None,
    }
}

fn is_zero_width(character: char) -> bool {
    matches!(
        character,
        '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}' | '\u{feff}'
    )
}

fn normalize(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .filter(|character| !is_zero_width(*character))
        .collect()
}

fn contains_obfuscated_ascii(value: &str, term: &str) -> bool {
    let source: Vec<char> = value.chars().collect();
    let target: Vec<char> = term
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect();

    if target.is_empty() {
        return false;
    }

    for start in 0..source.len() {
        if start > 0 && source[start - 1].is_ascii_alphanumeric() {
            continue;
        }

        let mut source_index = start;
        let mut matched = true;
        for expected in &target {
            while source_index < source.len() && !source[source_index].is_ascii_alphanumeric() {
                source_index += 1;
            }
            if source_index >= source.len()
                || source[source_index].to_ascii_lowercase() != *expected
            {
                matched = false;
                break;
            }
            source_index += 1;
        }

        if matched
            && (source_index == source.len() || !source[source_index].is_ascii_alphanumeric())
        {
            return true;
        }
    }

    false
}

pub fn assess_youth_safety(value: &str) -> SafetyAssessment {
    let normalized = normalize(value);
    let compact: String = normalized
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect();
    let mut categories = Vec::new();

    let category_definitions = [
        ("sexual", SEXUAL_ZH, SEXUAL_EN),
        ("graphic_violence", VIOLENCE_ZH, VIOLENCE_EN),
        ("self_harm", SELF_HARM_ZH, SELF_HARM_EN),
        ("extremism", EXTREMISM_ZH, EXTREMISM_EN),
        ("drugs", DRUGS_ZH, DRUGS_EN),
    ];

    for (category, chinese_terms, english_terms) in category_definitions {
        let chinese_match = chinese_terms.iter().any(|term| compact.contains(term));
        let english_match = english_terms
            .iter()
            .any(|term| contains_obfuscated_ascii(&normalized, term));
        if chinese_match || english_match {
            categories.push(category);
        }
    }

    SafetyAssessment {
        safe: categories.is_empty(),
        categories,
    }
}

pub fn validate_deck_input(
    theme: String,
    play_style: Option<String>,
    card_count: Option<u8>,
    art_style_id: Option<String>,
    rules_context: Option<String>,
) -> Result<ValidatedDeckInput, CommandError> {
    let theme = theme.trim().to_owned();
    let theme_length = theme.chars().count();
    if !(2..=120).contains(&theme_length) || theme.chars().any(char::is_control) {
        return Err(CommandError::new(
            "INVALID_THEME",
            "主题长度需为 2 至 120 个字符。",
        ));
    }

    let safety = assess_youth_safety(&theme);
    if !safety.safe {
        return Err(CommandError::new(
            "UNSAFE_THEME",
            "该主题不符合青少年内容规范，请更换为健康、友善的创意主题。",
        ));
    }

    let requested_style = play_style
        .unwrap_or_else(|| "strategy".to_owned())
        .trim()
        .to_ascii_lowercase();
    let (play_style, play_style_label) = match requested_style.as_str() {
        "reflex" | "reaction" => ("reaction", "快速反应"),
        "memory" => ("memory", "记忆配对"),
        "strategy" => ("strategy", "简单策略"),
        "expression" | "collaboration" => ("collaboration", "表达协作"),
        "mischief" | "chaos" => ("chaos", "欢乐互坑"),
        _ => {
            return Err(CommandError::new("INVALID_PLAY_STYLE", "请选择有效玩法。"));
        }
    };

    let card_count = usize::from(card_count.unwrap_or(5));
    if !(3..=8).contains(&card_count) {
        return Err(CommandError::new(
            "INVALID_CARD_COUNT",
            "卡牌数量需为 3 至 8 张。",
        ));
    }

    let art_style_id = art_style_id.unwrap_or_else(|| DEFAULT_ART_STYLE_ID.to_owned());
    let (art_style_label, art_style_prompt) = art_style_definition(&art_style_id)
        .ok_or_else(|| CommandError::new("INVALID_ART_STYLE", "请选择有效的美术风格。"))?;
    let rules_context = rules_context
        .map(|context| context.trim().to_owned())
        .map(|context| {
            let length = context.chars().count();
            if !(1..=MAX_RULES_CONTEXT_CHARACTERS).contains(&length)
                || context.chars().any(char::is_control)
            {
                return Err(CommandError::new(
                    "INVALID_RULES_CONTEXT",
                    "玩法约束长度需为 1 至 8000 个字符。",
                ));
            }
            if !assess_youth_safety(&context).safe {
                return Err(CommandError::new(
                    "UNSAFE_RULES_CONTEXT",
                    "玩法约束不符合青少年内容规范，请调整后重试。",
                ));
            }
            if !serde_json::from_str::<serde_json::Value>(&context)
                .ok()
                .is_some_and(|value| value.is_object())
            {
                return Err(CommandError::new(
                    "INVALID_RULES_CONTEXT",
                    "玩法约束必须是有效的结构化数据。",
                ));
            }
            Ok(context)
        })
        .transpose()?;

    Ok(ValidatedDeckInput {
        theme,
        play_style: play_style.to_owned(),
        play_style_label,
        card_count,
        art_style_id,
        art_style_label,
        art_style_prompt,
        rules_context,
    })
}

fn validate_card_text(
    value: String,
    maximum_characters: usize,
    field_label: &str,
) -> Result<String, CommandError> {
    let value = value.trim().to_owned();
    if value.is_empty()
        || value.chars().count() > maximum_characters
        || value.chars().any(char::is_control)
    {
        return Err(CommandError::new(
            "INVALID_CARD_BRIEF",
            format!("卡牌{field_label}内容无效。"),
        ));
    }
    Ok(value)
}

#[allow(clippy::too_many_arguments)]
pub fn validate_card_brief(
    name: String,
    role: String,
    ability: String,
    flavor_text: String,
    attack: i64,
    defense: i64,
    rarity: String,
) -> Result<ValidatedCardBrief, CommandError> {
    let card = ValidatedCardBrief {
        name: validate_card_text(name, 60, "名称")?,
        role: validate_card_text(role, 40, "角色")?,
        ability: validate_card_text(ability, 320, "能力")?,
        flavor_text: validate_card_text(flavor_text, 180, "铭文")?,
        attack: u8::try_from(attack)
            .ok()
            .filter(|value| *value <= 99)
            .ok_or_else(|| {
                CommandError::new("INVALID_CARD_BRIEF", "卡牌数值必须是 0 至 99 的整数。")
            })?,
        defense: u8::try_from(defense)
            .ok()
            .filter(|value| *value <= 99)
            .ok_or_else(|| {
                CommandError::new("INVALID_CARD_BRIEF", "卡牌数值必须是 0 至 99 的整数。")
            })?,
        rarity: validate_card_text(rarity, 24, "稀有度")?,
    };
    if !matches!(card.rarity.as_str(), "普通" | "稀有" | "史诗" | "传说") {
        return Err(CommandError::new("INVALID_CARD_BRIEF", "卡牌稀有度无效。"));
    }
    let safety_text = format!(
        "{}\n{}\n{}\n{}\n{}",
        card.name, card.role, card.ability, card.flavor_text, card.rarity
    );
    if !assess_youth_safety(&safety_text).safe {
        return Err(CommandError::new(
            "UNSAFE_CARD_BRIEF",
            "单卡内容不符合青少年内容规范，请调整后重试。",
        ));
    }
    Ok(card)
}

#[cfg(test)]
mod tests {
    use super::{assess_youth_safety, validate_card_brief, validate_deck_input};

    #[test]
    fn accepts_safe_theme() {
        assert!(assess_youth_safety("赛博朋克西游与星际工坊").safe);
    }

    #[test]
    fn blocks_obfuscated_unsafe_terms() {
        let chinese = assess_youth_safety("色 · 情主题");
        let english = assess_youth_safety("A g.o.r.e arena");
        assert!(!chinese.safe);
        assert!(chinese.categories.contains(&"sexual"));
        assert!(!english.safe);
        assert!(english.categories.contains(&"graphic_violence"));
    }

    #[test]
    fn avoids_longer_word_false_positive() {
        assert!(assess_youth_safety("The Heroine Guild").safe);
    }

    #[test]
    fn accepts_frontend_play_style_aliases() {
        let input = validate_deck_input(
            "云海机械城".to_owned(),
            Some("expression".to_owned()),
            Some(4),
            Some("dunhuang-mineral".to_owned()),
            Some("{\"modules\":[{\"name\":\"星铃触发\"}]}".to_owned()),
        )
        .expect("valid input");
        assert_eq!(input.play_style, "collaboration");
        assert_eq!(input.card_count, 4);
        assert_eq!(input.art_style_id, "dunhuang-mineral");
        assert!(input.rules_context.is_some());
    }

    #[test]
    fn rejects_unknown_art_style_ids() {
        let error = validate_deck_input(
            "云海机械城".to_owned(),
            Some("strategy".to_owned()),
            Some(4),
            Some("imitate-a-brand".to_owned()),
            None,
        )
        .expect_err("unknown style");
        assert_eq!(error.code, "INVALID_ART_STYLE");
    }

    #[test]
    fn validates_rules_context_and_card_brief_for_artwork_regeneration() {
        let unsafe_rules = validate_deck_input(
            "云海机械城".to_owned(),
            Some("strategy".to_owned()),
            Some(4),
            None,
            Some("加入血 · 腥处决规则".to_owned()),
        )
        .expect_err("unsafe rules");
        assert_eq!(unsafe_rules.code, "UNSAFE_RULES_CONTEXT");

        let card = validate_card_brief(
            "铜翼守卫".to_owned(),
            "护阵先锋".to_owned(),
            "星铃恰好为五时获得两点护盾".to_owned(),
            "云炉照彻长空".to_owned(),
            6,
            8,
            "稀有".to_owned(),
        )
        .expect("valid brief");
        assert_eq!((card.attack, card.defense), (6, 8));
    }
}

// ---- 交换卡组结构校验（原在 ai.rs 中，与 AI 生成无关，移到此处） ----

const MAX_EXCHANGE_CARDS: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExchangeDeck {
    id: String,
    theme: String,
    name: String,
    mode_id: String,
    story: String,
    rules: String,
    cards: Vec<ExchangeCard>,
    author: String,
    #[serde(default)]
    art_style_id: Option<String>,
    #[serde(default)]
    card_back: Option<ExchangeCardBack>,
    #[serde(default)]
    rule_kit: Option<ExchangeRuleKit>,
    #[serde(default)]
    creator_plaque: Option<ExchangeCreatorPlaque>,
    #[serde(default)]
    composition: Option<Value>,
    #[serde(default)]
    revision: Option<ExchangeDeckRevision>,
    #[serde(default)]
    content_policy: Option<Value>,
    #[serde(default)]
    provenance: Option<ExchangeProvenance>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExchangeDeckRevision {
    family_id: String,
    revision: i64,
    created_at: i64,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExchangeCard {
    id: String,
    name: String,
    title: String,
    mode_id: String,
    #[serde(rename = "artUrl")]
    _art_url: String,
    attack: i64,
    defense: i64,
    cost: i64,
    skill: String,
    flavor: String,
    rarity: String,
    author: String,
    #[serde(default)]
    inscription_style: Option<String>,
    #[serde(default)]
    inscription_placement: Option<String>,
    #[serde(default)]
    inscription_text: Option<String>,
    #[serde(default, rename = "gameplay")]
    _gameplay: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExchangeCardBack {
    style: String,
    seed: i64,
    label: String,
    #[serde(default)]
    #[serde(rename = "textureUrl")]
    _texture_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExchangeProvenance {
    cid: String,
    signer_peer_id: String,
    #[serde(default)]
    public_key: Option<String>,
    signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExchangeRuleKit {
    schema_version: i64,
    title: String,
    player_range: ExchangeNumberRange,
    duration_minutes: ExchangeNumberRange,
    age_from: i64,
    #[serde(rename = "teamMode")]
    _team_mode: bool,
    components: Vec<String>,
    modules: Vec<ExchangeRuleModule>,
    victory: ExchangeRuleVictory,
    custom_notes: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExchangeNumberRange {
    min: i64,
    max: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExchangeRuleModule {
    id: String,
    source: String,
    #[serde(default)]
    template_id: Option<String>,
    name: String,
    summary: String,
    glyph: String,
    accent_hex: String,
    tags: Vec<String>,
    #[serde(rename = "enabled")]
    _enabled: bool,
    parameters: Vec<ExchangeRuleParameter>,
    content: ExchangeRuleModuleContent,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExchangeRuleParameter {
    id: String,
    label: String,
    control: String,
    value: Value,
    #[serde(default)]
    min: Option<f64>,
    #[serde(default)]
    max: Option<f64>,
    #[serde(default)]
    step: Option<f64>,
    #[serde(default)]
    unit: Option<String>,
    #[serde(default)]
    choices: Option<Vec<ExchangeRuleParameterChoice>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExchangeRuleParameterChoice {
    value: String,
    label: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExchangeRuleModuleContent {
    objective: Vec<String>,
    setup: Vec<String>,
    flow: Vec<String>,
    victory: Vec<String>,
    variants: Vec<ExchangeRuleVariant>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExchangeRuleVariant {
    id: String,
    name: String,
    description: String,
    #[serde(default)]
    #[serde(rename = "enabled")]
    _enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExchangeRuleVictory {
    mode: String,
    #[serde(default)]
    target: Option<i64>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExchangeCreatorPlaque {
    display_name: String,
    #[serde(default)]
    studio_name: Option<String>,
    #[serde(default)]
    signature_text: Option<String>,
    #[serde(default)]
    seal_text: Option<String>,
    #[serde(default)]
    edition: Option<String>,
    #[serde(default)]
    serial_number: Option<String>,
    #[serde(default)]
    dedication: Option<String>,
}

#[cfg(test)]

fn invalid_exchange_deck(message: &'static str) -> CommandError {
    CommandError::new("SAFETY_INVALID_DECK", message)
}

fn valid_exchange_string(value: &str, maximum_characters: usize) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= maximum_characters
        && !value.chars().any(char::is_control)
}

fn valid_mode_id(value: &str) -> bool {
    matches!(
        value,
        "reflex" | "memory" | "strategy" | "expression" | "mischief"
    )
}

fn valid_optional_exchange_string(value: Option<&str>, maximum_characters: usize) -> bool {
    value
        .map(|text| valid_exchange_string(text, maximum_characters))
        .unwrap_or(true)
}

fn valid_hex_color(value: &str) -> bool {
    value
        .strip_prefix('#')
        .is_some_and(|hex| hex.len() == 6 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn valid_template_id(value: &str) -> bool {
    matches!(
        value,
        "rapid-match" | "memory-pair" | "quantity-trigger" | "icon-coop" | "risk-draw"
    )
}

fn validate_visible_strings<'a>(
    values: &'a [String],
    maximum_items: usize,
    maximum_characters: usize,
    require_nonempty: bool,
    visible_text: &mut Vec<&'a str>,
) -> bool {
    if values.len() > maximum_items || (require_nonempty && values.is_empty()) {
        return false;
    }
    if values
        .iter()
        .any(|value| !valid_exchange_string(value, maximum_characters))
    {
        return false;
    }
    visible_text.extend(values.iter().map(String::as_str));
    true
}

fn valid_optional_number(value: Option<f64>, positive: bool) -> bool {
    value
        .map(|number| {
            number.is_finite() && number.abs() <= 1_000_000.0 && (!positive || number > 0.0)
        })
        .unwrap_or(true)
}

fn validate_rule_parameter<'a>(
    parameter: &'a ExchangeRuleParameter,
    visible_text: &mut Vec<&'a str>,
) -> bool {
    if !valid_exchange_string(&parameter.id, 128)
        || !valid_exchange_string(&parameter.label, 160)
        || !matches!(
            parameter.control.as_str(),
            "stepper" | "toggle" | "select" | "text"
        )
        || !valid_optional_number(parameter.min, false)
        || !valid_optional_number(parameter.max, false)
        || !valid_optional_number(parameter.step, true)
        || parameter
            .min
            .zip(parameter.max)
            .is_some_and(|(minimum, maximum)| minimum > maximum)
        || !valid_optional_exchange_string(parameter.unit.as_deref(), 40)
    {
        return false;
    }

    match &parameter.value {
        Value::String(value) if valid_exchange_string(value, 500) => visible_text.push(value),
        Value::Bool(_) => {}
        Value::Number(number) => {
            let Some(value) = number.as_f64() else {
                return false;
            };
            if !value.is_finite() || value.abs() > 1_000_000.0 {
                return false;
            }
        }
        _ => return false,
    }

    visible_text.push(parameter.label.as_str());
    if let Some(unit) = parameter.unit.as_deref() {
        visible_text.push(unit);
    }
    if let Some(choices) = &parameter.choices {
        if choices.len() > 32
            || choices.iter().any(|choice| {
                !valid_exchange_string(&choice.value, 128)
                    || !valid_exchange_string(&choice.label, 160)
            })
        {
            return false;
        }
        for choice in choices {
            visible_text.extend([choice.value.as_str(), choice.label.as_str()]);
        }
    }
    true
}

fn validate_rule_module<'a>(
    module: &'a ExchangeRuleModule,
    visible_text: &mut Vec<&'a str>,
) -> bool {
    let valid_source = match module.source.as_str() {
        "template" => module.template_id.as_deref().is_some_and(valid_template_id),
        "custom" => module.template_id.is_none(),
        _ => false,
    };
    if !valid_source
        || !valid_exchange_string(&module.id, 128)
        || !valid_exchange_string(&module.name, 160)
        || !valid_exchange_string(&module.summary, 1_000)
        || !valid_exchange_string(&module.glyph, 8)
        || !valid_hex_color(&module.accent_hex)
        || module.parameters.len() > 32
    {
        return false;
    }

    visible_text.extend([
        module.name.as_str(),
        module.summary.as_str(),
        module.glyph.as_str(),
    ]);
    if !validate_visible_strings(&module.tags, 32, 80, false, visible_text)
        || !module
            .parameters
            .iter()
            .all(|parameter| validate_rule_parameter(parameter, visible_text))
        || !validate_visible_strings(&module.content.objective, 32, 1_000, true, visible_text)
        || !validate_visible_strings(&module.content.setup, 32, 1_000, true, visible_text)
        || !validate_visible_strings(&module.content.flow, 128, 1_000, true, visible_text)
        || !validate_visible_strings(&module.content.victory, 32, 1_000, true, visible_text)
        || module.content.variants.len() > 64
    {
        return false;
    }
    for variant in &module.content.variants {
        if !valid_exchange_string(&variant.id, 128)
            || !valid_exchange_string(&variant.name, 160)
            || !valid_exchange_string(&variant.description, 1_000)
        {
            return false;
        }
        visible_text.extend([variant.name.as_str(), variant.description.as_str()]);
    }
    true
}

fn validate_rule_kit<'a>(rule_kit: &'a ExchangeRuleKit, visible_text: &mut Vec<&'a str>) -> bool {
    if rule_kit.schema_version != 1
        || !valid_exchange_string(&rule_kit.title, 160)
        || !(1..=20).contains(&rule_kit.player_range.min)
        || !(rule_kit.player_range.min..=20).contains(&rule_kit.player_range.max)
        || !(1..=240).contains(&rule_kit.duration_minutes.min)
        || !(rule_kit.duration_minutes.min..=240).contains(&rule_kit.duration_minutes.max)
        || !(4..=18).contains(&rule_kit.age_from)
        || !(1..=16).contains(&rule_kit.modules.len())
    {
        return false;
    }
    visible_text.push(rule_kit.title.as_str());
    if !validate_visible_strings(&rule_kit.components, 64, 160, false, visible_text)
        || !validate_visible_strings(&rule_kit.custom_notes, 64, 1_000, false, visible_text)
        || !rule_kit
            .modules
            .iter()
            .all(|module| validate_rule_module(module, visible_text))
    {
        return false;
    }

    match rule_kit.victory.mode.as_str() {
        "module-default" | "last-standing" => {
            rule_kit.victory.target.is_none() && rule_kit.victory.text.is_none()
        }
        "first-to-points" => {
            rule_kit
                .victory
                .target
                .is_some_and(|target| (1..=999).contains(&target))
                && rule_kit.victory.text.is_none()
        }
        "custom" => {
            rule_kit.victory.target.is_none()
                && rule_kit
                    .victory
                    .text
                    .as_deref()
                    .is_some_and(|text| valid_exchange_string(text, 1_000))
                && {
                    visible_text.push(rule_kit.victory.text.as_deref().unwrap_or_default());
                    true
                }
        }
        _ => false,
    }
}

fn validate_creator_plaque<'a>(
    plaque: &'a ExchangeCreatorPlaque,
    visible_text: &mut Vec<&'a str>,
) -> bool {
    let fields = [
        (Some(plaque.display_name.as_str()), 160),
        (plaque.studio_name.as_deref(), 160),
        (plaque.signature_text.as_deref(), 160),
        (plaque.seal_text.as_deref(), 48),
        (plaque.edition.as_deref(), 80),
        (plaque.serial_number.as_deref(), 128),
        (plaque.dedication.as_deref(), 1_000),
    ];
    if fields
        .iter()
        .any(|(value, maximum)| !valid_optional_exchange_string(*value, *maximum))
    {
        return false;
    }
    visible_text.extend(fields.into_iter().filter_map(|(value, _)| value));
    true
}

fn is_original_exchange_content_policy(value: &Value) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == 2
            && object.get("schemaVersion").and_then(Value::as_u64) == Some(1)
            && object.get("mode").and_then(Value::as_str) == Some("original")
            && object
                .keys()
                .all(|key| matches!(key.as_str(), "schemaVersion" | "mode"))
    })
}

fn validate_exchange_gameplay(deck: &Value) -> Result<Vec<String>, CommandError> {
    let Some(cards) = deck.get("cards").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    if cards.len() > MAX_EXCHANGE_CARDS {
        return Err(invalid_exchange_deck("交换卡组包含过多卡牌。"));
    }

    let mut visible_text = Vec::new();
    for card in cards {
        let Some(object) = card.as_object() else {
            continue;
        };
        let text = validate_card_gameplay(object.get("gameplay"))
            .map_err(|_| invalid_exchange_deck("交换卡牌玩法绑定不符合安全要求。"))?;
        visible_text.extend(text.into_iter().map(str::to_owned));
    }
    Ok(visible_text)
}

fn validate_exchange_deck(deck: Value) -> Result<(), CommandError> {
    let encoded =
        serde_json::to_vec(&deck).map_err(|_| invalid_exchange_deck("交换卡组数据无法解析。"))?;
    if encoded.len() > 24 * 1024 * 1024 {
        return Err(CommandError::new(
            "SAFETY_DECK_TOO_LARGE",
            "交换卡组内容过大，无法安全审核。",
        ));
    }
    let gameplay_text = validate_exchange_gameplay(&deck)?;
    let deck: ExchangeDeck = serde_json::from_value(deck)
        .map_err(|_| invalid_exchange_deck("交换卡组格式不符合安全要求。"))?;

    if !valid_exchange_string(&deck.id, 128)
        || !valid_exchange_string(&deck.theme, 240)
        || !valid_exchange_string(&deck.name, 160)
        || !valid_exchange_string(&deck.story, 12_000)
        || !valid_exchange_string(&deck.rules, 12_000)
        || !valid_exchange_string(&deck.author, 160)
        || !valid_mode_id(&deck.mode_id)
        || deck
            .art_style_id
            .as_deref()
            .is_some_and(|style_id| art_style_definition(style_id).is_none())
        || deck
            .content_policy
            .as_ref()
            .is_some_and(|policy| !is_original_exchange_content_policy(policy))
        || deck
            .composition
            .as_ref()
            .is_some_and(|composition| !composition.is_object())
        || !(1..=MAX_EXCHANGE_CARDS).contains(&deck.cards.len())
    {
        return Err(invalid_exchange_deck("交换卡组字段不符合安全要求。"));
    }

    let mut visible_text = vec![
        deck.theme.as_str(),
        deck.name.as_str(),
        deck.story.as_str(),
        deck.rules.as_str(),
        deck.author.as_str(),
    ];
    for card in &deck.cards {
        if !valid_exchange_string(&card.id, 128)
            || !valid_exchange_string(&card.name, 160)
            || !valid_exchange_string(&card.title, 240)
            || !valid_exchange_string(&card.skill, 4_000)
            || !valid_exchange_string(&card.flavor, 4_000)
            || !valid_exchange_string(&card.author, 160)
            || card.mode_id != deck.mode_id
            || !valid_mode_id(&card.mode_id)
            || !matches!(card.rarity.as_str(), "普通" | "稀有" | "史诗" | "传说")
            || !(0..=99).contains(&card.attack)
            || !(0..=99).contains(&card.defense)
            || !(1..=9).contains(&card.cost)
            || card
                .inscription_style
                .as_deref()
                .map(|value| !matches!(value, "seal" | "signature"))
                .unwrap_or(false)
            || card
                .inscription_placement
                .as_deref()
                .map(|value| !matches!(value, "front" | "back"))
                .unwrap_or(false)
            || !valid_optional_exchange_string(card.inscription_text.as_deref(), 48)
        {
            return Err(invalid_exchange_deck("交换卡牌字段不符合安全要求。"));
        }
        visible_text.extend([
            card.name.as_str(),
            card.title.as_str(),
            card.skill.as_str(),
            card.flavor.as_str(),
            card.rarity.as_str(),
            card.author.as_str(),
        ]);
        if let Some(inscription_text) = card.inscription_text.as_deref() {
            visible_text.push(inscription_text);
        }
    }

    if let Some(card_back) = &deck.card_back {
        if !matches!(
            card_back.style.as_str(),
            "forge" | "constellation" | "circuit" | "sigil"
        ) || !(0..=i64::from(u32::MAX)).contains(&card_back.seed)
            || !valid_exchange_string(&card_back.label, 160)
        {
            return Err(invalid_exchange_deck("交换卡背字段不符合安全要求。"));
        }
        visible_text.push(card_back.label.as_str());
    }

    if let Some(rule_kit) = &deck.rule_kit
        && !validate_rule_kit(rule_kit, &mut visible_text)
    {
        return Err(invalid_exchange_deck("交换卡组玩法积木不符合安全要求。"));
    }

    if let Some(creator_plaque) = &deck.creator_plaque
        && !validate_creator_plaque(creator_plaque, &mut visible_text)
    {
        return Err(invalid_exchange_deck("交换卡组创作者铭牌不符合安全要求。"));
    }

    if let Some(revision) = &deck.revision
        && (!valid_exchange_string(&revision.family_id, 128)
            || !(1..=1_000_000).contains(&revision.revision)
            || !(0..=9_007_199_254_740_991_i64).contains(&revision.created_at)
            || !matches!(
                revision.reason.as_str(),
                "initial"
                    | "deck-generation"
                    | "card-regeneration"
                    | "manual-snapshot"
                    | "imported"
            ))
    {
        return Err(invalid_exchange_deck("交换卡组版本信息不符合安全要求。"));
    }

    if let Some(provenance) = &deck.provenance {
        let cid_valid = provenance
            .cid
            .strip_prefix("blake3:")
            .is_some_and(|digest| {
                digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            });
        if !cid_valid
            || !valid_exchange_string(&provenance.signer_peer_id, 256)
            || provenance
                .public_key
                .as_deref()
                .is_some_and(|public_key| !valid_exchange_string(public_key, 256))
            || !valid_exchange_string(&provenance.signature, 256)
        {
            return Err(invalid_exchange_deck("交换卡组签名信息无效。"));
        }
    }

    let mut safety_text = visible_text.join("\n");
    for value in gameplay_text {
        safety_text.push('\n');
        safety_text.push_str(&value);
    }
    if !assess_youth_safety(&safety_text).safe {
        return Err(CommandError::new(
            "UNSAFE_OUTPUT",
            "交换卡组文本未通过青少年内容审核。",
        ));
    }

    Ok(())
}

pub(crate) fn validate_exchange_deck_schema(deck: &Value) -> Result<(), CommandError> {
    validate_exchange_deck(deck.clone())
}

fn generated_card(card: &CardWithoutArtwork, artwork: Artwork) -> GeneratedCard {
    GeneratedCard {
