#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import shutil
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageStat


PROJECT_ROOT = Path(__file__).resolve().parent.parent
APP_LIBRARY_ROOT = Path.home() / "Library/Application Support/com.wanxiang.deck/deck-library"
APP_LIBRARY_PATH = APP_LIBRARY_ROOT / "library.json"
APP_ASSET_DIR = APP_LIBRARY_ROOT / "assets"
OUTPUT_DIR = PROJECT_ROOT / "docs/images/generated-deck"
RAW_DIR = OUTPUT_DIR / "raw"
ARTWORK_DIR = OUTPUT_DIR / "artwork"
CARD_DIR = OUTPUT_DIR / "cards"
DATA_PATH = OUTPUT_DIR / "deck.json"
FULL_DECK_PATH = OUTPUT_DIR / "full-deck.jpg"
FEATURED_PATH = OUTPUT_DIR / "featured-cards.jpg"
MAKING_OF_PATH = OUTPUT_DIR / "making-of.gif"
SHOWCASE_PATH = OUTPUT_DIR / "showcase.gif"

CARD_WIDTH = 700
CARD_HEIGHT = 900
SOURCE_DECK_NAME = "星图回响 · 炼制中"
FINAL_DECK_NAME = "星图回响 · 完整配对套牌"
AUTHOR = "鲸屿"

SANS_FONT = "/System/Library/Fonts/STHeiti Medium.ttc"
SANS_LIGHT_FONT = "/System/Library/Fonts/STHeiti Light.ttc"
SERIF_FONT = "/System/Library/Fonts/Supplemental/Songti.ttc"


def ensure_dirs() -> None:
    for directory in (OUTPUT_DIR, RAW_DIR, ARTWORK_DIR, CARD_DIR):
        directory.mkdir(parents=True, exist_ok=True)
    for path in OUTPUT_DIR.glob("probe-*"):
        path.unlink()
    for directory in (RAW_DIR, ARTWORK_DIR, CARD_DIR):
        for path in directory.glob("*.jpg"):
            match = re.fullmatch(r"card-(\d{2})\.jpg", path.name)
            if not match or int(match.group(1)) > 48:
                path.unlink()


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def text_width(draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.ImageFont) -> float:
    box = draw.textbbox((0, 0), text, font=text_font)
    return box[2] - box[0]


def fit_font(draw: ImageDraw.ImageDraw, text: str, path: str, max_size: int, max_width: int) -> ImageFont.FreeTypeFont:
    size = max_size
    while size > 12:
        candidate = font(path, size)
        if text_width(draw, text, candidate) <= max_width:
            return candidate
        size -= 1
    return font(path, size)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.ImageFont, width: int, max_lines: int) -> list[str]:
    compact = re.sub(r"\s+", " ", text.strip())
    lines: list[str] = []
    line = ""
    for char in compact:
        candidate = line + char
        if not line or text_width(draw, candidate, text_font) <= width:
            line = candidate
            continue
        lines.append(line)
        line = char
        if len(lines) >= max_lines:
            break
    if len(lines) < max_lines and line:
        lines.append(line)
    consumed = len("".join(lines))
    if consumed < len(compact) and lines:
        tail = list(lines[-1])
        if tail:
            tail[-1] = "…"
            lines[-1] = "".join(tail)
    return lines


def gradient_background(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height), "#15110d")
    pixels = image.load()
    stops = [
        (0.0, (20, 17, 13)),
        (0.38, (32, 62, 60)),
        (0.72, (70, 45, 38)),
        (1.0, (15, 23, 37)),
    ]
    for y in range(height):
        for x in range(width):
            ratio = (x / max(1, width - 1) + y / max(1, height - 1)) / 2
            for index in range(len(stops) - 1):
                a_pos, a = stops[index]
                b_pos, b = stops[index + 1]
                if a_pos <= ratio <= b_pos:
                    local = (ratio - a_pos) / (b_pos - a_pos)
                    color = tuple(round(a[channel] * (1 - local) + b[channel] * local) for channel in range(3))
                    pixels[x, y] = color
                    break
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for index in range(10):
        y = int(height * (0.15 + index * 0.075))
        draw.arc((int(width * 0.05), y - 70, int(width * 0.94), y + 95), 192, 346, fill=(214, 178, 108, 42), width=2)
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def asset_hash(reference: str) -> str | None:
    match = re.search(r"artificer-asset:v1:blake3:([0-9a-f]{64})", reference)
    return match.group(1) if match else None


