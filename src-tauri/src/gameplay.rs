use std::collections::HashSet;

use serde_json::{Map, Value};

pub(crate) const MAX_GAMEPLAY_BINDINGS_PER_CARD: usize = 16;

const MAX_SYMBOL_IDS_PER_BINDING: usize = 64;
const MAX_MODULE_ID_CHARS: usize = 128;
const MAX_GAMEPLAY_ID_CHARS: usize = 192;
const MAX_RULE_TOKEN_CHARS: usize = 128;
const MAX_SLOT_ROLE_CHARS: usize = 240;
const MAX_QUANTITY_VALUE: i64 = 12;
const MAX_ACTIVATION_RANK: i64 = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GameplayValidationError {
    InvalidCollection,
    InvalidBinding,
}

pub(crate) fn validate_card_gameplay(
    gameplay: Option<&Value>,
) -> Result<Vec<&str>, GameplayValidationError> {
    let Some(gameplay) = gameplay else {
        return Ok(Vec::new());
    };
    let bindings = gameplay
        .as_array()
        .filter(|bindings| bindings.len() <= MAX_GAMEPLAY_BINDINGS_PER_CARD)
        .ok_or(GameplayValidationError::InvalidCollection)?;

    let mut visible_text = Vec::new();
    for binding in bindings {
        validate_binding(binding, &mut visible_text)?;
    }
    Ok(visible_text)
}

fn validate_binding<'a>(
    binding: &'a Value,
    visible_text: &mut Vec<&'a str>,
) -> Result<(), GameplayValidationError> {
    let object = binding
        .as_object()
        .ok_or(GameplayValidationError::InvalidBinding)?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .ok_or(GameplayValidationError::InvalidBinding)?;

    match kind {
        "rapid" => validate_rapid(object, visible_text),
        "memory" => validate_memory(object, visible_text),
        "quantity" => validate_quantity(object, visible_text),
        "expression" => validate_expression(object, visible_text),
        "risk" => validate_risk(object, visible_text),
        "custom" => validate_custom(object, visible_text),
        _ => Err(GameplayValidationError::InvalidBinding),
    }
}

fn validate_rapid<'a>(
    object: &'a Map<String, Value>,
    visible_text: &mut Vec<&'a str>,
) -> Result<(), GameplayValidationError> {
    validate_fields(object, &["kind", "symbolIds", "moduleId", "matchRule"])?;
    let symbol_ids = object
        .get("symbolIds")
        .and_then(Value::as_array)
        .filter(|values| !values.is_empty() && values.len() <= MAX_SYMBOL_IDS_PER_BINDING)
        .ok_or(GameplayValidationError::InvalidBinding)?;
    let mut unique_symbols = HashSet::with_capacity(symbol_ids.len());
    for value in symbol_ids {
        let symbol_id = value
            .as_str()
            .filter(|value| valid_string(value, MAX_GAMEPLAY_ID_CHARS))
            .ok_or(GameplayValidationError::InvalidBinding)?;
        if !unique_symbols.insert(symbol_id) {
            return Err(GameplayValidationError::InvalidBinding);
        }
        visible_text.push(symbol_id);
    }
    optional_string(object, "moduleId", MAX_MODULE_ID_CHARS, visible_text)?;
    optional_string(object, "matchRule", MAX_RULE_TOKEN_CHARS, visible_text)?;
    Ok(())
}

fn validate_memory<'a>(
    object: &'a Map<String, Value>,
    visible_text: &mut Vec<&'a str>,
) -> Result<(), GameplayValidationError> {
    validate_fields(
        object,
        &["kind", "pairId", "pairRole", "factionId", "moduleId"],
    )?;
    required_string(object, "pairId", MAX_GAMEPLAY_ID_CHARS, visible_text)?;
    if !object
        .get("pairRole")
        .and_then(Value::as_str)
        .is_some_and(|value| matches!(value, "a" | "b"))
    {
        return Err(GameplayValidationError::InvalidBinding);
    }
    optional_string(object, "factionId", MAX_GAMEPLAY_ID_CHARS, visible_text)?;
    optional_string(object, "moduleId", MAX_MODULE_ID_CHARS, visible_text)?;
    Ok(())
}

