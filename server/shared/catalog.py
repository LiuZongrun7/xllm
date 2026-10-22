"""
展示层小工具：菜品 / 店铺的占位视觉

我们没有真实的菜品照片，也不想盗用参考素材里的图片，所以三端统一用
"渐变底 + 一个 emoji"作为占位视觉（前端负责渐变，这里只决定 emoji）。
放 shared/ 里的理由：同一道菜在顾客端和商家端必须长得一样，
否则商家改库存时会对不上顾客看到的那一项。
"""

# 关键词 → emoji。按顺序匹配，越具体的放越前面。
_DISH_EMOJI = (
    ("dumpling", "🥟"), ("wonton", "🥟"), ("bao", "🥟"),
    ("noodle", "🍜"), ("ramen", "🍜"), ("udon", "🍜"), ("pho", "🍜"),
    ("sushi", "🍣"), ("sashimi", "🍣"), ("maki", "🍣"), ("roll", "🍣"),
    ("rice", "🍚"), ("bowl", "🍚"), ("congee", "🥣"),
    ("burger", "🍔"), ("sandwich", "🥪"), ("pizza", "🍕"), ("taco", "🌮"),
    ("salad", "🥗"), ("veg", "🥦"), ("tofu", "🥘"),
    ("soup", "🍲"), ("hotpot", "🍲"), ("curry", "🍛"),
    ("chicken", "🍗"), ("wing", "🍗"), ("duck", "🍗"),
    ("beef", "🥩"), ("steak", "🥩"), ("pork", "🥓"), ("lamb", "🍖"),
    ("fish", "🐟"), ("shrimp", "🦐"), ("prawn", "🦐"), ("crab", "🦀"),
    ("egg", "🥚"), ("bread", "🥖"), ("bun", "🥯"),
    ("tea", "🍵"), ("coffee", "☕"), ("juice", "🧃"), ("soda", "🥤"),
    ("milkshake", "🥤"), ("water", "💧"), ("beer", "🍺"),
    ("cake", "🍰"), ("ice", "🍨"), ("dessert", "🍮"), ("sweet", "🍬"),
    ("mango", "🥭"), ("fruit", "🍓"),
)

# 分类兜底
_CATEGORY_EMOJI = {
    "starters": "🥟", "starter": "🥟",
    "mains": "🍚", "main": "🍚",
    "noodles": "🍜", "noodle": "🍜",
    "rice": "🍚", "sushi": "🍣", "grill": "🍖",
    "soup": "🍲", "salad": "🥗",
    "drinks": "🥤", "drink": "🥤", "dessert": "🍰", "desserts": "🍰",
    "sides": "🥢", "specials": "⭐",
}

# 店铺 cover emoji
_CUISINE_EMOJI = {
    "chinese": "🥢", "noodles": "🍜", "japanese": "🍣", "korean": "🍲",
    "thai": "🍛", "indian": "🍛", "italian": "🍕", "western": "🍔",
    "salad": "🥗", "dessert": "🍰", "drinks": "🥤", "cafe": "☕",
}


def dish_emoji(name: str, category: str | None = None) -> str:
    haystack = f"{name} {category or ''}".lower()
    for word, emoji in _DISH_EMOJI:
        if word in haystack:
            return emoji
    if category:
        hit = _CATEGORY_EMOJI.get(category.strip().lower())
        if hit:
            return hit
    return "🍽️"


def cuisine_emoji(cuisine: str | None) -> str:
    return _CUISINE_EMOJI.get((cuisine or "").strip().lower(), "🍽️")