def load_source_deck() -> dict:
    library = json.loads(APP_LIBRARY_PATH.read_text())
    for deck in library.get("decks", []):
        if deck.get("name") == SOURCE_DECK_NAME:
            return deck
    raise RuntimeError(f"找不到作品库套牌：{SOURCE_DECK_NAME}")


def copy_library_raw_images(deck: dict) -> None:
    cards = deck.get("cards", [])
    if len(cards) < 40:
        raise RuntimeError(f"作品库素材不足 40 张：{len(cards)}")
    for index, card in enumerate(cards[:40], 1):
        digest = asset_hash(card.get("artUrl", ""))
        if not digest:
            raise RuntimeError(f"第 {index} 张卡不是作品库资产引用。")
        source = APP_ASSET_DIR / f"{digest}.bin"
        if not source.exists():
            raise RuntimeError(f"找不到作品库图片资产：{source}")
        shutil.copyfile(source, RAW_DIR / f"card-{index:02d}.jpg")


def missing_cards() -> list[dict]:
    pairs = {
        21: ("玉梭星桥", "稀有"),
        22: ("双鹤潮汐", "普通"),
        23: ("月门灯阵", "普通"),
        24: ("鲸舟天图", "传说"),
    }
    cards: list[dict] = []
    index = 41
    for pair, (core, rarity) in pairs.items():
        for side, defense in (("a", 1), ("b", 2)):
            side_label = side.upper()
            counterpart = "B" if side == "a" else "A"
            role = f"配对线索 {side_label}"
            card = {
                "id": f"readme-memory-{pair}-{side}",
                "name": f"星图回响·{core}·{side_label}",
                "title": role,
                "modeId": "memory",
                "artUrl": f"docs/images/generated-deck/artwork/card-{index:02d}.jpg",
                "attack": pair,
                "defense": defense,
                "cost": max(1, min(9, math.ceil((pair + defense) / 6))),
                "skill": f"【玩法印谱】配对 {pair} 的 {side_label} 半契，需与 {counterpart} 半契相合。",
                "flavor": f"第 {pair} 组星痕被分作 {side_label} 半契，云山与星潮在另一张牌上回应。",
                "rarity": rarity,
                "author": AUTHOR,
                "inscriptionStyle": "seal",
                "inscriptionPlacement": "front",
                "inscriptionText": AUTHOR,
                "gameplay": [
                    {
                        "kind": "memory",
                        "moduleId": "memory-pair-1",
                        "pairId": f"pair-{pair}",
                        "pairRole": side,
                    }
                ],
            }
            raw_path = RAW_DIR / f"card-{index:02d}.jpg"
            if not raw_path.exists():
                raise RuntimeError(f"缺少补生成图片：{raw_path}")
            cards.append(card)
            index += 1
    return cards


def complete_deck(source: dict) -> dict:
    cards = []
    for index, card in enumerate(source.get("cards", [])[:40], 1):
        next_card = dict(card)
        next_card["artUrl"] = f"docs/images/generated-deck/artwork/card-{index:02d}.jpg"
        next_card.setdefault("author", AUTHOR)
        cards.append(next_card)
    cards.extend(missing_cards())
    composition = dict(source.get("composition", {}))
    composition["status"] = "complete"
    composition["recommendedTotal"] = 48
    deck = dict(source)
    deck.update(
        {
            "id": "readme-memory-complete-48",
            "name": FINAL_DECK_NAME,
            "theme": "星图回响",
            "story": "本套牌从桌面作品库中已生成的 40 张《星图回响》继续补齐，最终形成 24 对、48 张的完整记忆配对盒装。A/B 半契共享识别核心，但角色动作、场景状态与画面线索互补而不复制。",
            "rules": "24 对 A/B 半契 · 2-6 人 · 标准局 36 张 · 完整盒装 48 张",
            "cards": cards,
            "author": AUTHOR,
            "artStyleId": source.get("artStyleId", "silk-landscape"),
            "composition": composition,
            "contentPolicy": {"schemaVersion": 1, "mode": "original"},
        }
    )
    if deck.get("creatorPlaque"):
        plaque = dict(deck["creatorPlaque"])
        plaque["edition"] = "本地模板完整首版"
        deck["creatorPlaque"] = plaque
    return deck