fn validate_quantity<'a>(
    object: &'a Map<String, Value>,
    visible_text: &mut Vec<&'a str>,
) -> Result<(), GameplayValidationError> {
    validate_fields(
        object,
        &[
            "kind",
            "categoryId",
            "value",
            "targetTotal",
            "triggerRelation",
            "moduleId",
        ],
    )?;
    required_string(object, "categoryId", MAX_GAMEPLAY_ID_CHARS, visible_text)?;
    required_integer(object, "value", 1, MAX_QUANTITY_VALUE)?;
    optional_integer(object, "targetTotal", 2, MAX_QUANTITY_VALUE)?;
    optional_string(
        object,
        "triggerRelation",
        MAX_RULE_TOKEN_CHARS,
        visible_text,
    )?;
    optional_string(object, "moduleId", MAX_MODULE_ID_CHARS, visible_text)?;
    Ok(())
}

fn validate_expression<'a>(
    object: &'a Map<String, Value>,
    visible_text: &mut Vec<&'a str>,
) -> Result<(), GameplayValidationError> {
    validate_fields(object, &["kind", "targetId", "targetCategory", "moduleId"])?;
    required_string(object, "targetId", MAX_GAMEPLAY_ID_CHARS, visible_text)?;
    if !object
        .get("targetCategory")
        .and_then(Value::as_str)
        .is_some_and(|value| matches!(value, "animal" | "object" | "place" | "action" | "emotion"))
    {
        return Err(GameplayValidationError::InvalidBinding);
    }
    optional_string(object, "moduleId", MAX_MODULE_ID_CHARS, visible_text)?;
    Ok(())
}

fn validate_risk<'a>(
    object: &'a Map<String, Value>,
    visible_text: &mut Vec<&'a str>,
) -> Result<(), GameplayValidationError> {
    validate_fields(
        object,
        &[
            "kind",
            "cardKind",
            "actionKind",
            "activationRank",
            "moduleId",
        ],
    )?;
    if !object
        .get("cardKind")
        .and_then(Value::as_str)
        .is_some_and(|value| matches!(value, "hazard" | "rescue" | "action"))
    {
        return Err(GameplayValidationError::InvalidBinding);
    }
    optional_string(object, "actionKind", MAX_RULE_TOKEN_CHARS, visible_text)?;
    optional_integer(object, "activationRank", 1, MAX_ACTIVATION_RANK)?;
    optional_string(object, "moduleId", MAX_MODULE_ID_CHARS, visible_text)?;
    Ok(())
}

fn validate_custom<'a>(
    object: &'a Map<String, Value>,
    visible_text: &mut Vec<&'a str>,
) -> Result<(), GameplayValidationError> {
    validate_fields(object, &["kind", "moduleId", "slotRole"])?;
    required_string(object, "moduleId", MAX_MODULE_ID_CHARS, visible_text)?;
    required_string(object, "slotRole", MAX_SLOT_ROLE_CHARS, visible_text)?;
    Ok(())
}

fn validate_fields(
    object: &Map<String, Value>,
    allowed: &[&str],
) -> Result<(), GameplayValidationError> {
    if object.keys().all(|key| allowed.contains(&key.as_str())) {
        Ok(())
    } else {
        Err(GameplayValidationError::InvalidBinding)
    }
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
    maximum_chars: usize,
    visible_text: &mut Vec<&'a str>,
) -> Result<&'a str, GameplayValidationError> {
    let value = object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| valid_string(value, maximum_chars))
        .ok_or(GameplayValidationError::InvalidBinding)?;
    visible_text.push(value);
    Ok(value)
}

fn optional_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
    maximum_chars: usize,
    visible_text: &mut Vec<&'a str>,
) -> Result<Option<&'a str>, GameplayValidationError> {
    match object.get(field) {
        None => Ok(None),
        Some(value) => required_string_value(value, maximum_chars).map(|value| {
            visible_text.push(value);
            Some(value)
        }),
    }
}

fn required_string_value(
    value: &Value,
    maximum_chars: usize,
) -> Result<&str, GameplayValidationError> {
    value
        .as_str()
        .filter(|value| valid_string(value, maximum_chars))
        .ok_or(GameplayValidationError::InvalidBinding)
}

fn valid_string(value: &str, maximum_chars: usize) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= maximum_chars
        && !value.chars().any(char::is_control)
}

fn required_integer(
    object: &Map<String, Value>,
    field: &str,
    minimum: i64,
    maximum: i64,
) -> Result<i64, GameplayValidationError> {
    object
        .get(field)
        .and_then(Value::as_i64)
        .filter(|value| (minimum..=maximum).contains(value))
        .ok_or(GameplayValidationError::InvalidBinding)
}