def source_image(index: int) -> Image.Image:
    path = RAW_DIR / f"card-{index:02d}.jpg"
    image = Image.open(path).convert("RGB")
    stat = sum(ImageStat.Stat(image.resize((64, 64))).mean) / 3
    if stat < 2:
        raise RuntimeError(f"图片看起来为空：{path}")
    return image


def crop_art(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.54))


def rounded_paste(base: Image.Image, image: Image.Image, box: tuple[int, int], radius: int) -> None:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.size[0], image.size[1]), radius=radius, fill=255)
    base.paste(image, box, mask)


def shadowed_paste(base: Image.Image, image: Image.Image, center: tuple[int, int], angle: float = 0.0, alpha: int = 255, scale_x: float = 1.0) -> None:
    width = max(2, int(image.width * scale_x))
    transformed = image.resize((width, image.height), Image.Resampling.BICUBIC)
    if alpha < 255:
        transformed = transformed.convert("RGBA")
        transformed.putalpha(alpha)
    rotated = transformed.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    shadow = Image.new("RGBA", rotated.size, (0, 0, 0, 0))
    shadow_alpha = rotated.getchannel("A") if rotated.mode == "RGBA" else Image.new("L", rotated.size, 255)
    shadow.putalpha(shadow_alpha.filter(ImageFilter.GaussianBlur(10)))
    x = int(center[0] - rotated.width / 2)
    y = int(center[1] - rotated.height / 2)
    base.alpha_composite(shadow, (x + 8, y + 10))
    base.alpha_composite(rotated.convert("RGBA"), (x, y))


def render_artwork(index: int) -> Image.Image:
    artwork = crop_art(source_image(index), (CARD_WIDTH, CARD_HEIGHT))
    artwork.save(ARTWORK_DIR / f"card-{index:02d}.jpg", quality=92, optimize=True)
    return artwork


def render_card(card: dict, index: int, artwork: Image.Image) -> Image.Image:
    image = Image.new("RGBA", (CARD_WIDTH, CARD_HEIGHT), (18, 24, 30, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, CARD_WIDTH - 1, CARD_HEIGHT - 1), radius=42, fill=(20, 30, 34), outline=(207, 169, 91), width=9)
    draw.rounded_rectangle((24, 24, CARD_WIDTH - 25, CARD_HEIGHT - 25), radius=30, outline=(77, 143, 137), width=3)
    draw.rounded_rectangle((46, 42, CARD_WIDTH - 47, 118), radius=16, fill=(22, 24, 27, 220), outline=(207, 169, 91), width=2)

    title_font = fit_font(draw, card["name"], SERIF_FONT, 39, 470)
    draw.text((70, 67), card["name"], fill=(244, 224, 184), font=title_font, anchor="lm")
    rarity_color = {
        "普通": (230, 213, 168),
        "稀有": (96, 203, 162),
        "史诗": (117, 174, 255),
        "传说": (255, 202, 105),
    }.get(card.get("rarity"), (230, 213, 168))
    draw.rounded_rectangle((548, 60, 632, 94), radius=9, fill=(4, 8, 10, 130), outline=rarity_color, width=1)
    draw.text((590, 78), card.get("rarity", "普通"), fill=rarity_color, font=font(SANS_FONT, 19), anchor="mm")

    art = crop_art(artwork, (604, 488))
    rounded_paste(image, art.convert("RGBA"), (48, 138), 24)
    draw.rounded_rectangle((48, 138, 652, 626), radius=24, outline=(207, 169, 91), width=3)

    for label, value, x, color in (
        ("攻", card.get("attack", 0), 88, (216, 178, 101)),
        ("守", card.get("defense", 0), 612, (79, 169, 166)),
    ):
        draw.ellipse((x - 43, 588, x + 43, 674), fill=color, outline=(244, 224, 184), width=3)
        draw.text((x, 620), str(value), fill=(20, 22, 23), font=font(SANS_FONT, 31), anchor="mm")
        draw.text((x, 652), label, fill=(20, 22, 23), font=font(SANS_FONT, 15), anchor="mm")

    draw.rounded_rectangle((48, 652, 652, 814), radius=19, fill=(22, 24, 27, 226), outline=(77, 143, 137), width=2)
    role_font = font(SANS_FONT, 24)
    draw.text((72, 687), card.get("title", "配对线索"), fill=(112, 204, 196), font=role_font, anchor="lm")
    skill = str(card.get("skill", "")).replace("【玩法印谱】", "").split("\n")[0]
    body_font = font(SANS_LIGHT_FONT, 22)
    for line_index, line in enumerate(wrap_text(draw, skill, body_font, 520, 3)):
        draw.text((72, 724 + line_index * 30), line, fill=(238, 223, 190), font=body_font)

    draw.text((CARD_WIDTH // 2, 854), f"{AUTHOR} · 本地模板完整首版", fill=(217, 196, 150), font=font(SANS_LIGHT_FONT, 18), anchor="mm")
    image.convert("RGB").save(CARD_DIR / f"card-{index:02d}.jpg", quality=90, optimize=True)
    return image


def render_back(deck: dict) -> Image.Image:
    image = Image.new("RGBA", (CARD_WIDTH, CARD_HEIGHT), (15, 28, 32, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, CARD_WIDTH - 1, CARD_HEIGHT - 1), radius=42, fill=(17, 34, 39), outline=(207, 169, 91), width=9)
    draw.rounded_rectangle((40, 40, 660, 860), radius=30, outline=(77, 143, 137), width=4)
    for angle in range(0, 180, 18):
        box = (145, 250, 555, 650)
        draw.arc(box, start=angle, end=angle + 210, fill=(207, 169, 91, 82), width=3)
    draw.text((350, 390), "星图", fill=(244, 224, 184), font=font(SERIF_FONT, 82), anchor="mm")
    draw.text((350, 472), "回响", fill=(244, 224, 184), font=font(SERIF_FONT, 82), anchor="mm")
    draw.text((350, 565), deck["name"], fill=(112, 204, 196), font=font(SANS_FONT, 25), anchor="mm")
    return image


def render_all_cards(deck: dict) -> tuple[list[Image.Image], Image.Image]:
    cards: list[Image.Image] = []
    for index, card in enumerate(deck["cards"], 1):
        artwork = render_artwork(index)
        cards.append(render_card(card, index, artwork))
    return cards, render_back(deck)


def render_full_deck(deck: dict, card_images: list[Image.Image]) -> None:
    columns = 8
    card_w, card_h, gap = 210, 270, 22
    margin_x, header_h, footer_h = 88, 250, 96
    rows = math.ceil(len(card_images) / columns)
    width = margin_x * 2 + columns * card_w + (columns - 1) * gap
    height = header_h + rows * card_h + (rows - 1) * gap + footer_h
    image = gradient_background(width, height).convert("RGBA")
    draw = ImageDraw.Draw(image)
    draw.text((margin_x, 92), deck["name"], fill=(244, 224, 184), font=font(SERIF_FONT, 58), anchor="lm")
    draw.text((margin_x, 137), "真实作品库素材 + 补生成 · 48 张 · 24 对 A/B 半契 · 绢本青绿", fill=(244, 224, 184, 205), font=font(SANS_FONT, 25), anchor="lm")
    story_font = font(SANS_LIGHT_FONT, 22)
    for line_index, line in enumerate(wrap_text(draw, deck["story"], story_font, width - margin_x * 2, 2)):
        draw.text((margin_x, 176 + line_index * 34), line, fill=(244, 224, 184, 190), font=story_font)
    for index, card in enumerate(card_images):
        col, row = index % columns, index // columns
        x = margin_x + col * (card_w + gap)
        y = header_h + row * (card_h + gap)
        thumb = card.resize((card_w, card_h), Image.Resampling.LANCZOS)
        shadowed_paste(image, thumb, (x + card_w // 2, y + card_h // 2), 0)
    draw.text((width // 2, height - 44), "24 对互补线索全部齐套；卡名、A/B 半契、数值与稀有度保留玩法结构。", fill=(244, 224, 184, 198), font=font(SANS_FONT, 22), anchor="mm")
    image.convert("RGB").save(FULL_DECK_PATH, quality=88, optimize=True)


def render_featured(deck: dict, card_images: list[Image.Image]) -> None:
    width, height = 1500, 900
    image = gradient_background(width, height).convert("RGBA")
    draw = ImageDraw.Draw(image)
    draw.text((width // 2, 66), "从 40 张作品库素材补成完整盒装", fill=(244, 224, 184), font=font(SERIF_FONT, 50), anchor="mm")
    draw.text((width // 2, 112), "A/B 半契互补、卡面可展示、规则可落地", fill=(244, 224, 184, 198), font=font(SANS_FONT, 24), anchor="mm")
    indexes = [0, 19, 40, 47]
    poses = [(310, 445, -8, 315), (600, 425, -2, 390), (900, 429, 3, 390), (1190, 450, 8, 315)]
    for card_index, (x, y, angle, width_card) in zip(indexes, poses):
        card = card_images[card_index].resize((width_card, round(width_card * CARD_HEIGHT / CARD_WIDTH)), Image.Resampling.LANCZOS)
        shadowed_paste(image, card, (x, y), angle)
    draw.rounded_rectangle((270, 730, 1230, 812), radius=10, fill=(16, 13, 11, 185), outline=(217, 177, 109, 120), width=2)
    draw.text((width // 2, 781), "48 张完整记忆配对牌 · 24 组星痕半契 · 可展览、可印刷、可继续编辑", fill=(244, 224, 184), font=font(SANS_FONT, 26), anchor="mm")
    image.convert("RGB").save(FEATURED_PATH, quality=90, optimize=True)


def progress_frame(deck: dict, card_images: list[Image.Image], completed: int) -> Image.Image:
    width, height = 960, 540
    image = gradient_background(width, height).convert("RGBA")
    draw = ImageDraw.Draw(image)
    draw.text((40, 58), "完整套牌炼制中", fill=(244, 224, 184), font=font(SERIF_FONT, 34), anchor="lm")
    draw.text((42, 88), f"{deck['name']} · 逐张写入作品库与文档资产", fill=(244, 224, 184, 190), font=font(SANS_FONT, 16), anchor="lm")
    current = max(0, min(len(card_images) - 1, completed - 1))
    hero = card_images[current].resize((240, 309), Image.Resampling.LANCZOS)
    shadowed_paste(image, hero, (180, 310), -2)
    draw.rounded_rectangle((52, 466, 315, 504), radius=7, fill=(16, 13, 11, 150))
    draw.text((184, 490), deck["cards"][current]["name"] if completed else "等待第一张卡图", fill=(244, 224, 184), font=font(SANS_FONT, 17), anchor="mm")
    columns, slot_w, slot_h, gap = 8, 71, 91, 10
    start_x, start_y = 388, 142
    for index in range(len(card_images)):
        col, row = index % columns, index // columns
        x, y = start_x + col * (slot_w + gap), start_y + row * (slot_h + gap)
        ready = index < completed
        draw.rounded_rectangle((x, y, x + slot_w, y + slot_h), radius=5, fill=(244, 224, 184, 18), outline=(217, 177, 109, 140 if ready else 46), width=1)
        if ready:
            image.alpha_composite(card_images[index].resize((slot_w - 4, slot_h - 4), Image.Resampling.LANCZOS), (x + 2, y + 2))
    draw.text((width - 192, height - 66), f"{completed}/{len(card_images)}", fill=(244, 224, 184), font=font(SANS_FONT, 30), anchor="lm")
    draw.rounded_rectangle((388, height - 92, width - 200, height - 76), radius=8, fill=(244, 224, 184, 35))
    draw.rounded_rectangle((388, height - 92, 388 + int((width - 588) * completed / len(card_images)), height - 76), radius=8, fill=(112, 204, 196, 205))
    return image.convert("P", palette=Image.Palette.ADAPTIVE, colors=160)


def save_gif(path: Path, frames: list[Image.Image], duration: int) -> None:
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=duration, loop=0, optimize=True)


def render_making_gif(deck: dict, card_images: list[Image.Image]) -> None:
    frames = []
    total = len(card_images)
    for frame in range(64):
        t = frame / 63
        eased = 2 * t * t if t < 0.5 else 1 - ((-2 * t + 2) ** 2) / 2
        completed = min(total, int(eased * (total + 1)))
        frames.append(progress_frame(deck, card_images, completed))
    save_gif(MAKING_OF_PATH, frames, 78)


def toolbar(draw: ImageDraw.ImageDraw, active: str, width: int) -> None:
    draw.rounded_rectangle((294, 28, 666, 70), radius=8, fill=(16, 13, 11, 150))
    for index, label in enumerate(["扇形", "网格", "翻面", "牌桌"]):
        x = 314 + index * 88
        selected = label == active
        draw.rounded_rectangle((x, 37, x + 70, 61), radius=6, fill=(217, 177, 109, 210) if selected else (244, 224, 184, 24))
        draw.text((x + 35, 54), label, fill=(17, 17, 15) if selected else (244, 224, 184, 195), font=font(SANS_FONT, 16), anchor="mm")
    draw.text((width // 2, 92), "2D 牌桌展览动效预览", fill=(244, 224, 184, 195), font=font(SANS_FONT, 15), anchor="mm")


def render_showcase_gif(card_images: list[Image.Image], back: Image.Image) -> None:
    width, height = 960, 540
    selected = [0, 5, 9, 13, 18, 22, 27, 31, 35, 40, 43, 47]
    small_cards = [card_images[index].resize((118, 152), Image.Resampling.LANCZOS) for index in selected]
    fan_cards = [card_images[index].resize((158, 203), Image.Resampling.LANCZOS) for index in selected]
    frames: list[Image.Image] = []
    for frame in range(88):
        t = frame / 87
        image = gradient_background(width, height).convert("RGBA")
        draw = ImageDraw.Draw(image)
        if t < 0.28:
            toolbar(draw, "扇形", width)
            p = min(1.0, t / 0.28)
            p = 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2
            spread = len(fan_cards) - 1
            for order, card in enumerate(fan_cards):
                angle = (-28 + (order / spread) * 56) * p
                x = width / 2 + (order - spread / 2) * 30 * p
                y = 380 - math.cos((order / spread) * math.pi) * 82 * p
                shadowed_paste(image, card, (int(x), int(y)), angle)
        elif t < 0.54:
            toolbar(draw, "网格", width)
            p = (t - 0.28) / 0.26
            p = 2 * p * p if p < 0.5 else 1 - ((-2 * p + 2) ** 2) / 2
            spread = len(small_cards) - 1
            for order, card in enumerate(small_cards):
                col, row = order % 6, order // 6
                fan_x = width / 2 + (order - spread / 2) * 28
                fan_y = 360 - math.cos((order / spread) * math.pi) * 72
                grid_x, grid_y = 166 + col * 126, 205 + row * 172
                x, y = fan_x + (grid_x - fan_x) * p, fan_y + (grid_y - fan_y) * p
                shadowed_paste(image, card, (int(x), int(y)), (-22 + order / spread * 44) * (1 - p))
        elif t < 0.78:
            toolbar(draw, "翻面", width)
            for order, card in enumerate(small_cards):
                col, row = order % 6, order // 6
                faded = card.copy()
                faded.putalpha(110)
                shadowed_paste(image, faded, (166 + col * 126, 205 + row * 172))
            p = (t - 0.54) / 0.24
            scale_x = max(0.08, abs(math.cos(p * math.pi * 2)))
            showing_back = math.cos(p * math.pi * 2) < 0
            hover = (back if showing_back else card_images[selected[7]]).resize((280, 360), Image.Resampling.LANCZOS)
            shadowed_paste(image, hover, (width // 2, 305), math.sin(p * math.pi * 2) * 3, 255, scale_x)
        else:
            toolbar(draw, "牌桌", width)
            p = (t - 0.78) / 0.22
            p = 2 * p * p if p < 0.5 else 1 - ((-2 * p + 2) ** 2) / 2
            for order, card_index in enumerate(selected):
                seed = order + 1
                size = 176 if order == 8 else 118
                card = card_images[card_index].resize((size, round(size * CARD_HEIGHT / CARD_WIDTH)), Image.Resampling.LANCZOS)
                x = 140 + (seed * 73) % 700 + math.sin(t * math.pi * 8 + seed) * 18 * p
                y = 180 + (seed * 59) % 260 + math.cos(t * math.pi * 7 + seed) * 14 * p
                angle = (-15 + ((seed * 37) % 52)) * p
                shadowed_paste(image, card, (int(x), int(y)), angle)
            draw.arc((108, 94, 844, 480), 192, 342, fill=(255, 229, 161, 88), width=3)
        frames.append(image.convert("P", palette=Image.Palette.ADAPTIVE, colors=160))
    save_gif(SHOWCASE_PATH, frames, 72)


def main() -> None:
    ensure_dirs()
    source = load_source_deck()
    copy_library_raw_images(source)
    deck = complete_deck(source)
    DATA_PATH.write_text(json.dumps(deck, ensure_ascii=False, indent=2) + "\n")
    card_images, back = render_all_cards(deck)
    render_full_deck(deck, card_images)
    render_featured(deck, card_images)
    render_making_gif(deck, card_images)
    render_showcase_gif(card_images, back)
    print(json.dumps({
        "deck": deck["name"],
        "cards": len(deck["cards"]),
        "fullDeck": str(FULL_DECK_PATH),
        "makingGif": str(MAKING_OF_PATH),
        "showcaseGif": str(SHOWCASE_PATH),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