fn optional_integer(
    object: &Map<String, Value>,
    field: &str,
    minimum: i64,
    maximum: i64,
) -> Result<Option<i64>, GameplayValidationError> {
    match object.get(field) {
        None => Ok(None),
        Some(_) => required_integer(object, field, minimum, maximum).map(Some),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{MAX_GAMEPLAY_BINDINGS_PER_CARD, validate_card_gameplay};

    #[test]
    fn accepts_all_six_typescript_binding_kinds() {
        let gameplay = json!([
            {
                "kind": "rapid",
                "symbolIds": ["rapid-match:s01", "rapid-match:s02"],
                "moduleId": "rapid-match",
                "matchRule": "same-symbol"
            },
            {
                "kind": "memory",
                "pairId": "memory-pair:p01",
                "pairRole": "a",
                "factionId": "azure",
                "moduleId": "memory-pair"
            },
            {
                "kind": "quantity",
                "categoryId": "quantity-trigger:c1",
                "value": 5,
                "targetTotal": 5,
                "triggerRelation": "exact",
                "moduleId": "quantity-trigger"
            },
            {
                "kind": "expression",
                "targetId": "icon-coop:t01",
                "targetCategory": "emotion",
                "moduleId": "icon-coop"
            },
            {
                "kind": "risk",
                "cardKind": "hazard",
                "activationRank": 1,
                "moduleId": "risk-draw"
            },
            {
                "kind": "custom",
                "moduleId": "maker-module",
                "slotRole": "机关协作 · 自定义角色 01"
            }
        ]);

        let visible = validate_card_gameplay(Some(&gameplay)).expect("valid gameplay");
        assert!(visible.contains(&"机关协作 · 自定义角色 01"));
        assert!(visible.contains(&"rapid-match:s01"));
    }

    #[test]
    fn accepts_legacy_missing_gameplay_and_an_explicit_empty_binding_list() {
        assert_eq!(validate_card_gameplay(None), Ok(Vec::new()));
        assert_eq!(validate_card_gameplay(Some(&json!([]))), Ok(Vec::new()));
    }

    #[test]
    fn rejects_non_arrays_and_binding_count_overflow() {
        assert!(validate_card_gameplay(Some(&json!({}))).is_err());
        let bindings = json!(
            (0..=MAX_GAMEPLAY_BINDINGS_PER_CARD)
                .map(|index| json!({
                    "kind": "custom",
                    "moduleId": format!("module-{index}"),
                    "slotRole": format!("role-{index}")
                }))
                .collect::<Vec<_>>()
        );
        assert!(validate_card_gameplay(Some(&bindings)).is_err());
    }

    #[test]
    fn rejects_unknown_fields_kinds_and_invalid_required_values() {
        for gameplay in [
            json!([{"kind": "unknown"}]),
            json!([{"kind": "rapid", "symbolIds": ["a"], "unexpected": true}]),
            json!([{"kind": "rapid", "symbolIds": []}]),
            json!([{"kind": "rapid", "symbolIds": ["a", "a"]}]),
            json!([{"kind": "memory", "pairId": "p1", "pairRole": "c"}]),
            json!([{"kind": "quantity", "categoryId": "c1", "value": 1.5}]),
            json!([{"kind": "expression", "targetId": "t1", "targetCategory": "person"}]),
            json!([{"kind": "risk", "cardKind": "trap", "activationRank": 1}]),
            json!([{"kind": "custom", "moduleId": "maker-module"}]),
        ] {
            assert!(
                validate_card_gameplay(Some(&gameplay)).is_err(),
                "{gameplay}"
            );
        }
    }

    #[test]
    fn enforces_string_and_integer_bounds_without_narrowing_extensible_tokens() {
        let extensible = json!([
            {"kind": "rapid", "symbolIds": ["s1"], "matchRule": "creator-rule"},
            {"kind": "quantity", "categoryId": "c1", "value": 1, "triggerRelation": "creator-relation"},
            {"kind": "risk", "cardKind": "action", "actionKind": "creator-action"}
        ]);
        validate_card_gameplay(Some(&extensible)).expect("string tokens stay extensible");

        for gameplay in [
            json!([{"kind": "custom", "moduleId": "\n", "slotRole": "role"}]),
            json!([{"kind": "quantity", "categoryId": "c1", "value": 0}]),
            json!([{"kind": "quantity", "categoryId": "c1", "value": 13}]),
            json!([{"kind": "quantity", "categoryId": "c1", "value": 1, "targetTotal": 1}]),
            json!([{"kind": "risk", "cardKind": "hazard", "activationRank": 65}]),
        ] {
            assert!(
                validate_card_gameplay(Some(&gameplay)).is_err(),
                "{gameplay}"
            );
        }
    }
}
